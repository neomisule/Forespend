// A deliberately small Markdown reader for assistant answers.
//
// It understands only what the explanation prompt allows: paragraphs, **bold**,
// *italic*, "- " / "* " / "• " bullets and "1." numbered lists. Everything else
// (headings, links, tables, HTML tags) is shown as the plain text it was typed
// as. The output is a tree of plain objects that the React component turns into
// elements, so no HTML string is ever injected into the page.

export type Inline = { kind: "text"; text: string } | { kind: "strong"; text: string } | { kind: "em"; text: string };

export type Block =
  | { kind: "paragraph"; lines: Inline[][] } // one entry per soft line break
  | { kind: "list"; ordered: boolean; items: Inline[][] };

const BULLET = /^\s*(?:[-*•]|\d{1,2}[.)])\s+(.*)$/;
const ORDERED = /^\s*\d{1,2}[.)]\s+/;
const HEADING = /^\s{0,3}#{1,6}\s+/;

/** Splits a line into text, **strong** and *em* runs. Unmatched markers stay visible as text. */
export function parseInline(line: string): Inline[] {
  const out: Inline[] = [];
  const push = (kind: Inline["kind"], text: string) => text && out.push({ kind, text });
  // Bold first (** or __), then single * / _ for emphasis inside the leftovers.
  const bold = /(\*\*|__)(?=\S)([\s\S]*?\S)\1/g;
  let last = 0;
  for (const m of line.matchAll(bold)) {
    emphasis(line.slice(last, m.index), push);
    push("strong", m[2]);
    last = m.index + m[0].length;
  }
  emphasis(line.slice(last), push);
  return out;
}

function emphasis(text: string, push: (kind: Inline["kind"], text: string) => void) {
  // "*word*" or "_word_" surrounded by non-word characters; "$5 * 3" and snake_case stay as typed.
  const em = /(?<![\w*])(\*|_)(?=\S)([^*_\n]*?\S)\1(?![\w*])/g;
  let last = 0;
  for (const m of text.matchAll(em)) {
    push("text", text.slice(last, m.index));
    push("em", m[2]);
    last = m.index + m[0].length;
  }
  push("text", text.slice(last));
}

/** Blocks separated by blank lines; a run of bullet lines becomes a list. */
export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let paragraph: Inline[][] = [];
  let list: { ordered: boolean; items: Inline[][] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", lines: paragraph });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push({ kind: "list", ...list });
    list = null;
  };

  for (const raw of lines) {
    const line = raw.replace(HEADING, "").trimEnd(); // a heading is just a line of text here
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet) {
      flushParagraph();
      const ordered = ORDERED.test(line);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push(parseInline(bullet[1]));
      continue;
    }
    if (list) {
      // A plain line right after a bullet continues that bullet (a wrapped item).
      list.items[list.items.length - 1].push({ kind: "text", text: " " }, ...parseInline(line.trim()));
      continue;
    }
    paragraph.push(parseInline(line));
  }
  flushParagraph();
  flushList();
  return blocks;
}

/** The same answer as readable speech: no markers, bullets become sentences. */
export function toPlainText(source: string): string {
  const text = (inlines: Inline[]) => inlines.map((i) => i.text).join("");
  return parseMarkdown(source)
    .map((b) =>
      b.kind === "paragraph"
        ? b.lines.map(text).join(" ")
        : b.items
            .map(text)
            .map((s) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`))
            .join(" "),
    )
    .join("\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
