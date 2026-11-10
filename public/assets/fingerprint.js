import {
  GROUPS,
  buildPortrait,
  canonical,
  diffSignals,
  formatDigest,
  groupName,
  idsIn,
  makeSignal,
  missingSignalIds,
  networkSignals,
  orderSignals,
  sha256Hex,
  summarize,
} from "./logic/fp-core.js";
import { GROUP_EN, SIGNAL_EN, VALUE_EN } from "./logic/fp-en.js";
import { applyDom, bindLangToggle, getLang, L, onLang } from "./logic/i18n.js";

const $ = (sel) => document.querySelector(sel);
function statusLabel(status) {
  const zh = { ok: "已取得", absent: "未提供", blocked: "被拦住", volatile: "易变" };
  const en = { ok: "read", absent: "not provided", blocked: "blocked", volatile: "volatile" };
  return L(zh[status] || status, en[status] || status);
}
function signalName(row) {
  return getLang() === "en" ? (SIGNAL_EN[row.id]?.name || row.name) : row.name;
}
function signalNote(row) {
  return getLang() === "en" ? (SIGNAL_EN[row.id]?.note || row.note) : row.note;
}
function showValue(value) {
  if (getLang() !== "en" || value == null) return value;
  return VALUE_EN[value] || value;
}
const FONT_TEXT = "WwIi10 宽度Æ";
const FONT_BASES = ["monospace", "sans-serif", "serif"];
const FONT_CANDIDATES = [
  "Arial", "Calibri", "Cambria", "Candara", "Comic Sans MS", "Consolas", "Constantia",
  "Corbel", "Courier New", "Georgia", "Impact", "Segoe UI", "Tahoma", "Times New Roman",
  "Trebuchet MS", "Verdana", "Microsoft YaHei", "SimSun", "SimHei", "KaiTi", "FangSong",
  "DengXian", "Helvetica Neue", "Avenir Next", "Menlo", "Monaco", "PingFang SC",
  "Hiragino Sans GB", "Heiti SC", "Songti SC", "DejaVu Sans", "Liberation Sans",
  "Noto Sans CJK SC", "Noto Sans", "Ubuntu", "Roboto", "Source Han Sans SC",
];
const LAYOUT_PHRASES = ["mmmmmmmmm", "WWW", "宽度测试", "0OIl1", "ip lookup"];
const LAYOUT_STYLES = [
  "font-family:serif",
  "font-family:sans-serif",
  "font-family:monospace",
  "letter-spacing:2px",
  "font-weight:700",
  "font-style:italic",
];
const PERMISSIONS = [
  "geolocation", "camera", "microphone", "notifications",
  "persistent-storage", "clipboard-read", "clipboard-write",
];
const PERMISSION_TEXT = {
  granted: "已允许",
  denied: "已拒绝",
  prompt: "未决定",
  "policy-blocked": "站点策略拦住",
  unsupported: "不支持",
  error: "查询失败",
};

const state = {
  running: false,
  signals: [],
  previous: null,
  previousId: "",
  id: "",
  algo: "SHA-256",
  connection: null,
  group: "all",
  query: "",
  changedOnly: false,
  detailsOpen: false,
  closedGroups: new Set(),
  revealed: false,
  changes: [],
};

let latestBrands = [];
let toastTimer = 0;

