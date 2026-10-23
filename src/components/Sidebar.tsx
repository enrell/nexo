/**
 * Coluna esquerda: o servidor atual (cabeçalho com menu), canais, voz e a barra
 * da chamada. O "você" fica no topo (Shell.tsx), então aqui só entra o que é do servidor.
 */
import { BellSlash, Broadcast, Eye, LockSimple, Planet, PlusCircle, SignOut, SlidersHorizontal, UserPlus, VideoCamera } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { useApp } from "../lib/app";
import { selfId, type Session } from "../lib/session";
import { serverColor } from "../lib/theme";
import { Avatar, Icons } from "./common";
import { openMenu, type MenuItem } from "./ContextMenu";
import { LivePeek } from "./Live";
import { memberMenu } from "./Members";
import { DItem, Dropdown, initials, useDismiss, type OpenModal } from "./Shell";

export function ServerColumn({ s, open }: { s: Session; open: OpenModal }) {
  const a = useApp();
  const st = s.state;
  const admin = s.isAdmin();
  const member = s.isMember();
  const [menu, setMenu] = useState(false);
  const head = useRef<HTMLDivElement>(null);
  useDismiss(menu, () => setMenu(false), head);
  const online = Object.values(s.peers).filter((p) => p.profile && s.isMember(p.pub)).length + 1;
  const channel = a.channelOf(s);
  const mutedServer = a.settings.mutedServers.includes(s.server.sid);
  const go = (fn: () => void) => () => {
    setMenu(false);
    fn();
  };

  const me = a.effectiveProfile();
  const [peek, setPeek] = useState<string | null>(null);
  const voice = [
    ...(s.inVoice ? [{ id: selfId, pub: s.me, name: me.name, color: me.color, avatar: me.avatar, muted: a.muted, deaf: a.deafened, live: !!s.myLive }] : []),
    ...Object.entries(s.peers)
      .filter(([, p]) => p.inVoice && s.isMember(p.pub))
      .map(([id, p]) => ({ id, pub: p.pub, name: s.profileOf(p.pub).name, color: p.profile?.color ?? "#777", avatar: p.profile?.avatar, muted: !!p.muted, deaf: !!p.deaf, live: !!p.live })),
  ];

  return (
    <aside className="side panel">
      <div className={"srv-head" + (menu ? " open" : "")} ref={head}>
        <button className="srv-btn side-head" onClick={() => setMenu(!menu)} aria-haspopup="menu" aria-expanded={menu}>
          <span className="emb" style={{ background: serverColor(s.server.sid) }}>
            {initials(st.name)}
          </span>
          <span className="srv-txt">
            <b>{st.name}</b>
            <small>
              <LockSimple size={11} weight="fill" /> {online} online · cifrado
            </small>
          </span>
          <Icons.Chevron size={15} />
        </button>
        <Dropdown open={menu} className="srv-menu">
          <DItem tone="accent" icon={<UserPlus size={18} weight="duotone" />} onClick={go(() => open("invite"))}>
            Convidar amigos
          </DItem>
          {admin && (
            <DItem icon={<SlidersHorizontal size={18} weight="duotone" />} onClick={go(() => open("server-settings"))}>
              Configurações do servidor
            </DItem>
          )}
          {admin && (
            <DItem icon={<PlusCircle size={18} weight="duotone" />} onClick={go(() => open("channel"))}>
              Criar canal
            </DItem>
          )}
          <DItem
            icon={<BellSlash size={18} weight="duotone" />}
            onClick={go(() => a.setSettings({ ...a.settings, mutedServers: mutedServer ? a.settings.mutedServers.filter((x) => x !== s.server.sid) : [...a.settings.mutedServers, s.server.sid] }))}
          >
            {mutedServer ? "Reativar notificações" : "Silenciar servidor"}
          </DItem>
          <div className="dsep" />
          <DItem
            tone="danger"
            icon={<SignOut size={18} weight="duotone" />}
            onClick={go(() => {
              if (confirm(`Sair de "${st.name}"? O histórico salvo neste PC será apagado.`)) a.leaveServer(s.server.sid);
            })}
          >
            Sair do servidor
          </DItem>
        </Dropdown>
      </div>

      <div className="side-scroll">
        {member ? (
          <>
            <h4>
              Canais
              {admin && (
                <button onClick={() => open("channel")} data-tip="Criar canal" aria-label="Criar canal">
                  <Icons.Plus size={14} />
                </button>
              )}
            </h4>
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
                  onClick={() => a.selectChannel(c.id)}
                  onContextMenu={(e) => openMenu(e, items)}
                >
                  <Icons.Hash size={17} />
                  <span className="ellipsis">{c.name}</span>
                  {mentions > 0 ? <span className="badge small">{mentions}</span> : unread > 0 && !muted ? <span className="udot" /> : null}
                </button>
              );
            })}

            <h4>Voz</h4>
            <button className={"chan voice-chan" + (s.inVoice ? " active" : "")} onClick={() => !s.inVoice && a.joinVoice(s)}>
              <Planet size={18} weight="duotone" />
              <span className="ellipsis">Sala de voz</span>
              {voice.length > 0 && <span className="count">{voice.length}</span>}
            </button>
            <div className="voice-list">
              {voice.map((v) => {
                const talking = a.isSpeaking(v.pub);
                return (
                  <div key={v.id} className="voice-user" onClick={(e) => openMenu(e, memberMenu(s, v.pub))} onContextMenu={(e) => openMenu(e, memberMenu(s, v.pub))}>
                    <Avatar name={v.name} color={v.color} src={v.avatar} size={22} speaking={talking} />
                    <span className={"ellipsis voice-name" + (talking ? " speaking-name" : "")}>{v.name}</span>
                    <span className="voice-icons">
                      {a.audio.localMutes.has(v.pub) && v.pub !== s.me && (
                        <span title="Mutado para você">
                          <Icons.MicOff size={14} />
                        </span>
                      )}
                      {v.muted && (
                        <span title="Mutado" className="bad">
                          <Icons.MicOff size={14} />
                        </span>
                      )}
                      {v.deaf && (
                        <span title="Ensurdecido" className="bad">
                          <Icons.HeadsetOff size={14} />
                        </span>
                      )}
                    </span>
                    {v.live && (
                      <button
                        className="tag-live"
                        data-tip="Ver prévia da live"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPeek(v.id);
                        }}
                      >
                        AO VIVO
                      </button>
                    )}
                  </div>
                );
              })}
              {peek && <LivePeek s={s} origin={peek} onClose={() => setPeek(null)} />}
            </div>
          </>
        ) : (
          <div className="side-hint">Você verá os canais assim que um administrador aprovar sua entrada.</div>
        )}
      </div>

      <CallDock open={open} />
    </aside>
  );
}

