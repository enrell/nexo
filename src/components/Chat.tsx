import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useApp } from "../lib/app";
import { db } from "../lib/db";
import { MAX_FILE, type Session } from "../lib/session";
import type { Attachment, MsgView } from "../lib/types";
import { PaperPlaneTilt, PlusCircle, SidebarSimple } from "@phosphor-icons/react";
import { selfId } from "../lib/session";
import { Avatar, Icons, dateLabel, formatBytes, timeLabel } from "./common";
import { openMenu, type MenuItem } from "./ContextMenu";
import { EMOJI_GROUPS, QUICK_REACTIONS } from "./emoji";
import { openLightbox } from "./Lightbox";
import { Markdown, extractUrls, isEmojiOnly } from "./Markdown";
import { memberMenu } from "./Members";

const PAGE = 150;
export const mentionToken = (name: string) => name.replace(/\s+/g, "_");

export function ChatView({ s, compact }: { s: Session; compact?: boolean }) {
  const a = useApp();
  const channelId = a.channelOf(s);
  const channel = s.state.channels.find((c) => c.id === channelId) ?? { id: channelId, name: channelId };
  const all = s.state.messages.get(channelId) ?? [];
  const [limit, setLimit] = useState(PAGE);
  const query = "";
  const [replyTo, setReplyTo] = useState<MsgView | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dropped, setDropped] = useState<File[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const prevHeight = useRef(0);
  const readKey = s.server.sid + ":" + channelId;
  const [lastReadAtOpen, setLastReadAtOpen] = useState(() => a.lastRead[readKey] ?? 0);

  useEffect(() => {
    setLimit(PAGE);
    setReplyTo(null);
    setEditing(null);
    setLastReadAtOpen(a.lastRead[readKey] ?? 0);
    stick.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readKey]);

  const filtered = useMemo(() => {
    if (!query.trim()) return all;
    const q = query.toLowerCase();
    return all.filter((m) => !m.deleted && (m.text.toLowerCase().includes(q) || s.profileOf(m.author).name.toLowerCase().includes(q) || m.att?.some((x) => x.name.toLowerCase().includes(q))));
  }, [all, query, s]);
  const msgs = filtered.slice(-limit);
  const hasMore = filtered.length > msgs.length;

  const names = useMemo(() => {
    const set = new Set<string>();
    set.add(mentionToken(a.profile!.name).toLowerCase());
    for (const m of Object.values(s.members)) set.add(mentionToken(m.name).toLowerCase());
    for (const p of Object.values(s.peers)) if (p.profile) set.add(mentionToken(p.profile.name).toLowerCase());
    return set;
  }, [s.members, s.peers, a.profile]);

  // rolagem: gruda no fim quando chega mensagem; mantém posição ao carregar antigas
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (prevHeight.current && !stick.current) el.scrollTop += el.scrollHeight - prevHeight.current;
    else if (stick.current) el.scrollTop = el.scrollHeight;
    prevHeight.current = 0;
  }, [msgs.length, channelId, limit]);

  useEffect(() => {
    const onFocus = () => (a.markRead(s, channelId), a.emit());
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [s, channelId, a]);

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 200 && hasMore) {
      prevHeight.current = el.scrollHeight;
      setLimit((l) => l + PAGE);
    }
  };

  const jumpTo = (id: string) => {
    const idx = filtered.findIndex((m) => m.id === id);
    if (idx < 0) return;
    if (filtered.length - idx > limit) setLimit(filtered.length - idx + 20);
    stick.current = false;
    setTimeout(() => {
      const el = document.getElementById("msg-" + id);
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      el?.classList.add("flash");
      setTimeout(() => el?.classList.remove("flash"), 1500);
    }, 50);
  };

  const myLast = useMemo(() => [...all].reverse().find((m) => m.author === s.me && !m.deleted), [all, s.me]);
  const typers = s.typingIn(channelId);
  const peersOnline = Object.keys(s.peers).length;

  return (
    <div
      className={"chat" + (compact ? " compact" : "")}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        setDropped([...e.dataTransfer.files]);
      }}
    >
      {!compact && (
        <header className="main-head chat-head">
          <div className="head-title">
            <h3>
              <Icons.Hash size={18} />
              {channel.name}
            </h3>
            <small>Histórico guardado e assinado por todos os membros</small>
          </div>
          <LiveCapsule s={s} />
          <ChannelBell s={s} channelId={channelId} />
          <button className={"ibtn" + (a.ctx.view === "members" && !a.settings.ctxCollapsed ? " on" : "")} data-tip="Membros" aria-label="Membros" onClick={() => a.toggleMembers()}>
            <Icons.Users />
          </button>
          {a.settings.ctxCollapsed && (
            <button className="ibtn" data-tip="Mostrar painel" aria-label="Mostrar painel" onClick={() => a.toggleCtx()}>
              <SidebarSimple size={19} weight="duotone" />
            </button>
          )}
        </header>
      )}
      {!compact && <ConnectionBanner s={s} peersOnline={peersOnline} />}

      <div className="messages" ref={listRef} onScroll={onScroll}>
        {!compact && !hasMore && !query && (
          <div className="chat-welcome">
            <div className="welcome-icon">
              <Icons.Hash size={40} />
            </div>
            <h1>Bem-vindo(a) a #{channel.name}!</h1>
            <p className="dim">Este é o começo do canal #{channel.name}.</p>
          </div>
        )}
        {query && <div className="search-info dim small">{filtered.length} resultado(s) para “{query}”</div>}
        {hasMore && <div className="load-more dim small">Carregando mensagens antigas…</div>}
        {msgs.map((m, i) => {
          const prev = msgs[i - 1];
          const newDay = !prev || new Date(prev.ts).toDateString() !== new Date(m.ts).toDateString();
          const firstUnread = !query && lastReadAtOpen > 0 && m.ts > lastReadAtOpen && m.author !== s.me && (!prev || prev.ts <= lastReadAtOpen);
          return (
            <MessageBlock
              key={m.id}
              s={s}
              m={m}
              grouped={!newDay && !firstUnread && isGrouped(prev, m)}
              newDay={newDay}
              firstUnread={firstUnread}
              names={names}
              editing={editing === m.id}
              onEdit={() => setEditing(m.id)}
              onEditDone={() => setEditing(null)}
              onReply={() => setReplyTo(m)}
              onJump={jumpTo}
            />
          );
        })}
      </div>

      <Composer
        s={s}
        channelId={channelId}
        channelName={channel.name}
        replyTo={replyTo}
        clearReply={() => setReplyTo(null)}
        onEditLast={() => myLast && setEditing(myLast.id)}
        dropped={dropped}
        clearDropped={() => setDropped([])}
        onSent={() => (stick.current = true)}
        compact={compact}
      />
      <div className="typing-line">
        {typers.length > 0 && (
          <>
            <span className="typing-dots">
              <i />
              <i />
              <i />
            </span>
            <strong>{typers.slice(0, 3).join(", ")}</strong> {typers.length === 1 ? "está digitando…" : "estão digitando…"}
          </>
        )}
      </div>
      {dragging && (
        <div className="drop-overlay">
          <div>
            <Icons.Clip size={40} />
            <h2>Enviar para #{channel.name}</h2>
            <p>Solte os arquivos aqui (até {MAX_FILE / 1024 / 1024} MB cada)</p>
          </div>
        </div>
      )}
    </div>
  );
}

