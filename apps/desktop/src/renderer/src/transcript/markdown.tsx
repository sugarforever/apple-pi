import React, { useState } from "react";
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

export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

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
