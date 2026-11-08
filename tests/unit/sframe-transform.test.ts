/**
 * Ponta a ponta da lógica do SFrame no Nexo, sem navegador: cada pessoa tem o seu "worker"
 * (SframeContext) e a sua chave de envio; a oferta passa pelo mesmo validador da rede; os quadros
 * passam pelos mesmos TransformStreams que o RTCRtpScriptTransform usa. Só o WebRTC fica de fora.
 */
import { describe, expect, it } from "vitest";
import { GRACE_MS, MediaSendKey, ROTATE_DELAY_MS, sanitizeKeyOffer, type MediaKeyOffer } from "../../src/lib/mediakeys";
import { decodeHeader } from "../../src/lib/sframe";
import { SframeContext, type EncodedFrame, type TransformOptions } from "../../src/lib/sframe-transform";

const te = new TextEncoder();
const td = new TextDecoder();

type Person = { pub: string; ctx: SframeContext; key: MediaSendKey };

async function person(pub: string, clock: { t: number }): Promise<Person> {
  const ctx = new SframeContext(() => clock.t);
  const key = new MediaSendKey();
  await ctx.handle(key.initialOp());
  return { pub, ctx, key };
}

/** O que a sessão faz ao receber `mkey` de um membro: valida e entrega ao worker. */
function deliver(to: Person, from: Person, offer: MediaKeyOffer = from.key.offer()) {
  const k = sanitizeKeyOffer(JSON.parse(JSON.stringify(offer)));
  if (!k) throw new Error("oferta inválida");
  return to.ctx.handle({ t: "recv", pub: from.pub, ...k });
}

/** Passa quadros por um transform, como o Chromium faz entre o codificador e o empacotador. */
async function run(ctx: SframeContext, opts: TransformOptions, frames: Uint8Array[]): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  const src = new ReadableStream<EncodedFrame>({
    start(c) {
      for (const f of frames) c.enqueue({ data: f.slice().buffer });
      c.close();
    },
  });
  await src.pipeThrough(ctx.transform(opts)).pipeTo(new WritableStream({ write: (f) => void out.push(new Uint8Array(f.data)) }));
  return out;
}

const voice = (n: number, tag = "voz") => Array.from({ length: n }, (_, i) => te.encode(`${tag}-${i}`));
const kidOf = (f: Uint8Array) => Number(decodeHeader(f)!.kid);

