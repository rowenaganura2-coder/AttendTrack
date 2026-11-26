// Every request goes to /api — Vite forwards it to the Flask server on port 5000.
export async function api(path, { method = "GET", body } = {}) {
  let res;
  const isFormData = body instanceof FormData;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: "include",
      headers: body && !isFormData ? { "Content-Type": "application/json" } : undefined,
      body: body ? (isFormData ? body : JSON.stringify(body)) : undefined,
    });
  } catch {
    throw new Error("Can't reach the AttendTrack server. Make sure `python app.py` is running.");
  }
  let data = {};
  try {
    data = await res.json();
  } catch {
    if (res.status >= 500) {
      throw new Error("The server had a problem. Check that MySQL is running and the database is imported.");
    }
  }
  if (!res.ok) {
    const e = new Error(data.error || `Request failed (${res.status})`);
    e.status = res.status;
    throw e;
  }
  return data;
}

export const pad = (n) => String(n).padStart(2, "0");

export function toISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromISO(s) {
  const [y, m, d] = String(s).slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function prettyDate(s, opts = { weekday: "short", month: "short", day: "numeric", year: "numeric" }) {
  if (!s) return "—";
  return fromISO(s).toLocaleDateString(undefined, opts);
}

export function prettyTime(s) {
  if (!s) return "—";
  const [, t] = String(s).split(" ");
  if (!t) return "—";
  const [h, m] = t.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function initials(name = "") {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join("");
}
