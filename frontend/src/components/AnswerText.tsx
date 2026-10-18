import { Fragment } from "react";
import { parseMarkdown, type Inline } from "../lib/markdown";

/**
 * An assistant answer as real paragraphs, bold and short lists. The text is
 * parsed into plain objects and rendered as React elements, so nothing in the
 * answer can inject HTML; tags and other markup are shown as typed.
 */
export function AnswerText({ source, className = "" }: { source: string; className?: string }) {
  const blocks = parseMarkdown(source);
  return (
    <div className={`flex flex-col gap-2 text-sm leading-relaxed text-navy ${className}`}>
      {blocks.map((b, i) =>
        b.kind === "paragraph" ? (
          <p key={i}>
            {b.lines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                <Runs inlines={line} />
              </Fragment>
            ))}
          </p>
        ) : b.ordered ? (
          <ol key={i} className="flex list-decimal flex-col gap-1 pl-5">
            {b.items.map((item, j) => (
              <li key={j}>
                <Runs inlines={item} />
              </li>
            ))}
          </ol>
        ) : (
          <ul key={i} className="flex list-disc flex-col gap-1 pl-5">
            {b.items.map((item, j) => (
              <li key={j}>
                <Runs inlines={item} />
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}

function Runs({ inlines }: { inlines: Inline[] }) {
  return (
    <>
      {inlines.map((r, i) =>
        r.kind === "strong" ? (
          <strong key={i} className="font-semibold">
            {r.text}
          </strong>
        ) : r.kind === "em" ? (
          <em key={i}>{r.text}</em>
        ) : (
          <Fragment key={i}>{r.text}</Fragment>
        ),
      )}
    </>
  );
}
