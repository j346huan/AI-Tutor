import katex from "katex";
import type { TutorRoadmapItem } from "./types";

const FORBIDDEN_FRAGMENT_COMMAND =
  /\\(?:(?:begin|end)\s*\{\s*document\s*\}|(?:documentclass|usepackage|RequirePackage|title|author|date|maketitle|part|chapter|section|subsection|subsubsection|paragraph|subparagraph|textbf|textit|texttt|underline|footnote|marginpar|item|newcommand|renewcommand|providecommand|newenvironment|renewenvironment|newtheorem|theoremstyle|bibliography|bibliographystyle|addbibresource|input|include|includegraphics|def|edef|gdef|xdef|let|futurelet|catcode|csname|endcsname|special|write18|write|openout|closeout|read|newread|newwrite|immediate|loop|repeat|href|url|htmlClass|htmlStyle|htmlId)(?![A-Za-z@]))/i;

const ALLOWED_ENVIRONMENTS = new Set([
  "aligned",
  "alignedat",
  "gathered",
  "split",
  "cases",
  "array",
  "matrix",
  "pmatrix",
  "bmatrix",
  "Bmatrix",
  "vmatrix",
  "Vmatrix",
  "smallmatrix",
  "proof",
]);

const PROOF_ENVIRONMENT_PATTERN = /\\begin\s*\{\s*proof\s*\}/i;
const SUPPLEMENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function isEscaped(source: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

function withoutComments(source: string): string {
  return source
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => {
      for (let index = 0; index < line.length; index += 1) {
        if (line[index] === "%" && !isEscaped(line, index)) return line.slice(0, index);
      }
      return line;
    })
    .join("\n");
}

function isInsideMath(source: string, targetIndex: number): boolean {
  let mode: "inline" | "display-dollar" | "paren" | "bracket" | null = null;
  for (let index = 0; index < targetIndex; index += 1) {
    if (isEscaped(source, index)) continue;
    if (source.startsWith("\\(", index) && mode === null) {
      mode = "paren";
      index += 1;
    } else if (source.startsWith("\\)", index) && mode === "paren") {
      mode = null;
      index += 1;
    } else if (source.startsWith("\\[", index) && mode === null) {
      mode = "bracket";
      index += 1;
    } else if (source.startsWith("\\]", index) && mode === "bracket") {
      mode = null;
      index += 1;
    } else if (source.startsWith("$$", index) && (mode === null || mode === "display-dollar")) {
      mode = mode === "display-dollar" ? null : "display-dollar";
      index += 1;
    } else if (source[index] === "$" && (mode === null || mode === "inline")) {
      mode = mode === "inline" ? null : "inline";
    }
  }
  return mode !== null;
}

