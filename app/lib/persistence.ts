import {
  defaultTutorSettings,
  parseTutorSettings,
  type TutorSettings,
} from "./settings";

export const SETTINGS_STORAGE_KEY = "ai-mathematician.settings.v1";
export const SESSION_STORAGE_KEY = "ai-mathematician.session.v1";

export interface StorageResult<T> {
  value: T;
  warning?: string;
}

export function loadSettings(): StorageResult<TutorSettings> {
  try {
    const stored = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!stored) return { value: defaultTutorSettings };
    return { value: parseTutorSettings(stored) };
  } catch {
    return {
      value: defaultTutorSettings,
      warning:
        "Saved settings could not be read. The built-in Euclid settings are in use.",
    };
  }
}

export function saveSettings(settings: TutorSettings): string | undefined {
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    return undefined;
  } catch {
    return "Settings are active for this tab but could not be saved in this browser.";
  }
}

export function loadSession<T>(): StorageResult<T | null> {
  try {
    const stored = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!stored) return { value: null };
    return { value: JSON.parse(stored) as T };
  } catch {
    return {
      value: null,
      warning:
        "Saved lesson progress was unreadable, so a fresh local session was started.",
    };
  }
}

export function saveSession(value: unknown): string | undefined {
  try {
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(value));
    return undefined;
  } catch {
    return "Progress could not be saved. You can continue while this page remains open.";
  }
}

export function clearSavedSession(): string | undefined {
  try {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    return undefined;
  } catch {
    return "The saved session could not be cleared, but a fresh session is open now.";
  }
}

