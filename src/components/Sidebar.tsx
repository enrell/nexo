import { useState, type ReactNode } from "react";
import { useApp } from "../lib/app";
import { selfId, type Session } from "../lib/session";
import type { LiveInfo } from "../lib/types";
import { Avatar, Icons, STATUS_LABEL } from "./common";
import { openMenu, type MenuItem } from "./ContextMenu";
import { memberMenu } from "./Members";

export type OpenModal = (m: "add" | "invite" | "settings" | "server-settings" | "golive" | "channel" | "switcher") => void;

// ------------------------------------------------------------------ coluna de servidores

export function ServerRail({ open }: { open: OpenModal }) {
  const a = useApp();
  return (
    <nav className="rail" aria-label="Servidores">
      <div className="rail-logo" title="Nexo — sem servidor central">
        <img src="./logo.svg" alt="Nexo" />
      </div>
      <div className="rail-sep" />
      {a.servers.map((srv, i) => {
        const active = srv.roomId === a.activeRoom;
        const unread = a.unreadFor(srv.sid);
        const mentions = a.mentionsFor(srv.sid);
        const sess = a.sessions.get(srv.sid);
        const someoneLive = !!sess && (Object.values(sess.peers).some((p) => p.live) || !!sess.myLive);
        const voice = !!sess?.inVoice;
        const muted = a.settings.mutedServers.includes(srv.sid);
        const menu: MenuItem[] = [
          { label: "Marcar como lido", onClick: () => sess && sess.state.channels.forEach((c) => a.markRead(sess, c.id)) },
          { label: muted ? "Reativar notificações" : "Silenciar servidor", onClick: () => a.setSettings({ ...a.settings, mutedServers: muted ? a.settings.mutedServers.filter((x) => x !== srv.sid) : [...a.settings.mutedServers, srv.sid] }) },
          { sep: true },
          { label: "Mover para cima", onClick: () => a.moveServerOrder(srv.sid, -1), disabled: i === 0 },
          { label: "Mover para baixo", onClick: () => a.moveServerOrder(srv.sid, 1), disabled: i === a.servers.length - 1 },
          { sep: true },
          { label: "Convidar amigos", onClick: () => (a.selectServer(srv.roomId), open("invite")) },
          { label: "Sair do servidor", danger: true, onClick: () => confirm(`Sair de "${srv.name}"? O histórico salvo neste PC será apagado.`) && a.leaveServer(srv.sid) },
        ];
        return (
          <div key={srv.sid} className={"rail-item" + (active ? " active" : "") + (unread && !muted ? " has-unread" : "")}>
            <span className="rail-pill" />
            <button className="rail-btn" onClick={() => a.selectServer(srv.roomId)} onContextMenu={(e) => openMenu(e, menu)} data-tip={srv.name}>
              {initials(srv.name)}
            </button>
            {mentions > 0 && <span className="badge">{mentions > 99 ? "99+" : mentions}</span>}
            {someoneLive && <span className="rail-live" title="Alguém está ao vivo" />}
            {voice && !someoneLive && <span className="rail-voice" title="Você está na voz deste servidor" />}
          </div>
        );
      })}
      <button className="rail-btn add" onClick={() => open("add")} data-tip="Adicionar servidor" aria-label="Adicionar servidor">
        <Icons.Plus />
      </button>
    </nav>
  );
}

export const initials = (n: string) =>
  n
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((w) => [...w][0])
    .join("")
    .toUpperCase() || "?";

// ------------------------------------------------------------------ sidebar

