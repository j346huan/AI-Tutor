"use client";

import { useMemo, useRef, useState } from "react";
import { lessonCatalog } from "../lessons";
import {
  buildInitializationPromptPreview,
  type TutorProviderContext,
} from "../providers";
import type { TutorSettings } from "../lib/settings";

function contextFromSettings(settings: TutorSettings): TutorProviderContext {
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

export function PromptPreview({ settings }: { settings: TutorSettings }) {
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [copyStatus, setCopyStatus] = useState<{
    prompt: string;
    message: string;
  } | null>(null);
  const preview = useMemo(() => {
    const lesson =
      lessonCatalog.find((candidate) => candidate.id === settings.selectedLessonId) ??
      lessonCatalog[0];
    return buildInitializationPromptPreview(lesson, contextFromSettings(settings));
  }, [settings]);

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(preview.prompt);
      setCopyStatus({ prompt: preview.prompt, message: "Copied." });
    } catch {
      promptRef.current?.focus();
      promptRef.current?.select();
      setCopyStatus({
        prompt: preview.prompt,
        message: "The prompt is selected. Copy it with your keyboard.",
      });
    }
  };

  const downloadPrompt = () => {
    const blob = new Blob([preview.prompt], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "ai-mathematician-initialization-prompt.txt";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section
      className="settings-section prompt-preview"
      aria-labelledby="compiled-prompt-title"
    >
      <h3 id="compiled-prompt-title">Compiled prompt</h3>

      <label className="sr-only" htmlFor="compiled-initialization-prompt">
        Initialization prompt
      </label>
      <textarea
        ref={promptRef}
        id="compiled-initialization-prompt"
        className="compiled-prompt-text"
        value={preview.prompt}
        readOnly
        rows={18}
        spellCheck={false}
      />

      <div className="dialog-actions prompt-preview-actions">
        <button className="primary-button primary-button--small" type="button" onClick={copyPrompt}>
          Copy prompt
        </button>
        <button className="text-button" type="button" onClick={downloadPrompt}>
          Download text
        </button>
        {copyStatus?.prompt === preview.prompt ? (
          <span role="status">{copyStatus.message}</span>
        ) : null}
      </div>
    </section>
  );
}