function clip(text, max = 96) {
  const value = String(text || "");
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function formatOffset(minutesEast) {
  const sign = minutesEast >= 0 ? "+" : "-";
  const abs = Math.abs(minutesEast);
  const hours = String(Math.floor(abs / 60)).padStart(2, "0");
  const mins = String(abs % 60).padStart(2, "0");
  return `UTC${sign}${hours}:${mins}`;
}

function formatBytes(value) {
  const size0 = Number(value);
  if (!Number.isFinite(size0)) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = size0;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  const digits = index === 0 ? 0 : (size < 10 ? 2 : 1);
  return `${size.toFixed(digits)} ${units[index]}`;
}

function matches(query) {
  try {
    return !!window.matchMedia(query).matches;
  } catch {
    return false;
  }
}

function firstMatch(options, fallback) {
  for (const [query, value] of options) {
    if (matches(query)) return value;
  }
  return fallback;
}

function complete(ids, rows) {
  const map = new Map();
  for (const row of rows || []) {
    if (row?.id && !map.has(row.id)) map.set(row.id, row);
  }
  return ids.map((id) => map.get(id) || makeSignal({
    id,
    status: "blocked",
    value: "没有读到",
    hash: "blocked",
  }));
}

async function safe(group, fn) {
  const ids = idsIn(group);
  try {
    return complete(ids, await fn());
  } catch (error) {
    return ids.map((id) => makeSignal({
      id,
      status: "blocked",
      value: "采样失败",
      hash: "blocked",
      detail: error?.name || "error",
    }));
  }
}

function highEntropySignals(values) {
  const full = values.uaFullVersion || "";
  const list = Array.isArray(values.fullVersionList)
    ? values.fullVersionList.map((item) => `${item.brand}/${item.version}`).sort().join(" ")
    : "";
  const fullShown = [full, list].filter(Boolean).join(" · ");
  const platform = [values.platform, values.platformVersion].filter(Boolean).join(" ");
  const arch = [values.architecture, values.bitness].filter(Boolean).join(" / ");
  const model = values.model || "";
  const form = Array.isArray(values.formFactors) ? values.formFactors.join(", ") : "";
  return [
    makeSignal({ id: "ua-full", value: fullShown, status: fullShown ? "ok" : "absent", hash: `${full}\u241e${list}`, detail: fullShown }),
    makeSignal({ id: "ua-platform-version", value: platform, status: platform ? "ok" : "absent", hash: `${values.platform || ""}\u241e${values.platformVersion || ""}`, detail: platform }),
    makeSignal({ id: "ua-arch", value: arch, status: arch ? "ok" : "absent", hash: `${values.architecture || ""}\u241e${values.bitness || ""}`, detail: arch }),
    makeSignal({ id: "ua-model", value: model, status: model ? "ok" : "absent", hash: model, detail: model }),
    makeSignal({ id: "ua-form", value: form, status: form ? "ok" : "absent", hash: form, detail: form }),
  ];
}

async function collectIdentity() {
  const nav = navigator;
  const ua = nav.userAgent || "";
  const platform = nav.platform || "";
  const vendor = nav.vendor || "";
  const appVersion = nav.appVersion || "";
  const product = nav.product || "";
  const base = [
    makeSignal({ id: "ua", value: ua, status: ua ? "ok" : "absent", hash: ua, detail: ua }),
    makeSignal({ id: "platform", value: platform, status: platform ? "ok" : "absent", hash: platform, detail: platform }),
    makeSignal({ id: "vendor", value: vendor, status: vendor ? "ok" : "absent", hash: vendor, detail: vendor }),
    makeSignal({ id: "app-version", value: appVersion, status: appVersion ? "ok" : "absent", hash: appVersion, detail: appVersion }),
    makeSignal({ id: "product", value: product, status: product ? "ok" : "absent", hash: product, detail: product }),
  ];
  const hints = nav.userAgentData;
  if (!hints) {
    const note = "这个浏览器没有 navigator.userAgentData。";
    const absent = ["ua-brands", "ua-platform", "ua-mobile", "ua-full", "ua-platform-version", "ua-arch", "ua-model", "ua-form"]
      .map((id) => makeSignal({ id, value: "", status: "absent", hash: "absent", note }));
    return { signals: base.concat(absent), brands: [] };
  }
  const brands = Array.isArray(hints.brands)
    ? hints.brands.map((item) => ({ brand: item.brand || "", version: item.version || "" }))
    : [];
  const brandText = brands
    .slice()
    .sort((a, b) => a.brand.localeCompare(b.brand))
    .map((item) => `${item.brand}/${item.version}`)
    .join(" ");
  const low = [
    makeSignal({ id: "ua-brands", value: brandText, status: brandText ? "ok" : "absent", hash: brandText, detail: brandText }),
    makeSignal({ id: "ua-platform", value: hints.platform || "", status: hints.platform ? "ok" : "absent", hash: hints.platform || "", detail: hints.platform || "" }),
    makeSignal({
      id: "ua-mobile",
      value: hints.mobile == null ? "" : (hints.mobile ? "是" : "否"),
      status: hints.mobile == null ? "absent" : "ok",
      hash: hints.mobile == null ? "" : (hints.mobile ? "1" : "0"),
      detail: hints.mobile == null ? "" : String(!!hints.mobile),
    }),
  ];
  let high;
  if (typeof hints.getHighEntropyValues !== "function") {
    high = ["ua-full", "ua-platform-version", "ua-arch", "ua-model", "ua-form"]
      .map((id) => makeSignal({ id, value: "", status: "absent", hash: "absent" }));
  } else {
    try {
      const values = await hints.getHighEntropyValues([
        "architecture", "bitness", "model", "platformVersion", "uaFullVersion", "fullVersionList", "formFactors",
      ]);
      high = highEntropySignals(values || {});
    } catch {
      high = ["ua-full", "ua-platform-version", "ua-arch", "ua-model", "ua-form"].map((id) => makeSignal({
        id,
        value: "浏览器拒绝提供",
        status: "blocked",
        hash: "blocked",
      }));
    }
  }
  return { signals: base.concat(low, high), brands };
}

function collectLocale() {
  const nav = navigator;
  const langs = nav.languages?.length ? [...nav.languages] : (nav.language ? [nav.language] : []);
  let tz = "";
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { tz = ""; }
  let offsetMin = null;
  try { offsetMin = -new Date().getTimezoneOffset(); } catch { offsetMin = null; }
  const offsetText = offsetMin == null ? "" : formatOffset(offsetMin);
  let resolved = {};
  try { resolved = Intl.DateTimeFormat().resolvedOptions(); } catch { resolved = {}; }
  const keys = ["calendar", "numberingSystem", "hourCycle", "collation"];
  const intlText = keys.filter((key) => resolved[key] != null).map((key) => `${key}=${resolved[key]}`).join(" ");
  const intlHash = keys.map((key) => `${key}=${resolved[key] ?? ""}`).join(";");
  let formatted = "";
  try {
    const sample = new Date(Date.UTC(2020, 0, 15, 13, 45, 0));
    const money = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(1234.5);
    const num = new Intl.NumberFormat().format(1234567.89);
    const day = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(sample);
    formatted = `${money} | ${num} | ${day}`;
  } catch {
    formatted = "";
  }
  return [
    makeSignal({ id: "lang", value: nav.language || "", status: nav.language ? "ok" : "absent", hash: nav.language || "", detail: nav.language || "" }),
    makeSignal({ id: "langs", value: langs.join(", "), status: langs.length ? "ok" : "absent", hash: langs.join(","), detail: langs.join("\n") }),
    makeSignal({ id: "tz", value: tz, status: tz ? "ok" : "absent", hash: tz, detail: tz }),
    makeSignal({ id: "tz-offset", value: offsetText, status: offsetText ? "ok" : "absent", hash: offsetMin == null ? "" : String(offsetMin), detail: offsetText }),
    makeSignal({ id: "intl", value: intlText, status: intlText ? "ok" : "absent", hash: intlHash, detail: intlText }),
    makeSignal({ id: "locale-format", value: formatted, status: formatted ? "ok" : "absent", hash: formatted, detail: formatted }),
  ];
}

function mediaSignals() {
  const scheme = firstMatch([["(prefers-color-scheme: dark)", "dark"], ["(prefers-color-scheme: light)", "light"]], "unknown");
  const contrast = firstMatch([
    ["(prefers-contrast: more)", "more"],
    ["(prefers-contrast: less)", "less"],
    ["(prefers-contrast: custom)", "custom"],
    ["(prefers-contrast: no-preference)", "no-preference"],
  ], "unknown");
  const motion = firstMatch([["(prefers-reduced-motion: reduce)", "reduce"], ["(prefers-reduced-motion: no-preference)", "no-preference"]], "unknown");
  const pointer = firstMatch([["(pointer: fine)", "fine"], ["(pointer: coarse)", "coarse"], ["(pointer: none)", "none"]], "unknown");
  const hover = firstMatch([["(any-hover: hover)", "hover"], ["(any-hover: none)", "none"]], "unknown");
  const gamut = firstMatch([["(color-gamut: rec2020)", "rec2020"], ["(color-gamut: p3)", "p3"], ["(color-gamut: srgb)", "srgb"]], "unknown");
  const forced = firstMatch([["(forced-colors: active)", "active"], ["(forced-colors: none)", "none"]], "unknown");
  const display = firstMatch([
    ["(display-mode: fullscreen)", "fullscreen"],
    ["(display-mode: standalone)", "standalone"],
    ["(display-mode: minimal-ui)", "minimal-ui"],
    ["(display-mode: window-controls-overlay)", "window-controls-overlay"],
    ["(display-mode: browser)", "browser"],
  ], "unknown");
  return [
    ["scheme", scheme],
    ["contrast", contrast],
    ["motion", motion],
    ["pointer", pointer],
    ["hover", hover],
    ["gamut", gamut],
    ["forced", forced],
    ["display-mode", display],
  ].map(([id, value]) => makeSignal({ id, value, status: "ok", hash: value, detail: value }));
}

function collectScreen() {
  const screenInfo = window.screen || {};
  const res = screenInfo.width ? `${screenInfo.width}×${screenInfo.height}` : "";
  const avail = screenInfo.availWidth ? `${screenInfo.availWidth}×${screenInfo.availHeight}` : "";
  let dock = "";
  if (screenInfo.width && screenInfo.availWidth) {
    const dx = screenInfo.width - screenInfo.availWidth;
    const dy = screenInfo.height - screenInfo.availHeight;
    dock = dx || dy ? `（系统栏约占 ${dx}×${dy}）` : "（没有明显的系统栏占位）";
  }
  const dpr = window.devicePixelRatio;
  const dprShown = typeof dpr === "number" && !Number.isNaN(dpr) ? `${Math.round(dpr * 100) / 100}x` : "";
  const depth = screenInfo.colorDepth ? `${screenInfo.colorDepth} bit` : "";
  const viewport = `${window.innerWidth || 0}×${window.innerHeight || 0} / 外窗 ${window.outerWidth || 0}×${window.outerHeight || 0}`;
  const orient = screenInfo.orientation || {};
  const orientText = [orient.type, orient.angle != null ? `${orient.angle}°` : ""].filter(Boolean).join(" ");
  const extended = "isExtended" in screenInfo
    ? makeSignal({
      id: "extended",
      value: screenInfo.isExtended ? "多屏" : "单屏",
      status: "ok",
      hash: screenInfo.isExtended ? "1" : "0",
      detail: String(!!screenInfo.isExtended),
    })
    : makeSignal({ id: "extended", value: "", status: "absent", hash: "absent" });
  const media = typeof window.matchMedia === "function"
    ? mediaSignals()
    : ["scheme", "contrast", "motion", "pointer", "hover", "gamut", "forced", "display-mode"]
      .map((id) => makeSignal({ id, value: "", status: "absent", hash: "absent" }));
  return [
    makeSignal({ id: "screen", value: res, status: res ? "ok" : "absent", hash: res.replace("×", "x"), detail: res }),
    makeSignal({ id: "avail", value: avail ? `${avail}${dock}` : "", status: avail ? "ok" : "absent", hash: avail.replace("×", "x"), detail: avail }),
    makeSignal({ id: "dpr", value: dprShown, status: dprShown ? "ok" : "absent", hash: dprShown ? String(dpr) : "", detail: dprShown ? String(dpr) : "" }),
    makeSignal({ id: "depth", value: depth, status: depth ? "ok" : "absent", hash: `${screenInfo.colorDepth || ""}/${screenInfo.pixelDepth || ""}`, detail: `color=${screenInfo.colorDepth || ""} pixel=${screenInfo.pixelDepth || ""}` }),
    makeSignal({
      id: "viewport",
      value: viewport,
      status: "volatile",
      hash: `${window.innerWidth}x${window.innerHeight}x${window.outerWidth}x${window.outerHeight}`,
      detail: viewport,
    }),
    makeSignal({ id: "orientation", value: orientText, status: orientText ? "ok" : "absent", hash: orient.type || "", detail: orientText }),
    extended,
    ...media,
  ];
}

function storageWritable() {
  // Capability check only. The key is removed before this function returns.
  // Fingerprint results are never written to localStorage.
  try {
    const key = "ip-lookup.storage-probe";
    localStorage.setItem(key, "1");
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function readCaps() {
  const checks = [
    ["serviceWorker", () => "serviceWorker" in navigator],
    ["indexedDB", () => "indexedDB" in window],
    ["caches", () => "caches" in window],
    ["localStorage", storageWritable],
    ["sharedArrayBuffer", () => typeof SharedArrayBuffer === "function"],
    ["webAssembly", () => typeof WebAssembly === "object" && WebAssembly != null],
    ["webgpu", () => "gpu" in navigator],
    ["webRTC", () => typeof RTCPeerConnection === "function"],
    ["offscreenCanvas", () => typeof OffscreenCanvas === "function"],
    ["worker", () => typeof Worker === "function"],
    ["webgl", () => typeof WebGLRenderingContext === "function"],
    ["speechSynthesis", () => "speechSynthesis" in window],
    ["bluetooth", () => "bluetooth" in navigator],
    ["usb", () => "usb" in navigator],
    ["serial", () => "serial" in navigator],
    ["nfc", () => "nfc" in navigator],
    ["credentials", () => "credentials" in navigator],
    ["paymentRequest", () => typeof PaymentRequest === "function"],
    ["notification", () => typeof Notification === "function"],
    ["mediaDevices", () => "mediaDevices" in navigator],
    ["battery", () => typeof navigator.getBattery === "function"],
  ];
  const bits = [];
  const lines = [];
  let present = 0;
  for (const [name, test] of checks) {
    let ok = false;
    try { ok = !!test(); } catch { ok = false; }
    bits.push(ok ? "1" : "0");
    lines.push(`${ok ? "有" : "无"} ${name}`);
    if (ok) present += 1;
  }
  return makeSignal({
    id: "caps",
    value: `${present} / ${checks.length} 项存在`,
    status: "ok",
    hash: bits.join(""),
    detail: lines.join("\n"),
  });
}

function readNetwork() {
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!conn) return makeSignal({ id: "network", value: "", status: "absent", hash: "absent" });
  const parts = [
    conn.effectiveType || "",
    conn.downlink != null ? `${conn.downlink} Mb/s` : "",
    conn.rtt != null ? `${conn.rtt} ms` : "",
    conn.saveData ? "省流" : "",
  ].filter(Boolean);
  const value = parts.join(" / ") || "接口在，但没有给出数字";
  return makeSignal({
    id: "network",
    value,
    status: "volatile",
    hash: `${conn.effectiveType || ""}:${conn.downlink ?? ""}:${conn.rtt ?? ""}`,
    detail: value,
  });
}

async function readStorage() {
  if (!navigator.storage?.estimate) {
    return makeSignal({ id: "storage", value: "", status: "absent", hash: "absent" });
  }
  try {
    const estimate = await navigator.storage.estimate();
    if (estimate?.quota == null) return makeSignal({ id: "storage", value: "", status: "absent", hash: "absent" });
    const usage = estimate.usage || 0;
    const value = `配额 ${formatBytes(estimate.quota)}，已用 ${formatBytes(usage)}`;
    return makeSignal({ id: "storage", value, status: "volatile", hash: `${estimate.quota}:${usage}`, detail: value });
  } catch {
    return makeSignal({ id: "storage", value: "浏览器拒绝了配额查询", status: "blocked", hash: "blocked" });
  }
}

async function readPermissions() {
  if (!navigator.permissions?.query) {
    return makeSignal({ id: "permissions", value: "", status: "absent", hash: "absent" });
  }
  const pairs = await Promise.all(PERMISSIONS.map(async (name) => {
    try {
      const status = await navigator.permissions.query({ name });
      return [name, status?.state || "unsupported"];
    } catch (error) {
      const message = String(error?.message || "");
      const blocked = /not allowed|permission policy|permissions-policy|is not a valid/i.test(message);
      return [name, blocked ? "policy-blocked" : "unsupported"];
    }
  }));
  const counts = new Map();
  for (const [, token] of pairs) counts.set(token, (counts.get(token) || 0) + 1);
  const value = [...counts.entries()].map(([token, count]) => `${PERMISSION_TEXT[token] || token} ×${count}`).join(" · ");
  return makeSignal({
    id: "permissions",
    value,
    status: "ok",
    hash: pairs.map(([name, token]) => `${name}=${token}`).join(";"),
    detail: pairs.map(([name, token]) => `${name}=${token}`).join("\n"),
  });
}

function readPlugins() {
  try {
    const names = [...(navigator.plugins || [])].map((plugin) => plugin?.name || "未命名").sort();
    const pdf = "pdfViewerEnabled" in navigator ? !!navigator.pdfViewerEnabled : null;
    const pdfText = pdf == null ? "PDF 开关未提供" : (pdf ? "内置 PDF 开着" : "内置 PDF 关着");
    return makeSignal({
      id: "plugins",
      value: `${pdfText}，插件 ${names.length} 个`,
      status: "ok",
      hash: `${pdf == null ? "" : pdf ? "1" : "0"}|${names.join(",")}`,
      detail: names.join("\n") || "插件列表是空的",
    });
  } catch {
    return makeSignal({ id: "plugins", value: "读不到插件列表", status: "blocked", hash: "blocked" });
  }
}

async function collectDevice() {
  const cores = navigator.hardwareConcurrency;
  const memory = navigator.deviceMemory;
  const touch = navigator.maxTouchPoints;
  const [storage, permissions] = await Promise.all([readStorage(), readPermissions()]);
  return [
    makeSignal({
      id: "cores",
      value: cores == null ? "" : String(cores),
      status: cores == null ? "absent" : "ok",
      hash: cores == null ? "" : String(cores),
      detail: cores == null ? "" : String(cores),
    }),
    makeSignal({
      id: "memory",
      value: memory == null ? "" : `${memory} GB`,
      status: memory == null ? "absent" : "ok",
      hash: memory == null ? "" : String(memory),
      detail: memory == null ? "" : String(memory),
    }),
    makeSignal({
      id: "touch",
      value: touch == null ? "" : String(touch),
      status: touch == null ? "absent" : "ok",
      hash: touch == null ? "" : String(touch),
      detail: touch == null ? "" : String(touch),
    }),
    readCaps(),
    makeSignal({
      id: "cookies",
      value: navigator.cookieEnabled == null ? "" : (navigator.cookieEnabled ? "开着" : "关着"),
      status: navigator.cookieEnabled == null ? "absent" : "ok",
      hash: navigator.cookieEnabled == null ? "" : (navigator.cookieEnabled ? "1" : "0"),
      detail: navigator.cookieEnabled == null ? "" : (navigator.cookieEnabled ? "1" : "0"),
    }),
    readNetwork(),
    storage,
    permissions,
    readPlugins(),
  ];
}

function readCanvas() {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 280;
    canvas.height = 72;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return makeSignal({ id: "canvas", value: "", status: "absent", hash: "absent" });
    ctx.fillStyle = "#141210";
    ctx.fillRect(0, 0, 280, 72);
    ctx.strokeStyle = "#6C4CF1";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(8, 58);
    ctx.quadraticCurveTo(70, 4, 140, 40);
    ctx.quadraticCurveTo(190, 68, 270, 12);
    ctx.stroke();
    ctx.fillStyle = "#CBF36B";
    ctx.font = "20px 'Times New Roman', serif";
    ctx.fillText("IPLK-探针-42", 16, 28);
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = "rgba(255,107,74,0.85)";
    ctx.beginPath();
    ctx.arc(210, 36, 22, 0, Math.PI * 1.5);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    const grad = ctx.createLinearGradient(0, 60, 280, 72);
    grad.addColorStop(0, "#3E7BFA");
    grad.addColorStop(1, "#FFC94D");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 60, 280, 12);
    const pixels = ctx.getImageData(0, 0, 280, 72).data;
    let sample = "";
    for (let i = 0; i < pixels.length; i += 97) sample += pixels[i].toString(16).padStart(2, "0");
    let url = "";
    try { url = canvas.toDataURL(); } catch { url = ""; }
    const hash = `${sample}|${url.length}|${url.slice(-16)}`;
    return makeSignal({
      id: "canvas",
      value: "已采样",
      status: "ok",
      hash,
      detail: `像素抽样 ${sample.length / 2} 字节，图片编码长度 ${url.length}`,
    });
  } catch {
    return makeSignal({ id: "canvas", value: "画布被拦住", status: "blocked", hash: "blocked" });
  }
}

