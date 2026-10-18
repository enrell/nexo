// Gera build/icon.png (512) e build/tray.png (32) a partir de public/logo.svg usando o Chromium do Electron.
// Uso: npx electron scripts/make-icons.cjs
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(__dirname, "..", "public", "logo.svg"), "utf8");
  const out = path.join(__dirname, "..", "build");
  fs.mkdirSync(out, { recursive: true });
  const size = 512;
  const win = new BrowserWindow({ width: size, height: size, show: false, frame: false, transparent: true, webPreferences: { offscreen: true } });
  const html = `<html><body style="margin:0;background:transparent"><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}" width="${size}" height="${size}"></body></html>`;
  await win.loadURL("data:text/html;base64," + Buffer.from(html).toString("base64"));
  await new Promise((r) => setTimeout(r, 400));
  const img = (await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size })).resize({ width: size, height: size });
  win.destroy();
  for (const [file, s2] of [["icon.png", 512], ["tray.png", 32], ["tray@2x.png", 64]]) {
    fs.writeFileSync(path.join(out, file), img.resize({ width: s2, height: s2, quality: "best" }).toPNG());
    console.log("gerado", file);
  }
  app.quit();
});
