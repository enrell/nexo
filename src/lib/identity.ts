/**
 * Identidade criptográfica: cada usuário tem um par de chaves Ed25519.
 * A chave pública é o ID do usuário; tudo que ele publica (mensagens, edições,
 * ações de moderação) é assinado, então ninguém consegue se passar por outro.
 */
const enc = new TextEncoder();
const KEY = "nexo:identity";

export function b64u(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64u(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function sha256(data: string | ArrayBuffer, len = 22): Promise<string> {
  const bytes = typeof data === "string" ? enc.encode(data) : data;
  return b64u(await crypto.subtle.digest("SHA-256", bytes)).slice(0, len);
}

const pubCache = new Map<string, Promise<CryptoKey>>();
function importPub(pub: string) {
  let k = pubCache.get(pub);
  if (!k) {
    k = crypto.subtle.importKey("raw", fromB64u(pub), { name: "Ed25519" }, false, ["verify"]);
    pubCache.set(pub, k);
  }
  return k;
}

export async function verify(pub: string, data: string, sig: string): Promise<boolean> {
  try {
    if (typeof pub !== "string" || typeof sig !== "string" || pub.length !== 43) return false;
    return await crypto.subtle.verify({ name: "Ed25519" }, await importPub(pub), fromB64u(sig), enc.encode(data));
  } catch {
    return false;
  }
}

export class Identity {
  private constructor(
    public readonly pub: string,
    private readonly key: CryptoKey,
  ) {}

  static async load(): Promise<Identity> {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const { pub, jwk } = JSON.parse(raw) as { pub: string; jwk: JsonWebKey };
        const key = await crypto.subtle.importKey("jwk", jwk, { name: "Ed25519" }, true, ["sign"]);
        return new Identity(pub, key);
      }
    } catch (e) {
      console.warn("identidade corrompida, gerando nova", e);
    }
    const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const pub = b64u(await crypto.subtle.exportKey("raw", pair.publicKey));
    const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    localStorage.setItem(KEY, JSON.stringify({ pub, jwk }));
    return new Identity(pub, pair.privateKey);
  }

  async sign(data: string): Promise<string> {
    return b64u(await crypto.subtle.sign({ name: "Ed25519" }, this.key, enc.encode(data)));
  }

  /** Para backup/restauração da conta em outro PC. */
  exportBackup(): string {
    return localStorage.getItem(KEY) ?? "";
  }
}

export const shortKey = (pub: string) => pub.slice(0, 6);
