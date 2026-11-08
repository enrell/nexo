/**
 * SFrame na mídia do Nexo (experimental, desligado por padrão: Configurações → Voz e vídeo).
 *
 * Liga o worker do Encoded Transform às conexões: numa conexão em que **os dois lados** anunciaram
 * suporte (`sf` no hello), todo áudio enviado é cifrado com a minha chave e todo áudio recebido é
 * decifrado com a chave que aquela pessoa me entregou. Vídeo ainda não (ver docs/fusao-laira.md).
 * Quem decide quem recebe chave é a sessão (só membros); aqui não há regra de acesso.
 *
 * Só funciona no navegador/Electron; os testes cobrem a lógica em sframe.ts, mediakeys.ts e
 * sframe-transform.ts.
 */
import { MediaSendKey, sanitizeKeyOffer, type MediaKeyOffer, type SframeOp } from "./mediakeys";
import type { SframeStats, TransformOptions } from "./sframe-transform";

/** Ganchos que a RTCPeerConnection do Nexo chama (rtc.ts), no momento certo da negociação. */
export type MediaHooks = {
  sender: (pc: RTCPeerConnection, sender: RTCRtpSender, track: MediaStreamTrack) => void;
  receiver: (pc: RTCPeerConnection, ev: RTCTrackEvent) => void;
};

/** Quem está do outro lado de uma conexão e se ele combinou SFrame. */
export type PeerOf = (pc: RTCPeerConnection) => { pub: string; sf: boolean } | null;

export const e2eeSupported = () => typeof RTCRtpScriptTransform === "function" && typeof Worker === "function";

export class MediaE2ee {
  private send = new MediaSendKey();
  /** contagens do worker (cifrados, decifrados, descartados), para o diagnóstico */
  stats: SframeStats | null = null;
  /** preenchido pelo app: procura a conexão em todas as sessões */
  peerOf: PeerOf = () => null;
  /** a chave de envio mudou: o app reenvia a oferta em todas as sessões */
  onRotate: () => void = () => {};
  /** preenchido pelo app: em outro servidor esta pessoa ainda é membro e me deu a chave dela */
  heldElsewhere: (pub: string) => boolean = () => false;

  private constructor(private worker: Worker) {
    worker.onmessage = (e: MessageEvent<{ stats?: SframeStats }>) => {
      if (!e.data?.stats) return;
      if (e.data.stats.dropped > (this.stats?.dropped ?? 0)) console.warn("sframe: quadros de áudio descartados", e.data.stats);
      this.stats = e.data.stats;
    };
    this.post(this.send.initialOp());
  }

  /** `null` se o Chromium não tem RTCRtpScriptTransform: aí nem anunciamos suporte e ninguém cifra para nós. */
  static create(): MediaE2ee | null {
    if (!e2eeSupported()) return null;
    return new MediaE2ee(new Worker(new URL("./sframe.worker.ts", import.meta.url), { type: "module", name: "sframe" }));
  }

  get kid() {
    return this.send.kid;
  }

  offer(): MediaKeyOffer {
    return this.send.offer();
  }

  /** Chave de envio de `pub` (a sessão já conferiu que é um membro). Oferta malformada é ignorada. */
  accept(pub: string, raw: unknown) {
    const k = sanitizeKeyOffer(raw);
    if (k) this.post({ t: "recv", pub, kid: k.kid, key: k.key });
  }

  /** Banido num servidor: esquece a chave dele, a menos que ele siga membro comigo em outro. */
  forget(pub: string) {
    if (!this.heldElsewhere(pub)) this.post({ t: "forget", pub });
  }

  /** Chave nova; o worker só passa a usá-la depois de ROTATE_DELAY_MS, tempo de a oferta chegar. */
  rotate() {
    this.post(this.send.rotate());
    this.onRotate();
  }

  private post(op: SframeOp) {
    this.worker.postMessage(op, "key" in op ? [op.key.buffer] : []);
  }

  private attach(target: RTCRtpSender | RTCRtpReceiver, opts: TransformOptions) {
    try {
      (target as { transform?: unknown }).transform = new RTCRtpScriptTransform(this.worker, opts);
    } catch (e) {
      console.warn("sframe: não consegui ligar o transform", e);
    }
  }

  hooks: MediaHooks = {
    sender: (pc, sender, track) => {
      if (track.kind === "audio" && this.peerOf(pc)?.sf) this.attach(sender, { side: "send" });
    },
    receiver: (pc, ev) => {
      if (ev.track.kind !== "audio") return;
      const peer = this.peerOf(pc);
      if (peer?.sf) this.attach(ev.receiver, { side: "recv", pub: peer.pub });
    },
  };
}
