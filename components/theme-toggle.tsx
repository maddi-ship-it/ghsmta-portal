"use client";

import { useEffect, useState } from "react";

type ThemeName = "dark" | "light";
type ThemeToggleVariant = "icon" | "setting";

const STORAGE_KEY = "ghsmta-theme";
const THEME_EVENT = "ghsmta-theme-change";

function readTheme(): ThemeName {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light"
    ? "light"
    : "dark";
}

function applyTheme(theme: ThemeName) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  window.localStorage.setItem(STORAGE_KEY, theme);
  window.dispatchEvent(
    new CustomEvent<ThemeName>(THEME_EVENT, {
      detail: theme,
    }),
  );
}

function SunIcon() {
  return (
    <svg
      aria-hidden="true"
      className="portal-utility-icon"
      viewBox="0 0 24 24"
    >
      <circle
        cx="12"
        cy="12"
        fill="none"
        r="4"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      aria-hidden="true"
      className="portal-utility-icon"
      viewBox="0 0 24 24"
    >
      <path
        d="M20.2 15.7A8.5 8.5 0 0 1 8.3 3.8 8.5 8.5 0 1 0 20.2 15.7Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

export function ThemeToggle({
  variant = "icon",
}: {
  variant?: ThemeToggleVariant;
}) {
  const [theme, setTheme] = useState<ThemeName>("dark");
  const nextTheme: ThemeName = theme === "dark" ? "light" : "dark";

  useEffect(() => {
    setTheme(readTheme());

    const handleThemeChange = (event: Event) => {
      const customEvent = event as CustomEvent<ThemeName>;
      setTheme(customEvent.detail ?? readTheme());
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) {
        setTheme(event.newValue === "light" ? "light" : "dark");
      }
    };

    window.addEventListener(THEME_EVENT, handleThemeChange);
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener(THEME_EVENT, handleThemeChange);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const label =
    nextTheme === "light"
      ? "Switch to light mode"
      : "Switch to dark mode";

  if (variant === "setting") {
    return (
      <button
        aria-label={label}
        className="theme-setting-toggle"
        onClick={() => applyTheme(nextTheme)}
        type="button"
      >
        <span className="theme-setting-icon">
          {theme === "dark" ? <MoonIcon /> : <SunIcon />}
        </span>

        <span className="theme-setting-copy">
          <strong>{theme === "dark" ? "Dark mode" : "Light mode"}</strong>
          <small>
            {theme === "dark"
              ? "Use a light page and dark text."
              : "Return to the midnight portal theme."}
          </small>
        </span>

        <span className="theme-setting-action">{label}</span>
      </button>
    );
  }

  return (
    <button
      aria-label={label}
      className="portal-utility-link theme-toggle-button"
      onClick={() => applyTheme(nextTheme)}
      title={label}
      type="button"
    >
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