describe("SFrame no Nexo, ponta a ponta (sem WebRTC)", () => {
  it("Ana fala, Beto (membro, recebeu a chave) ouve; Caio (sem chave) não ouve nada", async () => {
    const clock = { t: 0 };
    const ana = await person("ana", clock);
    const beto = await person("beto", clock);
    const caio = await person("caio", clock);
    await deliver(beto, ana);

    const wire = await run(ana.ctx, { side: "send" }, voice(20));
    expect(wire).toHaveLength(20);
    for (const f of wire) {
      expect(kidOf(f)).toBe(ana.key.kid);
      expect(td.decode(f)).not.toContain("voz-");
    }
    const heard = await run(beto.ctx, { side: "recv", pub: "ana" }, wire);
    expect(heard.map((f) => td.decode(f))).toEqual(voice(20).map((f) => td.decode(f)));
    expect(beto.ctx.stats).toMatchObject({ decrypted: 20, dropped: 0 });

    expect(await run(caio.ctx, { side: "recv", pub: "ana" }, wire)).toEqual([]);
    expect(caio.ctx.stats.dropped).toBe(20);
  });

  it("sem chave de envio pronta, o quadro é descartado (nunca sai em claro)", async () => {
    const ctx = new SframeContext();
    expect(await run(ctx, { side: "send" }, voice(3))).toEqual([]);
    expect(ctx.stats).toMatchObject({ encrypted: 0, dropped: 3 });
  });

  it("o mesmo microfone indo para várias conexões nunca repete (KID, CTR)", async () => {
    const clock = { t: 0 };
    const ana = await person("ana", clock);
    const [a, b, c] = await Promise.all([1, 2, 3].map((i) => run(ana.ctx, { side: "send" }, voice(30, `para-${i}`))));
    const ctrs = [...a, ...b, ...c].map((f) => decodeHeader(f)!.ctr);
    expect(new Set(ctrs).size).toBe(90);
  });

  it("numa conexão só vale a chave de quem está do outro lado; e ninguém toma o KID de outro", async () => {
    const clock = { t: 0 };
    const ana = await person("ana", clock);
    const beto = await person("beto", clock);
    const malu = await person("malu", clock);
    await deliver(beto, ana);
    await deliver(beto, malu);
    const fromMalu = await run(malu.ctx, { side: "send" }, voice(5));
    // quadros com a chave da Malu chegando pela conexão da Ana: descartados
    expect(await run(beto.ctx, { side: "recv", pub: "ana" }, fromMalu)).toEqual([]);
    expect(await run(beto.ctx, { side: "recv", pub: "malu" }, fromMalu)).toHaveLength(5);
    // Malu anuncia o KID da Ana com a chave dela: ignorado, a Ana continua sendo ouvida
    await deliver(beto, malu, { ...malu.key.offer(), kid: ana.key.kid });
    const fromAna = await run(ana.ctx, { side: "send" }, voice(5));
    expect(await run(beto.ctx, { side: "recv", pub: "ana" }, fromAna)).toHaveLength(5);
  });

  it("troca de chave: a nova só é usada depois do atraso; a antiga vale pela carência e depois não", async () => {
    const clock = { t: 1000 };
    const ana = await person("ana", clock);
    const beto = await person("beto", clock);
    await deliver(beto, ana);
    const oldKid = ana.key.kid;
    const before = await run(ana.ctx, { side: "send" }, voice(2, "antes"));

    await ana.ctx.handle(ana.key.rotate());
    const newKid = ana.key.kid;
    expect(newKid).not.toBe(oldKid);
    // ainda dentro do atraso: continua com a chave antiga (o Beto ainda pode não ter a nova)
    const during = await run(ana.ctx, { side: "send" }, voice(2, "durante"));
    expect(during.map(kidOf)).toEqual([oldKid, oldKid]);
    await deliver(beto, ana);

    clock.t += ROTATE_DELAY_MS;
    const after = await run(ana.ctx, { side: "send" }, voice(2, "depois"));
    expect(after.map(kidOf)).toEqual([newKid, newKid]);
    expect(await run(beto.ctx, { side: "recv", pub: "ana" }, [...before, ...during, ...after])).toHaveLength(6);

    clock.t += GRACE_MS;
    expect(await run(beto.ctx, { side: "recv", pub: "ana" }, before)).toEqual([]);
    expect(await run(beto.ctx, { side: "recv", pub: "ana" }, after)).toHaveLength(2);
  });

  it("guarda no máximo a chave atual e a anterior de cada pessoa", async () => {
    const clock = { t: 0 };
    const ana = await person("ana", clock);
    const beto = await person("beto", clock);
    await deliver(beto, ana);
    const k1 = await run(ana.ctx, { side: "send" }, voice(1));
    await ana.ctx.handle(ana.key.rotate());
    await deliver(beto, ana);
    await ana.ctx.handle(ana.key.rotate());
    await deliver(beto, ana);
    // a primeira já saiu, sem esperar a carência
    expect(await run(beto.ctx, { side: "recv", pub: "ana" }, k1)).toEqual([]);
  });

  it("banido: esquecer a pessoa derruba as chaves dela na hora", async () => {
    const clock = { t: 0 };
    const ana = await person("ana", clock);
    const beto = await person("beto", clock);
    await deliver(beto, ana);
    const wire = await run(ana.ctx, { side: "send" }, voice(3));
    await beto.ctx.handle({ t: "forget", pub: "ana" });
    expect(await run(beto.ctx, { side: "recv", pub: "ana" }, wire)).toEqual([]);
    // reapresentar a mesma chave depois (ex.: desbanida) volta a valer
    await deliver(beto, ana);
    expect(await run(beto.ctx, { side: "recv", pub: "ana" }, wire)).toHaveLength(3);
  });

  it("tem teto de chaves guardadas", async () => {
    const beto = new SframeContext();
    for (let i = 0; i < 512; i++) await beto.handle({ t: "recv", pub: `p${i}`, kid: i + 1, key: new Uint8Array(16).fill(i % 255) });
    const extra = await person("extra", { t: 0 });
    await deliver({ pub: "beto", ctx: beto, key: new MediaSendKey() }, extra);
    expect(await run(beto, { side: "recv", pub: "extra" }, await run(extra.ctx, { side: "send" }, voice(1)))).toEqual([]);
  });

  it("quadro que não é SFrame, ou de KID acima de 32 bits, é descartado", async () => {
    const beto = new SframeContext();
    const notSframe = [new Uint8Array(0), te.encode("opus em claro"), Uint8Array.of(0xff, ...new Array(40).fill(0xff))];
    expect(await run(beto, { side: "recv", pub: "ana" }, notSframe)).toEqual([]);
    expect(beto.stats.dropped).toBe(3);
  });
});
