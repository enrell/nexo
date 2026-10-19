/**
 * Cofre local: tudo o que o Nexo grava no disco (perfil, chave de identidade,
 * convites, configurações, mensagens, anexos) é cifrado com AES-256-GCM.
 *
 * A chave vem do processo principal, que a guarda protegida pelo sistema
 * operacional (DPAPI no Windows). Ela é importada como não-extraível: nem o
 * próprio código da página consegue lê-la de volta.
 *
 * Cada registro usa um "dado associado" (AAD) com o seu nome/ID, então um
 * registro cifrado não pode ser trocado de lugar por outro sem ser detectado.
 */
import { b64u, fromB64u } from "./bytes";

const enc = new TextEncoder();
const dec = new TextDecoder();
let key: CryptoKey | null = null;

export async function initVault(): Promise<void> {
  if (key) return;
  let raw: Uint8Array<ArrayBuffer>;
  if (window.nexo) {
    const b64 = await window.nexo.getVaultKey();
    raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  } else {
    // navegador comum (só desenvolvimento): chave efêmera, nada sobrevive ao recarregar
    raw = crypto.getRandomValues(new Uint8Array(32));
  }
  key = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  raw.fill(0);
}

function k(): CryptoKey {
  if (!key) throw new Error("cofre não inicializado");
  return key;
}

/** Cifra bytes: retorna iv(12) || texto cifrado+tag. */
export async function seal(data: Uint8Array<ArrayBuffer> | ArrayBuffer, aad: string): Promise<Uint8Array<ArrayBuffer>> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(aad) }, k(), data));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}

export async function open(box: Uint8Array<ArrayBuffer> | ArrayBuffer, aad: string): Promise<ArrayBuffer> {
  const b = box instanceof Uint8Array ? box : new Uint8Array(box);
  return crypto.subtle.decrypt({ name: "AES-GCM", iv: b.slice(0, 12), additionalData: enc.encode(aad) }, k(), b.slice(12));
}

export async function sealJson(value: unknown, aad: string) {
  return seal(enc.encode(JSON.stringify(value)), aad);
}
export async function openJson<T>(box: Uint8Array<ArrayBuffer> | ArrayBuffer, aad: string): Promise<T> {
  return JSON.parse(dec.decode(await open(box, aad))) as T;
}

export async function sealString(value: string, aad: string): Promise<string> {
  return "v1:" + b64u(await sealJson(value, aad));
}
export async function openString(s: string, aad: string): Promise<string> {
  return openJson<string>(fromB64u(s.slice(3)), aad);
}
