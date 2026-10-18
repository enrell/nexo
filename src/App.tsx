import { useEffect, useState } from "react";
import "./App.css";
import { useApp } from "./lib/app";
import { ChatView } from "./components/Chat";
import { ContextMenuHost } from "./components/ContextMenu";
import { LightboxHost } from "./components/Lightbox";
import { LiveView } from "./components/Live";
import { Members } from "./components/Members";
import { AddServerModal, GoLiveModal, Home, InviteModal, Onboarding, PromptModal, QuickSwitcher, Splash } from "./components/Modals";
import { ServerSettingsScreen, SettingsScreen } from "./components/Settings";
import { ServerRail, Sidebar, type OpenModal } from "./components/Sidebar";

type ModalKind = Parameters<OpenModal>[0] | null;

export default function App() {
  const a = useApp();
  const [modal, setModal] = useState<ModalKind>(null);
  const close = () => setModal(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setModal((m) => (m === "switcher" ? null : "switcher"));
      }
      if ((e.ctrlKey || e.metaKey) && e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        const i = a.servers.findIndex((s) => s.roomId === a.activeRoom);
        const next = a.servers[(i + (e.key === "ArrowDown" ? 1 : a.servers.length - 1)) % a.servers.length];
        if (next) a.selectServer(next.roomId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [a]);

  if (!a.ready) return <Splash />;
  if (!a.profile) return <Onboarding />;
  const s = a.session;
  const theater = a.theater && a.view.type === "live";

  return (
    <div className={"app" + (theater ? " theater" : "")}>
      {!theater && <ServerRail open={setModal} />}
      {s ? (
        <>
          {!theater && <Sidebar s={s} open={setModal} />}
          <main className="main">{a.view.type === "live" ? <LiveView s={s} origin={a.view.origin} /> : <ChatView s={s} />}</main>
          {a.view.type === "chat" && a.showMembers && <Members s={s} />}
        </>
      ) : (
        <Home onAdd={() => setModal("add")} />
      )}

      {modal === "add" && <AddServerModal onClose={close} />}
      {modal === "invite" && s && <InviteModal s={s} onClose={close} />}
      {modal === "settings" && <SettingsScreen onClose={close} />}
      {modal === "server-settings" && s && <ServerSettingsScreen s={s} onClose={close} />}
      {modal === "golive" && s && <GoLiveModal s={s} onClose={close} />}
      {modal === "switcher" && <QuickSwitcher onClose={close} />}
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
