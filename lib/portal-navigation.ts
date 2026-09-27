export function isPortalRouteActive(pathname: string, href: string) {
  const normalizedHref = href.split(/[?#]/, 1)[0].replace(/\/$/, "") || "/";
  const normalizedPathname = pathname.replace(/\/$/, "") || "/";

  if (normalizedHref === "/portal") {
    return normalizedPathname === normalizedHref;
  }

  return (
    normalizedPathname === normalizedHref ||
    normalizedPathname.startsWith(`${normalizedHref}/`)
  );
}
