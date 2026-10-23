/**
 * Atualização automática (estilo Discord): confere em segundo plano, baixa só a diferença (blockmap),
 * confere a assinatura do projeto e deixa pronto; o app reinicia sozinho, em silêncio, quando o usuário
 * aceita (ou instala ao fechar). Sem janela de instalador.
 *
 * Recebe as dependências (autoUpdater, envio de mensagens, IPC) para poder ser testado com um autoUpdater falso.
 */
const { verifyUpdate } = require("./updatesig.cjs");

const FIRST_CHECK_MS = 10_000;
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

/** Mensagem curta e sem detalhes internos para mostrar ao usuário. */
function friendly(e) {
  const code = e?.code ?? "";
  if (code === "ERR_UPDATER_INVALID_SIGNATURE") return "A atualização foi recusada: a assinatura do projeto não confere. Nada foi instalado.";
  if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|ECONNREFUSED|ERR_INTERNET|ERR_NETWORK|EAI_AGAIN/i.test(`${code} ${e?.message}`)) return "Sem conexão para procurar atualizações.";
  const text = typeof e === "string" ? e : typeof e?.message === "string" ? e.message : "";
  return text.split("\n")[0].slice(0, 160) || "Falha ao atualizar.";
}

/**
 * @param {object} d
 * @param {import("electron-updater").AppUpdater} d.autoUpdater
 * @param {(channel: string, ...args: unknown[]) => void} d.send  envia para a janela
 * @param {(channel: string, fn: Function) => void} d.handle  registra IPC (só da nossa página)
 * @param {() => void} d.beforeQuit  avisa o app que o fechamento é para instalar (não vai para a bandeja)
 * @param {(info: unknown, file: string) => Promise<string | null>} [d.verify]
 * @param {{ setTimeout: Function, setInterval: Function }} [d.timers]
 */
function setupUpdater({ autoUpdater, send, handle, beforeQuit, verify = verifyUpdate, timers = { setTimeout, setInterval }, log = console }) {
  let lastInfo = null;
  let state = { status: "idle" };
  let checking = false;
  let lastPercent = -1;

  const publish = (s) => {
    state = s;
    send("nexo:update", s);
  };

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true; // fechar o app instala em silêncio o que já foi baixado e conferido
  autoUpdater.allowDowngrade = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.disableWebInstaller = true;
  // o instalador não tem assinatura da Microsoft: a confiança vem da chave do projeto (electron/updatesig.cjs).
  // O electron-updater só chama este gancho quando o app-update.yml tem `publisherName` (ver package.json).
  autoUpdater.verifyUpdateCodeSignature = (_publisherNames, file) => verify(lastInfo, file);

  autoUpdater.on("checking-for-update", () => publish({ status: "checking" }));
  autoUpdater.on("update-available", (info) => {
    lastInfo = info;
    lastPercent = -1;
    publish({ status: "downloading", version: info.version, percent: 0 });
  });
  autoUpdater.on("download-progress", (p) => {
    const percent = Math.max(0, Math.min(100, Math.floor(p?.percent ?? 0)));
    if (percent === lastPercent || !lastInfo) return;
    lastPercent = percent;
    publish({ status: "downloading", version: lastInfo.version, percent });
  });
  autoUpdater.on("update-not-available", () => publish({ status: "none" }));
  autoUpdater.on("update-downloaded", (info) => publish({ status: "ready", version: info.version }));
  autoUpdater.on("error", (e) => {
    log.warn("updater:", e?.message);
    checking = false;
    publish({ status: "error", message: friendly(e) });
  });

  async function check() {
    if (checking || state.status === "downloading" || state.status === "ready") return;
    checking = true;
    try {
      await autoUpdater.checkForUpdates();
    } catch (e) {
      // o evento "error" já avisou; aqui só garantimos que não vira rejeição solta
      log.warn("updater:", e?.message);
    } finally {
      checking = false;
    }
  }

  handle("nexo:check-update", check);
  handle("nexo:install-update", () => {
    if (state.status !== "ready") return; // só instala o que já foi baixado e conferido
    beforeQuit();
    autoUpdater.quitAndInstall(true, true); // silencioso e reabre o app
  });

  timers.setTimeout(check, FIRST_CHECK_MS);
  timers.setInterval(check, CHECK_EVERY_MS);
  return { check, getState: () => state };
}

module.exports = { setupUpdater, friendly, FIRST_CHECK_MS, CHECK_EVERY_MS };
