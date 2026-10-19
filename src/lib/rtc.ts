import type { Codec } from "./types";

const MIME: Record<Exclude<Codec, "auto">, string> = {
  h264: "video/H264",
  vp9: "video/VP9",
  vp8: "video/VP8",
  av1: "video/AV1",
};

let certificate: RTCCertificate | null = null;
let fingerprint = "";

/**
 * Um certificado DTLS por execução do app, usado em todas as conexões.
 * A impressão digital dele é assinada com a chave Ed25519 no handshake, e o outro
 * lado confere que a conexão WebRTC real usa exatamente esse certificado
 * (channel binding): quem só conhece a senha do convite não consegue se
 * colocar no meio da conversa.
 */
export async function initCertificate() {
  if (certificate) return;
  certificate = await RTCPeerConnection.generateCertificate({ name: "ECDSA", namedCurve: "P-256" } as EcKeyGenParams);
  const fp = certificate.getFingerprints().find((f) => f.algorithm === "sha-256");
  if (!fp?.value) throw new Error("não foi possível gerar o certificado DTLS");
  fingerprint = normalizeFp(fp.value);
}

let testFingerprint: string | null = null;
export const myFingerprint = () => testFingerprint ?? fingerprint;
/** Só para o teste automatizado de "intermediário": finge ter outro certificado. */
export function testOverrideFingerprint(fp: string) {
  testFingerprint = fp;
}

const normalizeFp = (v: string) => v.replace(/:/g, "").toUpperCase();

/** Impressão digital (sha-256) que o outro lado apresentou nesta conexão. */
export function remoteFingerprint(pc: RTCPeerConnection): string | null {
  const sdp = pc.remoteDescription?.sdp ?? "";
  const fps = [...sdp.matchAll(/^a=fingerprint:sha-256 ([0-9A-Fa-f:]+)/gm)].map((m) => normalizeFp(m[1]));
  if (!fps.length || fps.some((f) => f !== fps[0])) return null;
  return fps[0];
}

/**
 * RTCPeerConnection do Nexo: aplica o certificado fixo, a política de ICE
 * (só TURN, para esconder o IP, se o usuário pedir) e a preferência de codec.
 * "auto" prefere H.264 (normalmente codificado pela placa de vídeo).
 */
export function makePeerConnectionClass(getCodec: () => Codec, relayOnly: boolean): typeof RTCPeerConnection {
  return class NexoPeerConnection extends RTCPeerConnection {
    constructor(config?: RTCConfiguration) {
      super({
        ...config,
        certificates: certificate ? [certificate] : config?.certificates,
        iceTransportPolicy: relayOnly ? "relay" : config?.iceTransportPolicy,
        bundlePolicy: "max-bundle",
        rtcpMuxPolicy: "require",
      });
    }

    addTrack(track: MediaStreamTrack, ...streams: MediaStream[]): RTCRtpSender {
      const sender = super.addTrack(track, ...streams);
      if (track.kind === "video") {
        try {
          const tr = this.getTransceivers().find((t) => t.sender === sender);
          const caps = RTCRtpSender.getCapabilities("video")?.codecs ?? [];
          const codec = getCodec();
          const order = codec === "auto" ? ["video/H264", "video/VP8"] : [MIME[codec]];
          const rank = (mime: string) => {
            const i = order.indexOf(mime);
            return i === -1 ? order.length : i;
          };
          tr?.setCodecPreferences([...caps].sort((a, b) => rank(a.mimeType) - rank(b.mimeType)));
        } catch (e) {
          console.warn("codec preference", e);
        }
      }
      return sender;
    }
  };
}

/** Mensagem amigável para erros de câmera/microfone/tela. */
export function mediaErrorMessage(e: unknown, what: "microfone" | "câmera" | "tela"): string {
  const name = e instanceof DOMException ? e.name : "";
  switch (name) {
    case "NotAllowedError":
      return what === "tela"
        ? "A captura de tela foi cancelada ou bloqueada."
        : `O acesso ao ${what} foi bloqueado. Libere em Configurações do Windows → Privacidade → ${what === "câmera" ? "Câmera" : "Microfone"}.`;
    case "NotFoundError":
    case "OverconstrainedError":
      return `Nenhum ${what} encontrado. Confira se está conectado ou escolha outro em Configurações → Voz e vídeo.`;
    case "NotReadableError":
    case "AbortError":
      return `O ${what} está sendo usado por outro programa ou travou. Feche o outro app e tente de novo.`;
    default:
      return `Não foi possível usar o ${what}: ${e instanceof Error ? e.message : String(e)}`;
  }
}