function parameterText(gl, name) {
  const constant = gl[name];
  if (constant == null) return "";
  try {
    const value = gl.getParameter(constant);
    if (value == null) return `${name}=`;
    if (typeof value === "object" && typeof value.length === "number") return `${name}=${Array.prototype.join.call(value, ",")}`;
    return `${name}=${value}`;
  } catch {
    return `${name}=?`;
  }
}

function readWebGL() {
  const missing = {
    renderer: makeSignal({ id: "webgl-renderer", value: "", status: "absent", hash: "absent" }),
    params: makeSignal({ id: "webgl-params", value: "", status: "absent", hash: "absent" }),
    version: makeSignal({ id: "webgl2", value: "没有 WebGL", status: "absent", hash: "0" }),
  };
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 48;
    canvas.height = 48;
    const attrs = { preserveDrawingBuffer: true, antialias: true, depth: true, stencil: false };
    let gl = canvas.getContext("webgl2", attrs);
    let version = 2;
    if (!gl) {
      gl = canvas.getContext("webgl", attrs) || canvas.getContext("experimental-webgl", attrs);
      version = gl ? 1 : 0;
    }
    if (!gl) return missing;
    let vendor = "";
    let renderer = "";
    let masked = false;
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    if (debug) {
      vendor = String(gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) || "");
      renderer = String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) || "");
    }
    if (!renderer) {
      vendor = String(gl.getParameter(gl.VENDOR) || "");
      renderer = String(gl.getParameter(gl.RENDERER) || "");
      masked = true;
    }
    const names = [
      "MAX_TEXTURE_SIZE", "MAX_CUBE_MAP_TEXTURE_SIZE", "MAX_RENDERBUFFER_SIZE", "MAX_VIEWPORT_DIMS",
      "MAX_VERTEX_ATTRIBS", "MAX_VERTEX_UNIFORM_VECTORS", "MAX_VARYING_VECTORS", "MAX_FRAGMENT_UNIFORM_VECTORS",
      "MAX_TEXTURE_IMAGE_UNITS", "MAX_COMBINED_TEXTURE_IMAGE_UNITS", "ALIASED_LINE_WIDTH_RANGE",
      "ALIASED_POINT_SIZE_RANGE", "RED_BITS", "GREEN_BITS", "BLUE_BITS", "ALPHA_BITS", "DEPTH_BITS",
      "STENCIL_BITS", "SUBPIXEL_BITS", "VERSION", "SHADING_LANGUAGE_VERSION",
    ];
    const params = names.map((name) => parameterText(gl, name)).filter(Boolean);
    let pixel = "";
    try {
      gl.clearColor(0.15, 0.85, 0.35, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const bytes = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      pixel = `CLEAR=${bytes.join(",")}`;
      params.push(pixel);
    } catch {
      pixel = "";
    }
    const extensions = (gl.getSupportedExtensions() || []).slice().sort();
    try { gl.getExtension("WEBGL_lose_context")?.loseContext(); } catch { /* already gone */ }
    const shown = renderer ? (masked ? `${renderer}（掩码）` : `${vendor} / ${renderer}`) : "";
    return {
      renderer: makeSignal({
        id: "webgl-renderer",
        value: shown,
        status: shown ? "ok" : "absent",
        hash: `${vendor}\u241e${renderer}\u241e${version}`,
        detail: `vendor=${vendor}\nrenderer=${renderer}\nversion=${version}\nmasked=${masked}`,
      }),
      params: makeSignal({
        id: "webgl-params",
        value: `${params.length} 项参数，${extensions.length} 个扩展`,
        status: params.length ? "ok" : "absent",
        hash: `${params.join(";")}\u241e${extensions.join(",")}`,
        detail: `${params.join("\n")}\n\n扩展：${extensions.join(", ") || "无"}`,
      }),
      version: makeSignal({
        id: "webgl2",
        value: version === 2 ? "WebGL 2" : "只有 WebGL 1",
        status: "ok",
        hash: String(version),
        detail: String(version),
      }),
    };
  } catch {
    return {
      renderer: makeSignal({ id: "webgl-renderer", value: "读渲染器失败", status: "blocked", hash: "blocked" }),
      params: makeSignal({ id: "webgl-params", value: "读参数失败", status: "blocked", hash: "blocked" }),
      version: makeSignal({ id: "webgl2", value: "读版本失败", status: "blocked", hash: "blocked" }),
    };
  }
}

