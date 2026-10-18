import { useEffect, useState } from "react";
import { Icons } from "./common";

type State = { url: string; name: string } | null;
let setter: ((s: State) => void) | null = null;

export const openLightbox = (url: string, name: string) => setter?.({ url, name });

export function LightboxHost() {
  const [state, setState] = useState<State>(null);
  setter = setState;
  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setState(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state]);
  if (!state) return null;
  return (
    <div className="lightbox" onClick={() => setState(null)}>
      <img src={state.url} alt={state.name} onClick={(e) => e.stopPropagation()} />
      <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <span className="ellipsis">{state.name}</span>
        <a className="btn ghost small" href={state.url} download={state.name}>
          <Icons.Download size={16} /> Salvar
        </a>
        <button className="icon-btn" onClick={() => setState(null)} aria-label="Fechar">
          <Icons.X />
        </button>
      </div>
    </div>
  );
}
