/**
 * SFrame (RFC 9605), suíte AES_128_GCM_SHA256_128 (0x0004), sobre WebCrypto.
 *
 * Segue o RFC à risca (cabeçalho X|K|Y|C, rótulos do HKDF com KID e suíte, nonce = salt XOR CTR)
 * e é conferido com os vetores do Apêndice C. Só cifra e decifra quadros: quem pode ter cada chave
 * é decidido em `mediakeys.ts` e na sessão.
 */

export const SUITE = 0x0004; // AES_128_GCM_SHA256_128
const NK = 16; // bytes da chave AES
const NN = 12; // bytes do nonce
const NT = 16; // bytes da tag
const U64_MAX = (1n << 64n) - 1n;
const te = new TextEncoder();
const EMPTY = new Uint8Array(0);

/** Inteiro sem sinal em big-endian com o mínimo de bytes (pelo menos 1). */
function minBytes(v: bigint): Uint8Array {
  const out: number[] = [];
  do {
    out.unshift(Number(v & 0xffn));
    v >>= 8n;
  } while (v > 0n);
  return Uint8Array.from(out);
}

function be(v: bigint, n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = n - 1; i >= 0; i--, v >>= 8n) out[i] = Number(v & 0xffn);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const inRange = (v: bigint) => v >= 0n && v <= U64_MAX;

/** Cabeçalho SFrame (§4.3): valores 0–7 vão no próprio byte de configuração; os outros, no mínimo de bytes. */
export function encodeHeader(kid: bigint, ctr: bigint): Uint8Array {
  if (!inRange(kid) || !inRange(ctr)) throw new RangeError("KID/CTR fora de 64 bits");
  let cfg = 0;
  const tail: Uint8Array[] = [];
  if (kid < 8n) cfg |= Number(kid) << 4;
  else {
    const k = minBytes(kid);
    cfg |= 0x80 | ((k.length - 1) << 4);
    tail.push(k);
  }
  if (ctr < 8n) cfg |= Number(ctr);
  else {
    const c = minBytes(ctr);
    cfg |= 0x08 | (c.length - 1);
    tail.push(c);
  }
  return concat(Uint8Array.of(cfg), ...tail);
}

export type Header = { kid: bigint; ctr: bigint; length: number };

function readUint(buf: Uint8Array, off: number, len: number): bigint | null {
  if (off + len > buf.length) return null;
  // codificação não mínima (zero à esquerda, ou valor que caberia no byte de configuração) é recusada
  if (len > 1 && buf[off] === 0) return null;
  let v = 0n;
  for (let i = 0; i < len; i++) v = (v << 8n) | BigInt(buf[off + i]);
  return v;
}

/** Lê o cabeçalho; `null` se estiver truncado ou não for a codificação mínima exigida pelo RFC. */
export function decodeHeader(buf: Uint8Array): Header | null {
  if (!buf.length) return null;
  const cfg = buf[0];
  let off = 1;
  let kid: bigint;
  if (cfg & 0x80) {
    const len = ((cfg >> 4) & 0x07) + 1;
    const v = readUint(buf, off, len);
    if (v === null || v < 8n) return null;
    kid = v;
    off += len;
  } else kid = BigInt((cfg >> 4) & 0x07);
  let ctr: bigint;
  if (cfg & 0x08) {
    const len = (cfg & 0x07) + 1;
    const v = readUint(buf, off, len);
    if (v === null || v < 8n) return null;
    ctr = v;
    off += len;
  } else ctr = BigInt(cfg & 0x07);
  return { kid, ctr, length: off };
}

/** sframe_key e sframe_salt (§4.4.2), em bytes. Exposto para os vetores de teste do RFC. */
export async function deriveKeySaltBytes(kid: bigint, baseKey: Uint8Array): Promise<{ key: Uint8Array; salt: Uint8Array }> {
  if (!inRange(kid)) throw new RangeError("KID fora de 64 bits");
  const label = (what: string) => concat(te.encode(`SFrame 1.0 Secret ${what} `), be(kid, 8), be(BigInt(SUITE), 2));
  const ikm = await crypto.subtle.importKey("raw", baseKey as BufferSource, "HKDF", false, ["deriveBits"]);
  // HKDF do WebCrypto = Extract(salt, ikm) + Expand(info): com salt vazio é exatamente o do RFC
  const hkdf = (info: Uint8Array, bytes: number) => crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: EMPTY, info: info as BufferSource }, ikm, bytes * 8);
  const [key, salt] = await Promise.all([hkdf(label("key"), NK), hkdf(label("salt"), NN)]);
  return { key: new Uint8Array(key), salt: new Uint8Array(salt) };
}

