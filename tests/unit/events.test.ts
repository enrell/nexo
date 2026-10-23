import { beforeAll, describe, expect, it } from "vitest";
import { canonical, KINDS, MAX_EVENT_BYTES, MAX_FUTURE_MS, MAX_TEXT, validateBody, verifyEvent } from "../../src/lib/events";
import { sha256 } from "../../src/lib/identity";
import type { EventBody } from "../../src/lib/types";
import { initVault } from "../../src/lib/vault";
import { newIdentity, signEvent } from "./helpers";

beforeAll(initVault);

const PUB = "A".repeat(43);
const att = { id: "abc123", name: "foto.png", mime: "image/png", size: 1234, w: 800, h: 600 };

describe("validateBody: eventos legítimos passam", () => {
  const good: EventBody[] = [
    { k: "msg", ch: "geral", text: "oi" },
    { k: "msg", ch: "x7k2m9q4ab", text: "", n: "Ana", reply: "abcDEF_-123", att: [att] },
    { k: "msg", ch: "geral", text: "a".repeat(MAX_TEXT) },
    { k: "edit", target: "abc", text: "novo" },
    { k: "del", target: "abc" },
    { k: "react", target: "abc", emoji: "👍", on: true },
    { k: "role", user: PUB, role: "admin" },
    { k: "role", user: PUB, role: "member" },
    { k: "ban", user: PUB, on: true },
    { k: "ban", user: PUB, on: false, reason: "spam" },
    { k: "chan", id: "geral", name: "geral" },
    { k: "chan", id: "abc", name: "", del: true },
    { k: "name", name: "Meu servidor" },
    { k: "move", r: "abcdefghij", p: "klmnopqrst" },
    { k: "admit", user: PUB, on: true },
    { k: "policy", approval: false },
  ];
  it.each(good.map((b) => [b.k + " " + JSON.stringify(b).slice(0, 50), b] as const))("%s", (_n, b) => expect(validateBody(b)).toBe(true));
});

