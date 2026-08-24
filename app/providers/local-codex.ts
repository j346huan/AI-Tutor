import type { LessonDefinition, LessonMode } from "../lessons/types";
import {
  TUTOR_PROTOCOL_LIMITS,
  TUTOR_PROTOCOL_VERSION,
  TutorProtocolValidationError,
  buildCourseNoteEntry,
  buildTutorPrompt,
  buildTutorRequest,
  definitionEmphasizesTerm,
  insertCourseNoteSupplement,
  isCourseItemReadyToAdvance,
  parseTutorResponse,
  replaceCourseNoteEntry,
  replaceExactLatexBlock,
  type TutorStudentIntent,
  type TutorPinnedChoice,
  type TutorRequestEnvelope,
  type TutorResponseEnvelope,
  type TutorStudentInput,
  validateCourseNotePart,
} from "../protocol";
import {
  buildCanonicalProof,
  getActiveChoiceSet,
  getCurrentRoadmapItem,
  getCurrentStatement,
  getDocumentMode,
  getLessonRoadmap,
  getNextRoadmapItem,
  localCodexProviderDescriptor,
  validateProofLatex,
} from "./runtime";
import type {
  StudentIntent,
  ProviderResult,
  TutorAction,
  TutorChoiceSet,
  TutorMessage,
  TutorMessageKind,
  TutorProvider,
  TutorProviderContext,
  TutorSessionState,
} from "./types";

const BRIDGE_URL = "http://127.0.0.1:3210/v1/respond";
const CODEX_TIMEOUT_MS = 95_000;
const INITIALIZATION_PREVIEW_REQUEST_ID = "initialization-preview-v1";

interface BridgeSuccess {
  ok: true;
  protocolVersion: string;
  output: unknown;
}

interface BridgeFailure {
  ok: false;
  error?: string;
}

export type LocalCodexTransport = (
  request: TutorRequestEnvelope,
  prompt: string,
  signal?: AbortSignal,
) => Promise<unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function defaultTransport(
  request: TutorRequestEnvelope,
  prompt: string,
  externalSignal?: AbortSignal,
): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  externalSignal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, CODEX_TIMEOUT_MS);

  try {
    let response: Response;
    try {
      response = await fetch(BRIDGE_URL, {
        method: "POST",
        cache: "no-store",
        credentials: "omit",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          protocolVersion: TUTOR_PROTOCOL_VERSION,
          request,
          prompt,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) throw new Error("codex_timeout");
      if (error instanceof TypeError) throw new Error("bridge_unreachable");
      throw error;
    }

    let raw: BridgeSuccess | BridgeFailure;
    try {
      raw = (await response.json()) as BridgeSuccess | BridgeFailure;
    } catch {
      throw new Error("invalid_bridge_response");
    }
    if (!response.ok || !isRecord(raw) || raw.ok !== true) {
      const code = isRecord(raw) && typeof raw.error === "string" ? raw.error : "bridge_error";
      throw new Error(code);
    }
    if (raw.protocolVersion !== TUTOR_PROTOCOL_VERSION) {
      throw new Error("protocol_mismatch");
    }
    return raw.output;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", abort);
  }
}

function providerContext(
  lesson: LessonDefinition,
  context?: TutorProviderContext,
): TutorProviderContext {
  return (
    context ?? {
      profile: {
        name: lesson.settings.profile.name,
        personality: lesson.settings.profile.personality,
        customPrompts: lesson.settings.profile.customPrompts,
      },
      studentBackground: lesson.settings.studentBackgroundPrompt,
      curriculum: lesson.settings.curriculum.map(({ kind, title, latex }) => ({
        kind,
        title,
        ...(latex ? { statementLatex: latex } : {}),
      })),
    }
  );
}

function protocolMode(state: TutorSessionState) {
  if (state.status === "completed") return "completed" as const;
  if (state.mode === "proof") return "proof" as const;
  if (state.mode === "reflection") return "reflection" as const;
  return "learning" as const;
}

function lessonMode(mode: "learning" | "proof" | "reflection" | "completed"): LessonMode {
  if (mode === "proof") return "proof";
  if (mode === "reflection" || mode === "completed") return "reflection";
  return "orientation";
}

function nextRequestId(state: TutorSessionState): string {
  const timestamp = Date.now().toString(36);
  return `turn-${timestamp}-${state.messages.length}-${state.proof.revision}`;
}

function boundedTranscript(messages: readonly TutorMessage[]) {
  const selected: Array<{ role: TutorMessage["role"]; content: string }> = [];
  let characters = 0;
  for (const message of messages.slice(-TUTOR_PROTOCOL_LIMITS.transcriptEntries).reverse()) {
    const content = message.markdown.slice(0, TUTOR_PROTOCOL_LIMITS.text);
    if (!content) continue;
    if (characters + content.length > TUTOR_PROTOCOL_LIMITS.totalTranscriptCharacters) break;
    selected.push({ role: message.role, content });
    characters += content.length;
  }
  return selected.reverse();
}

function protocolChoices(
  choiceSet: ReturnType<typeof getActiveChoiceSet>,
): TutorPinnedChoice[] {
  if (!choiceSet) return [];
  const kind = "kind" in choiceSet ? choiceSet.kind : "approach";
  // Ignore learning-action sets restored from older sessions. Continue is now
  // a local, readiness-gated composer action sent as a normal message.
  if (kind === "learning_action") return [];
  return choiceSet.choices
    .slice(0, TUTOR_PROTOCOL_LIMITS.pinnedChoices)
    .map((choice) => ({
      id: choice.id,
      kind,
      label: choice.label,
      ...(getChoiceDescription(choice)
        ? { explanation: getChoiceDescription(choice) }
        : {}),
    }));
}

