/**
 * Extrai título, descrição, imagem e site de uma página HTML para a prévia de link.
 * O HTML vem de terceiros (qualquer link postado no chat), então tudo aqui é linear no tamanho
 * da página: nada de regex com backtracking sobre o documento inteiro.
 */
const MAX_TAG = 2000;

function decode(s) {
  // &amp; por último: "&amp;lt;" vira "&lt;" (texto), não "<"
  return String(s)
    .replace(/&#(\d{1,7});/g, (m, n) => codePoint(Number(n), m))
    .replace(/&#x([0-9a-f]{1,6});/gi, (m, n) => codePoint(parseInt(n, 16), m))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();
}

function codePoint(n, fallback) {
  // sem controles (exceto tab/quebra de linha), sem substitutos e dentro do Unicode
  if (n < 0x20 ? ![9, 10, 13].includes(n) : n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff) || n === 0x7f) return fallback;
  return String.fromCodePoint(n);
}

/** Mapa propriedade → conteúdo de todas as <meta property|name="…" content="…"> (vale a primeira). */
function metaTags(html) {
  const out = new Map();
  const open = /<meta(?=\s)/gi; // prefixo fixo: a busca é linear
  let end = -1;
  let m;
  while ((m = open.exec(html))) {
    const i = m.index;
    if (end < i) {
      end = html.indexOf(">", i);
      if (end === -1) break; // não há mais nenhuma tag fechada depois daqui
    }
    if (end - i > MAX_TAG) continue;
    const attrs = {};
    for (const a of html.slice(i + 5, end).matchAll(/([a-zA-Z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1].toLowerCase()] ??= a[2] ?? a[3];
    const key = (attrs.property ?? attrs.name)?.toLowerCase();
    if (key && attrs.content !== undefined && !out.has(key)) out.set(key, decode(attrs.content));
  }
  return out;
}

function titleTag(html) {
  const open = /<title(?=[\s>])/i.exec(html);
  if (!open) return "";
  const gt = html.indexOf(">", open.index);
  if (gt === -1) return "";
  const closeRe = /<\/title/gi;
  closeRe.lastIndex = gt;
  const close = closeRe.exec(html);
  return close ? decode(html.slice(gt + 1, close.index).slice(0, 1000)) : "";
}

/** `{ title, description, image, site }` ou `null` se a página não tem título. */
function parsePreview(html, url) {
  const meta = metaTags(String(html));
  const title = meta.get("og:title") || meta.get("twitter:title") || titleTag(String(html));
  if (!title) return null;
  let image = meta.get("og:image") || meta.get("twitter:image") || null;
  if (image) {
    try {
      image = new URL(image, url).toString();
      if (!image.startsWith("https://")) image = null;
    } catch {
      image = null; // imagem inválida não derruba a prévia
    }
  }
  return {
    title: title.slice(0, 200),
    description: (meta.get("og:description") ?? meta.get("description") ?? "").slice(0, 300),
    image,
    site: (meta.get("og:site_name") || new URL(url).hostname).slice(0, 80),
  };
}

module.exports = { parsePreview, decode, metaTags };
