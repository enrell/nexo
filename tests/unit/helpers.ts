import { canonical } from "../../src/lib/events";
import { Identity, sha256 } from "../../src/lib/identity";
import { flushSecureStore, resetSecureStoreForTests } from "../../src/lib/storage";
import type { EventBody, SignedEvent, StoredEvent } from "../../src/lib/types";
import { initVault } from "../../src/lib/vault";

/** Gera uma identidade nova (par Ed25519 de verdade). */
export async function newIdentity(): Promise<Identity> {
  await initVault();
  resetSecureStoreForTests();
  const id = await Identity.load();
  await flushSecureStore();
  return id;
}

/** Evento assinado de verdade, exatamente como a sessão publica. */
export async function signEvent(who: Identity, ts: number, b: EventBody): Promise<SignedEvent> {
  const data = canonical(who.pub, ts, b);
  return { id: await sha256(data), a: who.pub, ts, b, s: await who.sign(data) };
}

let n = 0;
/** Evento "cru" para testar as regras de `derive` (que não confere assinatura). */
export function ev(a: string, ts: number, b: EventBody, id?: string): StoredEvent {
  return { id: id ?? `e${String(++n).padStart(5, "0")}`, a, ts, b, s: "", srv: "srv" };
}

/** Gerador pseudoaleatório com semente (o teste falha sempre do mesmo jeito). */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export function shuffle<T>(list: T[], rand: () => number): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