export function Sidebar({ s, open }: { s: Session; open: OpenModal }) {
  const a = useApp();
  const [menu, setMenu] = useState(false);
  const [hover, setHover] = useState<{ id: string; y: number } | null>(null);
  const channel = a.channelOf(s);
  const st = s.state;
  const peers = Object.entries(s.peers);
  const lives: [string, LiveInfo, string | undefined][] = [
    ...(s.myLive ? [[selfId, s.myLive, s.myThumb] as [string, LiveInfo, string | undefined]] : []),
    ...peers.filter(([, p]) => p.live).map(([id, p]) => [id, p.live!, p.thumb] as [string, LiveInfo, string | undefined]),
  ];
  const me = a.effectiveProfile();
  const voice = [
    ...(s.inVoice ? [{ id: selfId, pub: s.me, name: me.name, color: me.color, avatar: me.avatar, muted: a.muted, deaf: a.deafened }] : []),
    ...peers
      .filter(([, p]) => p.inVoice)
      .map(([id, p]) => ({ id, pub: p.pub, name: p.profile?.name ?? "…", color: p.profile?.color ?? "#777", avatar: p.profile?.avatar, muted: !!p.muted, deaf: !!p.deaf })),
  ];
  const admin = s.isAdmin();
  const hovered = hover ? lives.find(([id]) => id === hover.id) : null;

  return (
    <aside className="sidebar">
      <header className={"side-head" + (menu ? " open" : "")} onClick={() => setMenu(!menu)}>
        <span className="ellipsis">{st.name}</span>
        {menu ? <Icons.X size={18} /> : <Icons.Chevron size={18} />}
        {menu && (
          <div className="menu" onClick={(e) => e.stopPropagation()} onMouseLeave={() => setMenu(false)}>
            <MenuButton accent onClick={() => (setMenu(false), open("invite"))}>
              Convidar amigos
            </MenuButton>
            {admin && <MenuButton onClick={() => (setMenu(false), open("server-settings"))}>Configurações do servidor</MenuButton>}
            {admin && <MenuButton onClick={() => (setMenu(false), open("channel"))}>Criar canal</MenuButton>}
            <MenuButton
              onClick={() => {
                setMenu(false);
                const muted = a.settings.mutedServers.includes(s.server.sid);
                a.setSettings({ ...a.settings, mutedServers: muted ? a.settings.mutedServers.filter((x) => x !== s.server.sid) : [...a.settings.mutedServers, s.server.sid] });
              }}
            >
              {a.settings.mutedServers.includes(s.server.sid) ? "Reativar notificações" : "Silenciar servidor"}
            </MenuButton>
            <div className="menu-sep" />
            <MenuButton
              danger
              onClick={() => {
                setMenu(false);
                if (confirm(`Sair de "${st.name}"? O histórico salvo neste PC será apagado.`)) a.leaveServer(s.server.sid);
              }}
            >
              Sair do servidor
            </MenuButton>
          </div>
        )}
      </header>

      <div className="side-scroll">
        <SectionTitle onAdd={admin ? () => open("channel") : undefined} addLabel="Criar canal">
          Canais de texto
        </SectionTitle>
        {st.channels.map((c) => {
          const key = s.server.sid + ":" + c.id;
          const unread = a.unread[key] ?? 0;
          const mentions = a.mentions[key] ?? 0;
          const active = a.view.type === "chat" && c.id === channel;
          const muted = a.settings.mutedChannels.includes(key);
          const items: MenuItem[] = [
            { label: "Marcar como lido", onClick: () => (a.markRead(s, c.id), a.emit()) },
            { label: muted ? "Reativar notificações" : "Silenciar canal", onClick: () => a.setSettings({ ...a.settings, mutedChannels: muted ? a.settings.mutedChannels.filter((k) => k !== key) : [...a.settings.mutedChannels, key] }) },
            ...(admin
              ? [
                  { sep: true } as MenuItem,
                  {
                    label: "Renomear canal",
                    onClick: () => {
                      const n = prompt("Novo nome do canal", c.name);
                      if (n) s.renameChannel(c.id, n);
                    },
                  },
                  ...(st.channels.length > 1 ? [{ label: "Apagar canal", danger: true, onClick: () => confirm(`Apagar #${c.name} para todos?`) && s.deleteChannel(c.id) }] : []),
                ]
              : []),
          ];
          return (
            <button
              key={c.id}
              className={"chan" + (active ? " active" : "") + (unread && !muted ? " unread" : "") + (muted ? " muted" : "")}
              onClick={() => (a.view.type === "live" ? (a.selectChannel(c.id), a.emit()) : a.selectChannel(c.id))}
              onContextMenu={(e) => openMenu(e, items)}
            >
              <Icons.Hash size={18} />
              <span className="ellipsis">{c.name}</span>
              {mentions > 0 && <span className="badge small">{mentions}</span>}
            </button>
          );
        })}

        <SectionTitle>Ao vivo</SectionTitle>
        {lives.length === 0 && <div className="side-hint">Ninguém transmitindo. Clique em “Transmitir” lá embaixo para começar.</div>}
        {lives.map(([id, live]) => {
          const active = a.view.type === "live" && a.view.origin === id;
          return (
            <button
              key={id}
              className={"chan live" + (active ? " active" : "")}
              onClick={() => a.openLive(id)}
              onMouseEnter={(e) => setHover({ id, y: (e.currentTarget as HTMLElement).getBoundingClientRect().top })}
              onMouseLeave={() => setHover(null)}
            >
              <span className="live-dot" />
              <span className="live-text">
                <span className="ellipsis strong">{s.peerName(id)}</span>
                <span className="ellipsis dim">{live.title}</span>
              </span>
              <span className="viewers">
                <Icons.Eye size={14} /> {live.viewers}
              </span>
            </button>
          );
        })}

        <SectionTitle>Canais de voz</SectionTitle>
        <button className={"chan" + (s.inVoice ? " active" : "")} onClick={() => !s.inVoice && a.joinVoice(s)}>
          <Icons.Speaker size={18} />
          <span className="ellipsis">Sala de voz</span>
          {voice.length > 0 && <span className="dim small">{voice.length}</span>}
        </button>
        <div className="voice-list">
          {voice.map((v) => (
            <div key={v.id} className="voice-user" onContextMenu={(e) => openMenu(e, memberMenu(s, v.pub))} onClick={(e) => openMenu(e, memberMenu(s, v.pub))}>
              <Avatar name={v.name} color={v.color} src={v.avatar} size={24} speaking={a.isSpeaking(v.pub)} />
              <span className={"ellipsis" + (a.isSpeaking(v.pub) ? " speaking-name" : "")}>{v.name}</span>
              <span className="voice-icons">
                {lives.some(([id]) => id === v.id) && <span className="tag-live">AO VIVO</span>}
                {a.audio.localMutes.has(v.pub) && v.pub !== s.me && (
                  <span title="Mutado para você">
                    <Icons.MicOff size={14} />
                  </span>
                )}
                {v.muted && (
                  <span title="Mutado">
                    <Icons.MicOff size={14} />
                  </span>
                )}
                {v.deaf && (
                  <span title="Ensurdecido">
                    <Icons.HeadsetOff size={14} />
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>

      {hovered && hover && (
        <div className="live-preview" style={{ top: Math.min(hover.y - 20, window.innerHeight - 260) }}>
          {hovered[2] ? <img src={hovered[2]} alt="" /> : <div className="live-preview-empty dim">Sem prévia ainda</div>}
          <div className="live-preview-info">
            <strong>{s.peerName(hovered[0])}</strong>
            <span className="dim small">{hovered[1].title}</span>
            <span className="dim small">
              {hovered[1].viewers} assistindo · {Math.max(1, Math.round((Date.now() - hovered[1].startedAt) / 60000))} min
            </span>
          </div>
        </div>
      )}

      <VoicePanel open={open} />
      <UserPanel open={open} />
    </aside>
  );
}

function MenuButton({ children, onClick, danger, accent }: { children: ReactNode; onClick: () => void; danger?: boolean; accent?: boolean }) {
  return (
    <button className={"menu-item" + (danger ? " danger" : "") + (accent ? " accent" : "")} onClick={onClick}>
      {children}
    </button>
  );
}

function SectionTitle({ children, onAdd, addLabel }: { children: ReactNode; onAdd?: () => void; addLabel?: string }) {
  return (
    <div className="section-title">
      <span>{children}</span>
      {onAdd && (
        <button className="icon-btn tiny" onClick={onAdd} title={addLabel} aria-label={addLabel}>
          <Icons.Plus size={16} />
        </button>
      )}
    </div>
  );
}

function VoicePanel({ open }: { open: OpenModal }) {
  const a = useApp();
  const vs = a.voiceSession;
  const s = a.session;
  const liveSession = s?.myLive ? s : [...a.sessions.values()].find((x) => x.myLive);
  if (!vs && !liveSession) return null;
  const peersInVoice = vs ? Object.values(vs.peers).filter((p) => p.inVoice) : [];
  const avgRtt = peersInVoice.length ? Math.round(peersInVoice.reduce((t, p) => t + (p.rtt ?? 0), 0) / peersInVoice.length) : null;
  return (
    <div className="voice-panel">
      {vs && (
        <div className="voice-status">
          <div className="voice-status-text">
            <div className={"ok" + (avgRtt !== null && avgRtt > 200 ? " warn" : "")}>
              <Icons.Wifi size={14} /> Voz conectada
            </div>
            <div className="dim small ellipsis" title={avgRtt !== null ? `Ping médio ${avgRtt} ms` : undefined}>
              Sala de voz / {vs.name}
              {vs.relayingCount > 0 && ` · ajudando ${vs.relayingCount}`}
            </div>
          </div>
          <button className="icon-btn" title="Desconectar da voz" onClick={() => a.leaveVoice()}>
            <Icons.Hangup />
          </button>
        </div>
      )}
      <div className="voice-actions">
        {liveSession?.myLive ? (
          <>
            <button className="btn small grow" onClick={() => (a.selectServer(liveSession.server.roomId), a.openLive(selfId))}>
              <Icons.Eye size={16} /> Ver live
            </button>
            <button className="btn danger small grow" onClick={() => liveSession.stopLive()}>
              Parar
            </button>
          </>
        ) : (
          <button className="btn small grow" onClick={() => open("golive")}>
            <Icons.Screen size={16} /> Transmitir
          </button>
        )}
      </div>
    </div>
  );
}

function UserPanel({ open }: { open: OpenModal }) {
  const a = useApp();
  const p = a.effectiveProfile();
  const s = a.session;
  const statusMenu = (e: React.MouseEvent) =>
    openMenu(e, [
      ...(["online", "idle", "dnd"] as const).map((st) => ({
        label: STATUS_LABEL[st],
        onClick: () => a.setStatus(st),
        icon: <span className={"status-dot inline " + st} />,
        hint: st === "dnd" ? "sem notificações" : undefined,
      })),
      { sep: true },
      { label: "Editar perfil", onClick: () => open("settings") },
      { label: "Copiar meu ID", onClick: () => navigator.clipboard.writeText(a.identity.pub) },
    ]);
  return (
    <div className="user-panel">
      <button className="user-chip" onClick={statusMenu} title="Mudar status">
        <Avatar name={p.name} color={p.color} src={p.avatar} size={32} status={p.status} ring="var(--bg-panel)" speaking={a.voiceSession ? a.audio.localSpeaking : false} live={!!s?.myLive} />
        <div className="user-info">
          <div className="ellipsis strong">{p.name}</div>
          <div className="dim small ellipsis">{a.settings.vadMode === "ptt" && a.voiceSession ? `Push-to-talk: ${keyLabel(a.settings.pttKey)}` : STATUS_LABEL[p.status]}</div>
        </div>
      </button>
      <button className={"icon-btn" + (a.muted ? " off" : "")} title={a.muted ? "Ativar microfone" : "Silenciar"} onClick={() => a.toggleMute()}>
        {a.muted ? <Icons.MicOff /> : <Icons.Mic />}
      </button>
      <button className={"icon-btn" + (a.deafened ? " off" : "")} title={a.deafened ? "Ativar áudio" : "Desativar áudio"} onClick={() => a.toggleDeafen()}>
        {a.deafened ? <Icons.HeadsetOff /> : <Icons.Headset />}
      </button>
      <button className="icon-btn" title="Configurações" onClick={() => open("settings")}>
        <Icons.Gear />
      </button>
    </div>
  );
}

export function keyLabel(code: string) {
  if (!code) return "—";
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Mouse")) return "Botão " + code.slice(5) + " do mouse";
  return code.replace("Left", " Esq.").replace("Right", " Dir.").replace("Control", "Ctrl");
}
