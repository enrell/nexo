/**
 * Identidade criptográfica: cada usuário tem um par de chaves Ed25519.
 * A chave pública é o ID do usuário; tudo que ele publica (mensagens, edições,
 * ações de moderação) é assinado, então ninguém consegue se passar por outro.
 * A chave privada fica no armazenamento local cifrado (ver vault.ts).
 */
import { b64u, fromB64u } from "./bytes";
import { storage } from "./storage";

export { b64u, fromB64u };

const enc = new TextEncoder();
const dec = new TextDecoder();
const KEY = "identity";
const BACKUP_ITERATIONS = 600_000;

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
    if (pubCache.size > 2000) pubCache.delete(pubCache.keys().next().value!);
  }
  return k;
}

export const isPubKey = (pub: unknown): pub is string => typeof pub === "string" && /^[A-Za-z0-9_-]{43}$/.test(pub);

export async function verify(pub: string, data: string, sig: string): Promise<boolean> {
  try {
    if (!isPubKey(pub) || typeof sig !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(sig)) return false;
    return await crypto.subtle.verify({ name: "Ed25519" }, await importPub(pub), fromB64u(sig), enc.encode(data));
  } catch {
    return false;
  }
}

type StoredIdentity = { pub: string; jwk: JsonWebKey };

export class Identity {
  private constructor(
    public readonly pub: string,
    private readonly key: CryptoKey,
    private readonly jwk: JsonWebKey,
  ) {}

  static async load(): Promise<Identity> {
    const saved = storage.get<StoredIdentity | null>(KEY, null);
    if (saved) {
      try {
        // não-extraível: depois de importada, a chave privada não sai mais do WebCrypto
        const key = await crypto.subtle.importKey("jwk", saved.jwk, { name: "Ed25519" }, false, ["sign"]);
        return new Identity(saved.pub, key, saved.jwk);
      } catch (e) {
        console.warn("identidade corrompida, gerando nova", e);
      }
    }
    const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const pub = b64u(await crypto.subtle.exportKey("raw", pair.publicKey));
    const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    storage.set(KEY, { pub, jwk } satisfies StoredIdentity);
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "Ed25519" }, false, ["sign"]);
    return new Identity(pub, key, jwk);
  }

  async sign(data: string): Promise<string> {
    return b64u(await crypto.subtle.sign({ name: "Ed25519" }, this.key, enc.encode(data)));
  }

  /** Backup da conta cifrado com uma senha (PBKDF2-SHA256 600k + AES-256-GCM). */
  async exportBackup(passphrase: string, extra: Record<string, unknown>): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await backupKey(passphrase, salt, BACKUP_ITERATIONS);
    const plain = enc.encode(JSON.stringify({ identity: { pub: this.pub, jwk: this.jwk }, ...extra }));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode("nexo-backup-v2") }, key, plain);
    return JSON.stringify({ nexoBackup: 2, kdf: "PBKDF2-SHA256", iterations: BACKUP_ITERATIONS, salt: b64u(salt), iv: b64u(iv), data: b64u(ct) }, null, 2);
  }
}

async function backupKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const base = await crypto.subtle.importKey("raw", enc.encode(passphrase.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export type BackupContents = { identity: StoredIdentity; profile?: unknown; servers?: unknown };

/** Abre um backup. Lança erro se a senha estiver errada ou o arquivo tiver sido alterado. */
export async function openBackup(text: string, passphrase: string): Promise<BackupContents> {
  const d = JSON.parse(text);
  if (d?.nexoBackup !== 2 || d.kdf !== "PBKDF2-SHA256") throw new Error("arquivo de backup inválido");
  const iterations = Number(d.iterations);
  if (!(iterations >= 100_000 && iterations <= 10_000_000)) throw new Error("parâmetros de backup inválidos");
  const key = await backupKey(passphrase, fromB64u(d.salt), iterations);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64u(d.iv), additionalData: enc.encode("nexo-backup-v2") }, key, fromB64u(d.data));
  } catch {
    throw new Error("senha errada ou arquivo alterado");
  }
  const out = JSON.parse(dec.decode(plain)) as BackupContents;
  if (!isPubKey(out.identity?.pub) || !out.identity.jwk) throw new Error("backup sem identidade");
  // confere que a chave privada corresponde à pública
  const priv = await crypto.subtle.importKey("jwk", out.identity.jwk, { name: "Ed25519" }, false, ["sign"]);
  const probe = enc.encode("nexo-backup-probe");
  const sig = await crypto.subtle.sign({ name: "Ed25519" }, priv, probe);
  if (!(await crypto.subtle.verify({ name: "Ed25519" }, await importPub(out.identity.pub), sig, probe))) throw new Error("backup inconsistente");
  return out;
}

/** Grava a identidade restaurada (o app recarrega em seguida). */
export function storeRestoredIdentity(id: StoredIdentity) {
  storage.set(KEY, id);
}

/**
 * Número de segurança entre duas pessoas (como no Signal): se os dois veem o
 * mesmo número, ninguém está se passando por nenhum dos dois.
 */
export async function safetyNumber(a: string, b: string): Promise<string> {
  const [x, y] = [a, b].sort();
  let data: ArrayBuffer = enc.encode("nexo-safety-v1:" + x + ":" + y).buffer as ArrayBuffer;
  for (let i = 0; i < 1024; i++) data = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(data);
  const groups: string[] = [];
  for (let i = 0; i < 12; i++) {
    const n = ((bytes[i * 2] << 8) | bytes[i * 2 + 1]) % 100000;
    groups.push(String(n).padStart(5, "0"));
  }
  return groups.join(" ");
}

export const shortKey = (pub: string) => pub.slice(0, 6);
