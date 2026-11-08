/**
 * O que roda dentro do worker do Encoded Transform: guarda as chaves e cifra/decifra os quadros
 * codificados (antes do empacotamento RTP no envio, depois da remontagem no recebimento).
 *
 * Tudo aqui é puro (WebCrypto + TransformStream) para poder ser testado no Node; `sframe.worker.ts`
 * só liga isto ao `onrtctransform` do navegador.
 *
 * Regras:
 * - um único remetente (um contador) para todas as conexões: o mesmo microfone vai para cada amigo
 *   por uma conexão diferente, e nenhuma delas pode repetir um nonce;
 * - sem chave de envio pronta, o quadro é descartado (nunca sai em claro numa conexão combinada como cifrada);
 * - no recebimento, o KID tem que ser de uma chave entregue **por quem está do outro lado desta conexão**;
 * - quadro que não decifra é descartado (RFC 9605 §4.4.4).
 */
import { GRACE_MS, type SframeOp } from "./mediakeys";
import { decrypt, deriveKeySalt, SframeSender, type KeySalt } from "./sframe";

export type TransformOptions = { side: "send" } | { side: "recv"; pub: string };
export type EncodedFrame = { data: ArrayBuffer };
export type SframeStats = { encrypted: number; decrypted: number; dropped: number };

type RecvKey = { pub: string; ks: KeySalt; expires?: number };

/** Teto de chaves guardadas (2 por pessoa: a atual e a anterior, durante a carência). */
const MAX_KEYS = 512;

export class SframeContext {
  private sender: SframeSender | null = null;
  private next: { sender: SframeSender; from: number } | null = null;
  private keys = new Map<number, RecvKey>();
  private current = new Map<string, number>();
  private queue: Promise<void> = Promise.resolve();
  stats: SframeStats = { encrypted: 0, decrypted: 0, dropped: 0 };

  constructor(private now: () => number = Date.now) {}

  /** Aplica as mensagens na ordem em que chegaram (derivar a chave é assíncrono). */
  handle(op: SframeOp): Promise<void> {
    this.queue = this.queue.then(() => this.apply(op)).catch(() => {});
    return this.queue;
  }

  private async apply(op: SframeOp) {
    if (op.t === "send") {
      const sender = await SframeSender.create(BigInt(op.kid), op.key);
      op.key.fill(0);
      if (op.delayMs > 0 && this.sender) this.next = { sender, from: this.now() + op.delayMs };
      else {
        this.sender = sender;
        this.next = null;
      }
    } else if (op.t === "recv") {
      const known = this.keys.get(op.kid);
      // KID é de quem o entregou primeiro: outro membro não consegue "tomar" o KID de alguém
      if (known) return;
      this.sweep();
      if (this.keys.size >= MAX_KEYS) return;
      // as mensagens são aplicadas uma de cada vez (fila), então ninguém registra este KID enquanto derivamos
      const ks = await deriveKeySalt(BigInt(op.kid), op.key, "decrypt");
      op.key.fill(0);
      const prev = this.current.get(op.pub);
      if (prev !== undefined) {
        // a anterior vale só pela carência; a de antes dela já sai
        for (const [kid, k] of this.keys) if (k.pub === op.pub && kid !== prev) this.keys.delete(kid);
        const old = this.keys.get(prev);
        if (old) old.expires = this.now() + GRACE_MS;
      }
      this.keys.set(op.kid, { pub: op.pub, ks });
      this.current.set(op.pub, op.kid);
    } else if (op.t === "forget") {
      for (const [kid, k] of this.keys) if (k.pub === op.pub) this.keys.delete(kid);
      this.current.delete(op.pub);
    }
  }

  private sweep() {
    const now = this.now();
    for (const [kid, k] of this.keys) if (k.expires !== undefined && k.expires <= now) this.keys.delete(kid);
  }

  /** Quadro cifrado, ou `null` (descartar) se ainda não há chave de envio. */
  async encrypt(data: Uint8Array): Promise<Uint8Array | null> {
    if (this.next && this.now() >= this.next.from) {
      this.sender = this.next.sender;
      this.next = null;
    }
    if (!this.sender) return null;
    return this.sender.encrypt(data);
  }

  /** Quadro decifrado, ou `null` (descartar). `pub` = quem está do outro lado desta conexão. */
  async decrypt(data: Uint8Array, pub: string): Promise<Uint8Array | null> {
    const now = this.now();
    const res = await decrypt((kid) => {
      if (kid > 0xffffffffn) return null;
      const k = this.keys.get(Number(kid));
      if (!k || k.pub !== pub || (k.expires !== undefined && k.expires <= now)) return null;
      return k.ks;
    }, data);
    return res?.plaintext ?? null;
  }

  /** O TransformStream que fica entre o codificador e o empacotador (ou o inverso). */
  transform(opts: TransformOptions): TransformStream<EncodedFrame, EncodedFrame> {
    return new TransformStream({
      transform: async (frame, controller) => {
        const data = new Uint8Array(frame.data);
        const out = opts.side === "send" ? await this.encrypt(data).catch(() => null) : await this.decrypt(data, opts.pub);
        if (!out) {
          this.stats.dropped++;
          return;
        }
        if (opts.side === "send") this.stats.encrypted++;
        else this.stats.decrypted++;
        frame.data = out.buffer as ArrayBuffer;
        controller.enqueue(frame);
      },
    });
  }
}
