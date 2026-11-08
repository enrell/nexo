import { describe, expect, it } from "vitest";
import { BASE_KEY_BYTES, MediaSendKey, mayShareMediaKey, ROTATE_DELAY_MS, sanitizeKeyOffer } from "../../src/lib/mediakeys";

describe("mayShareMediaKey: quem troca chave de mídia", () => {
  it("só entre dois membros, e só com quem anunciou SFrame", () => {
    expect(mayShareMediaKey({ member: true }, { member: true, sf: true })).toBe(true);
    expect(mayShareMediaKey({ member: true }, { member: false, sf: true })).toBe(false); // pendente/banido
    expect(mayShareMediaKey({ member: false }, { member: true, sf: true })).toBe(false); // eu ainda na porta
    expect(mayShareMediaKey({ member: true }, { member: true, sf: false })).toBe(false); // versão sem SFrame
    expect(mayShareMediaKey({ member: true }, { member: true })).toBe(false);
  });
});

describe("sanitizeKeyOffer", () => {
  const good = new MediaSendKey().offer();

  it("aceita a oferta que o próprio app gera", () => {
    const k = sanitizeKeyOffer(good);
    expect(k?.kid).toBe(good.kid);
    expect(k?.key.length).toBe(BASE_KEY_BYTES);
  });

  it.each([
    ["nada", null],
    ["texto", "oi"],
    ["versão errada", { ...good, v: 2 }],
    ["kid negativo", { ...good, kid: -1 }],
    ["kid fracionário", { ...good, kid: 1.5 }],
    ["kid acima de 32 bits", { ...good, kid: 2 ** 32 }],
    ["kid em texto", { ...good, kid: "1" }],
    ["chave curta", { ...good, key: good.key.slice(0, 21) }],
    ["chave longa", { ...good, key: good.key + "AAAA" }],
    ["chave com caracteres de fora", { ...good, key: "+".repeat(22) }],
    ["chave que não é texto", { ...good, key: [1, 2, 3] }],
  ])("recusa %s", (_, raw) => {
    expect(sanitizeKeyOffer(raw)).toBeNull();
  });
});

describe("MediaSendKey", () => {
  it("chave e KID novos a cada rotação; a primeira vale na hora, as outras depois do atraso", () => {
    const k = new MediaSendKey();
    const first = k.initialOp();
    const offer1 = k.offer();
    expect(first).toMatchObject({ t: "send", kid: offer1.kid, delayMs: 0 });
    const next = k.rotate();
    const offer2 = k.offer();
    expect(next).toMatchObject({ t: "send", kid: offer2.kid, delayMs: ROTATE_DELAY_MS });
    expect(offer2.kid).not.toBe(offer1.kid);
    expect(offer2.key).not.toBe(offer1.key);
    // o que vai para o worker é uma cópia: transferir o buffer não apaga a chave guardada
    if (next.t === "send") next.key.fill(0);
    expect(k.offer().key).toBe(offer2.key);
  });

  it("sorteia de novo se o KID repetir", () => {
    const seq = [[0, 0, 0, 5], new Array(16).fill(1), [0, 0, 0, 5], [0, 0, 0, 6], new Array(16).fill(2)];
    const k = new MediaSendKey((b) => {
      b.set(seq.shift()!);
      return b;
    });
    expect(k.kid).toBe(5);
    k.rotate();
    expect(k.kid).toBe(6);
  });
});
