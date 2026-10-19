import type { Profile, ServerInfo, Settings } from "./types";

import { openString, sealString } from "./vault";

const PREFIX = "nexo:";
const cache = new Map<string, unknown>();
const writes = new Map<string, Promise<void>>();

/**
 * Armazenamento local cifrado. Na inicialização decifra tudo para a memória;
 * cada gravação é cifrada (AES-256-GCM, AAD = nome da chave) antes de ir ao disco.
 * Valores antigos em texto puro são cifrados na hora (migração).
 */
export async function initSecureStore() {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(PREFIX)) keys.push(k.slice(PREFIX.length));
  }
  for (const k of keys) {
    const raw = localStorage.getItem(PREFIX + k);
    if (raw == null) continue;
    try {
      if (raw.startsWith("v1:")) cache.set(k, JSON.parse(await openString(raw, "ls:" + k)));
      else {
        const v = JSON.parse(raw);
        cache.set(k, v);
        write(k, v); // migra texto puro → cifrado
      }
    } catch (e) {
      console.warn("registro local ilegível, descartado:", k, e);
      localStorage.removeItem(PREFIX + k);
    }
  }
}

function read<T>(key: string, fallback: T): T {
  return cache.has(key) ? (structuredClone(cache.get(key)) as T) : fallback;
}

function write(key: string, value: unknown) {
  cache.set(key, structuredClone(value));
  const json = JSON.stringify(value);
  // grava em ordem por chave, mesmo com cifragem assíncrona
  const prev = writes.get(key) ?? Promise.resolve();
  const next = prev
    .then(async () => localStorage.setItem(PREFIX + key, await sealString(json, "ls:" + key)))
    .catch((e) => console.warn("falha ao salvar", key, e));
  writes.set(key, next);
}

function remove(key: string) {
  cache.delete(key);
  localStorage.removeItem(PREFIX + key);
}

/** Espera todas as gravações pendentes (antes de recarregar o app). */
export async function flushSecureStore() {
  await Promise.all(writes.values());
}

export const defaultSettings: Settings = {
  inputDevice: "default",
  outputDevice: "default",
  videoDevice: "default",
  inputVolume: 100,
  outputVolume: 100,
  vadMode: "auto",
  vadThreshold: -50,
  pttKey: "KeyV",
  pttDelay: 200,
  noiseSuppression: true,
  echoCancellation: true,
  autoGain: true,
  preset: "medium",
  quality: "1080p30",
  bitrate: 4000,
  streamSlots: 3,
  contentHint: "motion",
  codec: "auto",
  notifyDesktop: true,
  notifySounds: true,
  notifyMode: "all",
  mutedServers: [],
  mutedChannels: [],
  uiSounds: true,
  fontScale: 100,
  compact: false,
  zoom: 100,
  keyMute: "CommandOrControl+Shift+M",
  keyDeafen: "CommandOrControl+Shift+D",
  turnUrl: "",
  turnUser: "",
  turnPass: "",
  relayUrls: "",
  closeToTray: true,
  launchAtLogin: false,
  // seguro por padrão: nada que vaze seu IP para sites de terceiros sem você pedir
  linkPreviews: false,
  notifyPreview: false,
  relayOnly: false,
};

export const PRESETS: Record<Exclude<Settings["preset"], "custom">, Pick<Settings, "quality" | "bitrate" | "streamSlots">> = {
  low: { quality: "720p30", bitrate: 1500, streamSlots: 2 },
  medium: { quality: "1080p30", bitrate: 4000, streamSlots: 3 },
  high: { quality: "1080p60", bitrate: 8000, streamSlots: 4 },
};

type LegacyServer = Partial<ServerInfo> & { roomId: string; password: string; name: string };

export const storage = {
  loadProfile: () => read<Profile | null>("profile", null),
  saveProfile: (p: Profile) => write("profile", p),
  loadSettings: (): Settings => ({ ...defaultSettings, ...read<Partial<Settings>>("settings", {}) }),
  saveSettings: (s: Settings) => write("settings", s),
  loadServers: (): ServerInfo[] =>
    read<LegacyServer[]>("servers", []).map((s) => ({
      sid: s.sid ?? s.roomId,
      roomId: s.roomId,
      password: s.password,
      owner: s.owner ?? "",
      name: s.name,
      channels: s.channels ?? [{ id: "geral", name: "geral" }],
      joinedAt: s.joinedAt ?? Date.now(),
    })),
  saveServers: (s: ServerInfo[]) => write("servers", s),
  removeLegacyMessages: (roomId: string) => remove("msgs:" + roomId),
  get: read,
  set: write,
  remove,
};

export function randomId(len = 16): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/** Código de convite: contém tudo que é preciso para achar os outros (não existe servidor central). */
export function encodeInvite(s: ServerInfo): string {
  const json = JSON.stringify({ n: s.name, r: s.roomId, p: s.password, o: s.owner, s: s.sid });
  const b64 = btoa(unescape(encodeURIComponent(json)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return "nexo-" + b64;
}

export const inviteLink = (s: ServerInfo) => "nexo://join/" + encodeInvite(s);

export type Invite = { name: string; roomId: string; password: string; owner: string; sid: string };

export function decodeInvite(input: string): Invite | null {
  try {
    const m = input.trim().match(/nexo-([A-Za-z0-9_-]+)/);
    if (!m) return null;
    const raw = m[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(decodeURIComponent(escape(atob(raw))));
    if (typeof json.r !== "string" || typeof json.p !== "string") return null;
    return { name: String(json.n ?? "Servidor"), roomId: json.r, password: json.p, owner: typeof json.o === "string" ? json.o : "", sid: typeof json.s === "string" ? json.s : json.r };
  } catch {
    return null;
  }
}