async function readAudio() {
  const Ctor = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Ctor) return makeSignal({ id: "audio", value: "", status: "absent", hash: "absent" });
  try {
    const ctx = new Ctor(1, 44100, 44100);
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = 7777;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -24;
    comp.knee.value = 12;
    comp.ratio.value = 8;
    comp.attack.value = 0.003;
    comp.release.value = 0.1;
    const gain = ctx.createGain();
    gain.gain.value = 0.35;
    osc.connect(comp);
    comp.connect(gain);
    gain.connect(ctx.destination);
    osc.start(0);
    const rendered = await ctx.startRendering();
    const data = rendered.getChannelData(0);
    const indexes = [1500, 4500, 9000, 13500, 18000, 22500, 27000, 31500, 36000, 40000, 43000];
    const sample = indexes.map((index) => {
      const value = data[index];
      return typeof value === "number" && !Number.isNaN(value) ? value.toFixed(6) : "nan";
    }).join(",");
    if (!sample || sample.includes("nan")) {
      return makeSignal({ id: "audio", value: "样本无效", status: "blocked", hash: "blocked" });
    }
    return makeSignal({ id: "audio", value: "已采样", status: "ok", hash: sample, detail: sample });
  } catch (error) {
    return makeSignal({ id: "audio", value: "采样失败", status: "blocked", hash: "blocked", detail: error?.name || "" });
  }
}

