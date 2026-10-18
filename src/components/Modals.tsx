import { useEffect, useMemo, useRef, useState } from "react";
import { COLORS, app, randomColor, useApp } from "../lib/app";
import { mediaErrorMessage } from "../lib/rtc";
import { selfId, type Session } from "../lib/session";
import { PRESETS, decodeInvite, encodeInvite, inviteLink } from "../lib/storage";
import type { StreamPreset } from "../lib/types";
import { Avatar, Icons, Modal } from "./common";
import { initials } from "./Sidebar";

export function Splash() {
  return (
    <div className="splash">
      <img src="./logo.svg" alt="" />
      <div className="spinner" />
    </div>
  );
}

export function Onboarding() {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [color, setColor] = useState(randomColor());
  const submit = () => {
    if (!name.trim()) return;
    app.setProfile({ name: name.trim().slice(0, 32), color, relaySlots: 2, status: "online" });
  };
  const steps = [
    { icon: "💬", title: "Chat, voz e lives", text: "Igual ao que você já conhece: servidores, canais, sala de voz e transmissão de tela em alta qualidade." },
    { icon: "🔒", title: "Sem servidor central", text: "Tudo vai direto do seu PC para o dos seus amigos, criptografado. Ninguém no meio guarda suas conversas." },
    { icon: "🤝", title: "Cada um ajuda", text: "Quem está online guarda o histórico e ajuda a repassar as lives. Quanto mais amigos, mais forte o servidor fica." },
  ];
  return (
    <div className="onboarding">
      <div className="onb-card">
        <img className="onb-logo" src="./logo.svg" alt="" />
        {step < steps.length ? (
          <>
            <div className="onb-icon">{steps[step].icon}</div>
            <h1>{steps[step].title}</h1>
            <p className="dim">{steps[step].text}</p>
            <div className="onb-dots">
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className={i === step ? "on" : ""} />
              ))}
            </div>
            <button className="btn full" onClick={() => setStep(step + 1)}>
              {step === steps.length - 1 ? "Criar meu perfil" : "Próximo"}
            </button>
            <button className="link-btn" onClick={() => setStep(steps.length)}>
              Pular
            </button>
          </>
        ) : (
          <>
            <h1>Como você quer ser chamado?</h1>
            <div className="onb-preview">
              <Avatar name={name || "?"} color={color} size={72} />
            </div>
            <label className="field">
              <span>Nome</span>
              <input autoFocus value={name} maxLength={32} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="Seu apelido" />
            </label>
            <div className="field">
              <span>Cor</span>
              <div className="colors">
                {COLORS.map((c) => (
                  <button key={c} className={"color" + (c === color ? " sel" : "")} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />
                ))}
              </div>
            </div>
            <button className="btn full" disabled={!name.trim()} onClick={submit}>
              Começar
            </button>
            <p className="dim small">Você pode mudar nome, cor e foto depois em Configurações.</p>
          </>
        )}
      </div>
    </div>
  );
}

export function Home({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="empty home">
      <img src="./logo.svg" alt="" width={96} height={96} />
      <h1>Bem-vindo(a) ao Nexo</h1>
      <ol className="steps">
        <li>
          <strong>Crie um servidor</strong> para você e seus amigos.
        </li>
        <li>
          <strong>Mande o link de convite</strong> — quem clicar entra direto (ou cola o código).
        </li>
        <li>
          <strong>Entre na sala de voz</strong> e clique em <em>Transmitir</em> para fazer live.
        </li>
      </ol>
      <button className="btn" onClick={onAdd}>
        Criar ou entrar em um servidor
      </button>
    </div>
  );
}

export function AddServerModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"create" | "join">("create");
  const [name, setName] = useState(`Servidor de ${app.profile?.name ?? ""}`);
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const preview = decodeInvite(code);

  useEffect(() => {
    navigator.clipboard
      .readText()
      .then((t) => {
        if (decodeInvite(t)) {
          setCode(t.trim());
          setTab("join");
        }
      })
      .catch(() => {});
  }, []);

  return (
    <Modal title="Adicionar servidor" onClose={onClose}>
      <div className="tabs">
        <button className={tab === "create" ? "on" : ""} onClick={() => setTab("create")}>
          Criar
        </button>
        <button className={tab === "join" ? "on" : ""} onClick={() => setTab("join")}>
          Entrar com convite
        </button>
      </div>
      {tab === "create" ? (
        <>
          <p className="dim">Você vira o dono: pode nomear administradores, banir e renovar o convite. O servidor existe enquanto houver alguém dele online.</p>
          <div className="server-preview">
            <div className="rail-btn static">{initials(name)}</div>
          </div>
          <label className="field">
            <span>Nome do servidor</span>
            <input autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && (app.createServer(name), onClose())} />
          </label>
          <button
            className="btn full"
            disabled={!name.trim()}
            onClick={() => {
              app.createServer(name);
              onClose();
            }}
          >
            Criar servidor
          </button>
        </>
      ) : (
        <>
          <label className="field">
            <span>Link ou código de convite</span>
            <textarea autoFocus rows={3} value={code} placeholder="nexo://join/nexo-... ou nexo-..." onChange={(e) => (setCode(e.target.value), setErr(null))} />
          </label>
          {preview && (
            <div className="invite-preview">
              <div className="rail-btn static small">{initials(preview.name)}</div>
              <div>
                <div className="dim small">Você foi convidado para</div>
                <strong>{preview.name}</strong>
              </div>
            </div>
          )}
          {err && <div className="error">{err}</div>}
          <button
            className="btn full"
            disabled={!code.trim()}
            onClick={() => {
              const e = app.joinByInvite(code);
              if (e) setErr(e);
              else onClose();
            }}
          >
            Entrar
          </button>
        </>
      )}
    </Modal>
  );
}

