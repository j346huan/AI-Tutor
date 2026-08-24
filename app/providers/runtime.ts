import type {
  LessonDefinition,
  LessonDocumentMode,
  LessonRoadmapItem,
  LessonStep,
  MathematicalStatement,
} from "../lessons/types";
import type {
  ProviderDescriptor,
  TutorChoiceSet,
  TutorSessionState,
} from "./types";

export const localCodexProviderDescriptor: ProviderDescriptor = {
  id: "local-codex",
  name: "Personal Codex",
  kind: "local-codex",
  available: true,
  requiresNetwork: true,
  description: "Local Codex tutor.",
};

export const ollamaProviderDescriptor: ProviderDescriptor = {
  id: "ollama",
  name: "Ollama",
  kind: "ollama",
  available: false,
  requiresNetwork: false,
  description: "Future local tutor provider.",
  extensionPoint:
    "Implement TutorProvider, validate the configured endpoint, and preserve the lesson and session contracts.",
};

export const futureProviderDescriptors = [ollamaProviderDescriptor] as const;

export function getActiveStep(
  lesson: LessonDefinition,
  state: TutorSessionState,
): LessonStep | null {
  if (state.lessonId !== lesson.id) return null;
  return lesson.steps[state.activeStepId] ?? null;
}

export function getActiveChoiceSet(
  _lesson: LessonDefinition,
  state: TutorSessionState,
): TutorChoiceSet | null {
  // Selectable approaches are supplied by the active tutor turn. Static lesson
  // choices are retained only as import compatibility data and never drive UI.
  return state.control?.pendingChoiceSet ?? null;
}

export function getTargetStatement(lesson: LessonDefinition) {
  return (
    lesson.settings.curriculum.find(
      (statement) => statement.id === lesson.targetStatementId,
    ) ?? null
  );
}

export function getDocumentMode(lesson: LessonDefinition): LessonDocumentMode {
  return lesson.documentMode ?? "proof";
}

export function getLessonRoadmap(
  lesson: LessonDefinition,
): readonly LessonRoadmapItem[] {
  return lesson.roadmap?.length
    ? lesson.roadmap
    : [{ statementId: lesson.targetStatementId }];
}

export function getCurrentRoadmapItem(
  lesson: LessonDefinition,
  state?: Pick<TutorSessionState, "currentStatementId" | "activeStepId">,
): LessonRoadmapItem | null {
  const roadmap = getLessonRoadmap(lesson);
  const stepStatementId = state
    ? lesson.steps[state.activeStepId]?.focusStatementId
    : undefined;
  const statementId =
    state?.currentStatementId ?? stepStatementId ?? roadmap[0]?.statementId;
  return roadmap.find((item) => item.statementId === statementId) ?? null;
}

export function getNextRoadmapItem(
  lesson: LessonDefinition,
  state: Pick<TutorSessionState, "currentStatementId" | "activeStepId">,
): LessonRoadmapItem | null {
  const roadmap = getLessonRoadmap(lesson);
  const current = getCurrentRoadmapItem(lesson, state);
  if (!current) return null;
  const index = roadmap.findIndex(
    (item) => item.statementId === current.statementId,
  );
  return index >= 0 ? (roadmap[index + 1] ?? null) : null;
}

export function getCurrentStatement(
  lesson: LessonDefinition,
  state?: Pick<TutorSessionState, "currentStatementId" | "activeStepId">,
): MathematicalStatement | null {
  const statementId = getCurrentRoadmapItem(lesson, state)?.statementId;
  return (
    lesson.settings.curriculum.find((statement) => statement.id === statementId) ??
    getTargetStatement(lesson)
  );
}

export function buildCanonicalProof(
  lesson: LessonDefinition,
  fragmentIds: readonly string[],
): string {
  const fragments = fragmentIds
    .map((id) => lesson.proof.fragments[id]?.latex)
    .filter((fragment): fragment is string => Boolean(fragment));

  const body =
    fragments.length > 0
      ? fragments.join("\n\n")
      : getDocumentMode(lesson) === "course-notes"
        ? ""
        : "% Your proof will grow here as steps are justified.";

  return [
    lesson.proof.preamble,
    lesson.proof.opening,
    body,
    lesson.proof.closing,
  ].join("\n\n");
}

export const buildCanonicalDocument = buildCanonicalProof;

export function validateProofLatex(latex: string): string | null {
  if (!latex.trim()) return "The LaTeX field is empty, so there is nothing to render.";
  if (latex.length > 100_000) {
    return "This draft is too large for the local site (maximum 100,000 characters).";
  }

  if (
    /\\(?:input|include|includegraphics|write18|href|url|htmlClass|htmlStyle|htmlId)\b/i.test(
      latex,
    ) ||
    /<(?:script|iframe|object|embed)\b/i.test(latex)
  ) {
    return "This preview does not allow file, link, HTML, or executable LaTeX commands.";
  }

  let braceDepth = 0;
  for (let index = 0; index < latex.length; index += 1) {
    if (latex[index] === "{" && latex[index - 1] !== "\\") braceDepth += 1;
    if (latex[index] === "}" && latex[index - 1] !== "\\") braceDepth -= 1;
    if (braceDepth < 0) return "A closing brace appears before its matching opening brace.";
  }
  if (braceDepth !== 0) return "The draft has an unmatched LaTeX brace.";

  const environmentStack: string[] = [];
  for (const match of latex.matchAll(/\\(begin|end)\{([^}]+)\}/g)) {
    if (match[1] === "begin") {
      environmentStack.push(match[2]);
    } else if (environmentStack.pop() !== match[2]) {
      return "One or more LaTeX environments do not have matching begin and end commands.";
    }
  }
  if (environmentStack.length > 0) {
    return "One or more LaTeX environments do not have matching begin and end commands.";
  }

  return null;
}
