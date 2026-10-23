/**
 * Assina a atualização: lê o latest.yml gerado pelo electron-builder, confere o instalador e acrescenta
 * `nexoSignature` (ver electron/updatesig.cjs). Roda no CI, depois do electron-builder.
 *
 * Uso: UPDATE_SIGNING_KEY="$(cat chave.pem)" node scripts/sign-update.mjs release/latest.yml
 *
 * Falha (e não publica nada) se: o instalador não bate com o SHA-512 do latest.yml, ou a chave do segredo
 * não é uma das aceitas pelo app (ex.: segredo trocado por engano: ninguém conseguiria atualizar).
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const { PUBLIC_KEYS, VERSION, sha512File, signUpdate, verifyUpdate } = createRequire(import.meta.url)("../electron/updatesig.cjs");

const yml = process.argv[2];
const pem = process.env.UPDATE_SIGNING_KEY;
const keys = process.env.UPDATE_PUBLIC_KEYS ? process.env.UPDATE_PUBLIC_KEYS.split(",") : PUBLIC_KEYS; // o override existe para os testes
const fail = (msg) => {
  console.error("sign-update: " + msg);
  process.exit(1);
};

if (!yml) fail("uso: node scripts/sign-update.mjs release/latest.yml");
if (!pem) fail("falta a variável UPDATE_SIGNING_KEY (segredo do GitHub com a chave privada)");

const text = fs.readFileSync(yml, "utf8");
if (/^nexoSignature:/m.test(text)) fail("o latest.yml já está assinado");
const field = (name) => text.match(new RegExp(`^${name}: *['"]?([^'"\\r\\n]+?)['"]? *$`, "m"))?.[1];
const version = field("version");
const file = field("path");
const sha512 = field("sha512");
if (!version || !VERSION.test(version)) fail("versão inválida no latest.yml: " + version);
if (!file || !sha512) fail("o latest.yml não tem path/sha512");
if (file !== path.basename(file)) fail("path inesperado no latest.yml: " + file);

const installer = path.join(path.dirname(yml), file);
if ((await sha512File(installer)) !== sha512) fail(`${installer} não bate com o sha512 do latest.yml`);

const signature = signUpdate(pem, version, sha512);
const signed = text.replace(/\s*$/, "\n") + `nexoSignature: ${signature}\n`;

// confere como o app vai conferir, antes de gravar: pega segredo com a chave errada
const problem = await verifyUpdate({ version, nexoSignature: signature }, installer, keys);
if (problem) fail("a assinatura gerada não seria aceita pelo app (" + problem + "). O segredo UPDATE_SIGNING_KEY é da chave certa?");

fs.writeFileSync(yml, signed);
console.log(`latest.yml assinado (versão ${version}, ${file})`);