function closingBraceIndex(source: string, openingIndex: number): number | null {
  let depth = 0;
  for (let index = openingIndex; index < source.length; index += 1) {
    if (isEscaped(source, index)) continue;
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return null;
}

function emphasizedTerms(source: string): string[] | null {
  const terms: string[] = [];
  for (const match of source.matchAll(/\\emph(?![A-Za-z@])/g)) {
    if (isEscaped(source, match.index)) continue;
    const openingIndex = match.index + match[0].length;
    if (source[openingIndex] !== "{" || isInsideMath(source, match.index)) {
      return null;
    }
    const closingIndex = closingBraceIndex(source, openingIndex);
    if (closingIndex === null) return null;
    const term = source.slice(openingIndex + 1, closingIndex);
    if (!term.trim()) return null;
    terms.push(term);
  }
  return terms;
}

function normalizedDefinitionTerm(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
}

/** Whether a definition body visibly emphasizes the exact roadmap term. */
export function definitionEmphasizesTerm(
  latex: string,
  title: string,
): boolean {
  const terms = emphasizedTerms(withoutComments(latex));
  if (!terms) return false;
  const expected = normalizedDefinitionTerm(title);
  return terms.some((term) => normalizedDefinitionTerm(term) === expected);
}

interface MathSegment {
  latex: string;
  displayMode: boolean;
}

function findUnescaped(source: string, token: string, from: number): number {
  let index = source.indexOf(token, from);
  while (index >= 0 && isEscaped(source, index)) {
    index = source.indexOf(token, index + token.length);
  }
  return index;
}

function collectMathSegments(source: string): MathSegment[] | null {
  const segments: MathSegment[] = [];
  for (let index = 0; index < source.length; index += 1) {
    if (isEscaped(source, index)) continue;

    let opening = "";
    let closing = "";
    let displayMode = false;
    if (source.startsWith("\\[", index)) {
      opening = "\\[";
      closing = "\\]";
      displayMode = true;
    } else if (source.startsWith("\\(", index)) {
      opening = "\\(";
      closing = "\\)";
    } else if (source.startsWith("$$", index)) {
      opening = "$$";
      closing = "$$";
      displayMode = true;
    } else if (source[index] === "$") {
      opening = "$";
      closing = "$";
    } else {
      continue;
    }

    const closeIndex = findUnescaped(source, closing, index + opening.length);
    if (closeIndex < 0) return null;
    segments.push({
      latex: source.slice(index + opening.length, closeIndex),
      displayMode,
    });
    index = closeIndex + closing.length - 1;
  }
  return segments;
}

function validateRenderedMath(source: string): string | null {
  const segments = collectMathSegments(source);
  if (!segments) return "The course-note entry has an unmatched math delimiter.";
  try {
    for (const segment of segments) {
      katex.renderToString(segment.latex, {
        displayMode: segment.displayMode,
        throwOnError: true,
        trust: false,
        strict: "error",
        maxExpand: 1_000,
      });
    }
  } catch {
    return "The course-note entry contains mathematics that the local preview cannot render.";
  }
  return null;
}

/**
 * Validates model-authored course-note content before it is inserted into the
 * student's document. The command carries an entry body, never a preamble or
 * complete document.
 */
export function validateCourseNoteLatex(latex: string): string | null {
  if (!latex.trim()) return "The course-note entry is empty.";
  if (latex.length > 100_000) return "The course-note entry is too large.";
  if (FORBIDDEN_FRAGMENT_COMMAND.test(latex)) {
    return "Course-note entries cannot contain document, preamble, file, link, or executable commands.";
  }
  if (
    /<\/?[A-Za-z][A-Za-z0-9-]*(?:(?:\s|\/)[^<>]*)?>/.test(latex) ||
    /<(?:!DOCTYPE|!--|\?xml)/i.test(latex)
  ) {
    return "Course-note entries cannot contain raw HTML.";
  }

  const source = withoutComments(latex);
  let braceDepth = 0;
  let dollarCount = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (isEscaped(source, index)) continue;
    if (source[index] === "{") braceDepth += 1;
    if (source[index] === "}") braceDepth -= 1;
    if (braceDepth < 0) return "A closing brace appears before its opening brace.";
    if (source[index] === "$") dollarCount += 1;
  }
  if (braceDepth !== 0) return "The course-note entry has an unmatched brace.";
  if (dollarCount % 2 !== 0) return "The course-note entry has an unmatched math delimiter.";

  const environmentStack: string[] = [];
  for (const match of source.matchAll(/\\(begin|end)\s*\{\s*([^}]+?)\s*\}/g)) {
    const environment = match[2];
    if (!ALLOWED_ENVIRONMENTS.has(environment)) {
      return "The course-note entry contains an unsupported LaTeX environment.";
    }
    if (environment !== "proof" && !isInsideMath(source, match.index)) {
      return "Mathematical LaTeX environments must occur inside math delimiters.";
    }
    if (match[1] === "begin") {
      environmentStack.push(environment);
    } else if (environmentStack.pop() !== environment) {
      return "The course-note entry has mismatched LaTeX environments.";
    }
  }
  if (environmentStack.length > 0) {
    return "The course-note entry has an unclosed LaTeX environment.";
  }

  const mathDelimiterStack: string[] = [];
  for (const match of source.matchAll(/\\([()[\]])/g)) {
    if (isEscaped(source, match.index)) continue;
    const token = match[1];
    if (token === "(" || token === "[") {
      mathDelimiterStack.push(token);
    } else {
      const expected = token === ")" ? "(" : "[";
      if (mathDelimiterStack.pop() !== expected) {
        return "The course-note entry has mismatched math delimiters.";
      }
    }
  }
  if (mathDelimiterStack.length > 0) {
    return "The course-note entry has an unclosed math delimiter.";
  }

  if (emphasizedTerms(source) === null) {
    return "The \\emph command must wrap nonempty prose outside mathematics.";
  }

  const mathIssue = validateRenderedMath(source);
  if (mathIssue) return mathIssue;

  return null;
}

/**
 * A structured note command supplies the mathematical statement and proof as
 * separate fields. Keeping wrappers out of both fields lets the site own the
 * document structure instead of asking the model to nest environments safely.
 */
