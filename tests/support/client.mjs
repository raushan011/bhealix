/**
 * An HTTP client that behaves like a browser tab.
 *
 * The app authenticates with an httpOnly `bhealix_session` cookie, so every
 * test that does anything at all needs a cookie jar. Node's fetch has none —
 * it neither stores a Set-Cookie nor sends one back — so signing in and then
 * making a request would silently be an anonymous request, and every
 * authorisation test would pass for the wrong reason.
 */
import { BASE_URL, TEST_PASSWORD, ACCOUNTS } from "./config.mjs";

/** A single browser session: its own cookies, nobody else's. */
export class Client {
  constructor(baseUrl = BASE_URL) {
    this.baseUrl = baseUrl;
    this.cookies = new Map();
    this.session = null;
  }

  /** Stores whatever the response set, so the next request carries it. */
  #absorb(response) {
    const raw = response.headers.getSetCookie?.() ?? [];
    for (const entry of raw) {
      const [pair] = entry.split(";");
      const index = pair.indexOf("=");
      if (index < 1) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      // An expiry in the past is a deletion — logout works by sending one.
      if (value === "" || /expires=Thu, 01 Jan 1970/i.test(entry) || /max-age=0/i.test(entry)) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
  }

  get cookieHeader() {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  /**
   * One request. Returns status, headers and the parsed body together, because
   * a test almost always asserts on the status *and* the message, and the app
   * returns JSON for both success (`{data}`) and failure (`{error}`).
   */
  async request(method, url, { body, headers = {}, raw = false, timeoutMs = 30_000 } = {}) {
    const target = url.startsWith("http") ? url : `${this.baseUrl}${url}`;
    const init = { method, headers: { ...headers }, redirect: "manual" };

    if (this.cookies.size) init.headers.cookie = this.cookieHeader;

    if (body instanceof FormData) {
      init.body = body; // fetch sets the multipart boundary itself.
    } else if (body !== undefined) {
      init.headers["content-type"] ??= "application/json";
      init.body = typeof body === "string" ? body : JSON.stringify(body);
    }

    const started = performance.now();
    const response = await fetch(target, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const ms = performance.now() - started;
    this.#absorb(response);

    if (raw) return { status: response.status, headers: response.headers, response, ms };

    const text = await response.text();
    let json;
    try { json = text ? JSON.parse(text) : undefined; } catch { /* HTML page, not JSON */ }

    return {
      status: response.status,
      headers: response.headers,
      body: json,
      text,
      ms,
      data: json?.data,
      error: json?.error
    };
  }

  get(url, options) { return this.request("GET", url, options); }
  post(url, body, options) { return this.request("POST", url, { ...options, body }); }
  patch(url, body, options) { return this.request("PATCH", url, { ...options, body }); }
  put(url, body, options) { return this.request("PUT", url, { ...options, body }); }
  delete(url, options) { return this.request("DELETE", url, options); }

  /** Signs in and keeps the session, so `client.session.role` is available to tests. */
  async login(identifier, password = TEST_PASSWORD) {
    const result = await this.post("/api/auth/login", { identifier, password });
    if (result.status !== 200) {
      throw new Error(`Login failed for ${identifier}: ${result.status} ${result.error ?? result.text}`);
    }
    this.session = result.data;
    return this;
  }

  async logout() {
    await this.post("/api/auth/logout", {});
    this.session = null;
    return this;
  }
}

/** A signed-in client for one of the seeded roles: `await as("MR")`. */
export async function as(role) {
  const account = ACCOUNTS[role];
  if (!account) throw new Error(`Unknown test role: ${role}`);
  return new Client().login(account.email);
}

/** A client that has never signed in. */
export function anonymous() {
  return new Client();
}

/**
 * Waits for the server to answer before a suite starts.
 *
 * A connection-refused error on the first test reads like a broken test rather
 * than a server nobody started, which costs more time to diagnose than this
 * costs to run.
 */
export async function waitForServer(url = BASE_URL, { attempts = 30, delayMs = 1000 } = {}) {
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(`${url}/api/auth/me`, { signal: AbortSignal.timeout(5000) });
      if (response.status < 500) return true;
    } catch { /* not up yet */ }
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  throw new Error(`No server answered at ${url} after ${attempts} attempts. Start it with: npm run build && npm start`);
}
