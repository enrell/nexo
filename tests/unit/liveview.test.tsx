// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const app = { channelOf: () => "geral", theater: false, deafened: false, toggleTheater: vi.fn(), closeLive: vi.fn(), showToast: vi.fn() };
vi.mock("../../src/lib/app", () => ({ useApp: () => app }));
vi.mock("../../src/lib/session", () => ({ selfId: "ME" }));
vi.mock("../../src/components/Chat", () => ({ ChatView: () => null }));
vi.mock("../../src/components/common", () => ({ Avatar: () => null, MediaView: () => null, Icons: new Proxy({}, { get: () => () => null }) }));

const { LiveView } = await import("../../src/components/Live");

const live = { title: "Jogando", kind: "screen", startedAt: Date.now(), viewers: 0, viewerKeys: [], audio: true };
const session = (over: Record<string, unknown> = {}) => ({ state: { channels: [{ id: "geral", name: "geral" }] }, myLive: null, myStream: null, peers: {}, watching: null, peerName: () => "Enrell", profileOf: () => ({ name: "x", color: "#fff" }), watch: vi.fn(), stopLive: vi.fn(), liveStats: vi.fn(), ...over });

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  for (const f of [app.toggleTheater, app.closeLive, app.showToast]) f.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const show = (s: unknown, origin: string) => act(() => root.render(<LiveView s={s as never} origin={origin} />));
const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(text));

describe("tela da live", () => {
  it("minha live no ar: mostra 'Parar transmissão' e continua na tela", () => {
    show(session({ myLive: live }), "ME");
    expect(button("Parar transmissão")).toBeTruthy();
    expect(app.closeLive).not.toHaveBeenCalled();
  });

  it("'Parar transmissão' encerra a live", () => {
    const s = session({ myLive: live });
    show(s, "ME");
    act(() => button("Parar transmissão")!.click());
    expect(s.stopLive).toHaveBeenCalledTimes(1);
  });

  it("depois de parar, volta ao chat sozinho (antes ficava 'Live encerrada' com 'Parar transmissão' ainda ativo)", () => {
    show(session({ myLive: live }), "ME");
    show(session({ myLive: null }), "ME"); // a transmissão acabou
    expect(app.closeLive).toHaveBeenCalledTimes(1);
    expect(button("Parar transmissão")).toBeUndefined();
  });

  it("abrir a tela da minha live quando já não há live também volta ao chat", () => {
    show(session({ myLive: null }), "ME");
    expect(app.closeLive).toHaveBeenCalled();
    expect(button("Parar transmissão")).toBeUndefined();
  });

  it("live de outra pessoa que acabou: avisa e oferece voltar, sem botão de parar e sem sair sozinho", () => {
    show(session({ peers: { P1: { pub: "p", live: null } } }), "P1");
    expect(host.textContent).toContain("Essa transmissão acabou.");
    expect(button("Parar transmissão")).toBeUndefined();
    expect(app.closeLive).not.toHaveBeenCalled();
    act(() => button("Voltar ao chat")!.click());
    expect(app.closeLive).toHaveBeenCalledTimes(1);
  });

  it("live de outra pessoa no ar: não mostra 'Parar transmissão'", () => {
    show(session({ peers: { P1: { pub: "p", live } } }), "P1");
    expect(button("Parar transmissão")).toBeUndefined();
    expect(app.closeLive).not.toHaveBeenCalled();
  });
});