/** The UI and provider share the same local gate for exposing Continue. */
export function isCurrentCourseItemReady(
  lesson: LessonDefinition,
  state: TutorSessionState,
): boolean {
  const current = getCurrentRoadmapItem(lesson, state);
  return Boolean(
    state.status === "active" &&
      current &&
      isCourseItemReadyToAdvance({
        documentMode: getDocumentMode(lesson),
        currentStatementId: current.statementId,
        completedStatementIds: state.completedStatementIds ?? [],
        writtenStatementIds: state.proof.courseNoteStatementIds ?? [],
        roadmap: getLessonRoadmap(lesson),
      }),
  );
}

function getChoiceDescription(choice: { description?: string; explanation?: string }) {
  return choice.description ?? choice.explanation;
}

function actionInput(
  action: Exclude<TutorAction, { type: "render-proof" }>,
  choiceSet: ReturnType<typeof getActiveChoiceSet>,
  previousProofLatex?: string,
): TutorStudentInput {
  const choice = (id: string) => choiceSet?.choices.find((option) => option.id === id);

  switch (action.type) {
    case "request-hint":
      return { kind: "hint_request", text: "Please give a small hint." };
    case "request-proof-feedback":
      return {
        kind: "proof_feedback_request",
        text:
          "Review the submitted LaTeX edit. Address its changed region and every substantive LaTeX comment, using the recent conversation as context.",
        proofEdit: buildProofEditContext(previousProofLatex ?? action.latex, action.latex),
      };
    case "choose": {
      const selected = choice(action.choiceId);
      return {
        kind: "choice",
        text: selected?.label ?? "I choose this option.",
        selectedChoiceId: action.choiceId,
      };
    }
    case "ask-about-choice": {
      const selected = choice(action.choiceId);
      return {
        kind: "message",
        text:
          action.question?.trim() ||
          `What would the option “${selected?.label ?? action.choiceId}” accomplish?`,
        selectedChoiceId: action.choiceId,
      };
    }
    case "message":
      return {
        kind: "message",
        text: action.text.trim(),
        ...(action.selectedChoiceId ? { selectedChoiceId: action.selectedChoiceId } : {}),
      };
  }
}

function changedProofLines(previousLatex: string, currentLatex: string): string {
  if (previousLatex === currentLatex) {
    return "No textual changes since the last rendered proof.";
  }

  const previous = previousLatex.replace(/\r\n/g, "\n").split("\n");
  const current = currentLatex.replace(/\r\n/g, "\n").split("\n");
  let prefix = 0;
  while (
    prefix < previous.length &&
    prefix < current.length &&
    previous[prefix] === current[prefix]
  ) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < previous.length - prefix &&
    suffix < current.length - prefix &&
    previous[previous.length - 1 - suffix] === current[current.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const removed = previous.slice(prefix, previous.length - suffix);
  const added = current.slice(prefix, current.length - suffix);
  const sections = [`Changed region begins at line ${prefix + 1}.`];
  if (removed.length) {
    sections.push(`Previous region:\n${removed.map((line) => `- ${line}`).join("\n")}`);
  }
  if (added.length) {
    sections.push(`Current region:\n${added.map((line) => `+ ${line}`).join("\n")}`);
  }
  return sections.join("\n\n").slice(0, TUTOR_PROTOCOL_LIMITS.text);
}

function latexComments(latex: string): string[] {
  const comments: string[] = [];
  const lines = latex.replace(/\r\n/g, "\n").split("\n");
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    for (let index = 0; index < line.length; index += 1) {
      if (line[index] !== "%") continue;
      let slashes = 0;
      for (let cursor = index - 1; cursor >= 0 && line[cursor] === "\\"; cursor -= 1) {
        slashes += 1;
      }
      if (slashes % 2 === 1) continue;
      const comment = line.slice(index + 1).trim();
      if (comment) {
        comments.push(
          `Line ${lineIndex + 1}: ${comment}`.slice(0, TUTOR_PROTOCOL_LIMITS.shortText),
        );
      }
      break;
    }
    if (comments.length >= TUTOR_PROTOCOL_LIMITS.proofComments) break;
  }
  return comments;
}

function buildProofEditContext(previousLatex: string, currentLatex: string) {
  return {
    previousLatex: previousLatex.slice(0, TUTOR_PROTOCOL_LIMITS.latex),
    changed: changedProofLines(previousLatex, currentLatex),
    comments: latexComments(currentLatex),
  };
}

