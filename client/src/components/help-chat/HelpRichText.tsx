/**
 * Renders a help-chat reply: paragraphs, lists, **bold**, and relative
 * markdown links. Anything else stays plain text — replies are never
 * injected as HTML.
 */
import type { ReactNode } from "react";
import { Link } from "wouter";
import { parseHelpBlocks, safeHelpHref } from "@/lib/helpChatFormat";

function renderInline(text: string, keyPrefix: string, onNavigate: () => void): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = re.exec(text))) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    if (match[1]) {
      nodes.push(
        <strong key={`${keyPrefix}-b-${i}`} className="font-semibold">
          {match[1]}
        </strong>,
      );
    } else {
      const href = safeHelpHref(match[3] ?? "");
      const label = match[2] ?? "";
      nodes.push(
        href ? (
          <Link
            key={`${keyPrefix}-a-${i}`}
            href={href}
            onClick={onNavigate}
            className="font-medium underline underline-offset-2"
          >
            {label}
          </Link>
        ) : (
          label
        ),
      );
    }
    last = match.index + match[0].length;
    i += 1;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function HelpRichText({ text, onNavigate }: { text: string; onNavigate: () => void }) {
  return (
    <div className="space-y-2">
      {parseHelpBlocks(text).map((block, index) => {
        if (block.type === "p") {
          return (
            <p key={index}>
              {block.lines.map((line, lineIndex) => (
                <span key={lineIndex}>
                  {lineIndex > 0 && <br />}
                  {renderInline(line, `${index}-${lineIndex}`, onNavigate)}
                </span>
              ))}
            </p>
          );
        }
        const List = block.type;
        return (
          <List
            key={index}
            className={block.type === "ul" ? "list-disc space-y-1 pl-4" : "list-decimal space-y-1 pl-5"}
          >
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>{renderInline(item, `${index}-${itemIndex}`, onNavigate)}</li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