/** Barra da chamada: aparece quando você está na voz ou ao vivo. */
function CallDock({ open }: { open: OpenModal }) {
  const a = useApp();
  const vs = a.voiceSession;
  const liveSession = [...a.sessions.values()].find((x) => x.myLive) ?? null;
  if (!vs && !liveSession) return null;
  const peers = vs ? Object.values(vs.peers).filter((p) => p.inVoice) : [];
  const rtt = peers.length ? Math.round(peers.reduce((t, p) => t + (p.rtt ?? 0), 0) / peers.length) : null;
  return (
    <div className="dock voice-panel">
      <div className="dock-st">
        <Icons.Wifi size={14} />
        <b className={rtt !== null && rtt > 200 ? "warn" : ""}>{vs ? "Sala de voz" : "Ao vivo"}</b>
        <small className="ellipsis">
          {vs ? vs.name : liveSession!.name}
          {rtt !== null && ` · ${rtt} ms`}
          {vs && vs.relayingCount > 0 && ` · ajudando ${vs.relayingCount}`}
        </small>
      </div>
      <div className="dock-bt">
        {liveSession ? (
          <>
            <button data-tip="Ver minha live" onClick={() => (a.selectServer(liveSession.server.roomId), a.openLive(selfId))}>
              <Eye size={17} weight="duotone" />
            </button>
            <button className="stop" data-tip="Parar transmissão" onClick={() => liveSession.stopLive()}>
              <Broadcast size={17} weight="fill" /> Parar
            </button>
          </>
        ) : (
          <>
            <button data-tip="Transmitir tela" aria-label="Transmitir" onClick={() => open("golive")}>
              <Icons.Screen size={17} />
            </button>
            <button data-tip="Transmitir câmera" aria-label="Câmera" onClick={() => open("golive-camera")}>
              <VideoCamera size={17} weight="duotone" />
            </button>
          </>
        )}
        {vs && (
          <button className="hang" data-tip="Sair da voz" aria-label="Sair da voz" onClick={() => a.leaveVoice()}>
            <Icons.Hangup size={17} />
          </button>
        )}
      </div>
    </div>
  );
}
