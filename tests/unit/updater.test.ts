import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

type Update = { status: string; version?: string; percent?: number; message?: string };
const req = createRequire(import.meta.url);
const { setupUpdater, friendly, FIRST_CHECK_MS, CHECK_EVERY_MS } = req("../../electron/updater.cjs") as {
  setupUpdater: (d: Record<string, unknown>) => { check: () => Promise<void>; getState: () => Update };
  friendly: (e: unknown) => string;
  FIRST_CHECK_MS: number;
  CHECK_EVERY_MS: number;
};
const { signUpdate, verifyUpdate } = req("../../electron/updatesig.cjs") as {
  signUpdate: (pem: string, v: string, sha: string) => string;
  verifyUpdate: (i: unknown, f: string, k: string[]) => Promise<string | null>;
};

class FakeUpdater extends EventEmitter {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  allowDowngrade = true;
  allowPrerelease = true;
  disableWebInstaller = false;
  verifyUpdateCodeSignature: (names: string[], file: string) => Promise<string | null> = async () => null;
  checkForUpdates = vi.fn(async () => undefined);
  quitAndInstall = vi.fn();
}

function setup(over: Record<string, unknown> = {}) {
  const au = new FakeUpdater();
  const sent: Update[] = [];
  const ipc = new Map<string, () => unknown>();
  const timers = { setTimeout: vi.fn(), setInterval: vi.fn() };
  const beforeQuit = vi.fn();
  const log = { warn: vi.fn() };
  const ctl = setupUpdater({ autoUpdater: au, send: (_c: string, s: Update) => sent.push(s), handle: (c: string, fn: () => unknown) => ipc.set(c, fn), beforeQuit, timers, log, ...over });
  return { au, sent, ipc, timers, beforeQuit, log, ctl };
}

describe("configuração do autoUpdater", () => {
  it("baixa sozinho, instala ao fechar, nunca rebaixa nem pega pré-lançamento, sem instalador web", () => {
    const { au } = setup();
    expect(au).toMatchObject({ autoDownload: true, autoInstallOnAppQuit: true, allowDowngrade: false, allowPrerelease: false, disableWebInstaller: true });
  });

  it("procura 10 s depois de abrir e a cada 4 h", () => {
    const { timers, ctl } = setup();
    expect(timers.setTimeout).toHaveBeenCalledWith(ctl.check, FIRST_CHECK_MS);
    expect(timers.setInterval).toHaveBeenCalledWith(ctl.check, CHECK_EVERY_MS);
    expect(FIRST_CHECK_MS).toBe(10_000);
    expect(CHECK_EVERY_MS).toBe(4 * 3600_000);
  });
});

describe("estados que a interface recebe", () => {
  it("fluxo completo: procurando → baixando (com progresso) → pronta", () => {
    const { au, sent, ctl } = setup();
    au.emit("checking-for-update");
    au.emit("update-available", { version: "1.2.3" });
    au.emit("download-progress", { percent: 10.9 });
    au.emit("download-progress", { percent: 10.2 }); // mesmo número inteiro: não repete
    au.emit("download-progress", { percent: 55 });
    au.emit("update-downloaded", { version: "1.2.3" });
    expect(sent).toEqual([{ status: "checking" }, { status: "downloading", version: "1.2.3", percent: 0 }, { status: "downloading", version: "1.2.3", percent: 10 }, { status: "downloading", version: "1.2.3", percent: 55 }, { status: "ready", version: "1.2.3" }]);
    expect(ctl.getState()).toEqual({ status: "ready", version: "1.2.3" });
  });

  it("sem atualização", () => {
    const { au, sent } = setup();
    au.emit("update-not-available", { version: "1.0.0" });
    expect(sent).toEqual([{ status: "none" }]);
  });

  it("progresso fora da faixa ou sem número é contido em 0–100; progresso sem atualização conhecida é ignorado", () => {
    const { au, sent } = setup();
    au.emit("download-progress", { percent: 50 }); // ainda não houve update-available
    expect(sent).toEqual([]);
    au.emit("update-available", { version: "2.0.0" });
    au.emit("download-progress", { percent: 250 });
    au.emit("download-progress", { percent: -5 });
    au.emit("download-progress", {});
    au.emit("download-progress", undefined);
    expect(sent.map((s) => s.percent)).toEqual([0, 100, 0]);
  });
});

