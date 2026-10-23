import { describe, expect, it } from "vitest";
import { installShims, Utf8Decoder, Utf8Encoder } from "../../public/denoise/shim.js";

const SAMPLES = ["", "abc", "Nexo: voz, texto e live", "ação — coração ✓", "日本語のテキスト", "emoji 🎙️🔇 e 😀", "\u0000\u007f\u0080߿ࠀ￿", "a\u{10000}b\u{10ffff}", "ɐ".repeat(300)];

describe("shim do AudioWorklet (TextEncoder/TextDecoder)", () => {
  it("o codificador gera os mesmos bytes que o do navegador", () => {
    const ref = new TextEncoder();
    for (const s of SAMPLES) expect(new Utf8Encoder().encode(s)).toEqual(ref.encode(s));
  });

  it("meia surrogate solta vira U+FFFD, como no navegador", () => {
    for (const s of ["\ud800", "x\udc00y", "\ud83d"]) expect(new Utf8Encoder().encode(s)).toEqual(new TextEncoder().encode(s));
  });

  it("encodeInto devolve read/written iguais ao do navegador, inclusive quando o destino é curto", () => {
    for (const s of SAMPLES) {
      for (const size of [0, 1, 2, 3, 4, 5, 9, 64, 5000]) {
        const mine = new Uint8Array(size);
        const ref = new Uint8Array(size);
        const a = new Utf8Encoder().encodeInto(s, mine);
        const b = new TextEncoder().encodeInto(s, ref);
        expect(a, `${JSON.stringify(s)} em ${size}`).toEqual(b);
        expect(mine).toEqual(ref);
      }
    }
  });

  it("o decodificador lê o que o codificador escreveu", () => {
    for (const s of SAMPLES) {
      const bytes = new TextEncoder().encode(s);
      expect(new Utf8Decoder().decode(bytes)).toBe(s);
      expect(new Utf8Decoder().decode(bytes.buffer.slice(0) as ArrayBuffer)).toBe(s);
    }
    expect(new Utf8Decoder().decode()).toBe("");
  });

  it("lê só o trecho de uma visão (subarray), como a memória do WASM exige", () => {
    const all = new TextEncoder().encode("xx✓yy");
    expect(new Utf8Decoder().decode(all.subarray(2, 5))).toBe("✓");
  });

  it("bytes inválidos viram U+FFFD em vez de lançar", () => {
    for (const bad of [[0xff], [0xc0, 0x80], [0xe2, 0x82], [0xed, 0xa0, 0x80], [0xf8, 0x88, 0x80, 0x80, 0x80], [0x80], [0xf4, 0x90, 0x80, 0x80]]) {
      const s = new Utf8Decoder().decode(new Uint8Array(bad));
      expect(s.length).toBeGreaterThan(0);
      expect([...s].every((c) => c === "�")).toBe(true);
    }
  });

  it("instala só o que falta, sem sobrescrever o que o ambiente já tem", () => {
    const scope: Record<string, unknown> = {};
    expect(installShims(scope).sort()).toEqual(["TextDecoder", "TextEncoder", "crypto"]);
    expect(scope.TextDecoder).toBe(Utf8Decoder);
    const keep = { TextDecoder: class {}, TextEncoder: class {}, crypto: { marker: 1 } };
    const scope2: Record<string, unknown> = { ...keep };
    expect(installShims(scope2)).toEqual([]);
    expect(scope2).toEqual(keep);
  });

  it("crypto.getRandomValues preenche o buffer e devolve o mesmo buffer", () => {
    const scope: { crypto?: { getRandomValues(a: Uint8Array): Uint8Array } } = {};
    installShims(scope);
    const a = new Uint8Array(256);
    expect(scope.crypto!.getRandomValues(a)).toBe(a);
    expect(new Set(a).size).toBeGreaterThan(50); // não é tudo zero nem constante
  });
});
