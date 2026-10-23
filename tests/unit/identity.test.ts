import { beforeAll, describe, expect, it } from "vitest";
import { b64u } from "../../src/lib/bytes";
import { Identity, isPubKey, openBackup, safetyNumber, sha256, shortKey, storeRestoredIdentity, verify } from "../../src/lib/identity";
import { storage } from "../../src/lib/storage";
import { initVault } from "../../src/lib/vault";
import { newIdentity } from "./helpers";

beforeAll(initVault);

describe("assinatura Ed25519", () => {
  it("a chave pública é o id: 43 caracteres base64url", async () => {
    const a = await newIdentity();
    expect(isPubKey(a.pub)).toBe(true);
    expect(a.pub).toHaveLength(43);
    expect(shortKey(a.pub)).toBe(a.pub.slice(0, 6));
  });

  it("assina e verifica; mensagem ou assinatura alteradas falham", async () => {
    const a = await newIdentity();
    const sig = await a.sign("olá");
    expect(sig).toHaveLength(86);
    expect(await verify(a.pub, "olá", sig)).toBe(true);
    expect(await verify(a.pub, "olá!", sig)).toBe(false);
    const flipped = sig.slice(0, -2) + (sig.endsWith("AA") ? "BB" : "AA");
    expect(await verify(a.pub, "olá", flipped)).toBe(false);
  });

  it("ninguém assina como outra pessoa", async () => {
    const a = await newIdentity();
    const sigA = await a.sign("x");
    const b = await newIdentity();
    expect(await verify(b.pub, "x", sigA)).toBe(false);
  });

  it("entradas malformadas dão false (nunca exceção)", async () => {
    const a = await newIdentity();
    const sig = await a.sign("x");
    for (const [pub, sg] of [
      ["", sig],
      ["curta", sig],
      [a.pub, ""],
      [a.pub, "abc"],
      [a.pub + "=", sig],
      [a.pub, sig + "A"],
      [undefined as unknown as string, sig],
      [a.pub, 5 as unknown as string],
      ["!".repeat(43), sig],
    ] as const)
      expect(await verify(pub, "x", sg)).toBe(false);
  });

  it("isPubKey só aceita 43 caracteres do alfabeto base64url", () => {
    expect(isPubKey("A".repeat(43))).toBe(true);
    expect(isPubKey("A".repeat(42))).toBe(false);
    expect(isPubKey("A".repeat(44))).toBe(false);
    expect(isPubKey("A".repeat(42) + "+")).toBe(false);
    expect(isPubKey(null)).toBe(false);
    expect(isPubKey(123)).toBe(false);
  });

  it("a identidade é guardada e recarregada igual", async () => {
    const a = await newIdentity();
    const again = await Identity.load();
    expect(again.pub).toBe(a.pub);
    expect(await verify(a.pub, "msg", await again.sign("msg"))).toBe(true);
  });

  it("identidade corrompida no armazenamento gera uma nova em vez de quebrar", async () => {
    await newIdentity();
    storage.set("identity", { pub: "x", jwk: { kty: "OKP", crv: "Ed25519", d: "invalido", x: "invalido" } });
    const fresh = await Identity.load();
    expect(isPubKey(fresh.pub)).toBe(true);
  });
});

describe("sha256", () => {
  it("vetor conhecido (\"abc\")", async () => {
    // SHA-256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
    const hex = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    expect(await sha256("abc", 100)).toBe(b64u(Buffer.from(hex, "hex")));
  });
  it("corta no tamanho pedido", async () => {
    expect(await sha256("abc")).toHaveLength(22);
    expect(await sha256("abc", 32)).toHaveLength(32);
  });
});

