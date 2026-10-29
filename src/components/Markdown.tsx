"use client";

import { isValidElement, memo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CopyButton } from "./CopyButton";

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

const components: Components = {
  pre({ children }) {
    const child = Array.isArray(children) ? children[0] : children;
    const className = isValidElement<{ className?: string }>(child) ? (child.props.className ?? "") : "";
    const lang = /language-([\w+#.-]+)/.exec(className)?.[1] ?? "";
    const code = textOf(children).replace(/\n$/, "");
    return (
      <div className="code-block">
        <div className="code-head">
          <span>{lang || "code"}</span>
          <CopyButton text={code} />
        </div>
        <pre>
          <code>{code}</code>
        </pre>
      </div>
    );
  },
  a({ href, children }) {
    const label = textOf(children).trim();
    // Inline citations arrive as [[1]](url); show them as small numbered links.
    const citation = /^\[?\d{1,3}\]?$/.test(label);
    return (
      <a href={href} target="_blank" rel="noopener noreferrer nofollow" className={citation ? "cite" : undefined}>
        {citation ? label.replace(/[[\]]/g, "") : children}
      </a>
    );
  },
  img({ src, alt }) {
    // Remote images become links: auto-loading them would let a document leak chat data through image URLs.
    const url = typeof src === "string" ? src : "";
    return (
      <a href={url} target="_blank" rel="noopener noreferrer nofollow">
        {alt || url || "image"}
      </a>
    );
  },
  table({ children }) {
    return (
      <div className="table-wrap">
        <table>{children}</table>
      </div>
    );
  },
};

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
