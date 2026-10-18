const { app, BrowserWindow, Menu, Tray, desktopCapturer, globalShortcut, ipcMain, nativeImage, net, powerMonitor, session, shell } = require("electron");
const path = require("node:path");

const isDev = !app.isPackaged && process.env.NEXO_DEV === "1";
const ICON = path.join(__dirname, "..", "build", "icon.png");
const TRAY_ICON = path.join(__dirname, "..", "build", "tray.png");

// Windows: notificações agrupadas com o nome certo
if (process.platform === "win32") app.setAppUserModelId("com.nexo.app");

// links nexo://join/... abrem o app
if (process.defaultApp && process.argv.length >= 2) app.setAsDefaultProtocolClient("nexo", process.execPath, [path.resolve(process.argv[1])]);
else app.setAsDefaultProtocolClient("nexo");

// testes automatizados rodam várias instâncias com --user-data-dir próprio
const multiInstance = process.argv.some((a) => a.startsWith("--user-data-dir"));
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

function send(channel, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
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
      backgroundThrottling: false, // live/voz não engasgam em segundo plano
      spellcheck: true,
    },
  });
  win.once("ready-to-show", () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("http://localhost:1420") && !url.startsWith("file://")) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });
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

  if (isDev) win.loadURL("http://localhost:1420");
  else win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
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
  if (!hook) return null;
  const { UiohookKey } = hook;
  if (/^Mouse\d$/.test(code)) return code;
  let name = CODE_ALIASES[code] ?? code;
  if (/^Key[A-Z]$/.test(code)) name = code.slice(3);
  if (/^Digit\d$/.test(code)) name = code.slice(5);
  return UiohookKey[name] ?? null;
}

function setupHook() {
  if (hook) return;
  try {
    hook = require("uiohook-napi");
    const { uIOhook } = hook;
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
    if (!acc) continue;
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
  if (win) win.webContents.setZoomFactor(config.zoom || 1);
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
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("update-available", (i) => send("nexo:update", { status: "downloading", version: i.version }));
  autoUpdater.on("update-downloaded", (i) => send("nexo:update", { status: "ready", version: i.version }));
  autoUpdater.on("error", (e) => console.warn("updater:", e?.message));
  const check = () => autoUpdater.checkForUpdates().catch((e) => console.warn("updater:", e?.message));
  setTimeout(check, 10_000);
  setInterval(check, 4 * 60 * 60 * 1000);
  ipcMain.handle("nexo:install-update", () => {
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

app.whenReady().then(() => {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(["media", "display-capture", "notifications", "clipboard-sanitized-write", "clipboard-read", "fullscreen"].includes(permission));
  });
  ses.setPermissionCheckHandler(() => true);
  ses.setSpellCheckerLanguages(["pt-BR", "en-US"]);

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

  ipcMain.handle("nexo:sources", async () => {
    const sources = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: true });
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      isScreen: s.id.startsWith("screen:"),
      thumbnail: s.thumbnail.toDataURL(),
      icon: s.appIcon ? s.appIcon.toDataURL() : null,
    }));
  });
  ipcMain.handle("nexo:select-source", (_e, id, audio) => {
    pendingSource = { id, audio: !!audio };
  });
  ipcMain.handle("nexo:pending-url", () => {
    const u = pendingUrl;
    pendingUrl = null;
    return u;
  });
  ipcMain.handle("nexo:idle", () => powerMonitor.getSystemIdleTime());
  ipcMain.handle("nexo:version", () => app.getVersion());
  ipcMain.on("nexo:config", (_e, c) => {
    config = { ...config, ...c };
    applyConfig();
  });
  ipcMain.on("nexo:focus", showWindow);
  ipcMain.on("nexo:badge", (_e, count, dataUrl) => {
    if (!win) return;
    if (process.platform === "win32") {
      win.setOverlayIcon(count && dataUrl ? nativeImage.createFromDataURL(dataUrl) : null, count ? `${count} não lidas` : "");
      if (count > 0 && !win.isFocused()) win.flashFrame(true);
    } else app.setBadgeCount(Math.max(0, count));
    tray?.setToolTip(count ? `Nexo — mensagens novas` : "Nexo");
  });
  ipcMain.handle("nexo:preview", async (_e, url) => fetchPreview(url));

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

// ---------------------------------------------------------------- prévia de links (Open Graph)

const previewCache = new Map();
async function fetchPreview(url) {
  if (!/^https?:\/\//.test(url)) return null;
  if (previewCache.has(url)) return previewCache.get(url);
  let result = null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await net.fetch(url, { signal: ctrl.signal, headers: { "user-agent": "Mozilla/5.0 (compatible; NexoBot/1.0; link preview)", accept: "text/html" } });
    clearTimeout(t);
    if (res.ok && (res.headers.get("content-type") ?? "").includes("text/html")) {
      const html = (await res.text()).slice(0, 300_000);
      const meta = (prop) => {
        const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, "i");
        const m = html.match(re);
        return m ? decode(m[1] ?? m[2]) : null;
      };
      const title = meta("og:title") ?? meta("twitter:title") ?? decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "");
      if (title) {
        let image = meta("og:image") ?? meta("twitter:image");
        if (image) image = new URL(image, url).toString();
        result = { title: title.slice(0, 200), description: (meta("og:description") ?? meta("description") ?? "").slice(0, 300), image, site: meta("og:site_name") ?? new URL(url).hostname };
      }
    }
  } catch {
    /* sem prévia */
  }
  previewCache.set(url, result);
  return result;
}

function decode(s) {
  return String(s)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}
