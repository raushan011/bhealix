/**
 * Where to land after signing in.
 *
 * `?next=` is read off the address bar, which is to say from anybody, so it is
 * accepted only as a path on this site: no other host, no protocol-relative
 * `//evil`, and never a login screen — a `next` that points back at the form
 * is how "Signing you in…" spins for ever.
 */
export function landingPath(next: string | null | undefined, fallback: string): string {
  const value = (next ?? "").trim();
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (/^\/(login|super-admin|partner\/login|partner\/register)(\/|\?|$)/.test(value)) return fallback;
  return value;
}
