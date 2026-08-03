"use client";

import { Suspense, useEffect, useLayoutEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const STORAGE_KEY = "ghsmta:portal-scroll-position";
const MAX_RESTORE_AGE_MS = 30_000;

type SavedScrollPosition = {
  path: string;
  top: number;
  savedAt: number;
};

function PortalScrollManagerInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();

  useEffect(() => {
    function rememberPosition(event: SubmitEvent) {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (!form.closest(".portal-shell")) return;
      if (form.target && form.target !== "_self") return;
      if (form.dataset.scrollReset === "true") return;

      const position: SavedScrollPosition = {
        path: window.location.pathname,
        top: window.scrollY,
        savedAt: Date.now(),
      };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(position));
    }

    document.addEventListener("submit", rememberPosition, true);
    return () => document.removeEventListener("submit", rememberPosition, true);
  }, []);

  useLayoutEffect(() => {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (!saved) return;

    let position: SavedScrollPosition | null = null;
    try {
      position = JSON.parse(saved) as SavedScrollPosition;
    } catch {
      sessionStorage.removeItem(STORAGE_KEY);
      return;
    }
    if (
      position.path !== pathname ||
      Date.now() - position.savedAt > MAX_RESTORE_AGE_MS
    ) {
      return;
    }

    sessionStorage.removeItem(STORAGE_KEY);
    const firstFrame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.scrollTo({ top: position?.top ?? 0, behavior: "instant" });
      });
    });
    return () => window.cancelAnimationFrame(firstFrame);
  }, [pathname, search]);

  return null;
}

export function PortalScrollManager() {
  return (
    <Suspense fallback={null}>
      <PortalScrollManagerInner />
    </Suspense>
  );
}
