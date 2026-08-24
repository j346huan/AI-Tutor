"use client";
/* eslint-disable @next/next/no-img-element -- Profile pictures are validated local data URLs. */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { lessonCatalog, type LessonDefinition } from "../lessons";
import {
  getActiveChoiceSet,
  getCurrentStatement,
  getLessonRoadmap,
  getTargetStatement,
  isCurrentCourseItemReady,
  isRestorableLocalCodexSession,
  localCodexProvider,
  type TutorAction,
  type TutorMessage,
  type TutorProviderContext,
  type TutorSessionState,
} from "../providers";
import {
  clearSavedSession,
  loadSession,
  loadSettings,
  saveSession,
  saveSettings,
} from "../lib/persistence";
import {
  applyBuiltInLessonSettings,
  defaultTutorSettings,
  type TutorSettings,
} from "../lib/settings";
import { hasDisplayMath, MathText } from "./MathText";
import { ProofDocument } from "./ProofDocument";
import { SettingsDialog } from "./SettingsDialog";

type AppPhase = "loading" | "ready" | "active" | "empty" | "error";

function lessonForId(lessonId: string): LessonDefinition | null {
  return lessonCatalog.find((lesson) => lesson.id === lessonId) ?? null;
}

function isCourseNotesLesson(lesson: LessonDefinition): boolean {
  return lesson.documentMode === "course-notes";
}

function tutorLabel(
  role: TutorMessage["role"],
  mathematicianName: string,
  studentName: string,
): string {
  if (role === "student") return studentName;
  if (role === "system") return "System";
  return mathematicianName;
}

function contextForSettings(settings: TutorSettings): TutorProviderContext {
  return {
    studentName: settings.student.name,
    profile: {
      name: settings.profile.name,
      personality: settings.profile.personality,
      customPrompts: settings.profile.customPrompts,
    },
    studentBackground: settings.studentBackground,
    curriculum: settings.learningItems.map(({ kind, title, statementLatex }) => ({
      kind,
      title,
      statementLatex,
    })),
  };
}

function TranscriptMessage({
  message,
  mathematicianName,
  mathematicianImage,
  studentName,
  studentImage,
}: {
  message: TutorMessage;
  mathematicianName: string;
  mathematicianImage: string;
  studentName: string;
  studentImage: string;
}) {
  const profileImage =
    message.role === "tutor"
      ? mathematicianImage
      : message.role === "student"
        ? studentImage
        : "";

  return (
    <article
      className={`transcript-message transcript-message--${message.role} transcript-message--${message.kind}`}
      data-message-id={message.id}
    >
      {profileImage ? (
        <img
          className="message-avatar"
          src={profileImage}
          alt=""
          aria-hidden="true"
        />
      ) : null}
      <div className="message-heading">
        <p className="message-label">
          {tutorLabel(message.role, mathematicianName, studentName)}
          {message.kind === "hint" ? <span className="message-kind"> hint</span> : null}
          {message.kind === "error" ? <span className="message-kind"> needs attention</span> : null}
        </p>
      </div>
      <p className="message-body">
        <MathText>{message.markdown}</MathText>
      </p>
    </article>
  );
}

