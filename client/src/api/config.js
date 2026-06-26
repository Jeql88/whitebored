// HTTP API base — routes through Vercel proxy in prod so cookies are same-site.
// In dev, Vite proxies /api to localhost:4000.
export const API_BASE =
  import.meta.env.VITE_API_BASE ?? window.location.origin;

// Socket.IO must connect directly to the backend (Vercel can't proxy WebSockets).
// Falls back to API_BASE in dev (same host via Vite proxy).
export const SOCKET_BASE =
  import.meta.env.VITE_SOCKET_BASE ?? API_BASE;

let redirecting = false;
function handleUnauthorized() {
  if (redirecting) return;
  redirecting = true;
  if (!location.pathname.startsWith("/login")) {
    window.location.assign("/login");
  }
}

// Central fetch wrapper: 60s timeout, 401 handling, tolerant JSON parsing.
// BetterAuth uses cookie-based sessions — credentials: "include" ensures
// cookies are sent on cross-origin requests (dev Vite proxy is same-origin).
export async function apiFetch(path, { method = "GET", body, auth = true, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  const h = { ...headers };
  if (body !== undefined) h["Content-Type"] = "application/json";
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: h,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: "include",
      signal: controller.signal,
    });
    if (res.status === 401 && auth) {
      handleUnauthorized();
      return { error: "Session expired. Please sign in again." };
    }
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { error: `Server error (${res.status}).` };
    }
    if (!res.ok && !data.error) data.error = `Request failed (${res.status})`;
    return data;
  } catch (err) {
    if (err.name === "AbortError") {
      return { error: "The server took too long (it may be waking up). Try again." };
    }
    return { error: "Network error. Check your connection and retry." };
  } finally {
    clearTimeout(timer);
  }
}
