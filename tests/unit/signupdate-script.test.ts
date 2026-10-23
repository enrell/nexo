import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterAll, describe, expect, it } from "vitest";

const { verifyUpdate } = createRequire(import.meta.url)("../../electron/updatesig.cjs") as { verifyUpdate: (i: unknown, f: string, k: string[]) => Promise<string | null> };
const script = path.resolve(__dirname, "../../scripts/sign-update.mjs");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "nexo-sign-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const pair = () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return { pem: privateKey.export({ type: "pkcs8", format: "pem" }) as string, pub: publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64") };
};
const K = pair();

/** Pasta de release como o electron-builder deixa: instalador + latest.yml. */
function release(over: { yml?: (sha: string) => string; bytes?: Buffer } = {}) {
  const dir = fs.mkdtempSync(path.join(root, "r-"));
  const bytes = over.bytes ?? crypto.randomBytes(5000);
  fs.writeFileSync(path.join(dir, "Nexo-Setup-1.2.3.exe"), bytes);
  const sha = crypto.createHash("sha512").update(bytes).digest("base64");
  const yml = over.yml?.(sha) ?? `version: 1.2.3\nfiles:\n  - url: Nexo-Setup-1.2.3.exe\n    sha512: ${sha}\n    size: ${bytes.length}\npath: Nexo-Setup-1.2.3.exe\nsha512: ${sha}\nreleaseDate: '2026-10-23T00:00:00.000Z'\n`;
  fs.writeFileSync(path.join(dir, "latest.yml"), yml);
  return { dir, yml: path.join(dir, "latest.yml"), exe: path.join(dir, "Nexo-Setup-1.2.3.exe"), sha };
}
const run = (yml: string, env: Record<string, string | undefined> = { UPDATE_SIGNING_KEY: K.pem, UPDATE_PUBLIC_KEYS: K.pub }) =>
  spawnSync(process.execPath, [script, yml], { env: { PATH: process.env.PATH, ...env } as NodeJS.ProcessEnv, encoding: "utf8" });

describe("scripts/sign-update.mjs (roda no CI)", () => {
  it("assina o latest.yml e o resultado passa na verificação do app", async () => {
    const r = release();
    const out = run(r.yml);
    expect(out.status, out.stderr).toBe(0);
    const text = fs.readFileSync(r.yml, "utf8");
    const signature = text.match(/^nexoSignature: (\S+)$/m)?.[1];
    expect(signature).toBeTruthy();
    expect(text).toContain("version: 1.2.3"); // o resto do arquivo continua igual
    expect(await verifyUpdate({ version: "1.2.3", nexoSignature: signature }, r.exe, [K.pub])).toBeNull();
  });

  it("recusa assinar duas vezes", () => {
    const r = release();
    expect(run(r.yml).status).toBe(0);
    const again = run(r.yml);
    expect(again.status).toBe(1);
    expect(again.stderr).toMatch(/já está assinado/);
  });

  it("recusa se o instalador não bate com o sha512 do latest.yml (e não altera o arquivo)", () => {
    const r = release();
    fs.writeFileSync(r.exe, crypto.randomBytes(5000));
    const before = fs.readFileSync(r.yml, "utf8");
    const out = run(r.yml);
    expect(out.status).toBe(1);
    expect(out.stderr).toMatch(/não bate com o sha512/);
    expect(fs.readFileSync(r.yml, "utf8")).toBe(before);
  });

  it("segredo com a chave errada é pego antes de publicar (ninguém conseguiria atualizar)", () => {
    const r = release();
    const before = fs.readFileSync(r.yml, "utf8");
    const out = run(r.yml, { UPDATE_SIGNING_KEY: pair().pem, UPDATE_PUBLIC_KEYS: K.pub });
    expect(out.status).toBe(1);
    expect(out.stderr).toMatch(/não seria aceita pelo app/);
    expect(fs.readFileSync(r.yml, "utf8")).toBe(before);
  });

  it("sem o segredo ou sem o arquivo, falha com mensagem clara", () => {
    const r = release();
    expect(run(r.yml, { UPDATE_PUBLIC_KEYS: K.pub }).stderr).toMatch(/UPDATE_SIGNING_KEY/);
    const none = spawnSync(process.execPath, [script], { env: { PATH: process.env.PATH, UPDATE_SIGNING_KEY: K.pem } as NodeJS.ProcessEnv, encoding: "utf8" });
    expect(none.status).toBe(1);
  });

  it("latest.yml adulterado ou incompleto é recusado", () => {
    for (const [name, yml] of [
      ["versão inválida", (s: string) => `version: 1.2\npath: Nexo-Setup-1.2.3.exe\nsha512: ${s}\n`],
      ["sem sha512", () => `version: 1.2.3\npath: Nexo-Setup-1.2.3.exe\n`],
      ["sem path", (s: string) => `version: 1.2.3\nsha512: ${s}\n`],
    ] as const) {
      const r = release({ yml });
      const out = run(r.yml);
      expect(out.status, name).toBe(1);
      expect(fs.readFileSync(r.yml, "utf8"), name).not.toContain("nexoSignature");
    }
  });

  it("path que sai da pasta é recusado mesmo que o arquivo exista e o hash bata", () => {
    const bytes = crypto.randomBytes(3000);
    const sha = crypto.createHash("sha512").update(bytes).digest("base64");
    const dir = fs.mkdtempSync(path.join(root, "t-"));
    const sub = path.join(dir, "release");
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(dir, "fora.exe"), bytes); // fora da pasta da release, com o hash certo
    fs.writeFileSync(path.join(sub, "latest.yml"), `version: 1.2.3\npath: ../fora.exe\nsha512: ${sha}\n`);
    const out = run(path.join(sub, "latest.yml"));
    expect(out.status).toBe(1);
    expect(out.stderr).toMatch(/path inesperado/);
    expect(fs.readFileSync(path.join(sub, "latest.yml"), "utf8")).not.toContain("nexoSignature");
  });

  it("aceita valores entre aspas (como o electron-builder às vezes grava)", async () => {
    const r = release({ yml: (s) => `version: '1.2.3'\npath: "Nexo-Setup-1.2.3.exe"\nsha512: ${s}\n` });
    expect(run(r.yml).status).toBe(0);
  });
});
