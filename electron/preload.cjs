// Ponte mínima entre a página (sandbox, sem Node) e o processo principal.
// Expõe só funções específicas; nada de ipcRenderer genérico.
const { contextBridge, ipcRenderer } = require("electron");

const on = (channel, cb) => {
  const fn = (_e, ...args) => cb(...args);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};

contextBridge.exposeInMainWorld("nexo", {
  platform: process.platform,
  debug: ipcRenderer.sendSync("nexo:debug") === true,
  getSources: () => ipcRenderer.invoke("nexo:sources"),
  selectSource: (id, audio) => ipcRenderer.invoke("nexo:select-source", id, audio),
  getPendingUrl: () => ipcRenderer.invoke("nexo:pending-url"),
  getVaultKey: () => ipcRenderer.invoke("nexo:vault-key"),
  resetVault: () => ipcRenderer.invoke("nexo:vault-reset"),
  getIdleSeconds: () => ipcRenderer.invoke("nexo:idle"),
  getVersion: () => ipcRenderer.invoke("nexo:version"),
  fetchPreview: (url) => ipcRenderer.invoke("nexo:preview", url),
  portMap: (ip, port) => ipcRenderer.invoke("nexo:portmap", ip, port),
  portMapRelease: (port) => ipcRenderer.invoke("nexo:portmap-release", port),
  portMapStatus: () => ipcRenderer.invoke("nexo:portmap-status"),
  cfTurn: (keyId, token) => ipcRenderer.invoke("nexo:cfturn", keyId, token),
  installUpdate: () => ipcRenderer.invoke("nexo:install-update"),
  checkUpdate: () => ipcRenderer.invoke("nexo:check-update"),
  setConfig: (c) => ipcRenderer.send("nexo:config", c),
  setBadge: (count, dataUrl) => ipcRenderer.send("nexo:badge", count, dataUrl),
  focus: () => ipcRenderer.send("nexo:focus"),
  onShortcut: (cb) => on("nexo:shortcut", cb),
  onOpenUrl: (cb) => on("nexo:open-url", cb),
  onUpdate: (cb) => on("nexo:update", cb),
  onTray: (cb) => on("nexo:tray", cb),
});