export function validateCourseNotePart(latex: string): string | null {
  const issue = validateCourseNoteLatex(latex);
  if (issue) return issue;
  if (PROOF_ENVIRONMENT_PATTERN.test(latex)) {
    return "Course-note statement and proof fields cannot contain a proof wrapper.";
  }
  return null;
}

function escapeLatexText(value: string): string {
  return value.replace(/[\\{}%$#&_~^]|\[|\]/g, (character) => {
    const replacements: Record<string, string> = {
      "\\": String.raw`\textbackslash{}`,
      "{": String.raw`\{`,
      "}": String.raw`\}`,
      "%": String.raw`\%`,
      "$": String.raw`\$`,
      "#": String.raw`\#`,
      "&": String.raw`\&`,
      "_": String.raw`\_`,
      "~": String.raw`\textasciitilde{}`,
      "^": String.raw`\textasciicircum{}`,
      "[": "(",
      "]": ")",
    };
    return replacements[character];
  });
}

function safeTitleLatex(value: string): string {
  const parts = value.split("$");
  if (parts.length % 2 === 0) return escapeLatexText(value);
  return parts
    .map((part, index) => {
      if (index % 2 === 0) return escapeLatexText(part);
      const safeInlineMath =
        part.length > 0 &&
        /^[A-Za-z0-9\s_+\-.,=<>()[\]{}^|]+$/.test(part) &&
        validateCourseNoteLatex(`$${part}$`) === null;
      return safeInlineMath ? `$${part}$` : escapeLatexText(part);
    })
    .join("");
}

function courseNoteTitleLatex(
  item: Pick<TutorRoadmapItem, "kind" | "title">,
): string {
  const title = item.title.trim();
  if (item.kind !== "definition" || !title) return safeTitleLatex(title);

  const [first, ...rest] = Array.from(title);
  const lower = first.toLocaleLowerCase("en");
  const upper = first.toLocaleUpperCase("en");
  const normalized = first === upper && first !== lower
    ? `${lower}${rest.join("")}`
    : title;
  return safeTitleLatex(normalized);
}

function courseNoteOpenings(
  item: Pick<TutorRoadmapItem, "kind" | "title">,
): string[] {
  const current = `\\begin{${item.kind}}[${courseNoteTitleLatex(item)}]`;
  const legacy = `\\begin{${item.kind}}[${safeTitleLatex(item.title.trim())}]`;
  return current === legacy ? [current] : [current, legacy];
}

function splitLegacyProofBody(latex: string): {
  statementLatex: string;
  proofLatex?: string;
} {
  const match = latex.match(
    /^\s*([\s\S]*?)\s*\\begin\s*\{\s*proof\s*\}(?:\s*\[[^\]]*\])?\s*([\s\S]*?)\s*\\end\s*\{\s*proof\s*\}\s*$/i,
  );
  if (!match || !match[1].trim() || !match[2].trim()) {
    return { statementLatex: latex.trim() };
  }
  return {
    statementLatex: match[1].trim(),
    proofLatex: match[2].trim(),
  };
}

/**
 * Wraps generated content using trusted outline metadata from the site.
 * Definitions remain one environment. Theorem-like entries put the statement
 * in its named environment and an optional proof in a following environment.
 * The legacy single-body proof shape is normalized for saved callers.
 */
export function buildCourseNoteEntry(
  item: Pick<TutorRoadmapItem, "kind" | "title">,
  latex: string,
  proofLatex?: string,
): string {
  const title = courseNoteTitleLatex(item);
  const legacy =
    item.kind !== "definition" && proofLatex === undefined
      ? splitLegacyProofBody(latex)
      : { statementLatex: latex.trim(), proofLatex };
  const statement = [
    `\\begin{${item.kind}}[${title}]`,
    legacy.statementLatex,
    `\\end{${item.kind}}`,
  ].join("\n");
  if (item.kind === "definition" || !legacy.proofLatex?.trim()) return statement;
  return [
    statement,
    "",
    "\\begin{proof}",
    legacy.proofLatex.trim(),
    "\\end{proof}",
  ].join("\n");
}

