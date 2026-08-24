import type { LessonDefinition } from "../lessons";

export const SETTINGS_SCHEMA_VERSION = 1 as const;
export const EUCLID_LESSON_ID = "euclid-infinitely-many-primes";

export type LearningItemKind = "definition" | "lemma" | "proposition" | "theorem";
export type TutorProviderId = "local-codex";

export interface TutorSettings {
  schemaVersion: typeof SETTINGS_SCHEMA_VERSION;
  /** Retained in imported/exported settings so future providers remain an extension point. */
  providerId: TutorProviderId;
  profile: {
    name: string;
    personality: string;
    customPrompts: string[];
    imageDataUrl: string;
  };
  student: {
    name: string;
    imageDataUrl: string;
  };
  learningItems: Array<{
    id: string;
    kind: LearningItemKind;
    title: string;
    /** Optional teacher-authored statement; outline-only courses omit it. */
    statementLatex?: string;
    lessonId?: string;
  }>;
  studentBackground: string;
  selectedLessonId: string;
}

export const defaultTutorSettings: TutorSettings = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  providerId: "local-codex",
  profile: {
    name: "The Mathematician",
    personality:
      "Patient, precise, and Socratic. Ask focused questions and leave the decisive step to the student.",
    customPrompts: [
      "Prefer a small hint to a complete solution.",
      "Name a missing justification before accepting a proof step.",
      "Invite the student to compare strategies when there is a genuine choice.",
    ],
    imageDataUrl: "",
  },
  student: {
    name: "Student",
    imageDataUrl: "",
  },
  learningItems: [
    {
      id: "euclid-primes",
      kind: "theorem",
      title: "Euclid's theorem on prime numbers",
      statementLatex: "\\text{There are infinitely many prime numbers.}",
      lessonId: EUCLID_LESSON_ID,
    },
  ],
  studentBackground:
    "The student knows divisibility, prime numbers, proof by contradiction, and that every integer greater than 1 has a prime divisor.",
  selectedLessonId: EUCLID_LESSON_ID,
};

export function applyBuiltInLessonSettings(
  current: TutorSettings,
  lesson: LessonDefinition,
): TutorSettings {
  return {
    ...current,
    selectedLessonId: lesson.id,
    profile: {
      ...current.profile,
      name: lesson.settings.profile.name,
      personality: lesson.settings.profile.personality,
      customPrompts: [...lesson.settings.profile.customPrompts],
    },
    studentBackground: lesson.settings.studentBackgroundPrompt,
    learningItems: lesson.settings.curriculum.map((statement) => ({
      id: statement.id,
      kind: statement.kind,
      title: statement.title,
      ...(statement.latex ? { statementLatex: statement.latex } : {}),
      lessonId: lesson.id,
    })),
  };
}