function buildRequest(
  lesson: LessonDefinition,
  state: TutorSessionState,
  studentInput: TutorStudentInput,
  context?: TutorProviderContext,
  requestId = nextRequestId(state),
) {
  const target = getCurrentStatement(lesson, state);
  if (!target) throw new Error("missing_statement");
  const configured = providerContext(lesson, context);
  const choiceSet = getActiveChoiceSet(lesson, state);
  const isCourseNotes = getDocumentMode(lesson) === "course-notes";
  const curriculum = isCourseNotes
    ? lesson.settings.curriculum.map(({ kind, title }) => ({ kind, title }))
    : configured.curriculum;
  const proofLatex = validateProofLatex(state.proof.editorLatex)
    ? state.proof.previewLatex
    : state.proof.editorLatex;
  const roadmap = getLessonRoadmap(lesson)
    .slice(0, TUTOR_PROTOCOL_LIMITS.roadmapItems)
    .map((item) => {
      const statement = lesson.settings.curriculum.find(
        (candidate) => candidate.id === item.statementId,
      );
      if (!statement) throw new Error("invalid_roadmap");
      return {
        statementId: statement.id,
        kind: statement.kind,
        title: statement.title.slice(0, TUTOR_PROTOCOL_LIMITS.shortText),
      };
    });

  return buildTutorRequest({
    requestId,
    profile: {
      name: configured.profile.name.slice(0, TUTOR_PROTOCOL_LIMITS.name),
      personality: configured.profile.personality.slice(0, TUTOR_PROTOCOL_LIMITS.text),
      customInstructions: configured.profile.customPrompts
        .slice(0, TUTOR_PROTOCOL_LIMITS.customInstructions)
        .map((instruction) => instruction.slice(0, TUTOR_PROTOCOL_LIMITS.text)),
    },
    studentBackground: (
      configured.studentName?.trim()
        ? `The student's name is ${configured.studentName.trim()}. ${configured.studentBackground}`
        : configured.studentBackground
    ).slice(0, TUTOR_PROTOCOL_LIMITS.text),
    curriculum: curriculum
      .slice(0, TUTOR_PROTOCOL_LIMITS.curriculumItems)
      .map((item) => ({
        kind: item.kind,
        title: item.title.slice(0, TUTOR_PROTOCOL_LIMITS.shortText),
        ...(!isCourseNotes &&
        "statementLatex" in item &&
        typeof item.statementLatex === "string" &&
        item.statementLatex
          ? {
              statementLatex: item.statementLatex.slice(
                0,
                TUTOR_PROTOCOL_LIMITS.curriculumText,
              ),
            }
          : {}),
      })),
    theorem: {
      id: target.id,
      kind: target.kind,
      title: target.title.slice(0, TUTOR_PROTOCOL_LIMITS.shortText),
      ...(!isCourseNotes && target.statement
        ? { statement: target.statement.slice(0, TUTOR_PROTOCOL_LIMITS.text) }
        : {}),
      ...(!isCourseNotes && target.latex
        ? { latex: target.latex.slice(0, TUTOR_PROTOCOL_LIMITS.latex) }
        : {}),
    },
    lessonPlan: {
      documentMode: getDocumentMode(lesson),
      currentStatementId: target.id,
      completedStatementIds: (state.completedStatementIds ?? [])
        .filter((id) => roadmap.some((item) => item.statementId === id))
        .slice(0, TUTOR_PROTOCOL_LIMITS.roadmapItems),
      writtenStatementIds: (state.proof.courseNoteStatementIds ?? [])
        .filter((id) => roadmap.some((item) => item.statementId === id))
        .slice(0, TUTOR_PROTOCOL_LIMITS.roadmapItems),
      courseNoteEntries: (state.proof.courseNoteEntries ?? [])
        .filter((entry) =>
          roadmap.some((item) => item.statementId === entry.statementId),
        )
        .slice(0, TUTOR_PROTOCOL_LIMITS.roadmapItems)
        .map((entry) => ({
          statementId: entry.statementId,
          latex: entry.latex.slice(0, TUTOR_PROTOCOL_LIMITS.latex),
          ...(entry.proofLatex
            ? { proofLatex: entry.proofLatex.slice(0, TUTOR_PROTOCOL_LIMITS.latex) }
            : {}),
          complete: entry.complete,
        })),
      roadmap,
    },
    mode: protocolMode(state),
    currentProof: {
      latex: proofLatex.slice(0, TUTOR_PROTOCOL_LIMITS.latex),
      revision: state.proof.revision,
    },
    recentTranscript: boundedTranscript(state.messages),
    pinnedChoices: protocolChoices(choiceSet),
    studentInput,
  });
}

function initialSessionState(lesson: LessonDefinition): TutorSessionState {
  const latex = buildCanonicalProof(lesson, []);
  const currentStatementId = getLessonRoadmap(lesson)[0]?.statementId;
  return {
    schemaVersion: 1,
    lessonId: lesson.id,
    lessonContentVersion: lesson.contentVersion ?? 1,
    providerId: localCodexProviderDescriptor.id,
    status: "active",
    mode: "orientation",
    activeStepId: lesson.initialStepId,
    ...(currentStatementId ? { currentStatementId } : {}),
    completedStatementIds: [],
    messages: [],
    proof: {
      fragmentIds: [],
      courseNoteStatementIds: [],
      courseNoteEntries: [],
      canonicalLatex: latex,
      editorLatex: latex,
      previewLatex: latex,
      reviewedLatex: latex,
      source: "tutor",
      revision: 0,
      feedback: "",
    },
    hintsUsed: 0,
    mistakesSeen: 0,
    control: {},
  };
}

export interface InitializationPromptPreview {
  request: TutorRequestEnvelope;
  prompt: string;
}

/**
 * Pure preview of the first Personal Codex turn. It uses the same validated
 * request and prompt builders as createSession, but a stable non-live ID.
 */
export function buildInitializationPromptPreview(
  lesson: LessonDefinition,
  context?: TutorProviderContext,
): InitializationPromptPreview {
  const request = buildRequest(
    lesson,
    initialSessionState(lesson),
    { kind: "session_start", text: "" },
    context,
    INITIALIZATION_PREVIEW_REQUEST_ID,
  );
  return { request, prompt: buildTutorPrompt(request) };
}

function nextMessage(
  state: TutorSessionState,
  role: TutorMessage["role"],
  kind: TutorMessageKind,
  markdown: string,
): TutorMessage {
  const sequence = state.messages.length + 1;
  return {
    id: `${state.lessonId}-message-${sequence}`,
    sequence,
    role,
    kind,
    markdown,
  };
}

function appendMessage(
  state: TutorSessionState,
  role: TutorMessage["role"],
  kind: TutorMessageKind,
  markdown: string,
) {
  const message = nextMessage(state, role, kind, markdown);
  return { state: { ...state, messages: [...state.messages, message] }, message };
}

function mapIntent(intent: TutorStudentIntent): StudentIntent {
  switch (intent) {
    case "mathematical_question":
    case "question_about_choice":
      return "question";
    case "proposed_approach":
      return "proposed_approach";
    case "proof_step":
    case "edit_proof":
      return "proposed_proof_step";
    case "confusion":
      return "confusion";
    case "request_hint":
      return "request_for_hint";
    case "request_proof_feedback":
      return "request_for_feedback";
    case "select_choice":
      return "choice_selection";
    case "off_topic":
      return "off_topic";
    case "session_start":
    case "unclear":
      return "unclear";
  }
}