describe("validateBody: evento assinado mas malformado é recusado", () => {
  // o caso que derrubava a interface de todo mundo: att sem mime → att.mime.startsWith(...) lança ao desenhar
  it("anexo sem campos obrigatórios (o 'mensagem envenenada')", () => {
    expect(validateBody({ k: "msg", ch: "geral", text: "oi", att: [{}] })).toBe(false);
    expect(validateBody({ k: "msg", ch: "geral", text: "oi", att: [{ id: "a", name: "n" }] })).toBe(false);
  });

  it.each<[string, unknown]>([
    ["não é objeto", "msg"],
    ["null", null],
    ["array", [{ k: "msg" }]],
    ["sem k", { ch: "geral", text: "oi" }],
    ["k desconhecido", { k: "hack", x: 1 }],
    ["k de protótipo", { k: "__proto__" }],
    ["k não string", { k: 5 }],
    ["msg: texto objeto", { k: "msg", ch: "geral", text: { a: 1 } }],
    ["msg: texto passa do limite", { k: "msg", ch: "geral", text: "a".repeat(MAX_TEXT + 1) }],
    ["msg: canal vazio", { k: "msg", ch: "", text: "oi" }],
    ["msg: canal objeto", { k: "msg", ch: {}, text: "oi" }],
    ["msg: canal com caracteres de marcação", { k: "msg", ch: "<img src=x>", text: "oi" }],
    ["msg: nome gigante", { k: "msg", ch: "geral", text: "oi", n: "n".repeat(65) }],
    ["msg: nome objeto", { k: "msg", ch: "geral", text: "oi", n: { toString: 1 } }],
    ["msg: reply objeto", { k: "msg", ch: "geral", text: "oi", reply: {} }],
    ["msg: att não é array", { k: "msg", ch: "geral", text: "oi", att: "x" }],
    ["msg: 11 anexos", { k: "msg", ch: "geral", text: "oi", att: Array(11).fill(att) }],
    ["msg: anexo nulo", { k: "msg", ch: "geral", text: "oi", att: [null] }],
    ["msg: anexo com tamanho NaN", { k: "msg", ch: "geral", text: "oi", att: [{ ...att, size: NaN }] }],
    ["msg: anexo com tamanho negativo", { k: "msg", ch: "geral", text: "oi", att: [{ ...att, size: -1 }] }],
    ["msg: anexo com tamanho infinito", { k: "msg", ch: "geral", text: "oi", att: [{ ...att, size: Infinity }] }],
    ["msg: anexo com nome gigante", { k: "msg", ch: "geral", text: "oi", att: [{ ...att, name: "n".repeat(256) }] }],
    ["msg: anexo com mime objeto", { k: "msg", ch: "geral", text: "oi", att: [{ ...att, mime: {} }] }],
    ["msg: anexo com largura fracionária", { k: "msg", ch: "geral", text: "oi", att: [{ ...att, w: 1.5 }] }],
    ["msg: anexo com altura absurda", { k: "msg", ch: "geral", text: "oi", att: [{ ...att, h: 10 ** 9 }] }],
    ["edit: sem alvo", { k: "edit", text: "x" }],
    ["edit: texto passa do limite", { k: "edit", target: "abc", text: "a".repeat(MAX_TEXT + 1) }],
    ["del: alvo número", { k: "del", target: 1 }],
    ["react: emoji vazio", { k: "react", target: "abc", emoji: "", on: true }],
    ["react: emoji longo", { k: "react", target: "abc", emoji: "x".repeat(17), on: true }],
    ["react: on não booleano", { k: "react", target: "abc", emoji: "👍", on: "true" }],
    ["role: papel inventado", { k: "role", user: PUB, role: "root" }],
    ["role: usuário que não é chave", { k: "role", user: "ana", role: "admin" }],
    ["role: usuário em array (String() o transformaria em chave válida)", { k: "role", user: [PUB], role: "admin" }],
    ["ban: on ausente", { k: "ban", user: PUB }],
    ["ban: motivo gigante", { k: "ban", user: PUB, on: true, reason: "x".repeat(201) }],
    ["chan: nome gigante", { k: "chan", id: "abc", name: "n".repeat(41) }],
    ["chan: criar sem nome", { k: "chan", id: "abc", name: "" }],
    ["chan: del não booleano", { k: "chan", id: "abc", name: "", del: "sim" }],
    ["name: vazio", { k: "name", name: "" }],
    ["name: gigante", { k: "name", name: "n".repeat(61) }],
    ["move: sala não string", { k: "move", r: 1, p: "abc" }],
    ["move: senha com caracteres estranhos", { k: "move", r: "abc", p: "a b" }],
    ["admit: usuário inválido", { k: "admit", user: "x", on: true }],
    ["policy: approval string", { k: "policy", approval: "yes" }],
  ])("%s", (_n, b) => expect(validateBody(b)).toBe(false));

  it("todo tipo reconhecido (KINDS) tem validação", () => {
    for (const k of KINDS) expect(validateBody({ k }), k).toBe(false); // sem os campos, nenhum passa
  });
});

