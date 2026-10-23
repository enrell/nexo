/**
 * Regras de entrada dos eventos assinados.
 *
 * A assinatura prova QUEM mandou, não que o conteúdo seja são: qualquer membro pode assinar
 * um evento com campos de tipo errado (ex.: `att: [{}]`), e como o evento fica guardado, ele
 * seria renderizado de novo a cada abertura do app em todos os PCs. Por isso todo evento recebido
 * passa por `validateBody` antes de entrar no log.
 *
 * A validação só aceita ou recusa: nunca reescreve o corpo, senão a assinatura de quem repassa
 * o evento (sincronização) deixaria de bater.
 */
import { isPubKey, sha256, verify } from "./identity";
import type { EventBody, SignedEvent } from "./types";

export const MAX_EVENT_BYTES = 24 * 1024;
export const MAX_TEXT = 4000;
export const MAX_FUTURE_MS = 5 * 60_000;

/** Ações de governança: só valem de quem é admin (ou dono) para quem as recebe. */
export const GOVERNANCE = new Set(["role", "ban", "chan", "name", "move", "admit", "policy"]);
export const KINDS = new Set(["msg", "edit", "del", "react", ...GOVERNANCE]);

/** O texto exato que é assinado e do qual sai o id do evento. */
export const canonical = (a: string, ts: number, b: EventBody) => JSON.stringify([a, ts, b]);

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const PUB = /^[A-Za-z0-9_-]{43}$/;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max: number, min = 0): v is string => typeof v === "string" && v.length >= min && v.length <= max;
const id = (v: unknown): v is string => typeof v === "string" && ID.test(v);
const pub = (v: unknown): v is string => typeof v === "string" && PUB.test(v);
const optStr = (v: unknown, max: number) => v === undefined || str(v, max);
const num = (v: unknown, max: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max;

function validAttachment(a: unknown): boolean {
  if (!isObj(a)) return false;
  if (!id(a.id) || !str(a.name, 255) || !str(a.mime, 127) || !num(a.size, 2 ** 40)) return false;
  for (const dim of [a.w, a.h]) if (dim !== undefined && !(Number.isInteger(dim) && (dim as number) > 0 && (dim as number) <= 100_000)) return false;
  return true;
}

/** `true` se o corpo tem a forma que o app espera para o seu tipo (`k`). */
export function validateBody(b: unknown): b is EventBody {
  if (!isObj(b) || typeof b.k !== "string") return false;
  switch (b.k) {
    case "msg":
      return (
        id(b.ch) && str(b.text, MAX_TEXT) && optStr(b.n, 64) && (b.reply === undefined || id(b.reply)) && (b.att === undefined || (Array.isArray(b.att) && b.att.length <= 10 && b.att.every(validAttachment)))
      );
    case "edit":
      return id(b.target) && str(b.text, MAX_TEXT);
    case "del":
      return id(b.target);
    case "react":
      return id(b.target) && str(b.emoji, 16, 1) && typeof b.on === "boolean";
    case "role":
      return pub(b.user) && (b.role === "admin" || b.role === "member");
    case "ban":
      return pub(b.user) && typeof b.on === "boolean" && optStr(b.reason, 200);
    case "chan":
      return id(b.id) && str(b.name, 40) && (b.del === undefined || typeof b.del === "boolean") && (b.del === true || str(b.name, 40, 1));
    case "name":
      return str(b.name, 60, 1);
    case "move":
      return id(b.r) && id(b.p);
    case "admit":
      return pub(b.user) && typeof b.on === "boolean";
    case "policy":
      return typeof b.approval === "boolean";
    default:
      return false;
  }
}

/**
 * Confere um evento recebido da rede: forma, relógio, tamanho, id (hash do conteúdo) e assinatura.
 * Devolve o evento pronto para guardar, ou `null` se qualquer conferência falhar.
 * (As regras que dependem do estado do servidor — banido, quarentena de governança — ficam na sessão.)
 */
export async function verifyEvent(e: unknown, now = Date.now()): Promise<SignedEvent | null> {
  if (!isObj(e) || typeof e.id !== "string" || !Number.isSafeInteger(e.ts) || typeof e.s !== "string") return null;
  const ts = e.ts as number;
  if (ts > now + MAX_FUTURE_MS || !isPubKey(e.a) || !validateBody(e.b) || !KINDS.has(e.b.k)) return null;
  const data = canonical(e.a, ts, e.b);
  if (data.length > MAX_EVENT_BYTES) return null;
  if ((await sha256(data)) !== e.id) return null;
  if (!(await verify(e.a, data, e.s))) return null;
  return { id: e.id, a: e.a, ts, b: e.b, s: e.s };
}