function insertProofFragment(source: string, fragment: string): string {
  const closing = "\\end{proof}";
  const position = source.lastIndexOf(closing);
  if (position < 0) return `${source.trimEnd()}\n\n${fragment.trim()}\n`;
  return `${source.slice(0, position).trimEnd()}\n\n${fragment.trim()}\n${source.slice(position)}`;
}

function insertCourseNoteFragment(
  lesson: LessonDefinition,
  source: string,
  fragment: string,
): string {
  const closing = lesson.proof.closing;
  const position = closing ? source.lastIndexOf(closing) : -1;
  if (position < 0) return `${source.trimEnd()}\n\n${fragment.trim()}\n`;
  return `${source.slice(0, position).trimEnd()}\n\n${fragment.trim()}\n\n${source.slice(position)}`;
}

const DANGEROUS_DOCUMENT_COMMAND =
  /\\(?:(?:def|edef|gdef|xdef|let|futurelet|catcode|csname|endcsname|special|write18|write|openout|closeout|read|newread|newwrite|immediate|loop|repeat)(?![A-Za-z@]))/i;

function validateCourseNoteDocumentReplacement(
  lesson: LessonDefinition,
  latex: string,
): string | null {
  const beginDocuments = latex.match(/\\begin\s*\{\s*document\s*\}/gi) ?? [];
  const endDocuments = latex.match(/\\end\s*\{\s*document\s*\}/gi) ?? [];
  if (beginDocuments.length !== 1 || endDocuments.length !== 1) {
    return "A course-note rewrite must contain one complete document.";
  }

  const trustedPreamble = lesson.proof.preamble.trimEnd();
  const trustedClosing = lesson.proof.closing.trim();
  if (
    !latex.startsWith(trustedPreamble) ||
    !trustedClosing ||
    !latex.trimEnd().endsWith(trustedClosing)
  ) {
    return "A course-note rewrite must preserve the lesson's document shell.";
  }
  if (DANGEROUS_DOCUMENT_COMMAND.test(latex)) {
    return "A course-note rewrite contains an unsafe LaTeX command.";
  }
  if (
    /<\/?[A-Za-z][A-Za-z0-9-]*(?:(?:\s|\/)[^<>]*)?>/.test(latex) ||
    /<(?:!DOCTYPE|!--|\?xml)/i.test(latex)
  ) {
    return "A course-note rewrite cannot contain raw HTML.";
  }
  return null;
}

function updateProof(
  state: TutorSessionState,
  latex: string,
  markReviewed = false,
): TutorSessionState | null {
  if (validateProofLatex(latex)) return null;
  const sourceChanged = latex !== state.proof.previewLatex;
  return {
    ...state,
    proof: {
      ...state.proof,
      canonicalLatex: latex,
      editorLatex: latex,
      previewLatex: latex,
      ...(markReviewed ? { reviewedLatex: latex } : {}),
      source: "student-edit",
      revision: state.proof.revision + (sourceChanged ? 1 : 0),
      feedback: "",
    },
  };
}

function containsMathDelimiter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const isSlashDelimiter =
      character === "\\" && (value[index + 1] === "(" || value[index + 1] === "[");
    if (character !== "$" && !isSlashDelimiter) continue;

    let precedingSlashes = 0;
    for (
      let cursor = index - 1;
      cursor >= 0 && value[cursor] === "\\";
      cursor -= 1
    ) {
      precedingSlashes += 1;
    }
    if (precedingSlashes % 2 === 0) return true;
  }
  return false;
}

function nextSentenceLabel(source: string): string {
  const sentence = source.trim();
  // Codex may return a complete proof sentence with its own inline delimiters.
  // Preserve that prose instead of nesting it inside another pair of dollar signs.
  return containsMathDelimiter(sentence) ? sentence : `$${sentence}$`;
}

function choiceSetFromCommand(
  command:
    | Extract<TutorResponseEnvelope["commands"][number], { type: "propose_approaches" }>
    | Extract<TutorResponseEnvelope["commands"][number], { type: "propose_next_sentences" }>,
  requestId: string,
): TutorChoiceSet {
  if (command.type === "propose_approaches") {
    return {
      id: `codex-${requestId}`,
      kind: "approach",
      title: "Approaches",
      prompt: command.prompt,
      choices: command.choices.map((choice) => ({
        id: choice.id,
        label: choice.label,
        description: choice.explanation,
      })),
    };
  }
  return {
    id: `codex-${requestId}`,
    kind: "next_sentence",
    title: "Possible next sentences",
    prompt: command.prompt,
    choices: command.choices.map((choice) => ({
      id: choice.id,
      label: nextSentenceLabel(choice.latex),
      description: choice.explanation,
    })),
  };
}