/** "Fulano está ao vivo · Assistir" no topo do chat. */
function LiveCapsule({ s }: { s: Session }) {
  const a = useApp();
  const lives = [...(s.myLive ? [selfId] : []), ...Object.entries(s.peers).filter(([, p]) => p.live && s.isMember(p.pub)).map(([id]) => id)];
  if (!lives.length) return null;
  const first = lives[0];
  const who = first === selfId ? "Você está" : `${s.peerName(first)} está`;
  return (
    <div className="livecap">
      <span className="dot" />
      <span className="ellipsis">
        {who} ao vivo{lives.length > 1 ? ` (+${lives.length - 1})` : ""}
      </span>
      <button onClick={() => a.openLive(first)}>{first === selfId ? "Ver" : "Assistir"}</button>
    </div>
  );
}

function ChannelBell({ s, channelId }: { s: Session; channelId: string }) {
  const a = useApp();
  const key = s.server.sid + ":" + channelId;
  const muted = a.settings.mutedChannels.includes(key);
  return (
    <button
      className="ibtn"
      data-tip={muted ? "Reativar notificações do canal" : "Silenciar canal"}
      onClick={() => a.setSettings({ ...a.settings, mutedChannels: muted ? a.settings.mutedChannels.filter((k) => k !== key) : [...a.settings.mutedChannels, key] })}
    >
      {muted ? <Icons.BellOff /> : <Icons.Bell />}
    </button>
  );
}

