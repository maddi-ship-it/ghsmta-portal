"use client";

import { usePathname } from "next/navigation";
import {
  type ReactNode,
  useEffect,
  useId,
  useRef,
} from "react";

const HEADER_MENU_OPEN_EVENT = "ghsmta:header-menu-open";

type AutoClosingDetailsProps = {
  className: string;
  summary: ReactNode;
  children: ReactNode;
  summaryAriaLabel?: string;
};

export function AutoClosingDetails({
  className,
  summary,
  children,
  summaryAriaLabel,
}: AutoClosingDetailsProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();
  const menuId = useId();

  const closeMenu = () => {
    detailsRef.current?.removeAttribute("open");
  };

  useEffect(() => {
    closeMenu();
  }, [pathname]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const details = detailsRef.current;
      const target = event.target;

      if (
        details?.open &&
        target instanceof Node &&
        !details.contains(target)
      ) {
        closeMenu();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
        detailsRef.current
          ?.querySelector<HTMLElement>("summary")
          ?.focus();
      }
    };

    const handleAnotherMenuOpening = (event: Event) => {
      const customEvent = event as CustomEvent<string>;

      if (customEvent.detail !== menuId) {
        closeMenu();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener(
      HEADER_MENU_OPEN_EVENT,
      handleAnotherMenuOpening,
    );

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener(
        HEADER_MENU_OPEN_EVENT,
        handleAnotherMenuOpening,
      );
    };
  }, [menuId]);

  const handleToggle = () => {
    if (!detailsRef.current?.open) {
      return;
    }

    window.dispatchEvent(
      new CustomEvent(HEADER_MENU_OPEN_EVENT, {
        detail: menuId,
      }),
    );
  };

  const handleClickCapture = (
    event: React.MouseEvent<HTMLDetailsElement>,
  ) => {
    const target = event.target;

    if (
      target instanceof Element &&
      target.closest("a, button")
    ) {
      closeMenu();
    }
  };

  return (
    <details
      className={className}
      ref={detailsRef}
      onToggle={handleToggle}
      onClickCapture={handleClickCapture}
    >
      <summary aria-label={summaryAriaLabel}>{summary}</summary>
      {children}
    </details>
  );
}
