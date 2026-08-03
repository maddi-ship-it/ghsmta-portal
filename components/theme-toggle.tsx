"use client";

import { useSyncExternalStore } from "react";

import { createClient } from "@/lib/supabase/client";

type ThemeName = "dark" | "light";
type ThemePreference = "system" | "light" | "dark";
type ThemeToggleVariant = "icon" | "setting";

const STORAGE_KEY = "ghsmta-theme-preference";
const THEME_EVENT = "ghsmta-theme-preference-change";
const PREFERENCES: ThemePreference[] = ["system", "light", "dark"];
const THEME_COLORS: Record<ThemeName, string> = {
  dark: "#070b18",
  light: "#edf1f7",
};

function resolveTheme(preference: ThemePreference): ThemeName {
  if (preference !== "system") return preference;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function readPreference(): ThemePreference {
  if (typeof document === "undefined") return "system";
  const preference = document.documentElement.dataset.themePreference;
  return PREFERENCES.includes(preference as ThemePreference)
    ? (preference as ThemePreference)
    : "system";
}

function setDocumentTheme(preference: ThemePreference) {
  const theme = resolveTheme(preference);
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", THEME_COLORS[theme]);
}

async function applyPreference(preference: ThemePreference) {
  setDocumentTheme(preference);
  window.localStorage.setItem(STORAGE_KEY, preference);
  window.dispatchEvent(
    new CustomEvent<ThemePreference>(THEME_EVENT, { detail: preference }),
  );

  const supabase = createClient();
  await supabase.rpc("set_my_theme_preference", {
    p_preference: preference,
  });
}

function subscribeToTheme(onStoreChange: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const handleThemeChange = (event: Event) => {
    const preference =
      event instanceof CustomEvent && PREFERENCES.includes(event.detail)
        ? (event.detail as ThemePreference)
        : readPreference();
    setDocumentTheme(preference);
    onStoreChange();
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    const preference = PREFERENCES.includes(event.newValue as ThemePreference)
      ? (event.newValue as ThemePreference)
      : "system";
    setDocumentTheme(preference);
    onStoreChange();
  };
  const handleSystemTheme = () => {
    if (readPreference() === "system") setDocumentTheme("system");
    onStoreChange();
  };

  window.addEventListener(THEME_EVENT, handleThemeChange);
  window.addEventListener("storage", handleStorage);
  media.addEventListener("change", handleSystemTheme);

  return () => {
    window.removeEventListener(THEME_EVENT, handleThemeChange);
    window.removeEventListener("storage", handleStorage);
    media.removeEventListener("change", handleSystemTheme);
  };
}

function readServerPreference(): ThemePreference {
  return "system";
}

function ThemeIcon({ preference }: { preference: ThemePreference }) {
  if (preference === "system") {
    return (
      <svg aria-hidden="true" className="portal-utility-icon" viewBox="0 0 24 24">
        <rect x="3" y="4" width="18" height="13" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M8 21h8M12 17v4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      </svg>
    );
  }
  if (preference === "light") {
    return (
      <svg aria-hidden="true" className="portal-utility-icon" viewBox="0 0 24 24">
        <circle cx="12" cy="12" fill="none" r="4" stroke="currentColor" strokeWidth="1.8" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" className="portal-utility-icon" viewBox="0 0 24 24">
      <path d="M20.2 15.7A8.5 8.5 0 0 1 8.3 3.8 8.5 8.5 0 1 0 20.2 15.7Z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

export function ThemeToggle({ variant = "icon" }: { variant?: ThemeToggleVariant }) {
  const preference = useSyncExternalStore(
    subscribeToTheme,
    readPreference,
    readServerPreference,
  );
  const nextPreference = PREFERENCES[(PREFERENCES.indexOf(preference) + 1) % PREFERENCES.length];

  if (variant === "setting") {
    return (
      <fieldset className="theme-preference-fieldset">
        <legend>Appearance</legend>
        <p>Follow your device or choose a theme. This setting syncs to your portal account.</p>
        <div className="theme-preference-options">
          {PREFERENCES.map((option) => (
            <button
              aria-pressed={preference === option}
              className="theme-preference-option"
              key={option}
              onClick={() => void applyPreference(option)}
              type="button"
            >
              <ThemeIcon preference={option} />
              <span>{option[0].toUpperCase() + option.slice(1)}</span>
            </button>
          ))}
        </div>
      </fieldset>
    );
  }

  const label = `Theme: ${preference}. Switch to ${nextPreference}.`;
  return (
    <button
      aria-label={label}
      className="portal-utility-link theme-toggle-button"
      onClick={() => void applyPreference(nextPreference)}
      title={label}
      type="button"
    >
      <ThemeIcon preference={preference} />
    </button>
  );
}
