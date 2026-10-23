// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeInvite } from "../../src/lib/storage";
import type { ServerInfo } from "../../src/lib/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const owner = "A".repeat(43);
const srv = (n: number): ServerInfo => ({ sid: "sid" + n, roomId: "sala" + n, password: "senha" + n, owner, name: "Servidor " + n, channels: [], joinedAt: 1 });
const app = {
  servers: [] as ServerInfo[],
  sessions: new Map<string, unknown>(),
  effectiveProfile: () => ({ name: "Enrell" }),
  unreadFor: () => 0,
  selectServer: vi.fn(),
  showToast: vi.fn(),
};
vi.mock("../../src/lib/app", () => ({ useApp: () => app, app: {}, COLORS: [], randomColor: () => "#fff" }));
vi.mock("../../src/lib/rtc", () => ({ mediaErrorMessage: () => "" }));
vi.mock("../../src/lib/session", () => ({ selfId: "ME" }));
vi.mock("../../src/components/Shell", () => ({ initials: (n: string) => n.slice(0, 2) }));
vi.mock("../../src/components/common", () => ({
  Avatar: () => null,
  Icons: new Proxy({}, { get: () => () => null }),
  Modal: ({ title, children }: { title: string; children: ReactNode }) => (
    <div role="dialog">
      <h2>{title}</h2>
      {children}
    </div>
  ),
}));

const { Home } = await import("../../src/components/Modals");

let root: Root;
let host: HTMLElement;
const onAdd = vi.fn();
const onJoin = vi.fn();
const writeText = vi.fn(async () => undefined);
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  app.servers = [];
  app.sessions = new Map();
  for (const f of [onAdd, onJoin, writeText, app.selectServer, app.showToast]) f.mockClear();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const show = () => act(() => root.render(<Home onAdd={onAdd} onJoin={onJoin} />));
const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(text));
const session = (member = true, peers = 0) => ({ isMember: () => member, peers: Object.fromEntries(Array.from({ length: peers }, (_, i) => ["p" + i, { profile: {} }])), server: srv(1), name: "Servidor 1" });

describe("página inicial sem servidores: ajuda a começar", () => {
  it("mostra os passos e as duas saídas: criar ou entrar com convite", () => {
    show();
    expect(host.textContent).toContain("Você ainda não está em nenhum servidor.");
    expect(host.textContent).toContain("Crie um servidor");
    expect(button("Copiar link")).toBeUndefined();
    act(() => button("Criar um servidor")!.click());
    act(() => button("Tenho um convite")!.click());
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onJoin).toHaveBeenCalledTimes(1);
  });
});

describe("página inicial com servidores: serve para chamar amigos", () => {
  beforeEach(() => {
    app.servers = [srv(1), srv(2)];
    app.sessions = new Map([["sid1", session(true, 3)]]);
  });

  it("não manda criar servidor de novo: sem os passos de iniciante", () => {
    show();
    expect(host.textContent).not.toContain("Crie um servidor");
    expect(host.textContent).not.toContain("Você ainda não está em nenhum servidor");
    expect(host.textContent).toContain("Chame seus amigos");
  });

  it("lista cada servidor com quantos estão online", () => {
    show();
    expect(host.textContent).toContain("Servidor 1");
    expect(host.textContent).toContain("3 online");
    expect(host.textContent).toContain("Servidor 2");
  });

  it("'Copiar link' copia o link de convite daquele servidor e avisa", async () => {
    show();
    const [first] = host.querySelectorAll(".home-card");
    await act(async () => [...first.querySelectorAll("button")].find((b) => b.textContent?.includes("Copiar link"))!.click());
    expect(writeText).toHaveBeenCalledWith("nexo://join/" + encodeInvite(srv(1)));
    expect(app.showToast).toHaveBeenCalledWith(expect.stringContaining("Servidor 1"));
  });

  it("se a área de transferência falhar, avisa com erro (não finge que copiou)", async () => {
    writeText.mockRejectedValueOnce(new Error("negado"));
    show();
    await act(async () => button("Copiar link")!.click());
    expect(app.showToast).toHaveBeenCalledWith(expect.stringContaining("Não consegui copiar"), "error");
  });

  it("'Convite' abre o link e o código para colar em apps que não clicam em nexo://", () => {
    show();
    act(() => button("Convite")!.click());
    const dialog = host.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("nexo://join/");
    expect(dialog.textContent).toContain("Servidor 1");
  });

  it("atalhos para entrar com o convite de um amigo e para criar outro servidor", () => {
    show();
    act(() => button("Tenho um convite de um amigo")!.click());
    act(() => button("Criar outro servidor")!.click());
    expect(onJoin).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("clicar no nome do servidor abre o servidor", () => {
    show();
    act(() => (host.querySelector('[aria-label="Abrir Servidor 2"]') as HTMLButtonElement).click());
    expect(app.selectServer).toHaveBeenCalledWith("sala2");
  });

  it("servidor em que ainda não fui aprovado: não oferece convite", () => {
    app.sessions = new Map([["sid1", session(false)]]);
    show();
    const [first] = host.querySelectorAll(".home-card");
    expect(first.textContent).toContain("aguardando aprovação");
    expect(first.textContent).not.toContain("Copiar link");
  });
});
