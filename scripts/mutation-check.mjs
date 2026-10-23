/**
 * Verificação de mutação (manual): quebra uma regra de segurança/negócio por vez e confere que a
 * suíte de testes unitários FALHA. Uma mutação que sobrevive é um teste que falta.
 *
 * Uso: node scripts/mutation-check.mjs [filtro]      (ex.: node scripts/mutation-check.mjs derive)
 * Os arquivos são sempre restaurados, mesmo com Ctrl+C.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const M = (file, find, replace, why) => ({ file, find, replace, why });

const MUTATIONS = [
  // --- regras de moderação (derive.ts)
  M("src/lib/derive.ts", 'if (banned.has(e.a) && b.k !== "ban") continue;', "", "banido continua valendo"),
  M("src/lib/derive.ts", "if (m && m.author === e.a && !m.deleted) {", "if (m && !m.deleted) {", "qualquer um edita a mensagem alheia"),
  M("src/lib/derive.ts", "if (m && (m.author === e.a || isAdmin(e.a))) {", "if (m) {", "qualquer um apaga a mensagem alheia"),
  M("src/lib/derive.ts", "if (e.a === owner && b.user !== owner) {", "if (b.user !== owner) {", "qualquer um promove admin"),
  M("src/lib/derive.ts", "if (isAdmin(e.a) && b.user !== owner && b.user !== e.a) {", "if (isAdmin(e.a) && b.user !== e.a) {", "dono pode ser banido"),
  M("src/lib/derive.ts", "if (isAdmin(e.a) && b.user !== owner && b.user !== e.a) {", "if (isAdmin(e.a) && b.user !== owner) {", "admin se bane"),
  M("src/lib/derive.ts", "if (CONTENT.has(b.k) && !isMember(e.a)) continue;", "", "não-aprovado participa"),
  M("src/lib/derive.ts", "if (!isAdmin(e.a)) break;", "", "qualquer um mexe nos canais"),
  M("src/lib/derive.ts", "if (isAdmin(e.a) && b.name) {", "if (b.name) {", "qualquer um renomeia o servidor"),
  M("src/lib/derive.ts", "if (isAdmin(e.a)) move =", "move =", "qualquer um muda a sala"),
  M("src/lib/derive.ts", "if (isAdmin(e.a)) approval = !!b.approval;", "approval = !!b.approval;", "qualquer um muda a política"),
  M("src/lib/derive.ts", "a.ts - b.ts || (a.id < b.id ? -1 : 1)", "a.ts - b.ts", "sem desempate: ordem de chegada muda o resultado"),
  M("src/lib/derive.ts", "text: b.text.slice(0, 4000),", "text: b.text,", "texto sem limite"),
  M("src/lib/derive.ts", "b.emoji.length > 16", "b.emoji.length > 1600", "emoji sem limite"),
  M("src/lib/derive.ts", "fnv(ids.sort().join(\",\"))", "fnv(ids.join(\",\"))", "resumo depende da ordem"),
  M("src/lib/derive.ts", "if (b.on && !has) m.reactions", "if (b.on) m.reactions", "reação duplica"),
  M("src/lib/derive.ts", "if (e.a === owner) admins.delete(b.user);", "admins.delete(b.user);", "admin tira outro admin"),
  // --- entrada de eventos (events.ts)
  M("src/lib/events.ts", "id(b.ch) && str(b.text, MAX_TEXT) &&", "str(b.text, MAX_TEXT) &&", "msg sem checar o canal"),
  M("src/lib/events.ts", "if (ts > now + MAX_FUTURE_MS ||", "if (false ||", "evento do futuro aceito"),
  M("src/lib/events.ts", "if ((await sha256(data)) !== e.id) return null;", "", "id forjado aceito"),
  M("src/lib/events.ts", "if (!(await verify(e.a, data, e.s))) return null;", "", "assinatura não conferida"),
  M("src/lib/events.ts", "case \"role\":\n      return pub(b.user) &&", "case \"role\":\n      return true &&", "role sem checar o usuário"),
  M("src/lib/events.ts", "!str(a.mime, 127) ||", "false ||", "anexo sem mime (mensagem envenenada)"),
  M("src/lib/events.ts", "b.att.length <= 10 &&", "", "anexos sem limite"),
  M("src/lib/events.ts", "if (data.length > MAX_EVENT_BYTES) return null;", "", "evento gigante aceito"),
  M("src/lib/derive.ts", "reactions: Object.create(null) as Record<string, string[]>,", "reactions: {},", 'emoji "constructor" derruba o servidor'),
  M("src/lib/derive.ts", "      apply(e, b);\n    } catch (err) {", "      apply(e, b);\n    } catch (err) {\n      throw err;", "um evento que lança derruba o estado inteiro"),
  // --- entrada de rede sobre os peers (sanitize.ts)
  M("src/lib/sanitize.ts", "if (profileOnly) return out;", "", "não-membro atualiza presença completa"),
  M("src/lib/sanitize.ts", 'const PREFIX = "data:image/jpeg;base64,";\n  return typeof t === "string" && t.startsWith(PREFIX) &&', 'const PREFIX = "data:image/jpeg;base64,";\n  return typeof t === "string" &&', "miniatura por URL (rastreador)"),
  M("src/lib/sanitize.ts", "(jpeg|png|webp);base64,", "(jpeg|png|webp|svg\\+xml);base64,", "avatar SVG aceito"),
  M("src/lib/sanitize.ts", "title: typeof l.title === \"string\" ? l.title.slice(0, 120) : \"\",", "title: l.title as string,", "título de live de tipo errado derruba o painel"),
  M("src/lib/sanitize.ts", "viewers: Math.max(0, Math.min(100_000, Math.trunc(Number(l.viewers)) || 0)),", "viewers: l.viewers as number,", "espectadores de tipo errado"),
  M("src/lib/sanitize.ts", "if (Array.isArray(l.viewerKeys)) out.viewerKeys = l.viewerKeys.filter(isPubKey).slice(0, 512);", "if (Array.isArray(l.viewerKeys)) out.viewerKeys = l.viewerKeys;", "chaves de espectadores sem validar"),
  M("src/lib/sanitize.ts", "userId,\n    name:", "userId: String(o.userId),\n    name:", "peer escolhe o próprio userId"),
  // --- atualização automática (updatesig.cjs, updater.cjs, sign-update.mjs)
  M("electron/updatesig.cjs", "`nexo-update-v1\\nversion=${version}\\nsha512=${sha512}`", "`nexo-update-v1\\nsha512=${sha512}`", "assinatura não amarra a versão (rebaixamento)"),
  M("electron/updatesig.cjs", "if (crypto.verify(null, data, publicKeyObject(key), sig)) return null;", "return null;", "qualquer atualização é aceita"),
  M("electron/updatesig.cjs", "await sha512File(file)", "\"\"", "não confere o conteúdo do instalador"),
  M("electron/updatesig.cjs", "typeof info.nexoSignature !== \"string\") return", "false) return", "atualização sem assinatura é aceita"),
  M("electron/updatesig.cjs", "if (!VERSION.test(info.version)) return \"versão inválida\";", "", "versão com lixo entra no payload"),
  M("electron/updatesig.cjs", "} catch {\n      /* chave inválida na lista: tenta a próxima */", "} catch (e) {\n      throw e;", "uma chave inválida na lista derruba a verificação"),
  M("electron/updater.cjs", "if (state.status !== \"ready\") return;", "", "instala algo que não foi baixado nem conferido"),
  M("electron/updater.cjs", "autoUpdater.quitAndInstall(true, true);", "autoUpdater.quitAndInstall();", "instalador com janela e sem reabrir o app"),
  M("electron/updater.cjs", "autoUpdater.verifyUpdateCodeSignature = (_publisherNames, file) => verify(lastInfo, file);", "autoUpdater.verifyUpdateCodeSignature = async () => null;", "o gancho de assinatura não é usado"),
  M("electron/updater.cjs", "autoUpdater.allowDowngrade = false;", "autoUpdater.allowDowngrade = true;", "permite rebaixar a versão"),
  M("electron/updater.cjs", "if (checking || state.status === \"downloading\" || state.status === \"ready\") return;", "", "procuras sobrepostas"),
  M("electron/updater.cjs", "if (code === \"ERR_UPDATER_INVALID_SIGNATURE\")", "if (false)", "assinatura recusada vira mensagem genérica"),
  M("scripts/sign-update.mjs", "if ((await sha512File(installer)) !== sha512) fail(", "if (false) fail(", "assina um instalador que não é o do latest.yml"),
  M("scripts/sign-update.mjs", "if (problem) fail(", "if (false) fail(", "publica com a chave errada"),
  M("scripts/sign-update.mjs", "if (/^nexoSignature:/m.test(text)) fail(", "if (false) fail(", "assina duas vezes"),
  M("scripts/sign-update.mjs", "if (file !== path.basename(file)) fail(", "if (false) fail(", "path do latest.yml sai da pasta"),
  // --- telas
  M("src/components/Live.tsx", "if (mine && !live) a.closeLive();", "", "depois de parar a live, a tela fica aberta"),
  M("src/components/Live.tsx", "{mine && live && (", "{mine && (", "'Parar transmissão' aparece sem live"),
  M("src/components/Modals.tsx", "{!has && (\n        <>", "{true && (\n        <>", "início manda criar servidor mesmo já tendo um"),
  M("src/components/Modals.tsx", "await navigator.clipboard.writeText(inviteLink(srv));", "await navigator.clipboard.writeText(\"\");", "copia o link errado"),
  M("src/components/Modals.tsx", "{!pending && (\n                    <span className=\"home-actions\">", "{true && (\n                    <span className=\"home-actions\">", "convida de servidor em que ainda não fui aprovado"),
  // --- criptografia (identity.ts, vault.ts)
  M("src/lib/identity.ts", "if (!(iterations >= 100_000 && iterations <= 10_000_000))", "if (false)", "backup aceita iterações fracas"),
  M("src/lib/identity.ts", "const [x, y] = [a, b].sort();", "const [x, y] = [a, b];", "número de segurança depende da ordem"),
  M("src/lib/identity.ts", "!(await crypto.subtle.verify({ name: \"Ed25519\" }, await importPub(out.identity.pub), sig, probe))", "false", "backup inconsistente aceito"),
  M("src/lib/identity.ts", "passphrase.normalize(\"NFKC\")", "passphrase", "senha sem normalização"),
  M("src/lib/vault.ts", "additionalData: enc.encode(aad) }, k(), data", "additionalData: enc.encode(\"\") }, k(), data", "cofre sem AAD"),
  M("src/lib/vault.ts", "const iv = crypto.getRandomValues(new Uint8Array(12));", "const iv = new Uint8Array(12);", "iv fixo"),
  // --- armazenamento e banco
  M("src/lib/storage.ts", "localStorage.setItem(QUARANTINE + k, raw);", "", "registro ilegível some sem quarentena"),
  M("src/lib/storage.ts", "v.length >= 1 && v.length <= max &&", "v.length >= 1 &&", "convite com campos gigantes"),
  M("src/lib/storage.ts", "if (saved.themeRev !== THEME_REV) for", "if (false) for", "tema antigo não migra"),
  M("src/lib/db.ts", "`ev:${e.srv}:${e.id}`", "`ev`", "linhas do banco intercambiáveis"),
  M("src/lib/db.ts", "`blob:${id}`);", "`blob`);", "anexos intercambiáveis"),
  // --- Electron: SSRF e prévia
  M("electron/netguard.cjs", '["169.254.0.0", 16],', "", "metadados de nuvem liberados"),
  M("electron/netguard.cjs", '["fc00::", 7],', "", "IPv6 privado liberado"),
  M("electron/netguard.cjs", 'if (typeof ip !== "string") return true;', "", "valor que não é texto passa como público"),
  M("electron/netguard.cjs", "if (!family) return true;", "if (!family) return false;", "hostname passa como se fosse público"),
  M("electron/preview.cjs", "if (end < i) {", "if (true) {", "varredura volta a ser quadrática"),
  M("electron/preview.cjs", 'if (!image.startsWith("https://")) image = null;', "", "imagem http aceita"),
  M("electron/preview.cjs", ".replace(/&amp;/g, \"&\")", ".replace(/&amp;/g, \"&\").replace(/&lt;/g, \"<\")", "decodifica duas vezes"),
  // --- redutor de ruído (DeepFilterNet) e pipeline do microfone
  M("public/denoise/framer.js", "this.out.push(new Float32Array(hop));", "", "fila de saída sem pré-carga: o áudio falha a cada poucos blocos"),
  M("public/denoise/framer.js", "if (!frame || frame.length !== this.hop) throw", "if (false) throw", "quadro de tamanho errado entra na fila"),
  M("public/denoise/worklet.js", "return (out.fill(0), true);", "return (input ? out.set(input) : out.fill(0), true);", "microfone sem tratamento vaza antes do modelo carregar"),
  M("public/denoise/worklet.js", "if (msg?.type === \"init\" && !this.framer) {", "if (msg?.type === \"init\") {", "um segundo init recria o estado (vazamento)"),
  M("public/denoise/shim.js", "if (typeof scope.TextDecoder === \"undefined\")", "if (true)", "o shim sobrescreve o TextDecoder de verdade"),
  M("public/denoise/shim.js", "if (written + need > dest.length) break;", "", "encodeInto escreve além do destino"),
  M("src/lib/denoise.ts", "if (ctx.sampleRate !== DENOISE_RATE) throw", "if (false) throw", "redutor roda em taxa errada (voz distorcida)"),
  M("src/lib/denoise.ts", "if (bytes.byteLength < min) throw", "if (false) throw", "arquivo truncado é aceito"),
  M("src/lib/denoise.ts", "if (isGzip(b)) return b;", "", "o modelo é compactado duas vezes"),
  M("src/lib/denoise.ts", "cached = null;\n    throw e;", "throw e;", "uma falha de carregamento fica guardada para sempre"),
  M("src/lib/denoise.ts", "node.disconnect();\n    throw e;", "throw e;", "nó com falha continua no grafo"),
  M("src/lib/audio.ts", "noiseSuppression: s.noiseSuppression && !useDenoise,", "noiseSuppression: s.noiseSuppression,", "duas camadas de supressão (navegador + IA)"),
  M("src/lib/audio.ts", "if (this.denoise || this.denoiseLoading || this.denoiseBroken ||", "if (this.denoise || this.denoiseLoading ||", "tenta o redutor quebrado a cada abertura do microfone"),
  M("src/lib/audio.ts", "const useDenoise = this.denoiseReady();\n    this.raw =", "const useDenoise = !!this.denoise;\n    this.raw =", "redutor quebrado/desligado ainda usado"),
  M("src/lib/audio.ts", "if (wasOn && this.micStream) this.restartMic()", "if (this.micStream) this.restartMic()", "reabre o microfone à toa quando o redutor falha"),
  M("public/denoise/worklet.js", "this.port.onmessageerror = () =>", "this.port.onmessageerrorX = () =>", "mensagem perdida deixa a página esperando para sempre"),
  M("src/lib/denoise.ts", "wasm: assets.wasm, model:", "module: assets.wasm, model:", "init sem os bytes do wasm"),
  M("src/lib/audio.ts", "this.micSrc.connect(this.denoise!);", "this.micSrc.connect(into);", "o microfone cru ignora o redutor"),
  M("src/lib/audio.ts", "if (this.raw !== current) {", "if (false) {", "microfone reaberto depois de fechado"),
  M("src/lib/audio.ts", "if (this.denoiseBroken) return;\n    const wasOn", "const wasOn", "aviso repetido a cada falha"),
  M("src/lib/audio.ts", "if (s.noiseSuppression && this.lastNoiseSuppression === false) this.denoiseBroken = false;", "if (s.noiseSuppression) this.denoiseBroken = false;", "qualquer ajuste apaga a falha do redutor"),
  M("src/lib/audio.ts", "sampleRate: DENOISE_RATE", "sampleRate: 44100", "contexto de áudio fora dos 48 kHz do modelo"),
  M("vite.config.ts", "'wasm-unsafe-eval'", "'unsafe-eval'", "CSP libera eval inteiro em vez de só WebAssembly"),
  M("vite.config.ts", "script-src 'self' 'wasm-unsafe-eval';", "script-src 'self';", "CSP bloqueia o WebAssembly do redutor"),
  M("electron/main.cjs", ', ".wasm": "application/wasm"', "", "wasm servido sem o tipo certo"),
  // --- interface
  M("src/components/Markdown.tsx", "(\\*\\*[^\\n]+?\\*\\*(?!\\*))", "(\\*\\*[^*\\n]+\\*\\*)", "negrito com itálico dentro quebra"),
  M("src/components/Markdown.tsx", 'target="_blank" rel="noreferrer"', 'target="_blank"', "link sem noreferrer"),
  M("src/components/ErrorBoundary.tsx", "static getDerivedStateFromError(error: Error): Partial<State> {\n    return { error };", "static getDerivedStateFromError(error: Error): Partial<State> {\n    return { error: null };", "o erro de renderização não é capturado"),
  M("src/lib/theme.ts", "Math.min(100, Math.max(55, s.panelAlpha))", "s.panelAlpha", "opacidade sem limites"),
];

