/**
 * Where to go after logging in (`/login?next=…`). Only a path inside the app is
 * accepted: it must start with "/" and not "//" or "/\" (both open another site).
 */
export function safeNextPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  // Control characters (tabs, line breaks) are dropped by browsers and could hide a "//".
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  return value;
}

/** Link to the login page that comes back to `path` afterwards. */
export function loginHref(path: string): string {
  return safeNextPath(path) && path !== "/" ? `/login?next=${encodeURIComponent(path)}` : "/login";
}
