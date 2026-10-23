import { beforeAll, describe, expect, it, vi } from "vitest";
import { initVault, open, openJson, openString, seal, sealJson, sealString } from "../../src/lib/vault";

beforeAll(initVault);
const enc = new TextEncoder();
const text = (b: ArrayBuffer) => new TextDecoder().decode(b);

describe("cofre (AES-256-GCM)", () => {
  it("cifra e decifra", async () => {
    const box = await seal(enc.encode("segredo"), "k");
    expect(text(await open(box, "k"))).toBe("segredo");
  });

  it("o texto cifrado não contém o texto puro e tem iv(12)+tag(16) de sobra", async () => {
    const box = await seal(enc.encode("segredo-bem-reconhecivel"), "k");
    expect(box.length).toBe(12 + "segredo-bem-reconhecivel".length + 16);
    expect(Buffer.from(box).includes(Buffer.from("segredo"))).toBe(false);
  });

  it("cada cifragem usa um iv novo (mesmo texto, resultados diferentes)", async () => {
    const a = await seal(enc.encode("x"), "k");
    const b = await seal(enc.encode("x"), "k");
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    const ivs = new Set<string>();
    for (let i = 0; i < 200; i++) ivs.add(Buffer.from((await seal(enc.encode("x"), "k")).slice(0, 12)).toString("hex"));
    expect(ivs.size).toBe(200);
  });

  it("registro trocado de lugar (AAD diferente) é recusado", async () => {
    const box = await seal(enc.encode("segredo"), "chave-a");
    await expect(open(box, "chave-b")).rejects.toThrow();
  });

  it("qualquer byte alterado é detectado (iv, corpo ou tag)", async () => {
    const box = await seal(enc.encode("segredo importante"), "k");
    for (const pos of [0, 11, 12, box.length - 17, box.length - 1]) {
      const bad = new Uint8Array(box);
      bad[pos] ^= 1;
      await expect(open(bad, "k")).rejects.toThrow();
    }
  });

  it("registro truncado é recusado", async () => {
    const box = await seal(enc.encode("segredo"), "k");
    await expect(open(box.slice(0, box.length - 1), "k")).rejects.toThrow();
    await expect(open(new Uint8Array(5), "k")).rejects.toThrow();
  });

  it("JSON e strings vão e voltam, com o prefixo de versão", async () => {
    const value = { a: 1, b: ["ç", "😀"], c: null };
    expect(await openJson(await sealJson(value, "j"), "j")).toEqual(value);
    const s = await sealString("olá", "s");
    expect(s.startsWith("v1:")).toBe(true);
    expect(await openString(s, "s")).toBe("olá");
    await expect(openString(s, "outro")).rejects.toThrow();
  });
});

describe("cofre sem inicializar", () => {
  it("recusa usar antes do initVault", async () => {
    vi.resetModules();
    const fresh = await import("../../src/lib/vault");
    await expect(fresh.seal(enc.encode("x"), "k")).rejects.toThrow(/cofre não inicializado/);
  });

  it("no Electron, a chave vem do processo principal e é importada não-extraível", async () => {
    vi.resetModules();
    const raw = Buffer.alloc(32, 7).toString("base64");
    const getVaultKey = vi.fn(async () => raw);
    (globalThis as { window: unknown }).window = Object.assign(globalThis, { nexo: { getVaultKey } });
    try {
      const fresh = await import("../../src/lib/vault");
      await fresh.initVault();
      await fresh.initVault(); // idempotente
      expect(getVaultKey).toHaveBeenCalledTimes(1);
      const box = await fresh.seal(enc.encode("oi"), "k");
      expect(text(await fresh.open(box, "k"))).toBe("oi");
      // o mesmo material de chave decifra em outra instância (é assim que os dados sobrevivem ao reinício)
      vi.resetModules();
      const again = await import("../../src/lib/vault");
      await again.initVault();
      expect(text(await again.open(box, "k"))).toBe("oi");
    } finally {
      delete (globalThis as { nexo?: unknown }).nexo;
    }
  });
});
