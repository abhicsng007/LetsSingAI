// Minimal markdown renderer for the coach output (headings, bold, italics,
// bullet and numbered lists). Avoids pulling in a full markdown dependency.

import type { ReactNode } from "react";

// Some Bedrock models (e.g. Amazon Nova) stream their chain-of-thought inside
// <thinking>…</thinking> (or <reasoning>…</reasoning>) tags. Strip complete
// blocks, and hide an as-yet-unclosed block while it is still streaming in, so
// only the final coaching shows. No-op for models that don't emit these tags.
function stripReasoning(text: string): string {
  let s = text
    .replace(/<(thinking|reasoning)>[\s\S]*?<\/\1>/gi, "")
    .replace(/<(thinking|reasoning)\b[\s\S]*$/i, "");
  // Nova Lite sometimes echoes tool protocol as text; keep only the coaching.
  const marker = "### What I heard";
  const heading = s.indexOf(marker);
  const headingAlt = s.indexOf("**What I heard**");
  const cut = heading >= 0 ? heading : headingAlt;
  if (cut >= 0) s = s.slice(cut);
  else s = s.replace(/\{[\s\S]*$/, "");
  const second = s.indexOf(marker, marker.length);
  if (second > 0 && /\n3\./.test(s.slice(0, second))) s = s.slice(0, second);
  s = s.replace(/\n### What I\s*$/, "");
  return s.replace(/^\s+/, "");
}

function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|_[^_]+_)/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) parts.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    else parts.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function Markdown({ text }: { text: string }) {
  const lines = stripReasoning(text).split("\n");
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let key = 0;

  const flush = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{inline(it)}</li>);
    blocks.push(
      list.ordered ? <ol key={key++}>{items}</ol> : <ul key={key++}>{items}</ul>,
    );
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith("### ")) {
      flush();
      blocks.push(<h3 key={key++}>{inline(line.slice(4))}</h3>);
    } else if (/^\d+\.\s/.test(line)) {
      if (!list || !list.ordered) {
        flush();
        list = { ordered: true, items: [] };
      }
      list.items.push(line.replace(/^\d+\.\s/, ""));
    } else if (line.startsWith("- ")) {
      if (!list || list.ordered) {
        flush();
        list = { ordered: false, items: [] };
      }
      list.items.push(line.slice(2));
    } else if (line.trim() === "") {
      flush();
    } else {
      flush();
      blocks.push(<p key={key++}>{inline(line)}</p>);
    }
  }
  flush();
  return <div className="markdown">{blocks}</div>;
}
