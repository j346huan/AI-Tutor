"use client";
/* eslint-disable @next/next/no-img-element -- Profile pictures are validated local data URLs. */

import { useEffect, useId, useRef, useState } from "react";
import { lessonCatalog } from "../lessons";
import {
  applyBuiltInLessonSettings,
  MAX_PROFILE_IMAGE_FILE_SIZE,
  MAX_SETTINGS_FILE_SIZE,
  parseTutorSettings,
  serializeTutorSettings,
  type TutorSettings,
} from "../lib/settings";
import { PromptPreview } from "./PromptPreview";

interface SettingsDialogProps {
  open: boolean;
  settings: TutorSettings;
  onClose: () => void;
  onImport: (settings: TutorSettings) => string | undefined;
  onUpdate: (settings: TutorSettings) => string | undefined;
}

type PictureTarget = "mathematician" | "student";

const MAX_TUTOR_NAME_LENGTH = 80;
const MAX_STUDENT_NAME_LENGTH = 80;
const MAX_PERSONALITY_LENGTH = 2_000;
const MAX_CUSTOM_PROMPTS = 12;
const MAX_CUSTOM_PROMPT_LENGTH = 1_000;
const MAX_STUDENT_BACKGROUND_LENGTH = 4_000;

type TutorInstructionField =
  | "name"
  | "studentName"
  | "personality"
  | "customPrompts"
  | "studentBackground";

interface TutorInstructionDraft {
  name: string;
  studentName: string;
  personality: string;
  customPrompts: string;
  studentBackground: string;
}

function instructionDraftFromSettings(settings: TutorSettings): TutorInstructionDraft {
  return {
    name: settings.profile.name,
    studentName: settings.student.name,
    personality: settings.profile.personality,
    customPrompts: settings.profile.customPrompts.join("\n"),
    studentBackground: settings.studentBackground,
  };
}