export function TutorApp() {
  const [phase, setPhase] = useState<AppPhase>("loading");
  const [settings, setSettings] = useState<TutorSettings>(defaultTutorSettings);
  const [session, setSession] = useState<TutorSessionState | null>(null);
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedChoiceId, setSelectedChoiceId] = useState("");
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [sourcePaneCollapsed, setSourcePaneCollapsed] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const choiceHeadingRef = useRef<HTMLLegendElement>(null);
  const previousChoiceSetIdRef = useRef<string | null>(null);
  const sessionOperationIdRef = useRef(0);

  const openSession = useCallback(
    async (nextSettings: TutorSettings, restore: boolean) => {
      const operationId = ++sessionOperationIdRef.current;
      setBusy(true);
      setPhase("loading");
      setFatalError(null);
      setSelectedChoiceId("");
      setDraft("");
      setAnnouncement("");
      setSession(null);

      const lesson = lessonForId(nextSettings.selectedLessonId);
      if (!lesson) {
        setPhase("empty");
        setBusy(false);
        return;
      }

      try {
        let restoredState: TutorSessionState | null = null;
        if (restore) {
          const saved = loadSession<TutorSessionState>();
          if (saved.warning) setNotice(saved.warning);
          const canRestore = isRestorableLocalCodexSession(lesson, saved.value);
          if (saved.value && canRestore) {
            restoredState = saved.value;
          } else if (saved.value) {
            setNotice("A fresh conversation was opened for the selected tutor.");
          }
        }
        const result = await localCodexProvider.createSession(
          lesson,
          restoredState,
          contextForSettings(nextSettings),
        );
        if (operationId !== sessionOperationIdRef.current) return;
        setSession(result.state);
        setAnnouncement(
          result.appendedMessages.at(-1)?.markdown ??
            (restoredState ? "Saved lesson restored." : `${lesson.title} ready.`),
        );
        setPhase(result.state.status === "error" ? "error" : "active");
      } catch {
        if (operationId !== sessionOperationIdRef.current) return;
        setFatalError("The lesson could not be opened. Your settings are still safe.");
        setPhase("error");
      } finally {
        if (operationId === sessionOperationIdRef.current) setBusy(false);
      }
    },
    [],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const loaded = loadSettings();
      setSettings(loaded.value);
      if (loaded.warning) setNotice(loaded.warning);

      const lesson = lessonForId(loaded.value.selectedLessonId);
      if (!lesson) {
        setSession(null);
        setPhase("empty");
        return;
      }
      const saved = loadSession<TutorSessionState>();
      if (saved.warning) setNotice(saved.warning);
      if (isRestorableLocalCodexSession(lesson, saved.value)) {
        setSession(saved.value);
        setAnnouncement("Saved lesson restored.");
        setPhase(saved.value.status === "error" ? "error" : "active");
      } else {
        setSession(null);
        setPhase("ready");
        if (saved.value) {
          setNotice("The saved conversation does not match these settings. Start a new session when ready.");
        }
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [openSession]);

  useEffect(() => {
    if (!session) return;
    const warning = saveSession(session);
    if (!warning) return;
    const timer = window.setTimeout(() => setNotice(warning), 0);
    return () => window.clearTimeout(timer);
  }, [session]);

  const activeLesson =
    lessonForId(session?.lessonId ?? settings.selectedLessonId) ?? lessonCatalog[0];
  const choiceSet = useMemo(
    () => (session ? getActiveChoiceSet(activeLesson, session) : null),
    [activeLesson, session],
  );
  const targetStatement = getTargetStatement(activeLesson);
  const currentStatement = getCurrentStatement(activeLesson, session ?? undefined);
  const courseNotesMode = isCourseNotesLesson(activeLesson);
  const roadmap = courseNotesMode ? getLessonRoadmap(activeLesson) : [];
  const canContinueCurrentItem = Boolean(
    session && isCurrentCourseItemReady(activeLesson, session),
  );
  const isFinalCourseItem = Boolean(
    courseNotesMode &&
      currentStatement &&
      roadmap.at(-1)?.statementId === currentStatement.id,
  );
  const visibleChoiceSet =
    choiceSet && "kind" in choiceSet && choiceSet.kind === "learning_action"
      ? null
      : choiceSet;
  const completedStatementIds = new Set(session?.completedStatementIds ?? []);
  const currentStatementProse =
    currentStatement?.statement ?? targetStatement?.statement;
  const currentStatementLatex = currentStatement?.latex ?? targetStatement?.latex;
  const hasCourseNoteContent = Boolean(
    session &&
      courseNotesMode &&
      ((session.proof.courseNoteStatementIds?.length ?? 0) > 0 ||
        session.proof.revision > 0),
  );

  useEffect(() => {
    const nextId = visibleChoiceSet?.id ?? null;
    if (nextId !== previousChoiceSetIdRef.current) {
      previousChoiceSetIdRef.current = nextId;
      setSelectedChoiceId("");
      if (nextId) window.requestAnimationFrame(() => choiceHeadingRef.current?.focus());
    }
  }, [visibleChoiceSet?.id]);

  useEffect(() => {
    const viewport = chatScrollRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [session?.messages.length]);

  const dispatch = async (action: TutorAction) => {
    if (!session || busy) return;
    const operationId = sessionOperationIdRef.current;
    setBusy(true);
    setFatalError(null);
    try {
      const result = await localCodexProvider.dispatch(
        activeLesson,
        session,
        action,
        contextForSettings(settings),
      );
      if (operationId !== sessionOperationIdRef.current) return;
      setSession(result.state);
      const latest = result.appendedMessages.at(-1);
      if (latest) setAnnouncement(latest.markdown);
      if (
        result.accepted &&
        (action.type === "message" ||
          action.type === "choose" ||
          action.type === "ask-about-choice")
      ) {
        setDraft("");
      }
      setPhase(result.state.status === "error" ? "error" : "active");
    } catch {
      if (operationId !== sessionOperationIdRef.current) return;
      setFatalError("The tutor response failed. Try the same action again.");
    } finally {
      if (operationId === sessionOperationIdRef.current) setBusy(false);
    }
  };

  const startFreshSession = async () => {
    const warning = clearSavedSession();
    setNotice(warning ?? null);
    await openSession(settings, false);
  };

  const useBuiltInLesson = () => {
    sessionOperationIdRef.current += 1;
    const fallbackLesson = lessonCatalog[0];
    const nextSettings = applyBuiltInLessonSettings(settings, fallbackLesson);
    setSettings(nextSettings);
    const warning = saveSettings(nextSettings);
    setSession(null);
    setBusy(false);
    setPhase("ready");
    setNotice(
      warning ?? `${fallbackLesson.title} selected. Choose New session when you are ready to begin.`,
    );
  };

  const importSettings = (nextSettings: TutorSettings): string | undefined => {
    sessionOperationIdRef.current += 1;
    setSettings(nextSettings);
    const saveWarning = saveSettings(nextSettings);
    const clearWarning = clearSavedSession();
    setSession(null);
    setBusy(false);
    setPhase("ready");
    setNotice(
      saveWarning ??
        clearWarning ??
        "Settings imported. Choose New session when you are ready to use them.",
    );
    return saveWarning ?? clearWarning;
  };

  const updateSettings = (nextSettings: TutorSettings): string | undefined => {
    const lessonChanged = nextSettings.selectedLessonId !== settings.selectedLessonId;
    setSettings(nextSettings);
    const warning = saveSettings(nextSettings);
    setNotice(warning ?? null);
    if (lessonChanged) {
      sessionOperationIdRef.current += 1;
      const clearWarning = clearSavedSession();
      setSession(null);
      setBusy(false);
      setPhase("ready");
      setNotice(
        clearWarning ??
          "Lesson selection saved. Choose New session when you are ready to begin.",
      );
    }
    return warning;
  };

  const submitDraft = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim() || busy || !session) return;
    void dispatch({
      type: "message",
      text: draft,
      ...(selectedChoiceId ? { selectedChoiceId } : {}),
    });
  };

  const updateEditor = (latex: string) => {
    setSession((current) =>
      current
        ? {
            ...current,
            proof: {
              ...current.proof,
              editorLatex: latex,
              source: "student-edit",
            },
          }
        : current,
    );
  };

  const showWorkspace = Boolean(
    session &&
      (isCourseNotesLesson(activeLesson) ||
        session.mode !== "orientation" ||
        session.proof.fragmentIds.length > 0 ||
        (session.providerId === localCodexProvider.descriptor.id &&
          session.proof.revision > 0)),
  );

  return (
    <div className="site-shell">
      <a className="skip-link" href="#lesson-main">
        Skip to lesson
      </a>
      <header className="site-header">
        <div className="header-inner">
          <p className="site-title">AI Mathematician</p>
          <nav aria-label="Session controls" className="header-controls">
            <button
              className="text-button"
              type="button"
              disabled={busy || phase === "loading"}
              onClick={() => void startFreshSession()}
            >
              New session
            </button>
            <button className="text-button" type="button" onClick={() => setSettingsOpen(true)}>
              Settings
            </button>
          </nav>
        </div>
      </header>

      <main id="lesson-main" className={showWorkspace ? "lesson-main lesson-main--wide" : "lesson-main"}>
        {notice ? (
          <div className="notice" role="status">
            <span>{notice}</span>
            <button className="text-button" type="button" onClick={() => setNotice(null)}>
              Dismiss
            </button>
          </div>
        ) : null}

        {phase === "loading" ? (
          <section className="state-page" aria-busy="true" aria-live="polite">
            <h1>Preparing {activeLesson.title}…</h1>
          </section>
        ) : null}

        {phase === "empty" ? (
          <section className="state-page">
            <p className="eyebrow">Lesson unavailable</p>
            <h1>The selected lesson is not installed.</h1>
            <button className="primary-button" type="button" onClick={useBuiltInLesson}>
              Open {lessonCatalog[0].title}
            </button>
          </section>
        ) : null}

        {phase === "ready" ? (
          <section className="state-page">
            <h1>Start a new session.</h1>
            <button className="primary-button" type="button" onClick={() => void startFreshSession()}>
              Start new session
            </button>
          </section>
        ) : null}

        {phase === "error" && !session ? (
          <section className="state-page" role="alert">
            <p className="eyebrow">Recoverable error</p>
            <h1>The lesson could not be opened.</h1>
            <p>{fatalError ?? "The saved session is incompatible with this lesson."}</p>
            <button className="primary-button" type="button" onClick={() => void startFreshSession()}>
              Start a fresh session
            </button>
          </section>
        ) : null}

        {session ? (
          <>
            <section
              className={
                showWorkspace
                  ? sourcePaneCollapsed
                    ? "lesson-grid lesson-grid--source-collapsed"
                    : "lesson-grid"
                  : "lesson-grid lesson-grid--reading"
              }
            >
              <section className="chat-pane" aria-labelledby="conversation-title">
                <div className="pane-heading">
                  <h2 id="conversation-title">Chat</h2>
                </div>

                {fatalError ? (
                  <div className="inline-error" role="alert">
                    {fatalError}
                  </div>
                ) : null}

                <div className="chat-scroll" ref={chatScrollRef} aria-busy={busy}>
                  <div className="sticky-context">
                    {!courseNotesMode ? (
                      <section
                        className="theorem-block"
                        aria-labelledby="current-statement-title"
                      >
                        <div className="theorem-heading">
                          <div>
                            <p className="statement-label">
                              {currentStatement?.kind ?? targetStatement?.kind ?? "Theorem"}
                            </p>
                            <h2 id="current-statement-title">
                              <MathText>
                                {currentStatement?.title ??
                                  targetStatement?.title ??
                                  activeLesson.title}
                              </MathText>
                            </h2>
                          </div>
                          <button
                            className="text-button"
                            type="button"
                            disabled={busy || session.status === "completed"}
                            onClick={() => void dispatch({ type: "request-hint" })}
                          >
                            Request hint
                          </button>
                        </div>
                        {currentStatementProse ? (
                          <MathText className="theorem-prose">
                            {currentStatementProse}
                          </MathText>
                        ) : null}
                        {currentStatementLatex ? (
                          <MathText className="theorem-math">
                            {`\\[${currentStatementLatex}\\]`}
                          </MathText>
                        ) : null}
                      </section>
                    ) : null}

                    {roadmap.length ? (
                      <nav className="course-roadmap" aria-label="Fixed course roadmap">
                        <div className="course-roadmap__heading">
                          <p className="statement-label">Roadmap</p>
                          <button
                            className="text-button"
                            type="button"
                            disabled={busy || session.status === "completed"}
                            onClick={() => void dispatch({ type: "request-hint" })}
                          >
                            Request hint
                          </button>
                        </div>
                        <ol>
                          {roadmap.map((item) => {
                            const statement = activeLesson.settings.curriculum.find(
                              (candidate) => candidate.id === item.statementId,
                            );
                            if (!statement) return null;
                            const isCurrent = statement.id === currentStatement?.id;
                            const isCompleted = completedStatementIds.has(statement.id);
                            return (
                              <li
                                className={
                                  isCurrent
                                    ? "course-roadmap__item course-roadmap__item--current"
                                    : isCompleted
                                      ? "course-roadmap__item course-roadmap__item--completed"
                                      : "course-roadmap__item"
                                }
                                aria-current={isCurrent ? "step" : undefined}
                                key={statement.id}
                              >
                                <span className="statement-kind">
                                  {statement.kind.charAt(0).toUpperCase() +
                                    statement.kind.slice(1)}
                                </span>{" "}
                                <MathText>{statement.title}</MathText>
                                {isCompleted ? <span className="sr-only"> — complete</span> : null}
                              </li>
                            );
                          })}
                        </ol>
                      </nav>
                    ) : null}

                    {visibleChoiceSet && session.status !== "completed" ? (
                      <fieldset className="choice-set">
                        <legend ref={choiceHeadingRef} tabIndex={-1}>
                          <MathText>{visibleChoiceSet.title}</MathText>
                        </legend>
                        <p className="choice-prompt">
                          <MathText>{visibleChoiceSet.prompt}</MathText>
                        </p>
                        <div className="choice-options">
                          {visibleChoiceSet.choices.map((choice, index) => (
                            <label className="choice-option" key={choice.id}>
                              <input
                                type="radio"
                                name={visibleChoiceSet.id}
                                value={choice.id}
                                checked={selectedChoiceId === choice.id}
                                onChange={() => setSelectedChoiceId(choice.id)}
                              />
                              <span className="choice-index">
                                {String.fromCharCode(65 + index)}.
                              </span>
                              <MathText>{choice.label}</MathText>
                            </label>
                          ))}
                        </div>
                        <div className="choice-actions">
                          <button
                            className="primary-button primary-button--small"
                            type="button"
                            disabled={!selectedChoiceId || busy}
                            onClick={() =>
                              selectedChoiceId &&
                              void dispatch({ type: "choose", choiceId: selectedChoiceId })
                            }
                          >
                            Use this approach
                          </button>
                          <button
                            className="text-button"
                            type="button"
                            disabled={!selectedChoiceId || busy}
                            onClick={() =>
                              selectedChoiceId &&
                              void dispatch({
                                type: "ask-about-choice",
                                choiceId: selectedChoiceId,
                              })
                            }
                          >
                            Ask what it would do
                          </button>
                        </div>
                      </fieldset>
                    ) : null}
                  </div>

                  <div className="transcript" role="log" aria-label="Lesson conversation">
                    {session.messages.length ? (
                      session.messages.map((message) => (
                        <TranscriptMessage
                          key={message.id}
                          message={message}
                          mathematicianName={settings.profile.name}
                          mathematicianImage={settings.profile.imageDataUrl}
                          studentName={settings.student.name}
                          studentImage={settings.student.imageDataUrl}
                        />
                      ))
                    ) : (
                      <p className="empty-copy">The conversation has not begun.</p>
                    )}
                  </div>
                </div>

                {session.status !== "completed" ? (
                  <form className="composer" onSubmit={submitDraft}>
                    <label className="sr-only" htmlFor="student-draft">
                      Message
                    </label>
                    <textarea
                      id="student-draft"
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          event.currentTarget.form?.requestSubmit();
                        }
                      }}
                      disabled={busy}
                      rows={2}
                    />
                    {hasDisplayMath(draft) ? (
                      <div className="input-preview" aria-label="Input preview">
                        <span className="preview-label">Preview</span>
                        <MathText>{draft}</MathText>
                      </div>
                    ) : null}
                    <div className="composer-actions">
                      <button
                        className="primary-button primary-button--small"
                        type="submit"
                        disabled={!draft.trim() || busy}
                      >
                        Send
                      </button>
                      {canContinueCurrentItem ? (
                        <button
                          className="text-button"
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void dispatch({
                              type: "message",
                              text: "Continue to the next course item.",
                            })
                          }
                        >
                          {isFinalCourseItem ? "Finish" : "Continue"}
                        </button>
                      ) : null}
                    </div>
                  </form>
                ) : (
                  <div className="completion-callout">
                    <p>
                      {courseNotesMode
                        ? hasCourseNoteContent
                          ? "Course notes complete."
                          : "Outline reviewed."
                        : "Proof complete."}
                    </p>
                    {!courseNotesMode || hasCourseNoteContent ? (
                      <button
                        className="primary-button"
                        type="button"
                        onClick={() => window.print()}
                      >
                        {courseNotesMode ? "Export notes to PDF" : "Export proof to PDF"}
                      </button>
                    ) : null}
                  </div>
                )}
              </section>

              {showWorkspace ? (
                <>
                  <section className="proof-pane" aria-labelledby="proof-preview-title">
                    <div className="pane-heading pane-heading--compact">
                      <h2 id="proof-preview-title">
                        {isCourseNotesLesson(activeLesson)
                          ? "Course notes"
                          : session.status === "completed"
                            ? "Proof complete"
                            : "Proof in progress"}
                      </h2>
                      <button
                        className="text-button"
                        type="button"
                        aria-controls="latex-source-pane"
                        aria-expanded={!sourcePaneCollapsed}
                        onClick={() => setSourcePaneCollapsed((collapsed) => !collapsed)}
                      >
                        {sourcePaneCollapsed ? "Show LaTeX code" : "Minimize LaTeX code"}
                      </button>
                    </div>
                    <div className="proof-paper">
                      <ProofDocument
                        source={session.proof.previewLatex}
                        complete={session.status === "completed"}
                        documentLabel={
                          isCourseNotesLesson(activeLesson)
                            ? "Rendered LaTeX course notes"
                            : "Rendered LaTeX proof"
                        }
                        emptyMessage={
                          isCourseNotesLesson(activeLesson)
                            ? "The course notes will appear as ideas are established."
                            : "No proof steps have been accepted yet."
                        }
                      />
                    </div>

                  </section>

                  <section
                    id="latex-source-pane"
                    className="source-pane"
                    aria-labelledby="latex-source-title"
                    hidden={sourcePaneCollapsed}
                  >
                    <div className="pane-heading pane-heading--compact">
                      <h2 id="latex-source-title">LaTeX code</h2>
                    </div>
                    <label className="sr-only" htmlFor="proof-source">
                      Editable LaTeX {isCourseNotesLesson(activeLesson) ? "course notes" : "proof"} source
                    </label>
                    <textarea
                      id="proof-source"
                      className="latex-editor"
                      value={session.proof.editorLatex}
                      onChange={(event) => updateEditor(event.target.value)}
                      spellCheck={false}
                    />
                    <div className="source-actions">
                      <button
                        className="primary-button primary-button--small"
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void dispatch({ type: "render-proof", latex: session.proof.editorLatex })
                        }
                      >
                        Render
                      </button>
                      <button
                        className="text-button"
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void dispatch({
                            type: "request-proof-feedback",
                            latex: session.proof.editorLatex,
                          })
                        }
                      >
                        Ask for feedback
                      </button>
                    </div>
                  </section>
                </>
              ) : null}
            </section>

            <section className="print-only print-document" aria-hidden="true">
              {isCourseNotesLesson(activeLesson) ? (
                <h1>{activeLesson.proof.documentTitle}</h1>
              ) : (
                <>
                  <p className="statement-label">{targetStatement?.kind ?? "Theorem"}</p>
                  <h1>{targetStatement?.title ?? activeLesson.title}</h1>
                  <MathText>{`\\[${targetStatement?.latex ?? ""}\\]`}</MathText>
                </>
              )}
              <ProofDocument
                source={session.proof.previewLatex}
                complete={session.status === "completed"}
                documentLabel={
                  isCourseNotesLesson(activeLesson)
                    ? "Printable LaTeX course notes"
                    : "Printable LaTeX proof"
                }
              />
            </section>
          </>
        ) : null}

        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {announcement}
        </div>
      </main>

      <SettingsDialog
        open={settingsOpen}
        settings={settings}
        onClose={() => setSettingsOpen(false)}
        onImport={importSettings}
        onUpdate={updateSettings}
      />
    </div>
  );
}
