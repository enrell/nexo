import { useEffect, useState } from "react";
import { COLORS, app, randomColor, useApp } from "../lib/app";
import { mediaErrorMessage } from "../lib/rtc";
import { selfId, type Session } from "../lib/session";
import { PRESETS, decodeInvite, encodeInvite, inviteLink, storage } from "../lib/storage";
import { serverColor } from "../lib/theme";
import type { ServerInfo, StreamPreset } from "../lib/types";
import { Avatar, Icons, Modal } from "./common";
import { initials } from "./Shell";

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

/** Início (planeta da casinha): chamar amigos para os seus servidores e entrar com o convite de alguém. */
export function Home({ onAdd, onJoin }: { onAdd: () => void; onJoin: () => void }) {
  const a = useApp();
  const [inviting, setInviting] = useState<Session | null>(null);
  const has = a.servers.length > 0;

  const copyLink = async (srv: ServerInfo) => {
    try {
      await navigator.clipboard.writeText(inviteLink(srv));
      a.showToast(`Link de convite de ${srv.name} copiado. É só mandar para seus amigos.`);
    } catch {
      a.showToast("Não consegui copiar o link. Abra o convite e copie por lá.", "error");
    }
  };

  return (
    <div className="home-view">
      <div className="home-hero">
        <img src="./logo.svg" alt="" width={64} height={64} />
        <div>
          <h1>Olá, {a.effectiveProfile().name}</h1>
          <p className="dim">{has ? "Chame seus amigos: copie o link de convite de um servidor e mande para eles." : "Você ainda não está em nenhum servidor."}</p>
        </div>
      </div>

      {has && (
        <>
          <div className="home-grid">
            {a.servers.map((srv) => {
              const sess = a.sessions.get(srv.sid);
              const online = sess ? Object.values(sess.peers).filter((p) => p.profile).length : 0;
              const unread = a.unreadFor(srv.sid);
              const pending = !!sess && !sess.isMember(); // ainda não fui aprovado: não dá para convidar por aqui
              return (
                <div key={srv.sid} className="home-card">
                  <button className="home-card-main" onClick={() => a.selectServer(srv.roomId)} aria-label={`Abrir ${srv.name}`}>
                    <span className="emb big" style={{ background: serverColor(srv.sid) }}>
                      {initials(srv.name)}
                    </span>
                    <span className="home-card-txt">
                      <b className="ellipsis">{srv.name}</b>
                      <small>{pending ? "aguardando aprovação" : `${online} online${unread ? ` · ${unread} novas` : ""}`}</small>
                    </span>
                  </button>
                  {!pending && (
                    <span className="home-actions">
                      <button className="btn small" onClick={() => copyLink(srv)}>
                        <Icons.Link size={15} /> Copiar link
                      </button>
                      {sess && (
                        <button className="btn small ghost" onClick={() => setInviting(sess)} data-tip="Ver link e código de convite">
                          Convite
                        </button>
                      )}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="row wrap">
            <button className="btn ghost" onClick={onJoin}>
              Tenho um convite de um amigo
            </button>
            <button className="btn ghost" onClick={onAdd}>
              Criar outro servidor
            </button>
          </div>
        </>
      )}

      {!has && (
        <>
          <div className="home-steps">
            <div>
              <span className="n">1</span>
              <b>Crie um servidor</b>
              <small>para você e seus amigos.</small>
            </div>
            <div>
              <span className="n">2</span>
              <b>Mande o convite</b>
              <small>quem clicar no link entra direto (e espera sua aprovação).</small>
            </div>
            <div>
              <span className="n">3</span>
              <b>Entre na voz e transmita</b>
              <small>a live vai direto de PC pra PC, cifrada.</small>
            </div>
          </div>
          <div className="row wrap">
            <button className="btn big" onClick={onAdd}>
              Criar um servidor
            </button>
            <button className="btn big ghost" onClick={onJoin}>
              Tenho um convite
            </button>
          </div>
        </>
      )}
      {inviting && <InviteModal s={inviting} onClose={() => setInviting(null)} />}
    </div>
  );
}

export function AddServerModal({ onClose, initialTab = "create" }: { onClose: () => void; initialTab?: "create" | "join" }) {
  const [tab, setTab] = useState<"create" | "join">(initialTab);
  const [name, setName] = useState(`Servidor de ${app.profile?.name ?? ""}`);
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const preview = decodeInvite(code);

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
            <textarea autoFocus rows={3} value={code} placeholder="https://enrell.github.io/nexo/c/#nexo-... ou nexo-..." onChange={(e) => (setCode(e.target.value), setErr(null))} />
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
        <span>Link (funciona no Discord, WhatsApp e em qualquer app: abre o Nexo)</span>
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
      <p className="dim small">O código fica depois do “#” do link: nem o GitHub nem a prévia do Discord recebem essa parte. Quem ainda não tem o Nexo vê o botão para baixar.</p>
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

export function GoLiveModal({ s, onClose, initialKind = "screen" }: { s: Session; onClose: () => void; initialKind?: "screen" | "camera" }) {
  const a = useApp();
  const [kind, setKind] = useState<"screen" | "camera">(initialKind);
  const [sources, setSources] = useState<NexoSource[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "screens" | "windows">("all");
  const [audio, setAudio] = useState(true);
  const [title, setTitle] = useState(() => storage.get<string>("livetitle", ""));
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
    storage.set("livetitle", title);
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
