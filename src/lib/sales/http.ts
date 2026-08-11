/**
 * The one way this feature talks to somebody else's server.
 *
 * Two rules, both learned the hard way with third-party APIs:
 *
 * 1. **Every call has a deadline.** A sync that hangs on a socket holds a Vercel
 *    function open until the platform kills it, and the operator sees "something
 *    went wrong" with nothing to act on.
 * 2. **An error carries what the other side said.** "Request failed" is useless;
 *    "Shopify refused the token (401)" tells somebody exactly which field on the
 *    settings screen is wrong.
 */

export class IntegrationError extends Error {
  constructor(readonly service: string, message: string, readonly status?: number) {
    super(message);
    this.name = "IntegrationError";
  }
}

const DEFAULT_TIMEOUT = 20_000;

export type JsonRequest = {
  service: string;
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  timeout?: number;
};

/** The response body parsed as JSON, plus the headers — Shopify pages through a header. */
export async function httpJson<T>({ service, url, method = "GET", headers = {}, body, timeout = DEFAULT_TIMEOUT }: JsonRequest):
  Promise<{ data: T; headers: Headers }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: { accept: "application/json", ...(body ? { "content-type": "application/json" } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      cache: "no-store"
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    throw new IntegrationError(service, aborted
      ? `${service} did not answer within ${Math.round(timeout / 1000)} seconds.`
      : `Could not reach ${service}. Check the network and the shop address.`);
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  if (!response.ok) {
    throw new IntegrationError(service, `${service} refused the request (${response.status}). ${summarise(text)}`.trim(), response.status);
  }

  try {
    return { data: (text ? JSON.parse(text) : {}) as T, headers: response.headers };
  } catch {
    throw new IntegrationError(service, `${service} answered with something that is not JSON.`);
  }
}

/**
 * The useful sentence out of an error body, short enough for a screen. Both
 * services answer with `{errors: …}` — sometimes a string, sometimes a map of
 * field to reasons — and sometimes with a page of HTML.
 */
function summarise(text: string): string {
  if (!text) return "";
  try {
    const parsed = JSON.parse(text) as { errors?: unknown; message?: string; error?: string };
    const errors = parsed.errors ?? parsed.message ?? parsed.error;
    if (typeof errors === "string") return errors.slice(0, 200);
    if (errors && typeof errors === "object") {
      return Object.entries(errors as Record<string, unknown>)
        .map(([field, reason]) => `${field}: ${Array.isArray(reason) ? reason.join(", ") : String(reason)}`)
        .join("; ").slice(0, 200);
    }
  } catch {
    // Not JSON — an HTML error page, most likely a wrong shop address.
  }
  return text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
}

/** A number from an API that cannot decide between `1499`, `"1499.00"` and `null`. */
export const amount = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
};