export function InviteModal({ s, onClose }: { s: Session; onClose: () => void }) {
  const link = inviteLink(s.server);
  const code = encodeInvite(s.server);
  const [copied, setCopied] = useState<"link" | "code" | null>(null);
  const copy = async (what: "link" | "code") => {
    await navigator.clipboard.writeText(what === "link" ? link : code);
    setCopied(what);
  };
  return (
    <Modal title={`Convidar amigos para ${s.name}`} onClose={onClose}>
      <p className="dim">Quem tiver o convite entra — trate como uma senha. Se vazar, um administrador pode renová-lo nas configurações do servidor.</p>
      <div className="field">
        <span>Link (abre o Nexo direto)</span>
        <div className="invite-box">
          <code>{link}</code>
          <button className="btn" onClick={() => copy("link")}>
            {copied === "link" ? "Copiado!" : "Copiar"}
          </button>
        </div>
      </div>
      <div className="field">
        <span>Código (para colar em “Entrar com convite”)</span>
        <div className="invite-box">
          <code>{code}</code>
          <button className="btn ghost" onClick={() => copy("code")}>
            {copied === "code" ? "Copiado!" : "Copiar"}
          </button>
        </div>
      </div>
      <p className="dim small">Alguns apps (WhatsApp, Discord) não deixam clicar em links nexo://. Nesse caso, a pessoa copia e cola o código no Nexo.</p>
    </Modal>
  );
}

export function PromptModal(props: { title: string; label: string; initial?: string; placeholder?: string; onClose: () => void; onSubmit: (v: string) => void }) {
  const [v, setV] = useState(props.initial ?? "");
  const submit = () => {
    if (!v.trim()) return;
    props.onSubmit(v);
    props.onClose();
  };
  return (
    <Modal
      title={props.title}
      onClose={props.onClose}
      footer={
        <>
          <button className="btn ghost" onClick={props.onClose}>
            Cancelar
          </button>
          <button className="btn" disabled={!v.trim()} onClick={submit}>
            Salvar
          </button>
        </>
      }
    >
      <label className="field">
        <span>{props.label}</span>
        <input autoFocus value={v} placeholder={props.placeholder} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
      </label>
    </Modal>
  );
}