export function applyTutorResponse(
  lesson: LessonDefinition,
  state: TutorSessionState,
  response: TutorResponseEnvelope,
  clearSelectedChoice = false,
): ProviderResult {
  let working: TutorSessionState = {
    ...state,
    control: {
      studentIntent: mapIntent(response.classification.intent),
      lastRequestId: response.requestId,
      ...(!clearSelectedChoice && state.control?.pendingChoiceSet
        ? { pendingChoiceSet: state.control.pendingChoiceSet }
        : {}),
    },
    error: undefined,
  };
  const appended: TutorMessage[] = [];
  let accepted = true;
  const rejectCommand = (message: string) => {
    const result = appendMessage(working, "system", "error", message);
    working = result.state;
    appended.push(result.message);
    accepted = false;
  };
  for (const command of response.commands) {
    switch (command.type) {
      case "reply": {
        const result = appendMessage(working, "tutor", "response", command.markdown);
        working = result.state;
        appended.push(result.message);
        break;
      }
      case "identify_mistake": {
        const result = appendMessage(
          { ...working, mistakesSeen: working.mistakesSeen + 1 },
          "tutor",
          command.severity === "incorrect" ? "error" : "feedback",
          `${command.message}\n\n${command.suggestion}`,
        );
        working = result.state;
        appended.push(result.message);
        break;
      }
      case "commit_latex": {
        if (getDocumentMode(lesson) === "course-notes") {
          rejectCommand(
            "Proof fragments are unavailable in course-note mode. A generated note must target the current outline item, so the document was not changed.",
          );
          break;
        }
        const latex = insertProofFragment(working.proof.editorLatex, command.latex);
        const updated = updateProof(working, latex, true);
        if (updated) {
          working = updated;
        } else {
          const result = appendMessage(
            working,
            "system",
            "error",
            "Codex proposed LaTeX that this local preview rejected. The proof was not changed.",
          );
          working = result.state;
          appended.push(result.message);
        }
        break;
      }
      case "write_course_note": {
        const current = getCurrentRoadmapItem(lesson, working);
        const statement = getCurrentStatement(lesson, working);
        const writtenStatementIds = working.proof.courseNoteStatementIds ?? [];
        const hasProgressEntry = (working.proof.courseNoteEntries ?? []).some(
          (entry) => entry.statementId === command.statementId,
        );
        const isAllowed =
          getDocumentMode(lesson) === "course-notes" &&
          current?.statementId === command.statementId &&
          statement?.id === command.statementId &&
          !writtenStatementIds.includes(command.statementId) &&
          !hasProgressEntry;
        const validation =
          validateCourseNotePart(command.latex) ??
          (command.proofLatex
            ? validateCourseNotePart(command.proofLatex)
            : null) ??
          (statement?.kind === "definition" &&
          !definitionEmphasizesTerm(command.latex, statement.title)
            ? "A definition must wrap the exact term being defined in \\emph{...}."
            : null);
        if (!isAllowed || !statement || validation) {
          rejectCommand(
            validation
              ? `Codex proposed an invalid course-note entry: ${validation}`
              : "Codex tried to write outside the current course topic. The document was not changed.",
          );
          break;
        }
        const entry = buildCourseNoteEntry(
          statement,
          command.latex,
          command.proofLatex,
        );
        const latex = insertCourseNoteFragment(
          lesson,
          working.proof.editorLatex,
          entry,
        );
        const updated = updateProof(working, latex, true);
        if (!updated) {
          rejectCommand(
            "The generated course-note entry could not be rendered. The document was not changed.",
          );
          break;
        }
        working = {
          ...updated,
          proof: {
            ...updated.proof,
            courseNoteStatementIds: [
              ...writtenStatementIds,
              command.statementId,
            ],
            courseNoteEntries: [
              ...(updated.proof.courseNoteEntries ?? []).filter(
                (entry) => entry.statementId !== command.statementId,
              ),
              {
                statementId: command.statementId,
                latex: command.latex,
                ...(command.proofLatex ? { proofLatex: command.proofLatex } : {}),
                complete: true,
              },
            ],
          },
        };
        break;
      }
      case "revise_course_note": {
        const current = getCurrentRoadmapItem(lesson, working);
        const statement = getCurrentStatement(lesson, working);
        const writtenStatementIds = working.proof.courseNoteStatementIds ?? [];
        const validation =
          validateCourseNotePart(command.latex) ??
          (command.proofLatex
            ? validateCourseNotePart(command.proofLatex)
            : null) ??
          (statement?.kind === "definition" &&
          !definitionEmphasizesTerm(command.latex, statement.title)
            ? "A definition must wrap the exact term being defined in \\emph{...}."
            : null);
        const isAllowed =
          getDocumentMode(lesson) === "course-notes" &&
          current?.statementId === command.statementId &&
          statement?.id === command.statementId &&
          writtenStatementIds.includes(command.statementId);
        if (!isAllowed || !statement || validation) {
          rejectCommand(
            validation
              ? `Codex proposed an invalid course-note revision: ${validation}`
              : "Codex tried to revise a course-note entry that is not the current written topic. The document was not changed.",
          );
          break;
        }
        const latex = replaceCourseNoteEntry(
          working.proof.editorLatex,
          statement,
          command.latex,
          command.proofLatex,
        );
        const updated = latex ? updateProof(working, latex, true) : null;
        if (!updated) {
          rejectCommand(
            "The course-note entry could not be revised safely. The document was not changed.",
          );
          break;
        }
        working = {
          ...updated,
          proof: {
            ...updated.proof,
            courseNoteEntries: [
              ...(updated.proof.courseNoteEntries ?? []).filter(
                (entry) => entry.statementId !== command.statementId,
              ),
              {
                statementId: command.statementId,
                latex: command.latex,
                ...(command.proofLatex ? { proofLatex: command.proofLatex } : {}),
                complete: true,
              },
            ],
          },
        };
        break;
      }
      case "record_course_note_progress": {
        const current = getCurrentRoadmapItem(lesson, working);
        const statement = getCurrentStatement(lesson, working);
        const entries = working.proof.courseNoteEntries ?? [];
        const existing = entries.find(
          (entry) => entry.statementId === command.statementId,
        );
        const accumulatedProof = [
          existing?.proofLatex?.trim(),
          command.proofFragmentLatex?.trim(),
        ]
          .filter((part): part is string => Boolean(part))
          .join("\n\n");
        const validation =
          validateCourseNotePart(command.latex) ??
          (command.proofFragmentLatex
            ? validateCourseNotePart(command.proofFragmentLatex)
            : null);
        const statementWasUnexpectedlyChanged =
          existing && existing.latex !== command.latex;
        const isAllowed =
          getDocumentMode(lesson) === "course-notes" &&
          current?.statementId === command.statementId &&
          statement?.id === command.statementId &&
          statement.kind !== "definition" &&
          !existing?.complete &&
          !statementWasUnexpectedlyChanged &&
          (!command.complete || Boolean(accumulatedProof));
        if (!isAllowed || !statement || validation) {
          rejectCommand(
            validation
              ? `Codex proposed invalid theorem progress: ${validation}`
              : "Codex could not safely record that theorem step. The document was not changed.",
          );
          break;
        }
        const entry = buildCourseNoteEntry(
          statement,
          command.latex,
          accumulatedProof || undefined,
        );
        const latex = existing
          ? replaceCourseNoteEntry(
              working.proof.editorLatex,
              statement,
              command.latex,
              accumulatedProof || undefined,
            )
          : insertCourseNoteFragment(lesson, working.proof.editorLatex, entry);
        const updated = latex ? updateProof(working, latex, true) : null;
        if (!updated) {
          rejectCommand(
            "The theorem progress could not be rendered. The document was not changed.",
          );
          break;
        }
        const writtenStatementIds = working.proof.courseNoteStatementIds ?? [];
        working = {
          ...updated,
          proof: {
            ...updated.proof,
            courseNoteEntries: [
              ...entries.filter((entry) => entry.statementId !== command.statementId),
              {
                statementId: command.statementId,
                latex: command.latex,
                ...(accumulatedProof ? { proofLatex: accumulatedProof } : {}),
                complete: command.complete,
              },
            ],
            courseNoteStatementIds: command.complete
              ? Array.from(new Set([...writtenStatementIds, command.statementId]))
              : writtenStatementIds.filter((id) => id !== command.statementId),
          },
        };
        break;
      }
      case "insert_course_note_supplement": {
        const current = getCurrentRoadmapItem(lesson, working);
        const statement = getCurrentStatement(lesson, working);
        const writtenStatementIds = working.proof.courseNoteStatementIds ?? [];
        const supplementIds = working.proof.courseNoteSupplementIds ?? [];
        const duplicatesRoadmapEntry = lesson.settings.curriculum.some(
          (candidate) =>
            candidate.kind === command.kind &&
            candidate.title.trim().toLocaleLowerCase("en") ===
              command.title.trim().toLocaleLowerCase("en"),
        );
        const validation =
          validateCourseNotePart(command.latex) ??
          validateCourseNotePart(command.proofLatex);
        const isAllowed =
          getDocumentMode(lesson) === "course-notes" &&
          current?.statementId === command.afterStatementId &&
          statement?.id === command.afterStatementId &&
          writtenStatementIds.includes(command.afterStatementId) &&
          !supplementIds.includes(command.noteId) &&
          !duplicatesRoadmapEntry;
        if (!isAllowed || !statement || validation) {
          rejectCommand(
            validation
              ? `Codex proposed an invalid supplementary course-note entry: ${validation}`
              : "Codex could not safely insert that supplementary result after the current course topic. The document was not changed.",
          );
          break;
        }

        const latex = insertCourseNoteSupplement(
          working.proof.editorLatex,
          statement,
          {
            noteId: command.noteId,
            kind: command.kind,
            title: command.title,
          },
          command.latex,
          command.proofLatex,
        );
        const updated = latex ? updateProof(working, latex, true) : null;
        if (!updated) {
          rejectCommand(
            "The supplementary result could not be inserted safely. The document was not changed.",
          );
          break;
        }
        working = {
          ...updated,
          proof: {
            ...updated.proof,
            courseNoteSupplementIds: [...supplementIds, command.noteId],
          },
        };
        break;
      }
      case "advance_roadmap": {
        const current = getCurrentRoadmapItem(lesson, working);
        const next = getNextRoadmapItem(lesson, working);
        const hasCurrentEntry = Boolean(
          current &&
            (working.proof.courseNoteStatementIds ?? []).includes(current.statementId),
        );
        if (
          getDocumentMode(lesson) !== "course-notes" ||
          !current ||
          !next ||
          next.statementId !== command.statementId ||
          !hasCurrentEntry
        ) {
          rejectCommand(
            "Codex tried to skip the fixed course roadmap. The current topic was not changed.",
          );
          break;
        }
        working = {
          ...working,
          currentStatementId: next.statementId,
          completedStatementIds: Array.from(
            new Set([...(working.completedStatementIds ?? []), current.statementId]),
          ),
          control: {
            ...working.control,
            pendingChoiceSet: undefined,
          },
        };
        break;
      }
      case "replace_latex": {
        if (getDocumentMode(lesson) === "course-notes") {
          const documentIssue = validateCourseNoteDocumentReplacement(
            lesson,
            command.latex,
          );
          if (documentIssue) {
            rejectCommand(documentIssue);
            break;
          }
        }
        const updated = updateProof(working, command.latex, true);
        if (updated) {
          working = updated;
        } else {
          const result = appendMessage(
            working,
            "system",
            "error",
            "Codex proposed a proof rewrite that this local preview rejected. The proof was not changed.",
          );
          working = result.state;
          appended.push(result.message);
        }
        break;
      }
      case "replace_latex_block": {
        const replacement = replaceExactLatexBlock(
          working.proof.editorLatex,
          command.target,
          command.replacement,
        );
        if (!replacement.ok) {
          rejectCommand(
            `Codex could not safely edit the requested LaTeX block: ${replacement.error}`,
          );
          break;
        }
        if (
          DANGEROUS_DOCUMENT_COMMAND.test(command.replacement) ||
          /<\/?[A-Za-z][A-Za-z0-9-]*(?:(?:\s|\/)[^<>]*)?>/.test(
            command.replacement,
          ) ||
          /<(?:!DOCTYPE|!--|\?xml)/i.test(command.replacement)
        ) {
          rejectCommand(
            "Codex proposed an unsafe LaTeX block. The document was not changed.",
          );
          break;
        }
        if (getDocumentMode(lesson) === "course-notes") {
          const documentIssue = validateCourseNoteDocumentReplacement(
            lesson,
            replacement.latex,
          );
          if (documentIssue) {
            rejectCommand(documentIssue);
            break;
          }
        }
        const updated = updateProof(working, replacement.latex, true);
        if (!updated) {
          rejectCommand(
            "Codex proposed a LaTeX block that the local preview rejected. The document was not changed.",
          );
          break;
        }
        working = updated;
        break;
      }
      case "propose_approaches":
      case "propose_next_sentences":
        working = {
          ...working,
          control: {
            ...working.control,
            pendingChoiceSet: choiceSetFromCommand(
              command,
              response.requestId,
            ),
          },
        };
        break;
      case "set_mode":
        {
          const completedStatementIds =
            command.mode === "completed" &&
            getDocumentMode(lesson) === "course-notes" &&
            working.currentStatementId
              ? Array.from(
                  new Set([
                    ...(working.completedStatementIds ?? []),
                    working.currentStatementId,
                  ]),
                )
              : working.completedStatementIds;
          working = {
            ...working,
            mode: lessonMode(command.mode),
            status: command.mode === "completed" ? "completed" : "active",
            completedStatementIds,
          };
          break;
        }
      case "no_op":
        break;
    }
  }

  return { state: working, appendedMessages: appended, accepted };
}

