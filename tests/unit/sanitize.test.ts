import { describe, expect, it } from "vitest";
import { sanitizeLive, sanitizePatch, sanitizeProfile, sanitizeThumb } from "../../src/lib/sanitize";

const PUB = "A".repeat(43);
const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";

describe("sanitizeProfile", () => {
  it("perfil válido passa; o id vem da chave provada no handshake, nunca do que o peer diz", () => {
    expect(sanitizeProfile({ userId: "OUTRO", name: "Ana", color: "#aabbcc", avatar: JPEG, status: "dnd", relaySlots: 3 }, PUB)).toEqual({ userId: PUB, name: "Ana", color: "#aabbcc", avatar: JPEG, status: "dnd", relaySlots: 3 });
  });

  it.each([null, undefined, "texto", 42, [], true])("entrada %j vira um perfil neutro, sem lançar", (v) => {
    expect(sanitizeProfile(v, PUB)).toEqual({ userId: PUB, name: "?", color: "#80848e", avatar: undefined, status: "online", relaySlots: 0 });
  });

  it("nome: cortado em 32, vazio ou não-texto vira '?' (nunca '[object Object]')", () => {
    expect(sanitizeProfile({ name: "x".repeat(100) }).name).toHaveLength(32);
    for (const name of ["", "   ", {}, [], 5, null]) expect(sanitizeProfile({ name }).name, JSON.stringify(name)).toBe("?");
  });

  it("cor: só #rrggbb", () => {
    for (const color of ["red", "#fff", "#gggggg", "javascript:1", "#aabbccdd", {}, 5, "url(x)"]) expect(sanitizeProfile({ color }).color, String(color)).toBe("#80848e");
    expect(sanitizeProfile({ color: "#AaBbCc" }).color).toBe("#AaBbCc");
  });

  it("foto: só imagem embutida em base64 e de tamanho razoável (nada de URL: seria um rastreador)", () => {
    for (const avatar of ["https://rastreador.exemplo/pixel.png", "http://x/y.png", "data:image/svg+xml;base64,PHN2Zz4=", "data:text/html;base64,PGI+", "javascript:alert(1)", "data:image/png;base64,###", "data:image/jpeg;base64," + "A".repeat(60_000), {}, 5]) expect(sanitizeProfile({ avatar }).avatar, String(avatar).slice(0, 40)).toBeUndefined();
    for (const avatar of [JPEG, "data:image/png;base64,iVBORw0KGgo=", "data:image/webp;base64,UklGRg=="]) expect(sanitizeProfile({ avatar }).avatar).toBe(avatar);
  });

  it("status e vagas de retransmissão ficam dentro dos limites", () => {
    expect(sanitizeProfile({ status: "invisivel" }).status).toBe("online");
    expect(sanitizeProfile({ status: "idle" }).status).toBe("idle");
    for (const [slots, out] of [[-5, 0], [1e9, 8], [3.7, 3], ["5", 5], [NaN, 0], [Infinity, 8], [{}, 0], [null, 0]] as const) expect(sanitizeProfile({ relaySlots: slots }).relaySlots, String(slots)).toBe(out);
  });
});

describe("sanitizeThumb", () => {
  it("só JPEG embutido", () => {
    expect(sanitizeThumb(JPEG)).toBe(JPEG);
    for (const t of ["https://rastreador.exemplo/x.jpg", "data:image/png;base64,AAAA", "data:image/jpeg;base64,<script>", "data:image/jpeg;base64," + "A".repeat(80_000), "", null, {}, 7]) expect(sanitizeThumb(t), String(t).slice(0, 40)).toBeUndefined();
  });
});

describe("sanitizeLive", () => {
  const NOW = 1_800_000_000_000;
  it("transmissão válida passa", () => {
    const live = { title: "Jogando", kind: "camera", startedAt: NOW - 5000, viewers: 3, viewerKeys: [PUB], audio: true };
    expect(sanitizeLive(live, NOW)).toEqual(live);
  });

  it.each([null, undefined, "live", 5, true, []])("%j não é transmissão", (v) => expect(sanitizeLive(v, NOW)).toBeNull());

  it("campos de tipo errado viram valores seguros (o painel desenha title e viewers direto)", () => {
    const out = sanitizeLive({ title: { evil: 1 }, kind: "hack", startedAt: "ontem", viewers: { n: 1 }, viewerKeys: "x", audio: "sim" }, NOW)!;
    expect(out).toEqual({ title: "", kind: "screen", startedAt: NOW, viewers: 0, audio: false });
    expect(typeof out.title).toBe("string");
    expect(typeof out.viewers).toBe("number");
  });

  it("limites: título, espectadores, início no futuro, chaves", () => {
    const out = sanitizeLive({ title: "t".repeat(500), viewers: 1e12, startedAt: NOW + 10 ** 9, viewerKeys: [PUB, "lixo", 5, null, ...Array(1000).fill(PUB)] }, NOW)!;
    expect(out.title).toHaveLength(120);
    expect(out.viewers).toBe(100_000);
    expect(out.startedAt).toBe(NOW);
    expect(out.viewerKeys).toHaveLength(512);
    expect(out.viewerKeys!.every((k) => k === PUB)).toBe(true);
    expect(sanitizeLive({ viewers: -3, startedAt: -1 }, NOW)).toMatchObject({ viewers: 0, startedAt: 0 });
  });
});

describe("sanitizePatch: atualização de presença vinda da rede", () => {
  it("só as chaves conhecidas passam: um peer não troca o próprio pub pelo de um admin, nem mexe em rtt/relayed", () => {
    const out = sanitizePatch({ pub: "ADMIN".padEnd(43, "A"), rtt: 1, relayed: true, hacked: true, inVoice: true, muted: true }, PUB, false);
    expect(out).toEqual({ inVoice: true, muted: true });
    expect(Object.keys(out)).not.toContain("pub");
  });

  it("não polui o protótipo nem herda chaves do protótipo", () => {
    const out = sanitizePatch(JSON.parse('{"__proto__":{"polluted":1},"constructor":{"x":1},"inVoice":true}'), PUB, false);
    expect(out).toEqual({ inVoice: true });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(sanitizePatch(Object.create({ inVoice: true }), PUB, false)).toEqual({});
  });

  it("quem ainda não é membro só atualiza nome e foto", () => {
    const out = sanitizePatch({ profile: { name: "Novo" }, live: { title: "x" }, inVoice: true, thumb: JPEG }, PUB, true);
    expect(Object.keys(out)).toEqual(["profile"]);
    expect(out.profile).toMatchObject({ name: "Novo", userId: PUB });
  });

  it("miniatura por URL é descartada (o sinal de 'thumb' continua, mas vazio)", () => {
    expect(sanitizePatch({ thumb: "https://rastreador.exemplo/x.png" }, PUB, false)).toEqual({ thumb: undefined });
  });

  it("'live: null' (acabou a transmissão) é preservado; live malformado também vira null", () => {
    expect(sanitizePatch({ live: null }, PUB, false)).toEqual({ live: null });
    expect(sanitizePatch({ live: "x" }, PUB, false)).toEqual({ live: null });
  });

  it("booleanos são coagidos", () => {
    expect(sanitizePatch({ inVoice: "sim", muted: 0, deaf: {} }, PUB, false)).toEqual({ inVoice: true, muted: false, deaf: true });
  });

  it.each([null, undefined, "x", 5, []])("entrada %j dá patch vazio", (v) => expect(sanitizePatch(v, PUB, false)).toEqual({}));
});
