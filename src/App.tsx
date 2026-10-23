import { ChatsTeardrop, Plus } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import "@fontsource-variable/inter";
import "./App.css";
import { resetLocalData, useApp } from "./lib/app";
import type { Session } from "./lib/session";
import { ChatView } from "./components/Chat";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ContextMenuHost } from "./components/ContextMenu";
import { ContextPanel } from "./components/ContextPanel";
import { LightboxHost } from "./components/Lightbox";
import { LiveView } from "./components/Live";
import { AddServerModal, GoLiveModal, Home, InviteModal, Onboarding, PromptModal, Splash } from "./components/Modals";
import { ServerSettingsScreen, SettingsScreen } from "./components/Settings";
import { SafetyHost } from "./components/Safety";
import { FindPanel, TipLayer, Worlds, YouPanel, type OpenModal } from "./components/Shell";
import { ServerColumn } from "./components/Sidebar";

type ModalKind = Parameters<OpenModal>[0] | null;

export default function App() {
  const a = useApp();
  const [modal, setModal] = useState<ModalKind>(null);
  const close = () => setModal(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        const i = a.servers.findIndex((s) => s.roomId === a.activeRoom);
        const fwd = e.key === "ArrowDown" || e.key === "ArrowRight";
        const next = a.servers[(i + (fwd ? 1 : a.servers.length - 1) + a.servers.length) % a.servers.length];
        if (next) a.selectServer(next.roomId);
      }
      // Esc volta o painel da direita (quando nada mais está aberto)
      if (e.key === "Escape" && !e.defaultPrevented && (a.ctx.view !== "home" || a.ctxDrawer) && !document.querySelector(".modal-backdrop, .fullscreen-settings, .lightbox, .menu.ctx")) {
        const t = e.target as HTMLElement;
        if (t.tagName !== "INPUT" && t.tagName !== "TEXTAREA") (a.ctx.view === "home" ? a.ctxHome() : a.ctxBack());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [a]);

  if (!a.ready) return <Splash />;
  if (a.fatal) return <Fatal message={a.fatal} />;
  if (!a.profile) return <Onboarding />;
  const s = a.session;
  const theater = a.theater && a.view.type === "live";
  const collapsed = a.settings.ctxCollapsed;

  return (
    <div className={"app" + (theater ? " theater" : "") + (collapsed ? " ctx-collapsed" : "") + (a.ctxDrawer ? " ctx-open" : "")}>
      {!theater && <YouPanel open={setModal} />}
      {!theater && <Worlds open={setModal} />}
      {!theater && <FindPanel />}
      {!theater && (s ? <ServerColumn s={s} open={setModal} /> : <HomeColumn onAdd={() => setModal("add")} />)}
      <main className="main panel">
        <ErrorBoundary what="esta conversa" resetKey={a.activeRoom + ":" + (s ? a.channelOf(s) : "") + ":" + a.view.type}>
          {s ? !s.isMember() ? <Waiting s={s} /> : a.view.type === "live" ? <LiveView s={s} origin={a.view.origin} /> : <ChatView s={s} /> : <Home onAdd={() => setModal("add")} onJoin={() => setModal("join")} />}
        </ErrorBoundary>
      </main>
      {!theater && !collapsed && <ContextPanel open={setModal} />}
      {/* janela estreita: o painel vira gaveta por cima e isto fecha ao clicar fora (no CSS só aparece abaixo de 1060px) */}
      {!theater && !collapsed && a.ctxDrawer && <div className="ctx-scrim" onClick={() => a.ctxHome()} />}

      {(modal === "add" || modal === "join") && <AddServerModal initialTab={modal === "join" ? "join" : "create"} onClose={close} />}
      {modal === "invite" && s && <InviteModal s={s} onClose={close} />}
      {modal === "settings" && <SettingsScreen onClose={close} />}
      {modal === "server-settings" && s && <ServerSettingsScreen s={s} onClose={close} />}
      {modal === "golive" && s && <GoLiveModal s={s} onClose={close} />}
      {modal === "golive-camera" && s && <GoLiveModal s={s} onClose={close} initialKind="camera" />}
      {modal === "channel" && s && (
        <PromptModal
          title="Criar canal de texto"
          label="Nome do canal"
          placeholder="novo-canal"
          onClose={close}
          onSubmit={(v) => {
            const ch = s.addChannel(v);
            if (ch) setTimeout(() => a.selectChannel(ch.id), 50);
          }}
        />
      )}
      <ContextMenuHost />
      <LightboxHost />
      <SafetyHost />
      <TipLayer />
      {a.update?.status === "ready" && (
        <div className="update-bar">
          Nova versão {a.update.version} pronta.
          <button className="btn small" onClick={() => window.nexo?.installUpdate()}>
            Reiniciar e atualizar
          </button>
        </div>
      )}
      {a.toast && (
        <div className={"toast " + a.toast.kind} role="status">
          {a.toast.text}
        </div>
      )}
    </div>
  );
}

/** Coluna esquerda quando nenhum servidor está aberto (planeta Início). */
function HomeColumn({ onAdd }: { onAdd: () => void }) {
  return (
    <aside className="side panel">
      <div className="srv-head">
        <div className="srv-btn static">
          <span className="emb">
            <ChatsTeardrop size={18} weight="duotone" />
          </span>
          <span className="srv-txt">
            <b>Início</b>
            <small>fora dos servidores</small>
          </span>
        </div>
      </div>
      <div className="side-scroll">
        <p className="side-hint">Daqui você chama amigos para os seus servidores e entra com o convite de alguém. Conversas diretas chegam na próxima versão.</p>
        <button className="chan" onClick={onAdd}>
          <Plus size={17} weight="bold" />
          <span>Criar ou entrar em servidor</span>
        </button>
      </div>
    </aside>
  );
}

/** Entrou com o convite, mas um administrador ainda precisa aprovar. */
function Waiting({ s }: { s: Session }) {
  const banned = s.state.banned.has(s.me);
  return (
    <div className="empty">
      <div className="waiting-icon">{banned ? "⛔" : "🚪"}</div>
      <h1>{banned ? "Você foi banido deste servidor" : "Aguardando aprovação"}</h1>
      {!banned && (
        <>
          <p className="dim">
            Este servidor exige que um administrador aprove novos membros. Assim que alguém aprovar, o histórico aparece aqui. Peça para um admin conferir sua identidade (clique direito em você → “Verificar
            identidade”).
          </p>
          <div className="dim small">
            {Object.keys(s.peers).length} pessoa(s) online agora · sua chave: <span className="mono">{s.me.slice(0, 16)}…</span>
          </div>
        </>
      )}
    </div>
  );
}

/** O cofre de chaves não abriu (ex.: perfil copiado de outro usuário do Windows). */
function Fatal({ message }: { message: string }) {
  return (
    <div className="empty fatal">
      <div className="waiting-icon">🔒</div>
      <h1>Não foi possível abrir seus dados</h1>
      <p className="dim">{message}</p>
      <p className="dim small">
        Os dados do Nexo são cifrados com uma chave protegida pela sua conta do Windows. Se você copiou a pasta de outro PC ou de outro usuário, ela não abre aqui — use um backup da conta.
      </p>
      <button
        className="btn danger"
        onClick={() => {
          if (confirm("Apagar os dados locais ilegíveis e começar do zero? Use um backup para recuperar sua conta depois.")) resetLocalData();
        }}
      >
        Apagar dados locais e recomeçar
      </button>
    </div>
  );
}
