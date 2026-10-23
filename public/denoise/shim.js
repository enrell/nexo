// O AudioWorkletGlobalScope não tem TextEncoder, TextDecoder nem crypto, e o código gerado pelo
// wasm-bindgen usa os três (os dois primeiros logo ao ser carregado). Este arquivo precisa ser o
// primeiro import do worklet: módulos são avaliados na ordem dos imports.

export class Utf8Decoder {
  decode(bytes) {
    if (bytes === undefined) return "";
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes.buffer ?? bytes, bytes.byteOffset ?? 0, bytes.byteLength);
    let s = "";
    for (let i = 0; i < b.length; ) {
      const c = b[i];
      let cp = 0xfffd;
      let len = 1;
      if (c < 0x80) cp = c;
      else if (c >= 0xc2 && c < 0xe0 && cont(b, i + 1)) ((cp = ((c & 0x1f) << 6) | (b[i + 1] & 0x3f)), (len = 2));
      else if (c >= 0xe0 && c < 0xf0 && cont(b, i + 1) && cont(b, i + 2)) {
        const v = ((c & 0x0f) << 12) | ((b[i + 1] & 0x3f) << 6) | (b[i + 2] & 0x3f);
        if (v >= 0x800 && (v < 0xd800 || v > 0xdfff)) ((cp = v), (len = 3));
      } else if (c >= 0xf0 && c < 0xf5 && cont(b, i + 1) && cont(b, i + 2) && cont(b, i + 3)) {
        const v = ((c & 0x07) << 18) | ((b[i + 1] & 0x3f) << 12) | ((b[i + 2] & 0x3f) << 6) | (b[i + 3] & 0x3f);
        if (v >= 0x10000 && v <= 0x10ffff) ((cp = v), (len = 4));
      }
      s += String.fromCodePoint(cp);
      i += len;
    }
    return s;
  }
}
const cont = (b, i) => i < b.length && (b[i] & 0xc0) === 0x80;

export class Utf8Encoder {
  encode(str = "") {
    const out = new Uint8Array(str.length * 3);
    const { written } = this.encodeInto(str, out);
    return out.slice(0, written);
  }
  encodeInto(str, dest) {
    let read = 0;
    let written = 0;
    for (const ch of str) {
      let cp = ch.codePointAt(0);
      if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd; // meia surrogate solta
      const need = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
      if (written + need > dest.length) break;
      if (need === 1) dest[written++] = cp;
      else if (need === 2) ((dest[written++] = 0xc0 | (cp >> 6)), (dest[written++] = 0x80 | (cp & 0x3f)));
      else if (need === 3) ((dest[written++] = 0xe0 | (cp >> 12)), (dest[written++] = 0x80 | ((cp >> 6) & 0x3f)), (dest[written++] = 0x80 | (cp & 0x3f)));
      else ((dest[written++] = 0xf0 | (cp >> 18)), (dest[written++] = 0x80 | ((cp >> 12) & 0x3f)), (dest[written++] = 0x80 | ((cp >> 6) & 0x3f)), (dest[written++] = 0x80 | (cp & 0x3f)));
      read += ch.length;
    }
    return { read, written };
  }
}

/**
 * Instala o que faltar em `scope`. Devolve os nomes instalados (para os testes).
 * @param {Record<string, any>} [scope]
 * @returns {string[]}
 */
export function installShims(scope = globalThis) {
  const installed = [];
  if (typeof scope.TextDecoder === "undefined") (scope.TextDecoder = Utf8Decoder), installed.push("TextDecoder");
  if (typeof scope.TextEncoder === "undefined") (scope.TextEncoder = Utf8Encoder), installed.push("TextEncoder");
  if (!scope.crypto) {
    // Só alimenta o sorteio de hash de tabelas internas do Rust (getrandom): não protege nada.
    let x = (Math.random() * 2 ** 32) >>> 0 || 1;
    const next = () => ((x ^= x << 13), (x ^= x >>> 17), (x ^= x << 5), x >>> 0);
    scope.crypto = {
      getRandomValues(a) {
        for (let i = 0; i < a.length; i++) a[i] = next() & 0xff;
        return a;
      },
    };
    installed.push("crypto");
  }
  return installed;
}

installShims();
