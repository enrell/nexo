import { app, useApp } from "../lib/app";
import { selfId, type Session } from "../lib/session";
import { Avatar, Icons, STATUS_LABEL, lastSeenLabel } from "./common";
import { openMenu, type MenuItem } from "./ContextMenu";

function VolumeSlider({ pub }: { pub: string }) {
  const a = useApp();
  const v = a.audio.userVolumes[pub] ?? 100;
  return (
    <div className="menu-volume" onMouseDown={(e) => e.stopPropagation()}>
      <div className="small dim">Volume do usuário: {v}%</div>
      <input type="range" min={0} max={200} value={v} onChange={(e) => a.audio.setUserVolume(pub, +e.target.value)} />
    </div>
  );
}

/** Menu de clique direito / clique num membro. */
export function memberMenu(s: Session, pub: string): MenuItem[] {
  const me = pub === s.me;
  const prof = s.profileOf(pub);
  const items: MenuItem[] = [{ custom: <div className="menu-title">{prof.name}</div> }];
  if (!me) {
    items.push({ custom: <VolumeSlider pub={pub} /> });
    items.push({
      label: app.audio.localMutes.has(pub) ? "Desmutar para mim" : "Mutar para mim",
      onClick: () => app.audio.toggleLocalMute(pub),
      icon: <Icons.MicOff size={16} />,
    });
  }
  items.push({
    label: "Mencionar",
    onClick: () => {
      const ta = document.querySelector<HTMLTextAreaElement>(".composer textarea");
      if (ta) {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
        setter.call(ta, ta.value + `@${prof.name.replace(/\s+/g, "_")} `);
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        ta.focus();
      }
    },
  });
  items.push({ label: "Copiar ID do usuário", onClick: () => navigator.clipboard.writeText(pub), icon: <Icons.Copy size={16} /> });
  if (!me && s.isOwner()) {
    const isAdm = s.state.admins.has(pub);
    items.push({ sep: true });
    items.push({ label: isAdm ? "Remover administrador" : "Tornar administrador", onClick: () => s.setRole(pub, isAdm ? "member" : "admin"), icon: <Icons.Shield size={16} /> });
  }
  if (!me && s.isAdmin() && !s.isOwner(pub)) {
    items.push({ sep: true });
    items.push({
      label: `Banir ${prof.name}`,
      danger: true,
      onClick: () => {
        if (confirm(`Banir ${prof.name}? Ninguém do servidor vai aceitar mais conexão dessa pessoa.`)) s.ban(pub, true);
      },
    });
  }
  return items;
}

export function Members({ s }: { s: Session }) {
  const a = useApp();
  const me = a.effectiveProfile();
  type Row = { pub: string; peerId: string; name: string; color: string; avatar?: string; status: "online" | "idle" | "dnd" | "offline"; live: boolean; voice: boolean; rtt?: number; relayed?: boolean; lastSeen?: number };
  const online: Row[] = [
    { pub: s.me, peerId: selfId, name: me.name, color: me.color, avatar: me.avatar, status: me.status, live: !!s.myLive, voice: s.inVoice },
    ...Object.entries(s.peers)
      .filter(([, p]) => p.profile)
      .map(([id, p]) => ({
        pub: p.pub,
        peerId: id,
        name: p.profile!.name,
        color: p.profile!.color,
        avatar: p.profile!.avatar,
        status: p.profile!.status,
        live: !!p.live,
        voice: !!p.inVoice,
        rtt: p.rtt,
        relayed: p.relayed,
      })),
  ];
  const onlineKeys = new Set(online.map((r) => r.pub));
  const offline: Row[] = Object.values(s.members)
    .filter((m) => !onlineKeys.has(m.pub) && !s.state.banned.has(m.pub))
    .sort((x, y) => y.lastSeen - x.lastSeen)
    .map((m) => ({ pub: m.pub, peerId: "", name: m.name, color: m.color, avatar: m.avatar, status: "offline", live: false, voice: false, lastSeen: m.lastSeen }));

  const role = (pub: string) => (s.isOwner(pub) ? "owner" : s.server.owner && s.state.admins.has(pub) ? "admin" : null);
  const admins = online.filter((r) => role(r.pub));
  const rest = online.filter((r) => !role(r.pub));

  const row = (r: Row) => (
    <div
      key={r.pub}
      className={"member" + (r.status === "offline" ? " offline" : "")}
      onClick={(e) => (r.live ? a.openLive(r.peerId) : openMenu(e, memberMenu(s, r.pub)))}
      onContextMenu={(e) => openMenu(e, memberMenu(s, r.pub))}
    >
      <Avatar name={r.name} color={r.color} src={r.avatar} size={32} status={r.status} speaking={r.voice && a.isSpeaking(r.pub)} />
      <div className="member-info">
        <div className="member-name">
          <span className="ellipsis" style={{ color: r.status === "offline" ? undefined : r.color }}>
            {r.name}
          </span>
          {role(r.pub) === "owner" && (
            <span className="role-icon owner" title="Dono">
              <Icons.Crown size={13} />
            </span>
          )}
          {role(r.pub) === "admin" && (
            <span className="role-icon admin" title="Administrador">
              <Icons.Shield size={13} />
            </span>
          )}
          {r.pub === s.me && <span className="dim small">(você)</span>}
        </div>
        <div className="dim small ellipsis">
          {r.live ? "🔴 Transmitindo" : r.voice ? "🔊 Na voz" : r.status === "offline" ? `Visto ${lastSeenLabel(r.lastSeen ?? 0)}` : STATUS_LABEL[r.status]}
        </div>
      </div>
      {r.rtt !== undefined && (
        <span className={"conn " + (r.rtt < 80 ? "good" : r.rtt < 200 ? "ok" : "bad")} title={`Ping ${r.rtt} ms${r.relayed ? " · via TURN" : " · conexão direta"}`}>
          <Icons.Wifi size={14} />
        </span>
      )}
    </div>
  );

  return (
    <aside className="members">
      {admins.length > 0 && (
        <>
          <div className="section-title">
            <span>Administração — {admins.length}</span>
          </div>
          {admins.map(row)}
        </>
      )}
      <div className="section-title">
        <span>Online — {rest.length}</span>
      </div>
      {rest.map(row)}
      {offline.length > 0 && (
        <>
          <div className="section-title">
            <span>Offline — {offline.length}</span>
          </div>
          {offline.map(row)}
        </>
      )}
    </aside>
  );
}