function localError(
  state: TutorSessionState,
  code: string,
  message: string,
): ProviderResult {
  const result = appendMessage(
    { ...state, error: { code, message } },
    "tutor",
    "error",
    message,
  );
  return { state: result.state, appendedMessages: [result.message], accepted: false };
}

function errorCode(error: unknown): string {
  if (error instanceof TutorProtocolValidationError) {
    return error.protocolError.code;
  }
  return error instanceof Error && error.message ? error.message : "codex_error";
}

function connectionErrorMessage(code: string): string {
  switch (code) {
    case "bridge_unreachable":
      return "The local tutor bridge is not running. Keep npm run dev open, then try again.";
    case "bridge_busy":
      return "Personal Codex is finishing another reply. Try again in a moment.";
    case "codex_not_found":
      return "The Codex CLI was not found. Install it or choose its executable, then restart the site.";
    case "codex_not_executable":
      return "The installed Codex executable could not be started. Restart the site from a normal PowerShell window, then try again.";
    case "codex_auth_unavailable":
    case "codex_auth_required":
      return "Personal Codex sign-in could not be loaded. Open Codex and sign in, then try again.";
    case "codex_failed":
    case "codex_runtime_error":
      return "Codex started but could not complete the tutor turn. Check the site terminal for the specific error, then try again.";
    case "codex_timeout":
      return "Personal Codex did not answer within 90 seconds. No proof changes were applied; you can try the turn again.";
    case "request_id_mismatch":
    case "invalid_response":
    case "invalid_codex_response":
    case "invalid_bridge_response":
    case "invalid_json":
      return "The Codex reply did not match the safe tutor format, so nothing was changed.";
    case "codex_response_too_large":
      return "The Codex reply exceeded the local size limit, so nothing was changed.";
    case "request_too_large":
    case "prompt_too_large":
    case "payload_too_large":
      return "The tutor context is too large. Shorten the custom instructions or student background, then start a new session.";
    case "protocol_mismatch":
    case "unsupported_protocol":
      return "The webpage and local bridge use different tutor-protocol versions. Restart npm run dev and refresh the page.";
    case "response_schema_missing":
      return "The local tutor installation is incomplete because its response schema is missing.";
    case "missing_statement":
    case "invalid_roadmap":
      return "This lesson has an invalid course roadmap. No document changes were applied.";
    default:
      return `Personal Codex could not complete this turn (${code}). No proof changes were applied.`;
  }
}

