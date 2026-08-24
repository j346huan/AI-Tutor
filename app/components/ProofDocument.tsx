"use client";

import { MathText } from "./MathText";

type DocumentBlockKind =
  | "section"
  | "subsection"
  | "statement"
  | "proof"
  | "content"
  | "qed";

interface DocumentBlock {
  kind: DocumentBlockKind;
  text: string;
  environment?: "definition" | "lemma" | "proposition" | "theorem";
}

const MARKER = "AI_MATHEMATICIAN_DOCUMENT_BLOCK";

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function lowerInitial(value: string): string {
  const [first = "", ...rest] = Array.from(value);
  return `${first.toLocaleLowerCase("en")}${rest.join("")}`;
}

function marker(kind: DocumentBlockKind, text: string): string {
  return `\n\n${MARKER}:${kind}:${encodeURIComponent(text)}\n\n`;
}

function normalizeLatexParagraph(value: string): string {
  return value.replace(/[ \t]*\r?\n[ \t]*/g, " ").trim();
}

function parseMarker(block: string): DocumentBlock | null {
  const match = block.match(
    new RegExp(`^${MARKER}:(section|subsection|statement|proof|qed):(.*)$`),
  );
  if (!match) return null;

  const [, kind, encodedText] = match;
  let text = encodedText;
  try {
    text = decodeURIComponent(encodedText);
  } catch {
    // Keep malformed marker text inert rather than interpreting it as HTML.
  }

  if (kind === "statement") {
    const [environment, label] = text.split("|", 2);
    if (
      environment === "definition" ||
      environment === "lemma" ||
      environment === "proposition" ||
      environment === "theorem"
    ) {
      return { kind, text: label, environment };
    }
  }

  return { kind: kind as DocumentBlockKind, text };
}

/**
 * Extract the readable body from the small, trusted subset of LaTeX used by
 * lesson documents. Math is still rendered by MathText/KaTeX; this function
 * never creates or accepts HTML.
 */
export function parseDocumentBlocks(
  source: string,
  complete: boolean,
): DocumentBlock[] {
  const beginToken = "\\begin{document}";
  const endToken = "\\end{document}";
  const begin = source.indexOf(beginToken);
  const end = source.lastIndexOf(endToken);
  let body = source;
  if (begin >= 0) body = body.slice(begin + beginToken.length);
  if (end >= 0) {
    const bodyStart = begin >= 0 ? begin + beginToken.length : 0;
    body = body.slice(0, Math.max(0, end - bodyStart));
  }

  body = body
    .replace(/^\s*%.*$/gm, "")
    .replace(/\\maketitle\b/g, "")
    .replace(/\\tableofcontents\b/g, "")
    .replace(/\\(?:newpage|clearpage)\b/g, "\n\n")
    .replace(/\\(?:title|date|author)\{[^{}]*\}/g, "")
    .replace(/\\label\{[^{}]*\}/g, "")
    .replace(/\\(section|subsection)\*?\{([^{}]*)\}/g, (_all, level, title) =>
      marker(level as "section" | "subsection", title.trim()),
    )
    .replace(
      /\\begin\{(definition|lemma|proposition|theorem)\}(?:\[([^\]]*)\])?/g,
      (_all, environment, optionalTitle) => {
        const title = optionalTitle?.trim() ?? "";
        const displayTitle =
          environment === "definition" ? lowerInitial(title) : title;
        const label = title
          ? `${titleCase(environment)} (${displayTitle})`
          : titleCase(environment);
        return marker("statement", `${environment}|${label}`);
      },
    )
    .replace(/\\end\{(?:definition|lemma|proposition|theorem)\}/g, "\n\n")
    .replace(/\\begin\{proof\}(?:\[([^\]]*)\])?/g, (_all, optionalTitle) =>
      marker("proof", optionalTitle?.trim() || "Proof"),
    )
    .replace(/\\end\{proof\}/g, complete ? marker("qed", "\\square") : "\n\n")
    .trim();

  const blocks = body
    .split(/\n\s*\n/g)
    .map((block) => block.trim())
    .filter(Boolean)
    .map(
      (block) =>
        parseMarker(block) ?? {
          kind: "content" as const,
          text: normalizeLatexParagraph(block),
        },
    );

  let definitionTermPending = false;
  return blocks.map((block) => {
    if (block.kind === "statement") {
      definitionTermPending = block.environment === "definition";
      return block;
    }
    if (definitionTermPending && block.kind === "content") {
      const hasEmphasizedTerm = /\\emph\{[^{}]+\}/.test(block.text);
      const text = block.text.replace(
        /\\emph\{([A-Z])([^{}]*)\}/,
        (_match, first, rest) => `\\emph{${first.toLocaleLowerCase("en")}${rest}}`,
      );
      if (hasEmphasizedTerm) definitionTermPending = false;
      return { ...block, text };
    }
    return block;
  });
}

export function ProofDocument({
  source,
  complete = false,
  documentLabel = "Rendered LaTeX proof",
  emptyMessage = "No proof steps have been accepted yet.",
}: {
  source: string;
  complete?: boolean;
  documentLabel?: string;
  emptyMessage?: string;
}) {
  const blocks = parseDocumentBlocks(source, complete);

  if (!blocks.length) {
    return <p className="empty-copy">{emptyMessage}</p>;
  }

  return (
    <article className="rendered-proof" aria-label={documentLabel}>
      {blocks.map((block, index) => {
        const key = `${index}-${block.kind}-${block.text.slice(0, 24)}`;
        if (block.kind === "section") {
          return (
            <h2 className="document-section" key={key}>
              <MathText>{block.text}</MathText>
            </h2>
          );
        }
        if (block.kind === "subsection") {
          return (
            <h3 className="document-subsection" key={key}>
              <MathText>{block.text}</MathText>
            </h3>
          );
        }
        if (block.kind === "statement") {
          return (
            <p
              className={`proof-label statement-heading statement-heading--${block.environment}`}
              key={key}
            >
              <MathText>{`${block.text}.`}</MathText>
            </p>
          );
        }
        if (block.kind === "proof") {
          return (
            <p className="proof-label" key={key}>
              {block.text}.
            </p>
          );
        }
        if (block.kind === "qed") {
          return (
            <p className="proof-qed" key={key} aria-label="End of proof">
              <MathText>{`$${block.text}$`}</MathText>
            </p>
          );
        }
        return (
          <p key={key}>
            <MathText>{block.text}</MathText>
          </p>
        );
      })}
    </article>
  );
}
