import type { Codec } from "./types";

const MIME: Record<Exclude<Codec, "auto">, string> = {
  h264: "video/H264",
  vp9: "video/VP9",
  vp8: "video/VP8",
  av1: "video/AV1",
};

/**
 * RTCPeerConnection que aplica a preferência de codec em todo vídeo enviado.
 * "auto" prefere H.264, que costuma ter codificação por hardware (menos CPU
 * enquanto você joga), com VP8 como reserva.
 */
export function makePeerConnectionClass(getCodec: () => Codec): typeof RTCPeerConnection {
  return class NexoPeerConnection extends RTCPeerConnection {
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
          const sorted = [...caps].sort((a, b) => rank(a.mimeType) - rank(b.mimeType));
          tr?.setCodecPreferences(sorted);
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