function readFonts() {
  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return makeSignal({ id: "fonts", value: "", status: "absent", hash: "absent" });
    const widthOf = (font) => {
      ctx.font = `48px ${font}`;
      return Math.round(ctx.measureText(FONT_TEXT).width * 100) / 100;
    };
    const bases = FONT_BASES.map((name) => widthOf(name));
    const hits = [];
    const misses = [];
    const parts = [];
    for (const name of FONT_CANDIDATES) {
      const width = widthOf(`"${name.replace(/"/g, "")}", monospace`);
      parts.push(`${name}=${width}`);
      if (width !== bases[0]) hits.push(name);
      else misses.push(name);
    }
    return makeSignal({
      id: "fonts",
      value: `${hits.length} / ${FONT_CANDIDATES.length} 款和回退字体宽度不同`,
      status: "ok",
      hash: `${bases.join(",")}|${parts.join(";")}`,
      detail: `命中：${hits.join(", ") || "无"}\n未命中：${misses.join(", ") || "无"}\n基准宽度：${bases.join(", ")}`,
    });
  } catch {
    return makeSignal({ id: "fonts", value: "量宽度失败", status: "blocked", hash: "blocked" });
  }
}

function readLayout() {
  if (!document.body) return makeSignal({ id: "layout", value: "", status: "blocked", hash: "blocked" });
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.lang = "zh-Hans";
  host.style.cssText = "position:absolute;left:-10000px;top:0;width:640px;visibility:hidden;font-size:16px;line-height:1.25;font-family:serif";
  for (const phrase of LAYOUT_PHRASES) {
    for (const style of LAYOUT_STYLES) {
      const span = document.createElement("span");
      span.style.cssText = `display:inline-block;${style}`;
      span.textContent = phrase;
      host.append(span);
    }
  }
  document.body.append(host);
  try {
    const parts = [];
    for (const child of host.children) {
      const rect = child.getBoundingClientRect();
      parts.push(`${Math.round(rect.width * 100) / 100},${Math.round(rect.height * 100) / 100}`);
    }
    const hash = parts.join(";");
    if (!hash) return makeSignal({ id: "layout", value: "", status: "blocked", hash: "blocked" });
    return makeSignal({
      id: "layout",
      value: `量了 ${host.children.length} 个盒子`,
      status: "ok",
      hash,
      detail: hash,
    });
  } catch {
    return makeSignal({ id: "layout", value: "量尺寸失败", status: "blocked", hash: "blocked" });
  } finally {
    host.remove();
  }
}

function readAntialias() {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 32;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return makeSignal({ id: "antialias", value: "", status: "absent", hash: "absent" });
    ctx.textBaseline = "top";
    ctx.fillStyle = "#141210";
    ctx.font = "15px Georgia, serif";
    ctx.fillText("Sphinx of black quartz.", 1, 4);
    const pixels = ctx.getImageData(0, 0, 200, 32).data;
    let even = 0;
    let odd = 0;
    for (let i = 3; i < pixels.length; i += 4) {
      const column = Math.floor(i / 4) % 200;
      if (column % 2 === 0) even += pixels[i];
      else odd += pixels[i];
    }
    const hash = `${even}/${odd}`;
    return makeSignal({ id: "antialias", value: `偶列 ${even} / 奇列 ${odd}`, status: "ok", hash, detail: hash });
  } catch {
    return makeSignal({ id: "antialias", value: "读像素失败", status: "blocked", hash: "blocked" });
  }
}

