"use client";

import DOMPurify from "dompurify";
import katex from "katex";
import { Fragment, useEffect, useRef, type ReactNode } from "react";

type Segment =
  | { kind: "text"; value: string }
  | { kind: "math"; value: string; display: boolean }
  | { kind: "emphasis"; children: Segment[] };

const CONTROL_CHARACTER_LATEX_PREFIX = new Map<string, string>([
  ["\u0007", "a"],
  ["\u0008", "b"],
  ["\u000c", "f"],
  ["\n", "n"],
  ["\r", "r"],
  ["\t", "t"],
]);

const REPAIRABLE_LATEX_COMMANDS = new Set([
  "alpha",
  "bar",
  "begin",
  "beta",
  "frac",
  "nabla",
  "ne",
  "neg",
  "neq",
  "nmid",
  "not",
  "notin",
  "nu",
  "rangle",
  "rho",
  "right",
  "rightarrow",
  "tau",
  "text",
  "theta",
  "times",
  "to",
]);

/**
 * Repairs only recognized LaTeX commands whose initial backslash and letter
 * were decoded as a control character (for example U+0007 + `lpha`). This is
 * deliberately applied to delimited mathematics, never surrounding prose.
 */
export function normalizeMathSource(source: string): string {
  let normalized = "";
  for (let index = 0; index < source.length; index += 1) {
    const prefix = CONTROL_CHARACTER_LATEX_PREFIX.get(source[index]);
    if (!prefix || (source[index] === "\n" && source[index - 1] === "\r")) {
      normalized += source[index];
      continue;
    }

    let end = index + 1;
    while (end < source.length && /[A-Za-z]/.test(source[end])) end += 1;
    const command = prefix + source.slice(index + 1, end);
    if (!REPAIRABLE_LATEX_COMMANDS.has(command)) {
      normalized += source[index];
      continue;
    }

    normalized += `\\${command}`;
    index = end - 1;
  }
  return normalized;
}

function isEscaped(value: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

function findClosingDelimiter(
  value: string,
  delimiter: "\\)" | "\\]",
  start: number,
): number {
  let cursor = start;
  while (cursor < value.length) {
    const candidate = value.indexOf(delimiter, cursor);
    if (candidate === -1) return -1;
    if (!isEscaped(value, candidate)) return candidate;
    cursor = candidate + delimiter.length;
  }
  return -1;
}

function findClosingBrace(value: string, openingIndex: number): number {
  let depth = 0;
  for (let cursor = openingIndex; cursor < value.length; cursor += 1) {
    if (isEscaped(value, cursor)) continue;
    if (value[cursor] === "{") depth += 1;
    if (value[cursor] === "}") {
      depth -= 1;
      if (depth === 0) return cursor;
    }
  }
  return -1;
}

export function parseMathSegments(value: string): Segment[] {
  const segments: Segment[] = [];
  let textStart = 0;
  let cursor = 0;

  const pushText = (end: number) => {
    if (end > textStart) {
      segments.push({ kind: "text", value: value.slice(textStart, end) });
    }
  };

  while (cursor < value.length) {
    if (value.startsWith("\\emph{", cursor) && !isEscaped(value, cursor)) {
      const openingIndex = cursor + "\\emph".length;
      const end = findClosingBrace(value, openingIndex);
      if (end !== -1) {
        pushText(cursor);
        segments.push({
          kind: "emphasis",
          children: parseMathSegments(value.slice(openingIndex + 1, end)),
        });
        cursor = end + 1;
        textStart = cursor;
        continue;
      }
    }

    const slashDelimiter = value.startsWith("\\[", cursor)
      ? { closing: "\\]" as const, display: true }
      : value.startsWith("\\(", cursor)
        ? { closing: "\\)" as const, display: false }
        : null;

    if (slashDelimiter && !isEscaped(value, cursor)) {
      const end = findClosingDelimiter(value, slashDelimiter.closing, cursor + 2);
      if (end !== -1) {
        pushText(cursor);
        segments.push({
          kind: "math",
          value: normalizeMathSource(value.slice(cursor + 2, end)),
          display: slashDelimiter.display,
        });
        cursor = end + 2;
        textStart = cursor;
        continue;
      }
    }

    if (value[cursor] === "$" && !isEscaped(value, cursor)) {
      const double = value[cursor + 1] === "$";
      const openingLength = double ? 2 : 1;
      let end = cursor + openingLength;
      while (end < value.length) {
        if (
          value[end] === "$" &&
          !isEscaped(value, end) &&
          (!double || value[end + 1] === "$")
        ) {
          break;
        }
        end += 1;
      }
      if (end < value.length) {
        pushText(cursor);
        segments.push({
          kind: "math",
          value: normalizeMathSource(value.slice(cursor + openingLength, end)),
          display: double,
        });
        cursor = end + openingLength;
        textStart = cursor;
        continue;
      }
    }
    cursor += 1;
  }

  pushText(value.length);
  return segments.length ? segments : [{ kind: "text", value }];
}

/**
 * The composer preview is useful for display mathematics, where the rendered
 * layout differs substantially from the source. Keep it out of the way for
 * ordinary prose and inline mathematics.
 */
export function hasDisplayMath(value: string): boolean {
  const containsDisplayMath = (segments: Segment[]): boolean =>
    segments.some(
      (segment) =>
        (segment.kind === "math" && segment.display) ||
        (segment.kind === "emphasis" && containsDisplayMath(segment.children)),
    );
  return containsDisplayMath(parseMathSegments(value));
}

function SafeKatex({ source, display }: { source: string; display: boolean }) {
  const hostRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    try {
      const html = katex.renderToString(source, {
        displayMode: display,
        output: "htmlAndMathml",
        strict: "warn",
        throwOnError: true,
        trust: false,
        maxExpand: 1_000,
      });
      const clean = DOMPurify.sanitize(html, {
        USE_PROFILES: { html: true, mathMl: true, svg: true },
        FORBID_TAGS: ["script", "style", "iframe", "object", "embed"],
        FORBID_ATTR: ["onerror", "onload", "onclick"],
      });
      const template = document.createElement("template");
      template.innerHTML = clean;
      hostRef.current.replaceChildren(template.content.cloneNode(true));
    } catch {
      const message = document.createElement("span");
      message.className = "math-render-error";
      message.setAttribute("role", "status");
      message.textContent = `This expression could not be rendered: ${source}`;
      hostRef.current.replaceChildren(message);
    }
  }, [display, source]);

  return (
    <span
      className={display ? "math-fragment math-fragment--display" : "math-fragment"}
      data-math-source={source}
    >
      <span ref={hostRef} aria-label={source} />
    </span>
  );
}

