const desktopSessionKey = "portfolio:desktop-override";

/** Run once before React mounts. Never attach resize/orientation listeners. */
export function redirectSmallViewport(destination: string, minWidth: number): boolean {
  const requestedDesktop =
    new URLSearchParams(window.location.search).get("desktop") === "1";
  let preferDesktop = requestedDesktop;
  try {
    if (requestedDesktop) sessionStorage.setItem(desktopSessionKey, "1");
    preferDesktop ||= sessionStorage.getItem(desktopSessionKey) === "1";
  } catch {
    // Private/storage-restricted browsers still honor the query parameter.
  }

  if (preferDesktop || window.innerWidth >= minWidth) return false;

  try {
    const target = new URL(destination);
    // Fail open for invalid configuration and prevent self-redirect loops.
    if (target.protocol !== "https:" || target.origin === window.location.origin) {
      return false;
    }
    // Replace avoids trapping Back on the automatic redirect. Do not forward
    // desktop query parameters or hashes to the independent classic project.
    window.location.replace(target.href);
    return true;
  } catch {
    return false;
  }
}