describe("erros em linguagem de gente", () => {
  it("assinatura recusada: diz que nada foi instalado", () => {
    expect(friendly({ code: "ERR_UPDATER_INVALID_SIGNATURE", message: "x" })).toMatch(/recusada.*Nada foi instalado/);
  });
  it("sem internet", () => {
    for (const e of [{ code: "ENOTFOUND" }, { message: "net::ERR_INTERNET_DISCONNECTED" }, { code: "ETIMEDOUT" }, { message: "getaddrinfo EAI_AGAIN github.com" }]) expect(friendly(e)).toBe("Sem conexão para procurar atualizações.");
  });
  it("outros: só a primeira linha, curta, sem pilha", () => {
    expect(friendly(new Error("falhou\n    at Object.<anonymous> (/home/x/y.js:1:1)"))).toBe("falhou");
    expect(friendly(new Error("x".repeat(500)))).toHaveLength(160);
    expect(friendly(undefined)).toBe("Falha ao atualizar.");
    expect(friendly("texto")).toBe("texto");
  });

  it("o evento de erro vira estado 'error' e libera nova tentativa", async () => {
    const { au, sent, log, ctl } = setup();
    au.checkForUpdates.mockImplementationOnce(async () => {
      au.emit("error", Object.assign(new Error("boom"), { code: "ENOTFOUND" }));
      throw new Error("boom");
    });
    await ctl.check();
    expect(sent.at(-1)).toEqual({ status: "error", message: "Sem conexão para procurar atualizações." });
    expect(log.warn).toHaveBeenCalled();
    await ctl.check(); // pode tentar de novo
    expect(au.checkForUpdates).toHaveBeenCalledTimes(2);
  });
});

describe("procurar", () => {
  it("não sobrepõe procuras, nem procura durante o download ou com atualização pronta", async () => {
    const { au, ctl } = setup();
    let release!: () => void;
    au.checkForUpdates.mockImplementationOnce(() => new Promise<undefined>((r) => (release = () => r(undefined))));
    const first = ctl.check();
    await ctl.check(); // ignorada: a primeira ainda não terminou
    expect(au.checkForUpdates).toHaveBeenCalledTimes(1);
    release();
    await first;
    au.emit("update-available", { version: "1.2.3" });
    await ctl.check();
    expect(au.checkForUpdates).toHaveBeenCalledTimes(1);
    au.emit("update-downloaded", { version: "1.2.3" });
    await ctl.check();
    expect(au.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it("rejeição do checkForUpdates não vira erro solto", async () => {
    const { au, ctl } = setup();
    au.checkForUpdates.mockRejectedValueOnce(new Error("rede"));
    await expect(ctl.check()).resolves.toBeUndefined();
  });

  it("o botão 'Procurar atualizações' usa o mesmo caminho", async () => {
    const { au, ipc } = setup();
    await ipc.get("nexo:check-update")!();
    expect(au.checkForUpdates).toHaveBeenCalledTimes(1);
  });
});

describe("instalar", () => {
  it("só instala o que já foi baixado e conferido; reinicia em silêncio e reabre o app", () => {
    const { au, ipc, beforeQuit } = setup();
    ipc.get("nexo:install-update")!();
    expect(au.quitAndInstall).not.toHaveBeenCalled(); // nada pronto
    au.emit("update-available", { version: "1.2.3" });
    ipc.get("nexo:install-update")!();
    expect(au.quitAndInstall).not.toHaveBeenCalled(); // ainda baixando
    au.emit("update-downloaded", { version: "1.2.3" });
    ipc.get("nexo:install-update")!();
    expect(beforeQuit).toHaveBeenCalledTimes(1);
    expect(au.quitAndInstall).toHaveBeenCalledWith(true, true);
  });
});

describe("verificação da assinatura do projeto no fluxo do updater", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nexo-upd-"));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  const pub = publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64");
  const bytes = crypto.randomBytes(10_000);
  const file = path.join(tmp, "Nexo-Setup-1.2.3.exe");
  fs.writeFileSync(file, bytes);
  const sha = crypto.createHash("sha512").update(bytes).digest("base64");
  const real = (info: unknown, f: string) => verifyUpdate(info, f, [pub]);

  beforeEach(() => fs.writeFileSync(file, bytes));

  it("o gancho usa o latest.yml da atualização que acabou de ser anunciada", async () => {
    const { au } = setup({ verify: real });
    au.emit("update-available", { version: "1.2.3", nexoSignature: signUpdate(pem, "1.2.3", sha) });
    expect(await au.verifyUpdateCodeSignature(["Nexo"], file)).toBeNull();
  });

  it("instalador trocado depois do anúncio: recusado", async () => {
    const { au } = setup({ verify: real });
    au.emit("update-available", { version: "1.2.3", nexoSignature: signUpdate(pem, "1.2.3", sha) });
    fs.writeFileSync(file, crypto.randomBytes(10_000));
    expect(await au.verifyUpdateCodeSignature(["Nexo"], file)).toMatch(/não confere/);
  });

  it("latest.yml sem assinatura: recusado", async () => {
    const { au } = setup({ verify: real });
    au.emit("update-available", { version: "1.2.3" });
    expect(await au.verifyUpdateCodeSignature(["Nexo"], file)).toMatch(/não traz a assinatura/);
  });

  it("sem nenhuma atualização anunciada, recusa (nunca aceita por padrão)", async () => {
    const { au } = setup({ verify: real });
    expect(await au.verifyUpdateCodeSignature(["Nexo"], file)).toMatch(/não traz a assinatura/);
  });

  it("com a verificação padrão do app (chaves embutidas), uma assinatura de outra chave é recusada", async () => {
    const { au } = setup(); // sem `verify`: usa PUBLIC_KEYS reais
    au.emit("update-available", { version: "1.2.3", nexoSignature: signUpdate(pem, "1.2.3", sha) });
    expect(await au.verifyUpdateCodeSignature(["Nexo"], file)).toMatch(/não confere/);
  });
});
