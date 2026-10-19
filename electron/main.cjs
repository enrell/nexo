const { app, BrowserWindow, Menu, Tray, desktopCapturer, globalShortcut, ipcMain, nativeImage, powerMonitor, protocol, safeStorage, session, shell } = require("electron");
const crypto = require("node:crypto");
const dns = require("node:dns");
const fs = require("node:fs");
const https = require("node:https");
const net = require("node:net");
const path = require("node:path");

const isDev = !app.isPackaged && process.env.NEXO_DEV === "1";
const DIST = path.join(__dirname, "..", "dist");
const ICON = path.join(__dirname, "..", "build", "icon.png");
const TRAY_ICON = path.join(__dirname, "..", "build", "tray.png");
// a interface é servida por um protocolo próprio (não file://): origem isolada e sem acesso a outros arquivos do disco
const APP_SCHEME = "nexo-app";
const APP_ORIGIN = `${APP_SCHEME}://app`;
const DEV_ORIGIN = "http://localhost:1420";

protocol.registerSchemesAsPrivileged([{ scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } }]);

if (process.platform === "win32") app.setAppUserModelId("com.nexo.app");

// links nexo://join/... abrem o app (só o app instalado se registra; o instalador também registra)
if (app.isPackaged) app.setAsDefaultProtocolClient("nexo");

