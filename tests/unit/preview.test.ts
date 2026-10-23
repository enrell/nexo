import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

type Preview = { title: string; description: string; image: string | null; site: string } | null;
const { parsePreview, decode, metaTags } = createRequire(import.meta.url)("../../electron/preview.cjs") as {
  parsePreview: (html: string, url: string) => Preview;
  decode: (s: string) => string;
  metaTags: (html: string) => Map<string, string>;
};
const URL_ = "https://exemplo.com/artigo/1";

describe("parsePreview", () => {
  it("lê as tags Open Graph", () => {
    const html = `<html><head>
      <meta property="og:title" content="Título OG">
      <meta property="og:description" content="Descrição OG">
      <meta property="og:image" content="https://cdn.exemplo.com/i.png">
      <meta property="og:site_name" content="Exemplo">
      <title>Outro título</title></head></html>`;
    expect(parsePreview(html, URL_)).toEqual({ title: "Título OG", description: "Descrição OG", image: "https://cdn.exemplo.com/i.png", site: "Exemplo" });
  });

  it("cai para Twitter, <title> e description; site vira o domínio", () => {
    expect(parsePreview(`<meta name="twitter:title" content="TW"><meta name="description" content="d"><meta name="twitter:image" content="/x.png">`, URL_)).toEqual({ title: "TW", description: "d", image: "https://exemplo.com/x.png", site: "exemplo.com" });
    expect(parsePreview(`<TITLE>  Só o título  </TITLE>`, URL_)).toMatchObject({ title: "Só o título", description: "", image: null });
  });

  it("aceita aspas simples, ordem invertida dos atributos e maiúsculas", () => {
    expect(parsePreview(`<META CONTENT='Invertido' PROPERTY='og:title'>`, URL_)?.title).toBe("Invertido");
    expect(parsePreview(`<meta content="B" name="og:title" />`, URL_)?.title).toBe("B");
  });

  it("sem título não há prévia", () => {
    expect(parsePreview(`<meta property="og:description" content="só descrição">`, URL_)).toBeNull();
    expect(parsePreview("", URL_)).toBeNull();
    expect(parsePreview(`<title></title>`, URL_)).toBeNull();
    expect(parsePreview(`<title>sem fechar`, URL_)).toBeNull();
  });

  it("a primeira ocorrência vale (página não consegue sobrescrever com uma tag no fim)", () => {
    expect(parsePreview(`<meta property="og:title" content="primeiro"><meta property="og:title" content="segundo">`, URL_)?.title).toBe("primeiro");
  });

  it("só imagem https; http, javascript: e data: são descartados, mas a prévia fica", () => {
    for (const img of ["http://x.com/a.png", "javascript:alert(1)", "data:image/png;base64,AAAA", "ftp://x/a.png", "//[::"]) expect(parsePreview(`<title>t</title><meta property="og:image" content="${img}">`, URL_)?.image, img).toBeNull();
    expect(parsePreview(`<title>t</title><meta property="og:image" content="//cdn.exemplo.com/a.png">`, URL_)?.image).toBe("https://cdn.exemplo.com/a.png");
  });

  it("respeita os limites de tamanho", () => {
    const out = parsePreview(`<meta property="og:title" content="${"t".repeat(500)}"><meta property="og:description" content="${"d".repeat(900)}"><meta property="og:site_name" content="${"s".repeat(200)}">`, URL_)!;
    expect(out.title).toHaveLength(200);
    expect(out.description).toHaveLength(300);
    expect(out.site).toHaveLength(80);
  });

  it("devolve texto puro: marcação na página não vira HTML (a interface escapa)", () => {
    const out = parsePreview(`<title>&lt;script&gt;alert(1)&lt;/script&gt;</title>`, URL_)!;
    expect(out.title).toBe("<script>alert(1)</script>");
    expect(typeof out.title).toBe("string");
  });

  it("<metadata> e similares não são <meta>", () => {
    expect(metaTags(`<metadata name="og:title" content="x">`).size).toBe(0);
  });

  it("tag gigante é ignorada, as outras continuam", () => {
    const big = `<meta name="x" content="${"a".repeat(3000)}">`;
    expect(parsePreview(`${big}<meta property="og:title" content="ok">`, URL_)?.title).toBe("ok");
  });
});

describe("decode", () => {
  it.each([
    ["&amp;", "&"],
    ["&quot;oi&quot;", '"oi"'],
    ["&#39;a&apos;", "'a'"],
    ["&lt;b&gt;", "<b>"],
    ["a&nbsp;b", "a b"],
    ["&#233;", "é"],
    ["&#x1F600;", "😀"],
    ["&#X41;", "A"],
    ["&amp;lt;", "&lt;"], // &amp; por último: não vira "<"
    ["&amp;amp;", "&amp;"],
  ])("%s", (input, out) => expect(decode(input)).toBe(out));

  it("códigos inválidos ficam como estão (sem lançar)", () => {
    for (const bad of ["&#0;", "&#1;", "&#127;", "&#55296;", "&#1114112;", "&#xD800;", "&#99999999;"]) expect(() => decode(bad)).not.toThrow();
    expect(decode("&#0;")).toBe("&#0;");
    expect(decode("&#xD800;")).toBe("&#xD800;");
    expect(decode("&#1114112;")).toBe("&#1114112;");
  });
  it("tabulação e quebra de linha numéricas são permitidas", () => {
    expect(decode("a&#9;b")).toBe("a\tb");
  });
  it("não mexe em texto comum e tira espaços das pontas", () => {
    expect(decode("  oi  ")).toBe("oi");
    expect(decode("")).toBe("");
  });
});

describe("HTML hostil não trava o app (tudo linear)", () => {
  const MB = 512 * 1024;
  const cases: [string, string][] = [
    ["milhares de <meta sem fechar", "<meta ".repeat(MB / 6)],
    // 4 MB: o limite real de download é 512 KB, mas aqui a diferença entre linear (ms) e quadrático (dezenas de segundos) fica indiscutível
    ["centenas de milhares de <meta e um único > lá no fim (cada tag \"termina\" longe)", "<meta ".repeat(700_000) + ">"],
    ["<title e <meta intercalados com um > no fim", "<title <meta ".repeat(MB / 13) + ">"],
    ["milhares de <meta com atributos soltos", '<meta name="a" '.repeat(MB / 16)],
    ["aspas abertas em sequência", `<meta content="`.repeat(MB / 15)],
    ["<title sem >", "<title ".repeat(MB / 7)],
    ["</title ausente com muito lixo", "<title>" + "x".repeat(MB)],
    ["uma tag de meio megabyte", `<meta name="a" content="${"x".repeat(MB)}">`],
    ["entidades em excesso", "<title>" + "&#x1F600;&amp;".repeat(MB / 14) + "</title>"],
    ["'<' repetidos", "<".repeat(MB)],
    ["'>' repetidos", ">".repeat(MB)],
  ];
  it.each(cases)("%s", (_n, html) => {
    const t = performance.now();
    parsePreview(html, URL_);
    expect(performance.now() - t).toBeLessThan(750);
  });
});