export function GoLiveModal({ s, onClose }: { s: Session; onClose: () => void }) {
  const a = useApp();
  const [kind, setKind] = useState<"screen" | "camera">("screen");
  const [sources, setSources] = useState<NexoSource[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "screens" | "windows">("all");
  const [audio, setAudio] = useState(true);
  const [title, setTitle] = useState(() => localStorage.getItem("nexo:livetitle") ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!window.nexo) return setSources([]);
    let alive = true;
    const load = () =>
      window.nexo!.getSources().then((list) => {
        if (!alive) return;
        setSources(list);
        setSel((cur) => cur ?? list[0]?.id ?? null);
      });
    load();
    const t = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const shown = (sources ?? []).filter((x) => filter === "all" || (filter === "screens" ? x.isScreen : !x.isScreen));
  const preset = a.settings.preset;

  const go = async () => {
    setBusy(true);
    localStorage.setItem("nexo:livetitle", title);
    try {
      await s.startLive(kind, title, { sourceId: sel ?? undefined, audio });
      a.audio.play("live");
      a.selectServer(s.server.roomId);
      a.openLive(selfId);
      onClose();
    } catch (e) {
      a.showToast(mediaErrorMessage(e, kind === "screen" ? "tela" : "câmera"), "error");
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Transmitir em ${s.name}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn live-btn" disabled={busy || (kind === "screen" && !!sources?.length && !sel)} onClick={go}>
            {busy ? "Iniciando…" : "Ficar ao vivo"}
          </button>
        </>
      }
    >
      <div className="tabs">
        <button className={kind === "screen" ? "on" : ""} onClick={() => setKind("screen")}>
          <Icons.Screen size={16} /> Tela / Janela
        </button>
        <button className={kind === "camera" ? "on" : ""} onClick={() => setKind("camera")}>
          📷 Câmera
        </button>
      </div>
      {kind === "screen" && (
        <>
          <div className="chips">
            {(
              [
                ["all", "Tudo"],
                ["windows", "Aplicativos"],
                ["screens", "Telas inteiras"],
              ] as const
            ).map(([v, l]) => (
              <button key={v} className={"chip" + (filter === v ? " on" : "")} onClick={() => setFilter(v)}>
                {l}
              </button>
            ))}
          </div>
          {sources === null ? (
            <div className="dim">Carregando telas…</div>
          ) : sources.length === 0 ? (
            <div className="dim">O sistema vai perguntar qual tela compartilhar.</div>
          ) : (
            <div className="sources">
              {shown.map((src) => (
                <button key={src.id} className={"source" + (sel === src.id ? " sel" : "")} onClick={() => setSel(src.id)} onDoubleClick={go}>
                  <img src={src.thumbnail} alt="" />
                  <span className="ellipsis">
                    {src.icon && <img className="src-icon" src={src.icon} alt="" />}
                    {src.isScreen ? "🖥 " : ""}
                    {src.name}
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
      <div className="grid2">
        <label className="field">
          <span>Título da live</span>
          <input value={title} placeholder="Jogando alguma coisa" maxLength={80} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field">
          <span>Qualidade</span>
          <select
            value={preset}
            onChange={(e) => {
              const p = e.target.value as StreamPreset;
              a.setSettings({ ...a.settings, preset: p, ...(p === "custom" ? {} : PRESETS[p]) });
            }}
          >
            <option value="low">Internet fraca — 720p 30fps</option>
            <option value="medium">Internet média — 1080p 30fps</option>
            <option value="high">Internet boa — 1080p 60fps</option>
            <option value="custom">Personalizado — {a.settings.quality}</option>
          </select>
        </label>
      </div>
      <label className="check">
        <input type="checkbox" checked={audio} onChange={(e) => setAudio(e.target.checked)} />
        {kind === "screen" ? "Transmitir o áudio do PC" : "Transmitir o áudio do microfone junto"}
      </label>
      {kind === "screen" && audio && <div className="dim small">Dica: use fone de ouvido. Se a voz dos amigos aparecer na live, transmita uma janela específica em vez da tela inteira.</div>}
    </Modal>
  );
}

/** Ctrl+K: pular para qualquer servidor/canal. */
export function QuickSwitcher({ onClose }: { onClose: () => void }) {
  const a = useApp();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const items = useMemo(() => {
    const out: { label: string; sub: string; go: () => void; kind: "server" | "channel" | "live" }[] = [];
    for (const srv of a.servers) {
      const s = a.sessions.get(srv.sid);
      out.push({ label: srv.name, sub: "Servidor", kind: "server", go: () => a.selectServer(srv.roomId) });
      if (!s) continue;
      for (const c of s.state.channels)
        out.push({
          label: c.name,
          sub: srv.name,
          kind: "channel",
          go: () => {
            a.selectServer(srv.roomId);
            a.selectChannel(c.id);
          },
        });
      for (const [id, p] of Object.entries(s.peers))
        if (p.live)
          out.push({
            label: `${p.profile?.name ?? "?"} — ${p.live.title}`,
            sub: `Ao vivo em ${srv.name}`,
            kind: "live",
            go: () => {
              a.selectServer(srv.roomId);
              a.openLive(id);
            },
          });
    }
    const t = q.toLowerCase().replace(/^#/, "");
    return t ? out.filter((i) => i.label.toLowerCase().includes(t) || i.sub.toLowerCase().includes(t)) : out;
  }, [q, a, a.servers]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    listRef.current?.children[sel]?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="switcher" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          placeholder="Para onde você quer ir?"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowDown") (e.preventDefault(), setSel(Math.min(items.length - 1, sel + 1)));
            if (e.key === "ArrowUp") (e.preventDefault(), setSel(Math.max(0, sel - 1)));
            if (e.key === "Enter" && items[sel]) {
              items[sel].go();
              onClose();
            }
          }}
        />
        <div className="switcher-list" ref={listRef}>
          {items.slice(0, 50).map((it, i) => (
            <button
              key={i}
              className={i === sel ? "on" : ""}
              onMouseEnter={() => setSel(i)}
              onClick={() => {
                it.go();
                onClose();
              }}
            >
              <span className="sw-icon">{it.kind === "channel" ? <Icons.Hash size={16} /> : it.kind === "live" ? <span className="live-dot" /> : <Icons.Home size={16} />}</span>
              <span className="ellipsis">{it.label}</span>
              <span className="dim small ellipsis">{it.sub}</span>
            </button>
          ))}
          {items.length === 0 && <div className="dim small pad">Nada encontrado</div>}
        </div>
        <div className="dim small switcher-hint">↑↓ para navegar · Enter para abrir · Esc para fechar</div>
      </div>
    </div>
  );
}
