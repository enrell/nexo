/**
 * Coluna direita: painel contextual. Mostra "Agora" (voz, lives, tripulação) e troca
 * de conteúdo no lugar — perfil, membros, busca, personalizar, notificações — com
 * botão de voltar. Nada de janelas flutuantes por cima do chat.
 */
import {
  ArrowLeft,
  BellRinging,
  Broadcast,
  ChatText,
  Check,
  Crown,
  DoorOpen,
  Hash,
  MagnifyingGlass,
  Palette,
  Planet,
  Play,
  ShieldCheck,
  ShieldStar,
  SidebarSimple,
  SignIn,
  User,
  UserCircle,
  UsersThree,
  Waveform,
  X,
} from "@phosphor-icons/react";
import { useEffect, useState, type ReactNode } from "react";
import { useApp, type CtxView } from "../lib/app";
import { safetyNumber } from "../lib/identity";
import { selfId, type Session } from "../lib/session";
import type { LiveInfo } from "../lib/types";
import { Avatar, Icons, STATUS_LABEL, lastSeenLabel } from "./common";
import { MembersList } from "./Members";
import { CTX_TITLES, searchResults, type OpenModal, type SearchItem } from "./Shell";
import { ThemeEditor } from "./Theme";

const ICONS: Record<CtxView, ReactNode> = {
  home: <Planet size={18} weight="duotone" />,
  members: <UsersThree size={18} weight="duotone" />,
  profile: <UserCircle size={18} weight="duotone" />,
  search: <MagnifyingGlass size={18} weight="bold" />,
  theme: <Palette size={18} weight="duotone" />,
  notifications: <BellRinging size={18} weight="duotone" />,
};

export function ContextPanel({ open }: { open: OpenModal }) {
  const a = useApp();
  const s = a.session;
  const { view, arg } = a.ctx;
  const home = view === "home";
  return (
    <aside className="ctx panel" aria-label="Painel">
      <div className="ctx-head">
        {!home && (
          <button className="ibtn" data-tip="Voltar (Esc)" aria-label="Voltar" onClick={() => a.ctxBack()}>
            <ArrowLeft size={18} weight="bold" />
          </button>
        )}
        <h3>
          {ICONS[view]}
          {view === "profile" && arg === a.identity.pub ? "Meu perfil" : CTX_TITLES[view]}
        </h3>
        {home ? (
          <button className="ibtn" data-tip="Recolher painel" aria-label="Recolher painel" onClick={() => a.toggleCtx()}>
            <SidebarSimple size={18} weight="duotone" />
          </button>
        ) : (
          <button className="ibtn" data-tip="Fechar" aria-label="Fechar" onClick={() => a.ctxHome()}>
            <X size={17} weight="bold" />
          </button>
        )}
      </div>
      <div className="ctx-body" key={view + (arg ?? "")}>
        {view === "home" && (s ? <NowView s={s} open={open} /> : <EverywhereView />)}
        {view === "members" && s && <MembersList s={s} />}
        {view === "profile" && s && arg && <ProfileView s={s} pub={arg} open={open} />}
        {view === "profile" && !s && arg && <MyProfileNoServer open={open} />}
        {view === "search" && <SearchView />}
        {view === "theme" && <ThemeEditor />}
        {view === "notifications" && <NotificationsView />}
      </div>
    </aside>
  );
}

function Sec({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="sec">
      <h5>
        <span>{title}</span>
        {action}
      </h5>
      {children}
    </section>
  );
}

// ------------------------------------------------------------------ Agora

