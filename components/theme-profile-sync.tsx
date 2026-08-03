"use client";

import { useEffect } from "react";

type Preference = "system" | "light" | "dark";

export function ThemeProfileSync({ preference }: { preference: Preference }) {
  useEffect(() => {
    const current = window.localStorage.getItem("ghsmta-theme-preference");
    if (current === preference) return;
    window.localStorage.setItem("ghsmta-theme-preference", preference);
    window.dispatchEvent(
      new CustomEvent("ghsmta-theme-preference-change", { detail: preference }),
    );
  }, [preference]);

  return null;
}