export function SettingsDialog({
  open,
  settings,
  onClose,
  onImport,
  onUpdate,
}: SettingsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const instructionOpenRef = useRef(false);
  const errorId = useId();
  const instructionMessageId = useId();
  const [jsonText, setJsonText] = useState("");
  const [message, setMessage] = useState<{ tone: "error" | "ok"; text: string } | null>(
    null,
  );
  const [instructionDraft, setInstructionDraft] = useState<TutorInstructionDraft>(() =>
    instructionDraftFromSettings(settings),
  );
  const [instructionMessage, setInstructionMessage] = useState<{
    tone: "error" | "ok";
    text: string;
    field?: TutorInstructionField;
  } | null>(null);

  const currentPromptsText = settings.profile.customPrompts.join("\n");
  const selectedBuiltInLesson = lessonCatalog.find(
    (lesson) => lesson.id === settings.selectedLessonId,
  );
  const learningItemsAreBuiltIn = Boolean(
    selectedBuiltInLesson &&
      settings.learningItems.length > 0 &&
      settings.learningItems.every(
        (item) => item.lessonId === selectedBuiltInLesson.id,
      ),
  );
  const displayedLearningItems =
    selectedBuiltInLesson && learningItemsAreBuiltIn
      ? selectedBuiltInLesson.settings.curriculum.map((item) => ({
          ...item,
          lessonId: selectedBuiltInLesson.id,
        }))
      : settings.learningItems;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocusRef.current = document.activeElement as HTMLElement | null;
      dialog.showModal();
      window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    } else if (!open && dialog.open) {
      dialog.close();
      window.requestAnimationFrame(() => returnFocusRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", closeOnEscape, true);
    return () => document.removeEventListener("keydown", closeOnEscape, true);
  }, [onClose, open]);

  useEffect(() => {
    const wasOpen = instructionOpenRef.current;
    instructionOpenRef.current = open;
    if (!open || wasOpen) return;

    const timer = window.setTimeout(() => {
      setInstructionDraft({
        name: settings.profile.name,
        studentName: settings.student.name,
        personality: settings.profile.personality,
        customPrompts: currentPromptsText,
        studentBackground: settings.studentBackground,
      });
      setInstructionMessage(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    currentPromptsText,
    open,
    settings.profile.name,
    settings.profile.personality,
    settings.student.name,
    settings.studentBackground,
  ]);

  const updateInstructionField = (field: TutorInstructionField, value: string) => {
    setInstructionDraft((current) => ({
      ...current,
      [field]: value,
    }));
    setInstructionMessage(null);
  };

  const applyTutorInstructions = () => {
    setMessage(null);
    const name = instructionDraft.name.trim();
    const studentName = instructionDraft.studentName.trim();
    const personality = instructionDraft.personality.trim();
    const studentBackground = instructionDraft.studentBackground.trim();
    const customPrompts = instructionDraft.customPrompts
      .split(/\r?\n/)
      .map((prompt) => prompt.trim())
      .filter(Boolean);

    const fail = (field: TutorInstructionField, text: string) => {
      setInstructionMessage({ tone: "error", field, text });
    };

    if (!name) return fail("name", "The mathematician name cannot be empty.");
    if (name.length > MAX_TUTOR_NAME_LENGTH) {
      return fail("name", `Keep the name within ${MAX_TUTOR_NAME_LENGTH} characters.`);
    }
    if (!studentName) return fail("studentName", "The student name cannot be empty.");
    if (studentName.length > MAX_STUDENT_NAME_LENGTH) {
      return fail(
        "studentName",
        `Keep the student name within ${MAX_STUDENT_NAME_LENGTH} characters.`,
      );
    }
    if (!personality) return fail("personality", "The personality cannot be empty.");
    if (personality.length > MAX_PERSONALITY_LENGTH) {
      return fail(
        "personality",
        `Keep the personality within ${MAX_PERSONALITY_LENGTH.toLocaleString()} characters.`,
      );
    }
    if (customPrompts.length > MAX_CUSTOM_PROMPTS) {
      return fail(
        "customPrompts",
        `Use at most ${MAX_CUSTOM_PROMPTS} custom prompts, one per line.`,
      );
    }
    const longPromptIndex = customPrompts.findIndex(
      (prompt) => prompt.length > MAX_CUSTOM_PROMPT_LENGTH,
    );
    if (longPromptIndex >= 0) {
      return fail(
        "customPrompts",
        `Prompt ${longPromptIndex + 1} is longer than ${MAX_CUSTOM_PROMPT_LENGTH.toLocaleString()} characters.`,
      );
    }
    if (!studentBackground) {
      return fail("studentBackground", "The student background cannot be empty.");
    }
    if (studentBackground.length > MAX_STUDENT_BACKGROUND_LENGTH) {
      return fail(
        "studentBackground",
        `Keep the student background within ${MAX_STUDENT_BACKGROUND_LENGTH.toLocaleString()} characters.`,
      );
    }

    const warning = onUpdate({
      ...settings,
      profile: {
        ...settings.profile,
        name,
        personality,
        customPrompts,
      },
      student: {
        ...settings.student,
        name: studentName,
      },
      studentBackground,
    });
    setInstructionDraft({
      name,
      studentName,
      personality,
      customPrompts: customPrompts.join("\n"),
      studentBackground,
    });
    setInstructionMessage({
      tone: warning ? "error" : "ok",
      text: warning ?? "Tutor instructions saved.",
    });
  };

  const applyImport = () => {
    try {
      const imported = parseTutorSettings(jsonText);
      const warning = onImport(imported);
      setInstructionDraft(instructionDraftFromSettings(imported));
      setInstructionMessage(null);
      setMessage({
        tone: "ok",
        text: warning ?? "Settings imported.",
      });
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "The settings could not be imported.",
      });
    }
  };

  const readSettingsFile = async (file: File | undefined) => {
    if (!file) return;
    setMessage(null);
    if (file.size > MAX_SETTINGS_FILE_SIZE) {
      setMessage({ tone: "error", text: "The settings file is too large. The limit is 2.1 MB." });
      return;
    }
    try {
      setJsonText(await file.text());
    } catch {
      setMessage({ tone: "error", text: "That file could not be read." });
    }
  };

  const readPicture = async (target: PictureTarget, file: File | undefined) => {
    if (!file) return;
    setMessage(null);
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setMessage({ tone: "error", text: "Choose a PNG, JPEG, or WebP image." });
      return;
    }
    if (file.size > MAX_PROFILE_IMAGE_FILE_SIZE) {
      setMessage({ tone: "error", text: "Choose an image smaller than 600 KB." });
      return;
    }

    try {
      const imageDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener("load", () =>
          typeof reader.result === "string" ? resolve(reader.result) : reject(new Error()),
        );
        reader.addEventListener("error", () => reject(reader.error ?? new Error()));
        reader.readAsDataURL(file);
      });

      const nextSettings: TutorSettings =
        target === "mathematician"
          ? {
              ...settings,
              profile: {
                ...settings.profile,
                imageDataUrl,
              },
            }
          : {
              ...settings,
              student: { ...settings.student, imageDataUrl },
            };
      const warning = onUpdate(nextSettings);
      const savedLabel = target === "mathematician" ? "Mathematician picture saved." : "Student picture saved.";
      setMessage({
        tone: warning ? "error" : "ok",
        text: warning ?? savedLabel,
      });
    } catch {
      setMessage({ tone: "error", text: "That image could not be read." });
    }
  };

  const removePicture = (target: PictureTarget) => {
    const nextSettings: TutorSettings =
      target === "mathematician"
        ? {
            ...settings,
            profile: {
              ...settings.profile,
              imageDataUrl: "",
            },
          }
        : {
            ...settings,
            student: { ...settings.student, imageDataUrl: "" },
          };
    const warning = onUpdate(nextSettings);
    const removedLabel = target === "mathematician" ? "Mathematician picture removed." : "Student picture removed.";
    setMessage({
      tone: warning ? "error" : "ok",
      text: warning ?? removedLabel,
    });
  };

  const selectLesson = (lessonId: string) => {
    const lesson = lessonCatalog.find((candidate) => candidate.id === lessonId);
    if (!lesson) return;
    const nextSettings = applyBuiltInLessonSettings(settings, lesson);
    const warning = onUpdate(nextSettings);
    setInstructionDraft(instructionDraftFromSettings(nextSettings));
    setInstructionMessage(null);
    setMessage({
      tone: warning ? "error" : "ok",
      text:
        warning ??
        `${lesson.title} selected.`,
    });
  };

  const downloadCurrentSettings = () => {
    const blob = new Blob([serializeTutorSettings(settings)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "ai-mathematician-current-settings.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <dialog
      ref={dialogRef}
      className="settings-dialog"
      aria-labelledby="settings-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
    >
      <div className="dialog-heading">
        <h2 id="settings-title">Settings</h2>
        <button ref={closeButtonRef} className="text-button" type="button" onClick={onClose}>
          Close
        </button>
      </div>

      <section aria-labelledby="current-settings-title" className="settings-section">
        <h3 id="current-settings-title">Current configuration</h3>
        <label className="field-label" htmlFor="built-in-lesson">
          Lesson
        </label>
        <select
          id="built-in-lesson"
          value={settings.selectedLessonId}
          onChange={(event) => selectLesson(event.currentTarget.value)}
        >
          {lessonCatalog.map((lesson) => (
            <option value={lesson.id} key={lesson.id}>
              {lesson.title}
            </option>
          ))}
        </select>
        <h4>Learning list</h4>
        <ol className="learning-list">
          {displayedLearningItems.map((item) => (
            <li key={item.id}>
              <span className="statement-kind">{item.kind}</span> {item.title}
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="tutor-instructions-title" className="settings-section">
        <h3 id="tutor-instructions-title">Tutor instructions</h3>

        <form
          className="tutor-instructions-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            applyTutorInstructions();
          }}
        >
          <div className="instruction-field">
            <label className="field-label" htmlFor="tutor-name">
              Mathematician name
            </label>
            <input
              id="tutor-name"
              className="settings-text-input"
              type="text"
              value={instructionDraft.name}
              maxLength={MAX_TUTOR_NAME_LENGTH}
              aria-invalid={instructionMessage?.field === "name" || undefined}
              aria-describedby={
                instructionMessage?.field === "name" ? instructionMessageId : undefined
              }
              onChange={(event) => {
                updateInstructionField("name", event.currentTarget.value);
              }}
            />
          </div>

          <div className="instruction-field">
            <label className="field-label" htmlFor="student-name">
              Student name
            </label>
            <input
              id="student-name"
              className="settings-text-input"
              type="text"
              value={instructionDraft.studentName}
              maxLength={MAX_STUDENT_NAME_LENGTH}
              aria-invalid={instructionMessage?.field === "studentName" || undefined}
              aria-describedby={
                instructionMessage?.field === "studentName" ? instructionMessageId : undefined
              }
              onChange={(event) => {
                updateInstructionField("studentName", event.currentTarget.value);
              }}
            />
          </div>

          <div className="instruction-field">
            <label className="field-label" htmlFor="tutor-personality">
              Personality
            </label>
            <textarea
              id="tutor-personality"
              className="settings-textarea"
              value={instructionDraft.personality}
              maxLength={MAX_PERSONALITY_LENGTH}
              rows={4}
              aria-invalid={instructionMessage?.field === "personality" || undefined}
              aria-describedby={
                instructionMessage?.field === "personality"
                  ? instructionMessageId
                  : undefined
              }
              onChange={(event) => {
                updateInstructionField("personality", event.currentTarget.value);
              }}
            />
          </div>

          <div className="instruction-field">
            <label className="field-label" htmlFor="tutor-custom-prompts">
              Custom prompts
            </label>
            <textarea
              id="tutor-custom-prompts"
              className="settings-textarea settings-textarea--prompts"
              value={instructionDraft.customPrompts}
              maxLength={
                MAX_CUSTOM_PROMPTS * MAX_CUSTOM_PROMPT_LENGTH + MAX_CUSTOM_PROMPTS - 1
              }
              rows={6}
              aria-invalid={instructionMessage?.field === "customPrompts" || undefined}
              aria-describedby={
                instructionMessage?.field === "customPrompts"
                  ? instructionMessageId
                  : undefined
              }
              onChange={(event) => {
                updateInstructionField("customPrompts", event.currentTarget.value);
              }}
            />
          </div>

          <div className="instruction-field">
            <label className="field-label" htmlFor="student-background">
              Student background
            </label>
            <textarea
              id="student-background"
              className="settings-textarea"
              value={instructionDraft.studentBackground}
              maxLength={MAX_STUDENT_BACKGROUND_LENGTH}
              rows={4}
              aria-invalid={instructionMessage?.field === "studentBackground" || undefined}
              aria-describedby={
                instructionMessage?.field === "studentBackground"
                  ? instructionMessageId
                  : undefined
              }
              onChange={(event) => {
                updateInstructionField("studentBackground", event.currentTarget.value);
              }}
            />
          </div>

          {instructionMessage ? (
            <p
              id={instructionMessageId}
              className={`form-message form-message--${instructionMessage.tone}`}
              role={instructionMessage.tone === "error" ? "alert" : "status"}
            >
              {instructionMessage.text}
            </p>
          ) : null}

          <div className="dialog-actions">
            <button className="primary-button" type="submit">
              Apply tutor instructions
            </button>
          </div>
        </form>
      </section>

      <PromptPreview settings={settings} />

      <section aria-labelledby="pictures-title" className="settings-section">
        <h3 id="pictures-title">Profile pictures</h3>
        <div className="profile-picture-grid">
          <div className="profile-picture-control">
            <span className="field-label">Mathematician</span>
            {settings.profile.imageDataUrl ? (
              <img
                className="profile-picture-preview"
                src={settings.profile.imageDataUrl}
                alt={`${settings.profile.name} preview`}
              />
            ) : (
              <span className="profile-picture-empty" aria-hidden="true">
                No picture
              </span>
            )}
            <label className="sr-only" htmlFor="mathematician-picture">
              Import mathematician profile picture
            </label>
            <input
              id="mathematician-picture"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => {
                void readPicture("mathematician", event.currentTarget.files?.[0]);
                event.currentTarget.value = "";
              }}
            />
            {settings.profile.imageDataUrl ? (
              <button
                className="text-button"
                type="button"
                onClick={() => removePicture("mathematician")}
              >
                Remove mathematician picture
              </button>
            ) : null}
          </div>

          <div className="profile-picture-control">
            <span className="field-label">Student</span>
            {settings.student.imageDataUrl ? (
              <img
                className="profile-picture-preview"
                src={settings.student.imageDataUrl}
                alt={`${settings.student.name} preview`}
              />
            ) : (
              <span className="profile-picture-empty" aria-hidden="true">
                No picture
              </span>
            )}
            <label className="sr-only" htmlFor="student-picture">
              Import student profile picture
            </label>
            <input
              id="student-picture"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => {
                void readPicture("student", event.currentTarget.files?.[0]);
                event.currentTarget.value = "";
              }}
            />
            {settings.student.imageDataUrl ? (
              <button
                className="text-button"
                type="button"
                onClick={() => removePicture("student")}
              >
                Remove student picture
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <section aria-labelledby="import-title" className="settings-section">
        <div className="section-heading-inline">
          <h3 id="import-title">Import settings</h3>
          <button className="text-button" type="button" onClick={downloadCurrentSettings}>
            Download current settings
          </button>
        </div>

        <label className="field-label" htmlFor="settings-file">
          JSON file
        </label>
        <input
          id="settings-file"
          type="file"
          accept="application/json,.json"
          onChange={(event) => void readSettingsFile(event.currentTarget.files?.[0])}
        />

        <label className="field-label" htmlFor="settings-json">
          JSON
        </label>
        <textarea
          id="settings-json"
          className="settings-json"
          value={jsonText}
          onChange={(event) => {
            setJsonText(event.target.value);
            setMessage(null);
          }}
          spellCheck={false}
          aria-describedby={message?.tone === "error" ? errorId : undefined}
        />

        {message ? (
          <p
            id={message.tone === "error" ? errorId : undefined}
            className={"form-message form-message--" + message.tone}
            role={message.tone === "error" ? "alert" : "status"}
          >
            {message.text}
          </p>
        ) : null}

        <div className="dialog-actions">
          <button
            className="primary-button"
            type="button"
            onClick={applyImport}
            disabled={!jsonText.trim()}
          >
            Import
          </button>
        </div>
      </section>

    </dialog>
  );
}