export type KeySalt = { key: CryptoKey; salt: Uint8Array };

/**
 * Chave pronta para usar. O RFC exige que cada base_key sirva só para cifrar ou só para decifrar (§4.4.1),
 * então o uso é fixado aqui e a chave AES não pode ser exportada.
 */
export async function deriveKeySalt(kid: bigint, baseKey: Uint8Array, usage: "encrypt" | "decrypt"): Promise<KeySalt> {
  const raw = await deriveKeySaltBytes(kid, baseKey);
  const key = await crypto.subtle.importKey("raw", raw.key as BufferSource, "AES-GCM", false, [usage]);
  raw.key.fill(0);
  return { key, salt: raw.salt };
}

function nonce(salt: Uint8Array, ctr: bigint): Uint8Array {
  const c = be(ctr, NN);
  const n = new Uint8Array(NN);
  for (let i = 0; i < NN; i++) n[i] = salt[i] ^ c[i];
  return n;
}

/** Cifra um quadro com um CTR dado (§4.4.3). Use `SframeSender`, que nunca repete o CTR. */
export async function encryptWith(ks: KeySalt, kid: bigint, ctr: bigint, plaintext: Uint8Array, metadata: Uint8Array = EMPTY): Promise<Uint8Array> {
  const header = encodeHeader(kid, ctr);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce(ks.salt, ctr) as BufferSource, additionalData: concat(header, metadata) as BufferSource, tagLength: NT * 8 },
    ks.key,
    plaintext as BufferSource,
  );
  return concat(header, new Uint8Array(ct));
}

/**
 * Decifra um quadro SFrame (§4.4.4). `keyFor` escolhe a chave pelo KID do cabeçalho; `null` se não
 * houver chave, se o cabeçalho for inválido ou se a autenticação falhar (o quadro deve ser descartado).
 */
export async function decrypt(keyFor: (kid: bigint) => KeySalt | null, frame: Uint8Array, metadata: Uint8Array = EMPTY): Promise<{ kid: bigint; ctr: bigint; plaintext: Uint8Array } | null> {
  const h = decodeHeader(frame);
  if (!h || frame.length < h.length + NT) return null;
  const ks = keyFor(h.kid);
  if (!ks) return null;
  try {
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce(ks.salt, h.ctr) as BufferSource, additionalData: concat(frame.subarray(0, h.length), metadata) as BufferSource, tagLength: NT * 8 },
      ks.key,
      frame.subarray(h.length) as BufferSource,
    );
    return { kid: h.kid, ctr: h.ctr, plaintext: new Uint8Array(pt) };
  } catch {
    return null;
  }
}

/**
 * Quem envia: uma base_key, um KID e um contador que nunca se repete. O contador é reservado antes
 * de qualquer `await`, então várias conexões cifrando ao mesmo tempo com a mesma chave (o mesmo
 * microfone indo para cada amigo) nunca reutilizam um nonce.
 */
export class SframeSender {
  private ctr = 0n;
  private constructor(
    readonly kid: bigint,
    private ks: KeySalt,
  ) {}

  static async create(kid: bigint, baseKey: Uint8Array) {
    return new SframeSender(kid, await deriveKeySalt(kid, baseKey, "encrypt"));
  }

  encrypt(plaintext: Uint8Array, metadata?: Uint8Array): Promise<Uint8Array> {
    const ctr = this.ctr;
    if (ctr > U64_MAX) throw new RangeError("contador do SFrame esgotado: troque a chave");
    this.ctr = ctr + 1n;
    return encryptWith(this.ks, this.kid, ctr, plaintext, metadata);
  }
}
