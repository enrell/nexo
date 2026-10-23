import { describe, expect, it, vi } from "vitest";
import { dayKey, derive, isMemberOf, summarize, type Derived } from "../../src/lib/derive";
import type { EventBody, StoredEvent } from "../../src/lib/types";
import { ev, rng, shuffle } from "./helpers";

const O = "owner";
const seed = { name: "Servidor", channels: [{ id: "geral", name: "geral" }] };
const d = (events: StoredEvent[], owner = O) => derive(events, owner, seed);
const msg = (a: string, ts: number, text = "oi", ch = "geral", id?: string) => ev(a, ts, { k: "msg", ch, text }, id);
const texts = (st: Derived, ch = "geral") => (st.messages.get(ch) ?? []).filter((m) => !m.deleted).map((m) => m.text);

describe("mensagens", () => {
  it("ficam por canal, em ordem de tempo; empate de data desempata pelo id (igual para todos)", () => {
    const st = d([msg("ana", 30, "c", "geral", "z"), msg("ana", 10, "a"), msg("bia", 20, "b", "memes"), msg("ana", 30, "d", "geral", "a")]);
    expect(texts(st)).toEqual(["a", "d", "c"]);
    expect(texts(st, "memes")).toEqual(["b"]);
  });

  it("texto passa de 4000 caracteres e é cortado; anexos passam de 10 e são cortados", () => {
    const att = { id: "a", name: "n", mime: "x/y", size: 1 };
    const st = d([ev("ana", 1, { k: "msg", ch: "geral", text: "x".repeat(5000), att: Array(15).fill(att) })]);
    const m = [...st.byId.values()][0];
    expect(m.text).toHaveLength(4000);
    expect(m.att).toHaveLength(10);
  });

  it("tipos errados são ignorados sem lançar", () => {
    const bad = [ev("ana", 1, { k: "msg", ch: "geral", text: 5 } as unknown as EventBody), ev("ana", 2, { k: "msg", ch: 7, text: "x" } as unknown as EventBody)];
    expect(() => d(bad)).not.toThrow();
    expect(d(bad).byId.size).toBe(0);
  });

  it("guarda o estado 'pendente' e o nome informado pelo autor", () => {
    const e = { ...ev("ana", 1, { k: "msg", ch: "geral", text: "x", n: "Ana" }), pending: true };
    const m = [...d([e]).byId.values()][0];
    expect(m.pending).toBe(true);
    expect(m.fallbackName).toBe("Ana");
  });
});

describe("edição e exclusão", () => {
  it("só o autor edita; a edição guarda a data", () => {
    const m = msg("ana", 10, "original", "geral", "m1");
    const st = d([m, ev("ana", 20, { k: "edit", target: "m1", text: "editado" })]);
    expect(st.byId.get("m1")).toMatchObject({ text: "editado", edited: 20 });
  });

  it("outra pessoa — mesmo admin ou dono — não edita a mensagem alheia", () => {
    for (const who of ["bia", O]) {
      const st = d([msg("ana", 10, "original", "geral", "m1"), ev(who, 20, { k: "edit", target: "m1", text: "adulterado" })]);
      expect(st.byId.get("m1")!.text, who).toBe("original");
    }
  });

  it("não dá para editar mensagem apagada, nem editar o que não existe", () => {
    const st = d([msg("ana", 10, "x", "geral", "m1"), ev("ana", 20, { k: "del", target: "m1" }), ev("ana", 30, { k: "edit", target: "m1", text: "volta" }), ev("ana", 40, { k: "edit", target: "fantasma", text: "?" })]);
    expect(st.byId.get("m1")).toMatchObject({ deleted: true, text: "" });
    expect(st.byId.has("fantasma")).toBe(false);
  });

  it("autor apaga a própria; dono e admin apagam as dos outros; membro comum não", () => {
    const base = [ev(O, 1, { k: "role", user: "adm", role: "admin" }), msg("ana", 10, "x", "geral", "m1")];
    const del = (who: string) => d([...base, ev(who, 20, { k: "del", target: "m1" })]).byId.get("m1")!.deleted;
    expect(del("ana")).toBe(true);
    expect(del(O)).toBe(true);
    expect(del("adm")).toBe(true);
    expect(del("bia")).toBe(false);
  });

  it("apagar remove texto e anexos", () => {
    const e = ev("ana", 1, { k: "msg", ch: "geral", text: "segredo", att: [{ id: "a", name: "n", mime: "x/y", size: 1 }] }, "m1");
    const m = d([e, ev("ana", 2, { k: "del", target: "m1" })]).byId.get("m1")!;
    expect(m).toMatchObject({ deleted: true, text: "", att: undefined });
  });
});