describe("número de segurança", () => {
  it("é igual para os dois lados e independe da ordem", async () => {
    const a = (await newIdentity()).pub;
    const b = (await newIdentity()).pub;
    expect(await safetyNumber(a, b)).toBe(await safetyNumber(b, a));
  });
  it("tem 12 grupos de 5 dígitos", async () => {
    const n = await safetyNumber("a".repeat(43), "b".repeat(43));
    expect(n).toMatch(/^(\d{5} ){11}\d{5}$/);
  });
  it("muda se qualquer um dos dois mudar (detecta o intermediário)", async () => {
    const a = "a".repeat(43);
    const b = "b".repeat(43);
    const n = await safetyNumber(a, b);
    expect(await safetyNumber(a, "c".repeat(43))).not.toBe(n);
    expect(await safetyNumber("c".repeat(43), b)).not.toBe(n);
  });
  it("valor fixo, calculado à parte em Python (hashlib): mudar o algoritmo quebraria a verificação entre versões", async () => {
    expect(await safetyNumber("a".repeat(43), "b".repeat(43))).toBe("54714 55439 34450 55618 48534 52142 12723 36976 19055 29079 15796 14942");
  });
});

describe("backup da conta", () => {
  it("vai e volta com senha, trazendo a identidade e o que mais foi incluído", async () => {
    const a = await newIdentity();
    const file = await a.exportBackup("senha forte", { profile: { name: "Ana" }, servers: [{ sid: "s1" }] });
    const out = await openBackup(file, "senha forte");
    expect(out.identity.pub).toBe(a.pub);
    expect(out.profile).toEqual({ name: "Ana" });
    expect(out.servers).toEqual([{ sid: "s1" }]);
    // a chave restaurada assina de verdade
    storeRestoredIdentity(out.identity);
    const restored = await Identity.load();
    expect(await verify(a.pub, "x", await restored.sign("x"))).toBe(true);
  });

  it("o arquivo não contém a chave privada em claro", async () => {
    const a = await newIdentity();
    const file = await a.exportBackup("senha", {});
    expect(file).not.toContain('"d"');
    expect(file).not.toContain(a.pub);
  });

  it("senha errada é recusada", async () => {
    const a = await newIdentity();
    const file = await a.exportBackup("certa", {});
    await expect(openBackup(file, "errada")).rejects.toThrow(/senha errada/);
    await expect(openBackup(file, "")).rejects.toThrow(/senha errada/);
  });

  it("a senha é normalizada (é composto = e + acento)", async () => {
    const a = await newIdentity();
    const file = await a.exportBackup("café", {});
    expect((await openBackup(file, "café")).identity.pub).toBe(a.pub);
  });

  it("arquivo alterado é recusado", async () => {
    const a = await newIdentity();
    const parsed = JSON.parse(await a.exportBackup("s", {}));
    const data = Buffer.from(parsed.data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    data[5] ^= 1;
    parsed.data = b64u(data);
    await expect(openBackup(JSON.stringify(parsed), "s")).rejects.toThrow(/senha errada ou arquivo alterado/);
  });

  it("parâmetros trocados (rebaixar as iterações) são recusados", async () => {
    const a = await newIdentity();
    const parsed = JSON.parse(await a.exportBackup("s", {}));
    for (const iterations of [1, 99_999, 10_000_001, "abc", null]) await expect(openBackup(JSON.stringify({ ...parsed, iterations }), "s")).rejects.toThrow(/parâmetros/);
    await expect(openBackup(JSON.stringify({ ...parsed, kdf: "SHA1" }), "s")).rejects.toThrow(/inválido/);
    await expect(openBackup(JSON.stringify({ ...parsed, nexoBackup: 1 }), "s")).rejects.toThrow(/inválido/);
    await expect(openBackup("{}", "s")).rejects.toThrow(/inválido/);
    await expect(openBackup("não é json", "s")).rejects.toThrow();
  });

  it("backup cuja chave privada não corresponde à pública é recusado", async () => {
    const a = await newIdentity();
    const b = await newIdentity();
    const enc = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const base = await crypto.subtle.importKey("raw", enc.encode("s"), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100_000 }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
    const bJwk = storage.get<{ jwk: JsonWebKey }>("identity", { jwk: {} }).jwk;
    const forged = { identity: { pub: a.pub, jwk: bJwk } }; // pública da Ana com a chave privada do Beto
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode("nexo-backup-v2") }, key, enc.encode(JSON.stringify(forged)));
    const file = JSON.stringify({ nexoBackup: 2, kdf: "PBKDF2-SHA256", iterations: 100_000, salt: b64u(salt), iv: b64u(iv), data: b64u(ct) });
    expect(b.pub).not.toBe(a.pub);
    await expect(openBackup(file, "s")).rejects.toThrow(/inconsistente/);
  });
});
