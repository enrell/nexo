/**
 * Tudo que um peer manda sobre si (perfil, presença, transmissão) é entrada de rede não confiável:
 * a conexão prova QUEM ele é, não que os campos tenham o tipo certo. Estas funções devolvem sempre
 * um valor seguro de desenhar e de guardar, e nunca copiam chaves desconhecidas (nada de
 * `Object.assign(peer, mensagem)`: um peer poderia trocar o próprio `pub` pelo de um admin).
 */
import { isPubKey } from "./identity";
import type { LiveInfo, PeerInfo, Profile } from "./types";

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export function sanitizeProfile(p: unknown, userId = ""): Profile {
  const o = isObj(p) ? p : {};
  const name = typeof o.name === "string" ? o.name.slice(0, 32) : "";
  return {
    userId,
    name: name.trim() ? name : "?",
    color: typeof o.color === "string" && /^#[0-9a-f]{6}$/i.test(o.color) ? o.color : "#80848e",
    avatar: typeof o.avatar === "string" && o.avatar.length < 60_000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(o.avatar) ? o.avatar : undefined,
    status: o.status === "idle" || o.status === "dnd" ? o.status : "online",
    relaySlots: Math.max(0, Math.min(8, Math.trunc(Number(o.relaySlots)) || 0)),
  };
}

/** Miniatura da live: só uma imagem JPEG embutida (nunca uma URL, que faria o seu PC acessar um site). */
export function sanitizeThumb(t: unknown): string | undefined {
  const PREFIX = "data:image/jpeg;base64,";
  return typeof t === "string" && t.startsWith(PREFIX) && t.length < 80_000 && /^[A-Za-z0-9+/=]*$/.test(t.slice(PREFIX.length)) ? t : undefined;
}

export function sanitizeLive(l: unknown, now = Date.now()): LiveInfo | null {
  if (!isObj(l)) return null;
  const startedAt = typeof l.startedAt === "number" && Number.isFinite(l.startedAt) ? Math.min(l.startedAt, now) : now;
  const out: LiveInfo = {
    title: typeof l.title === "string" ? l.title.slice(0, 120) : "",
    kind: l.kind === "camera" ? "camera" : "screen",
    startedAt: Math.max(0, startedAt),
    viewers: Math.max(0, Math.min(100_000, Math.trunc(Number(l.viewers)) || 0)),
    audio: l.audio === true,
  };
  if (Array.isArray(l.viewerKeys)) out.viewerKeys = l.viewerKeys.filter(isPubKey).slice(0, 512);
  return out;
}

export type PresencePatch = Partial<Pick<PeerInfo, "live" | "inVoice" | "muted" | "deaf" | "profile" | "thumb">>;

/**
 * Atualização de presença de um peer. Só as chaves conhecidas passam, já validadas.
 * `profileOnly`: quem ainda não é membro só pode atualizar nome e foto.
 */
export function sanitizePatch(raw: unknown, pub: string, profileOnly: boolean): PresencePatch {
  if (!isObj(raw)) return {};
  const out: PresencePatch = {};
  if (Object.hasOwn(raw, "profile") && raw.profile) out.profile = sanitizeProfile(raw.profile, pub);
  if (profileOnly) return out;
  if (Object.hasOwn(raw, "live")) out.live = sanitizeLive(raw.live);
  if (Object.hasOwn(raw, "inVoice")) out.inVoice = !!raw.inVoice;
  if (Object.hasOwn(raw, "muted")) out.muted = !!raw.muted;
  if (Object.hasOwn(raw, "deaf")) out.deaf = !!raw.deaf;
  if (Object.hasOwn(raw, "thumb")) out.thumb = sanitizeThumb(raw.thumb);
  return out;
}
