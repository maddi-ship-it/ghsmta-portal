"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";

import { isPortalRouteActive } from "@/lib/portal-navigation";

type PortalNavLinkProps = ComponentProps<typeof Link>;

export function PortalNavLink({
  className,
  href,
  ...props
}: PortalNavLinkProps) {
  const pathname = usePathname();
  const hrefValue = typeof href === "string" ? href : href.pathname ?? "";
  const active = isPortalRouteActive(pathname, hrefValue);
  const resolvedClassName =
    typeof className === "string"
      ? `${className}${active ? " is-active" : ""}`
      : className;

  return (
    <Link
      {...props}
      aria-current={active ? "page" : undefined}
      className={resolvedClassName}
      href={href}
    />
  );
}
