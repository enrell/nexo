import { describe, expect, it } from "vitest";
import { buildTurnConfig, joinErrorMessage, parseTurnUrls } from "../../src/lib/turn";

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