function readOffscreen() {
  if (typeof OffscreenCanvas !== "function") {
    return makeSignal({ id: "offscreen", value: "没有这个接口", status: "absent", hash: "absent" });
  }
  try {
    const canvas = new OffscreenCanvas(32, 16);
    const ctx = canvas.getContext("2d");
    if (!ctx) return makeSignal({ id: "offscreen", value: "不能创建 2D", status: "blocked", hash: "no-2d" });
    ctx.fillStyle = "#3E7BFA";
    ctx.fillRect(0, 0, 32, 16);
    ctx.fillStyle = "#141210";
    ctx.font = "12px sans-serif";
    ctx.fillText("ip", 4, 12);
    const data = ctx.getImageData(0, 0, 32, 16).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 16) sum = (sum + data[i]) % 65536;
    const mode = typeof canvas.convertToBlob === "function" ? "blob" : "pixels";
    return makeSignal({
      id: "offscreen",
      value: mode === "blob" ? "可以导出" : "只能读像素",
      status: "ok",
      hash: `${mode}:${sum}`,
      detail: `${mode}:${sum}`,
    });
  } catch (error) {
    return makeSignal({ id: "offscreen", value: "创建失败", status: "blocked", hash: "throw", detail: error?.name || "" });
  }
}

async function collectRender() {
  const canvas = readCanvas();
  const webgl = readWebGL();
  const fonts = readFonts();
  const layout = readLayout();
  const antialias = readAntialias();
  const offscreen = readOffscreen();
  const audio = await readAudio();
  return [canvas, webgl.renderer, webgl.params, webgl.version, audio, fonts, layout, antialias, offscreen];
}

