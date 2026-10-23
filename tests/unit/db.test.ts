import "fake-indexeddb/auto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../../src/lib/db";
import type { Member, StoredEvent } from "../../src/lib/types";
import { initVault } from "../../src/lib/vault";

beforeAll(initVault);

const event = (srv: string, id: string, text: string): StoredEvent => ({ id, a: "A".repeat(43), ts: 1, b: { k: "msg", ch: "geral", text }, s: "sig", srv });
const member = (srv: string, pub: string, name: string): Member => ({ srv, pub, name, color: "#fff", lastSeen: 1 });

/** Lê as linhas como estão no disco (sem passar pelo cofre). */
function raw<T>(storeName: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("nexo-secure");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const req = open.result.transaction(storeName).objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result as T[]);
      req.onerror = () => reject(req.error);
    };
  });
}
function rawPut(storeName: string, row: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("nexo-secure");
    open.onsuccess = () => {
      const tx = open.result.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put(row);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
  });
}

describe("banco local cifrado", () => {
  it("eventos vão e voltam, separados por servidor", async () => {
    await db.putEvents([event("s1", "e1", "um"), event("s1", "e2", "dois"), event("s2", "e3", "tres")]);
    expect((await db.loadEvents("s1")).map((e) => e.id).sort()).toEqual(["e1", "e2"]);
    expect((await db.loadEvents("s2")).map((e) => (e.b as { text: string }).text)).toEqual(["tres"]);
    expect(await db.loadEvents("nenhum")).toEqual([]);
    await db.putEvents([]); // lista vazia não faz nada
  });

  it("regravar o mesmo evento atualiza (ex.: pendente → entregue)", async () => {
    await db.putEvents([{ ...event("s3", "e1", "x"), pending: true }]);
    await db.putEvents([event("s3", "e1", "x")]);
    const [e] = await db.loadEvents("s3");
    expect(e.pending).toBeUndefined();
  });

  it("no disco não aparece texto, autor nem nome: só ids de índice e bytes cifrados", async () => {
    await db.putEvents([event("s4", "e-segredo", "texto-secreto-reconhecivel")]);
    await db.putMember(member("s4", "pub-reconhecivel", "Nome-Reconhecivel"));
    await db.putBlob({ id: "b-segredo", data: new TextEncoder().encode("conteudo-do-arquivo-reconhecivel").buffer as ArrayBuffer, mime: "image/png", name: "foto-reconhecivel.png", ts: 1 });
    const dump = JSON.stringify([...(await raw<object>("events")), ...(await raw<object>("members")), ...(await raw<object>("blobs"))], (_k, v) => (v instanceof Uint8Array ? Buffer.from(v).toString("latin1") : v));
    for (const s of ["texto-secreto", "Nome-Reconhecivel", "conteudo-do-arquivo", "foto-reconhecivel", "image/png", "sig"]) expect(dump, s).not.toContain(s);
  });

  it("linha adulterada é ignorada, as outras continuam", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await db.putEvents([event("s5", "ok", "bom"), event("s5", "ruim", "vai ser adulterado")]);
    const row = (await raw<{ id: string; srv: string; d: Uint8Array }>("events")).find((r) => r.id === "ruim")!;
    const d = new Uint8Array(row.d);
    d[20] ^= 1;
    await rawPut("events", { ...row, d });
    expect((await db.loadEvents("s5")).map((e) => e.id)).toEqual(["ok"]);
  });

  it("linha copiada para outro id/servidor não é aceita (AAD)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await db.putEvents([event("s6", "alvo", "mensagem real")]);
    const row = (await raw<{ id: string; srv: string; d: Uint8Array }>("events")).find((r) => r.id === "alvo")!;
    await rawPut("events", { id: "clone", srv: "s6", d: row.d }); // mesmo conteúdo cifrado, id diferente
    await rawPut("events", { id: "clone2", srv: "s7", d: row.d }); // servidor diferente
    expect((await db.loadEvents("s6")).map((e) => e.id)).toEqual(["alvo"]);
    expect(await db.loadEvents("s7")).toEqual([]);
  });

  it("membros vão e voltam; regravar atualiza", async () => {
    await db.putMember(member("s8", "p1", "Ana"));
    await db.putMember(member("s8", "p2", "Bia"));
    await db.putMember({ ...member("s8", "p1", "Ana Maria"), lastSeen: 9 });
    const list = await db.loadMembers("s8");
    expect(list.map((m) => m.name).sort()).toEqual(["Ana Maria", "Bia"]);
    expect(await db.loadMembers("outro")).toEqual([]);
  });

  it("anexos: dados e metadados vão e voltam; inexistente dá undefined", async () => {
    const data = Uint8Array.from([1, 2, 3, 4, 5]).buffer as ArrayBuffer;
    await db.putBlob({ id: "b1", data, mime: "image/png", name: "a.png", ts: 7 });
    expect(await db.hasBlob("b1")).toBe(true);
    expect(await db.hasBlob("nao-existe")).toBe(false);
    const got = (await db.getBlob("b1"))!;
    expect(new Uint8Array(got.data)).toEqual(new Uint8Array(data));
    expect(got).toMatchObject({ id: "b1", mime: "image/png", name: "a.png", ts: 7 });
    expect(await db.getBlob("nao-existe")).toBeUndefined();
  });

  it("anexo adulterado ou trocado de lugar vira 'não tenho' (nunca devolve dado errado)", async () => {
    await db.putBlob({ id: "bx", data: Uint8Array.from([9, 9, 9]).buffer as ArrayBuffer, mime: "x/y", name: "x", ts: 1 });
    const row = (await raw<{ id: string; meta: Uint8Array; d: Uint8Array }>("blobs")).find((r) => r.id === "bx")!;
    await rawPut("blobs", { ...row, id: "by" });
    expect(await db.getBlob("by")).toBeUndefined();
    const d = new Uint8Array(row.d);
    d[14] ^= 1;
    await rawPut("blobs", { ...row, d });
    expect(await db.getBlob("bx")).toBeUndefined();
  });

  it("apagar o servidor remove eventos e membros dele, e só dele", async () => {
    await db.putEvents([event("sa", "x1", "a"), event("sb", "x2", "b")]);
    await db.putMember(member("sa", "p", "A"));
    await db.putMember(member("sb", "p", "B"));
    await db.deleteServer("sa");
    await new Promise((r) => setTimeout(r, 20));
    expect(await db.loadEvents("sa")).toEqual([]);
    expect(await db.loadMembers("sa")).toEqual([]);
    expect((await db.loadEvents("sb")).length).toBe(1);
    expect((await db.loadMembers("sb")).length).toBe(1);
  });
});
