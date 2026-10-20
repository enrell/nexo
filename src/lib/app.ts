import { useSyncExternalStore } from "react";
import { AudioEngine } from "./audio";
import { db } from "./db";
import { Identity, openBackup } from "./identity";
import { initCertificate, mediaErrorMessage, testOverrideFingerprint } from "./rtc";
import { Session } from "./session";
import { decodeInvite, defaultSettings, flushSecureStore, initSecureStore, randomId, storage } from "./storage";
import { applyTheme } from "./theme";
import { initVault } from "./vault";
import type { MsgView, Profile, ServerInfo, Settings, Status } from "./types";

export type View = { type: "chat" } | { type: "live"; origin: string };
/** O que a coluna da direita (painel contextual) está mostrando. */
export type CtxView = "home" | "members" | "profile" | "search" | "theme" | "notifications";
type CtxState = { view: CtxView; arg?: string };

export const COLORS = ["#5865f2", "#eb459e", "#57f287", "#fee75c", "#ed4245", "#f47b67", "#3ba55c", "#9b59b6", "#1abc9c", "#e67e22"];
export const randomColor = () => COLORS[Math.floor(Math.random() * COLORS.length)];

class App {
  ready = false;
  /** erro irrecuperável na abertura (ex.: cofre de chaves ilegível) */
  fatal: string | null = null;
  identity!: Identity;
  profile: Profile | null = null;
  settings: Settings = { ...defaultSettings };
  servers: ServerInfo[] = [];
  sessions = new Map<string, Session>();
  activeRoom: string | null = null;
  activeChannel: Record<string, string> = {};
  view: View = { type: "chat" };
  theater = false;
  ctx: CtxState = { view: "home" };
  private ctxStack: CtxState[] = [];
  /** texto da busca global (topo à direita) e item selecionado nos resultados */
  search = "";
  searchSel = 0;
  unread: Record<string, number> = {};
  mentions: Record<string, number> = {};
  /** última mensagem lida por canal (para o divisor "novas mensagens") */
  lastRead: Record<string, number> = {};
  muted = false;
  deafened = false;
  autoIdle = false;
  toast: { text: string; kind: "info" | "error" } | null = null;
  pendingInvite: string | null = null;
  update: { status: string; version?: string } | null = null;
  audio: AudioEngine;

  private version = 0;
  private listeners = new Set<() => void>();
  private toastTimer: number | undefined;
  private emitQueued = false;

  constructor() {
    this.audio = new AudioEngine(() => this.settings);
    this.audio.onChange = () => this.emit();
    this.init();
  }

