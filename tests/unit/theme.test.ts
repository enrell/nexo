// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../src/lib/db";
import { defaultSettings } from "../../src/lib/storage";
import { ACCENTS, BACKGROUNDS, DENSITY, THEME_REV, accentOf, applyTheme, serverColor, setCustomBackground } from "../../src/lib/theme";
import { initVault } from "../../src/lib/vault";

beforeAll(initVault);
beforeEach(() => {
  document.documentElement.removeAttribute("style");
  document.documentElement.className = "";
  document.body.removeAttribute("style");
});
const css = (name: string) => document.documentElement.style.getPropertyValue(name);

describe("tema", () => {
  it("o padrão aplica a cor, o tom base e as medidas", async () => {
    await applyTheme(defaultSettings);
    expect(css("--a1")).toBe(ACCENTS[0].a1);
    expect(css("--base")).toBe(BACKGROUNDS[0].base);
    expect(css("--panel-alpha")).toBe("1");
    expect(css("--r")).toBe("10px");
    expect(css("--r-sm")).toBe("7px");
    expect(css("--pad")).toBe(DENSITY.normal.pad);
    expect(css("--font-scale")).toBe("1");
    expect(document.body.style.background).toContain("rgb(19, 18, 17)");
  });

  it("cada paleta e cada fundo existem e têm cores válidas", () => {
    for (const a of ACCENTS) expect(a.a1).toMatch(/^#[0-9a-f]{6}$/i);
    for (const b of BACKGROUNDS) expect(b.base).toMatch(/^#[0-9a-f]{6}$/i);
    expect(new Set(ACCENTS.map((a) => a.id)).size).toBe(ACCENTS.length);
    expect(new Set(BACKGROUNDS.map((b) => b.id)).size).toBe(BACKGROUNDS.length);
  });

  it("id desconhecido (tema salvo por outra versão) cai no padrão, sem erro", async () => {
    await applyTheme({ ...defaultSettings, themeAccent: "constelacao", themeBg: "nebulosa" });
    expect(css("--a1")).toBe(ACCENTS[0].a1);
    expect(css("--base")).toBe(BACKGROUNDS[0].base);
    expect(accentOf({ ...defaultSettings, themeAccent: "nada" })).toBe(ACCENTS[0]);
  });

  it("opacidade dos painéis fica entre 55% e 100%", async () => {
    await applyTheme({ ...defaultSettings, panelAlpha: 10 });
    expect(css("--panel-alpha")).toBe("0.55");
    await applyTheme({ ...defaultSettings, panelAlpha: 500 });
    expect(css("--panel-alpha")).toBe("1");
  });

  it("raio dos cantos: o interno acompanha, com mínimo de 6px", async () => {
    await applyTheme({ ...defaultSettings, radius: 4 });
    expect(css("--r-sm")).toBe("6px");
    await applyTheme({ ...defaultSettings, radius: 16 });
    expect(css("--r-sm")).toBe("11px");
  });

  it("densidade compacta liga a classe e troca o espaçamento", async () => {
    await applyTheme({ ...defaultSettings, density: "compact" });
    expect(document.documentElement.classList.contains("compact")).toBe(true);
    expect(css("--pad")).toBe(DENSITY.compact.pad);
    await applyTheme({ ...defaultSettings, density: "airy" });
    expect(document.documentElement.classList.contains("compact")).toBe(false);
  });

  it("imagem própria escolhida mas ausente: usa o fundo padrão", async () => {
    await applyTheme({ ...defaultSettings, themeBg: "custom" });
    expect(css("--base")).toBe(BACKGROUNDS[0].base);
    expect(document.body.style.background).not.toContain("url(");
  });

  it("imagem própria guardada: vira o fundo, escurecida para o texto continuar legível", async () => {
    const create = vi.fn(() => "blob:fake");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() }));
    await db.putBlob({ id: "theme-background", data: new Uint8Array([1, 2, 3]).buffer as ArrayBuffer, mime: "image/jpeg", name: "fundo.jpg", ts: 1 });
    await applyTheme({ ...defaultSettings, themeBg: "custom" });
    expect(create).toHaveBeenCalled();
    expect(document.body.style.background).toContain("blob:fake");
    expect(document.body.style.background).toContain("linear-gradient");
    vi.unstubAllGlobals();
  });

  it("só aceita imagem como fundo", async () => {
    await expect(setCustomBackground(new File(["x"], "a.txt", { type: "text/plain" }))).rejects.toThrow("escolha um arquivo de imagem");
  });

  it("a revisão do tema é positiva (a migração de configurações depende dela)", () => {
    expect(THEME_REV).toBeGreaterThanOrEqual(2);
    expect(defaultSettings.themeRev).toBe(THEME_REV);
  });
});

describe("cor do servidor", () => {
  it("é estável para o mesmo id e distribui os ids", () => {
    expect(serverColor("abc")).toBe(serverColor("abc"));
    const colors = new Set(Array.from({ length: 200 }, (_, i) => serverColor("srv" + i)));
    expect(colors.size).toBeGreaterThan(5);
    for (const c of colors) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
