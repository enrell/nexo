/**
 * Topo da grade (alinhado às colunas de baixo):
 *   você (perfil, microfone, fone, menu) | servidores ("mundos") | busca + notificações
 * Mais: menus ancorados, dicas flutuantes e a busca global.
 */
import { ChatsTeardrop, Check, Copy, DotsThree, GearSix, Palette, UserCircle } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useApp, type CtxView } from "../lib/app";
import { selfId } from "../lib/session";
import { serverColor } from "../lib/theme";
import type { Status } from "../lib/types";
import { Avatar, Icons, STATUS_LABEL, keyLabel } from "./common";
import { openMenu, type MenuItem } from "./ContextMenu";

export type OpenModal = (m: "add" | "join" | "invite" | "settings" | "server-settings" | "golive" | "golive-camera" | "channel") => void;

// ------------------------------------------------------------------ menu ancorado

/** Fecha ao clicar fora ou com Esc. O menu é posicionado pelo CSS dentro do elemento-âncora (position: relative). */
export function useDismiss(open: boolean, close: () => void, ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, close, ref]);
}

export function Dropdown({ open, className, children }: { open: boolean; className?: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className={"dropdown " + (className ?? "")} role="menu" onMouseDown={(e) => e.stopPropagation()}>
      {children}
    </div>
  );
}

export function DItem({ icon, children, onClick, tone, hint, right }: { icon?: ReactNode; children: ReactNode; onClick: () => void; tone?: "accent" | "danger"; hint?: string; right?: ReactNode }) {
  return (
    <button className={"ditem" + (tone ? " " + tone : "")} role="menuitem" onClick={onClick}>
      {icon}
      <span className="grow">{children}</span>
      {hint && <span className="dhint">{hint}</span>}
      {right}
    </button>
  );
}

// ------------------------------------------------------------------ dicas flutuantes

/** Uma dica só, posicionada por JS (não é cortada por áreas com rolagem). Use data-tip="…" em qualquer elemento. */
export function TipLayer() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current!;
    const over = (e: MouseEvent) => {
      const t = (e.target as HTMLElement).closest?.("[data-tip]") as HTMLElement | null;
      if (!t || !t.dataset.tip) return el.classList.remove("show");
      const r = t.getBoundingClientRect();
      el.textContent = t.dataset.tip;
      const below = r.top < 110;
      el.style.left = `${Math.min(innerWidth - 90, Math.max(90, r.left + r.width / 2))}px`;
      el.style.top = `${below ? r.bottom + 8 : r.top - 34}px`;
      el.classList.add("show");
    };
    const hide = () => el.classList.remove("show");
    document.addEventListener("mouseover", over);
    document.addEventListener("mousedown", hide);
    window.addEventListener("blur", hide);
    return () => {
      document.removeEventListener("mouseover", over);
      document.removeEventListener("mousedown", hide);
      window.removeEventListener("blur", hide);
    };
  }, []);
  return <div ref={ref} className="tip-layer" role="tooltip" />;
}

// ------------------------------------------------------------------ você

export function YouPanel({ open }: { open: OpenModal }) {
  const a = useApp();
  const p = a.effectiveProfile();
  const [menu, setMenu] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useDismiss(menu, () => setMenu(false), wrap);
  const inVoice = !!a.voiceSession;
  const live = [...a.sessions.values()].some((s) => s.myLive);
  const go = (fn: () => void) => () => {
    setMenu(false);
    fn();
  };
  const statusText = inVoice && a.settings.vadMode === "ptt" ? `Aperte ${keyLabel(a.settings.pttKey)} para falar` : STATUS_LABEL[p.status];
  return (
    <div className="you panel" ref={wrap}>
      <button className="you-id" onClick={() => a.openCtx("profile", a.identity.pub)} data-tip="Seu perfil">
        <Avatar name={p.name} color={p.color} src={p.avatar} size={36} status={p.status} speaking={inVoice && a.audio.localSpeaking} live={live} />
        <span className="you-txt">
          <b>{p.name}</b>
          <small>{statusText}</small>
        </span>
      </button>
      <button className={"ibtn" + (a.muted ? " off" : "")} data-tip={a.muted ? "Ativar microfone" : "Silenciar microfone"} aria-label="Microfone" onClick={() => a.toggleMute()}>
        {a.muted ? <Icons.MicOff /> : <Icons.Mic />}
      </button>
      <button className={"ibtn" + (a.deafened ? " off" : "")} data-tip={a.deafened ? "Ativar áudio" : "Desativar áudio"} aria-label="Áudio" onClick={() => a.toggleDeafen()}>
        {a.deafened ? <Icons.HeadsetOff /> : <Icons.Headset />}
      </button>
      <button className={"ibtn" + (menu ? " on" : "")} data-tip="Menu" aria-label="Menu" onClick={() => setMenu(!menu)}>
        <DotsThree size={20} weight="bold" />
      </button>
      <Dropdown open={menu} className="you-menu">
        {(["online", "idle", "dnd"] as Status[]).map((st) => (
          <DItem key={st} icon={<span className={"sdot " + st} />} onClick={go(() => a.setStatus(st))} right={a.profile?.status === st ? <Check size={15} weight="bold" className="dcheck" /> : undefined}>
            {STATUS_LABEL[st]}
          </DItem>
        ))}
        <div className="dsep" />
        <DItem icon={<Palette size={18} weight="duotone" />} onClick={go(() => a.openCtx("theme"))}>
          Personalizar aparência
        </DItem>
        <DItem icon={<UserCircle size={18} weight="duotone" />} onClick={go(() => a.openCtx("profile", a.identity.pub))}>
          Meu perfil
        </DItem>
        <DItem icon={<GearSix size={18} weight="duotone" />} onClick={go(() => open("settings"))}>
          Configurações
        </DItem>
        <div className="dsep" />
        <DItem
          icon={<Copy size={18} weight="duotone" />}
          onClick={go(() => {
            navigator.clipboard.writeText(a.identity.pub);
            a.showToast("ID copiado");
          })}
        >
          Copiar meu ID
        </DItem>
      </Dropdown>
    </div>
  );
}

