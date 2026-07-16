const staticPathPattern = /^[a-zA-Z0-9._/-]+$/;

export function resolveStaticAsset(
  requestUrl: string,
  root: URL,
): URL | undefined {
  let pathname: string;
  try {
    new URL(requestUrl);
    const rawPath = requestUrl.match(
      /^[a-z][a-z0-9+.-]*:\/\/(?:\[[^\]]+\]|[^/?#]*)([^?#]*)/i,
    )?.[1];
    pathname = decodeURIComponent(rawPath || "/");
  } catch {
    return undefined;
  }

  if (pathname.startsWith("//") || pathname.includes("\\")) return undefined;
  const segments = pathname.split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return undefined;
  }

  const safePath = pathname === "/" ? "index.html" : pathname.slice(1);
  if (
    !safePath ||
    safePath.startsWith("/") ||
    !staticPathPattern.test(safePath)
  ) {
    return undefined;
  }

  const asset = new URL(`./${safePath}`, root);
  return asset.href.startsWith(root.href) ? asset : undefined;
}
