import { Fragment, useState, type ReactNode } from "react";

const INLINE =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\|\|[^|\n]+\|\|)|(~~[^~\n]+~~)|(\*[^*\s][^*\n]*\*)|(\b_[^_\s][^_\n]*_\b)|(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])|(@[\p{L}\p{N}_.-]+)/gu;

const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|\s){1,24}$/u;

export function isEmojiOnly(text: string) {
  return text.length <= 24 && EMOJI_ONLY.test(text) && /\p{Extended_Pictographic}/u.test(text);
}

export function extractUrls(text: string): string[] {
  return [...text.matchAll(/https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g)].map((m) => m[0]);
}

function Spoiler({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span className={"spoiler" + (open ? " open" : "")} onClick={() => setOpen(true)}>
      {children}
    </span>
  );
}

function inline(text: string, ctx: Ctx, key = ""): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    const start = m.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    const t = m[0];
    const k = key + "-" + i++;
    if (m[1]) out.push(<code key={k}>{t.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k}>{inline(t.slice(2, -2), ctx, k)}</strong>);
    else if (m[3]) out.push(<Spoiler key={k}>{inline(t.slice(2, -2), ctx, k)}</Spoiler>);
    else if (m[4]) out.push(<s key={k}>{inline(t.slice(2, -2), ctx, k)}</s>);
    else if (m[5] || m[6]) out.push(<em key={k}>{inline(t.slice(1, -1), ctx, k)}</em>);
    else if (m[7])
      out.push(
        <a key={k} href={t} target="_blank" rel="noreferrer">
          {t}
        </a>,
      );
    else if (m[8]) {
      const name = t.slice(1).toLowerCase();
      const isAll = ["todos", "everyone", "here", "aqui"].includes(name);
      if (isAll || ctx.names.has(name)) out.push(<span key={k} className={"mention" + (isAll || name === ctx.me ? " me" : "")}>{t}</span>);
      else out.push(t);
    }
    last = start + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Ctx = { names: Set<string>; me: string };

/** Markdown estilo Discord: **negrito**, *itálico*, ~~riscado~~, `código`, ```bloco```, ||spoiler||, > citação, @menção. */
export function Markdown({ text, names, me }: { text: string; names: Set<string>; me: string }) {
  const ctx: Ctx = { names, me: me.toLowerCase() };
  const parts = text.split(/```(?:[a-z0-9+-]*\n)?([\s\S]*?)```/g);
  return (
    <>
      {parts.map((part, idx) => {
        if (idx % 2 === 1)
          return (
            <pre key={idx} className="codeblock">
              <code>{part.replace(/\n$/, "")}</code>
            </pre>
          );
        const lines = part.split("\n");
        const nodes: ReactNode[] = [];
        let quote: string[] = [];
        const flushQuote = (k: string) => {
          if (!quote.length) return;
          nodes.push(
            <blockquote key={"q" + k}>
              {quote.map((q, j) => (
                <Fragment key={j}>
                  {j > 0 && <br />}
                  {inline(q, ctx, k + "q" + j)}
                </Fragment>
              ))}
            </blockquote>,
          );
          quote = [];
        };
        let afterQuote = false;
        lines.forEach((line, j) => {
          const k = idx + "-" + j;
          if (line.startsWith("> ")) {
            quote.push(line.slice(2));
            return;
          }
          if (quote.length) {
            flushQuote(k);
            afterQuote = true;
          }
          // a citação já é um bloco: não precisa de quebra de linha depois dela
          if (j > 0 && !afterQuote) nodes.push(<br key={"br" + k} />);
          afterQuote = false;
          nodes.push(<Fragment key={k}>{inline(line, ctx, k)}</Fragment>);
        });
        flushQuote("end" + idx);
        return <Fragment key={idx}>{nodes}</Fragment>;
      })}
    </>
  );
}