// ------------------------------------------------------------------ servidores

export const initials = (n: string) =>
  n
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((w) => [...w][0])
    .join("")
    .toUpperCase() || "?";

export function Worlds({ open }: { open: OpenModal }) {
  const a = useApp();
  return (
    <nav className="worlds panel" aria-label="Servidores">
      <button className={"planet home" + (a.activeRoom === null ? " on" : "")} data-tip="Início" aria-label="Início" onClick={() => a.goHome()}>
        <ChatsTeardrop size={20} weight="duotone" />
      </button>
      <span className="vsep" />
      {a.servers.map((srv, i) => {
        const sess = a.sessions.get(srv.sid);
        const active = srv.roomId === a.activeRoom;
        const muted = a.settings.mutedServers.includes(srv.sid);
        const unread = a.unreadFor(srv.sid);
        const mentions = a.mentionsFor(srv.sid);
        const live = !!sess && (!!sess.myLive || Object.values(sess.peers).some((p) => p.live));
        const voice = !!sess?.inVoice;
        const menu: MenuItem[] = [
          { label: "Marcar como lido", onClick: () => sess && sess.state.channels.forEach((c) => a.markRead(sess, c.id)) },
          {
            label: muted ? "Reativar notificações" : "Silenciar servidor",
            onClick: () => a.setSettings({ ...a.settings, mutedServers: muted ? a.settings.mutedServers.filter((x) => x !== srv.sid) : [...a.settings.mutedServers, srv.sid] }),
          },
          { sep: true },
          { label: "Mover para a esquerda", onClick: () => a.moveServerOrder(srv.sid, -1), disabled: i === 0 },
          { label: "Mover para a direita", onClick: () => a.moveServerOrder(srv.sid, 1), disabled: i === a.servers.length - 1 },
          { sep: true },
          { label: "Convidar amigos", onClick: () => (a.selectServer(srv.roomId), open("invite")) },
          { label: "Sair do servidor", danger: true, onClick: () => confirm(`Sair de "${srv.name}"? O histórico salvo neste PC será apagado.`) && a.leaveServer(srv.sid) },
        ];
        return (
          <button
            key={srv.sid}
            className={"planet srv-planet" + (active ? " on" : "")}
            style={{ background: serverColor(srv.sid) }}
            data-tip={srv.name + (live ? " · alguém ao vivo" : "")}
            aria-label={srv.name}
            onClick={() => a.selectServer(srv.roomId)}
            onContextMenu={(e) => openMenu(e, menu)}
          >
            {initials(srv.name)}
            {mentions > 0 ? <span className="badge">{mentions > 99 ? "99+" : mentions}</span> : unread > 0 && !muted && !active ? <span className="ping" /> : null}
            {live ? <span className="pstate live" /> : voice ? <span className="pstate voice" /> : null}
          </button>
        );
      })}
      <button className="planet ghost add" data-tip="Criar ou entrar com convite" aria-label="Adicionar servidor" onClick={() => open("add")}>
        <Icons.Plus size={18} />
      </button>
    </nav>
  );
}

// ------------------------------------------------------------------ busca

