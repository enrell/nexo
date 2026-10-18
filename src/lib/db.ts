/**
 * Banco local (IndexedDB). Sem o limite de ~5 MB do localStorage, então aguenta
 * histórico longo e anexos (imagens/arquivos).
 */
import type { Member, StoredEvent } from "./types";

const DB_NAME = "nexo";
const VERSION = 1;

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const ev = db.createObjectStore("events", { keyPath: "id" });
      ev.createIndex("srv", "srv");
      db.createObjectStore("blobs", { keyPath: "id" });
      const m = db.createObjectStore("members", { keyPath: ["srv", "pub"] });
      m.createIndex("srv", "srv");
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
  return (await open()).transaction(name, mode).objectStore(name);
}

export type BlobRecord = { id: string; data: ArrayBuffer; mime: string; name: string; ts: number };

export const db = {
  async loadEvents(srv: string): Promise<StoredEvent[]> {
    return wrap((await store("events")).index("srv").getAll(srv)) as Promise<StoredEvent[]>;
  },
  async putEvents(evs: StoredEvent[]) {
    if (!evs.length) return;
    const tx = (await open()).transaction("events", "readwrite");
    const st = tx.objectStore("events");
    for (const e of evs) st.put(e);
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  },
  async deleteServer(srv: string) {
    const st = await store("events", "readwrite");
    const keys = await wrap(st.index("srv").getAllKeys(srv));
    const st2 = await store("events", "readwrite");
    for (const k of keys) st2.delete(k);
    const ms = await store("members", "readwrite");
    const mkeys = await wrap(ms.index("srv").getAllKeys(srv));
    const ms2 = await store("members", "readwrite");
    for (const k of mkeys) ms2.delete(k);
  },
  async getBlob(id: string): Promise<BlobRecord | undefined> {
    return wrap((await store("blobs")).get(id)) as Promise<BlobRecord | undefined>;
  },
  async putBlob(b: BlobRecord) {
    await wrap((await store("blobs", "readwrite")).put(b));
  },
  async loadMembers(srv: string): Promise<Member[]> {
    return wrap((await store("members")).index("srv").getAll(srv)) as Promise<Member[]>;
  },
  async putMember(m: Member) {
    await wrap((await store("members", "readwrite")).put(m));
  },
};
