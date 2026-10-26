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
