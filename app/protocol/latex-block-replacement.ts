export const EDITABLE_LATEX_ENVIRONMENTS = [
  "definition",
  "lemma",
  "proposition",
  "theorem",
  "proof",
] as const;

export type EditableLatexEnvironment =
  (typeof EDITABLE_LATEX_ENVIRONMENTS)[number];

export type LatexBlockReplacementResult =
  | {
      ok: true;
      latex: string;
      environment: EditableLatexEnvironment;
    }
  | { ok: false; error: string };

const ENVIRONMENT_PATTERN = EDITABLE_LATEX_ENVIRONMENTS.join("|");

/**
 * Accept only one complete, named mathematical environment. Nested equation
 * environments are fine, but the outer editable environment must be unique.
 */
export function getEditableLatexEnvironment(
  block: string,
): EditableLatexEnvironment | null {
  const trimmed = block.trim();
  const opening = trimmed.match(
    new RegExp(`^\\\\begin\\s*\\{\\s*(${ENVIRONMENT_PATTERN})\\s*\\}`, "i"),
  );
  if (!opening) return null;

  const environment = opening[1].toLowerCase() as EditableLatexEnvironment;
  const escapedEnvironment = environment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const closing = new RegExp(
    `\\\\end\\s*\\{\\s*${escapedEnvironment}\\s*\\}\\s*$`,
    "i",
  );
  if (!closing.test(trimmed)) return null;

  const boundaryPattern = new RegExp(
    `\\\\(begin|end)\\s*\\{\\s*${escapedEnvironment}\\s*\\}`,
    "gi",
  );
  const boundaries = [...trimmed.matchAll(boundaryPattern)];
  if (
    boundaries.length !== 2 ||
    boundaries[0][1].toLowerCase() !== "begin" ||
    boundaries[1][1].toLowerCase() !== "end"
  ) {
    return null;
  }
  return environment;
}

/** Replace one exact environment block without normalizing unrelated source. */
export function replaceExactLatexBlock(
  source: string,
  target: string,
  replacement: string,
): LatexBlockReplacementResult {
  const targetEnvironment = getEditableLatexEnvironment(target);
  if (!targetEnvironment) {
    return {
      ok: false,
      error:
        "The target must be one complete definition, lemma, proposition, theorem, or proof environment.",
    };
  }
  const replacementEnvironment = getEditableLatexEnvironment(replacement);
  if (!replacementEnvironment || replacementEnvironment !== targetEnvironment) {
    return {
      ok: false,
      error: "The replacement must use the same complete LaTeX environment as the target.",
    };
  }

  const first = source.indexOf(target);
  if (first < 0) {
    return {
      ok: false,
      error: "The target LaTeX block does not exactly match the current document.",
    };
  }
  if (source.indexOf(target, first + target.length) >= 0) {
    return {
      ok: false,
      error: "The target LaTeX block occurs more than once in the current document.",
    };
  }

  return {
    ok: true,
    environment: targetEnvironment,
    latex: `${source.slice(0, first)}${replacement}${source.slice(first + target.length)}`,
  };
}
