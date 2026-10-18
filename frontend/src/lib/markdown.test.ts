import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown, toPlainText } from "./markdown";

const text = (s: string) => ({ kind: "text", text: s });
const strong = (s: string) => ({ kind: "strong", text: s });

describe("assistant answer markdown", () => {
  it("renders bold and keeps plain text untouched", () => {
    expect(parseInline("Cash takes **$600.00** now.")).toEqual([text("Cash takes "), strong("$600.00"), text(" now.")]);
    expect(parseInline("Costs 2 * 3 dollars and snake_case stays")).toEqual([text("Costs 2 * 3 dollars and snake_case stays")]);
    expect(parseInline("a *short* note")).toEqual([text("a "), { kind: "em", text: "short" }, text(" note")]);
    expect(parseInline("**unfinished bold")).toEqual([text("**unfinished bold")]);
  });

  it("splits paragraphs on blank lines and keeps single line breaks", () => {
    const blocks = parseMarkdown("Here’s the trade-off.\n\n**Cash:** −$600.00 now.\n**Credit:** $0.00 now.");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ kind: "paragraph", lines: [[text("Here’s the trade-off.")]] });
    expect(blocks[1].kind).toBe("paragraph");
    expect((blocks[1] as { lines: unknown[] }).lines).toHaveLength(2);
  });

  it("turns bullet runs into lists and wrapped lines into the same item", () => {
    const blocks = parseMarkdown("Two points:\n- **Cash:** nothing extra\n- Credit adds $8.68\n  by Nov 30\n\n1. first\n2. second");
    expect(blocks.map((b) => b.kind)).toEqual(["paragraph", "list", "list"]);
    const list = blocks[1] as { ordered: boolean; items: unknown[][] };
    expect(list.ordered).toBe(false);
    expect(list.items).toHaveLength(2);
    expect(list.items[1]).toEqual([text("Credit adds $8.68"), text(" "), text("by Nov 30")]);
    expect((blocks[2] as { ordered: boolean }).ordered).toBe(true);
  });

  it("never treats HTML or headings as markup", () => {
    const blocks = parseMarkdown("## Title\n<b>bold?</b> <script>alert(1)</script>");
    expect(blocks).toEqual([
      { kind: "paragraph", lines: [[text("Title")], [text("<b>bold?</b> <script>alert(1)</script>")]] },
    ]);
  });

  it("gives speech the words without the punctuation of markdown", () => {
    const spoken = toPlainText("**Here’s the trade-off.**\n\n- **Cash:** $600.00 leaves now\n- Credit: $0.00 now, $605.34 owed on Nov 6, 2026.");
    expect(spoken).toBe("Here’s the trade-off.\n\nCash: $600.00 leaves now. Credit: $0.00 now, $605.34 owed on Nov 6, 2026.");
    expect(spoken).not.toMatch(/[*#]|^- /m);
    expect(toPlainText("Plain answer. Two sentences.")).toBe("Plain answer. Two sentences.");
  });
});
