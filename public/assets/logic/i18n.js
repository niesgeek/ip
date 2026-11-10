import { PHRASES } from "./phrases.js";

const LANG_KEY = "ip-ui-lang";
const textOriginal = new WeakMap();
const listeners = new Set();

function readLang() {
  try {
    const raw = localStorage.getItem(LANG_KEY);
    if (raw === "en" || raw === "zh") return raw;
  } catch { /* private mode */ }
  if (typeof document !== "undefined" && String(document.documentElement.lang || "").toLowerCase().startsWith("en")) {
    return "en";
  }
  return "zh";
}

let lang = readLang();

export function getLang() {
  return lang;
}

function rememberAttr(node, attr, store) {
  if (!node.hasAttribute(store)) node.setAttribute(store, node.getAttribute(attr) || "");
}

function applyAttr(node, attr, enName, zhName) {
  const en = node.getAttribute(enName);
  if (en == null) return;
  rememberAttr(node, attr, zhName);
  node.setAttribute(attr, lang === "en" ? en : node.getAttribute(zhName));
}

export function applyDom(root = document) {
  document.documentElement.lang = lang === "en" ? "en" : "zh-CN";
  root.querySelectorAll("[data-en]").forEach((node) => {
    if (!node.hasAttribute("data-zh")) node.setAttribute("data-zh", node.textContent);
    node.textContent = lang === "en" ? node.getAttribute("data-en") : node.getAttribute("data-zh");
  });
  root.querySelectorAll("[data-en-html]").forEach((node) => {
    if (!node.hasAttribute("data-zh-html")) node.setAttribute("data-zh-html", node.innerHTML);
    node.innerHTML = lang === "en" ? node.getAttribute("data-en-html") : node.getAttribute("data-zh-html");
  });
  root.querySelectorAll("[data-en-placeholder]").forEach((node) => {
    applyAttr(node, "placeholder", "data-en-placeholder", "data-zh-placeholder");
  });
  root.querySelectorAll("[data-en-aria]").forEach((node) => {
    applyAttr(node, "aria-label", "data-en-aria", "data-zh-aria");
  });
  root.querySelectorAll("[data-en-title]").forEach((node) => {
    applyAttr(node, "title", "data-en-title", "data-zh-title");
  });
  const pageTitle = document.querySelector("title[data-en]");
  if (pageTitle) document.title = pageTitle.textContent;
  const desc = document.querySelector('meta[name="description"][data-en]');
  if (desc) {
    if (!desc.getAttribute("data-zh")) desc.setAttribute("data-zh", desc.getAttribute("content") || "");
    desc.setAttribute("content", lang === "en" ? desc.getAttribute("data-en") : desc.getAttribute("data-zh"));
  }
  translateText(root);
  document.documentElement.classList.remove("i18n-wait");
}

function translateText(root) {
  const scope = root.body || root;
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const parent = node.parentElement;
    if (!parent || parent.closest("[data-en], [data-en-html], script, style, .theme-switch, .pg, #stackReady, #stackIdle, #stackMiss, #stackAgain, #mySum, #myipSrc, #barMe, #leakGo, #leakVerdict, #leakList, #siteGo, #siteList, #status")) continue;
    if (!textOriginal.has(node)) textOriginal.set(node, node.nodeValue);
    const raw = textOriginal.get(node);
    if (lang !== "en") {
      node.nodeValue = raw;
      continue;
    }
    const trimmed = raw.trim();
    const next = PHRASES[trimmed];
    if (!next) continue;
    node.nodeValue = raw.replace(trimmed, next);
  }
}

export function setLang(next) {
  lang = next === "en" ? "en" : "zh";
  try { localStorage.setItem(LANG_KEY, lang); } catch { /* private mode */ }
  document.documentElement.lang = lang === "en" ? "en" : "zh-CN";
  listeners.forEach((fn) => {
    try { fn(lang); } catch { /* a view can fail without blocking the switch */ }
  });
  applyDom(document);
}

export function onLang(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function bindLangToggle(button = document.getElementById("langToggle")) {
  if (!button || button.dataset.bound === "1") return;
  button.dataset.bound = "1";
  button.addEventListener("click", () => setLang(lang === "en" ? "zh" : "en"));
}

/** zh/en pair used by scripts that build text after the HTML is painted. */
export function L(zh, en) {
  return lang === "en" ? en : zh;
}
