import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export type MenuItem =
  | { label: string; onClick: () => void; danger?: boolean; icon?: ReactNode; hint?: string; disabled?: boolean }
  | { sep: true }
  | { custom: ReactNode };

type State = { x: number; y: number; items: MenuItem[] } | null;

let setter: ((s: State) => void) | null = null;

/** Abre um menu de contexto na posição do evento. */
export function openMenu(e: { clientX: number; clientY: number; preventDefault?: () => void; stopPropagation?: () => void }, items: MenuItem[]) {
  e.preventDefault?.();
  e.stopPropagation?.();
  setter?.({ x: e.clientX, y: e.clientY, items });
}

export function closeMenu() {
  setter?.(null);
}

export function ContextMenuHost() {
  const [state, setState] = useState<State>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  setter = setState;

  useLayoutEffect(() => {
    if (!state || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({ x: Math.min(state.x, window.innerWidth - r.width - 8), y: Math.min(state.y, window.innerHeight - r.height - 8) });
  }, [state]);

  useEffect(() => {
    if (!state) return;
    const close = (e: Event) => {
      if (e instanceof MouseEvent && ref.current?.contains(e.target as Node)) return;
      setState(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setState(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [state]);

  if (!state) return null;
  return (
    <div className="menu ctx" ref={ref} style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      {state.items.map((it, i) =>
        "sep" in it ? (
          <div key={i} className="menu-sep" />
        ) : "custom" in it ? (
          <div key={i} className="menu-custom">
            {it.custom}
          </div>
        ) : (
          <button
            key={i}
            className={"menu-item" + (it.danger ? " danger" : "")}
            disabled={it.disabled}
            onClick={() => {
              setState(null);
              it.onClick();
            }}
          >
            <span>{it.label}</span>
            {it.hint && <span className="menu-hint">{it.hint}</span>}
            {it.icon}
          </button>
        ),
      )}
    </div>
  );
}
