/**
 * Chaves de mídia (SFrame) do Nexo — experimental, desligado por padrão.
 *
 * Não existe chave de grupo nem autoridade central: cada pessoa sorteia a própria chave de envio
 * (base_key de 16 bytes + KID aleatório, nova a cada execução do app e a cada rotação) e a entrega,
 * uma a uma, aos **membros** com quem está conectada, pelo canal de dados que já existe. Esse canal
 * é DTLS com o certificado assinado pela chave Ed25519 de quem está do outro lado (channel binding
 * do handshake), então a chave só chega a quem provou ser aquele membro. Pendentes e banidos nunca
 * recebem chave.
 *
 * No P2P de hoje isso não esconde nada de ninguém (todo salto já é um membro e já é DTLS-SRTP): é a
 * base para a mídia poder passar por um repassador que não é membro (SFU) sem ele conseguir ouvir.
 * Veja docs/fusao-laira.md.
 */

/** Quadros já cifrados antes da troca continuam valendo por este tempo com a chave antiga. */
export const GRACE_MS = 10_000;
/** Ao trocar a chave, espera os outros receberem a nova antes de começar a usá-la (RFC 9605 §4.4.1). */
export const ROTATE_DELAY_MS = 1_500;
export const BASE_KEY_BYTES = 16;

/** O que vai pela rede: a chave de envio de quem manda. */
export type MediaKeyOffer = { v: 1; kid: number; key: string };

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

/** KID de 32 bits: cabeçalho curto (até 5 bytes de KID) e colisão desprezível entre os membros de um servidor. */
const isKid = (k: unknown): k is number => typeof k === "number" && Number.isInteger(k) && k >= 0 && k <= 0xffffffff;

/** Valida uma oferta recebida da rede. Qualquer coisa fora do formato é descartada. */
export function sanitizeKeyOffer(raw: unknown): { kid: number; key: Uint8Array } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1 || !isKid(r.kid) || typeof r.key !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(r.key)) return null;
  const key = unb64(r.key);
  return key.length === BASE_KEY_BYTES ? { kid: r.kid, key } : null;
}

/**
 * Regra de quem troca chave de mídia com quem: os dois lados com o recurso ligado, e os dois membros
 * do servidor (aprovados, se a aprovação estiver ligada). Vale para mandar e para aceitar.
 */
export function mayShareMediaKey(me: { member: boolean }, peer: { member: boolean; sf?: boolean }): boolean {
  return me.member && peer.member && peer.sf === true;
}

/** Mensagens para o worker que cifra e decifra (ver sframe-transform.ts). */
export type SframeOp =
  | { t: "send"; kid: number; key: Uint8Array; delayMs: number }
  | { t: "recv"; pub: string; kid: number; key: Uint8Array }
  | { t: "forget"; pub: string };

/** A minha chave de envio. */
export class MediaSendKey {
  kid = 0;
  private key: Uint8Array<ArrayBuffer> = new Uint8Array(BASE_KEY_BYTES);

  constructor(private random: (b: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer> = (b) => crypto.getRandomValues(b)) {
    this.fresh();
  }

  private fresh() {
    const prev = this.kid;
    do this.kid = new DataView(this.random(new Uint8Array(4)).buffer).getUint32(0);
    while (this.kid === prev);
    this.key = this.random(new Uint8Array(BASE_KEY_BYTES));
  }

  /** Primeira chave: vale na hora (ninguém tem outra minha para confundir). */
  initialOp(): SframeOp {
    return { t: "send", kid: this.kid, key: this.key.slice(), delayMs: 0 };
  }

  /** Chave nova (ex.: alguém foi banido). Distribua a oferta antes: o worker só passa a usar depois do atraso. */
  rotate(): SframeOp {
    this.fresh();
    return { t: "send", kid: this.kid, key: this.key.slice(), delayMs: ROTATE_DELAY_MS };
  }

  offer(): MediaKeyOffer {
    return { v: 1, kid: this.kid, key: b64(this.key) };
  }
}
