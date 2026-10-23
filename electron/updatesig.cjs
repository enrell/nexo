/**
 * Assinatura das atualizações com a chave do PROJETO (Ed25519), independente do Authenticode.
 *
 * O instalador do Nexo não tem assinatura da Microsoft, então só o SHA-512 do `latest.yml` protegeria
 * a atualização: quem conseguisse trocar os arquivos da release (token do GitHub vazado, por exemplo)
 * trocaria o instalador e o hash juntos. Aqui o `latest.yml` carrega também `nexoSignature`: uma assinatura
 * de (versão + SHA-512 do instalador) feita no CI com uma chave privada que só existe como segredo do
 * workflow. O app traz as chaves públicas e recusa qualquer atualização que não confira, antes de rodá-la.
 *
 * Amarrar a versão à assinatura impede reaproveitar um instalador antigo (assinado e válido, mas vulnerável)
 * como se fosse uma versão nova.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");

/**
 * Chaves públicas aceitas (Ed25519, 32 bytes em base64). Mais de uma permite trocar a chave sem deixar
 * os apps já instalados para trás: publique uma versão aceita pelas duas e só então aposente a antiga.
 */
const PUBLIC_KEYS = ["wxPaBq7PtQpTKPN3qT+nZj0D/R42cHk/QfF+X3qMuRQ="];

const SPKI_ED25519 = Buffer.from("302a300506032b6570032100", "hex");
const VERSION = /^\d{1,6}\.\d{1,6}\.\d{1,6}(?:-[0-9A-Za-z.-]{1,32})?$/;

const publicKeyObject = (b64) => crypto.createPublicKey({ key: Buffer.concat([SPKI_ED25519, Buffer.from(b64, "base64")]), format: "der", type: "spki" });

/** O texto exato que é assinado. */
const payload = (version, sha512) => `nexo-update-v1\nversion=${version}\nsha512=${sha512}`;

function sha512File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha512");
    fs.createReadStream(file)
      .on("data", (c) => h.update(c))
      .on("error", reject)
      .on("end", () => resolve(h.digest("base64")));
  });
}

/** Gera a assinatura (base64) para uma versão e o SHA-512 (base64) do instalador. Usado no CI. */
function signUpdate(privateKeyPem, version, sha512) {
  if (!VERSION.test(version)) throw new Error("versão inválida: " + version);
  return crypto.sign(null, Buffer.from(payload(version, sha512)), crypto.createPrivateKey(privateKeyPem)).toString("base64");
}

/**
 * Confere a atualização baixada. `info` é o conteúdo do latest.yml; `file`, o instalador baixado.
 * Devolve `null` se está tudo certo, ou o motivo da recusa (formato que o electron-updater espera).
 */
async function verifyUpdate(info, file, keys = PUBLIC_KEYS) {
  if (!info || typeof info.version !== "string" || typeof info.nexoSignature !== "string") return "a atualização não traz a assinatura do projeto";
  if (!VERSION.test(info.version)) return "versão inválida";
  const sig = Buffer.from(info.nexoSignature, "base64");
  if (sig.length !== 64) return "assinatura malformada";
  const data = Buffer.from(payload(info.version, await sha512File(file)));
  for (const key of keys) {
    try {
      if (crypto.verify(null, data, publicKeyObject(key), sig)) return null;
    } catch {
      /* chave inválida na lista: tenta a próxima */
    }
  }
  return "a assinatura não confere com nenhuma chave do projeto";
}

module.exports = { PUBLIC_KEYS, VERSION, payload, sha512File, signUpdate, verifyUpdate, publicKeyObject };