export function FindPanel() {
  const a = useApp();
  const input = useRef<HTMLInputElement>(null);
  const mentions = Object.values(a.mentions).reduce((x, y) => x + y, 0);
  const unread = Object.values(a.unread).reduce((x, y) => x + y, 0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        const el = input.current;
        if (!el) return;
        // em janela estreita o campo fica invisível até a gaveta da busca abrir; focar já agora não perde letras
        el.focus();
        el.select();
        if (a.ctx.view !== "search") a.openCtx("search");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [a]);

  const results = a.ctx.view === "search" ? searchResults(a) : [];
  return (
    <div className="find panel">
      <label className="search">
        <Icons.Search size={16} />
        <input
          ref={input}
          value={a.search}
          placeholder="Buscar ou pular para…"
          aria-label="Buscar"
          spellCheck={false}
          onFocus={() => a.ctx.view !== "search" && a.openCtx("search")}
          onChange={(e) => {
            a.searchSel = 0;
            a.setSearch(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              input.current?.blur();
              a.ctxHome();
            } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const n = results.length || 1;
              a.searchSel = (a.searchSel + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
              a.emit();
            } else if (e.key === "Enter" && results[a.searchSel]) {
              e.preventDefault();
              input.current?.blur();
              results[a.searchSel].go();
            }
          }}
        />
        <kbd>Ctrl K</kbd>
      </label>
      <button className={"ibtn" + (a.ctx.view === "notifications" ? " on" : "")} data-tip="Notificações" aria-label="Notificações" onClick={() => (a.ctx.view === "notifications" ? a.ctxHome() : a.openCtx("notifications"))}>
        <Icons.Bell />
        {mentions > 0 ? <span className="badge">{mentions > 99 ? "99+" : mentions}</span> : unread > 0 ? <span className="ping" /> : null}
      </button>
    </div>
  );
}

export type SearchItem = { key: string; kind: "channel" | "voice" | "live" | "person" | "server" | "message"; label: string; sub: string; go: () => void; pub?: string; author?: string };

/** Resultados da busca global: lugares, pessoas e mensagens do servidor atual. */
export function searchResults(a: ReturnType<typeof useApp>): SearchItem[] {
  const q = a.search.trim().toLowerCase();
  const out: SearchItem[] = [];
  const s = a.session;
  const match = (t: string) => !q || t.toLowerCase().includes(q);
  if (s && s.isMember()) {
    for (const c of s.state.channels) if (match(c.name)) out.push({ key: "c" + c.id, kind: "channel", label: "#" + c.name, sub: a.unread[s.server.sid + ":" + c.id] ? `${a.unread[s.server.sid + ":" + c.id]} novas` : "canal", go: () => (a.selectChannel(c.id), a.ctxHome()) });
    if (match("sala de voz")) out.push({ key: "voice", kind: "voice", label: "Sala de voz", sub: "voz", go: () => (a.joinVoice(s), a.ctxHome()) });
    if (s.myLive && match(s.myLive.title)) out.push({ key: "mylive", kind: "live", label: `Você · ${s.myLive.title}`, sub: "ao vivo", go: () => (a.openLive(selfId), a.ctxHome()) });
    for (const [id, p] of Object.entries(s.peers)) if (p.live && match(`${p.profile?.name ?? ""} ${p.live.title}`)) out.push({ key: "l" + id, kind: "live", label: `${s.profileOf(p.pub).name} · ${p.live.title}`, sub: "ao vivo", go: () => (a.openLive(id), a.ctxHome()) });
    const seen = new Set<string>();
    for (const pub of [...Object.values(s.peers).map((p) => p.pub), ...Object.keys(s.members)]) {
      if (seen.has(pub) || pub === s.me) continue;
      seen.add(pub);
      const name = s.profileOf(pub).name;
      if (q && match(name)) out.push({ key: "p" + pub, kind: "person", label: name, sub: s.profileOf(pub).online ? "online" : "pessoa", pub, go: () => a.openCtx("profile", pub) });
    }
  }
  for (const srv of a.servers) if (q && match(srv.name) && srv.roomId !== a.activeRoom) out.push({ key: "s" + srv.sid, kind: "server", label: srv.name, sub: "servidor", go: () => (a.selectServer(srv.roomId), a.ctxHome()) });
  if (s && s.isMember() && q.length >= 2) {
    const msgs: SearchItem[] = [];
    for (const [ch, list] of s.state.messages) {
      const chName = s.state.channels.find((c) => c.id === ch)?.name ?? ch;
      for (let i = list.length - 1; i >= 0 && msgs.length < 12; i--) {
        const m = list[i];
        if (m.deleted || !m.text.toLowerCase().includes(q)) continue;
        msgs.push({ key: "m" + m.id, kind: "message", label: m.text.slice(0, 120), sub: "#" + chName, author: s.profileOf(m.author).name, go: () => (a.selectChannel(ch), a.ctxHome(), setTimeout(() => document.getElementById("msg-" + m.id)?.scrollIntoView({ block: "center" }), 80)) });
      }
    }
    out.push(...msgs);
  }
  return out.slice(0, 40);
}

export const CTX_TITLES: Record<CtxView, string> = {
  home: "Agora",
  members: "Membros",
  profile: "Perfil",
  search: "Pular para",
  theme: "Personalizar",
  notifications: "Notificações",
};