describe("reações", () => {
  const r = (a: string, ts: number, on: boolean, emoji = "👍") => ev(a, ts, { k: "react", target: "m1", emoji, on });
  it("adiciona e remove, e repetir não duplica", () => {
    const base = msg("ana", 1, "x", "geral", "m1");
    expect(d([base, r("bia", 2, true), r("bia", 3, true)]).byId.get("m1")!.reactions).toEqual({ "👍": ["bia"] });
    expect(d([base, r("bia", 2, true), r("cal", 3, true)]).byId.get("m1")!.reactions["👍"]).toEqual(["bia", "cal"]);
    expect(d([base, r("bia", 2, true), r("bia", 3, false)]).byId.get("m1")!.reactions).toEqual({});
    expect(d([base, r("bia", 2, false)]).byId.get("m1")!.reactions).toEqual({});
  });
  it("emoji gigante ou de tipo errado é ignorado", () => {
    const base = msg("ana", 1, "x", "geral", "m1");
    expect(d([base, r("bia", 2, true, "x".repeat(17))]).byId.get("m1")!.reactions).toEqual({});
    expect(d([base, ev("bia", 2, { k: "react", target: "m1", emoji: 5, on: true } as unknown as EventBody)]).byId.get("m1")!.reactions).toEqual({});
  });
});

describe("cargos", () => {
  it("só o dono promove e rebaixa admins", () => {
    const st = d([ev(O, 1, { k: "role", user: "ana", role: "admin" }), ev("ana", 2, { k: "role", user: "bia", role: "admin" }), ev("bia", 3, { k: "role", user: "cal", role: "admin" })]);
    expect([...st.admins].sort()).toEqual(["ana", O]);
    expect([...d([ev(O, 1, { k: "role", user: "ana", role: "admin" }), ev(O, 2, { k: "role", user: "ana", role: "member" })]).admins]).toEqual([O]);
  });
  it("o dono nunca perde o cargo", () => {
    expect(d([ev(O, 1, { k: "role", user: O, role: "member" })]).admins.has(O)).toBe(true);
  });
  it("admin não consegue se auto-promover nem promover por cima do dono", () => {
    expect(d([ev("ana", 1, { k: "role", user: "ana", role: "admin" })]).admins.has("ana")).toBe(false);
  });
});

describe("banimento", () => {
  it("admin bane; o banido perde o cargo e nada do que ele fizer depois vale", () => {
    const st = d([ev(O, 1, { k: "role", user: "ana", role: "admin" }), msg("ana", 5, "antes"), ev(O, 10, { k: "ban", user: "ana", on: true }), msg("ana", 20, "depois")]);
    expect(st.banned.has("ana")).toBe(true);
    expect(st.admins.has("ana")).toBe(false);
    expect(texts(st)).toEqual(["antes"]);
  });
  it("dono não pode ser banido, ninguém se bane", () => {
    expect(d([ev("adm", 1, { k: "ban", user: O, on: true }), ev(O, 0, { k: "role", user: "adm", role: "admin" })]).banned.has(O)).toBe(false);
    expect(d([ev(O, 0, { k: "role", user: "adm", role: "admin" }), ev("adm", 1, { k: "ban", user: "adm", on: true })]).banned.size).toBe(0);
    expect(d([ev(O, 1, { k: "ban", user: O, on: true })]).banned.size).toBe(0);
  });
  it("membro comum não bane", () => {
    expect(d([ev("bia", 1, { k: "ban", user: "ana", on: true })]).banned.size).toBe(0);
  });
  it("desbanir restaura; o que foi escrito durante o ban continua fora", () => {
    const st = d([ev(O, 1, { k: "ban", user: "ana", on: true }), msg("ana", 2, "durante"), ev(O, 3, { k: "ban", user: "ana", on: false }), msg("ana", 4, "depois")]);
    expect(st.banned.has("ana")).toBe(false);
    expect(texts(st)).toEqual(["depois"]);
  });
  it("banido não consegue desbanir a si mesmo nem banir outros", () => {
    const st = d([ev(O, 1, { k: "role", user: "adm", role: "admin" }), ev(O, 2, { k: "ban", user: "adm", on: true }), ev("adm", 3, { k: "ban", user: "ana", on: true }), ev("adm", 4, { k: "ban", user: "adm", on: false })]);
    expect([...st.banned]).toEqual(["adm"]);
  });
  it("a moderação é por data: ban com data antiga (relógio atrasado) ainda vale para o futuro", () => {
    expect(texts(d([msg("ana", 100, "x"), ev(O, 50, { k: "ban", user: "ana", on: true })]))).toEqual([]);
  });
});