describe("verifyEvent: o pipeline de entrada com assinaturas de verdade", () => {
  const NOW = 1_800_000_000_000;

  it("aceita um evento íntegro", async () => {
    const a = await newIdentity();
    const e = await signEvent(a, NOW, { k: "msg", ch: "geral", text: "oi" });
    expect(await verifyEvent(e, NOW)).toEqual(e);
  });

  it("devolve só os campos do evento (sem lixo extra que o remetente tenha colado)", async () => {
    const a = await newIdentity();
    const e = await signEvent(a, NOW, { k: "msg", ch: "geral", text: "oi" });
    const out = await verifyEvent({ ...e, srv: "outro", pending: true, extra: 1 }, NOW);
    expect(Object.keys(out!).sort()).toEqual(["a", "b", "id", "s", "ts"]);
  });

  it("o id é o hash do conteúdo: id forjado é recusado", async () => {
    const a = await newIdentity();
    const e = await signEvent(a, NOW, { k: "msg", ch: "geral", text: "oi" });
    expect(await verifyEvent({ ...e, id: "x".repeat(22) }, NOW)).toBeNull();
  });

  it("conteúdo alterado depois de assinar é recusado", async () => {
    const a = await newIdentity();
    const e = await signEvent(a, NOW, { k: "msg", ch: "geral", text: "oi" });
    expect(await verifyEvent({ ...e, b: { ...e.b, text: "tchau" } }, NOW)).toBeNull();
  });

  it("alterar o conteúdo E refazer o id continua sendo recusado (assinatura não bate)", async () => {
    const a = await newIdentity();
    const e = await signEvent(a, NOW, { k: "msg", ch: "geral", text: "oi" });
    const b: EventBody = { k: "msg", ch: "geral", text: "tchau" };
    const forged = { ...e, b, id: await sha256(canonical(e.a, e.ts, b)) };
    expect(await verifyEvent(forged, NOW)).toBeNull();
  });

  it("data alterada é recusada (não dá para reordenar o histórico)", async () => {
    const a = await newIdentity();
    const e = await signEvent(a, NOW, { k: "msg", ch: "geral", text: "oi" });
    expect(await verifyEvent({ ...e, ts: e.ts - 1 }, NOW)).toBeNull();
  });

  it("ninguém assina em nome de outro (autor trocado)", async () => {
    const a = await newIdentity();
    const b = await newIdentity();
    const e = await signEvent(a, NOW, { k: "msg", ch: "geral", text: "oi" });
    expect(await verifyEvent({ ...e, a: b.pub }, NOW)).toBeNull();
  });

  it("assinatura de outra mensagem não serve", async () => {
    const a = await newIdentity();
    const e1 = await signEvent(a, NOW, { k: "msg", ch: "geral", text: "um" });
    const e2 = await signEvent(a, NOW + 1, { k: "msg", ch: "geral", text: "dois" });
    expect(await verifyEvent({ ...e2, s: e1.s }, NOW + 1)).toBeNull();
  });

  it("data no futuro além da tolerância é recusada; dentro dela passa", async () => {
    const a = await newIdentity();
    const far = await signEvent(a, NOW + MAX_FUTURE_MS + 1, { k: "msg", ch: "geral", text: "oi" });
    const near = await signEvent(a, NOW + MAX_FUTURE_MS, { k: "msg", ch: "geral", text: "oi" });
    expect(await verifyEvent(far, NOW)).toBeNull();
    expect(await verifyEvent(near, NOW)).not.toBeNull();
  });

  it("evento assinado de verdade, mas com conteúdo malformado, é recusado", async () => {
    const a = await newIdentity();
    const poison = await signEvent(a, NOW, { k: "msg", ch: "geral", text: "oi", att: [{}] } as unknown as EventBody);
    expect(await verifyEvent(poison, NOW)).toBeNull();
  });

  it("evento maior que o limite é recusado", async () => {
    const a = await newIdentity();
    const big = await signEvent(a, NOW, { k: "msg", ch: "geral", text: "oi", att: Array(10).fill({ ...att, name: "n".repeat(255), mime: "m".repeat(127) }) });
    expect(canonical(big.a, big.ts, big.b).length).toBeLessThan(MAX_EVENT_BYTES); // limite de campos já corta antes do de tamanho
    expect(await verifyEvent(big, NOW)).not.toBeNull();
  });

  it("evento que passa de 24 KB depois de serializado é recusado (caracteres de controle viram \\uXXXX no JSON)", async () => {
    const a = await newIdentity();
    const ctl = "\u0001";
    const bloated = await signEvent(a, NOW, { k: "msg", ch: "geral", text: ctl.repeat(4000), att: Array.from({ length: 10 }, (_, i) => ({ ...att, id: "a" + i, name: ctl.repeat(255) })) });
    expect(canonical(bloated.a, bloated.ts, bloated.b).length).toBeGreaterThan(MAX_EVENT_BYTES);
    expect(validateBody(bloated.b)).toBe(true); // cada campo está dentro do seu limite…
    expect(await verifyEvent(bloated, NOW)).toBeNull(); // …mas o conjunto não
  });

  it.each<[string, unknown]>([
    ["null", null],
    ["string", "evento"],
    ["sem id", { a: PUB, ts: NOW, b: { k: "del", target: "x" }, s: "s" }],
    ["ts fracionário", { id: "x", a: PUB, ts: 1.5, b: { k: "del", target: "x" }, s: "s" }],
    ["ts string", { id: "x", a: PUB, ts: "1", b: { k: "del", target: "x" }, s: "s" }],
    ["autor inválido", { id: "x", a: "ana", ts: NOW, b: { k: "del", target: "x" }, s: "s" }],
    ["sem assinatura", { id: "x", a: PUB, ts: NOW, b: { k: "del", target: "x" } }],
  ])("lixo de rede: %s", async (_n, e) => expect(await verifyEvent(e, NOW)).toBeNull());
});
