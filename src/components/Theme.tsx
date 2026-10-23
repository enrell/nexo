import { ArrowCounterClockwise, ImageSquare, Trash } from "@phosphor-icons/react";
import { useRef } from "react";
import { useApp } from "../lib/app";
import { ACCENTS, BACKGROUNDS, setCustomBackground } from "../lib/theme";
import { defaultSettings } from "../lib/storage";
import type { Settings } from "../lib/types";

/** Editor de aparência: as mudanças aparecem na hora e ficam salvas (cifradas) neste PC. */
export function ThemeEditor() {
  const a = useApp();
  const st = a.settings;
  const file = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<Settings>) => a.setSettings({ ...a.settings, ...patch });

  return (
    <div className="theme-editor">
      <p className="ctx-note">Uma cor de destaque sobre um tom base. As superfícies se ajustam ao fundo escolhido.</p>

      <section className="sec">
        <h5>Cores de destaque</h5>
        <div className="swatches">
          {ACCENTS.map((ac) => (
            <button
              key={ac.id}
              className={"swatch" + (st.themeAccent === ac.id ? " on" : "")}
              style={{ background: ac.a1 }}
              data-tip={ac.name}
              aria-label={ac.name}
              onClick={() => set({ themeAccent: ac.id })}
            />
          ))}
        </div>
      </section>

      <section className="sec">
        <h5>Fundo</h5>
        <div className="bgs">
          {BACKGROUNDS.map((bg) => (
            <button key={bg.id} className={"bg-opt" + (st.themeBg === bg.id ? " on" : "")} style={{ background: bg.base }} onClick={() => set({ themeBg: bg.id })}>
              <span>{bg.name}</span>
            </button>
          ))}
          <button className={"bg-opt upload" + (st.themeBg === "custom" ? " on" : "")} onClick={() => file.current?.click()}>
            <ImageSquare size={18} weight="duotone" />
            <span>Sua imagem</span>
          </button>
        </div>
        <input
          ref={file}
          type="file"
          accept="image/*"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            try {
              await setCustomBackground(f);
              set({ themeBg: "custom" });
            } catch (err) {
              a.showToast(err instanceof Error ? err.message : String(err), "error");
            }
          }}
        />
        {st.themeBg === "custom" && (
          <button className="link small-link" onClick={() => set({ themeBg: defaultSettings.themeBg })}>
            <Trash size={13} weight="duotone" /> deixar de usar minha imagem
          </button>
        )}
        <p className="ctx-note">Sua imagem fica cifrada neste PC e nunca é enviada a ninguém.</p>
      </section>

      <section className="sec">
        <h5>
          <span>Opacidade dos painéis</span>
          <span>{st.panelAlpha}%</span>
        </h5>
        <input type="range" min={55} max={100} value={st.panelAlpha} onChange={(e) => set({ panelAlpha: +e.target.value })} aria-label="Opacidade dos painéis" />
      </section>

      <section className="sec">
        <h5>Cantos</h5>
        <div className="seg">
          {(
            [
              [4, "retos"],
              [10, "suaves"],
              [16, "redondos"],
            ] as const
          ).map(([v, l]) => (
            <button key={v} className={st.radius === v ? "on" : ""} onClick={() => set({ radius: v })}>
              {l}
            </button>
          ))}
        </div>
      </section>

      <section className="sec">
        <h5>Densidade</h5>
        <div className="seg">
          {(
            [
              ["compact", "compacta"],
              ["normal", "normal"],
              ["airy", "arejada"],
            ] as const
          ).map(([v, l]) => (
            <button key={v} className={st.density === v ? "on" : ""} onClick={() => set({ density: v })}>
              {l}
            </button>
          ))}
        </div>
      </section>

      <button
        className="btn ghost full"
        onClick={() =>
          set({
            themeAccent: defaultSettings.themeAccent,
            themeBg: defaultSettings.themeBg,
            panelAlpha: defaultSettings.panelAlpha,
            radius: defaultSettings.radius,
            density: defaultSettings.density,
          })
        }
      >
        <ArrowCounterClockwise size={16} weight="bold" /> Voltar ao padrão
      </button>
    </div>
  );
}