function ConnectionBanner({ s, peersOnline }: { s: Session; peersOnline: number }) {
  const a = useApp();
  if (s.joinError) return <div className="banner error">⚠ {s.joinError}</div>;
  const pending = s.isAdmin() ? s.pendingPeers() : [];
  if (pending.length)
    return (
      <div className="banner warn">
        🚪 {pending.length === 1 ? `${s.profileOf(pending[0][1].pub).name} está pedindo para entrar.` : `${pending.length} pessoas estão pedindo para entrar.`}
        <button className="btn small" onClick={() => a.openCtx("members")}>
          Ver pedidos
        </button>
      </div>
    );
  if (!s.loaded) return <div className="banner">Carregando histórico…</div>;
  if (peersOnline === 0)
    return (
      <div className="banner">
        <span className="spinner tiny" /> Procurando amigos online… Suas mensagens ficam guardadas e são entregues quando alguém entrar.
      </div>
    );
  return null;
}

const isGrouped = (prev: MsgView | undefined, m: MsgView) => !!prev && prev.author === m.author && m.ts - prev.ts < 5 * 60_000 && !m.reply;

function MessageBlock(props: {
  s: Session;
  m: MsgView;
  grouped: boolean;
  newDay: boolean;
  firstUnread: boolean;
  names: Set<string>;
  editing: boolean;
  onEdit: () => void;
  onEditDone: () => void;
  onReply: () => void;
  onJump: (id: string) => void;
}) {
  const { s, m } = props;
  return (
    <>
      {props.newDay && (
        <div className="divider">
          <span>{dateLabel(m.ts)}</span>
        </div>
      )}
      {props.firstUnread && (
        <div className="divider unread">
          <span>Novas mensagens</span>
        </div>
      )}
      <MessageRow {...props} key={m.id + (s.state.byId.get(m.id)?.edited ?? "")} />
    </>
  );
}

