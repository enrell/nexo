/**
 * Gera o par de chaves que assina as atualizações do Nexo (Ed25519).
 *
 * Uso: node scripts/update-keygen.mjs <arquivo-da-chave-privada.pem>
 *
 * - A chave PRIVADA fica só no arquivo indicado (nunca no repositório). Guarde uma cópia em um gerenciador
 *   de senhas e cadastre como segredo do GitHub:  gh secret set UPDATE_SIGNING_KEY < arquivo.pem
 *   Se ela se perder, os apps já instalados não aceitam mais atualizações assinadas por outra chave.
 * - A chave PÚBLICA é impressa: ela vai em PUBLIC_KEYS (electron/updatesig.cjs) e é a única coisa que o app embute.
 */
import crypto from "node:crypto";
import fs from "node:fs";

const out = process.argv[2];
if (!out) {
  console.error("uso: node scripts/update-keygen.mjs <arquivo-da-chave-privada.pem>");
  process.exit(2);
}
if (fs.existsSync(out)) {
  console.error(`${out} já existe: não vou sobrescrever uma chave.`);
  process.exit(1);
}
const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
fs.writeFileSync(out, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600, flag: "wx" });
const raw = publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64");
console.log(`chave privada gravada em ${out} (permissão 600)`);
console.log(`chave pública (base64): ${raw}`);
