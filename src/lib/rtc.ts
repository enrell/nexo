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
 * Candidato "endereço externo do roteador" para um candidato host IPv4 cuja porta foi aberta via
 * UPnP/NAT-PMP. Vira srflx (como o que o STUN descobriria), com prioridade de srflx.
 */
export function mappedCandidate(host: string, ext: { ip: string; port: number }): string | null {
  const f = host.replace(/^a=/, "").trim().split(/\s+/);
  // candidate:<fundação> <componente> udp <prioridade> <ip> <porta> typ host ...
  if (f.length < 8 || !f[0].startsWith("candidate:") || f[2].toLowerCase() !== "udp" || f[6] !== "typ" || f[7] !== "host") return null;
  const comp = Number(f[1]);
  if (!Number.isInteger(comp) || comp < 1 || comp > 256) return null;
  const ufrag = f.indexOf("ufrag");
  const priority = 100 * 2 ** 24 + 65535 * 2 ** 8 + (256 - comp);
  return `candidate:nexo${ext.port} ${comp} udp ${priority} ${ext.ip} ${ext.port} typ srflx raddr ${f[4]} rport ${f[5]} generation 0${ufrag > 0 && f[ufrag + 1] ? " ufrag " + f[ufrag + 1] : ""}`;
}

/**
 * RTCPeerConnection do Nexo: aplica o certificado fixo, a política de ICE
 * (só TURN, para esconder o IP, se o usuário pedir) e a preferência de codec.
 * "auto" prefere H.264 (normalmente codificado pela placa de vídeo).
 */
export function makePeerConnectionClass(getCodec: () => Codec, relayOnly: boolean, usePortMap: () => boolean = () => false): typeof RTCPeerConnection {
  return class NexoPeerConnection extends RTCPeerConnection {
    private mappedPorts = new Set<number>();
    private synthetic = new WeakSet<RTCIceCandidate>();

    constructor(config?: RTCConfiguration) {
      super({
        ...config,
        certificates: certificate ? [certificate] : config?.certificates,
        iceTransportPolicy: relayOnly ? "relay" : config?.iceTransportPolicy,
        bundlePolicy: "max-bundle",
        rtcpMuxPolicy: "require",
      });
      // porta aberta no roteador (UPnP/NAT-PMP): anuncia também "IP externo:porta" para quem está
      // atrás de CGNAT conseguir chegar direto em nós
      if (!relayOnly) this.addEventListener("icecandidate", (ev) => void this.announceMapped(ev.candidate));
      this.addEventListener("connectionstatechange", () => this.connectionState === "closed" && this.releasePorts());
    }

    private async announceMapped(c: RTCIceCandidate | null) {
      const api = window.nexo;
      if (!c || this.synthetic.has(c) || c.type !== "host" || c.protocol !== "udp" || !c.address || c.address.includes(":") || !c.port || !api?.portMap || !usePortMap()) return;
      const ext = await api.portMap(c.address, c.port).catch(() => null);
      if (!ext) return;
      this.mappedPorts.add(c.port);
      if (this.connectionState === "closed") return this.releasePorts();
      const line = mappedCandidate(c.candidate, ext);
      if (!line) return;
      const cand = new RTCIceCandidate({ candidate: line, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex, usernameFragment: c.usernameFragment });
      this.synthetic.add(cand);
      this.dispatchEvent(new RTCPeerConnectionIceEvent("icecandidate", { candidate: cand }));
    }

    private releasePorts() {
      for (const p of this.mappedPorts) void window.nexo?.portMapRelease(p).catch(() => {});
      this.mappedPorts.clear();
    }

    close() {
      this.releasePorts();
      super.close();
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