async function loadConnection() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch("/api/whoami", {
      cache: "no-store",
      credentials: "omit",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function paintIp(connection) {
  const node = $("#barMeIp");
  if (node) node.textContent = connection?.ip || "未读到";
}

function setStatus(message, kind) {
  const host = $("#fpStatus");
  const text = $("#fpStatusText");
  if (text) text.textContent = message;
  if (!host) return;
  host.classList.toggle("busy", kind === "busy");
  host.classList.toggle("err", kind === "err");
  const dot = host.querySelector(".dot");
  if (dot) {
    dot.className = `dot ${kind === "err" ? "dot-coral" : kind === "busy" ? "dot-violet" : "dot-lime"}`;
  }
}

function toast(message) {
  const node = $("#toast");
  if (!node) return;
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("show"), 1600);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.append(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    area.remove();
    return ok;
  }
}

function setRunning(running) {
  state.running = running;
  for (const id of ["fpRun", "fpStickyRun"]) {
    const button = document.getElementById(id);
    if (!button) continue;
    button.disabled = running;
    button.textContent = running ? "采样中…" : "再测一次";
  }
}

function clockStamp(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function renderIdentity() {
  const idNode = $("#fpId");
  const full = $("#fpIdFull");
  const more = $("#fpIdMore");
  const algo = $("#fpAlgo");
  const stickyId = $("#fpStickyId");
  if (!state.id) {
    if (idNode) idNode.textContent = "没能算出 SHA-256";
    if (full) full.hidden = true;
    if (more) more.hidden = true;
    return;
  }
  if (idNode) idNode.textContent = formatDigest(state.id, 24);
  if (full) {
    full.textContent = formatDigest(state.id);
    full.hidden = !state.revealed;
  }
  if (more) {
    more.hidden = false;
    more.textContent = state.revealed ? "收起完整哈希" : "看完整哈希";
    more.setAttribute("aria-expanded", state.revealed ? "true" : "false");
  }
  if (algo) algo.textContent = `${state.algo} · 前 24 位`;
  if (stickyId) stickyId.textContent = formatDigest(state.id, 24);
  $("#fpCopy").disabled = false;
  $("#fpExport").disabled = false;
}

function renderVerdict(summary) {
  const band = summary.uniqueness;
  $("#fpBand").textContent = band.title;
  $("#fpBandDetail").textContent = band.detail;
  $("#fpOdds").textContent = band.collision;
  $("#fpStickyBand").textContent = band.title;
  const counts = summary.counts;
  $("#fpSummary").textContent = `已取得 ${counts.ok || 0}，未提供 ${counts.absent || 0}，被拦住 ${counts.blocked || 0}，易变 ${counts.volatile || 0}。估算信息量 ${summary.bits} bit。易变项只按一半计入估算，并且不进入指纹 ID。`;
}

function renderPortrait(paragraphs) {
  const host = $("#fpPortrait");
  const text = $("#fpPortraitText");
  text.replaceChildren();
  paragraphs.forEach((paragraph, index) => {
    const p = document.createElement("p");
    p.textContent = paragraph;
    if (index > 0) p.className = "fp-rest";
    text.append(p);
  });
  host.hidden = false;
  host.classList.remove("is-open");
  const more = $("#fpPortraitMore");
  more.hidden = paragraphs.length < 2;
  more.setAttribute("aria-expanded", "false");
  more.textContent = L("展开全文", "Show all");
}

function renderStats(summary) {
  const host = $("#fpStats");
  host.replaceChildren();
  const items = [
    [summary.total, L("项信号", "signals")],
    [summary.counts.ok || 0, L("已取得", "read")],
    [summary.counts.absent || 0, L("未提供", "not provided")],
    [summary.counts.blocked || 0, L("被拦住", "blocked")],
    [summary.counts.volatile || 0, L("易变", "volatile")],
    [summary.bits, L("估算 bit", "estimated bits")],
  ];
  for (const [value, label] of items) {
    const card = document.createElement("div");
    card.className = "stat";
    const strong = document.createElement("b");
    strong.className = "mono";
    strong.textContent = String(value);
    const span = document.createElement("span");
    span.textContent = label;
    card.append(strong, span);
    host.append(card);
  }
}

function signalVisible(row) {
  if (state.group !== "all" && row.group !== state.group) return false;
  if (state.changedOnly && !state.changes.some((change) => change.id === row.id)) return false;
  const query = state.query.trim().toLowerCase();
  if (!query) return true;
  const blob = `${signalName(row)} ${row.name} ${showValue(row.value)} ${row.value} ${row.detail} ${signalNote(row)} ${row.note} ${groupName(row.group)} ${statusLabel(row.status)}`.toLowerCase();
  return blob.includes(query);
}

function renderTabs() {
  const host = $("#fpTabs");
  host.replaceChildren();
  const items = [{ id: "all", name: "全部" }, ...GROUPS];
  for (const item of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `fp-tab${state.group === item.id ? " is-on" : ""}`;
    button.setAttribute("aria-pressed", state.group === item.id ? "true" : "false");
    const count = item.id === "all"
      ? state.signals.length
      : state.signals.filter((row) => row.group === item.id).length;
    const label = item.id === "all" ? L("全部", "All") : (getLang() === "en" ? (GROUP_EN[item.id]?.name || item.name) : item.name);
    button.textContent = `${label} ${count}`;
    button.addEventListener("click", () => {
      state.group = item.id;
      renderTabs();
      renderList();
    });
    host.append(button);
  }
}

function renderList() {
  const host = $("#fpList");
  host.replaceChildren();
  const changes = new Map(state.changes.map((change) => [change.id, change]));
  let shown = 0;
  for (const group of GROUPS) {
    const rows = state.signals.filter((row) => row.group === group.id && signalVisible(row));
    if (!rows.length) continue;
    shown += rows.length;
    const section = document.createElement("section");
    section.className = "fp-group";
    const open = !state.closedGroups.has(group.id);
    const head = document.createElement("button");
    head.type = "button";
    head.className = "fp-group-h";
    head.setAttribute("aria-expanded", open ? "true" : "false");
    const title = document.createElement("span");
    const groupEn = GROUP_EN[group.id];
    title.textContent = getLang() === "en" && groupEn ? groupEn.name : group.name;
    const blurb = document.createElement("small");
    blurb.textContent = getLang() === "en" && groupEn ? groupEn.blurb : group.blurb;
    const count = document.createElement("b");
    count.className = "mono";
    count.textContent = String(rows.length);
    head.append(title, blurb, count);
    head.addEventListener("click", () => {
      if (state.closedGroups.has(group.id)) state.closedGroups.delete(group.id);
      else state.closedGroups.add(group.id);
      renderList();
      syncTools();
    });
    section.append(head);
    if (open) {
      const body = document.createElement("div");
      body.className = "fp-rows";
      for (const row of rows) body.append(renderRow(row, changes.get(row.id)));
      section.append(body);
    }
    host.append(section);
  }
  if (!shown) {
    const empty = document.createElement("p");
    empty.className = "fp-empty";
    empty.textContent = state.changedOnly
      ? L("这一轮没有和上一轮不同的项。", "Nothing changed from the previous run.")
      : L("没有符合筛选的信号。", "No signals match the filter.");
    host.append(empty);
  }
  const filtering = state.group !== "all" || state.query.trim() || state.changedOnly;
  $("#fpCount").hidden = !filtering;
  $("#fpCountN").textContent = `${shown} / ${state.signals.length}`;
}

function renderRow(row, change) {
  const article = document.createElement("article");
  article.className = `fp-row${change ? " is-changed" : ""}`;
  article.dataset.status = row.status;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "fp-row-btn";
  const open = state.detailsOpen;
  button.setAttribute("aria-expanded", open ? "true" : "false");
  const dot = document.createElement("i");
  dot.className = `fp-dot fp-dot-${row.status}`;
  dot.setAttribute("aria-hidden", "true");
  const sr = document.createElement("span");
  sr.className = "fp-sr";
  sr.textContent = statusLabel(row.status);
  const name = document.createElement("span");
  name.className = "fp-name";
  name.textContent = signalName(row);
  const value = document.createElement("span");
  value.className = "fp-val mono";
  value.textContent = clip(showValue(row.value) || "—");
  const meter = document.createElement("span");
  meter.className = "fp-meter";
  meter.title = row.status === "volatile"
    ? L("易变，不进入指纹 ID", "Volatile, not part of the fingerprint ID")
    : L(`估算权重 ${row.bits} bit`, `Estimated weight ${row.bits} bit`);
  if (row.bits > 0) {
    const bar = document.createElement("i");
    bar.style.width = `${Math.max(8, Math.round((row.bits / 8) * 100))}%`;
    meter.append(bar);
  } else {
    meter.textContent = "0";
  }
  button.append(dot, sr, name, value, meter);
  const panel = document.createElement("div");
  panel.className = "fp-panel";
  panel.hidden = !open;
  const note = document.createElement("p");
  note.className = "fp-note";
  note.textContent = signalNote(row);
  panel.append(note);
  if (row.value) {
    const full = document.createElement("p");
    full.className = "fp-full mono";
    full.textContent = showValue(row.value);
    panel.append(full);
  }
  if (row.detail && row.detail !== row.value) {
    const raw = document.createElement("pre");
    raw.className = "fp-raw";
    raw.textContent = row.detail;
    panel.append(raw);
  }
  button.addEventListener("click", () => {
    const next = panel.hidden;
    panel.hidden = !next;
    button.setAttribute("aria-expanded", next ? "true" : "false");
  });
  article.append(button);
  if (change) {
    const delta = document.createElement("p");
    delta.className = "fp-delta";
    const before = change.before ? clip(change.before, 180) : "（空）";
    delta.textContent = `和上一轮不同 · 上次：${before}`;
    article.append(delta);
  }
  article.append(panel);
  return article;
}

function renderDiff() {
  const host = $("#fpDiff");
  const text = $("#fpDiffText");
  if (!state.previous) {
    host.hidden = true;
    return;
  }
  host.hidden = false;
  if (!state.changes.length) {
    text.textContent = "和上一轮相比，每一项都一样。";
    return;
  }
  const volatile = [];
  const stable = [];
  for (const change of state.changes) {
    const row = state.signals.find((item) => item.id === change.id)
      || state.previous.find((item) => item.id === change.id);
    if (row?.status === "volatile" || change.status === "volatile" || change.beforeStatus === "volatile") volatile.push(change);
    else stable.push(change);
  }
  const sameId = state.previousId && state.previousId === state.id;
  const names = stable.map((change) => change.name).slice(0, 6).join("、");
  if (sameId && !stable.length) {
    text.textContent = `指纹 ID 没变。有 ${volatile.length} 项易变读数变了，它们本来就不进入 ID。`;
    return;
  }
  if (sameId) {
    text.textContent = `指纹 ID 没变。有 ${stable.length} 项显示变了，但参与 ID 的样本没变${names ? `：${names}` : ""}。`;
    return;
  }
  text.textContent = `指纹 ID 变了。${stable.length ? `稳定项里不同的有：${names || "若干项"}。` : "变的是易变项，按理会保持 ID 不变；如果 ID 仍变了，看下面标红的行。"}${volatile.length ? ` 另有 ${volatile.length} 项易变读数不同。` : ""}`;
}

function syncTools() {
  const changed = $("#fpChanged");
  changed.disabled = !state.previous;
  changed.setAttribute("aria-pressed", state.changedOnly ? "true" : "false");
  changed.textContent = state.changedOnly ? L("显示全部", "Show all") : L("只看变化", "Changes only");
  $("#fpExpand").textContent = state.detailsOpen ? L("收起全部详情", "Hide details") : L("展开全部详情", "Show all details");
  $("#fpGroups").textContent = state.closedGroups.size ? L("展开全部分组", "Expand groups") : L("收起全部分组", "Collapse groups");
  $("#fpSearchClear").hidden = !state.query;
}

function renderPage(summary, paragraphs) {
  renderIdentity();
  $("#fpExport").disabled = state.signals.length === 0;
  renderVerdict(summary);
  renderPortrait(paragraphs);
  renderStats(summary);
  renderTabs();
  renderDiff();
  renderList();
  syncTools();
  $("#fpTs").textContent = `采样于 ${clockStamp(new Date())}`;
}

async function run() {
  if (state.running) return;
  const prior = state.signals.length ? state.signals : null;
  const priorId = state.id;
  setRunning(true);
  setStatus("正在这台设备上采样。除了首页也在用的 /api/whoami，不会把这些读数发出去。", "busy");
  latestBrands = [];
  try {
    const connectionTask = loadConnection().then((connection) => {
      paintIp(connection);
      return connection;
    });
    const [identity, locale, screen, device, render, connection] = await Promise.all([
      safe("identity", async () => {
        const collected = await collectIdentity();
        latestBrands = collected.brands;
        return collected.signals;
      }),
      safe("locale", collectLocale),
      safe("screen", collectScreen),
      safe("device", collectDevice),
      safe("render", collectRender),
      connectionTask,
    ]);
    const languages = navigator.languages?.length ? [...navigator.languages] : (navigator.language ? [navigator.language] : []);
    let network;
    try {
      network = networkSignals({ connection, brands: latestBrands, languages });
    } catch (error) {
      network = idsIn("network").map((id) => makeSignal({
        id,
        status: "blocked",
        value: "采样失败",
        hash: "blocked",
        detail: error?.name || "error",
      }));
    }
    const signals = orderSignals([...identity, ...locale, ...screen, ...device, ...render, ...network]);
    const body = canonical(signals);
    let digest = "";
    try {
      digest = await sha256Hex(body);
      state.algo = "SHA-256";
    } catch {
      digest = "";
      state.algo = "SHA-256 不可用";
    }
    state.previous = prior;
    state.previousId = priorId;
    state.signals = signals;
    state.connection = connection;
    state.id = digest;
    state.changes = prior ? diffSignals(prior, signals) : [];
    if (!prior) state.changedOnly = false;
    const summary = summarize(signals, getLang());
    const paragraphs = buildPortrait(signals, connection, { id: digest, lang: getLang(), now: new Date() });
    renderPage(summary, paragraphs);
    const missing = missingSignalIds(signals);
    const tail = missing.length ? ` 有 ${missing.length} 项没有返回。` : "";
    setStatus(`采样完成，共 ${signals.length} 项。指纹 ID 是 SHA-256，易变项没有算进去。${tail}`, missing.length ? "err" : "");
  } catch {
    setStatus("采样中断了。可以再测一次。", "err");
  } finally {
    setRunning(false);
  }
}

function exportJson() {
  const summary = summarize(state.signals);
  const payload = {
    disclaimer: "本地采样，未上传。独特性数字是估算，不是访客统计。易变项没有进入 id。",
    algorithm: state.algo,
    id: state.id,
    bits: summary.bits,
    sampledAt: new Date().toISOString(),
    signals: state.signals.map((row) => ({
      id: row.id,
      group: row.group,
      name: row.name,
      status: row.status,
      value: row.value,
      detail: row.detail,
      bits: row.bits,
      inFingerprint: row.status !== "volatile",
    })),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "browser-signals.json";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function bind() {
  $("#fpRun").addEventListener("click", () => { void run(); });
  $("#fpStickyRun").addEventListener("click", () => { void run(); });
  $("#fpCopy").addEventListener("click", async () => {
    if (!state.id) return;
    toast(await copyText(state.id) ? "已复制完整指纹 ID" : "复制失败");
  });
  $("#fpExport").addEventListener("click", () => {
    if (!state.signals.length) return;
    exportJson();
    toast("已导出 JSON");
  });
  $("#fpIdMore").addEventListener("click", () => {
    state.revealed = !state.revealed;
    renderIdentity();
  });
  $("#fpShare").addEventListener("click", async () => {
    const text = [...$("#fpPortraitText").querySelectorAll("p")].map((node) => node.textContent).join("\n");
    toast(await copyText(text) ? "已复制这段说明" : "复制失败");
  });
  $("#fpPortraitMore").addEventListener("click", () => {
    const host = $("#fpPortrait");
    const open = host.classList.toggle("is-open");
    $("#fpPortraitMore").setAttribute("aria-expanded", open ? "true" : "false");
    $("#fpPortraitMore").textContent = open ? "收起" : "展开全文";
  });
  $("#fpSearch").addEventListener("input", (event) => {
    state.query = event.target.value || "";
    renderList();
    syncTools();
  });
  $("#fpSearchClear").addEventListener("click", () => {
    state.query = "";
    $("#fpSearch").value = "";
    renderList();
    syncTools();
    $("#fpSearch").focus();
  });
  $("#fpChanged").addEventListener("click", () => {
    if (!state.previous) return;
    state.changedOnly = !state.changedOnly;
    renderList();
    syncTools();
  });
  $("#fpExpand").addEventListener("click", () => {
    state.detailsOpen = !state.detailsOpen;
    renderList();
    syncTools();
  });
  $("#fpGroups").addEventListener("click", () => {
    state.closedGroups = state.closedGroups.size
      ? new Set()
      : new Set(GROUPS.map((group) => group.id));
    renderList();
    syncTools();
  });
  $("#barMe").addEventListener("click", async () => {
    const ip = $("#barMeIp").textContent.trim();
    if (!ip || ip === "读取中…" || ip === "未读到") return;
    toast(await copyText(ip) ? "已复制 IP" : "复制失败");
  });
  const hero = $("#fpHero");
  const sticky = $("#fpSticky");
  if ("IntersectionObserver" in window && hero && sticky) {
    const observer = new IntersectionObserver(([entry]) => {
      const passed = !entry.isIntersecting && entry.boundingClientRect.top < 0;
      sticky.hidden = !(passed && state.id);
    }, { threshold: 0 });
    observer.observe(hero);
  }
}

bind();
applyDom(document);
bindLangToggle();
onLang(() => {
  if (!state.signals.length) return;
  const summary = summarize(state.signals, getLang());
  const paragraphs = buildPortrait(state.signals, state.connection, { id: state.id, lang: getLang() });
  renderPage(summary, paragraphs);
});
void run();
