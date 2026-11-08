/**
 * Quem recebe a chave de mídia (SFrame) numa sessão de verdade: o Trystero é trocado por uma sala
 * falsa, mas o handshake (Ed25519 + channel binding), as regras de membro/aprovação/ban e as
 * mensagens são os do app.
 */
import "fake-indexeddb/auto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../../src/lib/db";
import type { MediaE2ee } from "../../src/lib/e2ee";
import type { Identity } from "../../src/lib/identity";
import { testOverrideFingerprint } from "../../src/lib/rtc";
import { Session, type SessionCtx } from "../../src/lib/session";
import { defaultSettings } from "../../src/lib/storage";
import type { EventBody, Profile, ServerInfo } from "../../src/lib/types";
import { newIdentity, signEvent } from "./helpers";

type Action = { send: ReturnType<typeof vi.fn>; request: ReturnType<typeof vi.fn>; onMessage?: (data: unknown, ctx: { peerId: string }) => void };
type HandshakeFn = (peerId: string, send: (d: unknown) => Promise<void>, receive: () => Promise<{ data: unknown }>) => Promise<void>;

const fake = vi.hoisted(() => {
  class FakeRoom {
    actions: Record<string, Action> = {};
    peers: Record<string, unknown> = {};
    onPeerJoin?: (id: string) => void;
    onPeerLeave?: (id: string) => void;
    onPeerStream?: unknown;
    constructor(public handshake: HandshakeFn) {}
    makeAction(name: string) {
      const a = { send: vi.fn(), request: vi.fn() } as Action;
      this.actions[name] = a;
      return a;
    }
    getPeers() {
      return this.peers;
    }
    ping = async () => 1;
    addStream = () => [];
    removeStream() {}
    replaceTrack = () => [];
    leave = async () => {};
  }
  return { FakeRoom, rooms: [] as InstanceType<typeof FakeRoom>[] };
});

vi.mock("trystero", () => ({
  selfId: "eu",
  joinRoom: (_cfg: unknown, _room: string, cb: { onPeerHandshake: HandshakeFn }) => {
    const r = new fake.FakeRoom(cb.onPeerHandshake);
    fake.rooms.push(r);
    return r;
  },
}));

// o app estende RTCPeerConnection; no Node ela não existe
(globalThis as Record<string, unknown>).RTCPeerConnection ??= class {};

const MY_FP = "CD".repeat(32);
const colon = (fp: string) => fp.match(/../g)!.join(":");

let me: Identity;
beforeAll(async () => {
  testOverrideFingerprint(MY_FP);
  me = await newIdentity();
});

const sessions: Session[] = [];
afterEach(async () => {
  for (const s of sessions.splice(0)) await s.leave();
  fake.rooms.length = 0;
});

function fakeE2ee() {
  const e = {
    kid: 7,
    hooks: { sender: () => {}, receiver: () => {} },
    offer: vi.fn(() => ({ v: 1, kid: e.kid, key: "A".repeat(22) })),
    accept: vi.fn(),
    forget: vi.fn(),
    rotate: vi.fn(() => {
      e.kid++;
      for (const s of sessions) s.offerMediaKeys(); // o que o app faz em onRotate
    }),
  };
  return e;
}

let srvN = 0;
async function open(opts: { owner: string; events?: [Identity, EventBody][]; e2ee?: ReturnType<typeof fakeE2ee> | null }) {
  const server: ServerInfo = { sid: `srv${++srvN}`, roomId: `sala${srvN}`, password: "senha", owner: opts.owner, name: "S", channels: [], joinedAt: 0 };
  let ts = 1000;
  for (const [who, b] of opts.events ?? []) await db.putEvents([{ ...(await signEvent(who, ts++, b)), srv: server.sid }]);
  const profile: Profile = { userId: me.pub, name: "Eu", color: "#fff", status: "online", relaySlots: 0 };
  const ctx: SessionCtx = {
    identity: me,
    profile: () => profile,
    settings: () => defaultSettings,
    muted: () => false,
    deaf: () => false,
    emit: () => {},
    onNewMessage: () => {},
    onVoiceStream: () => {},
    onPeerEvent: () => {},
    onMove: () => {},
    saveServers: () => {},
    extraIce: () => [],
    turnToShare: () => null,
    onSharedTurn: () => {},
    e2ee: (opts.e2ee ?? null) as MediaE2ee | null,
  };
  const s = new Session(server, ctx);
  sessions.push(s);
  await vi.waitFor(() => expect(s.loaded).toBe(true));
  return { s, room: fake.rooms.at(-1)!, server };
}

