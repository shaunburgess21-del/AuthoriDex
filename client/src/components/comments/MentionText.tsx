import { Link } from "wouter";
import { splitMentionSegments } from "@shared/lib/mentions";

interface MentionTextProps {
  text: string;
  className?: string;
}

/**
 * Renders comment/post body text with inline @-mentions as styled links.
 * Plain `@Whatever` that was never picked from the dropdown stays literal text.
 */
export function MentionText({ text, className }: MentionTextProps) {
  const segments = splitMentionSegments(text);
  if (segments.length === 0) {
    return <span className={className}>{text}</span>;
  }

  return (
    <span className={className}>
      {segments.map((seg, i) => {
        if (seg.kind === "text") {
          return <span key={i}>{seg.text}</span>;
        }
        const mention = seg.mention!;
        const href =
          mention.type === "person"
            ? `/person/${mention.id}`
            : `/u/${encodeURIComponent(mention.display)}`;
        return (
          <Link
            key={i}
            href={href}
            className="font-medium text-cyan-600 hover:text-cyan-500 dark:text-cyan-400 dark:hover:text-cyan-300"
            onClick={(e) => e.stopPropagation()}
          >
            {seg.text}
          </Link>
        );
      })}
    </span>
  );
}
