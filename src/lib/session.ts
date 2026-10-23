/**
 * Uma Session = um "servidor" do Nexo = uma sala P2P.
 *
 * Não existe servidor central: a descoberta de peers usa relays públicos do Nostr
 * (via Trystero) só para trocar a sinalização WebRTC, criptografada com a senha
 * do convite. Depois disso tudo (chat, vídeo, voz) vai direto entre os amigos.
 *
 * - Cada peer prova quem é no handshake (assinatura Ed25519); banidos são recusados.
 * - O chat é um log de eventos assinados que todo membro guarda e sincroniza
 *   com quem chega (comparando resumos por dia, só o que falta é enviado).
 * - Anexos ficam no banco local de quem tem e são buscados de qualquer peer.
 * - Lives usam uma árvore de retransmissão: espectadores repassam o vídeo.
 */
import { joinRoom, selfId, type DataPayload, type Room } from "trystero";
import { db } from "./db";
import { derive, dayKey, isMemberOf, summarize, type Derived } from "./derive";
import { canonical, GOVERNANCE, MAX_FUTURE_MS, validateBody, verifyEvent } from "./events";
import { isPubKey, sha256, verify, type Identity } from "./identity";
import { sanitizeLive, sanitizePatch, sanitizeProfile, sanitizeThumb, type PresencePatch } from "./sanitize";
import { makePeerConnectionClass, myFingerprint, remoteFingerprint } from "./rtc";
import { randomId } from "./storage";
import type { Attachment, EventBody, LiveInfo, Member, MsgView, PeerInfo, Profile, ServerInfo, Settings, SignedEvent, StoredEvent, WatchState } from "./types";

export const APP_ID = "nexo-p2p-v3";
export const PROTO = 3;

/** Limite simples por peer (token bucket) contra inundação. */
class Bucket {
  private tokens: number;
  private last = Date.now();
  constructor(
    private capacity: number,
    private perSecond: number,
  ) {
    this.tokens = capacity;
  }
  take(n = 1) {
    const now = Date.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.perSecond);
    this.last = now;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}
export { selfId };

export const MAX_FILE = 25 * 1024 * 1024;
const AUTO_FETCH = 8 * 1024 * 1024;

export type SessionCtx = {
  identity: Identity;
  profile: () => Profile;
  settings: () => Settings;
  muted: () => boolean;
  deaf: () => boolean;
  emit: () => void;
  onNewMessage: (session: Session, msg: MsgView) => void;
  onVoiceStream: (session: Session, peerId: string, pub: string, stream: MediaStream | null) => void;
  onPeerEvent: (session: Session, kind: "voice-join" | "voice-leave" | "live-start", peerId: string) => void;
  onMove: (session: Session, roomId: string, password: string) => void;
  saveServers: () => void;
};

type Hello = { profile: Profile; live: LiveInfo | null; inVoice: boolean; muted: boolean; deaf: boolean; thumb?: string };
type WatchReply = { ok: true } | { ok: false; reason: string } | { redirect: string };
type MediaMeta = { kind: "live" | "voice"; origin?: string };
export type LiveStats = { res: string; fps: number; kbps: number; codec: string; loss: number };

export const QUALITY: Record<Settings["quality"], { width: number; height: number; fps: number }> = {
  "480p30": { width: 854, height: 480, fps: 30 },
  "720p30": { width: 1280, height: 720, fps: 30 },
  "720p60": { width: 1280, height: 720, fps: 60 },
  "1080p30": { width: 1920, height: 1080, fps: 30 },
  "1080p60": { width: 1920, height: 1080, fps: 60 },
  "1440p60": { width: 2560, height: 1440, fps: 60 },
};

export class Session {
  room: Room;
  peers: Record<string, PeerInfo> = {};
  events = new Map<string, StoredEvent>();
  members: Record<string, Member> = {};
  loaded = false;
  joinError: string | null = null;
  // canal -> pub -> expira. Sem protótipo: o nome do canal vem da rede e "constructor" não pode ser um canal
  typing: Record<string, Record<string, number>> = Object.create(null);
  blobsLoading = new Set<string>();
  private derivedCache: Derived | null = null;
  private moving = false;
  private handshakeInfo: Record<string, { pub: string; fp: string }> = {};
  /** peers que já receberam nosso estado completo (são membros) */
  private synced = new Set<string>();
  private buckets: Record<string, { ev: Bucket; small: Bucket; blob: Bucket }> = {};
  /** um membro nos avisou que ainda precisamos ser aprovados */
  awaitingApproval = false;

  // live (transmissor)
  myStream: MediaStream | null = null;
  myLive: LiveInfo | null = null;
  myThumb: string | undefined;
  tree = new Map<string, string>();
  private thumbTimer: number | undefined;

  // live (espectador / retransmissor)
  watching: WatchState | null = null;
  relayChildren = new Map<string, Set<string>>();
  received = new Map<string, MediaStream>();
  private lastInbound: { bytes: number; ts: number } | null = null;

  // voz
  inVoice = false;
  micStream: MediaStream | null = null;
  voicePeers = new Set<string>();

  private act: ReturnType<Session["makeActions"]>;
  private statsTimer: number;
  private resyncTimer: number;
  private lastTypingSent = 0;

