const { contextBridge, ipcRenderer } = require("electron");

const on = (channel, cb) => {
  const fn = (_e, ...args) => cb(...args);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};

contextBridge.exposeInMainWorld("nexo", {
  platform: process.platform,
  getSources: () => ipcRenderer.invoke("nexo:sources"),
  selectSource: (id, audio) => ipcRenderer.invoke("nexo:select-source", id, audio),
  getPendingUrl: () => ipcRenderer.invoke("nexo:pending-url"),
  getIdleSeconds: () => ipcRenderer.invoke("nexo:idle"),
  getVersion: () => ipcRenderer.invoke("nexo:version"),
  fetchPreview: (url) => ipcRenderer.invoke("nexo:preview", url),
  installUpdate: () => ipcRenderer.invoke("nexo:install-update"),
  setConfig: (c) => ipcRenderer.send("nexo:config", c),
  setBadge: (count, dataUrl) => ipcRenderer.send("nexo:badge", count, dataUrl),
  focus: () => ipcRenderer.send("nexo:focus"),
  onShortcut: (cb) => on("nexo:shortcut", cb),
  onOpenUrl: (cb) => on("nexo:open-url", cb),
  onUpdate: (cb) => on("nexo:update", cb),
  onTray: (cb) => on("nexo:tray", cb),
});
