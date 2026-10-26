import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { sanitizeSharedTurn } from "../../src/lib/turn";

type Res = { status: number; body: string } | null;
const cf = createRequire(import.meta.url)("../../electron/cfturn.cjs") as {
  generate: (keyId: unknown, token: unknown, request?: (path: string, token: string, body: string) => Promise<Res>) => Promise<{ ok: boolean; iceServers?: RTCIceServer[]; ttl?: number; error?: string }>;
  parseIceServers: (body: string) => RTCIceServer[] | null;
  post: (path: string, token: string, body: string) => Promise<Res>;
  TTL_S: number;
};

const USER = "bc91b63e2b5d759f8eb9f3b58062439e0a0e15893d76317d833265ad08d66310";
const PASS = "ee7cbb1f8f4c4c5e8b6a1b1f2b0c1d2e";
const OFFICIAL = [
  "turn:turn.cloudflare.com:3478?transport=udp",
  "turn:turn.cloudflare.com:443?transport=udp",
  "turn:turn.cloudflare.com:3478?transport=tcp",
  "turn:turn.cloudflare.com:80?transport=tcp",
  "turns:turn.cloudflare.com:5349?transport=tcp",
  "turns:turn.cloudflare.com:443?transport=tcp",
];
const response = (urls = OFFICIAL, extra = {}) => JSON.stringify({ iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }, { urls, username: USER, credential: PASS, ...extra }] });

describe("resposta da Cloudflare", () => {
  it("fica só com o TURN oficial (sem STUN e sem porta 53)", () => {
    expect(cf.parseIceServers(response([...OFFICIAL, "turn:turn.cloudflare.com:53?transport=udp"]))).toEqual([{ urls: OFFICIAL, username: USER, credential: PASS }]);
  });
  it("recusa servidor que não é da Cloudflare, credencial estranha e JSON quebrado", () => {
    expect(cf.parseIceServers(response(["turn:evil.example.com:3478"]))).toBeNull();
    expect(cf.parseIceServers(response(["turn:turn.cloudflare.com.evil.com:3478"]))).toBeNull();
    expect(cf.parseIceServers(response(OFFICIAL, { username: "a b" }))).toBeNull();
    expect(cf.parseIceServers(response(OFFICIAL, { credential: "" }))).toBeNull();
    expect(cf.parseIceServers(response(OFFICIAL, { credential: 5 }))).toBeNull();
    expect(cf.parseIceServers("{")).toBeNull();
    expect(cf.parseIceServers("null")).toBeNull();
    expect(cf.parseIceServers(JSON.stringify({ iceServers: "x" }))).toBeNull();
  });
});

describe("gerar credenciais", () => {
  const KEY = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
  const TOKEN = "Ab_cd-EF.0123456789";

  it("pede 48 h com o token no Bearer e devolve o iceServer", async () => {
    const request = vi.fn(async () => ({ status: 201, body: response() }));
    expect(await cf.generate(KEY, TOKEN, request)).toEqual({ ok: true, iceServers: [{ urls: OFFICIAL, username: USER, credential: PASS }], ttl: 172800 });
    expect(request).toHaveBeenCalledWith(`/v1/turn/keys/${KEY}/credentials/generate-ice-servers`, TOKEN, JSON.stringify({ ttl: 172800 }));
  });

  it("valida o que foi colado antes de chamar a API (nada de injetar caminho ou cabeçalho)", async () => {
    const request = vi.fn();
    for (const [k, t] of [["../../x", TOKEN], ["curto", TOKEN], [KEY, "tok\r\nX-Evil: 1"], [KEY, ""], [5, TOKEN], [KEY, null]]) {
      const r = await cf.generate(k, t, request);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/não parece certa?/);
    }
    expect(request).not.toHaveBeenCalled();
  });

  it("explica cada falha da API em português", async () => {
    const run = (res: Res) => cf.generate(KEY, TOKEN, async () => res).then((r) => r.error);
    expect(await run(null)).toMatch(/Não consegui falar com a Cloudflare/);
    expect(await run({ status: 401, body: "" })).toMatch(/recusou o API token/);
    expect(await run({ status: 403, body: "" })).toMatch(/recusou o API token/);
    expect(await run({ status: 404, body: "" })).toMatch(/não achou essa Turn Token ID/);
    expect(await run({ status: 500, body: "" })).toMatch(/respondeu 500/);
    expect(await run({ status: 201, body: response(["turn:evil.example.com:3478"]) })).toMatch(/formato inesperado/);
  });
});

