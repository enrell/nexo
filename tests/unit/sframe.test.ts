import { describe, expect, it } from "vitest";
import { decodeHeader, decrypt, deriveKeySalt, deriveKeySaltBytes, encodeHeader, encryptWith, SframeSender } from "../../src/lib/sframe";

const hex = (s: string) => Uint8Array.from(s.replace(/\s+/g, "").match(/../g) ?? [], (b) => parseInt(b, 16));
const toHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const te = new TextEncoder();

describe("SFrame: cabeçalho (RFC 9605 §4.3, vetores do Apêndice C.1)", () => {
  const MAX = 0xffffffffffffffffn;
  // amostra dos 289 vetores do RFC: as quatro formas (X/Y), os limites de 1, 2, 3 e 8 bytes
  const vectors: [bigint, bigint, string][] = [
    [0n, 0n, "00"],
    [0n, 1n, "01"],
    [0n, 255n, "08ff"],
    [0n, 65536n, "0a010000"],
    [0n, MAX, "0fffffffffffffffff"],
    [1n, 0n, "10"],
    [1n, 255n, "18ff"],
    [1n, MAX, "1fffffffffffffffff"],
    [255n, 0n, "80ff"],
    [255n, 1n, "81ff"],
    [255n, 255n, "88ffff"],
    [255n, 65536n, "8aff010000"],
    [256n, 0n, "900100"],
    [256n, 255n, "980100ff"],
    [256n, MAX, "9f0100ffffffffffffffff"],
    [4294967296n, 1n, "c10100000000"],
    [4294967296n, 65536n, "ca0100000000010000"],
    [MAX, 0n, "f0ffffffffffffffff"],
    [MAX, 65536n, "faffffffffffffffff010000"],
    [MAX, MAX, "ffffffffffffffffffffffffffffffffff"],
  ];

  it.each(vectors)("kid %s ctr %s → %s", (kid, ctr, header) => {
    expect(toHex(encodeHeader(kid, ctr))).toBe(header);
    expect(decodeHeader(hex(header))).toEqual({ kid, ctr, length: header.length / 2 });
  });

  it("recusa cabeçalho truncado ou que não usa a codificação mínima", () => {
    expect(decodeHeader(new Uint8Array(0))).toBeNull();
    expect(decodeHeader(hex("09ff"))).toBeNull(); // pede 2 bytes de CTR, tem 1
    expect(decodeHeader(hex("80"))).toBeNull(); // pede 1 byte de KID, não tem
    expect(decodeHeader(hex("0807"))).toBeNull(); // CTR 7 cabe no byte de configuração
    expect(decodeHeader(hex("8007"))).toBeNull(); // KID 7 idem
    expect(decodeHeader(hex("0900ff"))).toBeNull(); // zero à esquerda
    expect(decodeHeader(hex("9000ff"))).toBeNull();
  });

  it("recusa KID/CTR fora de 64 bits", () => {
    expect(() => encodeHeader(-1n, 0n)).toThrow(RangeError);
    expect(() => encodeHeader(0n, 1n << 64n)).toThrow(RangeError);
    return expect(deriveKeySaltBytes(1n << 64n, new Uint8Array(16))).rejects.toThrow(RangeError);
  });
});

describe("SFrame: AES_128_GCM_SHA256_128 (vetor do Apêndice C.3)", () => {
  const kid = 0x123n;
  const ctr = 0x4567n;
  const baseKey = hex("000102030405060708090a0b0c0d0e0f");
  const metadata = hex("4945544620534672616d65205747");
  const pt = hex("64726166742d696574662d736672616d652d656e63");
  const ct = hex("9901234567b7412c2513a1b66dbb48841bbaf17f598751176ad847681a69c6d0b091c07018ce4adb34eb");

  it("deriva sframe_key e sframe_salt", async () => {
    const { key, salt } = await deriveKeySaltBytes(kid, baseKey);
    expect(toHex(key)).toBe("d34f547f4ca4f9a7447006fe7fcbf768");
    expect(toHex(salt)).toBe("75234edefe07819026751816");
  });

  it("cifra exatamente como o RFC e decifra de volta", async () => {
    const enc = await deriveKeySalt(kid, baseKey, "encrypt");
    expect(toHex(await encryptWith(enc, kid, ctr, pt, metadata))).toBe(toHex(ct));
    const dec = await deriveKeySalt(kid, baseKey, "decrypt");
    const out = await decrypt((k) => (k === kid ? dec : null), ct, metadata);
    expect(out && toHex(out.plaintext)).toBe(toHex(pt));
    expect(out?.ctr).toBe(ctr);
  });

  it("descarta: metadado diferente, cabeçalho ou cifra alterados, KID sem chave, quadro curto", async () => {
    const dec = await deriveKeySalt(kid, baseKey, "decrypt");
    const keyFor = (k: bigint) => (k === kid ? dec : null);
    expect(await decrypt(keyFor, ct, new Uint8Array(0))).toBeNull();
    for (const i of [2, 4, 8, ct.length - 1]) {
      const bad = ct.slice();
      bad[i] ^= 1;
      expect(await decrypt(keyFor, bad, metadata)).toBeNull();
    }
    expect(await decrypt(() => null, ct, metadata)).toBeNull();
    expect(await decrypt(keyFor, ct.slice(0, 5 + 15), metadata)).toBeNull();
  });

  it("chave de envio só cifra e chave de recepção só decifra (§4.4.1)", async () => {
    const enc = await deriveKeySalt(kid, baseKey, "encrypt");
    const dec = await deriveKeySalt(kid, baseKey, "decrypt");
    expect(enc.key.usages).toEqual(["encrypt"]);
    expect(dec.key.usages).toEqual(["decrypt"]);
    expect(enc.key.extractable).toBe(false);
    expect(await decrypt(() => enc, ct, metadata)).toBeNull();
  });
});

describe("SframeSender", () => {
  it("nunca repete o CTR, mesmo com várias cifragens ao mesmo tempo", async () => {
    const s = await SframeSender.create(9n, new Uint8Array(16).fill(7));
    const frames = await Promise.all(Array.from({ length: 50 }, (_, i) => s.encrypt(te.encode(`quadro ${i}`))));
    const ctrs = frames.map((f) => decodeHeader(f)!.ctr);
    expect(new Set(ctrs).size).toBe(50);
    expect(ctrs).toEqual(Array.from({ length: 50 }, (_, i) => BigInt(i)));
    expect(frames.every((f) => decodeHeader(f)!.kid === 9n)).toBe(true);
  });

  it("só quem tem a mesma base_key decifra", async () => {
    const s = await SframeSender.create(3n, new Uint8Array(16).fill(1));
    const f = await s.encrypt(te.encode("oi"));
    const right = await deriveKeySalt(3n, new Uint8Array(16).fill(1), "decrypt");
    const wrong = await deriveKeySalt(3n, new Uint8Array(16).fill(2), "decrypt");
    expect(new TextDecoder().decode((await decrypt(() => right, f))!.plaintext)).toBe("oi");
    expect(await decrypt(() => wrong, f)).toBeNull();
    // mesma base_key com outro KID dá outra chave (o KID entra na derivação)
    const otherKid = await deriveKeySalt(4n, new Uint8Array(16).fill(1), "decrypt");
    expect(await decrypt(() => otherKid, f)).toBeNull();
  });
});