function adjacentProofEnd(source: string, statementEnd: number): number | null {
  const tail = source.slice(statementEnd);
  const opening = tail.match(/^\s*\\begin\s*\{\s*proof\s*\}(?:\s*\[[^\]]*\])?/i);
  if (!opening) return statementEnd;
  const proofStart = statementEnd + opening[0].length;
  const closing = /\\end\s*\{\s*proof\s*\}/gi;
  closing.lastIndex = proofStart;
  const match = closing.exec(source);
  if (!match) return null;
  const nested = /\\begin\s*\{\s*proof\s*\}/gi;
  nested.lastIndex = proofStart;
  const nestedMatch = nested.exec(source);
  if (nestedMatch && nestedMatch.index < match.index) return null;
  return match.index + match[0].length;
}

function generatedCourseNoteRange(
  source: string,
  item: Pick<TutorRoadmapItem, "kind" | "title">,
): { start: number; end: number } | null {
  let matchedOpening: { value: string; index: number } | null = null;
  for (const opening of courseNoteOpenings(item)) {
    let openingIndex = source.indexOf(opening);
    while (openingIndex >= 0) {
      if (matchedOpening) return null;
      matchedOpening = { value: opening, index: openingIndex };
      openingIndex = source.indexOf(opening, openingIndex + opening.length);
    }
  }
  if (!matchedOpening) return null;

  const { value: opening, index: openingIndex } = matchedOpening;
  const bodyStart = openingIndex + opening.length;
  if (
    source[bodyStart] !== "\n" &&
    source.slice(bodyStart, bodyStart + 2) !== "\r\n"
  ) {
    return null;
  }

  const closing = `\\end{${item.kind}}`;
  const closingIndex = source.indexOf(closing, bodyStart);
  if (closingIndex < 0) return null;

  const nestedOpening = `\\begin{${item.kind}}`;
  const nestedOpeningIndex = source.indexOf(nestedOpening, bodyStart);
  if (nestedOpeningIndex >= 0 && nestedOpeningIndex < closingIndex) return null;

  const end = adjacentProofEnd(source, closingIndex + closing.length);
  return end === null ? null : { start: openingIndex, end };
}

/**
 * Inserts a student-requested theorem-like supplement after the current
 * generated outline entry and any earlier supplements. Existing source is
 * retained byte-for-byte; the helper fails closed when the trusted anchor or
 * the document closing cannot be identified exactly once.
 */
export function insertCourseNoteSupplement(
  source: string,
  afterItem: Pick<TutorRoadmapItem, "kind" | "title">,
  supplement: {
    noteId: string;
    kind: "lemma" | "proposition" | "theorem";
    title: string;
  },
  latex: string,
  proofLatex: string,
): string | null {
  if (
    !SUPPLEMENT_ID_PATTERN.test(supplement.noteId) ||
    !supplement.title.trim() ||
    validateCourseNotePart(latex)
  ) {
    return null;
  }
  if (validateCourseNotePart(proofLatex)) return null;
  const anchor = generatedCourseNoteRange(source, afterItem);
  if (anchor === null) return null;

  const entry = buildCourseNoteEntry(supplement, latex, proofLatex);
  const entryOpening = entry.slice(0, entry.indexOf("\n"));
  if (!entryOpening || source.includes(entryOpening)) return null;

  const closings = [
    ...source.matchAll(/\\end\s*\{\s*document\s*\}/gi),
  ];
  if (closings.length !== 1 || closings[0].index === undefined) return null;
  const insertionPoint = closings[0].index;
  if (insertionPoint < anchor.end) return null;
  return `${source.slice(0, insertionPoint)}${entry}\n\n${source.slice(insertionPoint)}`;
}

/**
 * Replaces one generated course-note body while preserving the trusted kind
 * and title wrapper supplied by the lesson. A missing, duplicated, or nested
 * target wrapper fails closed instead of guessing which source range to edit.
 */
export function replaceCourseNoteEntry(
  source: string,
  item: Pick<TutorRoadmapItem, "kind" | "title">,
  latex: string,
  proofLatex?: string,
): string | null {
  if (validateCourseNoteLatex(latex)) return null;
  if (proofLatex !== undefined && validateCourseNotePart(proofLatex)) return null;
  if (proofLatex !== undefined && PROOF_ENVIRONMENT_PATTERN.test(latex)) return null;
  if (item.kind === "definition" && proofLatex !== undefined) return null;

  const replacement = buildCourseNoteEntry(item, latex, proofLatex);
  const firstLineBreak = replacement.indexOf("\n");
  if (firstLineBreak < 0) return null;

  const target = generatedCourseNoteRange(source, item);
  if (target === null) return null;
  return source.slice(0, target.start) + replacement + source.slice(target.end);
}