// testes automatizados rodam várias instâncias com --user-data-dir próprio (nunca no app instalado)
const multiInstance = !app.isPackaged && process.argv.some((a) => a.startsWith("--user-data-dir"));
if (!multiInstance && !app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let win = null;
let tray = null;
let quitting = false;
let pendingUrl = process.argv.find((a) => a.startsWith("nexo://")) ?? null;
let pendingSource = null;
let config = { closeToTray: true, launchAtLogin: false, keyMute: "", keyDeafen: "", pttKey: "", zoom: 1 };

const appOrigin = () => (isDev ? DEV_ORIGIN : APP_ORIGIN);
const isAppUrl = (url) => typeof url === "string" && (url === appOrigin() || url.startsWith(appOrigin() + "/"));

function send(channel, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

/** Toda mensagem IPC precisa vir da nossa página (nunca de um frame/URL estranho). */
function trusted(e) {
  return e.senderFrame && isAppUrl(e.senderFrame.url) && e.sender === win?.webContents;
}
function handle(channel, fn) {
  ipcMain.handle(channel, (e, ...args) => {
    if (!trusted(e)) throw new Error("origem não confiável");
    return fn(...args);
  });
}
function on(channel, fn) {
  ipcMain.on(channel, (e, ...args) => {
    if (!trusted(e)) return;
    fn(...args);
  });
}

function showWindow() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 560,
    show: false, // só mostra quando a interface já desenhou (sem tela branca)
    backgroundColor: "#313338",
    title: "Nexo",
    icon: ICON,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      navigateOnDragDrop: false,
      safeDialogs: true,
      devTools: !app.isPackaged,
      backgroundThrottling: false, // live/voz não engasgam em segundo plano
      spellcheck: true,
    },
  });
  win.once("ready-to-show", () => win.show());

  const openExternal = (url) => {
    // só http(s); nada de file:, javascript:, ms-settings: etc.
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  };
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (isAppUrl(url)) return;
    e.preventDefault();
    openExternal(url);
  });
  win.webContents.on("will-redirect", (e, url) => !isAppUrl(url) && e.preventDefault());
  win.webContents.on("will-attach-webview", (e) => e.preventDefault());
  // corretor ortográfico: sugestões no clique direito dentro de campos de texto
  win.webContents.on("context-menu", (_e, p) => {
    if (!p.isEditable || !p.misspelledWord) return;
    const items = p.dictionarySuggestions.slice(0, 5).map((s) => ({ label: s, click: () => win.webContents.replaceMisspelling(s) }));
    if (items.length) Menu.buildFromTemplate(items).popup();
  });

  win.on("close", (e) => {
    if (!quitting && config.closeToTray && tray) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on("focus", () => win.flashFrame(false));

  win.loadURL(isDev ? DEV_ORIGIN : `${APP_ORIGIN}/index.html`);
  win.webContents.on("did-finish-load", () => win.webContents.setZoomFactor(config.zoom || 1));
}

function createTray() {
  if (tray) return;
  try {
    tray = new Tray(nativeImage.createFromPath(TRAY_ICON));
  } catch {
    return;
  }
  tray.setToolTip("Nexo");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Abrir Nexo", click: showWindow },
      { type: "separator" },
      { label: "Mutar / desmutar", click: () => send("nexo:tray", "mute") },
      { label: "Ensurdecer", click: () => send("nexo:tray", "deafen") },
      { type: "separator" },
      {
        label: "Sair",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("click", showWindow);
}

// ---------------------------------------------------------------- cofre (chave dos dados locais)

/**
 * Chave AES-256 que cifra tudo o que o Nexo guarda no disco. Ela própria fica
 * protegida pelo safeStorage (DPAPI no Windows, Keychain no macOS, libsecret no
 * Linux): só a sua conta de usuário, neste PC, consegue abri-la.
 */
const vaultFile = () => path.join(app.getPath("userData"), "vault.key");

function loadVaultKey() {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("O sistema não oferece armazenamento seguro de chaves (DPAPI/Keychain/libsecret).");
  const file = vaultFile();
  let sealed = null;
  try {
    sealed = fs.readFileSync(file);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  if (sealed) {
    const key = safeStorage.decryptString(sealed);
    if (!/^[A-Za-z0-9+/]{43}=$/.test(key)) throw new Error("Cofre corrompido.");
    return key;
  }
  const key = crypto.randomBytes(32).toString("base64");
  // "wx": falha se o arquivo aparecer no meio do caminho (nunca sobrescreve um cofre existente)
  fs.writeFileSync(file, safeStorage.encryptString(key), { mode: 0o600, flag: "wx" });
  return key;
}

async function resetVault() {
  try {
    fs.rmSync(vaultFile(), { force: true });
  } catch {
    /* ignore */
  }
  await session.defaultSession.clearStorageData();
  app.relaunch();
  app.exit(0);
}

// ---------------------------------------------------------------- atalhos globais e push-to-talk

let hook = null;
let pttCode = null;
let pttDown = false;

const CODE_ALIASES = {
  ControlLeft: "Ctrl",
  ControlRight: "CtrlRight",
  ShiftLeft: "Shift",
  ShiftRight: "ShiftRight",
  AltLeft: "Alt",
  AltRight: "AltRight",
  MetaLeft: "Meta",
  MetaRight: "MetaRight",
};

function uiohookCode(code) {
  if (!hook || typeof code !== "string") return null;
  const { UiohookKey } = hook;
  if (/^Mouse\d$/.test(code)) return code;
  let name = CODE_ALIASES[code] ?? code;
  if (/^Key[A-Z]$/.test(code)) name = code.slice(3);
  if (/^Digit\d$/.test(code)) name = code.slice(5);
  return Object.prototype.hasOwnProperty.call(UiohookKey, name) ? UiohookKey[name] : null;
}

function setupHook() {
  if (hook) return;
  try {
    hook = require("uiohook-napi");
    const { uIOhook } = hook;
    // só repassamos "a tecla de push-to-talk subiu/desceu" — nenhuma outra tecla sai do processo principal
    uIOhook.on("keydown", (e) => {
      if (pttCode !== null && e.keycode === pttCode && !pttDown) {
        pttDown = true;
        send("nexo:shortcut", "ptt", true);
      }
    });
    uIOhook.on("keyup", (e) => {
      if (pttCode !== null && e.keycode === pttCode) {
        pttDown = false;
        send("nexo:shortcut", "ptt", false);
      }
    });
    uIOhook.on("mousedown", (e) => {
      if (pttCode === "Mouse" + e.button) send("nexo:shortcut", "ptt", true);
    });
    uIOhook.on("mouseup", (e) => {
      if (pttCode === "Mouse" + e.button) send("nexo:shortcut", "ptt", false);
    });
    uIOhook.start();
    console.log("push-to-talk global ativo");
  } catch (e) {
    console.error("push-to-talk global indisponível:", e);
    hook = null;
  }
}

function applyConfig() {
  globalShortcut.unregisterAll();
  for (const [name, acc] of [
    ["mute", config.keyMute],
    ["deafen", config.keyDeafen],
  ]) {
    if (!acc || typeof acc !== "string" || acc.length > 60) continue;
    try {
      globalShortcut.register(acc, () => send("nexo:shortcut", name, true));
    } catch (e) {
      console.warn("atalho inválido", acc, e.message);
    }
  }
  if (config.pttKey) {
    setupHook();
    pttCode = uiohookCode(config.pttKey);
  } else pttCode = null;

  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!config.launchAtLogin, args: ["--hidden"] });
  const zoom = Number(config.zoom);
  if (win && zoom >= 0.5 && zoom <= 2) win.webContents.setZoomFactor(zoom);
}

// ---------------------------------------------------------------- atualização automática

function setupUpdater() {
  if (!app.isPackaged) return;
  let autoUpdater;
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch {
    return;
  }
  // baixa só por HTTPS do GitHub Releases e confere o SHA-512 publicado no latest.yml
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.on("update-available", (i) => send("nexo:update", { status: "downloading", version: i.version }));
  autoUpdater.on("update-downloaded", (i) => send("nexo:update", { status: "ready", version: i.version }));
  autoUpdater.on("error", (e) => console.warn("updater:", e?.message));
  const check = () => autoUpdater.checkForUpdates().catch((e) => console.warn("updater:", e?.message));
  setTimeout(check, 10_000);
  setInterval(check, 4 * 60 * 60 * 1000);
  handle("nexo:install-update", () => {
    quitting = true;
    autoUpdater.quitAndInstall();
  });
}

// ---------------------------------------------------------------- inicialização

app.on("second-instance", (_e, argv) => {
  const url = argv.find((a) => a.startsWith("nexo://"));
  if (url) send("nexo:open-url", url);
  showWindow();
});
app.on("open-url", (e, url) => {
  e.preventDefault();
  if (win) send("nexo:open-url", url);
  else pendingUrl = url;
});

// nenhum conteúdo além da nossa janela, nenhum webview, nenhuma navegação para fora
app.on("web-contents-created", (_e, contents) => {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-attach-webview", (e) => e.preventDefault());
});

app.whenReady().then(() => {
  const ses = session.defaultSession;

  const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".woff2": "font/woff2" };
  protocol.handle(APP_SCHEME, async (req) => {
    const url = new URL(req.url);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
    const file = path.resolve(DIST, rel);
    // só arquivos dentro de dist/ (nada de ../ para fora)
    if (url.host !== "app" || !file.startsWith(DIST + path.sep)) return new Response("não encontrado", { status: 404 });
    try {
      const body = await fs.promises.readFile(file);
      return new Response(body, { headers: { "content-type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream", "x-content-type-options": "nosniff" } });
    } catch {
      return new Response("não encontrado", { status: 404 });
    }
  });

  // permissões: só a nossa página, e só o que o app usa
  const ALLOWED = new Set(["media", "display-capture", "notifications", "clipboard-sanitized-write", "fullscreen"]);
  ses.setPermissionRequestHandler((wc, permission, cb, details) => {
    cb(wc === win?.webContents && isAppUrl(details.requestingUrl ?? wc.getURL()) && ALLOWED.has(permission));
  });
  ses.setPermissionCheckHandler((wc, permission, origin) => !!wc && wc === win?.webContents && isAppUrl(origin) && ALLOWED.has(permission));
  ses.setDevicePermissionHandler(() => false); // HID/USB/serial: nunca
  ses.setSpellCheckerLanguages(["pt-BR", "en-US"]);
  // a página nunca carrega nada fora do app, exceto: relays Nostr (wss), prévias/imagens https (opt-in) e o servidor de dev
  ses.webRequest.onBeforeRequest((details, cb) => {
    const u = details.url;
    const ok = u.startsWith(APP_SCHEME + ":") || u.startsWith("wss:") || u.startsWith("https:") || u.startsWith("data:") || u.startsWith("blob:") || u.startsWith("devtools:") || (isDev && (u.startsWith(DEV_ORIGIN) || u.startsWith("ws://localhost:1420")));
    cb({ cancel: !ok });
  });

  ses.setDisplayMediaRequestHandler(async (_req, cb) => {
    try {
      let source = pendingSource;
      pendingSource = null;
      if (!source) {
        const [screen] = await desktopCapturer.getSources({ types: ["screen"] });
        source = { id: screen.id, audio: true };
      }
      const all = await desktopCapturer.getSources({ types: ["screen", "window"] });
      const video = all.find((s) => s.id === source.id);
      if (!video) return cb({});
      cb(source.audio && process.platform === "win32" ? { video, audio: "loopback" } : { video });
    } catch (e) {
      console.error(e);
      cb({});
    }
  });

  handle("nexo:sources", async () => {
    const sources = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: true });
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      isScreen: s.id.startsWith("screen:"),
      thumbnail: s.thumbnail.toDataURL(),
      icon: s.appIcon ? s.appIcon.toDataURL() : null,
    }));
  });
  handle("nexo:select-source", (id, audio) => {
    if (typeof id === "string" && /^(screen|window):[\w:-]+$/.test(id)) pendingSource = { id, audio: !!audio };
  });
  handle("nexo:pending-url", () => {
    const u = pendingUrl;
    pendingUrl = null;
    return u;
  });
  handle("nexo:vault-key", loadVaultKey);
  handle("nexo:vault-reset", resetVault);
  handle("nexo:idle", () => powerMonitor.getSystemIdleTime());
  handle("nexo:version", () => app.getVersion());
  handle("nexo:preview", (url) => fetchPreview(url));
  ipcMain.on("nexo:debug", (e) => {
    // ganchos de teste/depuração só fora do app instalado
    e.returnValue = trusted(e) && !app.isPackaged;
  });
  on("nexo:config", (c) => {
    if (!c || typeof c !== "object") return;
    config = {
      closeToTray: !!c.closeToTray,
      launchAtLogin: !!c.launchAtLogin,
      keyMute: String(c.keyMute ?? ""),
      keyDeafen: String(c.keyDeafen ?? ""),
      pttKey: String(c.pttKey ?? ""),
      zoom: Number(c.zoom) || 1,
    };
    applyConfig();
  });
  on("nexo:focus", showWindow);
  on("nexo:badge", (count, dataUrl) => {
    if (!win) return;
    const n = Number(count) || 0;
    if (process.platform === "win32") {
      const img = n && typeof dataUrl === "string" && dataUrl.startsWith("data:image/png;base64,") ? nativeImage.createFromDataURL(dataUrl) : null;
      win.setOverlayIcon(img, n ? "mensagens não lidas" : "");
      if (n > 0 && !win.isFocused()) win.flashFrame(true);
    } else app.setBadgeCount(Math.max(0, n));
    tray?.setToolTip(n ? "Nexo — mensagens novas" : "Nexo");
  });

  createWindow();
  createTray();
  setupUpdater();
  if (process.argv.includes("--hidden")) win.once("ready-to-show", () => win.hide());
  app.on("activate", showWindow);
});