function responseValidationErrorMessage(error: {
  code: string;
  issues?: ReadonlyArray<{ message: string }>;
}): string {
  const issue = error.issues?.[0]?.message;
  if (!issue) return connectionErrorMessage(error.code);
  return `Codex could not apply this turn: ${issue}`;
}

function studentEcho(
  state: TutorSessionState,
  action: Exclude<TutorAction, { type: "render-proof" | "request-hint" | "request-proof-feedback" }>,
  choiceSet: ReturnType<typeof getActiveChoiceSet>,
) {
  if (action.type === "message") return action.text.trim();
  const choiceId = action.type === "choose" ? action.choiceId : action.choiceId;
  const choice = choiceSet?.choices.find((option) => option.id === choiceId);
  if (action.type === "ask-about-choice") {
    return action.question?.trim() || `What would “${choice?.label ?? choiceId}” do?`;
  }
  return choice?.label ?? "I choose this option.";
}

export function isRestorableLocalCodexSession(
  lesson: LessonDefinition,
  value: unknown,
): value is TutorSessionState {
  if (!isRecord(value)) return false;
  const candidate = value as Partial<TutorSessionState>;
  const currentStatementIsValid =
    getDocumentMode(lesson) !== "course-notes" ||
    (typeof candidate.currentStatementId === "string" &&
      getLessonRoadmap(lesson).some(
        (item) => item.statementId === candidate.currentStatementId,
      ));
  const messagesUseCurrentVocabulary =
    Array.isArray(candidate.messages) &&
    candidate.messages.every(
      (message) =>
        isRecord(message) &&
        (message.role === "tutor" ||
          message.role === "student" ||
          message.role === "system"),
    );
  const proofSourceIsCurrent =
    isRecord(candidate.proof) &&
    (candidate.proof.source === "tutor" || candidate.proof.source === "student-edit");
  return (
    candidate.schemaVersion === 1 &&
    candidate.lessonId === lesson.id &&
    (candidate.lessonContentVersion ?? 1) === (lesson.contentVersion ?? 1) &&
    candidate.providerId === localCodexProviderDescriptor.id &&
    typeof candidate.activeStepId === "string" &&
    messagesUseCurrentVocabulary &&
    isRecord(candidate.proof) &&
    typeof candidate.proof.editorLatex === "string" &&
    typeof candidate.proof.previewLatex === "string" &&
    proofSourceIsCurrent &&
    currentStatementIsValid
  );
}