function MessageRow({ s, m, grouped, names, editing, onEdit, onEditDone, onReply, onJump }: Parameters<typeof MessageBlock>[0]) {
  const a = useApp();
  const author = s.profileOf(m.author);
  const mine = m.author === s.me;
  const canDelete = mine || s.isAdmin();
  const mentionsMe = !mine && a.isMention(m.text);
  const replied = m.reply ? s.state.byId.get(m.reply) : undefined;
  const role = s.isOwner(m.author) ? "owner" : s.server.owner && s.state.admins.has(m.author) ? "admin" : null;
  const [picker, setPicker] = useState(false);

  if (m.deleted)
    return (
      <div className="msg deleted-msg" id={"msg-" + m.id}>
        <span className="dim small">
          <Icons.Trash size={14} /> Mensagem apagada
        </span>
      </div>
    );

  const menu = (e: React.MouseEvent) => {
    const items: MenuItem[] = [
      { custom: <QuickReacts onPick={(em) => s.toggleReaction(m.id, em)} /> },
      { sep: true },
      { label: "Responder", onClick: onReply, icon: <Icons.Reply size={16} /> },
      ...(mine ? [{ label: "Editar", onClick: onEdit, icon: <Icons.Edit size={16} /> }] : []),
      { label: "Copiar texto", onClick: () => navigator.clipboard.writeText(m.text), icon: <Icons.Copy size={16} /> },
      ...(canDelete
        ? [
            { sep: true } as MenuItem,
            {
              label: "Apagar mensagem",
              danger: true,
              onClick: () => (e.shiftKey || confirm("Apagar esta mensagem para todos?")) && s.deleteMessage(m.id),
              icon: <Icons.Trash size={16} />,
            },
          ]
        : []),
    ];
    openMenu(e, items);
  };

  const urls = a.settings.linkPreviews ? extractUrls(m.text).slice(0, 2) : [];
  const emojiOnly = isEmojiOnly(m.text);
  const body = (
    <>
      {editing ? (
        <EditBox
          initial={m.text}
          onSave={(t) => {
            if (t.trim() && t !== m.text) s.editMessage(m.id, t);
            onEditDone();
          }}
          onCancel={onEditDone}
        />
      ) : (
        m.text && (
          <div className={"msg-text" + (emojiOnly ? " jumbo" : "")}>
            <Markdown text={m.text} names={names} me={mentionToken(a.profile!.name)} />
            {m.edited && (
              <span className="edited" title={timeLabel(m.edited)}>
                {" "}
                (editado)
              </span>
            )}
          </div>
        )
      )}
      {m.att?.map((att) => <AttachmentView key={att.id} s={s} att={att} author={m.author} />)}
      {urls.map((u) => (
        <LinkPreview key={u} url={u} />
      ))}
      <Reactions s={s} m={m} />
    </>
  );

  const hm = new Date(m.ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const openProfile = () => a.openCtx("profile", m.author);
  return (
    <div className={"msg" + (grouped ? " grouped" : "") + (mine ? " mine" : "") + (mentionsMe ? " mentioned" : "") + (m.pending ? " pending" : "")} id={"msg-" + m.id} onContextMenu={menu}>
      <div className="msg-row">
        {grouped ? (
          <span className="msg-time-hover">{hm}</span>
        ) : (
          <button className="msg-avatar" onClick={openProfile} onContextMenu={(e) => openMenu(e, memberMenu(s, m.author))} aria-label={`Perfil de ${author.name}`}>
            <Avatar name={author.name} color={author.color} src={author.avatar} size={36} />
          </button>
        )}
        <div className="bubble msg-body">
          {!grouped && (
            <div className="msg-head">
              <button className="msg-author" onClick={openProfile} onContextMenu={(e) => openMenu(e, memberMenu(s, m.author))}>
                {author.name}
              </button>
              {role === "owner" && <span className="role-pill owner">dono</span>}
              {role === "admin" && <span className="role-pill">admin</span>}
              <span className="msg-time" title={timeLabel(m.ts)}>
                {hm}
              </span>
              {m.pending && (
                <span className="msg-time" title="Ninguém online ainda — será entregue quando alguém entrar">
                  · aguardando entrega
                </span>
              )}
            </div>
          )}
          {replied && (
            <button className="reply-ref" onClick={() => onJump(replied.id)}>
              <strong>{s.profileOf(replied.author).name}</strong>
              <span className="ellipsis">{replied.deleted ? "Mensagem apagada" : replied.text || "📎 Anexo"}</span>
            </button>
          )}
          {body}
        </div>
      </div>
      {!editing && (
        <div className="msg-tools">
          {QUICK_REACTIONS.slice(0, 3).map((em) => (
            <button key={em} className="tool" title={`Reagir com ${em}`} onClick={() => s.toggleReaction(m.id, em)}>
              {em}
            </button>
          ))}
          <button className="tool" title="Adicionar reação" onClick={() => setPicker(!picker)}>
            <Icons.Smile size={18} />
          </button>
          <button className="tool" title="Responder" onClick={onReply}>
            <Icons.Reply size={18} />
          </button>
          {mine && (
            <button className="tool" title="Editar" onClick={onEdit}>
              <Icons.Edit size={18} />
            </button>
          )}
          {canDelete && (
            <button className="tool danger" title="Apagar (Shift+clique apaga sem perguntar)" onClick={(e) => (e.shiftKey || confirm("Apagar esta mensagem para todos?")) && s.deleteMessage(m.id)}>
              <Icons.Trash size={18} />
            </button>
          )}
          {picker && (
            <EmojiPicker
              onPick={(em) => {
                s.toggleReaction(m.id, em);
                setPicker(false);
              }}
              onClose={() => setPicker(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function QuickReacts({ onPick }: { onPick: (e: string) => void }) {
  return (
    <div className="quick-reacts">
      {QUICK_REACTIONS.map((em) => (
        <button key={em} onClick={() => onPick(em)}>
          {em}
        </button>
      ))}
    </div>
  );
}

function Reactions({ s, m }: { s: Session; m: MsgView }) {
  const entries = Object.entries(m.reactions);
  if (!entries.length) return null;
  return (
    <div className="reactions">
      {entries.map(([em, users]) => (
        <button
          key={em}
          className={"reaction" + (users.includes(s.me) ? " mine" : "")}
          title={users.map((u) => s.profileOf(u).name).join(", ")}
          onClick={() => s.toggleReaction(m.id, em)}
        >
          <span>{em}</span> {users.length}
        </button>
      ))}
    </div>
  );
}

function EditBox({ initial, onSave, onCancel }: { initial: string; onSave: (t: string) => void; onCancel: () => void }) {
  const [t, setT] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, []);
  return (
    <div className="edit-box">
      <AutoTextarea
        taRef={ref}
        value={t}
        onChange={setT}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSave(t);
          }
          if (e.key === "Escape") onCancel();
        }}
      />
      <div className="dim small">
        Esc para <a onClick={onCancel}>cancelar</a> • Enter para <a onClick={() => onSave(t)}>salvar</a>
      </div>
    </div>
  );
}

function AutoTextarea({
  value,
  onChange,
  onKeyDown,
  placeholder,
  taRef,
  onPaste,
}: {
  value: string;
  onChange: (v: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  taRef?: React.RefObject<HTMLTextAreaElement | null>;
  onPaste?: (e: React.ClipboardEvent) => void;
}) {
  const own = useRef<HTMLTextAreaElement>(null);
  const ref = taRef ?? own;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 240) + "px";
  }, [value, ref]);
  return <textarea ref={ref} rows={1} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} onPaste={onPaste} spellCheck />;
}

// ------------------------------------------------------------------ composer

function Composer({
  s,
  channelId,
  channelName,
  replyTo,
  clearReply,
  onEditLast,
  dropped,
  clearDropped,
  onSent,
  compact,
}: {
  s: Session;
  channelId: string;
  channelName: string;
  replyTo: MsgView | null;
  clearReply: () => void;
  onEditLast: () => void;
  dropped: File[];
  clearDropped: () => void;
  onSent: () => void;
  compact?: boolean;
}) {
  const a = useApp();
  const draftKey = s.server.sid + ":" + channelId;
  const [text, setText] = useState(() => drafts.get(draftKey) ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const [emoji, setEmoji] = useState(false);
  const [sending, setSending] = useState(false);
  const [sel, setSel] = useState(0);
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setText(drafts.get(draftKey) ?? "");
    setFiles([]);
    ta.current?.focus();
  }, [draftKey]);
  useEffect(() => {
    drafts.set(draftKey, text);
  }, [text, draftKey]);
  useEffect(() => {
    if (dropped.length) {
      addFiles(dropped);
      clearDropped();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dropped]);
  useEffect(() => {
    if (replyTo) ta.current?.focus();
  }, [replyTo]);

  const addFiles = (list: File[]) => {
    const ok = list.filter((f) => {
      if (f.size > MAX_FILE) {
        a.showToast(`"${f.name}" é maior que ${MAX_FILE / 1024 / 1024} MB.`, "error");
        return false;
      }
      return true;
    });
    setFiles((cur) => [...cur, ...ok].slice(0, 10));
  };

  // autocompletar @menção
  const mentionMatch = text.match(/(?:^|\s)@([\p{L}\p{N}_.-]*)$/u);
  const candidates = useMemo(() => {
    if (!mentionMatch) return [];
    const q = mentionMatch[1].toLowerCase();
    const seen = new Map<string, { name: string; color: string; avatar?: string }>();
    for (const p of Object.values(s.peers)) if (p.profile) seen.set(p.pub, p.profile);
    for (const m of Object.values(s.members)) if (!seen.has(m.pub)) seen.set(m.pub, m);
    const list = [...seen.values()].filter((p) => p.name.toLowerCase().includes(q)).slice(0, 7);
    if ("todos".startsWith(q)) list.push({ name: "todos", color: "#949cf7" });
    return list;
  }, [mentionMatch?.[1], s.peers, s.members]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickMention = (name: string) => {
    setText(text.replace(/@([\p{L}\p{N}_.-]*)$/u, "@" + mentionToken(name) + " "));
    setSel(0);
    ta.current?.focus();
  };

  const send = async () => {
    const t = text.trim();
    if (!t && !files.length) return;
    if (files.length && sending) return;
    // limpa na hora: dá para digitar a próxima enquanto esta é assinada/enviada
    const sentFiles = files;
    const reply = replyTo?.id;
    setText("");
    setFiles([]);
    clearReply();
    onSent();
    setSending(true);
    try {
      await s.sendMessage(channelId, t, { reply, files: sentFiles });
      s.clearTyping(s.me, channelId);
    } catch (e) {
      setText((cur) => cur || t);
      setFiles(sentFiles);
      a.showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="composer">
      {replyTo && (
        <div className="reply-bar">
          <span>
            Respondendo a <strong style={{ color: s.profileOf(replyTo.author).color }}>{s.profileOf(replyTo.author).name}</strong>
          </span>
          <button className="icon-btn tiny" onClick={clearReply} aria-label="Cancelar resposta">
            <Icons.X size={14} />
          </button>
        </div>
      )}
      {files.length > 0 && (
        <div className="pending-files">
          {files.map((f, i) => (
            <FileChip key={i} file={f} onRemove={() => setFiles(files.filter((_, j) => j !== i))} />
          ))}
        </div>
      )}
      {candidates.length > 0 && (
        <div className="autocomplete">
          <div className="dim small">MEMBROS</div>
          {candidates.map((c, i) => (
            <button key={c.name + i} className={i === sel ? "on" : ""} onMouseEnter={() => setSel(i)} onClick={() => pickMention(c.name)}>
              <Avatar name={c.name} color={c.color} src={c.avatar} size={22} />
              <span>{c.name}</span>
              <span className="dim small">@{mentionToken(c.name)}</span>
            </button>
          ))}
        </div>
      )}
      <div className={"composer-box" + (replyTo || files.length ? " joined" : "")}>
        <button className="ibtn" data-tip="Enviar arquivo" aria-label="Enviar arquivo" onClick={() => fileInput.current?.click()}>
          <PlusCircle size={20} weight="duotone" />
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            addFiles([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
        <AutoTextarea
          taRef={ta}
          value={text}
          placeholder={`Conversar em #${channelName}`}
          onChange={(v) => {
            setText(v);
            if (v) s.sendTyping(channelId);
          }}
          onPaste={(e) => {
            const fl = [...e.clipboardData.files];
            if (fl.length) {
              e.preventDefault();
              addFiles(fl.map((f, i) => (f.name === "image.png" ? new File([f], `colado-${Date.now()}-${i}.png`, { type: f.type }) : f)));
            }
          }}
          onKeyDown={(e) => {
            if (candidates.length) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setSel((sel + (e.key === "ArrowDown" ? 1 : candidates.length - 1)) % candidates.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                pickMention(candidates[sel].name);
                return;
              }
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
            if (e.key === "ArrowUp" && !text) {
              e.preventDefault();
              onEditLast();
            }
            if (e.key === "Escape" && replyTo) clearReply();
          }}
        />
        <div className="emoji-anchor">
          <button className="ibtn" data-tip="Emoji" aria-label="Emoji" onClick={() => setEmoji(!emoji)}>
            <Icons.Smile />
          </button>
          {emoji && (
            <EmojiPicker
              onPick={(em) => {
                setText(text + em);
                ta.current?.focus();
              }}
              onClose={() => setEmoji(false)}
              up
            />
          )}
        </div>
        <button className="send" data-tip="Enviar (Enter)" aria-label="Enviar" disabled={!text.trim() && !files.length} onClick={send}>
          <PaperPlaneTilt size={19} weight="fill" />
        </button>
      </div>
      {!compact && <div className="composer-hint dim">**negrito** *itálico* ~~riscado~~ `código` ||spoiler|| &gt; citação · Shift+Enter quebra linha · ↑ edita a última</div>}
    </div>
  );
}

const drafts = new Map<string, string>();

function FileChip({ file, onRemove }: { file: File; onRemove: () => void }) {
  const url = useMemo(() => (file.type.startsWith("image/") ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  return (
    <div className="file-chip">
      {url ? <img src={url} alt="" /> : <Icons.File size={36} />}
      <span className="ellipsis small">{file.name}</span>
      <span className="dim small">{formatBytes(file.size)}</span>
      <button className="icon-btn tiny danger-hover" onClick={onRemove} aria-label="Remover">
        <Icons.Trash size={14} />
      </button>
    </div>
  );
}

export function EmojiPicker({ onPick, onClose, up }: { onPick: (e: string) => void; onClose: () => void; up?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [group, setGroup] = useState(0);
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const t = setTimeout(() => window.addEventListener("mousedown", close));
    return () => {
      clearTimeout(t);
      window.removeEventListener("mousedown", close);
    };
  }, [onClose]);
  return (
    <div className={"emoji-picker" + (up ? " up" : "")} ref={ref}>
      <div className="emoji-tabs">
        {EMOJI_GROUPS.map((g, i) => (
          <button key={g.name} className={i === group ? "on" : ""} title={g.name} onClick={() => setGroup(i)}>
            {g.list[0]}
          </button>
        ))}
      </div>
      <div className="dim small emoji-group-name">{EMOJI_GROUPS[group].name}</div>
      <div className="emoji-grid">
        {EMOJI_GROUPS[group].list.map((em) => (
          <button key={em} onClick={() => onPick(em)}>
            {em}
          </button>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ anexos

const urlCache = new Map<string, string>();

function useBlobUrl(s: Session, att: Attachment) {
  useApp();
  const [url, setUrl] = useState<string | null>(urlCache.get(att.id) ?? null);
  const loading = s.blobsLoading.has(att.id);
  useEffect(() => {
    if (url) return;
    let alive = true;
    db.getBlob(att.id).then((b) => {
      if (!b || !alive) return;
      const u = URL.createObjectURL(new Blob([b.data], { type: b.mime }));
      urlCache.set(att.id, u);
      setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [att.id, url, loading]);
  return { url, loading };
}

/** Extensões que executam código no Windows: pedimos confirmação antes de salvar. */
const DANGEROUS = /\.(exe|com|bat|cmd|scr|pif|msi|msix|msp|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|cpl|jar|lnk|reg|dll|sys|appx|appxbundle|iso|img|vhd|vhdx|url|scf|chm|inf)$/i;

function guardDownload(e: React.MouseEvent, name: string) {
  if (DANGEROUS.test(name) && !confirm(`"${name}" é um arquivo que pode executar programas no seu PC.

Só abra se você confia em quem mandou e esperava esse arquivo. Salvar mesmo assim?`)) e.preventDefault();
}

function AttachmentView({ s, att, author }: { s: Session; att: Attachment; author: string }) {
  const { url, loading } = useBlobUrl(s, att);
  const isImage = att.mime.startsWith("image/");
  const isVideo = att.mime.startsWith("video/");
  const fetchIt = () => s.fetchBlob(att, s.peerIdOf(author) ?? undefined);

  if (isImage) {
    const maxW = 400;
    const w = att.w && att.h ? Math.min(maxW, att.w, (300 * att.w) / att.h) : maxW;
    const h = att.w && att.h ? (w * att.h) / att.w : 200;
    return (
      <div className="att-image" style={{ width: w, height: h }}>
        {url ? (
          <img src={url} alt={att.name} onClick={() => openLightbox(url, att.name)} />
        ) : (
          <div className="att-missing">
            {loading ? (
              <>
                <span className="spinner tiny" /> Baixando de um amigo…
              </>
            ) : (
              <button className="btn small" onClick={fetchIt}>
                <Icons.Download size={14} /> Baixar imagem ({formatBytes(att.size)})
              </button>
            )}
          </div>
        )}
      </div>
    );
  }
  if (isVideo && url)
    return (
      <video className="att-video" src={url} controls preload="metadata">
        <track kind="captions" />
      </video>
    );
  return (
    <div className="att-file">
      <Icons.File size={32} />
      <div className="att-file-info">
        {url ? (
          <a href={url} download={att.name} className={"ellipsis" + (DANGEROUS.test(att.name) ? " danger-text" : "")} onClick={(e) => guardDownload(e, att.name)}>
            {att.name}
          </a>
        ) : (
          <span className="ellipsis">{att.name}</span>
        )}
        <span className="dim small">{formatBytes(att.size)}</span>
      </div>
      {url ? (
        <a className="icon-btn" href={url} download={att.name} title="Salvar" onClick={(e) => guardDownload(e, att.name)}>
          <Icons.Download />
        </a>
      ) : loading ? (
        <span className="spinner tiny" />
      ) : (
        <button className="icon-btn" title="Baixar de um amigo" onClick={fetchIt}>
          <Icons.Download />
        </button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ prévias de link

const previewCache = new Map<string, Promise<NexoPreview>>();

function youtubeId(url: string) {
  const m = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/);
  return m?.[1] ?? null;
}

function LinkPreview({ url }: { url: string }) {
  const [p, setP] = useState<NexoPreview | undefined>(undefined);
  const yt = youtubeId(url);
  const isImage = /\.(png|jpe?g|gif|webp)(\?.*)?$/i.test(url);
  useEffect(() => {
    if (isImage || !window.nexo) return;
    let pr = previewCache.get(url);
    if (!pr) {
      pr = window.nexo.fetchPreview(url).catch(() => null);
      previewCache.set(url, pr);
    }
    let alive = true;
    pr.then((r) => alive && setP(r));
    return () => {
      alive = false;
    };
  }, [url, isImage]);

  if (isImage)
    return (
      <div className="att-image link-img">
        <img src={url} alt="" onClick={() => openLightbox(url, url)} onError={(e) => ((e.target as HTMLElement).parentElement!.style.display = "none")} />
      </div>
    );
  if (yt)
    return (
      <Embed site="YouTube" title={p?.title ?? "Vídeo do YouTube"} url={url} color="#ff0000">
        <a href={url} target="_blank" rel="noreferrer" className="yt-thumb">
          <img src={`https://i.ytimg.com/vi/${yt}/hqdefault.jpg`} alt="" />
          <span className="yt-play">▶</span>
        </a>
      </Embed>
    );
  if (!p) return null;
  return (
    <Embed site={p.site} title={p.title} url={url} description={p.description}>
      {p.image && <img className="embed-img" src={p.image} alt="" onError={(e) => ((e.target as HTMLElement).style.display = "none")} />}
    </Embed>
  );
}

function Embed({ site, title, url, description, children, color }: { site: string; title: string; url: string; description?: string; children?: ReactNode; color?: string }) {
  return (
    <div className="embed" style={{ borderLeftColor: color }}>
      <div className="dim small">{site}</div>
      <a href={url} target="_blank" rel="noreferrer" className="embed-title">
        {title}
      </a>
      {description && <div className="embed-desc">{description}</div>}
      {children}
    </div>
  );
}