describe("aprovação de novos membros", () => {
  const on = ev(O, 1, { k: "policy", approval: true });
  it("desligada (padrão): qualquer um participa", () => {
    expect(texts(d([msg("ana", 2, "oi")]))).toEqual(["oi"]);
  });
  it("ligada: quem não foi aprovado não escreve; admins e aprovados sim", () => {
    const st = d([on, ev(O, 2, { k: "role", user: "adm", role: "admin" }), ev("adm", 3, { k: "admit", user: "ana", on: true }), msg("ana", 4, "aprovada"), msg("bia", 5, "intrusa"), msg("adm", 6, "admin"), msg(O, 7, "dono")]);
    expect(texts(st)).toEqual(["aprovada", "admin", "dono"]);
  });
  it("revogar a aprovação tira o acesso", () => {
    const st = d([on, ev(O, 2, { k: "admit", user: "ana", on: true }), msg("ana", 3, "a"), ev(O, 4, { k: "admit", user: "ana", on: false }), msg("ana", 5, "b")]);
    expect(texts(st)).toEqual(["a"]);
  });
  it("só o dono tira o cargo de admin; um admin que 'desaprova' outro admin não o rebaixa", () => {
    const base = [ev(O, 1, { k: "role", user: "adm1", role: "admin" }), ev(O, 2, { k: "role", user: "adm2", role: "admin" })];
    expect(d([...base, ev("adm1", 3, { k: "admit", user: "adm2", on: false })]).admins.has("adm2")).toBe(true);
    expect(d([...base, ev(O, 3, { k: "admit", user: "adm2", on: false })]).admins.has("adm2")).toBe(false);
  });
  it("só admin muda a política e admite", () => {
    expect(d([ev("bia", 1, { k: "policy", approval: true })]).approval).toBe(false);
    expect(d([on, ev("bia", 2, { k: "admit", user: "bia", on: true }), msg("bia", 3, "x")]).admitted.size).toBe(0);
  });
  it("não-aprovado também não edita, apaga nem reage", () => {
    const st = d([msg(O, 0, "x", "geral", "m1"), on, ev("bia", 3, { k: "react", target: "m1", emoji: "👍", on: true }), ev("bia", 4, { k: "del", target: "m1" })]);
    expect(st.byId.get("m1")).toMatchObject({ deleted: false, reactions: {} });
  });
  it("isMemberOf espelha as regras (banido, aprovação, dono)", () => {
    const st = d([on, ev(O, 2, { k: "admit", user: "ana", on: true }), ev(O, 3, { k: "ban", user: "bia", on: true })]);
    expect(isMemberOf(st, O, "ana")).toBe(true);
    expect(isMemberOf(st, O, "cal")).toBe(false);
    expect(isMemberOf(st, O, O)).toBe(true);
    expect(isMemberOf(st, O, "bia")).toBe(false);
    // servidor sem aprovação: todos (menos banidos)
    expect(isMemberOf(d([ev(O, 3, { k: "ban", user: "bia", on: true })]), O, "cal")).toBe(true);
  });
});

describe("canais, nome e mudança de sala", () => {
  it("só admin cria, renomeia e apaga canais; nome é cortado em 40", () => {
    const st = d([ev(O, 1, { k: "chan", id: "c1", name: "x".repeat(60) }), ev("bia", 2, { k: "chan", id: "c2", name: "intruso" }), ev(O, 3, { k: "chan", id: "geral", name: "principal" })]);
    expect(st.channels.map((c) => c.id)).toEqual(["geral", "c1"]);
    expect(st.channels[0].name).toBe("principal");
    expect(st.channels[1].name).toHaveLength(40);
    expect(d([ev(O, 1, { k: "chan", id: "geral", name: "", del: true }), ev("bia", 2, { k: "chan", id: "x", name: "y", del: true })]).channels).toEqual([{ id: "geral", name: "geral" }]); // nunca fica sem canal
  });
  it("apagar o canal não apaga o histórico guardado, e quem não é admin não apaga canal", () => {
    expect(d([ev("bia", 1, { k: "chan", id: "geral", name: "", del: true })]).channels).toEqual([{ id: "geral", name: "geral" }]);
  });
  it("nome do servidor: só admin, cortado em 60, vazio ignorado", () => {
    expect(d([ev(O, 5, { k: "name", name: "x".repeat(80) })]).name).toHaveLength(60);
    expect(d([ev(O, 5, { k: "name", name: "Novo" })])).toMatchObject({ name: "Novo", nameTs: 5 });
    expect(d([ev("bia", 5, { k: "name", name: "Hack" })]).name).toBe("Servidor");
    expect(d([ev(O, 5, { k: "name", name: "" })]).name).toBe("Servidor");
  });
  it("mudança de sala: vale o evento mais recente de um admin", () => {
    const st = d([ev(O, 1, { k: "move", r: "r1", p: "p1" }), ev("bia", 2, { k: "move", r: "evil", p: "evil" }), ev(O, 3, { k: "move", r: "r2", p: "p2" })]);
    expect(st.move).toEqual({ r: "r2", p: "p2", ts: 3 });
    expect(d([ev("bia", 2, { k: "move", r: "evil", p: "evil" })]).move).toBeNull();
  });
});