export class LocalCodexProvider implements TutorProvider {
  readonly descriptor = localCodexProviderDescriptor;

  constructor(private readonly transport: LocalCodexTransport = defaultTransport) {}

  async createSession(
    lesson: LessonDefinition,
    restoredState?: TutorSessionState | null,
    context?: TutorProviderContext,
  ): Promise<ProviderResult> {
    if (isRestorableLocalCodexSession(lesson, restoredState)) {
      return { state: restoredState, appendedMessages: [], accepted: true };
    }

    const state = initialSessionState(lesson);

    return this.respond(
      lesson,
      state,
      { kind: "session_start", text: "" },
      context,
      false,
    );
  }

  async dispatch(
    lesson: LessonDefinition,
    state: TutorSessionState,
    action: TutorAction,
    context?: TutorProviderContext,
  ): Promise<ProviderResult> {
    if (!isRestorableLocalCodexSession(lesson, state)) {
      return this.createSession(lesson, null, context);
    }

    if (action.type === "render-proof") {
      const validation = validateProofLatex(action.latex);
      if (validation) {
        return localError(
          { ...state, proof: { ...state.proof, editorLatex: action.latex } },
          "invalid_latex",
          `The LaTeX could not be rendered: ${validation}`,
        );
      }
      const updated = updateProof(state, action.latex) ?? state;
      return { state: updated, appendedMessages: [], accepted: true };
    }

    let working = state;
    if (action.type === "request-proof-feedback") {
      const validation = validateProofLatex(action.latex);
      if (validation) {
        return localError(
          { ...state, proof: { ...state.proof, editorLatex: action.latex } },
          "invalid_latex",
          `Before I can check the proof, fix this LaTeX error: ${validation}`,
        );
      }
      working = updateProof(state, action.latex) ?? state;
    }

    const choices = getActiveChoiceSet(lesson, working);
    if (action.type === "choose" || action.type === "ask-about-choice") {
      if (!choices?.choices.some((choice) => choice.id === action.choiceId)) {
        return localError(working, "unknown_choice", "That option is no longer available.");
      }
    }
    if (action.type === "message" && action.text.trim().length > TUTOR_PROTOCOL_LIMITS.text) {
      return localError(
        working,
        "message_too_long",
        `Keep one message under ${TUTOR_PROTOCOL_LIMITS.text.toLocaleString()} characters.`,
      );
    }
    const selectedLearningAction =
      action.type === "choose"
        ? choices?.choices.find((choice) => choice.id === action.choiceId)
            ?.learningAction
        : undefined;
    const usesFallbackContinue =
      action.type === "message" &&
      action.text.trim() === "Continue to the next course item.";
    if (
      (selectedLearningAction === "continue" || usesFallbackContinue) &&
      !isCurrentCourseItemReady(lesson, working)
    ) {
      return localError(
        working,
        "course_item_not_ready",
        "Continue will be available after the current course-note entry is written.",
      );
    }

    const input = actionInput(
      action,
      choices,
      state.proof.reviewedLatex ?? state.proof.previewLatex,
    );
    let studentMessage: string | undefined;
    if (action.type === "request-hint") {
      working = { ...working, hintsUsed: working.hintsUsed + 1 };
    } else if (action.type !== "request-proof-feedback") {
      studentMessage = studentEcho(working, action, choices);
    }

    return this.respond(
      lesson,
      working,
      input,
      context,
      action.type === "choose",
      studentMessage,
    );
  }

  private async respond(
    lesson: LessonDefinition,
    state: TutorSessionState,
    studentInput: TutorStudentInput,
    context?: TutorProviderContext,
    clearSelectedChoice = false,
    studentMessage?: string,
  ): Promise<ProviderResult> {
    let request: TutorRequestEnvelope;
    try {
      request = buildRequest(lesson, state, studentInput, context);
      const output = await this.transport(request, buildTutorPrompt(request));
      const parsed = parseTutorResponse(output, request);
      if (!parsed.ok) {
        return localError(
          state,
          parsed.error.code,
          responseValidationErrorMessage(parsed.error),
        );
      }
      if (parsed.value.requestId !== request.requestId) {
        throw new Error("request_id_mismatch");
      }
      let acceptedState = state;
      const appendedMessages: TutorMessage[] = [];
      if (studentMessage) {
        const studentResult = appendMessage(
          acceptedState,
          "student",
          "response",
          studentMessage,
        );
        acceptedState = studentResult.state;
        appendedMessages.push(studentResult.message);
      }
      const applied = applyTutorResponse(
        lesson,
        acceptedState,
        parsed.value,
        clearSelectedChoice,
      );
      const appliedState =
        studentInput.kind === "proof_feedback_request"
          ? {
              ...applied.state,
              proof: {
                ...applied.state.proof,
                reviewedLatex: applied.state.proof.editorLatex,
              },
            }
          : applied.state;
      return {
        ...applied,
        state: appliedState,
        appendedMessages: [...appendedMessages, ...applied.appendedMessages],
      };
    } catch (error) {
      const code = errorCode(error);
      return localError(state, code, connectionErrorMessage(code));
    }
  }
}

export const localCodexProvider = new LocalCodexProvider();
