/**
 * Banco local (IndexedDB) com todo o conteúdo cifrado pelo cofre (AES-256-GCM).
 * Em claro ficam só identificadores aleatórios necessários para indexar
 * (id do evento, id do servidor, chave pública); textos, nomes, fotos e
 * arquivos nunca tocam o disco sem cifra.
 */
import type { Member, StoredEvent } from "./types";
import { open as openBox, openJson, seal, sealJson } from "./vault";

const DB_NAME = "nexo-secure";
const VERSION = 1;

let dbp: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  // banco antigo (versões de teste, sem cifra) é apagado
  try {
    indexedDB.deleteDatabase("nexo");
  } catch {
    /* ignore */
  }
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore("events", { keyPath: "id" }).createIndex("srv", "srv");
      db.createObjectStore("blobs", { keyPath: "id" });
      db.createObjectStore("members", { keyPath: ["srv", "pub"] }).createIndex("srv", "srv");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name: string, mode: IDBTransactionMode = "readonly") {
  return (await openDb()).transaction(name, mode).objectStore(name);
}

export type BlobRecord = { id: string; data: ArrayBuffer; mime: string; name: string; ts: number };

type EncRow = { id: string; srv: string; d: Uint8Array<ArrayBuffer> };
type EncMember = { srv: string; pub: string; d: Uint8Array<ArrayBuffer> };
type EncBlob = { id: string; meta: Uint8Array<ArrayBuffer>; d: Uint8Array<ArrayBuffer> };

export const db = {
  async loadEvents(srv: string): Promise<StoredEvent[]> {
    const rows = (await wrap((await store("events")).index("srv").getAll(srv))) as EncRow[];
    const out: StoredEvent[] = [];
    for (const r of rows) {
      try {
        out.push(await openJson<StoredEvent>(r.d, `ev:${srv}:${r.id}`));
      } catch {
        console.warn("evento local corrompido ignorado", r.id);
      }
    }
    return out;
  },
  async putEvents(evs: StoredEvent[]) {
    if (!evs.length) return;
    const rows: EncRow[] = await Promise.all(evs.map(async (e) => ({ id: e.id, srv: e.srv, d: await sealJson(e, `ev:${e.srv}:${e.id}`) })));
    const tx = (await openDb()).transaction("events", "readwrite");
    const st = tx.objectStore("events");
    for (const r of rows) st.put(r);
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  },
  async deleteServer(srv: string) {
    for (const name of ["events", "members"]) {
      const st = await store(name, "readwrite");
      const keys = await wrap(st.index("srv").getAllKeys(srv));
      const st2 = await store(name, "readwrite");
      for (const k of keys) st2.delete(k);
    }
  },
  async getBlob(id: string): Promise<BlobRecord | undefined> {
    const r = (await wrap((await store("blobs")).get(id))) as EncBlob | undefined;
    if (!r) return undefined;
    try {
      const meta = await openJson<{ mime: string; name: string; ts: number }>(r.meta, `blobmeta:${id}`);
      const data = await openBox(r.d, `blob:${id}`);
      return { id, data, ...meta };
    } catch {
      return undefined;
    }
  },
  async hasBlob(id: string): Promise<boolean> {
    return (await wrap((await store("blobs")).count(id))) > 0;
  },
  async putBlob(b: BlobRecord) {
    const row: EncBlob = { id: b.id, meta: await sealJson({ mime: b.mime, name: b.name, ts: b.ts }, `blobmeta:${b.id}`), d: await seal(b.data, `blob:${b.id}`) };
    await wrap((await store("blobs", "readwrite")).put(row));
  },
  async loadMembers(srv: string): Promise<Member[]> {
    const rows = (await wrap((await store("members")).index("srv").getAll(srv))) as EncMember[];
    const out: Member[] = [];
    for (const r of rows) {
      try {
        out.push(await openJson<Member>(r.d, `mem:${srv}:${r.pub}`));
      } catch {
        /* ignora */
      }
    }
    return out;
  },
  async putMember(m: Member) {
    const row: EncMember = { srv: m.srv, pub: m.pub, d: await sealJson(m, `mem:${m.srv}:${m.pub}`) };
    await wrap((await store("members", "readwrite")).put(row));
  },
};
