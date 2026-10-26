import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_REV } from "../../src/lib/theme";
import { QUARANTINE, decodeInvite, defaultSettings, encodeInvite, flushSecureStore, initSecureStore, inviteLink, randomId, resetSecureStoreForTests, storage } from "../../src/lib/storage";
import type { ServerInfo } from "../../src/lib/types";
import { initVault, sealString } from "../../src/lib/vault";

beforeAll(initVault);
beforeEach(() => {
  localStorage.clear();
  resetSecureStoreForTests();
});

/** "Fechar e abrir o app": esquece a memória e relê do disco. */
async function restart() {
  await flushSecureStore();
  resetSecureStoreForTests();
  await initSecureStore();
}

describe("armazenamento local cifrado", () => {
  it("o que vai para o disco não contém o valor em claro", async () => {
    storage.set("profile", { name: "Nome-Muito-Reconhecivel", token: "senha-12345" });
    await flushSecureStore();
    const raw = localStorage.getItem("nexo:profile")!;
    expect(raw.startsWith("v1:")).toBe(true);
    expect(raw).not.toContain("Reconhecivel");
    expect(raw).not.toContain("senha-12345");
  });

  it("sobrevive a fechar e abrir o app", async () => {
    storage.set("a", { n: 1, lista: [1, 2, { x: "ç😀" }] });
    storage.set("b", "texto");
    await restart();
    expect(storage.get("a", null)).toEqual({ n: 1, lista: [1, 2, { x: "ç😀" }] });
    expect(storage.get("b", null)).toBe("texto");
  });

  it("devolve cópias: mexer no que foi lido não altera o que está guardado", () => {
    storage.set("a", { itens: [1] });
    const lido = storage.get<{ itens: number[] }>("a", { itens: [] });
    lido.itens.push(2);
    expect(storage.get("a", null)).toEqual({ itens: [1] });
  });

  it("gravações rápidas da mesma chave terminam com a última", async () => {
    for (let i = 0; i < 40; i++) storage.set("contador", i);
    await restart();
    expect(storage.get("contador", -1)).toBe(39);
  });

  it("remover apaga da memória e do disco", async () => {
    storage.set("a", 1);
    await flushSecureStore();
    storage.remove("a");
    expect(localStorage.getItem("nexo:a")).toBeNull();
    expect(storage.get("a", "vazio")).toBe("vazio");
  });

  it("dado antigo em texto puro é lido e cifrado na hora", async () => {
    localStorage.setItem("nexo:legado", JSON.stringify({ nome: "Ana" }));
    await initSecureStore();
    expect(storage.get("legado", null)).toEqual({ nome: "Ana" });
    await flushSecureStore();
    const raw = localStorage.getItem("nexo:legado")!;
    expect(raw.startsWith("v1:")).toBe(true);
    expect(raw).not.toContain("Ana");
  });

  it("ignora chaves que não são do Nexo", async () => {
    localStorage.setItem("outra-coisa", "x");
    await initSecureStore();
    expect(localStorage.getItem("outra-coisa")).toBe("x");
  });

  it("registro ilegível vai para a quarentena em vez de ser apagado (a identidade pode estar nele)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    localStorage.setItem("nexo:identity", "v1:lixo-que-nao-decifra");
    await initSecureStore();
    expect(storage.get("identity", "fallback")).toBe("fallback");
    expect(localStorage.getItem("nexo:identity")).toBeNull();
    expect(localStorage.getItem(QUARANTINE + "identity")).toBe("v1:lixo-que-nao-decifra");
  });

  it("registro copiado para outra chave é detectado (AAD) e fica em quarentena", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    storage.set("a", "valor de a");
    await flushSecureStore();
    localStorage.setItem("nexo:b", localStorage.getItem("nexo:a")!);
    resetSecureStoreForTests();
    await initSecureStore();
    expect(storage.get("a", null)).toBe("valor de a");
    expect(storage.get("b", "nada")).toBe("nada");
    expect(localStorage.getItem(QUARANTINE + "b")).not.toBeNull();
  });

  it("JSON inválido cifrado corretamente também não derruba a inicialização", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    localStorage.setItem("nexo:ruim", await sealString("{nao é json", "ls:ruim"));
    await expect(initSecureStore()).resolves.toBeUndefined();
    expect(localStorage.getItem(QUARANTINE + "ruim")).not.toBeNull();
  });

  it("falha ao gravar (disco cheio) não lança para quem chamou", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const spy = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("disco cheio");
    });
    expect(() => storage.set("x", 1)).not.toThrow();
    await expect(flushSecureStore()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("falha ao salvar", "x", expect.any(Error));
    expect(storage.get("x", 0)).toBe(1); // continua valendo em memória
    spy.mockRestore();
  });
});

