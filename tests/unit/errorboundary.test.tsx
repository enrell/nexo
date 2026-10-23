// @vitest-environment jsdom
import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "../../src/components/ErrorBoundary";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

const render = (node: ReactNode) => act(() => root.render(node));

let explode = true;
function Bomb(): ReactNode {
  if (explode) throw new Error("anexo sem mime");
  return <p>tudo certo</p>;
}

describe("ErrorBoundary", () => {
  beforeEach(() => {
    explode = true;
  });

  it("sem erro, mostra o conteúdo normalmente", () => {
    render(
      <ErrorBoundary what="a conversa">
        <p>conteúdo</p>
      </ErrorBoundary>,
    );
    expect(host.textContent).toBe("conteúdo");
  });

  it("um erro ao desenhar vira um aviso, em vez de derrubar tudo", () => {
    render(
      <>
        <nav>menu</nav>
        <ErrorBoundary what="esta conversa">
          <Bomb />
        </ErrorBoundary>
      </>,
    );
    expect(host.querySelector("nav")?.textContent).toBe("menu"); // o resto da interface continua de pé
    const alert = host.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain("Algo deu errado");
    expect(alert.textContent).toContain("esta conversa");
    expect(alert.textContent).toContain("anexo sem mime");
    expect(alert.textContent).toContain("mensagens e sua conta estão salvas");
  });

  it("registra o erro para o diagnóstico", () => {
    render(
      <ErrorBoundary what="esta conversa">
        <Bomb />
      </ErrorBoundary>,
    );
    expect(console.error).toHaveBeenCalledWith("erro ao desenhar esta conversa:", expect.any(Error), expect.any(String));
  });

  it("'Tentar de novo' redesenha quando o problema passou", () => {
    render(
      <ErrorBoundary what="x">
        <Bomb />
      </ErrorBoundary>,
    );
    explode = false;
    act(() => (host.querySelector("button.btn:not(.ghost)") as HTMLButtonElement).click());
    expect(host.textContent).toBe("tudo certo");
  });

  it("se continuar quebrando, volta para o aviso (sem laço infinito)", () => {
    render(
      <ErrorBoundary what="x">
        <Bomb />
      </ErrorBoundary>,
    );
    act(() => (host.querySelector("button.btn:not(.ghost)") as HTMLButtonElement).click());
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("trocar de conversa (resetKey) limpa o erro sozinho", () => {
    function Page() {
      const [key, setKey] = useState("a");
      return (
        <>
          <button id="go" onClick={() => setKey("b")} />
          <ErrorBoundary what="x" resetKey={key}>
            {key === "a" ? <Bomb /> : <p>outra conversa</p>}
          </ErrorBoundary>
        </>
      );
    }
    render(<Page />);
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    act(() => (host.querySelector("#go") as HTMLButtonElement).click());
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).toBe("outra conversa");
  });

  it("'Recarregar o app' recarrega a página", () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    render(
      <ErrorBoundary what="x">
        <Bomb />
      </ErrorBoundary>,
    );
    act(() => (host.querySelector("button.ghost") as HTMLButtonElement).click());
    expect(reload).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
