/**
 * Estado do servidor derivado do log de eventos assinados.
 * Todo mundo aplica as mesmas regras sobre os mesmos eventos, então todos
 * chegam ao mesmo resultado sem precisar de um servidor que decida.
 */
import type { Channel, MsgView, StoredEvent } from "./types";

export type Derived = {
  name: string;
  nameTs: number;
  channels: Channel[];
  messages: Map<string, MsgView[]>; // por canal
  byId: Map<string, MsgView>;
  admins: Set<string>;
  banned: Set<string>;
  /** aprovados explicitamente (quando a aprovação de entrada está ligada) */
  admitted: Set<string>;
  /** novos membros precisam ser aprovados por um admin */
  approval: boolean;
  move: { r: string; p: string; ts: number } | null;
};

/** Quem pode ver e participar do servidor. */
export function isMemberOf(st: Derived, owner: string, pub: string) {
  if (st.banned.has(pub)) return false;
  return !owner || !st.approval || st.admins.has(pub) || st.admitted.has(pub);
}

export function derive(events: StoredEvent[], owner: string, seed: { name: string; channels: Channel[] }): Derived {
  const sorted = [...events].sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : 1));
  const admins = new Set<string>(owner ? [owner] : []);
  const banned = new Set<string>();
  const admitted = new Set<string>();
  let approval = false;
  const isAdmin = (pub: string) => !owner || admins.has(pub);
  const isMember = (pub: string) => !owner || !approval || admins.has(pub) || admitted.has(pub);
  // eventos de conteúdo só valem de quem é membro naquele momento
  const CONTENT = new Set(["msg", "edit", "del", "react"]);

  let name = seed.name;
  let nameTs = 0;
  const chans = new Map<string, Channel>(seed.channels.map((c) => [c.id, c]));
  const byId = new Map<string, MsgView>();
  let move: Derived["move"] = null;

  for (const e of sorted) {
    const b = e.b;
    if (banned.has(e.a) && b.k !== "ban") continue;
    if (CONTENT.has(b.k) && !isMember(e.a)) continue;
    try {
      apply(e, b);
    } catch (err) {
      // um evento malformado que passou pela rede não pode inutilizar o servidor para todo mundo
      console.warn("evento ignorado ao derivar o estado:", e.id, err);
    }
  }

  function apply(e: StoredEvent, b: StoredEvent["b"]) {
    switch (b.k) {
      case "msg":
        if (typeof b.text !== "string" || typeof b.ch !== "string") break;
        byId.set(e.id, {
          id: e.id,
          ch: b.ch,
          author: e.a,
          fallbackName: b.n,
          ts: e.ts,
          text: b.text.slice(0, 4000),
          reply: b.reply,
          att: Array.isArray(b.att) ? b.att.slice(0, 10) : undefined,
          deleted: false,
          // sem protótipo: o emoji vem da rede e "constructor"/"toString" não podem virar uma lista já existente
          reactions: Object.create(null) as Record<string, string[]>,
          pending: e.pending,
        });
        break;
      case "edit": {
        const m = byId.get(b.target);
        if (m && m.author === e.a && !m.deleted) {
          m.text = String(b.text).slice(0, 4000);
          m.edited = e.ts;
        }
        break;
      }
      case "del": {
        const m = byId.get(b.target);
        if (m && (m.author === e.a || isAdmin(e.a))) {
          m.deleted = true;
          m.text = "";
          m.att = undefined;
        }
        break;
      }
      case "react": {
        const m = byId.get(b.target);
        if (!m || typeof b.emoji !== "string" || b.emoji.length > 16) break;
        const list = m.reactions[b.emoji] ?? [];
        const has = list.includes(e.a);
        if (b.on && !has) m.reactions[b.emoji] = [...list, e.a];
        if (!b.on && has) m.reactions[b.emoji] = list.filter((x) => x !== e.a);
        if (m.reactions[b.emoji]?.length === 0) delete m.reactions[b.emoji];
        break;
      }
      case "role":
        if (e.a === owner && b.user !== owner) {
          if (b.role === "admin") admins.add(b.user);
          else admins.delete(b.user);
        }
        break;
      case "ban":
        if (isAdmin(e.a) && b.user !== owner && b.user !== e.a) {
          if (b.on) {
            banned.add(b.user);
            admins.delete(b.user);
          } else banned.delete(b.user);
        }
        break;
      case "chan":
        if (!isAdmin(e.a)) break;
        if (b.del) chans.delete(b.id);
        else chans.set(b.id, { id: b.id, name: String(b.name).slice(0, 40) });
        break;
      case "name":
        if (isAdmin(e.a) && b.name) {
          name = String(b.name).slice(0, 60);
          nameTs = e.ts;
        }
        break;
      case "admit":
        if (isAdmin(e.a) && b.user !== owner) {
          if (b.on) admitted.add(b.user);
          else {
            admitted.delete(b.user);
            if (e.a === owner) admins.delete(b.user);
          }
        }
        break;
      case "policy":
        if (isAdmin(e.a)) approval = !!b.approval;
        break;
      case "move":
        if (isAdmin(e.a)) move = { r: b.r, p: b.p, ts: e.ts };
        break;
    }
  }

  const messages = new Map<string, MsgView[]>();
  for (const m of byId.values()) {
    let list = messages.get(m.ch);
    if (!list) messages.set(m.ch, (list = []));
    list.push(m);
  }
  const channels = [...chans.values()];
  if (!channels.length) channels.push({ id: "geral", name: "geral" });
  return { name, nameTs, channels, messages, byId, admins, banned, admitted, approval, move };
}

/** Resumo do log por dia, usado para descobrir rapidamente o que falta entre dois peers. */
export function summarize(events: Iterable<StoredEvent>): Record<string, string> {
  const days = new Map<string, string[]>();
  for (const e of events) {
    const d = dayKey(e.ts);
    let l = days.get(d);
    if (!l) days.set(d, (l = []));
    l.push(e.id);
  }
  const out: Record<string, string> = {};
  for (const [d, ids] of days) out[d] = ids.length + ":" + fnv(ids.sort().join(","));
  return out;
}

export const dayKey = (ts: number) => String(Math.floor(ts / 86_400_000));

function fnv(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