describe("configurações", () => {
  it("sem nada salvo: padrões", () => {
    expect(storage.loadSettings()).toEqual(defaultSettings);
  });

  it("o que foi salvo vence o padrão; o que falta vem do padrão (versões novas ganham opções novas)", () => {
    storage.saveSettings({ ...defaultSettings, outputVolume: 40, themeRev: THEME_REV });
    const s = storage.loadSettings();
    expect(s.outputVolume).toBe(40);
    expect(s.notifyMode).toBe(defaultSettings.notifyMode);
    storage.set("settings", { outputVolume: 40, themeRev: THEME_REV }); // arquivo de uma versão que não tinha as outras chaves
    expect(storage.loadSettings()).toEqual({ ...defaultSettings, outputVolume: 40 });
  });

  it("tema de versão antiga volta ao padrão, sem perder as demais configurações", () => {
    storage.set("settings", { outputVolume: 40, themeAccent: "constelacao", themeBg: "nebulosa", panelAlpha: 55, radius: 8 });
    const s = storage.loadSettings();
    expect(s).toMatchObject({ outputVolume: 40, themeAccent: defaultSettings.themeAccent, themeBg: defaultSettings.themeBg, panelAlpha: defaultSettings.panelAlpha, radius: defaultSettings.radius, themeRev: THEME_REV });
  });

  it("tema da versão atual é preservado", () => {
    storage.set("settings", { themeRev: THEME_REV, themeAccent: "mare", radius: 4 });
    expect(storage.loadSettings()).toMatchObject({ themeAccent: "mare", radius: 4 });
  });

  it("padrões seguros: nada que vaze o IP ou o conteúdo sem o usuário pedir", () => {
    expect(defaultSettings).toMatchObject({ linkPreviews: false, notifyPreview: false, relayOnly: false });
  });
});

describe("servidores", () => {
  it("servidor salvo por versão antiga recebe os campos novos", () => {
    storage.set("servers", [{ roomId: "r1", password: "p1", name: "Antigo" }]);
    const [s] = storage.loadServers();
    expect(s).toMatchObject({ sid: "r1", roomId: "r1", owner: "", channels: [{ id: "geral", name: "geral" }] });
    expect(typeof s.joinedAt).toBe("number");
  });
  it("vai e volta", () => {
    const srv: ServerInfo = { sid: "s", roomId: "r", password: "p", owner: "o", name: "N", channels: [{ id: "geral", name: "geral" }], joinedAt: 5 };
    storage.saveServers([srv]);
    expect(storage.loadServers()).toEqual([srv]);
  });
});

describe("convites", () => {
  const owner = "A".repeat(43);
  const srv: ServerInfo = { sid: "sid123", roomId: "abcdefghijklmnopqrst", password: "pass-word_24chars", owner, name: "Café ☕ dos amigos", channels: [], joinedAt: 1 };

  it("codifica e decodifica, inclusive acentos e emoji", () => {
    const code = encodeInvite(srv);
    expect(code).toMatch(/^nexo-[A-Za-z0-9_-]+$/);
    expect(decodeInvite(code)).toEqual({ name: "Café ☕ dos amigos", roomId: srv.roomId, password: srv.password, owner, sid: "sid123" });
  });

  it("o link de convite é https (clicável no Discord/WhatsApp) e o código vai só no fragmento", () => {
    const link = inviteLink(srv);
    expect(link).toBe("https://enrell.github.io/nexo/c/#" + encodeInvite(srv));
    expect(new URL(link).pathname).toBe("/nexo/c/");
    expect(decodeInvite(link)).toEqual(decodeInvite(encodeInvite(srv)));
    expect(decodeInvite("nexo://join/" + encodeInvite(srv))?.roomId).toBe(srv.roomId);
  });

  it("aceita o link nexo://join/… e texto em volta (colado de uma conversa)", () => {
    expect(decodeInvite(inviteLink(srv))?.roomId).toBe(srv.roomId);
    expect(decodeInvite(`  Entra aí: ${encodeInvite(srv)} valeu!\n`)?.roomId).toBe(srv.roomId);
  });

  const forge = (obj: unknown) => "nexo-" + Buffer.from(JSON.stringify(obj)).toString("base64url");
  it.each<[string, unknown]>([
    ["sala ausente", { p: "x" }],
    ["senha ausente", { r: "x" }],
    ["sala não string", { r: 5, p: "x" }],
    ["sala gigante", { r: "a".repeat(65), p: "x" }],
    ["senha gigante", { r: "a", p: "x".repeat(129) }],
    ["sala com caracteres estranhos", { r: "a b/../c", p: "x" }],
    ["JSON que não é objeto", null],
    ["JSON que é número", 7],
  ])("recusa convite com %s", (_n, obj) => expect(decodeInvite(forge(obj))).toBeNull());

  it("campos opcionais ruins são saneados, não recusam o convite", () => {
    const out = decodeInvite(forge({ r: "sala", p: "senha", n: "n".repeat(500), o: "naoeumachave", s: { x: 1 } }));
    expect(out).toEqual({ name: "n".repeat(60), roomId: "sala", password: "senha", owner: "", sid: "sala" });
    expect(decodeInvite(forge({ r: "sala", p: "senha", n: { evil: 1 } }))?.name).toBe("Servidor");
    expect(decodeInvite(forge({ r: "sala", p: "senha", n: "   " }))?.name).toBe("Servidor");
  });

  it.each(["", "oi", "nexo-", "nexo-%%%", "nexo-!!!!", "nexo-bm90IGpzb24"])("lixo %j não lança, devolve null", (s) => expect(decodeInvite(s)).toBeNull());
});

describe("randomId", () => {
  it("tem o tamanho pedido e só caracteres legíveis (sem 0, 1, l, o)", () => {
    for (const n of [1, 10, 20, 32]) expect(randomId(n)).toMatch(new RegExp(`^[a-km-np-z2-9]{${n}}$`));
    expect(randomId()).toHaveLength(16);
  });
  it("não repete", () => {
    expect(new Set(Array.from({ length: 2000 }, () => randomId(20))).size).toBe(2000);
  });
});