app.on("before-quit", () => {
  quitting = true;
  globalShortcut.unregisterAll();
  try {
    hook?.uIOhook.stop();
  } catch {
    /* ignore */
  }
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ---------------------------------------------------------------- prévia de links (opt-in), protegida contra SSRF

/** Endereços que nunca podem ser acessados (rede local, loopback, link-local, CGNAT, multicast…). */
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivateIp(v.slice(7));
  return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb") || v.startsWith("ff");
}

// resolve o DNS e recusa IP privado no momento da conexão (evita DNS rebinding)
function safeLookup(hostname, options, cb) {
  dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return cb(err);
    const list = addrs.filter((a) => !isPrivateIp(a.address));
    if (!list.length) return cb(new Error("endereço bloqueado"));
    if (options.all) cb(null, list);
    else cb(null, list[0].address, list[0].family);
  });
}

function getHtml(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    if (u.protocol !== "https:" || net.isIP(u.hostname.replace(/^\[|\]$/g, "")) || u.port) return reject(new Error("url não permitida"));
    const req = https.get(u, { lookup: safeLookup, timeout: 6000, headers: { "user-agent": "Mozilla/5.0 (compatible; NexoPreview/1.0)", accept: "text/html" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirects >= 3) return reject(new Error("redirecionamentos demais"));
        return resolve(getHtml(new URL(res.headers.location, u).toString(), redirects + 1));
      }
      if (res.statusCode !== 200 || !String(res.headers["content-type"] ?? "").includes("text/html")) {
        res.resume();
        return reject(new Error("sem html"));
      }
      let size = 0;
      const chunks = [];
      res.on("data", (c) => {
        size += c.length;
        if (size > 512 * 1024) return req.destroy();
        chunks.push(c);
      });
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

const previewCache = new Map();
async function fetchPreview(url) {
  if (typeof url !== "string" || url.length > 2048 || !/^https:\/\//i.test(url)) return null;
  if (previewCache.has(url)) return previewCache.get(url);
  let result = null;
  try {
    const html = await getHtml(url);
    const meta = (prop) => {
      const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, "i");
      const m = html.match(re);
      return m ? decode(m[1] ?? m[2]) : null;
    };
    const title = meta("og:title") ?? meta("twitter:title") ?? decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "");
    if (title) {
      let image = meta("og:image") ?? meta("twitter:image");
      if (image) {
        image = new URL(image, url).toString();
        if (!image.startsWith("https://")) image = null;
      }
      result = { title: title.slice(0, 200), description: (meta("og:description") ?? meta("description") ?? "").slice(0, 300), image, site: (meta("og:site_name") ?? new URL(url).hostname).slice(0, 80) };
    }
  } catch {
    /* sem prévia */
  }
  if (previewCache.size > 500) previewCache.clear();
  previewCache.set(url, result);
  return result;
}

function decode(s) {
  // &amp; por último: "&amp;lt;" vira "&lt;" (texto), não "<"
  return String(s)
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}
