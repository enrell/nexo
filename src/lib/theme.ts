/**
 * Tema do Nexo: uma cor de destaque só, sobre um tom base neutro e quente.
 * As superfícies (coluna lateral, centro, menus, campos) são derivadas do tom base
 * em src/App.css, então trocar o fundo troca o conjunto inteiro. Sem degradês e sem blur.
 * A imagem do próprio usuário fica no banco local cifrado.
 */
import { db } from "./db";
import type { Settings } from "./types";

/** Aumente quando mudarem os ids das paletas: quem tem tema salvo de uma versão antiga volta ao padrão. */
export const THEME_REV = 2;

export type Accent = { id: string; name: string; a1: string };
export type Background = { id: string; name: string; base: string };

export const ACCENTS: Accent[] = [
  { id: "argila", name: "Argila", a1: "#dd8566" },
  { id: "ambar", name: "Âmbar", a1: "#e0b050" },
  { id: "musgo", name: "Musgo", a1: "#93b87a" },
  { id: "mare", name: "Maré", a1: "#78a9c9" },
  { id: "uva", name: "Uva", a1: "#a994c9" },
  { id: "grafite", name: "Grafite", a1: "#d0ccc4" },
];

export const BACKGROUNDS: Background[] = [
  { id: "carvao", name: "Carvão", base: "#131211" },
  { id: "noite", name: "Noite", base: "#0f1217" },
  { id: "floresta", name: "Floresta", base: "#0f1311" },
  { id: "vinho", name: "Vinho", base: "#16100f" },
  { id: "breu", name: "Breu", base: "#08080a" },
];

export const DENSITY: Record<Settings["density"], { pad: string }> = {
  compact: { pad: "10px" },
  normal: { pad: "14px" },
  airy: { pad: "20px" },
};

const CUSTOM_BG_ID = "theme-background";
let customUrl: string | null = null;

export const accentOf = (s: Settings) => ACCENTS.find((a) => a.id === s.themeAccent) ?? ACCENTS[0];

/** Aplica o tema nas variáveis CSS da página. */
export async function applyTheme(s: Settings) {
  const root = document.documentElement;
  const a = accentOf(s);
  root.style.setProperty("--a1", a.a1);
  root.style.setProperty("--panel-alpha", String(Math.min(100, Math.max(55, s.panelAlpha)) / 100));
  root.style.setProperty("--r", `${s.radius}px`);
  root.style.setProperty("--r-sm", `${Math.max(6, Math.round(s.radius * 0.66))}px`);
  root.style.setProperty("--pad", DENSITY[s.density].pad);
  root.style.setProperty("--font-scale", String(s.fontScale / 100));
  root.classList.toggle("compact", s.density === "compact");

  let base = (BACKGROUNDS.find((b) => b.id === s.themeBg) ?? BACKGROUNDS[0]).base;
  let css = base;
  if (s.themeBg === "custom") {
    if (!customUrl) {
      const blob = await db.getBlob(CUSTOM_BG_ID);
      if (blob) customUrl = URL.createObjectURL(new Blob([blob.data], { type: blob.mime }));
    }
    if (customUrl) {
      // escurece um pouco para o texto continuar legível sobre qualquer foto
      base = BACKGROUNDS[0].base;
      css = `linear-gradient(rgba(8,8,10,.3), rgba(8,8,10,.55)), url("${customUrl}") center / cover no-repeat, ${base}`;
    }
  }
  document.body.style.background = css;
  root.style.setProperty("--base", base);
}

/** Guarda a imagem de fundo do usuário (reduzida e cifrada no banco local). */
export async function setCustomBackground(file: File): Promise<void> {
  if (!file.type.startsWith("image/")) throw new Error("escolha um arquivo de imagem");
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 2560 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("falha ao processar a imagem"))), "image/jpeg", 0.86));
  await db.putBlob({ id: CUSTOM_BG_ID, data: await blob.arrayBuffer(), mime: "image/jpeg", name: "fundo.jpg", ts: Date.now() });
  if (customUrl) URL.revokeObjectURL(customUrl);
  customUrl = URL.createObjectURL(blob);
}

/** Cor de um servidor derivada do id: estável, chapada e diferente entre servidores. */
const SERVER_COLORS = ["#a8553a", "#8a6d2c", "#547a46", "#3f6f90", "#6d5a96", "#9a4f6c", "#2f7a6c", "#7a6451"];
export function serverColor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return SERVER_COLORS[h % SERVER_COLORS.length];
}
