/** Homepage site list. Names match the card grid; the probe code is this site's own. */
export const SITE_PROBES = [
  { id: "google", host: "www.google.com", zh: "Google", en: "Google" },
  { id: "youtube", host: "www.youtube.com", zh: "YouTube", en: "YouTube" },
  { id: "github", host: "github.com", zh: "GitHub", en: "GitHub" },
  { id: "cloudflare", host: "www.cloudflare.com", zh: "Cloudflare", en: "Cloudflare" },
  { id: "claude", host: "claude.ai", zh: "Claude", en: "Claude" },
  { id: "chatgpt", host: "chatgpt.com", zh: "ChatGPT", en: "ChatGPT" },
  { id: "wechat", host: "weixin.qq.com", zh: "WeChat", en: "WeChat" },
];

export const CUSTOM_SITE_LIMIT = 4;
export const SPARK_SLOTS = 8;

export function probeUrl(host) {
  return `https://${host}/favicon.ico`;
}

/** Accept a bare host or a URL and return a hostname, or null. */
export function normalizeHost(input) {
  let raw = String(input || "").trim();
  if (!raw) return null;
  raw = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  raw = raw.split(/[/?#]/)[0];
  raw = raw.replace(/:\d+$/, "").replace(/\.$/, "");
  if (raw.startsWith("[") && raw.endsWith("]")) return null;
  if (!/^[a-z0-9.-]+$/i.test(raw)) return null;
  if (raw.length > 253 || !raw.includes(".") || raw.startsWith(".") || raw.endsWith(".") || raw.includes("..")) return null;
  if (raw.split(".").some((label) => !label || label.length > 63)) return null;
  return raw.toLowerCase();
}

export function classifyProbe({ ok, reason }) {
  if (ok) return "open";
  if (reason === "timeout") return "timeout";
  return "fail";
}

/** Keep a short in-page latency trail. Null marks a sample that did not connect. */
export function rememberLatency(history, sample, limit = SPARK_SLOTS) {
  const next = Array.isArray(history) ? history.slice() : [];
  const value = Number.isFinite(sample) ? Math.max(0, Math.round(sample)) : null;
  next.push(value);
  const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : SPARK_SLOTS;
  return next.slice(-cap);
}

/** Bar heights for one card. Empty slots stay in the row so the sparkline has a stable width. */
export function sparkBars(history, slots = SPARK_SLOTS) {
  const cap = Number.isFinite(slots) && slots > 0 ? Math.floor(slots) : SPARK_SLOTS;
  const recent = Array.isArray(history) ? history.slice(-cap) : [];
  const padded = Array.from({ length: cap }, (_, index) => {
    const offset = cap - recent.length;
    return index < offset ? null : recent[index - offset];
  });
  const finite = padded.filter((value) => Number.isFinite(value) && value > 0);
  const peak = Math.max(1, ...finite);
  return padded.map((value) => {
    if (!Number.isFinite(value)) return { height: 16, tone: "empty" };
    const height = Math.max(22, Math.round((value / peak) * 100));
    const tone = value < 180 ? "fast" : value < 450 ? "mid" : "slow";
    return { height, tone };
  });
}
