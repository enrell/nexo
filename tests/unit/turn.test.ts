import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTurnConfig, joinErrorMessage, parseTurnUrls, testTurn } from "../../src/lib/turn";

describe("TURN", () => {
  it("aceita várias URLs separadas por linha, espaço ou vírgula, sem repetir", () => {
    expect(parseTurnUrls("turn:a.com:3478\nturn:a.com:3478?transport=tcp, turns:a.com:443?transport=tcp  turn:a.com:3478")).toEqual([
      "turn:a.com:3478",
      "turn:a.com:3478?transport=tcp",
      "turns:a.com:443?transport=tcp",
    ]);
  });

  it("ignora o que não é turn:/turns: (stun, http, lixo)", () => {
    expect(parseTurnUrls("stun:a.com https://x.com turnx:a turn: javascript:alert(1)")).toEqual([]);
  });

  it("sem URL válida não configura TURN", () => {
    expect(buildTurnConfig({ turnUrl: "  \n ", turnUser: "u", turnPass: "p" })).toBeUndefined();
  });

  it("monta um iceServer com todas as URLs e a credencial", () => {
    expect(buildTurnConfig({ turnUrl: "turn:a.com:3478 turns:a.com:443", turnUser: "u", turnPass: "p" })).toEqual([
      { urls: ["turn:a.com:3478", "turns:a.com:443"], username: "u", credential: "p" },
    ]);
    expect(buildTurnConfig({ turnUrl: "turn:a.com", turnUser: "", turnPass: "" })).toEqual([{ urls: ["turn:a.com"], username: undefined, credential: undefined }]);
  });

  it("traduz o erro do Trystero e diz o que fazer", () => {
    const e = "could not connect to peer X after exchanging SDP; configure TURN servers with turnConfig or rtcConfig.iceServers";
    expect(joinErrorMessage(e, false)).toMatch(/Configure um servidor TURN em Configurações → Rede/);
    expect(joinErrorMessage(e, true)).toMatch(/Testar TURN/);
    expect(joinErrorMessage("banid", false)).toBe("Você foi banido deste servidor.");
    expect(joinErrorMessage("outra coisa", false)).toBe("outra coisa");
  });
});

describe("Testar TURN", () => {
  type Ev = { candidate?: { type: string; protocol: string } | null; url?: string; errorCode?: number; errorText?: string };
  function fakePc(script: (pc: { onicecandidate: ((e: Ev) => void) | null; onicecandidateerror: ((e: Ev) => void) | null }) => void, opts: { throws?: string } = {}) {
    const made: { config: RTCConfiguration; closed: boolean }[] = [];
    class FakePc {
      onicecandidate: ((e: Ev) => void) | null = null;
      onicecandidateerror: ((e: Ev) => void) | null = null;
      closed = false;
      constructor(public config: RTCConfiguration) {
        if (opts.throws) throw new Error(opts.throws);
        made.push(this);
      }
      createDataChannel() {}
      async createOffer() {
        return { type: "offer", sdp: "" };
      }
      async setLocalDescription() {
        setTimeout(() => script(this), 0);
      }
      close() {
        this.closed = true;
      }
    }
    vi.stubGlobal("RTCPeerConnection", FakePc);
    return made;
  }
  afterEach(() => vi.unstubAllGlobals());
  const servers = [{ urls: ["turn:a.com:3478"], username: "u", credential: "p" }];

  it("ok quando aparece candidato relay; pede só relay e fecha a conexão", async () => {
    const made = fakePc((pc) => {
      pc.onicecandidate?.({ candidate: { type: "host", protocol: "udp" } });
      pc.onicecandidate?.({ candidate: { type: "relay", protocol: "udp" } });
      pc.onicecandidate?.({ candidate: { type: "relay", protocol: "tcp" } });
      pc.onicecandidate?.({ candidate: null });
    });
    expect(await testTurn(servers)).toEqual({ ok: true, detail: "TURN funcionando (udp, tcp)." });
    expect(made[0].config).toEqual({ iceServers: servers, iceTransportPolicy: "relay" });
    expect(made[0].closed).toBe(true);
  });

  it("401 = usuário/senha recusados; sem nada = não respondeu (com o erro); tempo esgotado também falha", async () => {
    fakePc((pc) => {
      pc.onicecandidateerror?.({ url: "turn:a.com:3478", errorCode: 401, errorText: "Unauthorized" });
      pc.onicecandidate?.({ candidate: null });
    });
    expect(await testTurn(servers)).toEqual({ ok: false, detail: "O TURN respondeu, mas recusou usuário/senha." });
    fakePc((pc) => {
      pc.onicecandidateerror?.({ url: "turn:a.com:3478", errorCode: 701, errorText: "timeout" });
      pc.onicecandidate?.({ candidate: null });
    });
    expect(await testTurn(servers)).toEqual({ ok: false, detail: "O TURN não respondeu. turn:a.com:3478 701 timeout" });
    fakePc(() => {});
    expect(await testTurn(servers, 20)).toEqual({ ok: false, detail: "O TURN não respondeu." });
  });

  it("configuração que o navegador recusa vira mensagem, não exceção", async () => {
    fakePc(() => {}, { throws: "bad url" });
    expect(await testTurn(servers)).toEqual({ ok: false, detail: "Configuração inválida: bad url" });
  });
});
