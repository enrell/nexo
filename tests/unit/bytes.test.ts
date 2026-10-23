import { describe, expect, it } from "vitest";
import { b64u, fromB64u } from "../../src/lib/bytes";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("b64u", () => {
  // vetores do RFC 4648 §10, na variante URL-safe sem padding
  it.each([
    ["", ""],
    ["f", "Zg"],
    ["fo", "Zm8"],
    ["foo", "Zm9v"],
    ["foob", "Zm9vYg"],
    ["fooba", "Zm9vYmE"],
    ["foobar", "Zm9vYmFy"],
  ])("codifica %j", (plain, enc) => {
    expect(b64u(bytes(plain))).toBe(enc);
    expect(new TextDecoder().decode(fromB64u(enc))).toBe(plain);
  });

  it("usa o alfabeto URL-safe e não deixa padding", () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    const enc = b64u(all);
    expect(enc).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(enc).not.toContain("=");
    expect(fromB64u(enc)).toEqual(all);
  });

  it("aceita ArrayBuffer e Uint8Array", () => {
    const u = Uint8Array.from([1, 2, 3, 250, 251]);
    expect(b64u(u.buffer)).toBe(b64u(u));
  });

  it("vai e volta para qualquer tamanho", () => {
    for (let len = 0; len < 70; len++) {
      const data = crypto.getRandomValues(new Uint8Array(len));
      expect(fromB64u(b64u(data))).toEqual(data);
    }
  });

  it("recusa texto que não é base64", () => {
    expect(() => fromB64u("***")).toThrow();
  });
});