describe("TURN repassado por um admin", () => {
  const now = 1_000_000_000_000;
  const ok = { servers: [{ urls: OFFICIAL, username: USER, credential: PASS }], exp: now + 3600_000 };

  it("aceita credenciais oficiais dentro da validade", () => {
    expect(sanitizeSharedTurn(ok, now)).toEqual(ok);
  });

  it("recusa TURN de fora da Cloudflare (desviaria o tráfego de todos), validade absurda e formato errado", () => {
    const bad: unknown[] = [
      null,
      "x",
      { ...ok, servers: [{ ...ok.servers[0], urls: [...OFFICIAL, "turn:evil.example.com:3478"] }] },
      { ...ok, servers: [{ ...ok.servers[0], urls: ["turn:turn.cloudflare.com:53"] }] },
      { ...ok, servers: [{ ...ok.servers[0], urls: "turn:turn.cloudflare.com:3478" }] },
      { ...ok, servers: [{ ...ok.servers[0], urls: [] }] },
      { ...ok, servers: [{ ...ok.servers[0], username: "x" }] },
      { ...ok, servers: [{ ...ok.servers[0], credential: "com espaço aqui" }] },
      { ...ok, servers: [ok.servers[0], ok.servers[0]] },
      { ...ok, exp: now - 1 },
      { ...ok, exp: now + 72 * 3600_000 },
      { ...ok, exp: Number.NaN },
      { ...ok, exp: String(ok.exp) },
    ];
    for (const b of bad) expect(sanitizeSharedTurn(b, now), JSON.stringify(b)).toBeNull();
  });
});

describe("chamada HTTPS à API", () => {
  const https = createRequire(import.meta.url)("node:https") as typeof import("node:https");
  type Fake = EventEmitter & { end: (b?: string) => void; destroy: () => void; destroyed: boolean; sent?: string };
  function fakeHttps(respond: (req: Fake, cb: (res: EventEmitter & { statusCode?: number }) => void) => void) {
    const calls: { opts: Record<string, unknown>; req: Fake }[] = [];
    const spy = vi.spyOn(https, "request").mockImplementation(((opts: Record<string, unknown>, cb: (res: EventEmitter) => void) => {
      const req = new EventEmitter() as Fake;
      req.destroyed = false;
      req.destroy = () => {
        req.destroyed = true;
        req.emit("error", new Error("destroyed"));
      };
      req.end = (b) => {
        req.sent = b;
        queueMicrotask(() => respond(req, cb));
      };
      calls.push({ opts, req });
      return req;
    }) as never);
    return { calls, restore: () => spy.mockRestore() };
  }

  it("POST para rtc.live.cloudflare.com com Bearer, timeout e o corpo", async () => {
    const f = fakeHttps((_req, cb) => {
      const res = Object.assign(new EventEmitter(), { statusCode: 201 });
      cb(res);
      res.emit("data", Buffer.from('{"a":'));
      res.emit("data", Buffer.from("1}"));
      res.emit("end");
    });
    expect(await cf.post("/v1/x", "TOKEN123", '{"ttl":1}')).toEqual({ status: 201, body: '{"a":1}' });
    expect(f.calls[0].opts).toMatchObject({ host: "rtc.live.cloudflare.com", path: "/v1/x", method: "POST", timeout: 8000, headers: { authorization: "Bearer TOKEN123", "content-type": "application/json" } });
    expect(f.calls[0].req.sent).toBe('{"ttl":1}');
    f.restore();
  });

  it("resposta gigante é cortada; erro de rede e timeout viram null", async () => {
    let f = fakeHttps((req, cb) => {
      const res = Object.assign(new EventEmitter(), { statusCode: 200 });
      cb(res);
      res.emit("data", Buffer.alloc(70 * 1024));
    });
    expect(await cf.post("/x", "T", "")).toBeNull();
    expect(f.calls[0].req.destroyed).toBe(true);
    f.restore();
    f = fakeHttps((req) => req.emit("error", new Error("ECONNRESET")));
    expect(await cf.post("/x", "T", "")).toBeNull();
    f.restore();
    f = fakeHttps((req) => req.emit("timeout"));
    expect(await cf.post("/x", "T", "")).toBeNull();
    f.restore();
    f = fakeHttps((_req, cb) => {
      const res = Object.assign(new EventEmitter(), { statusCode: 200 });
      cb(res);
      res.emit("error", new Error("aborted"));
    });
    expect(await cf.post("/x", "T", "")).toBeNull();
    f.restore();
  });
});
