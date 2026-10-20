/**
 * Tema "Constelação": tudo que o usuário personaliza vira variável CSS.
 * Sem blur: as superfícies são cor sólida com alfa, então qualquer fundo combina.
 * Os fundos prontos são gerados em CSS (nada é baixado da internet) e a imagem
 * do próprio usuário fica no banco local cifrado.
 */
import { db } from "./db";
import type { Settings } from "./types";

export type Accent = { id: string; name: string; a1: string; a2: string; a3: string };
export type Background = { id: string; name: string; css: string; stars: number };

export const ACCENTS: Accent[] = [
  { id: "constelacao", name: "Constelação", a1: "#a78bfa", a2: "#22d3ee", a3: "#f472b6" },
  { id: "por-do-sol", name: "Pôr do sol", a1: "#fb7185", a2: "#fbbf24", a3: "#f472b6" },
  { id: "aurora", name: "Aurora", a1: "#34d399", a2: "#22d3ee", a3: "#a3e635" },
  { id: "oceano", name: "Oceano", a1: "#60a5fa", a2: "#818cf8", a3: "#38bdf8" },
  { id: "lava", name: "Lava", a1: "#f97316", a2: "#ef4444", a3: "#facc15" },
  { id: "grafite", name: "Grafite", a1: "#e5e7eb", a2: "#9ca3af", a3: "#f87171" },
];

export const BACKGROUNDS: Background[] = [
  {
    id: "nebulosa",
    name: "Nebulosa",
    css: "radial-gradient(900px 600px at 15% 10%, rgba(124,58,237,.35), transparent 60%), radial-gradient(800px 600px at 90% 90%, rgba(8,145,178,.30), transparent 60%), radial-gradient(600px 400px at 60% 40%, rgba(244,114,182,.10), transparent 70%), #05060d",
    stars: 0.5,
  },
  { id: "aurora", name: "Aurora", css: "radial-gradient(1000px 500px at 50% -10%, rgba(52,211,153,.35), transparent 60%), radial-gradient(800px 500px at 100% 100%, rgba(34,211,238,.22), transparent 60%), #040a0c", stars: 0.35 },
  { id: "crepusculo", name: "Crepúsculo", css: "linear-gradient(160deg, #1a1033 0%, #3b1438 50%, #0d0b18 100%)", stars: 0.25 },
  { id: "oceano", name: "Oceano", css: "radial-gradient(1100px 700px at 80% 0%, rgba(59,130,246,.30), transparent 60%), radial-gradient(900px 600px at 0% 100%, rgba(14,165,233,.22), transparent 60%), #030712", stars: 0.3 },
  { id: "brasa", name: "Brasa", css: "radial-gradient(900px 600px at 10% 100%, rgba(249,115,22,.28), transparent 60%), radial-gradient(800px 500px at 100% 0%, rgba(239,68,68,.20), transparent 60%), #0c0605", stars: 0.15 },
  { id: "solido", name: "Sólido", css: "#0b0c18", stars: 0 },
];

export const DENSITY: Record<Settings["density"], { gap: string; pad: string }> = {
  compact: { gap: "8px", pad: "10px" },
  normal: { gap: "12px", pad: "14px" },
  airy: { gap: "18px", pad: "20px" },
};

const CUSTOM_BG_ID = "theme-background";
let customUrl: string | null = null;

export const accentOf = (s: Settings) => ACCENTS.find((a) => a.id === s.themeAccent) ?? ACCENTS[0];

/** Aplica o tema nas variáveis CSS da página. */
export async function applyTheme(s: Settings) {
  const root = document.documentElement;
  const a = accentOf(s);
  root.style.setProperty("--a1", a.a1);
  root.style.setProperty("--a2", a.a2);
  root.style.setProperty("--a3", a.a3);
  root.style.setProperty("--panel-alpha", String(Math.min(100, Math.max(55, s.panelAlpha)) / 100));
  root.style.setProperty("--r", `${s.radius}px`);
  root.style.setProperty("--r-sm", `${Math.max(6, Math.round(s.radius * 0.66))}px`);
  root.style.setProperty("--gap", DENSITY[s.density].gap);
  root.style.setProperty("--pad", DENSITY[s.density].pad);
  root.style.setProperty("--font-scale", String(s.fontScale / 100));
  root.classList.toggle("compact", s.density === "compact");

  let css = (BACKGROUNDS.find((b) => b.id === s.themeBg) ?? BACKGROUNDS[0]).css;
  let stars = (BACKGROUNDS.find((b) => b.id === s.themeBg) ?? BACKGROUNDS[0]).stars;
  if (s.themeBg === "custom") {
    if (!customUrl) {
      const blob = await db.getBlob(CUSTOM_BG_ID);
      if (blob) customUrl = URL.createObjectURL(new Blob([blob.data], { type: blob.mime }));
    }
    if (customUrl) {
      // escurece um pouco para o texto continuar legível sobre qualquer foto
      css = `linear-gradient(rgba(5,6,13,.28), rgba(5,6,13,.55)), url("${customUrl}") center / cover no-repeat, #05060d`;
      stars = 0;
    }
  }
  document.body.style.background = css;
  root.style.setProperty("--stars", String(stars));
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

/** Cor de um "planeta" (servidor) derivada do id: estável e diferente entre servidores. */
const PLANETS = [
  ["#c4b5fd", "#6d28d9"],
  ["#67e8f9", "#0e7490"],
  ["#f9a8d4", "#be185d"],
  ["#fde68a", "#b45309"],
  ["#86efac", "#15803d"],
  ["#93c5fd", "#1d4ed8"],
  ["#fca5a5", "#b91c1c"],
  ["#d8b4fe", "#7e22ce"],
];
export function planetGradient(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const [a, b] = PLANETS[h % PLANETS.length];
  return `radial-gradient(circle at 30% 30%, ${a}, ${b})`;
}