function NowView({ s, open }: { s: Session; open: OpenModal }) {
  const a = useApp();
  if (!s.isMember())
    return (
      <div className="ctx-empty">
        <DoorOpen size={34} weight="duotone" />
        <p>Aguardando um administrador aprovar sua entrada. Depois disso, você vê aqui quem está na voz e ao vivo.</p>
      </div>
    );
  const me = a.effectiveProfile();
  const voice = [
    ...(s.inVoice ? [{ id: selfId, pub: s.me, name: me.name, label: "você", color: me.color, avatar: me.avatar, muted: a.muted }] : []),
    ...Object.entries(s.peers)
      .filter(([, p]) => p.inVoice && s.isMember(p.pub))
      .map(([id, p]) => ({ id, pub: p.pub, name: s.profileOf(p.pub).name, label: s.profileOf(p.pub).name, color: p.profile?.color ?? "#777", avatar: p.profile?.avatar, muted: !!p.muted })),
  ];
  const lives: [string, LiveInfo, string | undefined][] = [
    ...(s.myLive ? [[selfId, s.myLive, s.myThumb] as [string, LiveInfo, string | undefined]] : []),
    ...Object.entries(s.peers)
      .filter(([, p]) => p.live)
      .map(([id, p]) => [id, p.live!, p.thumb] as [string, LiveInfo, string | undefined]),
  ];
  const pending = s.isAdmin() ? s.pendingPeers() : [];
  const crew = [
    { pub: s.me, peerId: selfId },
    ...Object.entries(s.peers)
      .filter(([, p]) => p.profile && s.isMember(p.pub))
      .map(([id, p]) => ({ pub: p.pub, peerId: id })),
  ];
  const memberCount = new Set([s.me, ...Object.keys(s.members).filter((p) => s.isMember(p))]).size;

  return (
    <>
      <Sec
        title="Sala de voz"
        action={
          s.inVoice ? null : (
            <button className="link" onClick={() => a.joinVoice(s)}>
              entrar
            </button>
          )
        }
      >
        {voice.length ? (
          <Orbit people={voice} onPick={(pub) => a.openCtx("profile", pub)} />
        ) : (
          <button className="empty-card" onClick={() => a.joinVoice(s)}>
            <SignIn size={20} weight="duotone" />
            <span>
              Ninguém na voz agora.
              <br />
              <b>Entrar na sala</b>
            </span>
          </button>
        )}
      </Sec>

      <Sec title={lives.length > 1 ? `Ao vivo · ${lives.length}` : "Ao vivo"}>
        {lives.length === 0 ? (
          <button className="empty-card" onClick={() => open("golive")}>
            <Broadcast size={20} weight="duotone" />
            <span>
              Ninguém transmitindo.
              <br />
              <b>Transmitir</b>
            </span>
          </button>
        ) : (
          <>
            <LiveCard s={s} id={lives[0][0]} live={lives[0][1]} thumb={lives[0][2]} />
            {lives.slice(1).map(([id, live]) => (
              <button key={id} className="crow chan live" onClick={() => a.openLive(id)}>
                <span className="live-dot" />
                <span className="nm">
                  <b>{s.peerName(id)}</b>
                  <small>{live.title}</small>
                </span>
                <span className="dim small">
                  <Icons.Eye size={13} /> {live.viewers}
                </span>
              </button>
            ))}
          </>
        )}
      </Sec>

      <Sec
        title="Tripulação"
        action={
          <button className="link" onClick={() => a.openCtx("members")}>
            todos ({memberCount})
          </button>
        }
      >
        {pending.map(([id, p]) => (
          <div key={id} className="crow wait member pending" onClick={() => a.openCtx("profile", p.pub)}>
            <Avatar name={p.profile!.name} color={p.profile!.color} src={p.profile!.avatar} size={32} />
            <span className="nm">
              <b>{s.profileOf(p.pub).name}</b>
              <small>pediu para entrar</small>
            </span>
            <button
              className="btn small warnbtn"
              onClick={(e) => {
                e.stopPropagation();
                s.admit(p.pub, true);
              }}
            >
              Aprovar
            </button>
          </div>
        ))}
        {crew.slice(0, 6).map(({ pub, peerId }) => (
          <CrewRow key={pub} s={s} pub={pub} peerId={peerId} />
        ))}
      </Sec>
    </>
  );
}

