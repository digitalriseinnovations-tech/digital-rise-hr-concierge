import { Fragment, type ReactNode } from "react";

/**
 * Minimal, dependency-free markdown rendering for Concierge replies —
 * demo-blocking UX fix: the model's replies use **bold**, "- " bullet
 * lists, and line breaks, and were previously shown as literal text
 * (including literal ** characters). Deliberately narrow scope (bold,
 * lists, line breaks, auto-linked URLs) rather than pulling in a full
 * markdown library for one chat bubble. Builds real React elements only —
 * no dangerouslySetInnerHTML, so this can never be an injection vector
 * regardless of what the model (or, in principle, an employee) writes.
 */

const BULLET_RE = /^[-*]\s+(.*)$/;
const NUMBERED_RE = /^\d+\.\s+(.*)$/;
const URL_RE = /(https?:\/\/[^\s)]+)/g;
const BOLD_RE = /\*\*(.+?)\*\*/g;

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let key = 0;

  // Split on URLs first, then apply bold within each non-URL segment —
  // avoids URLs and **bold** markers interfering with each other.
  const urlParts = text.split(URL_RE);
  for (const part of urlParts) {
    if (URL_RE.test(part)) {
      URL_RE.lastIndex = 0;
      nodes.push(
        <a key={key++} href={part} target="_blank" rel="noopener noreferrer" className="underline break-all">
          {part}
        </a>,
      );
      continue;
    }
    URL_RE.lastIndex = 0;

    const boldParts = part.split(BOLD_RE);
    boldParts.forEach((segment, i) => {
      if (!segment) return;
      // Every odd index in a String.split(capturingGroupRegex) result is
      // the captured group itself — i.e. the bold text.
      if (i % 2 === 1) {
        nodes.push(<strong key={key++}>{segment}</strong>);
      } else {
        nodes.push(<Fragment key={key++}>{segment}</Fragment>);
      }
    });
  }
  return nodes;
}

export function ConciergeMarkdown({ content }: { content: string }) {
  const lines = content.split("\n");
  const blocks: ReactNode[] = [];
  let listBuffer: string[] = [];
  let listOrdered = false;
  let blockKey = 0;

  function flushList() {
    if (listBuffer.length === 0) return;
    const ListTag = listOrdered ? "ol" : "ul";
    blocks.push(
      <ListTag key={blockKey++} className={listOrdered ? "list-decimal pl-5 space-y-0.5" : "list-disc pl-5 space-y-0.5"}>
        {listBuffer.map((item, i) => (
          <li key={i}>{renderInline(item)}</li>
        ))}
      </ListTag>,
    );
    listBuffer = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const bulletMatch = BULLET_RE.exec(line);
    const numberedMatch = NUMBERED_RE.exec(line);

    if (bulletMatch || numberedMatch) {
      const isOrdered = Boolean(numberedMatch);
      // A list-type change (bullet <-> numbered) starts a new list rather
      // than mixing item types inside one <ul>/<ol>.
      if (listBuffer.length > 0 && listOrdered !== isOrdered) flushList();
      listOrdered = isOrdered;
      listBuffer.push((bulletMatch ?? numberedMatch)![1]);
      continue;
    }

    flushList();
    if (line.trim() === "") {
      blocks.push(<div key={blockKey++} className="h-2" />);
    } else {
      blocks.push(<div key={blockKey++}>{renderInline(line)}</div>);
    }
  }
  flushList();

  return <div className="space-y-0.5">{blocks}</div>;
}
