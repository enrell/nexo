import type { Settings } from "./types";

/**
 * URLs de TURN digitadas pelo usuário (separadas por espaço, vírgula ou linha).
 * Aceitar várias importa no CGNAT agressivo: muitas operadoras bloqueiam UDP, e aí
 * só `turn:...?transport=tcp` ou `turns:...:443` passam.
 */
export function parseTurnUrls(raw: string): string[] {
  const seen = new Set<string>();
  for (const u of raw.split(/[\s,]+/)) {
    if (/^turns?:[^\s]+$/i.test(u)) seen.add(u);
  }
  return [...seen];
}

export function buildTurnConfig(s: Pick<Settings, "turnUrl" | "turnUser" | "turnPass">): RTCIceServer[] | undefined {
  const urls = parseTurnUrls(s.turnUrl);
  if (!urls.length) return undefined;
  return [{ urls, username: s.turnUser || undefined, credential: s.turnPass || undefined }];
}

/** Erro de entrada do Trystero em português, apontando o que fazer. */
export function joinErrorMessage(error: string, hasTurn: boolean): string {
  if (/banid/i.test(error)) return "Você foi banido deste servidor.";
  if (/TURN|after exchanging SDP/i.test(error))
    return hasTurn
      ? "Não consegui conectar a um amigo nem pelo TURN configurado. Confira URL, usuário e senha em Configurações → Rede → Testar TURN."
      : "Não consegui conectar a um amigo: a rede de um de vocês (CGNAT/4G) bloqueia conexão direta. Configure um servidor TURN em Configurações → Rede.";
  return error;
}

/** Credenciais temporárias do TURN da Cloudflare, com validade (ms desde 1970). */
export type SharedTurn = { servers: RTCIceServer[]; exp: number };

export const CF_TURN_MAX_MS = 48 * 3600 * 1000;
const CF_TURN_URL = /^turns?:turn\.cloudflare\.com:(\d{1,5})(?:\?transport=(?:udp|tcp))?$/;
const secret = (s: unknown): s is string => typeof s === "string" && s.length >= 8 && s.length <= 512 && /^[\x21-\x7e]+$/.test(s);

/**
 * TURN que um admin repassou pela rede. Só aceita turn.cloudflare.com: um membro mal-intencionado
 * não consegue mandar todo mundo usar um TURN dele (que veria IPs e poderia derrubar as conexões).
 */
export function sanitizeSharedTurn(raw: unknown, now = Date.now()): SharedTurn | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { servers?: unknown; exp?: unknown };
  if (typeof r.exp !== "number" || !Number.isFinite(r.exp) || r.exp <= now || r.exp > now + CF_TURN_MAX_MS + 60_000) return null;
  const s = Array.isArray(r.servers) && r.servers.length === 1 ? (r.servers[0] as { urls?: unknown; username?: unknown; credential?: unknown }) : null;
  if (!s || !Array.isArray(s.urls) || s.urls.length < 1 || s.urls.length > 16 || !secret(s.username) || !secret(s.credential)) return null;
  const urls = s.urls.filter((u): u is string => typeof u === "string" && CF_TURN_URL.test(u) && !u.includes(":53?") && !u.endsWith(":53"));
  if (urls.length !== s.urls.length) return null;
  return { servers: [{ urls, username: s.username, credential: s.credential }], exp: r.exp };
}

export type TurnTestResult = { ok: boolean; detail: string };

/**
 * Confere de verdade se o TURN responde e aceita a senha: pede só candidatos
 * "relay" e espera pelo menos um.
 */
export async function testTurn(iceServers: RTCIceServer[], timeoutMs = 8000): Promise<TurnTestResult> {
  let pc: RTCPeerConnection;
  try {
    pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: "relay" });
  } catch (e) {
    return { ok: false, detail: `Configuração inválida: ${(e as Error).message}` };
  }
  try {
    const relays = new Set<string>();
    const errors: string[] = [];
    const done = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      pc.onicecandidate = (ev) => {
        if (ev.candidate?.type === "relay") relays.add(ev.candidate.protocol ?? "?");
        if (!ev.candidate) {
          clearTimeout(timer);
          resolve();
        }
      };
      pc.onicecandidateerror = (ev) => {
        const e = ev as RTCPeerConnectionIceErrorEvent;
        errors.push(`${e.url ?? ""} ${e.errorCode} ${e.errorText}`.trim());
      };
    });
    pc.createDataChannel("t");
    await pc.setLocalDescription(await pc.createOffer());
    await done;
    if (relays.size) return { ok: true, detail: `TURN funcionando (${[...relays].join(", ")}).` };
    const auth = errors.some((e) => /\b401\b/.test(e));
    return { ok: false, detail: auth ? "O TURN respondeu, mas recusou usuário/senha." : `O TURN não respondeu.${errors.length ? " " + errors.slice(0, 2).join("; ") : ""}` };
  } finally {
    pc.close();
  }
}
