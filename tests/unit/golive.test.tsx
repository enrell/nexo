// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SOUNDS } from "../../src/lib/audio";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const app = { settings: { preset: "medium", quality: "1080p30" }, setSettings: vi.fn(), audio: { play: vi.fn() }, selectServer: vi.fn(), openLive: vi.fn(), showToast: vi.fn() };
vi.mock("../../src/lib/app", () => ({ useApp: () => app, app: {}, COLORS: [], randomColor: () => "#fff" }));
vi.mock("../../src/lib/rtc", () => ({ mediaErrorMessage: () => "" }));
vi.mock("../../src/lib/session", () => ({ selfId: "ME" }));
vi.mock("../../src/components/Shell", () => ({ initials: (n: string) => n.slice(0, 2) }));
vi.mock("../../src/components/common", () => ({
  Avatar: () => null,
  Icons: new Proxy({}, { get: () => () => null }),
  Modal: ({ title, children, footer }: { title: string; children: ReactNode; footer: ReactNode }) => (
    <div role="dialog">
      <h2>{title}</h2>
      {children}
      {footer}
    </div>
  ),
}));

const { GoLiveModal } = await import("../../src/components/Modals");

const src = (id: string, name: string, isScreen: boolean) => ({ id, name, isScreen, thumbnail: "data:,", icon: null });
let sources = [src("screen:1", "Tela 1", true), src("screen:2", "Tela 2", true), src("window:a", "Jogo", false), src("window:b", "Navegador", false)];
const startLive = vi.fn(async () => undefined);
const s = { name: "Townsville", server: { roomId: "sala" }, startLive } as never;

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  startLive.mockClear();
  sources = [src("screen:1", "Tela 1", true), src("screen:2", "Tela 2", true), src("window:a", "Jogo", false), src("window:b", "Navegador", false)];
  (window as { nexo?: unknown }).nexo = { getSources: async () => sources };
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const tab = (name: string) => [...host.querySelectorAll('[role="tab"]')].find((b) => b.textContent?.includes(name)) as HTMLButtonElement;
const names = () => [...host.querySelectorAll(".source")].map((b) => b.textContent);
const selected = () => host.querySelector(".source.sel")?.textContent;
async function show(initialKind?: "screen" | "camera") {
  await act(async () => root.render(<GoLiveModal s={s} onClose={() => {}} initialKind={initialKind} />));
}
const click = (el: Element) => act(async () => (el as HTMLElement).click());

describe("transmitir: telas e janelas em abas separadas", () => {
  it("abre em Telas mostrando só telas; Janelas mostra só janelas", async () => {
    await show();
    expect([...host.querySelectorAll('[role="tab"]')].map((t) => t.textContent?.trim())).toEqual(["Telas", "Janelas", "Câmera"]);
    expect(tab("Telas").getAttribute("aria-selected")).toBe("true");
    expect(names()).toEqual(["Tela 1", "Tela 2"]);
    await click(tab("Janelas"));
    expect(names()).toEqual(["Jogo", "Navegador"]);
  });

  it("cada aba lembra a própria escolha e transmite o que está selecionado na aba aberta", async () => {
    await show();
    expect(selected()).toBe("Tela 1");
    await click(host.querySelectorAll(".source")[1]);
    await click(tab("Janelas"));
    expect(selected()).toBe("Jogo");
    await click(host.querySelectorAll(".source")[1]);
    await click(tab("Telas"));
    expect(selected()).toBe("Tela 2");
    await click(tab("Janelas"));
    await click([...host.querySelectorAll("button")].find((b) => b.textContent === "Ficar ao vivo")!);
    expect(startLive).toHaveBeenCalledWith("screen", expect.any(String), { sourceId: "window:b", audio: true });
  });

  it("janela escolhida que fechou: cai para a primeira janela na próxima atualização", async () => {
    await show();
    await click(tab("Janelas"));
    await click(host.querySelectorAll(".source")[1]);
    sources = sources.filter((x) => x.id !== "window:b");
    await act(async () => vi.advanceTimersByTime(4000));
    expect(selected()).toBe("Jogo");
  });

  it("sem janelas abertas: avisa e não deixa ficar ao vivo sem escolha", async () => {
    sources = sources.filter((x) => x.isScreen);
    await show();
    await click(tab("Janelas"));
    expect(host.textContent).toContain("Nenhuma janela aberta para transmitir.");
    expect(([...host.querySelectorAll("button")].find((b) => b.textContent === "Ficar ao vivo") as HTMLButtonElement).disabled).toBe(true);
  });

  it("câmera: aba própria, sem lista de fontes", async () => {
    await show("camera");
    expect(tab("Câmera").getAttribute("aria-selected")).toBe("true");
    expect(names()).toEqual([]);
    await click([...host.querySelectorAll("button")].find((b) => b.textContent === "Ficar ao vivo")!);
    expect(startLive).toHaveBeenCalledWith("camera", expect.any(String), { sourceId: undefined, audio: true });
  });
});

describe("sons da interface", () => {
  it("todas as notas são audíveis, curtas e baixas (nada estoura no fone)", () => {
    for (const [name, notes] of Object.entries(SOUNDS)) {
      expect(notes.length, name).toBeGreaterThan(0);
      for (const [f, dt, vol = 0.12] of notes as readonly (readonly number[])[]) {
        expect(f, name).toBeGreaterThanOrEqual(200);
        expect(f, name).toBeLessThanOrEqual(2000);
        expect(dt, name).toBeGreaterThanOrEqual(0);
        expect(dt, name).toBeLessThan(0.5);
        expect(vol, name).toBeGreaterThan(0);
        expect(vol, name).toBeLessThanOrEqual(0.16);
      }
    }
  });
  it("começo e fim soam diferentes: o fim é o começo de trás para frente", () => {
    const freqs = (k: keyof typeof SOUNDS) => SOUNDS[k].map((n) => n[0]);
    expect(freqs("liveEnd")).toEqual([...freqs("live")].reverse());
    expect(freqs("leave")).toEqual([...freqs("join")].reverse());
    expect(freqs("deafen")).not.toEqual(freqs("mute"));
  });
});