describe("servidor antigo, sem dono", () => {
  it("todos são admin e a aprovação não existe (compatibilidade)", () => {
    const st = derive([ev("ana", 1, { k: "policy", approval: true }), ev("bia", 2, { k: "chan", id: "c", name: "novo" }), msg("cal", 3, "oi")], "", seed);
    expect(st.channels.map((c) => c.id)).toContain("c");
    expect(texts(st)).toEqual(["oi"]);
    expect(isMemberOf(st, "", "qualquer")).toBe(true);
  });
});

describe("robustez", () => {
  it("sem eventos: estado inicial vem da semente", () => {
    const st = d([]);
    expect(st).toMatchObject({ name: "Servidor", approval: false, move: null });
    expect([...st.admins]).toEqual([O]);
  });
  it("não altera a lista de entrada", () => {
    const list = [msg("ana", 2, "b"), msg("ana", 1, "a")];
    const copy = [...list];
    d(list);
    expect(list).toEqual(copy);
  });
  it("campos hostis (protótipo, objetos) não lançam nem poluem", () => {
    const hostile: EventBody[] = [
      { k: "react", target: "__proto__", emoji: "👍", on: true },
      { k: "edit", target: "constructor", text: "x" },
      { k: "chan", id: "__proto__", name: "p" },
      { k: "role", user: "__proto__", role: "admin" },
      { k: "ban", user: "constructor", on: true },
    ];
    expect(() => d(hostile.map((b, i) => ev(O, i + 1, b)))).not.toThrow();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("chaves hostis vindas da rede não derrubam o servidor", () => {
  // um membro assina uma reação com emoji "constructor": com um objeto comum como mapa, `list.includes` lançava
  // dentro do derive e o servidor inteiro ficava inutilizável (o evento fica guardado, então para sempre)
  it.each(["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf", "isPrototypeOf"])("emoji %s funciona como qualquer outro", (emoji) => {
    const base = msg("ana", 1, "x", "geral", "m1");
    const st = d([base, ev("bia", 2, { k: "react", target: "m1", emoji, on: true }), ev("cal", 3, { k: "react", target: "m1", emoji, on: true })]);
    const r = st.byId.get("m1")!.reactions;
    expect(Object.keys(r)).toEqual([emoji]);
    expect(r[emoji]).toEqual(["bia", "cal"]);
    expect(Object.keys(d([base, ev("bia", 2, { k: "react", target: "m1", emoji, on: true }), ev("bia", 3, { k: "react", target: "m1", emoji, on: false })]).byId.get("m1")!.reactions)).toEqual([]);
    expect(({} as Record<string, unknown>).bia).toBeUndefined();
  });

  it("um evento que lança ao ser aplicado é ignorado; o resto do estado continua correto", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const boom = { toString() { throw new Error("boom"); } };
    const st = d([msg("ana", 1, "antes", "geral", "m1"), ev("ana", 2, { k: "edit", target: "m1", text: boom } as unknown as EventBody), msg("ana", 3, "depois")]);
    expect(texts(st)).toEqual(["antes", "depois"]);
    expect(warn).toHaveBeenCalledWith("evento ignorado ao derivar o estado:", expect.any(String), expect.any(Error));
    warn.mockRestore();
  });
});

describe("convergência: todo mundo chega ao mesmo estado", () => {
  /** Resultado em forma comparável (Maps/Sets viram listas ordenadas). */
  const flat = (st: Derived) =>
    JSON.stringify({
      name: st.name,
      nameTs: st.nameTs,
      channels: st.channels,
      admins: [...st.admins].sort(),
      banned: [...st.banned].sort(),
      admitted: [...st.admitted].sort(),
      approval: st.approval,
      move: st.move,
      messages: [...st.messages.entries()].sort(([x], [y]) => (x < y ? -1 : 1)),
    });

  /** Uma história aleatória, mas válida: papéis, moderação, mensagens, edições, reações. */
  function history(rand: () => number, n = 70): StoredEvent[] {
    const users = [O, "adm", "ana", "bia", "cal", "dan"];
    const evs: StoredEvent[] = [ev(O, 1, { k: "role", user: "adm", role: "admin" })];
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const who = users[Math.floor(rand() * users.length)];
      const other = users[Math.floor(rand() * users.length)];
      const ts = 2 + Math.floor(i / 2); // várias datas repetidas: força o desempate por id
      const roll = rand();
      let b: EventBody;
      if (roll < 0.45 || !ids.length) b = { k: "msg", ch: rand() < 0.7 ? "geral" : "memes", text: "m" + i };
      else if (roll < 0.55) b = { k: "edit", target: ids[Math.floor(rand() * ids.length)], text: "e" + i };
      else if (roll < 0.63) b = { k: "del", target: ids[Math.floor(rand() * ids.length)] };
      else if (roll < 0.75) b = { k: "react", target: ids[Math.floor(rand() * ids.length)], emoji: rand() < 0.5 ? "👍" : "🔥", on: rand() < 0.7 };
      else if (roll < 0.8) b = { k: "ban", user: other, on: rand() < 0.7 };
      else if (roll < 0.85) b = { k: "admit", user: other, on: rand() < 0.7 };
      else if (roll < 0.88) b = { k: "policy", approval: rand() < 0.5 };
      else if (roll < 0.92) b = { k: "role", user: other, role: rand() < 0.6 ? "admin" : "member" };
      else if (roll < 0.95) b = { k: "chan", id: "c" + (i % 3), name: "canal" + i, del: rand() < 0.3 };
      else if (roll < 0.98) b = { k: "name", name: "nome" + i };
      else b = { k: "move", r: "r" + i, p: "p" + i };
      const e = ev(who, ts, b, "id" + String(i).padStart(3, "0"));
      if (b.k === "msg") ids.push(e.id);
      evs.push(e);
    }
    return evs;
  }

  it("qualquer ordem de chegada produz exatamente o mesmo estado (200 histórias × 6 ordens)", () => {
    for (let seedN = 1; seedN <= 200; seedN++) {
      const rand = rng(seedN);
      const evs = history(rand);
      const ref = flat(d(evs));
      for (let k = 0; k < 6; k++) expect(flat(d(shuffle(evs, rng(seedN * 100 + k)))), `história ${seedN}, ordem ${k}`).toBe(ref);
    }
  });

  it("receber os eventos em lotes e re-derivar a cada lote chega ao mesmo fim", () => {
    const evs = history(rng(99), 120);
    const shuffled = shuffle(evs, rng(7));
    let partial: StoredEvent[] = [];
    for (let i = 0; i < shuffled.length; i += 17) {
      partial = [...partial, ...shuffled.slice(i, i + 17)];
      d(partial); // estados intermediários nunca lançam
    }
    expect(flat(d(partial))).toBe(flat(d(evs)));
  });
});

describe("resumo por dia (sincronização)", () => {
  const e = (id: string, ts: number) => ev("ana", ts, { k: "del", target: "x" }, id);
  it("não depende da ordem dos eventos", () => {
    const list = [e("a", 1), e("b", 2), e("c", 3)];
    expect(summarize(list)).toEqual(summarize([...list].reverse()));
  });
  it("muda quando falta ou sobra um evento (é assim que um peer descobre o que falta)", () => {
    const full = summarize([e("a", 1), e("b", 2)]);
    expect(summarize([e("a", 1)])).not.toEqual(full);
    expect(summarize([e("a", 1), e("b", 2), e("c", 3)])).not.toEqual(full);
    expect(summarize([e("a", 1), e("x", 2)])).not.toEqual(full);
  });
  it("separa por dia (UTC) e conta os eventos", () => {
    const day = 86_400_000;
    const s = summarize([e("a", 0), e("b", day - 1), e("c", day)]);
    expect(Object.keys(s)).toEqual(["0", "1"]);
    expect(s["0"].startsWith("2:")).toBe(true);
    expect(s["1"].startsWith("1:")).toBe(true);
    expect(dayKey(day - 1)).toBe("0");
    expect(dayKey(day)).toBe("1");
  });
  it("vazio dá resumo vazio", () => {
    expect(summarize([])).toEqual({});
  });
});
