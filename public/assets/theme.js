/* Day/night theme. Auto follows prefers-color-scheme; Light and Dark stick. */
(function () {
  "use strict";

  var KEY = "ip-ui-theme";
  var MQ = "(prefers-color-scheme: dark)";
  var COLORS = { light: "#F5EFE1", dark: "#12110e" };
  var COPY = {
    zh: { group: "主题", auto: "自动", light: "浅色", dark: "深色" },
    en: { group: "Theme", auto: "Auto", light: "Light", dark: "Dark" }
  };

  var mode = readMode();
  var mq = null;

  function readMode() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw === "light" || raw === "dark" || raw === "auto") return raw;
    } catch (e) { /* private mode */ }
    return "auto";
  }

  function systemDark() {
    try {
      return !!(window.matchMedia && window.matchMedia(MQ).matches);
    } catch (e) {
      return false;
    }
  }

  function resolve(next) {
    if (next === "dark" || next === "light") return next;
    return systemDark() ? "dark" : "light";
  }

  function pack() {
    var lang = (document.documentElement.lang || "zh").toLowerCase();
    return lang.indexOf("en") === 0 ? COPY.en : COPY.zh;
  }

  function paintLabels() {
    var group = document.getElementById("themeSwitch");
    if (!group) return;
    var text = pack();
    group.setAttribute("aria-label", text.group);
    var keys = ["auto", "light", "dark"];
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var btn = group.querySelector('[data-theme-choice="' + key + '"]');
      if (!btn) continue;
      var full = btn.querySelector(".theme-full");
      if (full) full.textContent = text[key];
      btn.setAttribute("aria-pressed", key === mode ? "true" : "false");
    }
  }

  function apply(next) {
    mode = next === "light" || next === "dark" ? next : "auto";
    var theme = resolve(mode);
    var root = document.documentElement;
    root.setAttribute("data-theme", theme);
    root.setAttribute("data-theme-mode", mode);
    var themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.setAttribute("content", COLORS[theme]);
    var scheme = document.querySelector('meta[name="color-scheme"]');
    if (scheme) scheme.setAttribute("content", theme);
    paintLabels();
    try {
      document.dispatchEvent(new CustomEvent("ip-theme", { detail: { mode: mode, theme: theme } }));
    } catch (e) { /* very old browsers */ }
  }

  function persist(next) {
    mode = next;
    try { localStorage.setItem(KEY, mode); } catch (e) { /* private mode */ }
    apply(mode);
  }

  try { mq = window.matchMedia(MQ); } catch (e) { mq = null; }
  if (mq) {
    var onMq = function () { if (mode === "auto") apply("auto"); };
    if (mq.addEventListener) mq.addEventListener("change", onMq);
    else if (mq.addListener) mq.addListener(onMq);
  }

  window.addEventListener("storage", function (e) {
    if (!e || e.key !== KEY) return;
    apply(readMode());
  });

  document.addEventListener("click", function (e) {
    var node = e.target;
    while (node && node !== document) {
      if (node.getAttribute && node.getAttribute("data-theme-choice")) {
        var choice = node.getAttribute("data-theme-choice");
        if (choice === "auto" || choice === "light" || choice === "dark") persist(choice);
        return;
      }
      node = node.parentNode;
    }
  });

  if (window.MutationObserver) {
    new MutationObserver(function () { paintLabels(); }).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["lang"]
    });
  }

  apply(mode);
})();