export const MAX_SETTINGS_FILE_SIZE = 2_100_000;
export const MAX_PROFILE_IMAGE_FILE_SIZE = 600_000;
const MAX_IMAGE_DATA_URL_LENGTH = 850_000;
const MAX_ITEMS = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(
  value: unknown,
  label: string,
  maximum: number,
  allowEmpty = false,
): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be text.`);
  }
  const normalized = value.trim();
  if (!allowEmpty && !normalized) {
    throw new Error(`${label} cannot be empty.`);
  }
  if (normalized.length > maximum) {
    throw new Error(`${label} is longer than ${maximum.toLocaleString()} characters.`);
  }
  return normalized;
}

function optionalImageDataUrl(value: unknown, label: string): string {
  if (value === undefined || value === "") return "";
  if (typeof value !== "string") {
    throw new Error(`${label} must be an imported image.`);
  }
  if (value.length > MAX_IMAGE_DATA_URL_LENGTH) {
    throw new Error(`${label} is too large. Choose an image smaller than 600 KB.`);
  }
  if (!/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(value)) {
    throw new Error(`${label} must be a PNG, JPEG, or WebP image.`);
  }
  return value;
}

function legacyProfileImage(value: unknown): string {
  if (value === undefined) return "";
  if (!isRecord(value)) return "";
  const candidates = [value.neutral, ...Object.values(value)];
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === "") continue;
    return optionalImageDataUrl(candidate, "legacy profile image");
  }
  return "";
}

export function parseTutorSettings(raw: string): TutorSettings {
  if (!raw.trim()) throw new Error("Paste settings JSON or choose a JSON file.");
  if (raw.length > MAX_SETTINGS_FILE_SIZE) {
    throw new Error("The settings file is too large. The limit is 2.1 MB.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("This is not valid JSON. Check commas and quotation marks.");
  }

  if (!isRecord(parsed)) throw new Error("The settings root must be an object.");
  if (parsed.schemaVersion !== SETTINGS_SCHEMA_VERSION) {
    throw new Error("This site supports settings schemaVersion 1.");
  }
  if (!isRecord(parsed.profile)) throw new Error("profile must be an object.");

  const customPrompts = parsed.profile.customPrompts;
  if (!Array.isArray(customPrompts) || customPrompts.length > 12) {
    throw new Error("profile.customPrompts must be a list of at most 12 prompts.");
  }

  if (!Array.isArray(parsed.learningItems) || parsed.learningItems.length === 0) {
    throw new Error("learningItems must contain at least one statement.");
  }
  if (parsed.learningItems.length > MAX_ITEMS) {
    throw new Error(`learningItems may contain at most ${MAX_ITEMS} statements.`);
  }

  const seenIds = new Set<string>();
  const learningItems = parsed.learningItems.map((item, index) => {
    if (!isRecord(item)) throw new Error(`learningItems[${index}] must be an object.`);
    const id = boundedString(item.id, `learningItems[${index}].id`, 80);
    if (!/^[a-z0-9][a-z0-9-_]*$/i.test(id)) {
      throw new Error(`learningItems[${index}].id may use letters, numbers, - and _.`);
    }
    if (seenIds.has(id)) throw new Error(`The learning item id "${id}" is duplicated.`);
    seenIds.add(id);

    if (!(["definition", "lemma", "proposition", "theorem"] as unknown[]).includes(item.kind)) {
      throw new Error(
        `learningItems[${index}].kind must be definition, lemma, proposition, or theorem.`,
      );
    }

    const lessonId =
      item.lessonId === undefined
        ? undefined
        : boundedString(item.lessonId, `learningItems[${index}].lessonId`, 100);

    const statementLatex =
      item.statementLatex === undefined
        ? undefined
        : boundedString(
            item.statementLatex,
            `learningItems[${index}].statementLatex`,
            4_000,
            true,
          );

    return {
      id,
      kind: item.kind as LearningItemKind,
      title: boundedString(item.title, `learningItems[${index}].title`, 160),
      ...(statementLatex ? { statementLatex } : {}),
      ...(lessonId ? { lessonId } : {}),
    };
  });

  const selectedLessonId = boundedString(
    parsed.selectedLessonId,
    "selectedLessonId",
    100,
  );
  const profileImageDataUrl = optionalImageDataUrl(
    parsed.profile.imageDataUrl,
    "profile.imageDataUrl",
  );
  const migratedProfileImage = legacyProfileImage(parsed.profile.expressionImages);
  if (
    parsed.providerId !== undefined &&
    parsed.providerId !== "scripted-demo" &&
    parsed.providerId !== "local-codex"
  ) {
    throw new Error("providerId must be local-codex.");
  }

  const newStudent = isRecord(parsed.student) ? parsed.student : null;
  const legacyStudent = isRecord(parsed.learner) ? parsed.learner : null;
  const studentNameValue = newStudent?.name ?? legacyStudent?.name ?? "Student";
  const studentImageValue = newStudent?.imageDataUrl ?? legacyStudent?.imageDataUrl;
  const studentBackgroundValue = parsed.studentBackground ?? parsed.learnerBackground;

  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    providerId: "local-codex",
    profile: {
      name: boundedString(parsed.profile.name, "profile.name", 80),
      personality: boundedString(parsed.profile.personality, "profile.personality", 2_000),
      customPrompts: customPrompts.map((prompt, index) =>
        boundedString(prompt, `profile.customPrompts[${index}]`, 1_000),
      ),
      imageDataUrl: profileImageDataUrl || migratedProfileImage,
    },
    student: {
      name: boundedString(studentNameValue, "student.name", 80),
      imageDataUrl: optionalImageDataUrl(studentImageValue, "student.imageDataUrl"),
    },
    learningItems,
    studentBackground: boundedString(
      studentBackgroundValue,
      "studentBackground",
      4_000,
    ),
    selectedLessonId,
  };
}

export function serializeTutorSettings(settings: TutorSettings): string {
  return JSON.stringify(
    {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      providerId: "local-codex",
      profile: {
        name: settings.profile.name,
        personality: settings.profile.personality,
        customPrompts: [...settings.profile.customPrompts],
        imageDataUrl: settings.profile.imageDataUrl,
      },
      student: {
        name: settings.student.name,
        imageDataUrl: settings.student.imageDataUrl,
      },
      learningItems: settings.learningItems.map((item) => ({ ...item })),
      studentBackground: settings.studentBackground,
      selectedLessonId: settings.selectedLessonId,
    },
    null,
    2,
  );
}