  private async init() {
    try {
      // 1) chave do cofre (protegida pelo Windows) → 2) dados locais decifrados → 3) identidade → 4) certificado DTLS
      await initVault();
      await initSecureStore();
      this.settings = storage.loadSettings();
      this.servers = storage.loadServers();
      this.activeChannel = storage.get<Record<string, string>>("activeChannel", {});
      this.lastRead = storage.get<Record<string, number>>("lastRead", {});
      this.audio.loadPrefs();
      this.identity = await Identity.load();
      await initCertificate();
    } catch (e) {
      console.error(e);
      this.fatal = e instanceof Error ? e.message : String(e);
      this.ready = true;
      this.emit();
      return;
    }
    const p = storage.loadProfile();
    if (p) {
      this.profile = { ...p, userId: this.identity.pub, status: p.status ?? "online", relaySlots: p.relaySlots ?? 2 };
      storage.saveProfile(this.profile);
      this.connectAll();
    }
    this.activeRoom = this.servers[0]?.roomId ?? null;
    this.applyAppearance();
    this.bindNative();
    this.bindKeyboard();
    this.ready = true;
    this.emit();
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getVersion = () => this.version;
  /** Agrupa várias mudanças seguidas num único re-render. */
  emit = () => {
    if (this.emitQueued) return;
    this.emitQueued = true;
    queueMicrotask(() => {
      this.emitQueued = false;
      this.version++;
      this.listeners.forEach((l) => l());
    });
  };

  showToast(text: string, kind: "info" | "error" = "info") {
    this.toast = { text, kind };
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toast = null;
      this.emit();
    }, kind === "error" ? 6000 : 3500);
    this.emit();
  }

  // ---------------------------------------------------------------- integração com o Electron

  private bindNative() {
    const n = window.nexo;
    if (!n) return;
    n.onShortcut((name, down) => {
      if (name === "ptt") this.audio.setPtt(down);
      if (name === "mute" && down) this.toggleMute();
      if (name === "deafen" && down) this.toggleDeafen();
    });
    n.onOpenUrl((url) => this.handleInviteUrl(url));
    n.getPendingUrl().then((url) => url && this.handleInviteUrl(url));
    n.onUpdate((u) => {
      this.update = u;
      if (u.status === "ready") this.showToast(`Versão ${u.version} baixada — reinicie para atualizar.`);
      this.emit();
    });
    n.onTray((action) => {
      if (action === "mute") this.toggleMute();
      if (action === "deafen") this.toggleDeafen();
    });
    this.syncNative();
    // ausente automático depois de 10 minutos sem mexer no PC
    window.setInterval(async () => {
      if (!this.profile) return;
      const idle = await n.getIdleSeconds();
      const shouldIdle = idle > 600 && this.profile.status === "online";
      if (shouldIdle !== this.autoIdle) {
        this.autoIdle = shouldIdle;
        this.sessions.forEach((s) => s.announceProfile());
        this.emit();
      }
    }, 30_000);
  }

  private syncNative() {
    const n = window.nexo;
    if (!n) return;
    const s = this.settings;
    n.setConfig({
      closeToTray: s.closeToTray,
      launchAtLogin: s.launchAtLogin,
      keyMute: s.keyMute,
      keyDeafen: s.keyDeafen,
      pttKey: s.vadMode === "ptt" ? s.pttKey : "",
      zoom: s.zoom / 100,
    });
  }

  private bindKeyboard() {
    // push-to-talk com a janela em foco (o atalho global cobre quando está em segundo plano)
    const isPtt = (e: KeyboardEvent) => this.settings.vadMode === "ptt" && e.code === this.settings.pttKey;
    window.addEventListener("keydown", (e) => {
      if (isPtt(e) && !isTyping(e)) this.audio.setPtt(true);
    });
    window.addEventListener("keyup", (e) => {
      if (isPtt(e)) this.audio.setPtt(false);
    });
    window.addEventListener("blur", () => !window.nexo && this.audio.setPtt(false));
    window.addEventListener("focus", () => this.updateBadge());
  }

  private handleInviteUrl(url: string) {
    if (!decodeInvite(url)) return;
    if (!this.profile) {
      this.pendingInvite = url;
      return;
    }
    const err = this.joinByInvite(url);
    if (err) this.showToast(err, "error");
  }

  applyAppearance() {
    const s = this.settings;
    applyTheme(s).catch((e) => console.warn("tema", e));
    if (!window.nexo) document.documentElement.style.zoom = String(s.zoom / 100);
  }

  // ---------------------------------------------------------------- sessões

  private connectAll() {
    for (const s of this.servers) this.connect(s);
  }

  private connect(server: ServerInfo) {
    if (this.sessions.has(server.sid)) return;
    const session = new Session(server, {
      identity: this.identity,
      profile: () => this.effectiveProfile(),
      settings: () => this.settings,
      muted: () => this.muted,
      deaf: () => this.deafened,
      emit: this.emit,
      saveServers: () => storage.saveServers(this.servers),
      onNewMessage: (s, m) => this.onNewMessage(s, m),
      onVoiceStream: (s, peerId, pub, stream) => {
        const key = s.server.sid + ":" + peerId;
        if (stream) this.audio.addRemote(key, pub, stream);
        else this.audio.removeRemote(key);
      },
      onPeerEvent: (_s, kind) => {
        if (kind === "voice-join") this.audio.play("join");
        if (kind === "voice-leave") this.audio.play("leave");
      },
      onMove: (s, roomId, password) => this.moveServer(s, roomId, password),
    });
    this.sessions.set(server.sid, session);
  }

  /** Perfil enviado aos outros (aplica o "ausente" automático). */
  effectiveProfile(): Profile {
    const p = this.profile!;
    return this.autoIdle && p.status === "online" ? { ...p, status: "idle" } : p;
  }

  private async moveServer(s: Session, roomId: string, password: string) {
    const srv = s.server;
    if (srv.roomId === roomId) return;
    const wasVoice = s.inVoice;
    const wasActive = this.activeRoom === srv.roomId;
    this.sessions.delete(srv.sid);
    await s.leave();
    srv.roomId = roomId;
    srv.password = password;
    storage.saveServers(this.servers);
    this.connect(srv);
    if (wasActive) this.activeRoom = roomId;
    if (wasVoice) this.joinVoice(this.sessions.get(srv.sid)!);
    this.showToast(`O convite de "${srv.name}" foi renovado.`);
    this.emit();
  }

  get session(): Session | null {
    const srv = this.servers.find((s) => s.roomId === this.activeRoom);
    return srv ? (this.sessions.get(srv.sid) ?? null) : null;
  }

  sessionBySid(sid: string) {
    return this.sessions.get(sid) ?? null;
  }

  channelOf(s: Session) {
    const ch = this.activeChannel[s.server.sid];
    const chans = s.state.channels;
    return chans.some((c) => c.id === ch) ? ch : (chans[0]?.id ?? "geral");
  }

  private onNewMessage(s: Session, m: MsgView) {
    if (m.author === this.identity.pub) return;
    s.clearTyping(m.author, m.ch);
    const key = s.server.sid + ":" + m.ch;
    const visible = this.session === s && this.channelOf(s) === m.ch && document.hasFocus() && (this.view.type === "chat" || this.view.type === "live");
    const mention = this.isMention(m.text);
    if (visible) {
      this.markRead(s, m.ch);
      return;
    }
    const st = this.settings;
    const silenced = st.mutedServers.includes(s.server.sid) || st.mutedChannels.includes(key);
    if (!silenced || mention) this.unread[key] = (this.unread[key] ?? 0) + 1;
    if (mention) this.mentions[key] = (this.mentions[key] ?? 0) + 1;
    this.updateBadge();

    const dnd = this.profile?.status === "dnd";
    const wants = !dnd && (mention || (!silenced && st.notifyMode === "all"));
    if (!wants || st.notifyMode === "none") return;
    if (st.notifySounds) this.audio.play(mention ? "mention" : "message");
    if (st.notifyDesktop && !document.hasFocus()) {
      const author = s.profileOf(m.author).name;
      const chName = s.state.channels.find((c) => c.id === m.ch)?.name ?? m.ch;
      // por padrão a notificação não mostra o conteúdo (ela aparece na tela e fica no histórico do Windows)
      const body = !st.notifyPreview ? (mention ? "Mencionou você" : "Nova mensagem") : m.text || (m.att?.length ? `📎 ${m.att.length} anexo(s)` : "");
      try {
        const n = new Notification(st.notifyPreview ? `${author} (#${chName}, ${s.name})` : `${author} · ${s.name}`, { body: body.slice(0, 200), silent: true, icon: s.profileOf(m.author).avatar });
        n.onclick = () => {
          window.nexo?.focus();
          this.selectServer(s.server.roomId);
          this.selectChannel(m.ch);
        };
      } catch {
        /* sem notificações */
      }
    }
  }

  isMention(text: string) {
    const name = this.profile?.name;
    if (!name) return false;
    const t = text.toLowerCase();
    const token = "@" + name.toLowerCase().replace(/\s+/g, "_");
    return t.includes(token) || t.includes("@" + name.toLowerCase()) || /@(todos|everyone|here|aqui)(?![\p{L}\p{N}_])/u.test(t);
  }

  private updateBadge() {
    const total = Object.values(this.unread).reduce((a, b) => a + b, 0);
    const mentions = Object.values(this.mentions).reduce((a, b) => a + b, 0);
    const count = mentions > 0 ? mentions : total > 0 ? -1 : 0;
    window.nexo?.setBadge(count, count ? badgeImage(count) : undefined);
  }

  // ---------------------------------------------------------------- perfil e configurações

  setProfile(p: Omit<Profile, "userId"> & { userId?: string }) {
    const first = !this.profile;
    this.profile = { ...p, userId: this.identity.pub };
    storage.saveProfile(this.profile);
    if (first) {
      this.connectAll();
      if (this.pendingInvite) {
        const url = this.pendingInvite;
        this.pendingInvite = null;
        this.handleInviteUrl(url);
      }
    } else this.sessions.forEach((s) => s.announceProfile());
    this.emit();
  }

  setStatus(status: Status) {
    if (!this.profile) return;
    this.setProfile({ ...this.profile, status });
  }

  setSettings(s: Settings) {
    const prev = this.settings;
    this.settings = s;
    storage.saveSettings(s);
    this.audio.applySettings();
    this.applyAppearance();
    this.syncNative();
    const micChanged = prev.inputDevice !== s.inputDevice || prev.noiseSuppression !== s.noiseSuppression || prev.echoCancellation !== s.echoCancellation || prev.autoGain !== s.autoGain;
    if (micChanged && this.audio.micStream) this.audio.restartMic().catch((e) => this.showToast(mediaErrorMessage(e, "microfone"), "error"));
    this.emit();
  }

  // ---------------------------------------------------------------- navegação

  selectServer(roomId: string) {
    if (this.activeRoom !== roomId) this.ctxHome(false);
    this.activeRoom = roomId;
    const s = this.session;
    this.view = s?.watching ? { type: "live", origin: s.watching.origin } : { type: "chat" };
    if (s) this.markRead(s, this.channelOf(s));
    this.emit();
  }

  selectChannel(channelId: string) {
    const s = this.session;
    if (!s) return;
    this.activeChannel[s.server.sid] = channelId;
    storage.set("activeChannel", this.activeChannel);
    if (this.view.type !== "live") this.view = { type: "chat" };
    this.markRead(s, channelId);
    this.emit();
  }

  markRead(s: Session, ch: string) {
    const key = s.server.sid + ":" + ch;
    delete this.unread[key];
    delete this.mentions[key];
    this.lastRead[key] = Date.now();
    storage.set("lastRead", this.lastRead);
    this.updateBadge();
  }

  unreadFor(sid: string) {
    let n = 0;
    for (const [k, v] of Object.entries(this.unread)) if (k.startsWith(sid + ":")) n += v;
    return n;
  }
  mentionsFor(sid: string) {
    let n = 0;
    for (const [k, v] of Object.entries(this.mentions)) if (k.startsWith(sid + ":")) n += v;
    return n;
  }

  openLive(origin: string) {
    this.view = { type: "live", origin };
    this.emit();
  }
  closeLive() {
    this.session?.stopWatching();
    this.view = { type: "chat" };
    this.theater = false;
    this.emit();
  }
  /** Planeta "Início": sai dos servidores (amigos e diretas). */
  goHome() {
    this.activeRoom = null;
    this.view = { type: "chat" };
    this.ctxHome(false);
    this.emit();
  }

  // ---------------------------------------------------------------- painel contextual (direita)

  openCtx(view: CtxView, arg?: string) {
    if (this.ctx.view === view && this.ctx.arg === arg) return;
    if (view === "home") return this.ctxHome();
    this.ctxStack.push(this.ctx);
    if (this.ctxStack.length > 20) this.ctxStack.shift();
    this.ctx = { view, arg };
    if (this.settings.ctxCollapsed) this.setSettings({ ...this.settings, ctxCollapsed: false });
    this.emit();
  }
  ctxBack() {
    this.ctx = this.ctxStack.pop() ?? { view: "home" };
    if (this.ctx.view !== "search") this.search = "";
    this.emit();
  }
  ctxHome(emit = true) {
    this.ctxStack = [];
    this.ctx = { view: "home" };
    this.search = "";
    if (emit) this.emit();
  }
  toggleCtx() {
    this.setSettings({ ...this.settings, ctxCollapsed: !this.settings.ctxCollapsed });
  }
  setSearch(q: string) {
    this.search = q;
    if (this.ctx.view !== "search") this.openCtx("search");
    else this.emit();
  }
  toggleMembers() {
    if (this.ctx.view === "members") this.ctxBack();
    else this.openCtx("members");
  }
  toggleTheater() {
    this.theater = !this.theater;
    this.emit();
  }

  // ---------------------------------------------------------------- servidores

  createServer(name: string) {
    const roomId = randomId(20);
    const server: ServerInfo = {
      sid: roomId,
      roomId,
      password: randomId(24),
      owner: this.identity.pub,
      name: name.trim() || "Meu servidor",
      channels: [
        { id: "geral", name: "geral" },
        { id: "clips", name: "clips-e-links" },
      ],
      joinedAt: Date.now(),
    };
    this.addServer(server);
    const s = this.sessions.get(server.sid)!;
    // registra nome e canais como eventos assinados (fonte da verdade para todos).
    // Seguro por padrão: novos membros precisam de aprovação de um admin.
    s.publish({ k: "policy", approval: true });
    s.publish({ k: "name", name: server.name });
    for (const c of server.channels) s.publish({ k: "chan", id: c.id, name: c.name });
    return server;
  }

  joinByInvite(code: string): string | null {
    const inv = decodeInvite(code);
    if (!inv) return "Código de convite inválido.";
    const existing = this.servers.find((s) => s.sid === inv.sid);
    if (existing) {
      if (existing.roomId !== inv.roomId) {
        const s = this.sessions.get(existing.sid);
        if (s) this.moveServer(s, inv.roomId, inv.password);
      }
      this.selectServer(inv.roomId);
      return null;
    }
    this.addServer({
      sid: inv.sid,
      roomId: inv.roomId,
      password: inv.password,
      owner: inv.owner,
      name: inv.name,
      channels: [{ id: "geral", name: "geral" }],
      joinedAt: Date.now(),
    });
    return null;
  }

  private addServer(server: ServerInfo) {
    this.servers.push(server);
    storage.saveServers(this.servers);
    this.connect(server);
    this.selectServer(server.roomId);
  }

  async leaveServer(sid: string) {
    const s = this.sessions.get(sid);
    const srv = this.servers.find((x) => x.sid === sid);
    this.sessions.delete(sid);
    this.servers = this.servers.filter((x) => x.sid !== sid);
    storage.saveServers(this.servers);
    if (srv) storage.removeLegacyMessages(srv.roomId);
    if (s?.inVoice) this.leaveVoice();
    if (this.activeRoom === srv?.roomId) this.activeRoom = this.servers[0]?.roomId ?? null;
    this.view = { type: "chat" };
    this.emit();
    await s?.leave();
    await db.deleteServer(sid);
  }

  moveServerOrder(sid: string, delta: number) {
    const i = this.servers.findIndex((s) => s.sid === sid);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= this.servers.length) return;
    [this.servers[i], this.servers[j]] = [this.servers[j], this.servers[i]];
    storage.saveServers(this.servers);
    this.emit();
  }

  // ---------------------------------------------------------------- voz

  get voiceSession(): Session | null {
    for (const s of this.sessions.values()) if (s.inVoice) return s;
    return null;
  }

  async joinVoice(s: Session) {
    if (s.inVoice) return;
    const current = this.voiceSession;
    if (current) this.leaveVoice();
    try {
      const mic = await this.audio.startMic();
      this.audio.muted = this.muted;
      s.joinVoice(mic);
      this.audio.play("join");
    } catch (e) {
      this.showToast(mediaErrorMessage(e, "microfone"), "error");
    }
  }

  leaveVoice() {
    const s = this.voiceSession;
    if (!s) return;
    s.leaveVoice();
    this.audio.stopMic();
    this.audio.clearRemotes();
    this.audio.play("leave");
    this.emit();
  }

  toggleMute() {
    // desmutar enquanto surdo também tira o surdo (igual ao Discord)
    if (this.muted && this.deafened) this.setDeafened(false);
    this.setMuted(!this.muted);
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.audio.muted = m;
    this.audio.play(m ? "mute" : "unmute");
    this.sessions.forEach((s) => s.inVoice && s.broadcastState({ muted: m }));
    this.emit();
  }

  toggleDeafen() {
    this.setDeafened(!this.deafened);
  }

  setDeafened(d: boolean) {
    this.deafened = d;
    if (!d) this.audio.setDeafened(false);
    this.audio.play(d ? "mute" : "unmute");
    if (d) this.audio.setDeafened(true);
    this.sessions.forEach((s) => s.inVoice && s.broadcastState({ deaf: d }));
    this.emit();
  }

  isSpeaking(pub: string) {
    if (pub === this.identity?.pub) return this.audio.localSpeaking;
    return this.audio.speaking.has(pub);
  }
}

/** Ícone sobreposto na barra de tarefas: número de menções, ou um ponto se só houver não lidas. */
function badgeImage(count: number) {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d")!;
  g.fillStyle = "#f23f43";
  g.beginPath();
  g.arc(16, 16, count > 0 ? 15 : 9, 0, Math.PI * 2);
  g.fill();
  if (count > 0) {
    g.fillStyle = "#fff";
    g.font = "bold 20px Segoe UI, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(count > 9 ? "9+" : String(count), 16, 17);
  }
  return c.toDataURL();
}

export function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
}

export const app = new App();
// gancho para testes automatizados/depuração — só existe fora do app instalado
if (window.nexo?.debug || import.meta.env.DEV) Object.assign(window, { __nexo: app, __nexoLib: { openBackup, testOverrideFingerprint } });

/** Apaga todos os dados locais e recomeça (usado quando o cofre não abre). */
export async function resetLocalData() {
  await flushSecureStore();
  if (window.nexo) await window.nexo.resetVault();
  else {
    localStorage.clear();
    location.reload();
  }
}

/** Re-renderiza o componente sempre que algo no app mudar. */
export function useApp() {
  useSyncExternalStore(app.subscribe, app.getVersion);
  return app;
}

export { randomId };
