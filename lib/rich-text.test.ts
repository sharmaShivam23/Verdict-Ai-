import { describe, expect, it } from "vitest";
import { parseInline, parseRich } from "./rich-text";

describe("parseInline", () => {
  it("handles bold, italic and code", () => {
    expect(parseInline("a **b** c `d` *e*")).toEqual([
      { t: "text", v: "a " },
      { t: "b", v: "b" },
      { t: "text", v: " c " },
      { t: "code", v: "d" },
      { t: "text", v: " " },
      { t: "i", v: "e" },
    ]);
  });

  it("leaves unmatched markers and plain text alone", () => {
    expect(parseInline("2 * 3 = 6")).toEqual([{ t: "text", v: "2 * 3 = 6" }]);
    expect(parseInline("**oops")).toEqual([{ t: "text", v: "**oops" }]);
  });

  it("never turns HTML into markup: it stays text for React to escape", () => {
    const evil = '<img src=x onerror="alert(1)"> **<b>x</b>**';
    const parts = parseInline(evil);
    expect(parts.map((p) => p.t)).toEqual(["text", "b"]);
    expect(parts[0].v).toContain("<img");
    expect(parts[1].v).toBe("<b>x</b>");
  });
});

describe("parseRich", () => {
  it("builds bullet lists from '-' and '*', and keeps a bold line out of the list", () => {
    const blocks = parseRich("Running:\n- **One** (1)\n* Two\n\n**Not a bullet** here");
    expect(blocks.map((b) => b.type)).toEqual(["p", "ul", "p"]);
    const ul = blocks[1] as { items: unknown[] };
    expect(ul.items).toHaveLength(2);
  });

  it("builds numbered lists and paragraphs", () => {
    const blocks = parseRich("Steps\n\n1. First\n2. Second");
    expect(blocks.map((b) => b.type)).toEqual(["p", "ol"]);
  });

  it("returns nothing for empty input", () => {
    expect(parseRich("")).toEqual([]);
    expect(parseRich("  \n \n")).toEqual([]);
  });
});