/** Handshake de verdade com a identidade do amigo, conexão aceita, hello recebido. */
async function connect(room: InstanceType<typeof fake.FakeRoom>, sid: string, peerId: string, who: Identity, opts: { sf?: boolean } = {}) {
  const fp = (peerId.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")).repeat(32);
  const sent: { nonce?: string; fp?: string }[] = [];
  let n = 0;
  await room.handshake(
    peerId,
    async (d) => void sent.push(d as { nonce?: string }),
    async () => {
      if (n++ === 0) return { data: { pub: who.pub, nonce: "x".repeat(32), v: 3, fp } };
      return { data: { sig: await who.sign(`nexo-hs:v3:${sid}:${sent[0].nonce}:${fp}:${sent[0].fp}`) } };
    },
  );
  room.peers[peerId] = { remoteDescription: { sdp: `a=fingerprint:sha-256 ${colon(fp)}\r\n` }, close: vi.fn() };
  room.onPeerJoin!(peerId);
  const profile: Profile = { userId: who.pub, name: peerId, color: "#fff", status: "online", relaySlots: 0 };
  room.actions.hello.onMessage!({ profile, live: null, inVoice: false, muted: false, deaf: false, ...(opts.sf ? { sf: 1 } : {}) }, { peerId });
}

const offersTo = (room: InstanceType<typeof fake.FakeRoom>) => room.actions.mkey.send.mock.calls.map(([offer, o]) => ({ kid: (offer as { kid: number }).kid, to: (o as { target: string }).target }));

describe("Sessão: quem recebe a chave de mídia", () => {
  it("anuncia SFrame no hello só com o recurso ligado", async () => {
    const off = await open({ owner: me.pub });
    const on = await open({ owner: me.pub, e2ee: fakeE2ee() });
    const bob = await newIdentity();
    await connect(off.room, off.server.sid, "bob", bob, { sf: true });
    await connect(on.room, on.server.sid, "bob", bob, { sf: true });
    expect(off.room.actions.hello.send.mock.calls[0][0]).not.toHaveProperty("sf");
    expect(on.room.actions.hello.send.mock.calls[0][0]).toMatchObject({ sf: 1 });
    expect(off.room.actions.mkey.send).not.toHaveBeenCalled();
  });

  it("membro que anunciou SFrame recebe a minha chave uma vez; quem não anunciou, não", async () => {
    const e = fakeE2ee();
    const { room, server } = await open({ owner: me.pub, e2ee: e });
    await connect(room, server.sid, "bob", await newIdentity(), { sf: true });
    await connect(room, server.sid, "dani", await newIdentity(), { sf: false });
    room.actions.hello.onMessage!({ profile: { userId: "", name: "bob", color: "#fff", status: "online", relaySlots: 0 }, live: null, inVoice: true, muted: false, deaf: false, sf: 1 }, { peerId: "bob" });
    expect(offersTo(room)).toEqual([{ kid: 7, to: "bob" }]);
  });

  it("com aprovação ligada, pendente não recebe chave nem tem a dele aceita; ao ser aprovado, recebe", async () => {
    const e = fakeE2ee();
    const carol = await newIdentity();
    const { s, room, server } = await open({ owner: me.pub, e2ee: e, events: [[me, { k: "policy", approval: true }]] });
    await connect(room, server.sid, "carol", carol, { sf: true });
    expect(room.actions.mkey.send).not.toHaveBeenCalled();
    room.actions.mkey.onMessage!({ v: 1, kid: 1, key: "B".repeat(22) }, { peerId: "carol" });
    expect(e.accept).not.toHaveBeenCalled();

    await s.admit(carol.pub, true);
    expect(offersTo(room)).toEqual([{ kid: 7, to: "carol" }]);
    const offer = { v: 1, kid: 1, key: "B".repeat(22) };
    room.actions.mkey.onMessage!(offer, { peerId: "carol" });
    expect(e.accept).toHaveBeenCalledWith(carol.pub, offer);
  });

  it("enquanto eu mesmo estou na porta, não mando nem aceito chave (nem do dono)", async () => {
    const e = fakeE2ee();
    const owner = await newIdentity();
    const { room, server } = await open({ owner: owner.pub, e2ee: e, events: [[owner, { k: "policy", approval: true }]] });
    await connect(room, server.sid, "dono", owner, { sf: true });
    room.actions.mkey.onMessage!({ v: 1, kid: 1, key: "B".repeat(22) }, { peerId: "dono" });
    expect(room.actions.mkey.send).not.toHaveBeenCalled();
    expect(e.accept).not.toHaveBeenCalled();
  });

  it("de quem não anunciou SFrame, a chave é ignorada", async () => {
    const e = fakeE2ee();
    const { room, server } = await open({ owner: me.pub, e2ee: e });
    await connect(room, server.sid, "dani", await newIdentity(), { sf: false });
    room.actions.mkey.onMessage!({ v: 1, kid: 1, key: "B".repeat(22) }, { peerId: "dani" });
    expect(e.accept).not.toHaveBeenCalled();
  });

  it("banir esquece a chave do banido e troca a minha, que vai de novo para quem ficou", async () => {
    const e = fakeE2ee();
    const bob = await newIdentity();
    const eva = await newIdentity();
    const { s, room, server } = await open({ owner: me.pub, e2ee: e });
    await connect(room, server.sid, "bob", bob, { sf: true });
    await connect(room, server.sid, "eva", eva, { sf: true });
    room.actions.mkey.onMessage!({ v: 1, kid: 1, key: "B".repeat(22) }, { peerId: "bob" });
    expect(e.accept).toHaveBeenCalledWith(bob.pub, expect.anything());

    await s.ban(bob.pub, true);
    expect(e.forget).toHaveBeenCalledWith(bob.pub);
    expect(e.rotate).toHaveBeenCalledTimes(1);
    expect(offersTo(room)).toEqual([
      { kid: 7, to: "bob" },
      { kid: 7, to: "eva" },
      { kid: 8, to: "eva" },
    ]);
  });

  it("acha o peer de uma conexão (para o transform saber de quem é a chave)", async () => {
    const { s, room, server } = await open({ owner: me.pub, e2ee: fakeE2ee() });
    const bob = await newIdentity();
    await connect(room, server.sid, "bob", bob, { sf: true });
    expect(s.peerByConnection(room.peers.bob as RTCPeerConnection)).toEqual({ pub: bob.pub, sf: true });
    expect(s.peerByConnection({} as RTCPeerConnection)).toBeNull();
  });
});