function renderSafeMarkdownInline(value: string): ReactNode[] {
  const output: ReactNode[] = [];
  const token = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\))/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = token.exec(value))) {
    if (match.index > cursor) output.push(value.slice(cursor, match.index));
    if (match[2]) {
      output.push(<strong key={`strong-${match.index}`}>{match[2]}</strong>);
    } else if (match[3]) {
      output.push(<code key={`code-${match.index}`}>{match[3]}</code>);
    } else if (match[4] && match[5]) {
      output.push(
        <a key={`link-${match.index}`} href={match[5]} target="_blank" rel="noreferrer">
          {match[4]}
        </a>,
      );
    }
    cursor = token.lastIndex;
  }
  if (cursor < value.length) output.push(value.slice(cursor));
  return output;
}

function SafeText({ value }: { value: string }) {
  const lines = value.split("\n");
  return (
    <>
      {lines.map((line, index) => (
        <Fragment key={`${index}-${line.slice(0, 12)}`}>
          {renderSafeMarkdownInline(line)}
          {index < lines.length - 1 ? <br /> : null}
        </Fragment>
      ))}
    </>
  );
}

function renderSegments(segments: Segment[], keyPrefix = "segment"): ReactNode[] {
  return segments.map((segment, index) => {
    const key = `${keyPrefix}-${index}`;
    if (segment.kind === "math") {
      return (
        <SafeKatex
          key={key}
          source={segment.value}
          display={segment.display}
        />
      );
    }
    if (segment.kind === "emphasis") {
      return <em key={key}>{renderSegments(segment.children, key)}</em>;
    }
    return <SafeText key={key} value={segment.value} />;
  });
}

export function MathText({
  children,
  className = "",
}: {
  children: string;
  className?: string;
}) {
  const segments = parseMathSegments(children);
  return (
    <span className={`math-text ${className}`.trim()}>
      {renderSegments(segments)}
    </span>
  );
}

export function validateLatex(source: string): string | null {
  try {
    katex.renderToString(source, {
      displayMode: true,
      output: "htmlAndMathml",
      strict: "error",
      throwOnError: true,
      trust: false,
      maxExpand: 1_000,
    });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message.replace(/^KaTeX parse error:\s*/i, "") : "Invalid LaTeX.";
  }
}
