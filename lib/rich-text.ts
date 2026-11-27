// A deliberately tiny markdown subset for agent replies: **bold**, *italic*,
// `code`, "- " / "* " bullets and "1. " numbered lists. It produces a plain data
// structure that React renders as normal elements, so model output is never
// injected as HTML.

export type Inline = { t: "text" | "b" | "i" | "code"; v: string };
export type Block =
  | { type: "p"; inline: Inline[] }
  | { type: "ul" | "ol"; items: Inline[][] };

const TOKEN = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\s][^*\n]*\*)/g;

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of s.matchAll(TOKEN)) {
    if (m.index > last) out.push({ t: "text", v: s.slice(last, m.index) });
    const tok = m[0];
    if (tok.startsWith("**")) out.push({ t: "b", v: tok.slice(2, -2) });
    else if (tok.startsWith("`")) out.push({ t: "code", v: tok.slice(1, -1) });
    else out.push({ t: "i", v: tok.slice(1, -1) });
    last = m.index + tok.length;
  }
  if (last < s.length) out.push({ t: "text", v: s.slice(last) });
  return out.length ? out : [{ t: "text", v: s }];
}

const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBER = /^\s*\d+[.)]\s+(.*)$/;

export function parseRich(text: string): Block[] {
  const blocks: Block[] = [];
  let list: { type: "ul" | "ol"; items: Inline[][] } | null = null;
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) blocks.push({ type: "p", inline: parseInline(para.join("\n")) });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };

  for (const line of text.split(/\r?\n/)) {
    const b = BULLET.exec(line);
    const n = b ? null : NUMBER.exec(line);
    if (b || n) {
      flushPara();
      const type = b ? "ul" : "ol";
      if (!list || list.type !== type) {
        flushList();
        list = { type, items: [] };
      }
      list.items.push(parseInline((b ?? n)![1]));
    } else if (line.trim() === "") {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return blocks;
}