  constructor(
    public server: ServerInfo,
    private ctx: SessionCtx,
  ) {
    const s = ctx.settings();
    const turnConfig = s.turnUrl ? [{ urls: s.turnUrl, username: s.turnUser || undefined, credential: s.turnPass || undefined }] : undefined;
    const urls = s.relayUrls
      .split(/\s+/)
      .map((u) => u.trim())
      .filter((u) => /^wss?:\/\//.test(u));

    this.room = joinRoom(
      {
        appId: APP_ID,
        password: server.password,
        turnConfig,
        relayConfig: urls.length ? { urls } : { redundancy: 6 },
        rtcPolyfill: makePeerConnectionClass(() => ctx.settings().codec, s.relayOnly && !!s.turnUrl),
        maxReceiveBytes: 32 * 1024 * 1024,
      },
      server.roomId,
      {
        onJoinError: (e) => {
          this.joinError = /banid/i.test(e.error) ? "Você foi banido deste servidor." : e.error;
          ctx.emit();
        },
        onPeerHandshake: (peerId, send, receive) => this.handshake(peerId, send, receive),
        handshakeTimeoutMs: 15000,
      },
    );

    this.act = this.makeActions();
    const r = this.room;
    r.onPeerJoin = (id) => this.onPeerJoin(id);
    r.onPeerLeave = (id) => this.onPeerLeave(id);
    r.onPeerStream = (stream, id, meta) => this.onPeerStream(stream, id, meta as MediaMeta | undefined);

    // tudo que chega passa por: limite de taxa + "esse peer pode me mandar isso?"
    this.act.hello.onMessage = (h: Hello, { peerId }) => {
      if (this.allow(peerId, "small", false)) void this.onHello(peerId, h);
    };
    this.act.state.onMessage = (p: unknown, { peerId }) => {
      if (this.allow(peerId, "small", false)) void this.onState(peerId, p);
    };
    this.act.ev.onMessage = (evs: SignedEvent[], { peerId }) => {
      if (this.allow(peerId, "ev", true, Array.isArray(evs) ? evs.length : 1)) void this.receiveEvents(evs, peerId, true);
    };
    this.act.sum.onMessage = (sum: Record<string, string>, { peerId }) => {
      if (this.allow(peerId, "small", true)) void this.onSummary(peerId, sum);
    };
    this.act.have.onMessage = (have: Record<string, string[]>, { peerId }) => {
      if (this.allow(peerId, "small", true)) void this.onHave(peerId, have);
    };
    this.act.typing.onMessage = (d: { ch: string }, { peerId }) => {
      if (this.allow(peerId, "small", true)) void this.onTyping(peerId, d?.ch);
    };
    this.act.gate.onMessage = (d: { pending: boolean }, { peerId }) => {
      if (!this.allow(peerId, "small", false)) return;
      // só vale se vier de quem já é membro para nós (ou se ainda não sabemos nada do servidor)
      if (this.events.size > 0 && !this.isMember(this.peers[peerId]?.pub ?? "")) return;
      const st = this.state;
      // um membro diz que ainda não fomos aprovados (a menos que já tenhamos o "admit" assinado)
      this.awaitingApproval = !!d?.pending && !(st.approval && isMemberOf(st, this.server.owner, this.me));
      if (this.awaitingApproval) this.synced.clear();
      ctx.emit();
    };
    this.act.leaveTree.onMessage = (_: unknown, { peerId }) => {
      if (this.allow(peerId, "small", true)) void this.onLeaveTree(peerId);
    };
    this.act.reparent.onMessage = (d: { origin: string }, { peerId }) => {
      if (!this.allow(peerId, "small", true)) return;
      if (this.watching?.origin === d?.origin && this.watching.parent === peerId) this.rewatch();
    };

    this.statsTimer = window.setInterval(() => this.updateStats(), 5000);
    // ressincroniza de tempos em tempos: cura qualquer lacuna (mensagem perdida, limite de taxa…)
    this.resyncTimer = window.setInterval(() => {
      if (this.loaded && this.isMember()) this.toMembers((target) => this.act.sum.send(summarize(this.events.values()), { target }));
    }, 60_000);
    this.load();
  }

  private makeActions() {
    const r = this.room;
    /* eslint-disable @typescript-eslint/no-explicit-any */
    return {
      hello: r.makeAction<any>("hello"),
      state: r.makeAction<any>("state"),
      ev: r.makeAction<any>("ev"),
      sum: r.makeAction<any>("sum"),
      have: r.makeAction<any>("have"),
      typing: r.makeAction<any>("typing"),
      gate: r.makeAction<any>("gate"),
      leaveTree: r.makeAction<any>("leavetree"),
      reparent: r.makeAction<any>("reparent"),
      watch: r.makeAction<any, any>("watch", {
        kind: "request",
        onRequest: (d: { failed?: string }, c) => (this.allow(c.peerId, "small", true) ? this.handleWatch(c.peerId, d?.failed) : { ok: false, reason: "sem permissão" }),
      }),
      relay: r.makeAction<any, any>("relay", {
        kind: "request",
        onRequest: (d: { origin: string }, c) => (this.allow(c.peerId, "small", true) ? this.handleRelay(c.peerId, d?.origin) : { ok: false }),
      }),
      blob: r.makeAction<any, any>("blob", {
        kind: "request",
        onRequest: async (d: { id: string }, c) => {
          if (!this.allow(c.peerId, "blob", true) || typeof d?.id !== "string" || !/^[\w-]{32}$/.test(d.id)) return null;
          return (await db.getBlob(d.id))?.data ?? null;
        },
      }),
    };
    /* eslint-enable @typescript-eslint/no-explicit-any */
  }

  private async load() {
    const [evs, mems] = await Promise.all([db.loadEvents(this.server.sid), db.loadMembers(this.server.sid)]);
    // eventos guardados por versões que ainda não validavam o conteúdo não podem derrubar a interface
    for (const e of evs) if (validateBody(e.b)) this.events.set(e.id, e);
    for (const m of mems) this.members[m.pub] = m;
    this.loaded = true;
    this.invalidate();
    for (const id of Object.keys(this.peers)) this.greet(id);
  }

  get name() {
    return this.state.name;
  }

  get state(): Derived {
    if (!this.derivedCache) this.derivedCache = derive([...this.events.values()], this.server.owner, { name: this.server.name, channels: this.server.channels });
    return this.derivedCache;
  }

  private invalidate() {
    this.derivedCache = null;
    const st = this.state;
    if (st.name !== this.server.name || JSON.stringify(st.channels) !== JSON.stringify(this.server.channels)) {
      this.server.name = st.name;
      this.server.channels = st.channels;
      this.ctx.saveServers();
    }
    if (st.move && (st.move.r !== this.server.roomId || st.move.p !== this.server.password) && this.isMember() && !this.moving) {
      // espera um pouco para o aviso se espalhar antes de sair da sala antiga
      this.moving = true;
      const { r, p } = st.move;
      setTimeout(() => this.ctx.onMove(this, r, p), 1500);
    }
    // todo membro aplica o banimento: derruba a conexão com quem foi banido
    if (st.banned.size) {
      const pcs = this.room.getPeers();
      for (const [id, p] of Object.entries(this.peers)) {
        if (!st.banned.has(p.pub)) continue;
        pcs[id]?.close();
        this.onPeerLeave(id);
      }
    }
    if (st.banned.has(this.me)) this.joinError = "Você foi banido deste servidor.";
    if (this.awaitingApproval && isMemberOf(st, this.server.owner, this.me) && st.approval) this.awaitingApproval = false;
    // quem acabou de ser aprovado recebe nosso estado completo
    if (this.loaded) for (const id of Object.keys(this.peers)) if (!this.synced.has(id) && this.isMember(this.peers[id].pub)) this.greet(id);
    this.ctx.emit();
  }

  get me() {
    return this.ctx.identity.pub;
  }
  isAdmin(pub = this.me) {
    return !this.server.owner || this.state.admins.has(pub);
  }
  isOwner(pub = this.me) {
    return !!this.server.owner && pub === this.server.owner;
  }
  /** Membro = pode ver o histórico e participar (aprovado, se a aprovação estiver ligada). */
  isMember(pub = this.me) {
    if (pub === this.me && this.awaitingApproval) return false;
    return isMemberOf(this.state, this.server.owner, pub);
  }
  /** Peers conectados que são membros (os únicos que recebem conteúdo). */
  memberPeers(): string[] {
    return Object.entries(this.peers)
      .filter(([, p]) => this.isMember(p.pub))
      .map(([id]) => id);
  }
  /** Pessoas conectadas esperando aprovação de um admin. */
  pendingPeers(): [string, PeerInfo][] {
    return Object.entries(this.peers).filter(([, p]) => p.profile && !this.isMember(p.pub) && !this.state.banned.has(p.pub));
  }
  /** Envia para todos os membros conectados (nunca para pendentes/banidos). */
  private toMembers(send: (target: string[]) => void) {
    const ids = this.memberPeers();
    if (ids.length) send(ids);
  }

  /**
   * Porteiro de tudo que chega: limite de taxa por peer e, para conteúdo,
   * só aceitamos de membros (se nós mesmos já somos membros; um recém-chegado
   * aceita a sincronização inicial e o estado derivado filtra os autores).
   */
  private allow(peerId: string, kind: "ev" | "small" | "blob", needsMember: boolean, n = 1): boolean {
    const p = this.peers[peerId];
    if (!p) return false;
    const b = (this.buckets[peerId] ??= { ev: new Bucket(20000, 2000), small: new Bucket(120, 30), blob: new Bucket(10, 1) });
    if (!b[kind].take(n)) {
      console.warn("peer excedeu o limite de taxa:", kind, p.pub.slice(0, 8));
      return false;
    }
    if (needsMember && this.isMember() && !this.isMember(p.pub)) return false;
    return true;
  }

  // ------------------------------------------------------------------ handshake

  /**
   * Autenticação mútua: cada lado assina (desafio do outro, sala, impressão
   * digital do próprio certificado DTLS, impressão digital do outro). Depois
   * da conexão, conferimos que o certificado DTLS real bate com o assinado.
   */
  private async handshake(peerId: string, send: (d: DataPayload) => Promise<void>, receive: () => Promise<{ data: DataPayload }>) {
    const nonce = randomId(32);
    const myFp = myFingerprint();
    await send({ pub: this.me, nonce, v: PROTO, fp: myFp });
    const h = (await receive()).data as { pub: string; nonce: string; v: number; fp: string } | null;
    if (!h || h.v !== PROTO) throw new Error("versão do Nexo incompatível — atualize o app");
    if (!isPubKey(h.pub) || typeof h.nonce !== "string" || h.nonce.length < 24 || typeof h.fp !== "string" || !/^[0-9A-F]{64}$/.test(h.fp)) throw new Error("handshake inválido");
    if (h.fp === myFp) throw new Error("conexão consigo mesmo");
    const ctxStr = (theirNonce: string, signerFp: string, otherFp: string) => `nexo-hs:v${PROTO}:${this.server.sid}:${theirNonce}:${signerFp}:${otherFp}`;
    await send({ sig: await this.ctx.identity.sign(ctxStr(h.nonce, myFp, h.fp)) });
    const r = (await receive()).data as { sig: string } | null;
    if (!(await verify(h.pub, ctxStr(nonce, h.fp, myFp), r?.sig ?? ""))) throw new Error("assinatura inválida");
    if (this.state.banned.has(h.pub)) throw new Error("banido");
    this.handshakeInfo[peerId] = { pub: h.pub, fp: h.fp };
  }

  // ------------------------------------------------------------------ peers

  private hello(full: boolean): Hello {
    const base: Hello = { profile: this.ctx.profile(), live: null, inVoice: false, muted: false, deaf: false };
    if (!full) return base; // pendentes só veem nome e foto
    return { ...base, live: this.myLive, inVoice: this.inVoice, muted: this.ctx.muted(), deaf: this.ctx.deaf(), thumb: this.myThumb };
  }

  /** Apresentação + sincronização para um peer (completa só se ele for membro). */
  private greet(id: string) {
    const p = this.peers[id];
    if (!p) return;
    const member = this.isMember(p.pub);
    this.act.hello.send(this.hello(member && this.isMember()), { target: id });
    if (!this.loaded) return;
    if (member) {
      this.synced.add(id);
      this.act.sum.send(summarize(this.events.values()), { target: id });
    } else if (this.isMember()) {
      this.act.gate.send({ pending: true }, { target: id });
    }
  }

  private onPeerJoin(id: string) {
    const info = this.handshakeInfo[id];
    delete this.handshakeInfo[id];
    if (!info) return;
    // channel binding: o certificado DTLS desta conexão tem que ser o que foi assinado
    const pc = this.room.getPeers()[id];
    const fp = pc ? remoteFingerprint(pc) : null;
    if (!fp || fp !== info.fp) {
      console.error("conexão recusada: certificado DTLS não confere com o assinado (possível intermediário)");
      pc?.close();
      return;
    }
    this.peers[id] = { pub: info.pub };
    this.greet(id);
    this.ctx.emit();
  }

  private onHello(peerId: string, h: Hello) {
    const p = this.peers[peerId];
    if (!p || !h?.profile) return;
    p.profile = sanitizeProfile(h.profile, p.pub); // vale a chave provada no handshake
    this.rememberMember(p.pub, p.profile);
    if (this.isMember(p.pub) || !this.isMember()) {
      p.live = sanitizeLive(h.live);
      p.thumb = sanitizeThumb(h.thumb);
      p.muted = !!h.muted;
      p.deaf = !!h.deaf;
      const wasVoice = p.inVoice;
      p.inVoice = !!h.inVoice;
      if (p.inVoice && !wasVoice && this.inVoice) this.sendMic(peerId);
    }
    this.ctx.emit();
  }

  private rememberMember(pub: string, prof: Profile) {
    const m: Member = { srv: this.server.sid, pub, name: prof.name, color: prof.color, avatar: prof.avatar, lastSeen: Date.now() };
    this.members[pub] = m;
    db.putMember(m).catch(() => {});
  }

  private onPeerLeave(id: string) {
    const p = this.peers[id];
    delete this.peers[id];
    delete this.handshakeInfo[id];
    delete this.buckets[id];
    this.synced.delete(id);
    if (p?.pub) {
      const m = this.members[p.pub];
      if (m) db.putMember({ ...m, lastSeen: Date.now() }).catch(() => {});
    }
    if (this.voicePeers.delete(id)) this.ctx.onVoiceStream(this, id, p?.pub ?? "", null);
    if (p?.inVoice && this.inVoice) this.ctx.onPeerEvent(this, "voice-leave", id);
    if (this.tree.has(id)) {
      this.tree.delete(id);
      for (const [v, parent] of this.tree) if (parent === id) this.tree.delete(v);
      this.broadcastViewers();
    }
    for (const set of this.relayChildren.values()) set.delete(id);
    if (this.watching) {
      if (this.watching.origin === id) this.stopWatching(false);
      else if (this.watching.parent === id) this.rewatch();
    }
    this.ctx.emit();
  }

  private onState(id: string, raw: unknown) {
    const prev = this.peers[id];
    if (!prev || !raw || typeof raw !== "object") return;
    // só chaves conhecidas e validadas; quem ainda não é membro só atualiza nome e foto
    const patch = sanitizePatch(raw, prev.pub, this.isMember() && !this.isMember(prev.pub));
    if (patch.profile) this.rememberMember(prev.pub, patch.profile);
    const wasVoice = prev.inVoice;
    const wasLive = !!prev.live;
    Object.assign(prev, patch);

    if ("live" in patch) {
      if (!patch.live) {
        prev.thumb = undefined;
        this.received.delete(id);
        this.relayChildren.delete(id);
        if (this.watching?.origin === id) this.stopWatching(false);
      } else if (!wasLive) this.ctx.onPeerEvent(this, "live-start", id);
    }
    if ("inVoice" in patch) {
      if (patch.inVoice && !wasVoice && this.inVoice) {
        this.sendMic(id);
        this.ctx.onPeerEvent(this, "voice-join", id);
      }
      if (!patch.inVoice && wasVoice) {
        if (this.voicePeers.delete(id)) this.ctx.onVoiceStream(this, id, prev.pub, null);
        if (this.micStream) this.room.removeStream(this.micStream, { target: id });
        if (this.inVoice) this.ctx.onPeerEvent(this, "voice-leave", id);
      }
    }
    this.ctx.emit();
  }

  broadcastState(p: PresencePatch) {
    this.toMembers((target) => this.act.state.send(p, { target }));
  }

  peerName(id: string) {
    if (id === selfId) return this.ctx.profile().name;
    const p = this.peers[id];
    return p?.profile ? this.profileOf(p.pub).name : "Conectando…";
  }

  /** Perfil para exibir de uma chave pública (online ou já visto antes). */
  profileOf(pub: string): { name: string; color: string; avatar?: string; online: boolean; status?: Profile["status"] } {
    const base = this.rawProfile(pub);
    // dois usuários com o mesmo nome: mostra um pedaço da chave para não dar para se passar pelo outro
    const lower = base.name.toLowerCase();
    const clash = Object.values(this.members).some((m) => m.pub !== pub && m.name.toLowerCase() === lower) || (pub !== this.me && this.ctx.profile().name.toLowerCase() === lower);
    return clash ? { ...base, name: `${base.name} #${pub.slice(0, 4)}` } : base;
  }

  private rawProfile(pub: string): { name: string; color: string; avatar?: string; online: boolean; status?: Profile["status"] } {
    if (pub === this.me) {
      const p = this.ctx.profile();
      return { name: p.name, color: p.color, avatar: p.avatar, online: true, status: p.status };
    }
    const online = Object.values(this.peers).find((p) => p.pub === pub && p.profile);
    if (online?.profile) return { name: online.profile.name, color: online.profile.color, avatar: online.profile.avatar, online: true, status: online.profile.status };
    const m = this.members[pub];
    if (m) return { name: m.name, color: m.color, avatar: m.avatar, online: false };
    return { name: "Usuário " + pub.slice(0, 5), color: "#80848e", online: false };
  }

  peerIdOf(pub: string) {
    return Object.entries(this.peers).find(([, p]) => p.pub === pub)?.[0] ?? null;
  }

  private async updateStats() {
    const pcs = this.room.getPeers();
    let changed = false;
    for (const [id, p] of Object.entries(this.peers)) {
      try {
        const rtt = Math.round(await this.room.ping(id));
        if (rtt !== p.rtt) {
          p.rtt = rtt;
          changed = true;
        }
        if (p.relayed === undefined && pcs[id]) {
          const stats = await pcs[id].getStats();
          stats.forEach((r) => {
            if (r.type === "candidate-pair" && r.nominated && r.state === "succeeded") {
              p.relayed = stats.get(r.localCandidateId)?.candidateType === "relay";
            }
          });
        }
      } catch {
        /* peer saindo */
      }
    }
    const now = Date.now();
    for (const ch of Object.values(this.typing))
      for (const [k, exp] of Object.entries(ch))
        if (exp < now) {
          delete ch[k];
          changed = true;
        }
    if (changed) this.ctx.emit();
  }

  // ------------------------------------------------------------------ eventos (chat, moderação…)

  async publish(b: EventBody): Promise<StoredEvent> {
    const a = this.me;
    // relógio lógico: sempre depois de tudo que já vimos (mesmo com o relógio do PC atrasado)
    let ts = Date.now();
    for (const e of this.events.values()) if (e.ts >= ts && e.ts < Date.now() + MAX_FUTURE_MS) ts = e.ts + 1;
    const data = canonical(a, ts, b);
    const ev: StoredEvent = { id: await sha256(data), a, ts, b, s: await this.ctx.identity.sign(data), srv: this.server.sid };
    const online = this.memberPeers().length > 0;
    if (!online) ev.pending = true;
    this.events.set(ev.id, ev);
    if (online) this.toMembers((target) => this.act.ev.send([stripLocal(ev)], { target }));
    await db.putEvents([ev]);
    this.invalidate();
    return ev;
  }

  /** ações de moderação de quem (ainda) não é admin para nós; reavaliadas quando o estado muda */
  private quarantine = new Map<string, StoredEvent>();

  private async receiveEvents(evs: SignedEvent[], fromPeer: string, live: boolean) {
    if (!Array.isArray(evs)) return;
    const fresh: StoredEvent[] = [];
    const known = this.events.size > 0;
    const banned = this.state.banned;
    // em ordem de tempo: um "torna admin" vem antes das ações desse admin
    const batch = evs.slice(0, 1000).filter((e) => e && typeof e === "object" && Number.isSafeInteger(e.ts)).sort((x, y) => x.ts - y.ts);
    const batchAdmins = new Set<string>();
    for (const raw of batch) {
      if (typeof raw.id !== "string" || this.events.has(raw.id) || this.quarantine.has(raw.id)) continue;
      if (banned.has(raw.a)) continue; // de quem já está banido, nada (antes de gastar hash e assinatura)
      const e = await verifyEvent(raw);
      if (!e) continue;
      const ev: StoredEvent = { id: e.id, a: e.a, ts: e.ts, b: e.b, s: e.s, srv: this.server.sid };
      // quem não é admin agora não pode "voltar no tempo" e publicar moderação com data antiga
      // (ex.: ex-admin forjando um ban). Fica em quarentena até ele virar admin para nós.
      if (known && GOVERNANCE.has(e.b.k) && !this.isAdmin(e.a) && !batchAdmins.has(e.a)) {
        if (this.quarantine.size < 1000) this.quarantine.set(ev.id, ev);
        continue;
      }
      if (e.b.k === "role" && e.a === this.server.owner && e.b.role === "admin" && isPubKey(e.b.user)) batchAdmins.add(e.b.user);
      this.events.set(e.id, ev);
      fresh.push(ev);
    }
    if (!fresh.length) return;
    await db.putEvents(fresh);
    this.invalidate();
    await this.retryQuarantine();
    const st = this.state;
    const recent = Date.now() - 2 * 60_000;
    for (const e of fresh) {
      if (e.b.k !== "msg") continue;
      const m = st.byId.get(e.id);
      if (!m) continue;
      if (live && e.ts > recent) this.ctx.onNewMessage(this, m);
      if (m.att) for (const a of m.att) if (a.size <= AUTO_FETCH) this.fetchBlob(a, fromPeer);
    }
    this.markDelivered();
  }

  private async retryQuarantine() {
    let changed = true;
    while (changed && this.quarantine.size) {
      changed = false;
      const ok = [...this.quarantine.values()].filter((e) => this.isAdmin(e.a) && !this.state.banned.has(e.a));
      if (!ok.length) break;
      for (const e of ok) {
        this.quarantine.delete(e.id);
        this.events.set(e.id, e);
      }
      await db.putEvents(ok);
      this.invalidate();
      changed = true;
    }
  }

  private markDelivered() {
    if (!this.memberPeers().length || !this.isMember()) return;
    const pend = [...this.events.values()].filter((e) => e.pending);
    if (!pend.length) return;
    for (const e of pend) delete e.pending;
    db.putEvents(pend);
    this.toMembers((target) => this.act.ev.send(pend.map(stripLocal), { target }));
    this.invalidate();
  }

  private onSummary(peerId: string, theirs: Record<string, string>) {
    if (!this.loaded) return;
    const mine = summarize(this.events.values());
    const days = new Set([...Object.keys(mine), ...Object.keys(theirs ?? {})]);
    const diff = [...days].filter((d) => mine[d] !== theirs?.[d]);
    if (!diff.length) {
      this.markDelivered();
      return;
    }
    const have: Record<string, string[]> = {};
    for (const d of diff) have[d] = [];
    for (const e of this.events.values()) {
      const d = dayKey(e.ts);
      if (have[d]) have[d].push(e.id);
    }
    this.act.have.send(have, { target: peerId });
  }

  /** O outro disse quais ids tem nesses dias: mando o que falta para ele. */
  private onHave(peerId: string, have: Record<string, string[]>) {
    const send: SignedEvent[] = [];
    for (const [d, ids] of Object.entries(have ?? {})) {
      if (!Array.isArray(ids)) continue;
      const theirs = new Set(ids);
      for (const e of this.events.values()) if (dayKey(e.ts) === d && !theirs.has(e.id)) send.push(stripLocal(e));
    }
    send.sort((x, y) => x.ts - y.ts);
    for (let i = 0; i < send.length; i += 300) this.act.ev.send(send.slice(i, i + 300), { target: peerId });
    this.markDelivered();
  }

  // --- chat
  async sendMessage(ch: string, text: string, opts: { reply?: string; files?: File[] } = {}) {
    const att: Attachment[] = [];
    for (const f of opts.files ?? []) att.push(await this.storeFile(f));
    const body: EventBody = { k: "msg", ch, text: text.slice(0, 4000), n: this.ctx.profile().name };
    if (opts.reply) body.reply = opts.reply;
    if (att.length) body.att = att;
    this.lastTypingSent = 0; // quem recebe a mensagem limpa o "digitando"; a próxima tecla avisa de novo
    await this.publish(body);
  }
  editMessage(id: string, text: string) {
    return this.publish({ k: "edit", target: id, text });
  }
  deleteMessage(id: string) {
    return this.publish({ k: "del", target: id });
  }
  toggleReaction(id: string, emoji: string) {
    const m = this.state.byId.get(id);
    const on = !(m?.reactions[emoji] ?? []).includes(this.me);
    return this.publish({ k: "react", target: id, emoji, on });
  }

  sendTyping(ch: string) {
    const now = Date.now();
    if (now - this.lastTypingSent < 3000) return;
    this.lastTypingSent = now;
    this.toMembers((target) => this.act.typing.send({ ch }, { target }));
  }
  private onTyping(peerId: string, ch: string) {
    const pub = this.peers[peerId]?.pub;
    if (!pub || typeof ch !== "string") return;
    (this.typing[ch] ??= Object.create(null))[pub] = Date.now() + 5000;
    this.ctx.emit();
  }
  typingIn(ch: string) {
    const now = Date.now();
    return Object.entries(this.typing[ch] ?? {})
      .filter(([, exp]) => exp > now)
      .map(([pub]) => this.profileOf(pub).name);
  }
  clearTyping(pub: string, ch: string) {
    if (this.typing[ch]) delete this.typing[ch][pub];
  }

  // --- anexos
  private async storeFile(f: File): Promise<Attachment> {
    if (f.size > MAX_FILE) throw new Error(`"${f.name}" passa de ${MAX_FILE / 1024 / 1024} MB`);
    const data = await f.arrayBuffer();
    const id = await sha256(data, 32);
    const mime = f.type || "application/octet-stream";
    await db.putBlob({ id, data, mime, name: f.name, ts: Date.now() });
    const att: Attachment = { id, name: f.name.slice(0, 120), mime, size: f.size };
    if (mime.startsWith("image/")) {
      try {
        const bmp = await createImageBitmap(f);
        att.w = bmp.width;
        att.h = bmp.height;
        bmp.close();
      } catch {
        /* imagem que o navegador não lê */
      }
    }
    return att;
  }

  /** Busca um anexo de quem tiver (prefere quem mandou a mensagem). */
  async fetchBlob(att: Attachment, prefer?: string): Promise<boolean> {
    if (await db.getBlob(att.id)) return true;
    if (this.blobsLoading.has(att.id)) return false;
    this.blobsLoading.add(att.id);
    this.ctx.emit();
    try {
      const ids = this.memberPeers().sort((a) => (a === prefer ? -1 : 1));
      for (const id of ids) {
        try {
          const raw = (await this.act.blob.request({ id: att.id }, { target: id, timeoutMs: 120000 })) as ArrayBuffer | ArrayBufferView | null;
          if (!raw) continue;
          const data = raw instanceof ArrayBuffer ? raw : ArrayBuffer.isView(raw) ? (raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer) : null;
          if (!data) continue;
          if ((await sha256(data, 32)) !== att.id) continue;
          await db.putBlob({ id: att.id, data, mime: att.mime, name: att.name, ts: Date.now() });
          return true;
        } catch {
          /* tenta o próximo */
        }
      }
      return false;
    } finally {
      this.blobsLoading.delete(att.id);
      this.ctx.emit();
    }
  }

  // --- administração
  addChannel(name: string) {
    const clean = cleanChannel(name);
    if (!clean) return null;
    const ch = { id: randomId(10), name: clean };
    this.publish({ k: "chan", id: ch.id, name: ch.name });
    return ch;
  }
  renameChannel(id: string, name: string) {
    const clean = cleanChannel(name);
    if (clean) this.publish({ k: "chan", id, name: clean });
  }
  deleteChannel(id: string) {
    this.publish({ k: "chan", id, name: "", del: true });
  }
  rename(name: string) {
    if (name.trim()) this.publish({ k: "name", name: name.trim().slice(0, 60) });
  }
  setRole(user: string, role: "admin" | "member") {
    return this.publish({ k: "role", user, role });
  }
  async ban(user: string, on: boolean) {
    await this.publish({ k: "ban", user, on });
    if (on) {
      const pid = this.peerIdOf(user);
      if (pid) this.room.getPeers()[pid]?.close();
    }
  }
  /** Aprovar (ou recusar) a entrada de alguém. Recusar = banir. */
  async admit(user: string, on: boolean) {
    if (on) await this.publish({ k: "admit", user, on: true });
    else await this.ban(user, true);
  }
  /** Liga/desliga a aprovação de novos membros. Ao ligar, quem já participa é aprovado automaticamente. */
  async setApproval(on: boolean) {
    if (on) {
      const st = this.state;
      for (const pub of Object.keys(this.members)) if (!st.banned.has(pub) && !st.admins.has(pub) && !st.admitted.has(pub)) await this.publish({ k: "admit", user: pub, on: true });
    }
    await this.publish({ k: "policy", approval: on });
  }
  /** Convite novo: todo mundo online migra para uma sala nova; o código antigo para de funcionar. */
  async regenerateInvite() {
    await this.publish({ k: "move", r: randomId(20), p: randomId(24) });
  }

  // ------------------------------------------------------------------ live: transmitindo

  async startLive(kind: LiveInfo["kind"], title: string, opts: { sourceId?: string; audio?: boolean } = {}) {
    const s = this.ctx.settings();
    const q = QUALITY[s.quality];
    const video: MediaTrackConstraints = { width: { ideal: q.width }, height: { ideal: q.height }, frameRate: { ideal: q.fps } };
    const audio = opts.audio ?? true;
    let stream: MediaStream;
    if (kind === "screen") {
      if (opts.sourceId && window.nexo) await window.nexo.selectSource(opts.sourceId, audio);
      // restrictOwnAudio: tenta não capturar o som do próprio Nexo (voz dos amigos)
      const audioC = audio ? ({ restrictOwnAudio: true } as MediaTrackConstraints) : false;
      stream = await navigator.mediaDevices.getDisplayMedia({ video, audio: audioC });
    } else {
      if (s.videoDevice !== "default") video.deviceId = { exact: s.videoDevice };
      stream = await navigator.mediaDevices.getUserMedia({ video, audio: audio ? { deviceId: s.inputDevice !== "default" ? { exact: s.inputDevice } : undefined } : false });
    }
    if (this.myStream) this.stopLive();

    this.liveRestarts = 0;
    for (const t of stream.getVideoTracks()) {
      t.contentHint = s.contentHint;
      // tela: "ended" = o usuário parou de compartilhar ou fechou a janela → encerra.
      // câmera: o dispositivo pode cair (driver, USB, carga) → tenta reabrir sem derrubar a live.
      t.onended = () => (kind === "camera" ? this.recoverCamera(t, video) : this.stopLive());
    }
    this.myStream = stream;
    this.myLive = {
      title: title || (kind === "screen" ? "Transmitindo a tela" : "Câmera"),
      kind,
      startedAt: Date.now(),
      viewers: 0,
      viewerKeys: [],
      audio: stream.getAudioTracks().length > 0,
    };
    this.tree.clear();
    this.broadcastState({ live: this.myLive });
    this.captureThumb();
    this.thumbTimer = window.setInterval(() => this.captureThumb(), 15000);
    this.ctx.emit();
  }

  private liveRestarts = 0;

  private async recoverCamera(old: MediaStreamTrack, video: MediaTrackConstraints) {
    const stream = this.myStream;
    if (!stream || !stream.getTracks().includes(old)) return;
    if (this.liveRestarts++ >= 3) return this.stopLive();
    try {
      // o dispositivo pode demorar a voltar (USB reconectando, driver reiniciando): tenta com espera
      // crescente e, se a câmera escolhida sumiu de vez, aceita qualquer câmera
      let fresh: MediaStreamTrack | undefined;
      // (o serviço de captura do Chromium, se cai, leva alguns segundos para voltar)
      const waits = [300, 1000, 2500, 5000];
      for (const [i, wait] of waits.entries()) {
        await new Promise((r) => setTimeout(r, wait));
        if (this.myStream !== stream) return;
        const last = i === waits.length - 1;
        const want = i >= 2 ? { ...video, deviceId: undefined } : video;
        try {
          fresh = (await navigator.mediaDevices.getUserMedia({ video: want })).getVideoTracks()[0];
          break;
        } catch (e) {
          if (last) throw e;
        }
      }
      if (!fresh) throw new Error("sem trilha de vídeo");
      if (this.myStream !== stream) return fresh.stop();
      fresh.contentHint = old.contentHint;
      fresh.onended = () => this.recoverCamera(fresh, video);
      // troca a trilha em todas as conexões sem renegociar
      await Promise.allSettled(this.room.replaceTrack(old, fresh));
      stream.removeTrack(old);
      stream.addTrack(fresh);
      console.warn("câmera reaberta após falha do dispositivo");
      this.ctx.emit();
    } catch (e) {
      console.warn("não consegui reabrir a câmera", e);
      this.stopLive();
    }
  }

  /** Miniatura pequena para o preview ao passar o mouse. */
  private async captureThumb() {
    const track = this.myStream?.getVideoTracks()[0];
    if (!track) return;
    try {
      const v = document.createElement("video");
      v.muted = true;
      v.srcObject = new MediaStream([track]);
      await v.play();
      await new Promise((r) => setTimeout(r, 200));
      const c = document.createElement("canvas");
      c.width = 320;
      c.height = Math.round((320 * (v.videoHeight || 9)) / (v.videoWidth || 16));
      c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
      v.srcObject = null;
      if (!this.myStream) return;
      this.myThumb = c.toDataURL("image/jpeg", 0.6);
      this.broadcastState({ thumb: this.myThumb });
      this.ctx.emit();
    } catch (e) {
      console.warn("thumb", e);
    }
  }

  stopLive() {
    if (!this.myStream) return;
    clearInterval(this.thumbTimer);
    this.room.removeStream(this.myStream);
    this.myStream.getTracks().forEach((t) => t.stop());
    this.myStream = null;
    this.myLive = null;
    this.myThumb = undefined;
    this.tree.clear();
    this.broadcastState({ live: null });
    this.ctx.emit();
  }

  private broadcastViewers() {
    if (!this.myLive) return;
    const keys = [...this.tree.keys()].map((id) => this.peers[id]?.pub).filter((x): x is string => !!x);
    this.myLive = { ...this.myLive, viewers: this.tree.size, viewerKeys: keys };
    this.broadcastState({ live: this.myLive });
    this.ctx.emit();
  }

  private childCount(node: string) {
    let n = 0;
    for (const p of this.tree.values()) if (p === node) n++;
    return n;
  }

  private isDescendant(node: string, ancestor: string) {
    let cur: string | undefined = node;
    for (let i = 0; cur && i < 64; i++) {
      if (cur === ancestor) return true;
      cur = this.tree.get(cur);
    }
    return false;
  }

  private depth(node: string) {
    let d = 0;
    let cur = this.tree.get(node);
    while (cur && cur !== selfId && d < 64) {
      d++;
      cur = this.tree.get(cur);
    }
    return d;
  }

  private handleWatch(viewer: string, failed?: string): WatchReply {
    if (!this.myStream) return { ok: false, reason: "Essa live já acabou." };
    this.tree.delete(viewer);
    if (failed && this.tree.get(failed)) this.tree.delete(failed);

    const slots = Math.max(1, this.ctx.settings().streamSlots);
    if (this.childCount(selfId) < slots) return this.serveDirect(viewer);

    const candidates = [...this.tree.keys()]
      .filter((n) => n !== failed && this.peers[n] && !this.isDescendant(n, viewer))
      .filter((n) => this.childCount(n) < (this.peers[n]?.profile?.relaySlots ?? 0))
      .sort((a, b) => this.depth(a) - this.depth(b) || (this.peers[a].rtt ?? 999) - (this.peers[b].rtt ?? 999));

    if (candidates.length) {
      this.tree.set(viewer, candidates[0]);
      this.broadcastViewers();
      return { redirect: candidates[0] };
    }
    return this.serveDirect(viewer);
  }

  private serveDirect(viewer: string): WatchReply {
    this.tree.set(viewer, selfId);
    const meta: MediaMeta = { kind: "live", origin: selfId };
    Promise.all(this.room.addStream(this.myStream!, { target: viewer, metadata: meta }))
      .then(() => this.applyBitrate(viewer))
      .catch(console.warn);
    this.broadcastViewers();
    return { ok: true };
  }

  private onLeaveTree(viewer: string) {
    if (this.tree.has(viewer)) {
      if (this.tree.get(viewer) === selfId && this.myStream) this.room.removeStream(this.myStream, { target: viewer });
      this.tree.delete(viewer);
      for (const [v, p] of this.tree) if (p === viewer) this.tree.delete(v);
      this.broadcastViewers();
    }
    for (const [origin, set] of this.relayChildren) {
      if (set.delete(viewer)) {
        const s = this.received.get(origin);
        if (s) this.room.removeStream(s, { target: viewer });
      }
    }
    this.ctx.emit();
  }

  private async applyBitrate(peerId: string) {
    const pc = this.room.getPeers()[peerId];
    if (!pc) return;
    const s = this.ctx.settings();
    for (const sender of pc.getSenders()) {
      if (sender.track?.kind !== "video") continue;
      const params = sender.getParameters();
      if (!params.encodings?.length) params.encodings = [{}];
      params.encodings[0].maxBitrate = s.bitrate * 1000;
      params.encodings[0].priority = "high";
      params.encodings[0].networkPriority = "high";
      params.degradationPreference = s.contentHint === "motion" ? "maintain-framerate" : "maintain-resolution";
      try {
        await sender.setParameters(params);
      } catch (e) {
        console.warn("setParameters", e);
      }
    }
  }

  /** Estatísticas da live que estou assistindo. */
  async liveStats(): Promise<LiveStats | null> {
    const w = this.watching;
    if (!w?.parent || !w.stream) return null;
    const pc = this.room.getPeers()[w.parent];
    if (!pc) return null;
    const stats = await pc.getStats();
    let found: RTCInboundRtpStreamStats | null = null;
    stats.forEach((r) => {
      if (r.type === "inbound-rtp" && r.kind === "video" && (!found || (r.bytesReceived ?? 0) > (found.bytesReceived ?? 0))) found = r;
    });
    const r = found as RTCInboundRtpStreamStats | null;
    if (!r) return null;
    const prev = this.lastInbound;
    const bytes = r.bytesReceived ?? 0;
    const kbps = prev && r.timestamp > prev.ts ? Math.round(((bytes - prev.bytes) * 8) / (r.timestamp - prev.ts)) : 0;
    this.lastInbound = { bytes, ts: r.timestamp };
    const codec = (r.codecId && stats.get(r.codecId)?.mimeType?.replace("video/", "")) || "?";
    const lost = r.packetsLost ?? 0;
    const recv = r.packetsReceived ?? 0;
    const loss = lost + recv ? (100 * lost) / (lost + recv) : 0;
    return { res: `${r.frameWidth ?? 0}x${r.frameHeight ?? 0}`, fps: Math.round(r.framesPerSecond ?? 0), kbps, codec, loss: Math.round(loss * 10) / 10 };
  }

  // ------------------------------------------------------------------ live: assistindo / retransmitindo

  async watch(origin: string, failed?: string, attempt = 0): Promise<void> {
    if (origin === selfId) return;
    if (!failed) {
      if (this.watching?.origin === origin && this.watching.status !== "failed") return;
      if (this.watching) this.stopWatching(true);
    }
    this.watching = { origin, parent: null, stream: this.received.get(origin) ?? null, status: "connecting" };
    this.lastInbound = null;
    this.ctx.emit();

    try {
      const res = (await this.act.watch.request({ failed }, { target: origin, timeoutMs: 15000 })) as WatchReply;
      if (this.watching?.origin !== origin) return;
      if ("redirect" in res) {
        const relay = res.redirect;
        const ok = (await this.act.relay.request({ origin }, { target: relay, timeoutMs: 10000 }).catch(() => ({ ok: false }))) as { ok: boolean };
        if (this.watching?.origin !== origin) return;
        if (!ok.ok) {
          if (attempt < 4) return this.watch(origin, relay, attempt + 1);
          throw new Error("Nenhum retransmissor respondeu.");
        }
        this.watching.parent = relay;
      } else if (res.ok) {
        this.watching.parent = origin;
      } else {
        throw new Error(res.reason);
      }
      if (this.watching.stream) this.watching.status = "playing";
    } catch (e) {
      if (this.watching?.origin === origin) {
        this.watching.status = "failed";
        this.watching.error = e instanceof Error ? e.message : String(e);
      }
    }
    this.ctx.emit();
  }

  private rewatch() {
    if (!this.watching) return;
    const origin = this.watching.origin;
    this.watching.parent = null;
    this.watching.status = "connecting";
    this.watch(origin, "__retry__");
  }

  stopWatching(notify = true) {
    const w = this.watching;
    if (!w) return;
    this.watching = null;
    if (notify) {
      const targets = [...new Set([w.origin, w.parent].filter((x): x is string => !!x && !!this.peers[x]))];
      if (targets.length) this.act.leaveTree.send(null, { target: targets });
      const kids = this.relayChildren.get(w.origin);
      const s = this.received.get(w.origin);
      if (kids?.size) {
        this.act.reparent.send({ origin: w.origin }, { target: [...kids] });
        if (s) this.room.removeStream(s, { target: [...kids] });
      }
    }
    this.relayChildren.delete(w.origin);
    this.received.delete(w.origin);
    this.ctx.emit();
  }

  private handleRelay(viewer: string, origin: string): { ok: boolean } {
    const slots = this.ctx.profile().relaySlots;
    const stream = this.received.get(origin);
    const kids = this.relayChildren.get(origin) ?? new Set<string>();
    if (!stream || this.watching?.origin !== origin || kids.size >= slots) return { ok: false };
    kids.add(viewer);
    this.relayChildren.set(origin, kids);
    const meta: MediaMeta = { kind: "live", origin };
    Promise.all(this.room.addStream(stream, { target: viewer, metadata: meta }))
      .then(() => this.applyBitrate(viewer))
      .catch(console.warn);
    this.ctx.emit();
    return { ok: true };
  }

  private onPeerStream(stream: MediaStream, peerId: string, meta?: MediaMeta) {
    if (meta?.kind === "voice") {
      if (!this.inVoice) return;
      this.voicePeers.add(peerId);
      this.ctx.onVoiceStream(this, peerId, this.peers[peerId]?.pub ?? "", stream);
      this.ctx.emit();
      return;
    }
    if (meta?.kind === "live" && meta.origin) {
      const origin = meta.origin;
      if (this.watching?.origin !== origin) return;
      const old = this.received.get(origin);
      this.received.set(origin, stream);
      this.watching.stream = stream;
      this.watching.status = "playing";
      const kids = this.relayChildren.get(origin);
      if (kids?.size) {
        const targets = [...kids];
        if (old && old !== stream) this.room.removeStream(old, { target: targets });
        Promise.all(this.room.addStream(stream, { target: targets, metadata: meta }))
          .then(() => targets.forEach((t) => this.applyBitrate(t)))
          .catch(console.warn);
      }
      this.ctx.emit();
    }
  }

  get relayingCount() {
    let n = 0;
    for (const s of this.relayChildren.values()) n += s.size;
    return n;
  }

  // ------------------------------------------------------------------ voz

  /** Entra na voz usando a stream processada do motor de áudio. */
  joinVoice(mic: MediaStream) {
    this.micStream = mic;
    this.inVoice = true;
    for (const [id, p] of Object.entries(this.peers)) if (p.inVoice) this.sendMic(id);
    this.broadcastState({ inVoice: true, muted: this.ctx.muted(), deaf: this.ctx.deaf() });
    this.ctx.emit();
  }

  private sendMic(peerId: string) {
    if (!this.micStream) return;
    const meta: MediaMeta = { kind: "voice" };
    Promise.all(this.room.addStream(this.micStream, { target: peerId, metadata: meta })).catch(console.warn);
  }

  leaveVoice() {
    if (!this.inVoice) return;
    if (this.micStream) this.room.removeStream(this.micStream);
    this.micStream = null;
    this.inVoice = false;
    for (const id of this.voicePeers) this.ctx.onVoiceStream(this, id, this.peers[id]?.pub ?? "", null);
    this.voicePeers.clear();
    this.broadcastState({ inVoice: false });
    this.ctx.emit();
  }

  announceProfile() {
    this.broadcastState({ profile: this.ctx.profile() });
  }

  async leave() {
    clearInterval(this.statsTimer);
    clearInterval(this.resyncTimer);
    this.stopLive();
    this.stopWatching(true);
    this.leaveVoice();
    await this.room.leave();
  }
}

const cleanChannel = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}_-]/gu, "")
    .slice(0, 40);

function stripLocal(e: StoredEvent): SignedEvent {
  return { id: e.id, a: e.a, ts: e.ts, b: e.b, s: e.s };
}
