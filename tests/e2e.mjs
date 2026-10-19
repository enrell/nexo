/**
 * Teste ponta a ponta do Nexo: abre várias instâncias reais do app (perfis separados),
 * conecta via P2P de verdade e exercita chat, sincronização, anexos, voz, live com
 * retransmissão, moderação e persistência.
 *
 * Uso: npm run test:e2e   (precisa de internet para os relays de descoberta)
 */
import { _electron as electron } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = path.join(os.tmpdir(), "nexo-e2e");
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
const exe = path.join(root, "node_modules/electron/dist", process.platform === "win32" ? "electron.exe" : "electron");

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s]`, ...a);
const results = [];
async function step(name, fn) {
  const s = Date.now();
  try {
    await fn();
    results.push([name, true]);
    log("✔", name, `(${((Date.now() - s) / 1000).toFixed(1)}s)`);
  } catch (e) {
    results.push([name, false, e.message]);
    for (const P of Object.values(apps)) await P.page.screenshot({ path: path.join(tmp, `falha-${P.name}.png`) }).catch(() => {});
    log("   screenshots em", tmp);
    log("✘", name, "—", e.message.split("\n")[0]);
    throw e;
  }
}

const apps = {};
async function launch(name, { fresh = true } = {}) {
  const appl = await electron.launch({
    executablePath: exe,
    args: [root, `--user-data-dir=${path.join(tmp, name)}`, "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
    cwd: root,
  });
  const page = await appl.firstWindow();
  page.on("pageerror", (e) => log(name, "pageerror:", e.message));
  page.on("console", (m) => m.type() === "error" && !/WebSocket|relay|ERR_/.test(m.text()) && log(name, "console:", m.text().slice(0, 200)));
  await page.waitForFunction(() => window.__nexo?.ready, null, { timeout: 20000 });
  if (fresh) {
    await page.getByRole("button", { name: "Pular" }).click();
    await page.getByPlaceholder("Seu apelido").fill(name);
    await page.getByRole("button", { name: "Começar" }).click();
  }
  const P = { appl, page, name, ev: (fn, arg) => page.evaluate(fn, arg) };
  apps[name] = P;
  return P;
}

const wait = (P, fn, arg, timeout = 30000) => P.page.waitForFunction(fn, arg, { timeout });
const peers = (P) => P.ev(() => Object.values(window.__nexo.session?.peers ?? {}).filter((p) => p.profile).length);
const sessionEval = (P, fn, arg) => P.ev(new Function("arg", `const s = window.__nexo.session; return (${fn.toString()})(s, arg);`), arg);

async function joinWithCode(P, code) {
  await P.page.locator(".rail-btn.add").click();
  await P.page.getByRole("button", { name: "Entrar com convite" }).click();
  await P.page.locator(".modal textarea").fill(code);
  await P.page.getByRole("button", { name: "Entrar", exact: true }).click();
}

async function send(P, text) {
  await P.page.locator(".chat:not(.compact) .composer textarea").fill(text);
  await P.page.keyboard.press("Enter");
}

let code;
try {
  const A = await launch("Alice");

  await step("dono cria servidor e pega convite", async () => {
    await A.page.locator(".rail-btn.add").click();
    await A.page.getByRole("button", { name: "Criar servidor" }).click();
    await A.page.locator(".side-head").click();
    await A.page.getByRole("button", { name: "Convidar amigos" }).click();
    code = await A.page.locator(".invite-box code").nth(1).innerText();
    await A.page.keyboard.press("Escape");
    if (!code.startsWith("nexo-")) throw new Error("código inválido " + code);
    const owner = await sessionEval(A, (s) => s.isOwner());
    if (!owner) throw new Error("Alice deveria ser dona");
  });

  await step("mensagens offline ficam pendentes", async () => {
    for (const t of ["primeira mensagem", "segunda mensagem", "**terceira** com `código`"]) await send(A, t);
    await wait(A, () => document.querySelectorAll(".msg.pending").length >= 3);
  });

  const B = await launch("Bob");
  await step("convidado fica na porta até um admin aprovar (seguro por padrão)", async () => {
    await joinWithCode(B, code);
    await B.page.getByText("Aguardando aprovação").waitFor({ timeout: 60000 });
    const leaked = await B.ev(() => window.__nexo.session.events.size);
    if (leaked > 0) throw new Error("pendente recebeu " + leaked + " eventos antes da aprovação");
    await A.page.locator(".banner.warn").waitFor({ timeout: 15000 });
    await A.page.locator(".member.pending").getByRole("button", { name: "Aprovar" }).click();
  });

  await step("aprovado: handshake assinado, histórico sincroniza", async () => {
    await B.page.getByText("primeira mensagem").waitFor({ timeout: 20000 });
    await B.page.locator("strong", { hasText: "terceira" }).waitFor({ timeout: 10000 });
    await wait(A, () => document.querySelectorAll(".msg.pending").length === 0, null, 15000);
    const name = await B.page.locator(".side-head .ellipsis").innerText();
    if (!name.includes("Alice")) throw new Error("nome do servidor não sincronizou: " + name);
  });

  await step("menção destaca e conta para quem foi mencionado", async () => {
    await send(B, "oi @Alice, bora jogar?");
    await A.page.locator(".msg.mentioned").waitFor({ timeout: 15000 });
  });

  await step("reação, edição e exclusão propagam", async () => {
    const firstId = await sessionEval(A, (s) => s.state.messages.get("geral").find((m) => m.text === "primeira mensagem").id);
    await sessionEval(B, (s, id) => s.toggleReaction(id, "👍"), firstId);
    await A.page.locator(".reaction", { hasText: "👍" }).waitFor({ timeout: 15000 });
    const secondId = await sessionEval(A, (s) => s.state.messages.get("geral").find((m) => m.text === "segunda mensagem").id);
    await sessionEval(A, (s, id) => s.editMessage(id, "segunda mensagem (corrigida)"), secondId);
    await B.page.getByText("segunda mensagem (corrigida)").waitFor({ timeout: 15000 });
    await B.page.locator(".edited").first().waitFor();
    await sessionEval(A, (s, id) => s.deleteMessage(id), firstId);
    await B.page.locator(".deleted-msg").waitFor({ timeout: 15000 });
  });

  await step("Bob não consegue editar mensagem da Alice (assinatura)", async () => {
    const id = await sessionEval(B, (s) => s.state.messages.get("geral").find((m) => m.text.startsWith("segunda")).id);
    await sessionEval(B, (s, id) => s.editMessage(id, "HACKEADO"), id);
    await A.page.waitForTimeout(1500);
    const text = await sessionEval(A, (s, id) => s.state.byId.get(id).text, id);
    if (text.includes("HACKEADO")) throw new Error("edição alheia foi aceita!");
  });

  await step("anexo de imagem vai P2P e aparece no outro", async () => {
    const png = path.join(tmp, "teste.png");
    // PNG 1x1 vermelho
    fs.writeFileSync(png, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64"));
    await A.page.locator(".chat:not(.compact) .composer input[type=file]").setInputFiles(png);
    await A.page.locator(".file-chip").waitFor();
    await A.page.locator(".chat:not(.compact) .composer textarea").fill("olha essa imagem");
    await A.page.keyboard.press("Enter");
    await wait(B, () => !!document.querySelector(".att-image img"), null, 20000);
  });

  await step("indicador 'digitando…'", async () => {
    await B.page.locator(".chat:not(.compact) .composer textarea").pressSequentially("escrevendo algo", { delay: 30 });
    await A.page.locator(".typing-line", { hasText: "Bob" }).waitFor({ timeout: 10000 });
    await B.page.locator(".chat:not(.compact) .composer textarea").fill("");
  });

  const C = await launch("Carol");
  await step("terceiro membro chega depois, é aprovado e recebe o histórico completo", async () => {
    await joinWithCode(C, code);
    await C.page.getByText("Aguardando aprovação").waitFor({ timeout: 60000 });
    await A.page.locator(".member.pending").getByRole("button", { name: "Aprovar" }).click();
    await wait(C, () => Object.values(window.__nexo.session?.peers ?? {}).filter((p) => p.profile).length >= 2, null, 60000);
    await wait(B, () => Object.values(window.__nexo.session?.peers ?? {}).filter((p) => p.profile).length >= 2, null, 60000);
    const countA = await sessionEval(A, (s) => s.events.size);
    await wait(C, (n) => window.__nexo.session.events.size >= n, countA, 20000);
    await wait(C, () => !!document.querySelector(".att-image img"), null, 20000);
  });

  await step("intermediário com certificado DTLS diferente do assinado é recusado", async () => {
    const M = await launch("Mallory");
    await M.ev(() => window.__nexoLib.testOverrideFingerprint("AB".repeat(32)));
    await joinWithCode(M, code);
    await M.page.waitForTimeout(15000);
    const seenByA = await A.ev(() => Object.values(window.__nexo.session.peers).some((p) => p.profile?.name === "Mallory"));
    const mPeers = await peers(M);
    await M.appl.close();
    delete apps.Mallory;
    if (seenByA || mPeers > 0) throw new Error(`conexão aceita (A vê Mallory: ${seenByA}, Mallory vê ${mPeers})`);
  });

  await step("voz entre três pessoas (microfone falso)", async () => {
    for (const P of [A, B, C]) await P.page.locator(".chan", { hasText: "Sala de voz" }).click();
    for (const P of [A, B, C]) await wait(P, () => window.__nexo.session.voicePeers.size === 2, null, 20000);
    await B.page.locator(".user-panel .icon-btn").first().click(); // mutar
    await wait(A, () => Object.values(window.__nexo.session.peers).some((p) => p.profile?.name === "Bob" && p.muted));
  });

  await step("live de câmera com árvore de retransmissão", async () => {
    await A.ev(() => window.__nexo.setSettings({ ...window.__nexo.settings, streamSlots: 1, preset: "custom", quality: "720p30" }));
    await A.page.getByRole("button", { name: "Transmitir" }).click();
    await A.page.getByRole("button", { name: /Câmera/ }).click();
    await A.page.getByRole("button", { name: "Ficar ao vivo" }).click();
    await A.page.locator(".stage-video").waitFor({ timeout: 15000 });
    for (const P of [B, C]) {
      await P.page.locator(".chan.live").first().click({ timeout: 15000 });
      await P.page.waitForTimeout(2500);
    }
    for (const P of [B, C]) await wait(P, () => (document.querySelector(".stage-video")?.videoWidth ?? 0) > 0, null, 30000);
    const parents = [];
    for (const P of [B, C]) parents.push(await sessionEval(P, (s) => s.peerName(s.watching.parent)));
    log("   pais na árvore:", parents.join(", "));
    if (!parents.includes("Alice") || parents.every((p) => p === "Alice")) throw new Error("esperava um direto e um via retransmissão: " + parents);
    const viewers = await sessionEval(A, (s) => s.myLive.viewers);
    if (viewers !== 2) throw new Error("viewers=" + viewers);
  });

  let relayer, other;
  await step("retransmissor cai e o outro reconecta sozinho", async () => {
    const bRelays = await sessionEval(B, (s) => s.relayingCount);
    relayer = bRelays > 0 ? B : C;
    other = relayer === B ? C : B;
    await relayer.appl.close();
    await wait(other, () => {
      const s = window.__nexo.session;
      return s.watching?.status === "playing" && s.peerName(s.watching.parent) === "Alice";
    }, null, 40000);
    await other.page.waitForTimeout(3000);
    const ok = await other.ev(() => {
      const v = document.querySelector(".stage-video");
      return v && v.videoWidth > 0 && !v.paused;
    });
    if (!ok) throw new Error("vídeo parado após reconexão");
  });

  await step("quem caiu reabre o app: identidade e histórico persistem", async () => {
    const R = await launch(relayer.name, { fresh: false });
    relayer = R;
    await wait(R, () => window.__nexo.session?.loaded === true, null, 20000);
    const n = await sessionEval(R, (s) => s.events.size);
    if (n < 8) throw new Error("histórico não persistiu: " + n);
    await wait(R, () => Object.values(window.__nexo.session?.peers ?? {}).filter((p) => p.profile).length >= 2, null, 60000);
    const pubBefore = await sessionEval(A, (s, name) => Object.values(s.members).find((m) => m.name === name).pub, R.name);
    const pubNow = await R.ev(() => window.__nexo.identity.pub);
    if (pubBefore !== pubNow) throw new Error("identidade mudou ao reabrir");
  });

  await A.ev(() => window.__nexo.session.stopLive());

  const bob = apps.Bob;
  const carol = apps.Carol;
  await step("dono promove admin e o cargo aparece para todos", async () => {
    const bobPub = await bob.ev(() => window.__nexo.identity.pub);
    await sessionEval(A, (s, p) => s.setRole(p, "admin"), bobPub);
    await wait(carol, (p) => window.__nexo.session.state.admins.has(p), bobPub, 15000);
  });

  await step("admin bane: banido é desconectado e recusado", async () => {
    const carolPub = await carol.ev(() => window.__nexo.identity.pub);
    await sessionEval(bob, (s, p) => s.ban(p, true), carolPub);
    await wait(A, (p) => window.__nexo.session.state.banned.has(p) && !Object.values(window.__nexo.session.peers).some((x) => x.pub === p), carolPub, 20000);
    await carol.page.waitForTimeout(8000);
    const stillIn = await peers(carol);
    if (stillIn > 0) throw new Error("banida ainda conectada a " + stillIn);
  });

  await step("renovar convite: online migram juntos, código antigo morre", async () => {
    const oldRoom = await sessionEval(bob, (s) => s.server.roomId);
    await sessionEval(A, (s) => s.regenerateInvite());
    await wait(bob, (r) => window.__nexo.session?.server.roomId !== r, oldRoom, 20000);
    await wait(bob, () => Object.values(window.__nexo.session?.peers ?? {}).some((p) => p.profile?.name === "Alice"), null, 60000);
    await send(bob, "cheguei na sala nova");
    await A.page.getByText("cheguei na sala nova").waitFor({ timeout: 15000 });
  });

  await step("nada fica em texto puro no disco (localStorage e IndexedDB cifrados)", async () => {
    const res = await A.ev(async () => {
      const plain = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        const v = localStorage.getItem(k);
        if (k.startsWith("nexo:") && !v.startsWith("v1:")) plain.push(k);
      }
      const db = await new Promise((r, j) => {
        const q = indexedDB.open("nexo-secure");
        q.onsuccess = () => r(q.result);
        q.onerror = () => j(q.error);
      });
      const rows = await new Promise((r) => {
        const q = db.transaction("events").objectStore("events").getAll();
        q.onsuccess = () => r(q.result);
      });
      const dec = new TextDecoder();
      const leaks = rows.filter((row) => /mensagem|cheguei|imagem/.test(dec.decode(row.d)) || "b" in row || "s" in row).length;
      return { plain, rows: rows.length, leaks };
    });
    if (res.plain.length) throw new Error("chaves em texto puro: " + res.plain.join(","));
    if (!res.rows || res.leaks) throw new Error(`eventos: ${res.rows}, vazando texto: ${res.leaks}`);
  });

  await step("backup da conta: cifrado com senha, senha errada é recusada", async () => {
    const out = await A.ev(async () => {
      const app = window.__nexo;
      const text = await app.identity.exportBackup("senha-de-teste-forte", { profile: app.profile });
      const obj = JSON.parse(text);
      let wrongRejected = false;
      try {
        await window.__nexoLib.openBackup(text, "senha-errada-qualquer");
      } catch {
        wrongRejected = true;
      }
      const ok = await window.__nexoLib.openBackup(text, "senha-de-teste-forte");
      return { hasPlainKey: text.includes("jwk") || text.includes(app.identity.pub), iterations: obj.iterations, wrongRejected, samePub: ok.identity.pub === app.identity.pub };
    });
    if (out.hasPlainKey) throw new Error("backup contém dados em texto puro");
    if (out.iterations < 600000) throw new Error("PBKDF2 fraco");
    if (!out.wrongRejected) throw new Error("senha errada foi aceita");
    if (!out.samePub) throw new Error("backup não restaura a mesma identidade");
  });

  await step("configurações e troca rápida (Ctrl+K) abrem", async () => {
    await A.page.locator('.user-panel button[title="Configurações"]').click();
    await A.page.getByRole("button", { name: "Voz e vídeo" }).click();
    await A.page.getByText("Modo de entrada").waitFor();
    await A.page.keyboard.press("Escape");
    await A.page.keyboard.press("Control+k");
    await A.page.locator(".switcher input").waitFor();
    await A.page.keyboard.press("Escape");
  });
} catch {
  // já registrado
} finally {
  for (const P of Object.values(apps)) await P.appl.close().catch(() => {});
  const ok = results.filter((r) => r[1]).length;
  console.log(`\n${ok}/${results.length} etapas passaram em ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  process.exit(ok === results.length && results.length > 0 ? 0 : 1);
}
