import { parseRich, type Inline } from "@/lib/rich-text";

function renderInline(parts: Inline[]) {
  return parts.map((p, i) =>
    p.t === "b" ? <strong key={i}>{p.v}</strong> : p.t === "i" ? <em key={i}>{p.v}</em> : p.t === "code" ? <code key={i} className="inline-code">{p.v}</code> : <span key={i}>{p.v}</span>,
  );
}

/** Renders a small markdown subset as normal elements. Model text is never inserted as HTML. */
export default function RichText({ text }: { text: string }) {
  return (
    <div className="rich">
      {parseRich(text).map((b, i) =>
        b.type === "p" ? (
          <p key={i}>{renderInline(b.inline)}</p>
        ) : b.type === "ul" ? (
          <ul key={i}>{b.items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}</ul>
        ) : (
          <ol key={i}>{b.items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}</ol>
        ),
      )}
    </div>
  );
}