function Orbit({ people, onPick }: { people: { id: string; pub: string; name: string; label: string; color: string; avatar?: string; muted: boolean }[]; onPick: (pub: string) => void }) {
  const a = useApp();
  const shown = people.slice(0, 8);
  const extra = people.length - shown.length;
  return (
    <div className="orbit">
      <div className="ring" style={{ width: 186, height: 186 }} />
      <div className="ring" style={{ width: 118, height: 118 }} />
      <div className="core">
        <Waveform size={22} weight="fill" />
        {extra > 0 && <span className="more">+{extra}</span>}
      </div>
      {shown.map((p, i) => {
        // distribui no anel externo, começando no topo
        const ang = -Math.PI / 2 + (i * 2 * Math.PI) / shown.length;
        const x = 50 + Math.cos(ang) * 40;
        const y = 50 + Math.sin(ang) * 40;
        return (
          <button key={p.id} className={"bub" + (a.isSpeaking(p.pub) ? " talk" : "")} style={{ left: `${x}%`, top: `${y}%` }} onClick={() => onPick(p.pub)}>
            <Avatar name={p.name} color={p.color} src={p.avatar} size={42} />
            {p.muted && (
              <span className="mut">
                <Icons.MicOff size={12} />
              </span>
            )}
            <span className="bub-name">{p.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function LiveCard({ s, id, live, thumb }: { s: Session; id: string; live: LiveInfo; thumb?: string }) {
  const a = useApp();
  const mins = Math.max(1, Math.round((Date.now() - live.startedAt) / 60000));
  const prof = id === selfId ? s.profileOf(s.me) : s.peers[id] ? s.profileOf(s.peers[id].pub) : { name: "?", color: "#777", avatar: undefined };
  return (
    <div className="livecard">
      <button className="lthumb chan live" onClick={() => a.openLive(id)} aria-label={`Assistir ${prof.name}`}>
        {thumb ? <img src={thumb} alt="" /> : <span className="lthumb-bg" />}
        <span className="tag">AO VIVO</span>
        <span className="v">
          <Icons.Eye size={12} /> {live.viewers}
        </span>
        <span className="pl">
          <span>
            <Play size={20} weight="fill" />
          </span>
        </span>
      </button>
      <div className="lmeta">
        <Avatar name={prof.name} color={prof.color} src={prof.avatar} size={30} />
        <div className="nm">
          <b>{id === selfId ? "Você" : prof.name}</b>
          <small>
            {live.title} · {mins} min
          </small>
        </div>
      </div>
    </div>
  );
}

function CrewRow({ s, pub, peerId }: { s: Session; pub: string; peerId: string }) {
  const a = useApp();
  const prof = s.profileOf(pub);
  const peer = peerId === selfId ? null : s.peers[peerId];
  const live = peerId === selfId ? !!s.myLive : !!peer?.live;
  const voice = peerId === selfId ? s.inVoice : !!peer?.inVoice;
  const act = live ? "transmitindo" : voice ? "na voz" : STATUS_LABEL[prof.status ?? "online"];
  return (
    <div className="crow member" onClick={() => a.openCtx("profile", pub)}>
      <Avatar name={prof.name} color={prof.color} src={prof.avatar} size={32} status={prof.status ?? "online"} speaking={voice && a.isSpeaking(pub)} />
      <span className="nm">
        <b>{pub === s.me ? `${prof.name} (você)` : prof.name}</b>
        <small>{act}</small>
      </span>
      {s.isOwner(pub) ? <Crown size={15} weight="fill" className="ic gold" /> : s.server.owner && s.state.admins.has(pub) ? <ShieldStar size={15} weight="fill" className="ic acc" /> : null}
    </div>
  );
}

/** "Início" sem servidor aberto: o que está acontecendo em todos os servidores. */
function EverywhereView() {
  const a = useApp();
  const rows: { sid: string; room: string; name: string; text: string }[] = [];
  for (const sess of a.sessions.values()) {
    for (const [id, p] of Object.entries(sess.peers)) if (p.live) rows.push({ sid: sess.server.sid + id, room: sess.server.roomId, name: sess.name, text: `${sess.profileOf(p.pub).name} ao vivo · ${p.live.title}` });
    const v = Object.values(sess.peers).filter((p) => p.inVoice).length;
    if (v) rows.push({ sid: sess.server.sid + "v", room: sess.server.roomId, name: sess.name, text: `${v} na sala de voz` });
  }
  return (
    <>
      <Sec title="Acontecendo agora">
        {rows.length === 0 && <p className="ctx-note">Nada acontecendo nos seus servidores agora.</p>}
        {rows.map((r) => (
          <button key={r.sid} className="crow" onClick={() => a.selectServer(r.room)}>
            <Broadcast size={18} weight="duotone" />
            <span className="nm">
              <b>{r.name}</b>
              <small>{r.text}</small>
            </span>
          </button>
        ))}
      </Sec>
      <NotificationsView />
    </>
  );
}

function MyProfileNoServer({ open }: { open: OpenModal }) {
  const a = useApp();
  const p = a.effectiveProfile();
  return (
    <div className="prof">
      <div className="banner" />
      <div className="prof-top">
        <Avatar name={p.name} color={p.color} src={p.avatar} size={72} status={p.status} ring="var(--panel-solid)" />
      </div>
      <h2>{p.name}</h2>
      <div className="btns">
        <button className="btn" onClick={() => open("settings")}>
          Editar perfil
        </button>
        <button className="btn ghost" onClick={() => a.openCtx("theme")}>
          Personalizar
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ perfil

function ProfileView({ s, pub, open }: { s: Session; pub: string; open: OpenModal }) {
  const a = useApp();
  const me = pub === s.me;
  const prof = s.profileOf(pub);
  const peerId = s.peerIdOf(pub);
  const peer = peerId ? s.peers[peerId] : null;
  const owner = s.isOwner(pub);
  const admin = !owner && !!s.server.owner && s.state.admins.has(pub);
  const banned = s.state.banned.has(pub);
  const pending = !me && !banned && !s.isMember(pub);
  const [safety, setSafety] = useState<string | null>(null);
  const [showSafety, setShowSafety] = useState(false);
  useEffect(() => {
    if (showSafety && !safety) safetyNumber(s.me, pub).then(setSafety);
  }, [showSafety, safety, s, pub]);
  const vol = a.audio.userVolumes[pub] ?? 100;
  const activity = me
    ? s.myLive
      ? "transmitindo agora"
      : s.inVoice
        ? "na sala de voz"
        : STATUS_LABEL[prof.status ?? "online"]
    : peer?.live
      ? `ao vivo · ${peer.live.title}`
      : peer?.inVoice
        ? "na sala de voz"
        : prof.online
          ? STATUS_LABEL[prof.status ?? "online"]
          : `visto ${lastSeenLabel(s.members[pub]?.lastSeen ?? 0)}`;

  return (
    <>
      <div className="prof">
        <div className="banner" style={{ background: prof.color }} />
        <div className="prof-top">
          <Avatar name={prof.name} color={prof.color} src={prof.avatar} size={72} status={prof.online ? (prof.status ?? "online") : "offline"} ring="var(--panel-solid)" />
        </div>
        <h2>{prof.name}</h2>
        <p className="sub">{activity}</p>
      </div>

      <Sec title="Cargo">
        <div className="chips">
          {owner && (
            <span className="chip gold">
              <Crown size={13} weight="fill" /> Dono
            </span>
          )}
          {admin && (
            <span className="chip acc">
              <ShieldStar size={13} weight="fill" /> Admin
            </span>
          )}
          {!owner && !admin && !pending && !banned && (
            <span className="chip">
              <User size={13} weight="duotone" /> Membro
            </span>
          )}
          {pending && (
            <span className="chip warn">
              <DoorOpen size={13} weight="duotone" /> Aguardando aprovação
            </span>
          )}
          {banned && <span className="chip bad">Banido</span>}
        </div>
      </Sec>

      {pending && s.isAdmin() && (
        <div className="btns">
          <button className="btn warnbtn" onClick={() => s.admit(pub, true)}>
            <Check size={16} weight="bold" /> Aprovar
          </button>
          <button className="btn ghost" onClick={() => confirm(`Recusar e banir ${prof.name}?`) && s.admit(pub, false)}>
            <X size={16} weight="bold" /> Recusar
          </button>
        </div>
      )}

      {me && (
        <div className="btns">
          <button className="btn" onClick={() => open("settings")}>
            Editar perfil
          </button>
          <button className="btn ghost" onClick={() => a.openCtx("theme")}>
            Personalizar
          </button>
        </div>
      )}

      {!me && !pending && (
        <Sec title={`Volume para você · ${vol}%`}>
          <input type="range" min={0} max={200} value={vol} onChange={(e) => a.audio.setUserVolume(pub, +e.target.value)} aria-label="Volume do usuário" />
          <label className="check">
            <input type="checkbox" checked={a.audio.localMutes.has(pub)} onChange={() => a.audio.toggleLocalMute(pub)} />
            Mutar para mim
          </label>
        </Sec>
      )}

      <Sec title={me ? "Sua chave pública" : "Identidade"}>
        <div className="keybox mono">{pub.match(/.{1,4}/g)?.join(" ")}</div>
        {!me &&
          (showSafety ? (
            <div className="safety-inline">
              <div className="dim small">Comparem este número por outro meio (pessoalmente, ligação). Se for igual dos dois lados, ninguém está se passando por ninguém.</div>
              <div className="safety-number mono">{safety ?? "calculando…"}</div>
            </div>
          ) : (
            <button className="btn ghost full" onClick={() => setShowSafety(true)}>
              <ShieldCheck size={16} weight="duotone" /> Verificar identidade
            </button>
          ))}
      </Sec>

      {!me && (s.isOwner() || (s.isAdmin() && !owner)) && !pending && (
        <Sec title="Moderação">
          {s.isOwner() && !banned && (
            <button className="btn ghost full" onClick={() => s.setRole(pub, admin ? "member" : "admin")}>
              <ShieldStar size={16} weight="duotone" /> {admin ? "Remover administrador" : "Tornar administrador"}
            </button>
          )}
          {s.isAdmin() && !owner && (
            <button className="btn ghost full danger-text" onClick={() => (banned ? s.ban(pub, false) : confirm(`Banir ${prof.name}? Ninguém do servidor vai aceitar mais conexão dessa pessoa.`) && s.ban(pub, true))}>
              {banned ? "Revogar banimento" : `Banir ${prof.name}`}
            </button>
          )}
        </Sec>
      )}
    </>
  );
}

// ------------------------------------------------------------------ busca

const KIND: Record<SearchItem["kind"], { title: string; icon: ReactNode }> = {
  channel: { title: "Canais", icon: <Hash size={17} weight="bold" /> },
  voice: { title: "Voz", icon: <Planet size={17} weight="duotone" /> },
  live: { title: "Ao vivo", icon: <Broadcast size={17} weight="fill" /> },
  person: { title: "Pessoas", icon: <User size={17} weight="duotone" /> },
  server: { title: "Servidores", icon: <Planet size={17} weight="duotone" /> },
  message: { title: "Mensagens", icon: <ChatText size={17} weight="duotone" /> },
};

function SearchView() {
  const a = useApp();
  const items = searchResults(a);
  if (!items.length)
    return (
      <div className="ctx-empty">
        <MagnifyingGlass size={30} weight="duotone" />
        <p>{a.search ? `Nada encontrado para “${a.search}”.` : "Digite para buscar canais, pessoas, lives e mensagens."}</p>
      </div>
    );
  const groups = new Map<SearchItem["kind"], { item: SearchItem; idx: number }[]>();
  items.forEach((item, idx) => {
    if (!groups.has(item.kind)) groups.set(item.kind, []);
    groups.get(item.kind)!.push({ item, idx });
  });
  return (
    <>
      {[...groups].map(([kind, list]) => (
        <Sec key={kind} title={KIND[kind].title}>
          {list.map(({ item, idx }) => (
            <button
              key={item.key}
              className={"res" + (idx === a.searchSel ? " sel" : "")}
              onMouseEnter={() => {
                a.searchSel = idx;
                a.emit();
              }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => item.go()}
            >
              {KIND[kind].icon}
              {item.kind === "message" ? (
                <span className="res-msg">
                  <b>{item.author}</b>
                  <span className="ellipsis">{item.label}</span>
                </span>
              ) : (
                <span className="ellipsis grow">{item.label}</span>
              )}
              <small>{item.sub}</small>
            </button>
          ))}
        </Sec>
      ))}
      <div className="keys-hint">
        <kbd>↑</kbd>
        <kbd>↓</kbd> navegar · <kbd>Enter</kbd> abrir · <kbd>Esc</kbd> fechar
      </div>
    </>
  );
}

// ------------------------------------------------------------------ notificações

function NotificationsView() {
  const a = useApp();
  const groups = a.servers
    .map((srv) => {
      const sess = a.sessions.get(srv.sid);
      const chans = (sess?.state.channels ?? [])
        .map((c) => ({ c, unread: a.unread[srv.sid + ":" + c.id] ?? 0, mentions: a.mentions[srv.sid + ":" + c.id] ?? 0 }))
        .filter((x) => x.unread || x.mentions);
      return { srv, sess, chans };
    })
    .filter((g) => g.chans.length);
  if (!groups.length)
    return (
      <div className="ctx-empty">
        <BellRinging size={30} weight="duotone" />
        <p>Tudo lido. Menções a você aparecem aqui.</p>
      </div>
    );
  return (
    <>
      {groups.map(({ srv, sess, chans }) => (
        <Sec
          key={srv.sid}
          title={srv.name}
          action={
            <button className="link" onClick={() => sess && (chans.forEach((x) => a.markRead(sess, x.c.id)), a.emit())}>
              marcar como lido
            </button>
          }
        >
          {chans.map(({ c, unread, mentions }) => (
            <button
              key={c.id}
              className="res"
              onClick={() => {
                a.selectServer(srv.roomId);
                a.selectChannel(c.id);
                a.ctxHome();
              }}
            >
              <Hash size={17} weight="bold" />
              <span className="ellipsis grow">{c.name}</span>
              {mentions > 0 ? <span className="badge small">@{mentions}</span> : <small>{unread} novas</small>}
            </button>
          ))}
        </Sec>
      ))}
    </>
  );
}
