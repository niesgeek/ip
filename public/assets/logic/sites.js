/** Short list written for this page. Not taken from another product's probe set. */
export const SITE_PROBES = [
  { id: "baidu", host: "www.baidu.com", zh: "百度", en: "Baidu" },
  { id: "bilibili", host: "www.bilibili.com", zh: "哔哩哔哩", en: "Bilibili" },
  { id: "qq", host: "www.qq.com", zh: "腾讯", en: "Tencent" },
  { id: "taobao", host: "www.taobao.com", zh: "淘宝", en: "Taobao" },
  { id: "zhihu", host: "www.zhihu.com", zh: "知乎", en: "Zhihu" },
  { id: "wangyi", host: "www.163.com", zh: "网易", en: "NetEase" },
  { id: "wikipedia", host: "zh.wikipedia.org", zh: "维基百科", en: "Wikipedia" },
  { id: "github", host: "github.com", zh: "GitHub", en: "GitHub" },
  { id: "cloudflare", host: "www.cloudflare.com", zh: "Cloudflare", en: "Cloudflare" },
  { id: "apple", host: "www.apple.com", zh: "Apple", en: "Apple" },
];

export const CUSTOM_SITE_LIMIT = 4;

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
