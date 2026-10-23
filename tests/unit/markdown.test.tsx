import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown, extractUrls, isEmojiOnly } from "../../src/components/Markdown";

const md = (text: string, names: string[] = [], me = "eu") => renderToStaticMarkup(<Markdown text={text} names={new Set(names)} me={me} />);

describe("Markdown", () => {
  it("formatação básica", () => {
    expect(md("**negrito**")).toBe("<strong>negrito</strong>");
    expect(md("*itálico*")).toBe("<em>itálico</em>");
    expect(md("_itálico_")).toBe("<em>itálico</em>");
    expect(md("~~riscado~~")).toBe("<s>riscado</s>");
    expect(md("`código`")).toBe("<code>código</code>");
    expect(md("||segredo||")).toContain('class="spoiler"');
  });

  it("aninhamento", () => {
    expect(md("**negrito e *itálico* dentro**")).toBe("<strong>negrito e <em>itálico</em> dentro</strong>");
    expect(md("**negrito *itálico***")).toBe("<strong>negrito <em>itálico</em></strong>");
    expect(md("**a** e **b**")).toBe("<strong>a</strong> e <strong>b</strong>");
    expect(md("~~riscado e **negrito**~~")).toBe("<s>riscado e <strong>negrito</strong></s>");
  });

  it("código não interpreta o que está dentro", () => {
    expect(md("`**nada** @eu`", ["eu"])).toBe("<code>**nada** @eu</code>");
    expect(md("```\n**nada**\n```")).toBe('<pre class="codeblock"><code>**nada**</code></pre>');
    expect(md("```js\nconst a = 1;\n```")).toBe('<pre class="codeblock"><code>const a = 1;</code></pre>');
  });

  it("quebras de linha e citações", () => {
    expect(md("a\nb")).toBe("a<br/>b");
    expect(md("> citado\n> mais\nfora")).toBe("<blockquote>citado<br/>mais</blockquote>fora");
  });

  describe("segurança: texto de terceiros nunca vira HTML", () => {
    it.each(["<script>alert(1)</script>", '<img src=x onerror="alert(1)">', "<iframe src=//evil></iframe>", "</code><script>x</script>", "&lt;b&gt;", '"><svg onload=alert(1)>'])("%s", (payload) => {
      // tirando as tags que o próprio Markdown gera, não pode sobrar nenhum "<" cru: tudo que veio do texto está escapado
      const own = md(payload).replace(/<\/?(strong|em|s|code|pre|blockquote|br|span|a)(\s[^<>]*)?\/?>/g, "");
      expect(own).not.toContain("<");
      expect(md(payload)).not.toMatch(/<[^>]*\son\w+=/i); // nem um atributo de evento dentro de uma tag de verdade
    });

    it("atributos de link não escapam das aspas", () => {
      const out = md('https://x.com/"onmouseover="alert(1)');
      expect(out).not.toMatch(/\sonmouseover=/);
    });

    it("só http(s) vira link; javascript:, data: e file: ficam como texto", () => {
      for (const u of ["javascript:alert(1)", "data:text/html,<script>", "file:///etc/passwd", "vbscript:x", "ftp://x.com", "JaVaScRiPt:alert(1)"]) expect(md(u), u).not.toContain("<a ");
      expect(md("https://exemplo.com/a?b=1")).toBe('<a href="https://exemplo.com/a?b=1" target="_blank" rel="noreferrer">https://exemplo.com/a?b=1</a>');
      expect(md("http://exemplo.com")).toContain('href="http://exemplo.com"');
    });

    it("links externos abrem fora do app sem passar referência", () => {
      expect(md("https://a.com")).toMatch(/target="_blank" rel="noreferrer"/);
    });
  });

  it("pontuação final não entra no link", () => {
    expect(md("veja https://exemplo.com/x.")).toBe('veja <a href="https://exemplo.com/x" target="_blank" rel="noreferrer">https://exemplo.com/x</a>.');
    expect(md("(https://exemplo.com/x)")).toContain('href="https://exemplo.com/x"');
  });

  describe("menções", () => {
    it("destaca só quem existe no servidor", () => {
      expect(md("oi @ana", ["ana"])).toContain('class="mention"');
      expect(md("oi @fantasma", ["ana"])).not.toContain("mention");
    });
    it("menção a mim e a todos recebe destaque forte", () => {
      expect(md("@eu", ["eu"], "eu")).toContain('class="mention me"');
      expect(md("@todos")).toContain('class="mention me"');
      expect(md("@Aqui")).toContain('class="mention me"');
    });
    it("ignora maiúsculas e aceita acentos", () => {
      expect(md("@JOSÉ", ["josé"])).toContain("mention");
    });
    it("e-mail não é menção de ninguém", () => {
      expect(md("a@ana.com", ["ana"])).not.toContain("mention");
    });
  });

  it("texto vazio e só espaços não quebram", () => {
    expect(md("")).toBe("");
    expect(md("   ")).toBe("   ");
  });

  it("entradas absurdas não travam (marcação sem fechar, repetição)", () => {
    for (const text of ["*".repeat(4000), "**".repeat(2000), "`".repeat(4000), "||".repeat(2000), "~~".repeat(2000), "> ".repeat(2000), "@".repeat(4000), "http://".repeat(600), "_a_".repeat(1300), "```".repeat(1300)]) {
      const t = performance.now();
      expect(() => md(text)).not.toThrow();
      expect(performance.now() - t).toBeLessThan(1000);
    }
  });
});

describe("isEmojiOnly", () => {
  it.each(["😀", "😀😀😀", "👍 🔥", "❤️", "👨‍👩‍👧", "🏳️‍🌈"])("%s é só emoji", (t) => expect(isEmojiOnly(t)).toBe(true));
  it.each(["", "oi", "oi 😀", "123", "😀 oi", "😀".repeat(30), " ", "\n"])("%j não é", (t) => expect(isEmojiOnly(t)).toBe(false));
});

describe("extractUrls", () => {
  it("acha links no meio do texto e tira a pontuação final", () => {
    expect(extractUrls("a https://x.com/a, e http://y.org/b?c=1. fim")).toEqual(["https://x.com/a", "http://y.org/b?c=1"]);
    expect(extractUrls("sem link")).toEqual([]);
    expect(extractUrls("javascript:alert(1) ftp://x")).toEqual([]);
  });
});
