import type { AnchorHTMLAttributes, ReactNode } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

const linkClass =
  "text-primary underline underline-offset-2 decoration-primary/60 hover:opacity-90";

function MarkdownLink({
  href,
  children,
  className,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  if (!href) {
    return <span className={className}>{children}</span>;
  }
  if (href.startsWith("/") && !href.startsWith("//")) {
    return (
      <Link href={href} className={cn(linkClass, className)}>
        {children}
      </Link>
    );
  }
  if (href.startsWith("mailto:")) {
    return (
      <a href={href} className={cn(linkClass, className)} {...rest}>
        {children}
      </a>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(linkClass, className)}
      {...rest}
    >
      {children}
    </a>
  );
}

function buildComponents(): Components {
  const heading =
    (level: 1 | 2 | 3 | 4) =>
    ({ children }: { children?: ReactNode }) => {
      const Tag = (`h${level}` as const);
      const size =
        level === 1
          ? "text-3xl font-semibold mt-10 mb-4 first:mt-0"
          : level === 2
            ? "text-2xl font-semibold mt-10 mb-3 scroll-mt-16 first:mt-0"
            : level === 3
              ? "text-xl font-semibold mt-8 mb-3 scroll-mt-16"
              : "text-lg font-semibold mt-6 mb-2 scroll-mt-16";
      return (
        <Tag className={cn("text-primary", size)}>
          {children}
        </Tag>
      );
    };

  return {
    a: MarkdownLink,
    h1: heading(1),
    h2: heading(2),
    h3: heading(3),
    h4: heading(4),
    table: ({ children }) => (
      <div className="my-6 w-full overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-sm [&_tbody_tr:nth-child(even)]:bg-muted/35">
          {children}
        </table>
      </div>
    ),
    thead: ({ children }) => (
      <thead className="bg-muted/50">{children}</thead>
    ),
    tbody: ({ children }) => <tbody>{children}</tbody>,
    tr: ({ children }) => <tr className="border-b border-border">{children}</tr>,
    th: ({ children }) => (
      <th className="border border-border px-3 py-2 text-left font-semibold text-foreground">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="border border-border px-3 py-2 align-top text-muted-foreground [&_strong]:text-foreground">
        {children}
      </td>
    ),
    hr: () => <hr className="my-10 border-border" />,
    blockquote: ({ children }) => (
      <blockquote className="my-4 border-l-4 border-primary/50 pl-4 italic text-muted-foreground">
        {children}
      </blockquote>
    ),
    ul: ({ children }) => (
      <ul className="my-4 list-disc space-y-2 pl-6 marker:text-primary">
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className="my-4 list-decimal space-y-2 pl-6 marker:text-primary">
        {children}
      </ol>
    ),
    li: ({ children }) => <li className="leading-relaxed">{children}</li>,
    p: ({ children }) => (
      <p className="my-4 leading-relaxed text-muted-foreground first:mt-0 [&_strong]:text-foreground">
        {children}
      </p>
    ),
    strong: ({ children }) => (
      <strong className="font-semibold text-foreground">{children}</strong>
    ),
  };
}

const markdownComponents = buildComponents();

export type LegalDocumentPageProps = {
  title: string;
  lastUpdated: string;
  /** Shown for Terms and Privacy; omit for policies without a separate effective date. */
  effectiveDate?: string;
  markdown: string;
  backButtonTestId?: string;
};

export function LegalDocumentPage({
  title,
  lastUpdated,
  effectiveDate,
  markdown,
  backButtonTestId,
}: LegalDocumentPageProps) {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto flex h-14 items-center gap-3 px-4">
          <Link href="/">
            <Button
              variant="ghost"
              size="icon"
              data-testid={backButtonTestId}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <h1 className="font-semibold">{title}</h1>
        </div>
      </header>

      <main className="mx-auto max-w-[700px] px-4 py-8">
        <div className="mb-8 space-y-1 text-sm text-muted-foreground">
          <p>Last updated: {lastUpdated}</p>
          {effectiveDate ? <p>Effective date: {effectiveDate}</p> : null}
        </div>
        <div className="text-base leading-relaxed">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={markdownComponents}
          >
            {markdown}
          </ReactMarkdown>
        </div>
      </main>
    </div>
  );
}