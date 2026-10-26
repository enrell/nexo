/**
 * TURN da Cloudflare: com a "Turn Token ID" e o "API token" de uma chave TURN do usuário, gera
 * credenciais temporárias (no máximo 48 h) para turn.cloudflare.com. A chamada à API sai daqui
 * (fora da página); para os amigos vão só as credenciais temporárias.
 */
const https = require("node:https");

const API_HOST = "rtc.live.cloudflare.com";
const TTL_S = 48 * 3600; // o máximo que a Cloudflare aceita
const MAX_BODY = 64 * 1024;
// só os endereços oficiais; porta 53 fica de fora (o navegador bloqueia e atrasa o ICE)
const TURN_URL = /^turns?:turn\.cloudflare\.com:(\d{1,5})(?:\?transport=(?:udp|tcp))?$/;

const validKeyId = (s) => typeof s === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(s);
const validToken = (s) => typeof s === "string" && /^[A-Za-z0-9_.-]{8,512}$/.test(s);
const validSecret = (s) => typeof s === "string" && s.length >= 8 && s.length <= 512 && /^[\x21-\x7e]+$/.test(s);

/** Resposta de generate-ice-servers → um iceServer TURN só com URLs oficiais, ou null. */
function parseIceServers(body) {
  let json;
  try {
    json = JSON.parse(String(body).slice(0, MAX_BODY));
  } catch {
    return null;
  }
  const list = Array.isArray(json?.iceServers) ? json.iceServers.slice(0, 8) : [];
  for (const s of list) {
    if (!s || typeof s !== "object") continue;
    const urls = (Array.isArray(s.urls) ? s.urls : [s.urls]).slice(0, 16).filter((u) => {
      const m = typeof u === "string" && TURN_URL.exec(u);
      return m && m[1] !== "53" && Number(m[1]) > 0 && Number(m[1]) < 65536;
    });
    if (urls.length && validSecret(s.username) && validSecret(s.credential)) return [{ urls, username: s.username, credential: s.credential }];
  }
  return null;
}

function post(path, token, body) {
  return new Promise((resolve) => {
    const req = https.request(
      { host: API_HOST, path, method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, timeout: 8000 },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on("data", (c) => {
          size += c.length;
          if (size > MAX_BODY) return req.destroy();
          chunks.push(c);
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", () => resolve(null));
      },
    );
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(null));
    req.end(body);
  });
}

/** { ok: true, iceServers, ttl } ou { ok: false, error } com mensagem para o usuário. */
async function generate(keyId, token, request = post) {
  if (!validKeyId(keyId)) return { ok: false, error: "A Turn Token ID não parece certa (copie de novo do painel da Cloudflare)." };
  if (!validToken(token)) return { ok: false, error: "O API token não parece certo (copie de novo do painel da Cloudflare)." };
  const res = await request(`/v1/turn/keys/${keyId}/credentials/generate-ice-servers`, token, JSON.stringify({ ttl: TTL_S }));
  if (!res) return { ok: false, error: "Não consegui falar com a Cloudflare. Confira a internet e tente de novo." };
  if (res.status === 401 || res.status === 403) return { ok: false, error: "A Cloudflare recusou o API token." };
  if (res.status === 404) return { ok: false, error: "A Cloudflare não achou essa Turn Token ID." };
  if (res.status !== 200 && res.status !== 201) return { ok: false, error: `A Cloudflare respondeu ${res.status}. Tente de novo mais tarde.` };
  const iceServers = parseIceServers(res.body);
  if (!iceServers) return { ok: false, error: "A resposta da Cloudflare veio num formato inesperado." };
  return { ok: true, iceServers, ttl: TTL_S };
}

module.exports = { generate, parseIceServers, post, validKeyId, validToken, TTL_S };
