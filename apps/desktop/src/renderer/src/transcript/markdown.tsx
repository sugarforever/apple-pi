import React, { createContext, memo, useContext, useEffect, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, CodeXml, Copy } from "lucide-react";
import { Code } from "./code.js";
import { languageOf } from "./highlight.js";

interface HastNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: { className?: unknown };
  children?: HastNode[];
}

const textOf = (node: HastNode): string => node.value ?? (node.children ?? []).map(textOf).join("");

const components: Components = {
  pre({ node }) {
    const code = (node as HastNode | undefined)?.children?.find((child) => child.tagName === "code");
    const classes = Array.isArray(code?.properties?.className) ? (code.properties.className as string[]) : [];
    const language = classes.find((name) => name.startsWith("language-"))?.slice("language-".length);
    return <CodeBlock code={code ? textOf(code).replace(/\n$/, "") : ""} language={language} />;
  },
  a({ children, href }) {
    return (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    );
  },
};

const remarkPlugins = [remarkGfm];

/** The element a transcript scrolls in; deferred markdown watches it to know when it comes near. */
export const ScrollRoot = createContext<HTMLElement | null>(null);

/**
 * Memoised by text: parsing is the expensive part, and most blocks never change.
 * A `deferred` block shows its plain text until it comes within a screen of the
 * view, so opening a long chat parses only what is on screen.
 */
export const Markdown = memo(function Markdown({ text, deferred = false }: { text: string; deferred?: boolean }) {
  const root = useContext(ScrollRoot);
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  const parsed = seen || !deferred;
  useEffect(() => {
    const element = ref.current;
    if (parsed || !element) return;
    const observer = new IntersectionObserver((entries) => entries.some((entry) => entry.isIntersecting) && setSeen(true), {
      root,
      rootMargin: "100% 0px",
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [parsed, root]);
  return parsed ? (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  ) : (
    <div ref={ref} className="markdown markdown-deferred">
      {text}
    </div>
  );
});

export function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  const known = languageOf(language);
  const copy = () => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <figure className="code-block">
      <figcaption className="code-block-header">
        <CodeXml size={16} aria-hidden />
        <span>{known?.name ?? language ?? "Plain text"}</span>
        <button type="button" className="icon-button" onClick={copy} aria-label={copied ? "Copied" : "Copy code"} title="Copy">
          {copied ? <Check size={16} /> : <Copy size={16} />}
        </button>
      </figcaption>
      <Code code={code} language={known} />
    </figure>
  );
}