const filter = process.argv[2];
const todo = MUTATIONS.filter((m) => !filter || m.file.includes(filter) || m.why.includes(filter));
const originals = new Map();
const restore = () => {
  for (const [f, text] of originals) fs.writeFileSync(f, text);
  originals.clear();
};
process.on("SIGINT", () => (restore(), process.exit(130)));
process.on("exit", restore);

const survivors = [];
let killed = 0;
for (const [i, m] of todo.entries()) {
  const file = path.join(root, m.file);
  const original = fs.readFileSync(file, "utf8");
  if (!original.includes(m.find)) {
    console.log(`✘ [${i + 1}/${todo.length}] não achei o trecho em ${m.file}: ${m.find.slice(0, 60)} (a mutação envelheceu)`);
    survivors.push(`${m.file}: trecho não encontrado — ${m.why}`);
    continue;
  }
  originals.set(file, original);
  fs.writeFileSync(file, original.replace(m.find, m.replace));
  const r = spawnSync("npx", ["vitest", "run", "--reporter=dot"], { cwd: root, encoding: "utf8", shell: process.platform === "win32", env: { ...process.env, NEXO_MUTATING: "1" } });
  restore();
  if (r.status === 0) {
    survivors.push(`${m.file}: ${m.why}`);
    console.log(`✘ [${i + 1}/${todo.length}] SOBREVIVEU  ${m.file} — ${m.why}`);
  } else {
    killed++;
    console.log(`✔ [${i + 1}/${todo.length}] morreu      ${m.file} — ${m.why}`);
  }
}
console.log(`\n${killed}/${todo.length} mutações pegas pelos testes.`);
if (survivors.length) {
  console.log("Sobreviventes (faltam testes):\n - " + survivors.join("\n - "));
  process.exit(1);
}
