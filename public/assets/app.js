import { continentLabel, countryLabel } from "./logic/countries.js";
import { addressesOf, lookupDns, lookupPtr, summarizeMail } from "./logic/dns.js";
import { GEO_WORLD } from "./geo-world.js";
import { edgeUsable, lookupGeo, recordFromEdge, sourceLabel } from "./logic/geo.js";
import {
  assessRisk,
  containingNetwork,
  expandIPv6,
  ipv4ToInt,
  isNonPublic,
  parseCidr,
  parseTarget,
  ptrName,
  splitTargets,
} from "./logic/net.js";
import {
  GLOBALPING_ENDPOINT,
  globalpingBody,
  packProtocol,
  probesFromGlobalping,
  summarizeReach,
  validateTarget,
} from "./logic/reach.js";

document.documentElement.classList.add("js");

const $ = (sel) => document.querySelector(sel);
const HISTORY_KEY = "ip-lookup.history.v1";
const BAND_COLOR = ["var(--lime)", "var(--sky)", "var(--amber)", "var(--coral)"];
const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

const state = {
  me: null,
  cur: null,
  token: 0,
  autoDone: false,
  stats: { q: 0, ips: 0, v6: 0, ms: [] },
  sources: {},
  batch: [],
};

function esc(value) {
  return String(value ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
}

let toastTimer = 0;
function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1700);
}

async function copyText(text, ok = "已复制") {
  try {
    await navigator.clipboard.writeText(text);
    toast(ok);
  } catch {
    toast("复制失败");
  }
}

function setStatus(message, kind) {
  const el = $("#status");
  el.className = `status${kind ? ` ${kind}` : ""}`;
  const dot = kind === "err" ? "dot-coral" : kind === "busy" ? "dot-violet" : "dot-lime";
  el.innerHTML = `<span class="dot ${dot}"></span>${esc(message)}`;
}

function show(el, on) {
  if (el) el.hidden = !on;
}

function flagHtml(code, w, h, inline) {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return '<span class="flag-none">地区未知</span>';
  const cc = code.toLowerCase();
  return `<img class="flag${inline ? " flag-in" : ""}" width="${w}" height="${h}" alt="" src="https://cdn.jsdelivr.net/npm/flag-icons@7/flags/4x3/${cc}.svg" referrerpolicy="no-referrer" onerror="this.className='flag brk'"><span class="flag-fb">${esc(code.toUpperCase())}</span>`;
}

function placeName(record) {
  if (!record) return "";
  return [countryLabel(record.country_code, record.country), record.region, record.city].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(" · ");
}

function orgText(record) {
  return [record?.org, record?.isp].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(" · ");
}

function viewOf(record, source, skipped = []) {
  const skip = skipped.length ? `（已跳过 ${skipped.map((item) => sourceLabel(item.id)).join("、")}）` : "";
  return {
    ...record,
    lat: record.latitude,
    lon: record.longitude,
    cc: record.country_code,
    countryName: record.local ? "私网或本机地址" : countryLabel(record.country_code, record.country),
    continentName: continentLabel(record.continent),
    sourceId: source,
    sourceText: `${sourceLabel(source)}${skip}`,
    edge: source === "edge",
  };
}

function bandIndex(tier) {
  return { home: 0, transit: 1, cloud: 2, proxy: 3 }[tier] ?? 0;
}

function zoneOffsetSeconds(timeZone) {
  if (!timeZone) return null;
  try {
    const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" })
      .formatToParts(new Date())
      .find((part) => part.type === "timeZoneName")?.value || "";
    if (name === "GMT") return 0;
    const match = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/i);
    if (!match) return null;
    const sign = match[1] === "-" ? -1 : 1;
    return sign * (Number(match[2]) * 3600 + Number(match[3] || 0) * 60);
  } catch {
    return null;
  }
}

function clockFromOffset(offset) {
  if (offset == null) return "--:--:--";
  const date = new Date(Date.now() + offset * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

function haversine(a, b) {
  if (a?.lat == null || b?.lat == null) return null;
  const rad = (n) => (n * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h))));
}

/* ---------- 点阵地图 ---------- */
const MapView = (() => {
  const cv = $("#map");
  const GEO = GEO_WORLD;
  let ctx = null;
  let dpr = 1;
  let box = { x: 0, y: 0, w: 0, h: 0 };
  let base = null;
  let raf = 0;
  let last = 0;
  let me = null;
  let tgt = null;
  let hover = null;
  let pulse = 0;
  let latMin = 0;
  let latMax = 0;
  const stretch = 1.34;

  function project(lon, lat) {
    return {
      x: box.x + ((lon + 180) / 360) * box.w,
      y: box.y + ((latMax - lat) / (latMax - latMin)) * box.h,
    };
  }
  function unproject(x, y) {
    return {
      lon: ((x - box.x) / box.w) * 360 - 180,
      lat: latMax - ((y - box.y) / box.h) * (latMax - latMin),
    };
  }
  function buildBase() {
    latMin = GEO.latMin;
    latMax = GEO.latMin + GEO.rows * GEO.dLat;
    const cssW = cv.clientWidth || 900;
    const ratio = (GEO.cols * GEO.dLon) / (GEO.rows * GEO.dLat);
    const cssH = (cssW / ratio) * stretch;
    dpr = Math.min(2.5, window.devicePixelRatio || 1);
    cv.width = Math.round(cssW * dpr);
    cv.height = Math.round(cssH * dpr);
    cv.style.height = `${Math.round(cssH)}px`;
    ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pad = Math.max(4, cssW * 0.014);
    box = { x: pad, y: pad, w: cssW - pad * 2, h: cssH - pad * 2 };
    base = document.createElement("canvas");
    base.width = cv.width;
    base.height = cv.height;
    const g = base.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = "#FFFDF6";
    g.fillRect(0, 0, cssW, cssH);
    g.strokeStyle = "rgba(20,18,16,.10)";
    g.lineWidth = 1;
    g.setLineDash([3, 5]);
    for (let lon = -150; lon <= 150; lon += 30) {
      const p = project(lon, 0);
      g.beginPath();
      g.moveTo(p.x, box.y);
      g.lineTo(p.x, box.y + box.h);
      g.stroke();
    }
    for (let lat = -40; lat <= 80; lat += 20) {
      const p = project(0, lat);
      g.beginPath();
      g.moveTo(box.x, p.y);
      g.lineTo(box.x + box.w, p.y);
      g.stroke();
    }
    g.setLineDash([]);
    const cw = box.w / GEO.cols;
    const ch = box.h / GEO.rows;
    const rad = Math.max(0.9, Math.min(cw, ch) * 0.34);
    for (let r = 0; r < GEO.rows; r += 1) {
      const row = GEO.mask[r];
      const y = box.y + (GEO.rows - 1 - r + 0.5) * ch;
      for (let c = 0; c < GEO.cols; c += 1) {
        const x = box.x + (c + 0.5) * cw;
        if (row.charCodeAt(c) === 49) {
          g.fillStyle = "rgba(20,18,16,.86)";
          g.beginPath();
          g.arc(x, y, rad, 0, Math.PI * 2);
          g.fill();
        } else {
          g.fillStyle = "rgba(20,18,16,.075)";
          g.fillRect(x - 0.6, y - 0.6, 1.2, 1.2);
        }
      }
    }
  }
  function marker(loc, color, rad, ring) {
    const p = project(loc.lon, loc.lat);
    ctx.strokeStyle = "rgba(20,18,16,.55)";
    ctx.lineWidth = 1.2;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(p.x, box.y);
    ctx.lineTo(p.x, box.y + box.h);
    ctx.stroke();
    ctx.setLineDash([]);
    if (ring) {
      const t = (pulse % 100) / 100;
      ctx.strokeStyle = `rgba(255,107,74,${(0.75 - t * 0.6).toFixed(3)})`;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, rad + 4 + t * 16, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = color;
    ctx.strokeStyle = "#141210";
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    return p;
  }
  function draw() {
    if (!ctx || !base) return;
    const cssW = cv.width / dpr;
    const cssH = cv.height / dpr;
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.drawImage(base, 0, 0, cssW, cssH);
    if (hover) {
      ctx.strokeStyle = "rgba(108,76,241,.55)";
      ctx.lineWidth = 1.4;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(box.x, hover.y);
      ctx.lineTo(box.x + box.w, hover.y);
      ctx.moveTo(hover.x, box.y);
      ctx.lineTo(hover.x, box.y + box.h);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const same = me && tgt && Math.abs(me.lat - tgt.lat) < 0.02 && Math.abs(me.lon - tgt.lon) < 0.02;
    if (me && !same) marker(me, "#3E7BFA", 5.5, false);
    if (tgt) {
      const p = marker(tgt, "#FF6B4A", 7, true);
      const tag = $("#mapTag");
      tag.textContent = `${tgt.label || ""}  ${tgt.lat.toFixed(2)}, ${tgt.lon.toFixed(2)}`.trim();
      tag.style.left = `${Math.max(52, Math.min((cv.clientWidth || 1) - 52, p.x))}px`;
      tag.style.top = `${Math.max(24, p.y)}px`;
      tag.hidden = false;
    } else {
      $("#mapTag").hidden = true;
    }
  }
  function loop(ts) {
    raf = requestAnimationFrame(loop);
    if (ts - last < 55) return;
    last = ts;
    pulse += 4;
    draw();
    if (!tgt && !me) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }
  function kick() {
    if (!raf) raf = requestAnimationFrame(loop);
  }
  function setMarker(which, record) {
    const loc = record && record.lat != null && record.lon != null
      ? { lat: record.lat, lon: record.lon, label: record.city || record.countryName || record.ip || "" }
      : null;
    if (which === "me") me = loc;
    else tgt = loc;
    if (!tgt) $("#mapTag").hidden = true;
    kick();
    draw();
  }
  cv.addEventListener("mousemove", (event) => {
    const rect = cv.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (x < box.x || x > box.x + box.w || y < box.y || y > box.y + box.h) {
      hover = null;
      $("#mapRead").textContent = "移动指针读取经纬度";
      draw();
      return;
    }
    hover = { x, y };
    const g = unproject(x, y);
    $("#mapRead").textContent = `${g.lon.toFixed(2)}°, ${g.lat.toFixed(2)}°`;
    draw();
  });
  cv.addEventListener("mouseleave", () => {
    hover = null;
    $("#mapRead").textContent = "移动指针读取经纬度";
    draw();
  });
  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { buildBase(); draw(); }, 180);
  });
  buildBase();
  draw();
  return {
    setMe: (record) => setMarker("me", record),
    setTarget: (record) => setMarker("tgt", record),
  };
})();

function renderStats() {
  $("#stQuery").textContent = String(state.stats.q);
  $("#stIps").textContent = String(state.stats.ips);
  $("#stV6").textContent = String(state.stats.v6);
  const avg = state.stats.ms.length ? Math.round(state.stats.ms.reduce((a, b) => a + b, 0) / state.stats.ms.length) : null;
  $("#stMs").textContent = avg == null ? "—" : String(avg);
  const dist = $("#srcDist");
  const keys = Object.keys(state.sources);
  if (!keys.length) {
    dist.hidden = true;
    return;
  }
  dist.hidden = false;
  dist.innerHTML = keys.map((key) => `<span><b>${esc(sourceLabel(key))}</b> ${state.sources[key]}</span>`).join("");
}

function readHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function renderHistory() {
  const items = readHistory();
  const el = $("#hist");
  if (!items.length) {
    el.innerHTML = '<span class="hist-none">还没有记录</span>';
    return;
  }
  el.innerHTML = items.map((item) => `<button type="button" class="hist-chip" data-q="${esc(item.q)}">${esc(item.q)}</button>`).join("");
  el.querySelectorAll(".hist-chip").forEach((button) => {
    button.addEventListener("click", () => {
      $("#qInput").value = button.dataset.q;
      runQuery(button.dataset.q);
    });
  });
}

function remember(q) {
  try {
    const items = readHistory().filter((item) => item.q !== q);
    items.unshift({ q, at: Date.now() });
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 8)));
  } catch { /* private mode */ }
  renderHistory();
}

function tickClocks() {
  const meOff = $("#ckMe").dataset.off;
  const tgtOff = $("#ckTgt").dataset.off;
  $("#ckMe").textContent = clockFromOffset(meOff === "" || meOff == null ? zoneOffsetSeconds(Intl.DateTimeFormat().resolvedOptions().timeZone) : Number(meOff));
  $("#ckUtc").textContent = clockFromOffset(0);
  $("#ckTgt").textContent = tgtOff === "" || tgtOff == null ? "--:--:--" : clockFromOffset(Number(tgtOff));
  const meT = $("#duoMeT");
  const tgtT = $("#duoTgtT");
  if (meT?.dataset.off) meT.textContent = clockFromOffset(Number(meT.dataset.off)).slice(0, 5);
  if (tgtT?.dataset.off) tgtT.textContent = clockFromOffset(Number(tgtT.dataset.off)).slice(0, 5);
}

function applyClock(record, prefix) {
  const off = zoneOffsetSeconds(record?.timezone);
  const clock = $(`#${prefix}`);
  const zone = $(`#${prefix}Zone`);
  if (clock) clock.dataset.off = off == null ? "" : String(off);
  if (zone) zone.textContent = record?.timezone || (record ? "该接口未返回时区" : "查询后显示");
  if (prefix === "ckTgt") {
    if (off == null) {
      $("#ckTgtDay").textContent = "----/--/--";
      $("#ckTgtDayN").textContent = record ? "该接口未返回时区" : "查询后显示";
    } else {
      const date = new Date(Date.now() + off * 1000);
      const pad = (n) => String(n).padStart(2, "0");
      $("#ckTgtDay").textContent = `${date.getUTCFullYear()}/${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCDate())}`;
      $("#ckTgtDayN").textContent = `${WEEKDAYS[date.getUTCDay()]} · ${record.city || record.countryName || "目标"}`;
    }
  }
  tickClocks();
}

function renderMe(view, diverged) {
  state.me = view;
  $("#myIpTxt").textContent = view.ip || "— — —";
  $("#myIpFlag").innerHTML = flagHtml(view.cc, 34, 24);
  $("#myIpSub").textContent = placeName(view) || "地理层级由兜底接口提供";
  $("#barMeIp").textContent = view.ip || "读取失败";
  const badge = $("#myipSrc");
  badge.textContent = view.edge ? "边缘直读" : "接口兜底";
  badge.className = `badge${view.edge ? "" : " badge-grey"}`;
  const rows = [
    ["国家 / 城市", [view.countryName, view.city].filter(Boolean).join(" ")],
    ["运营商", orgText(view)],
    ["ASN", view.asn ? `AS${view.asn}` : ""],
    ["协议版本", view.type || ""],
    ["连接 / TLS", view.edge ? [view.httpProtocol, view.tlsVersion].filter(Boolean).join(" / ") || "—" : "需边缘节点"],
    ["接入节点", view.colo || (view.edge ? "—" : "需边缘节点")],
  ];
  $("#myKv").innerHTML = rows.map(([k, v]) => `<div class="kv-row"><dt>${esc(k)}</dt><dd>${esc(v || "—")}</dd></div>`).join("");
  const warn = $("#myGeoWarn");
  if (diverged && view.edge) {
    warn.innerHTML = `<svg width="13" height="13" aria-hidden="true"><use href="#i-info"/></svg><span>边缘判定 ${esc(view.countryName || view.cc || "—")}，公开接口判定 ${esc(diverged)}。该地址段在不同归属地库里的判定本来就不一致，上方字段一律取自边缘。</span>`;
    warn.hidden = false;
  } else warn.hidden = true;
  $("#mySum").hidden = false;
  MapView.setMe(view);
  const off = zoneOffsetSeconds(view.timezone) ?? zoneOffsetSeconds(Intl.DateTimeFormat().resolvedOptions().timeZone);
  $("#ckMe").dataset.off = off == null ? "" : String(off);
  $("#ckMeZone").textContent = view.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "—";
  tickClocks();
}

function renderRisk(record) {
  if (!record) {
    show($("#riskEmpty"), true);
    show($("#riskBody"), false);
    return;
  }
  show($("#riskEmpty"), false);
  show($("#riskBody"), true);
  const risk = assessRisk({ org: record.org, isp: record.isp, asn: record.asn, local: record.local });
  const band = bandIndex(risk.tier);
  $("#scoreNum").textContent = String(risk.score);
  $("#scoreNum").style.background = BAND_COLOR[band];
  $("#scoreLabel").textContent = risk.label;
  const fill = $("#scoreFill");
  fill.style.width = `${Math.max(4, risk.score)}%`;
  fill.style.background = BAND_COLOR[band];
  const kind = risk.tier === "home" ? "ok" : risk.tier === "proxy" ? "on" : "";
  $("#signals").innerHTML = risk.reasons.map((text) => `<li class="${kind}"><span class="sig"></span>${esc(text)}<em>${risk.score}</em></li>`).join("");
  document.querySelectorAll("#bands li").forEach((li) => li.classList.toggle("on", Number(li.dataset.b) === band));
  return risk;
}

function renderDnsRecords(dns, domain) {
  $("#dnsRecName").textContent = domain;
  const groups = [];
  const mx = (dns.MX?.records || []).filter((row) => row.type === 15);
  const txt = (dns.TXT?.records || []).filter((row) => row.type === 16);
  const ns = (dns.NS?.records || []).filter((row) => row.type === 2);
  const caa = (dns.CAA?.records || []).filter((row) => row.type === 257);
  const dmarc = (dns.DMARC?.records || []).filter((row) => row.type === 16);
  if (mx.length) groups.push(["MX", mx.map((row) => row.text)]);
  if (txt.length) groups.push(["TXT", txt.map((row) => row.text)]);
  if (ns.length) groups.push(["NS", ns.map((row) => row.text)]);
  if (caa.length) groups.push(["CAA", caa.map((row) => row.text)]);
  if (dmarc.length) groups.push(["DMARC", dmarc.map((row) => row.text)]);
  const empty = $("#dnsRecEmpty");
  const list = $("#dnsRec");
  if (!groups.length) {
    show(empty, true);
    show(list, false);
    show($("#mailChk"), false);
    return;
  }
  show(empty, false);
  show(list, true);
  list.innerHTML = groups.map(([name, values]) => {
    const items = values.map((value, index) => `<span class="mono${index >= 4 ? " rec-x" : ""}">${esc(value)}</span>`).join("");
    const more = values.length > 4 ? `<button type="button" class="rec-more">还有 ${values.length - 4} 条</button>` : "";
    return `<div class="rec-row"><dt>${name}</dt><dd>${items}${more}</dd></div>`;
  }).join("");
  list.querySelectorAll(".rec-more").forEach((button) => {
    button.addEventListener("click", () => button.closest(".rec-row")?.classList.add("open"));
  });
  const mail = summarizeMail({ txt, dmarc, mx });
  const mailEl = $("#mailChk");
  show(mailEl, true);
  const level = { ok: "ok", warn: "warn", info: "warn", bad: "bad" };
  mailEl.innerHTML = mail.findings.map((item) => `<div class="mc mc-${level[item.level] || "warn"}"><b>${esc(item.title)}</b><span>${esc(item.detail)}</span></div>`).join("");
}

function renderDetail(view) {
  const self = state.me && view.ip && view.ip === state.me.ip && !view.domain;
  $("#dTitle").textContent = self ? "我的定位" : (view.domain && !view.ip ? "域名记录" : "查询结果");
  $("#dIcon").setAttribute("href", self ? "#i-target" : "#i-info");
  show($("#detailEmpty"), false);
  show($("#detailBody"), true);
  const top = document.querySelector(".res-top");
  if (!view.ip) {
    if (top) top.hidden = true;
    $("#rKv").innerHTML = "";
    show($("#rDist"), false);
    show($("#alt"), false);
    show($("#copyRes"), false);
    show($("#shareRes"), false);
    renderDnsBox(view);
    renderRisk(null);
    show($("#reachStrip"), false);
    syncReach("");
    return;
  }
  if (top) top.hidden = false;
  $("#rFlag").innerHTML = flagHtml(view.cc, 46, 32);
  $("#rIp").textContent = view.ip;
  $("#rCountry").innerHTML = view.countryName
    ? `${esc(view.countryName)}${view.cc ? `<span class="cc">${esc(view.cc)}</span>` : ""}`
    : "该接口未返回国家 / 地区";
  $("#rPath").textContent = [view.continentName, view.region, view.city].filter(Boolean).join(" › ") || "省州与城市未提供";
  $("#rType").textContent = view.type || "未知类型";
  const rows = [];
  if (view.continentName) rows.push(["大洲", view.continentName]);
  rows.push(["国家 / 地区", null, flagHtml(view.cc, 22, 15, true) + esc(view.countryName || view.cc || "—")]);
  if (view.region) rows.push(["省 / 州", view.region]);
  if (view.city) rows.push(["城市", view.city]);
  if (view.lat != null && view.lon != null) rows.push(["经纬度", `${view.lat.toFixed(5)}, ${view.lon.toFixed(5)}`, null, true]);
  if (view.timezone) rows.push(["时区", view.timezone, null, true]);
  if (view.asn) rows.push(["ASN", `AS${view.asn}`, null, true]);
  if (view.isp) rows.push(["运营商 ISP", view.isp, null, true]);
  if (view.org) rows.push(["网络组织", view.org, null, true]);
  if (view.postal) rows.push(["邮政编码", view.postal, null, true]);
  rows.push(["数据来源", view.sourceText, null, true]);
  if (view.colo) rows.push(["接入节点", view.colo]);
  $("#rKv").innerHTML = rows.map(([label, value, html]) => `<div class="kv-row"><dt>${esc(label)}</dt><dd${value ? ` class="clickable" data-copy="${esc(value)}"` : ""}>${html || esc(value || "—")}</dd></div>`).join("");
  $("#rKv").querySelectorAll("dd[data-copy]").forEach((dd) => dd.addEventListener("click", () => copyText(dd.dataset.copy)));
  const km = state.me && !self ? haversine(state.me, view) : null;
  if (km != null) {
    show($("#rDist"), true);
    $("#rDist").innerHTML = `<svg width="16" height="16"><use href="#i-target"/></svg><span>距离你约 <b>${km.toLocaleString("en-US")} km</b>（大圆直线距离）</span>`;
  } else show($("#rDist"), false);
  const network = containingNetwork(view.ip);
  const alt = [];
  if (view.type === "IPv4" && ipv4ToInt(view.ip) != null) alt.push(["十进制整数", String(ipv4ToInt(view.ip))]);
  if (view.type === "IPv6") alt.push(["完整展开", expandIPv6(view.ip) || "—"]);
  if (ptrName(view.ip)) alt.push(["反查域名", ptrName(view.ip)]);
  show($("#alt"), alt.length > 0 || Boolean(network));
  $("#altKv").innerHTML = [
    network ? `<div class="kv-row"><dt>所在网段</dt><dd><button type="button" class="linkbtn" data-cidr="${esc(network)}">${esc(network)}</button></dd></div>` : "",
    ...alt.map(([k, v]) => `<div class="kv-row"><dt>${esc(k)}</dt><dd class="clickable" data-copy="${esc(v)}">${esc(v)}</dd></div>`),
    `<div class="kv-row"><dt>PTR 记录</dt><dd id="ptrVal" class="sk">查询中…</dd></div>`,
    view.type === "IPv6" ? `<div class="kv-row"><dt>置信度</dt><dd>IPv6 地理库通常更粗</dd></div>` : "",
  ].join("");
  $("#altKv").querySelector("[data-cidr]")?.addEventListener("click", (event) => {
    $("#cidrInput").value = event.currentTarget.dataset.cidr;
    renderCidr();
    $("#cidr").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("#altKv").querySelectorAll("dd[data-copy]").forEach((dd) => dd.addEventListener("click", () => copyText(dd.dataset.copy)));
  lookupPtr(view.ip).then((ptr) => {
    const node = $("#ptrVal");
    if (!node) return;
    if (ptr) {
      node.className = "";
      node.textContent = ptr;
    } else {
      node.className = "sk";
      node.textContent = view.local ? "私网地址通常没有公网 PTR" : "没有 PTR 记录（很多地址本来就不配）";
    }
  });
  show($("#copyRes"), true);
  show($("#shareRes"), !self || Boolean(view.domain));
  $("#copyRes").onclick = () => copyText(`${view.domain ? `${view.domain} → ` : ""}${view.ip} | ${placeName(view)} | ${view.asn ? `AS${view.asn}` : "AS?"} | ${orgText(view)}`, "已复制结果");
  $("#shareRes").onclick = () => {
    const q = view.domain || view.ip;
    const url = `${location.origin}${location.pathname}?q=${encodeURIComponent(q)}`;
    copyText(url, "分享链接已复制");
    history.replaceState(null, "", `?q=${encodeURIComponent(q)}`);
  };
  renderDnsBox(view);
  renderRisk(view);
  MapView.setTarget(view);
  renderDuo(view);
  applyClock(view, "ckTgt");
  syncReach(view.local ? "" : view.ip);
}

function renderDnsBox(view) {
  const box = $("#dnsbox");
  if (!view.domain || !view.dns) {
    show(box, false);
    show($("#dnsRec"), false);
    show($("#mailChk"), false);
    show($("#dnsRecEmpty"), true);
    $("#dnsRecName").textContent = "待查询";
    return;
  }
  show(box, true);
  $("#dnsName").textContent = view.domain;
  const ips = view.addresses || [];
  const cnames = (view.dns.A?.records || []).filter((row) => row.type === 5).map((row) => row.text);
  const bits = [ips.length ? `${ips.length} 个地址` : "没有 A / AAAA 记录"];
  if (view.dns.TXT?.source) bits.push(`TXT ${view.dns.TXT.source}`);
  $("#dnsMeta").textContent = bits.join(" · ");
  const cname = $("#dnsCname");
  cname.hidden = !cnames.length;
  if (cnames.length) cname.innerHTML = `CNAME 链 <span class="mono">${cnames.map(esc).join(" ← ")}</span>`;
  $("#dnsIps").innerHTML = ips.map((ip) => `<button type="button" class="ipchip${ip === view.ip ? " on" : ""}" data-ip="${esc(ip)}"><span class="ipchip-a">${ip.includes(":") ? "v6" : "v4"}</span>${esc(ip)}</button>`).join("");
  $("#dnsIps").querySelectorAll(".ipchip").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.ip === view.ip) return;
      selectAddress(button.dataset.ip);
    });
  });
  if (!ips.length) {
    const top = document.querySelector(".res-top");
    if (top) top.hidden = true;
  }
  renderDnsRecords(view.dns, view.domain);
}

function renderDuo(view) {
  const el = $("#duo");
  if (!view || view.lat == null || (state.me && view.ip === state.me.ip)) {
    show(el, false);
    return;
  }
  show(el, true);
  $("#duoMe").innerHTML = state.me ? flagHtml(state.me.cc, 20, 14, true) + esc(state.me.city || state.me.countryName || state.me.ip) : "未读到你的位置";
  $("#duoTgt").innerHTML = flagHtml(view.cc, 20, 14, true) + esc(view.city || view.countryName || "未知位置");
  const km = haversine(state.me, view);
  $("#duoDist").textContent = km == null ? "—" : `${km.toLocaleString("en-US")} km`;
  const a = zoneOffsetSeconds(state.me?.timezone);
  const b = zoneOffsetSeconds(view.timezone);
  const diff = a != null && b != null ? Math.round(((b - a) / 3600) * 10) / 10 : null;
  $("#duoTz").textContent = diff == null ? "—" : `${diff > 0 ? "+" : ""}${diff} h`;
  $("#duoHemi").textContent = `${view.lat >= 0 ? "北" : "南"}半球 · ${view.lon >= 0 ? "东" : "西"}经`;
  $("#duoMeT").dataset.off = a == null ? "" : String(a);
  $("#duoTgtT").dataset.off = b == null ? "" : String(b);
  tickClocks();
}

function noteQuery(view, elapsed) {
  state.stats.q += 1;
  state.stats.ips += 1;
  if (view.type === "IPv6") state.stats.v6 += 1;
  state.stats.ms.push(elapsed);
  state.sources[view.sourceId] = (state.sources[view.sourceId] || 0) + 1;
  renderStats();
  remember(view.domain || view.ip);
}

async function geolocate(ip, token) {
  if (isNonPublic(ip)) {
    const record = {
      ip, type: ip.includes(":") ? "IPv6" : "IPv4", local: true,
      latitude: null, longitude: null, country_code: null, country: null, city: null, region: null,
      continent: null, asn: null, org: null, isp: null, timezone: null, postal: null,
    };
    return { view: viewOf(record, "local"), elapsed: 0 };
  }
  const started = performance.now();
  const geo = await lookupGeo(ip);
  if (token !== state.token) return null;
  if (!geo?.record) {
    const skipped = geo?.skipped?.map((item) => `${sourceLabel(item.id)}（${item.reason}）`).join("、");
    throw new Error(skipped ? `公开接口都没有返回。已尝试 ${skipped}` : "所有数据源都没有返回结果，稍后再试");
  }
  return { view: viewOf(geo.record, geo.source, geo.skipped), elapsed: Math.round(performance.now() - started) };
}

async function selectAddress(ip) {
  const token = ++state.token;
  setStatus(`正在查询 ${ip} …`, "busy");
  try {
    const found = await geolocate(ip, token);
    if (!found || token !== state.token) return;
    const view = { ...found.view, domain: state.cur?.domain, dns: state.cur?.dns, addresses: state.cur?.addresses };
    state.cur = view;
    renderDetail(view);
    noteQuery(view, found.elapsed);
    setStatus(`${view.countryName || view.ip} · 来源 ${view.sourceText}`);
  } catch (error) {
    if (token === state.token) setStatus(error.message || "查询失败", "err");
  }
}

async function runQuery(raw, options = {}) {
  const parsed = parseTarget(raw);
  const token = ++state.token;
  $("#qErr").hidden = true;
  if (parsed.error) {
    $("#qErr").hidden = false;
    $("#qErr").textContent = parsed.error;
    setStatus("输入没通过校验。", "err");
    return;
  }
  if (parsed.cidr) {
    $("#cidrInput").value = parsed.cidr;
    renderCidr();
  }
  if (!options.noUrl) history.replaceState(null, "", `?q=${encodeURIComponent(String(raw).trim())}`);
  try {
    if (parsed.kind === "ip") {
      if (isNonPublic(parsed.ip)) {
        setStatus(`${parsed.ip} 是私网、回环或保留地址，没有公网归属地可查。`, "err");
        return;
      }
      setStatus(`正在查询 ${parsed.ip} …`, "busy");
      const found = await geolocate(parsed.ip, token);
      if (!found || token !== state.token) return;
      state.cur = found.view;
      renderDetail(found.view);
      noteQuery(found.view, found.elapsed);
      setStatus(options.silent
        ? `已默认定位你自己（${found.view.city || found.view.countryName || "未知"}）。输入别的 IP，标题会切回「查询结果」。`
        : `${found.view.countryName || found.view.ip} · 来源 ${found.view.sourceText}`);
      return;
    }
    setStatus(`正在解析域名 ${parsed.domain} …`, "busy");
    const dns = await lookupDns(parsed.domain);
    if (token !== state.token) return;
    const ips = addressesOf(dns);
    if (!ips.length) {
      const view = { domain: parsed.domain, dns, addresses: [], ip: "" };
      state.cur = view;
      renderDetail(view);
      const hasOther = ["MX", "TXT", "NS", "CAA", "DMARC"].some((key) => dns[key]?.records?.length);
      setStatus(hasOther
        ? `${parsed.domain} 没有 A / AAAA 记录（这类域名通常只用来收发邮件），下面是查到的其他记录。`
        : `域名 ${parsed.domain} 没有解析到任何记录。`, hasOther ? "" : "err");
      if (hasOther) remember(parsed.domain);
      return;
    }
    setStatus(`解析到 ${ips.length} 个地址，正在查归属地 …`, "busy");
    const found = await geolocate(ips[0], token);
    if (!found || token !== state.token) return;
    const view = { ...found.view, domain: parsed.domain, dns, addresses: ips };
    state.cur = view;
    renderDetail(view);
    noteQuery(view, found.elapsed);
    setStatus(`${parsed.domain} → ${view.ip} · 来源 ${view.sourceText}`);
  } catch (error) {
    if (token === state.token) {
      setStatus(error.message || "查询失败", "err");
      toast("查询失败，可稍后再试");
    }
  }
}

async function loadMe() {
  let edgeRecord = null;
  try {
    const response = await fetch("/api/whoami", { cache: "no-store", headers: { accept: "application/json" } });
    if (!response.ok) throw new Error("status");
    const data = await response.json();
    if (edgeUsable(data)) edgeRecord = recordFromEdge(data);
  } catch { /* fall through */ }
  if (edgeRecord) {
    let view = viewOf(edgeRecord, "edge");
    renderMe(view);
    setStatus("已从边缘节点读出你的网络信息。");
    const extra = await lookupGeo(edgeRecord.ip).catch(() => null);
    if (extra?.record) {
      if (!view.org && extra.record.org) view = { ...view, org: extra.record.org };
      if (!view.isp && extra.record.isp) view = { ...view, isp: extra.record.isp };
      if (!view.asn && extra.record.asn) view = { ...view, asn: extra.record.asn };
      const diverged = extra.record.country_code && view.cc && extra.record.country_code !== view.cc
        ? `${countryLabel(extra.record.country_code, extra.record.country)}${extra.record.city ? ` / ${extra.record.city}` : ""}`
        : "";
      renderMe(view, diverged);
    }
  } else {
    const geo = await lookupGeo(null).catch(() => null);
    if (!geo?.record) {
      $("#myIpTxt").textContent = "读取失败";
      $("#myIpSub").textContent = "可能是网络受限或接口被限流，稍后刷新重试。";
      $("#barMeIp").textContent = "读取失败";
      $("#myipSrc").textContent = "未读到";
      setStatus("没能读出你的网络信息，直接输入 IP 查询仍然可用。", "err");
      return;
    }
    renderMe(viewOf(geo.record, geo.source, geo.skipped));
    setStatus("当前环境没有可用的边缘地理数据，你的信息改由公开接口读出。");
  }
  if (!state.autoDone && state.me?.ip && !isNonPublic(state.me.ip)) {
    state.autoDone = true;
    const q = new URLSearchParams(location.search).get("q");
    if (!q) {
      $("#qInput").value = state.me.ip;
      runQuery(state.me.ip, { noUrl: true, silent: true });
    }
  }
}

function naturePill(record) {
  if (!record) return '<span class="pill pill-wait">排队中</span>';
  const risk = assessRisk({ org: record.org, isp: record.isp, asn: record.asn, local: record.local });
  const band = bandIndex(risk.tier);
  const cls = band >= 3 ? "pill-bad" : band === 0 ? "pill-home" : "pill-dc";
  const label = band >= 3 ? "代理 / VPN" : band === 2 ? "云主机" : band === 1 ? "骨干出口" : "住宅宽带";
  return `<span class="pill ${cls}">${label} · ${risk.score}</span>`;
}

function drawBatch() {
  const body = $("#batchBody");
  body.innerHTML = state.batch.map((row) => {
    const q = row.shown && row.shown !== row.ip ? `<span class="bq">${esc(row.shown)}</span><br>` : "";
    if (row.pending) return `<tr><td class="m">${q}${esc(row.shown || row.ip || "—")}</td><td colspan="3" class="wrap-ok">查询中…</td><td><span class="pill pill-wait">排队中</span></td></tr>`;
    if (row.err) return `<tr><td class="m">${q}${esc(row.ip || row.shown || "—")}</td><td colspan="3" class="wrap-ok">${esc(row.err)}</td><td><span class="pill pill-err">失败</span></td></tr>`;
    return `<tr><td class="m">${q}${esc(row.ip)}</td><td>${flagHtml(row.cc, 20, 14, true)}${esc(placeName(row) || "—")}</td><td class="m">${esc(`${row.asn ? `AS${row.asn}` : "—"} ${orgText(row)}`)}</td><td>${naturePill(row)}</td><td><span class="pill pill-home">${esc(sourceLabel(row.sourceId))}</span></td></tr>`;
  }).join("");
  $("#batchHint").hidden = state.batch.length > 0;
  $("#batchCsv").disabled = state.batch.length === 0;
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

async function runBatch() {
  const split = splitTargets($("#batchInput").value, 20);
  if (!split.items.length) {
    $("#qErr").hidden = false;
    $("#qErr").textContent = "没有识别到合法条目。支持 IPv4、IPv6 与网站域名，用换行或逗号分隔。";
    return;
  }
  $("#qErr").hidden = !split.truncated;
  if (split.truncated) $("#qErr").textContent = `单次最多 20 个，已截取前 20 个（共 ${split.total} 个）。`;
  $("#batchCount").textContent = `${split.items.length} / 20`;
  state.batch = split.items.map((item) => ({ shown: item, pending: true }));
  drawBatch();
  show($("#batchProg"), true);
  $("#batchGo").disabled = true;
  let done = 0;
  try {
    state.batch = await mapPool(split.items, 2, async (item) => {
      const parsed = parseTarget(item);
      let row;
      try {
        if (parsed.error) row = { shown: item, err: parsed.error };
        else if (parsed.kind === "ip") {
          if (isNonPublic(parsed.ip)) row = { ...viewOf({ ip: parsed.ip, type: "IPv4", local: true, country_code: null }, "local"), shown: item };
          else {
            const geo = await lookupGeo(parsed.ip);
            row = geo?.record ? { ...viewOf(geo.record, geo.source, geo.skipped), shown: item } : { shown: item, ip: parsed.ip, err: "没有结果" };
          }
        } else {
          const dns = await lookupDns(parsed.domain);
          const ips = addressesOf(dns);
          if (!ips.length) row = { shown: parsed.domain, err: "没有 A / AAAA" };
          else {
            const geo = await lookupGeo(ips[0]);
            row = geo?.record ? { ...viewOf(geo.record, geo.source, geo.skipped), shown: parsed.domain } : { shown: parsed.domain, ip: ips[0], err: "没有归属地" };
          }
        }
      } catch {
        row = { shown: item, err: "查询失败" };
      }
      done += 1;
      $("#batchProgFill").style.width = `${Math.round((done / split.items.length) * 100)}%`;
      return row;
    });
    drawBatch();
  } finally {
    $("#batchGo").disabled = false;
  }
}

function exportCsv() {
  const lines = [["目标", "IP", "位置", "ASN", "运营商", "性质", "来源", "状态"].join(",")];
  const cell = (value) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  for (const row of state.batch) {
    const risk = row.err ? null : assessRisk({ org: row.org, isp: row.isp, asn: row.asn, local: row.local });
    lines.push([row.shown, row.ip, placeName(row), row.asn ? `AS${row.asn}` : "", orgText(row), risk ? `${risk.score} ${risk.label}` : "", row.sourceId ? sourceLabel(row.sourceId) : "", row.err || "完成"].map(cell).join(","));
  }
  const blob = new Blob([`\uFEFF${lines.join("\n")}\n`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "ip-lookup.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function renderCidr() {
  const result = parseCidr($("#cidrInput").value);
  const note = $("#cidrNote");
  const out = $("#cidrOut");
  if (!result.ok) {
    out.innerHTML = "";
    note.hidden = false;
    note.className = "qerr";
    note.textContent = result.error;
    return;
  }
  note.hidden = false;
  note.className = "fine";
  note.textContent = result.note || "";
  const num = (value) => (String(value).startsWith("2^") ? value : Number(value).toLocaleString("zh-CN"));
  const rows = [
    ["网络地址", result.network],
    ["广播地址", result.broadcast || "无（IPv6 不使用广播地址）"],
    ["子网掩码", result.netmask],
    ["通配符掩码", result.wildcard],
    ["可用范围", result.first === result.last ? result.first : `${result.first} – ${result.last}`],
    ["地址总数", num(result.totalText)],
    ["可用地址", num(result.usableText)],
  ];
  out.innerHTML = rows.map(([k, v]) => `<div class="kv-row"><dt>${esc(k)}</dt><dd class="mono">${esc(v)}</dd></div>`).join("");
}

function hashText(value) {
  let h = 5381;
  for (let i = 0; i < value.length; i += 1) h = ((h << 5) + h + value.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

function canvasFp() {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 260;
    canvas.height = 60;
    const g = canvas.getContext("2d");
    g.textBaseline = "top";
    g.font = "16px Arial";
    g.fillStyle = "#f60";
    g.fillRect(4, 4, 120, 26);
    g.fillStyle = "#069";
    g.fillText("IP Lookup", 8, 8);
    g.fillStyle = "rgba(102,204,0,.7)";
    g.fillText("IP Lookup", 10, 24);
    return hashText(canvas.toDataURL());
  } catch {
    return null;
  }
}

function paintPriv(extra = []) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  const off = -new Date().getTimezoneOffset() / 60;
  const langs = navigator.languages?.join(", ") || navigator.language || "";
  const fp = canvasFp();
  const rows = [
    ["时区", tz ? `${tz}（UTC${off >= 0 ? "+" : ""}${off}）` : "未提供"],
    ["语言偏好", langs || "未提供"],
    ["屏幕 / 像素比", `${screen.width || "?"}×${screen.height || "?"} @${window.devicePixelRatio || 1}x`],
    ["Canvas 指纹", fp ? `#${fp}（同设备通常不变）` : "取不到"],
    ...extra,
  ];
  $("#privKv").innerHTML = rows.map(([k, v, warn]) => `<div class="kv-row"><dt>${esc(k)}</dt><dd class="${warn ? "warn" : ""}">${esc(v)}</dd></div>`).join("");
}

function gatherIce(iceServers, ms) {
  return new Promise((resolve) => {
    const PC = window.RTCPeerConnection;
    if (!PC) {
      resolve({ ok: false, reason: "浏览器不支持 WebRTC" });
      return;
    }
    let pc;
    try { pc = new PC({ iceServers }); } catch {
      resolve({ ok: false, reason: "WebRTC 初始化失败" });
      return;
    }
    const found = [];
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      try { pc.close(); } catch { /* already closed */ }
      resolve({ ok: true, cands: found });
    };
    pc.onicecandidate = (event) => {
      if (!event.candidate) { finish(); return; }
      const match = /(?:udp|tcp)\s+\d+\s+\S+\s+(\S+)\s+\d+\s+typ\s+(\w+)/.exec(event.candidate.candidate || "");
      if (match) found.push({ addr: match[1], typ: match[2] });
    };
    try {
      pc.createDataChannel("probe");
      pc.createOffer().then((offer) => pc.setLocalDescription(offer)).catch(finish);
    } catch { finish(); }
    setTimeout(finish, ms);
  });
}

function classify(cands) {
  const priv = [];
  const pub = [];
  let mdns = 0;
  for (const cand of cands) {
    const addr = cand.addr;
    if (/\.local$/i.test(addr)) { mdns += 1; continue; }
    if (/^10\.|^192\.168\.|^127\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\.|^fe80:|^f[cd]/i.test(addr)) priv.push(addr);
    else pub.push(addr);
  }
  return { priv, pub, mdns };
}

async function runPriv() {
  $("#privGo").disabled = true;
  paintPriv([["WebRTC", "探测中…"]]);
  const host = await gatherIce([], 2200);
  if (!host.ok) {
    paintPriv([["WebRTC", host.reason, true]]);
    $("#privGo").disabled = false;
    return;
  }
  const srflx = await gatherIce([{ urls: "stun:stun.cloudflare.com:3478" }], 4000);
  const local = classify(host.cands);
  const remote = classify((srflx.cands || []).filter((cand) => cand.typ === "srflx"));
  const extra = [];
  if (remote.pub.length) {
    const same = state.me?.ip && remote.pub.includes(state.me.ip);
    extra.push(same
      ? ["WebRTC 公网候选", `${remote.pub.join(", ")}（与你当前出口一致，没有绕过代理）`]
      : ["WebRTC 公网候选", `暴露了一个与当前出口不同的地址：${remote.pub.join(", ")}`, true]);
  } else if (local.mdns && !local.priv.length) extra.push(["WebRTC", `只看到 ${local.mdns} 个 .local 主机名，mDNS 混淆生效`]);
  else extra.push(["WebRTC 公网候选", "没有拿到公网反射地址"]);
  if (local.priv.length) extra.push(["内网地址", `漏出了 ${local.priv.join(", ")}`, true]);
  paintPriv(extra);
  $("#privGo").disabled = false;
}

const REACH_CACHE = "ip-lookup.reach.v1";
let reachSeq = 0;
let reachAbort = null;
let reachKey = "";

function reachSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readReachCache(ip, port) {
  try {
    const all = JSON.parse(sessionStorage.getItem(REACH_CACHE) || "{}");
    const hit = all[`${ip}|${port}`];
    if (!hit || Date.now() - hit.at > 10 * 60 * 1000) return null;
    return hit.model;
  } catch {
    return null;
  }
}

function dropReachCache(ip, port) {
  try {
    const all = JSON.parse(sessionStorage.getItem(REACH_CACHE) || "{}");
    delete all[`${ip}|${port}`];
    sessionStorage.setItem(REACH_CACHE, JSON.stringify(all));
  } catch { /* private mode */ }
}

function writeReachCache(model) {
  try {
    const all = JSON.parse(sessionStorage.getItem(REACH_CACHE) || "{}");
    const keys = Object.keys(all);
    if (keys.length > 8) delete all[keys[0]];
    all[`${model.ip}|${model.port}`] = { at: Date.now(), model };
    sessionStorage.setItem(REACH_CACHE, JSON.stringify(all));
  } catch { /* private mode */ }
}

function toneOf(id) {
  if (id === "clear") return "ok";
  if (id === "blocked" || id === "error") return "bad";
  if (id === "down" || id === "mixed" || id === "asymmetric") return "warn";
  return "muted";
}

function nodeLine(node) {
  const where = [node.location, node.provider].filter(Boolean).join(" · ") || node.id;
  const mark = node.status === "ok"
    ? `<b class="reach-ok">${node.ms == null ? "通" : `${esc(node.ms)} ms`}</b>`
    : `<b class="reach-bad">不通</b>`;
  return `<div class="reach-node"><span>${esc(where)}</span>${mark}</div>`;
}

function protoBlock(label, side, nodes) {
  if (!side) {
    return `<div class="reach-proto"><div class="reach-proto-h"><span>${esc(label)}</span><span class="pill pill-wait">还在测</span></div></div>`;
  }
  const pill = side.state === "fail" ? "pill-bad" : side.state === "mixed" ? "pill-dc" : side.state === "ok" ? "pill-home" : "pill-wait";
  const text = side.total < 2 ? "样本不够" : `通 ${side.ok} · 不通 ${side.fail}`;
  const list = (nodes || []).map(nodeLine).join("");
  const offline = side.offline ? `<p class="fine">${side.offline} 个节点离线，已忽略</p>` : "";
  return `<div class="reach-proto"><div class="reach-proto-h"><span>${esc(label)}</span><span class="pill ${pill}">${text}</span></div>${list}${offline}</div>`;
}

function columnHtml(heading, icmp, tcp, port, overseas) {
  const icmpNodes = overseas ? icmp?.overseasSample : icmp?.domesticNodes;
  const tcpNodes = overseas ? tcp?.overseasSample : tcp?.domesticNodes;
  const icmpSide = overseas ? icmp?.overseas : icmp?.domestic;
  const tcpSide = overseas ? tcp?.overseas : tcp?.domestic;
  return `<h3 class="reach-h">${heading}</h3>${protoBlock("ICMP", icmpSide, icmpNodes)}${protoBlock(`TCP ${port}`, tcpSide, tcpNodes)}`;
}

function paintReach(model, options = {}) {
  const banner = $("#reachBanner");
  const strip = $("#reachStrip");
  const grid = $("#reachGrid");
  if (!model) {
    banner.className = "reach-banner tone-muted";
    $("#reachTitle").textContent = "还没探测";
    $("#reachDetail").textContent = "在上面查一个公网 IP，这里会自动对照国内和国外。也可以自己填地址和端口。";
    $("#reachSrc").textContent = "查询后自动测";
    show(grid, false);
    show(strip, false);
    $("#reachGo").disabled = false;
    $("#reachGo").textContent = "开始检测";
    return;
  }
  const verdict = model.tcp || model.tcpError
    ? summarizeReach({ icmp: model.icmp, tcp: model.tcp, port: model.port, icmpError: model.icmpError || "" })
    : { id: "pending", tone: "muted", title: "正在探测", detail: "归属地已经出来了。国内外节点还在测这个端口，通常要几秒到十几秒。" };
  if (model.tcpError && !model.tcp) {
    verdict.id = "error";
    verdict.tone = "bad";
    verdict.title = "这次没测成";
    verdict.detail = model.tcpError;
  }
  const tone = toneOf(verdict.id);
  banner.className = `reach-banner tone-${tone}`;
  $("#reachTitle").textContent = verdict.title;
  const cached = options.cached ? " 这是刚才存在这台浏览器里的结果。" : "";
  $("#reachDetail").textContent = `${verdict.detail}${cached}`;
  const tcpName = model.tcp?.source === "globalping" ? "TCP Globalping" : model.tcp ? "TCP ping.pe" : "TCP …";
  const icmpName = model.icmp ? "ICMP Globalping" : model.icmpError ? "ICMP 失败" : "ICMP …";
  $("#reachSrc").textContent = model.tcp || model.icmp ? `${tcpName} · ${icmpName}` : "探测中";
  const hasNodes = Boolean(model.tcp || model.icmp);
  show(grid, hasNodes);
  if (hasNodes) {
    $("#reachDomestic").innerHTML = columnHtml("国内", model.icmp, model.tcp, model.port, false);
    $("#reachOverseas").innerHTML = columnHtml("国外", model.icmp, model.tcp, model.port, true);
  }
  const shownIp = $("#rIp")?.textContent?.trim() || "";
  const detailOpen = $("#detailBody") && !$("#detailBody").hidden && shownIp && shownIp !== "—";
  if (detailOpen && model.ip === shownIp) {
    show(strip, true);
    strip.className = `reach-strip tone-${tone}`;
    $("#reachStripTitle").textContent = verdict.title;
    $("#reachStripDetail").textContent = verdict.detail;
  } else show(strip, false);
  const waiting = Boolean(model.pending && !model.tcp && !model.tcpError);
  $("#reachGo").disabled = waiting;
  $("#reachGo").textContent = waiting ? "探测中…" : "重新检测";
}

function showReachError(message) {
  const err = $("#reachErr");
  err.hidden = false;
  err.textContent = message;
}

function probeErrorMessage(error, fallback) {
  if (error?.client && error.message) return error.message;
  const text = String(error?.message || "");
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(text)) return fallback;
  if (text && text.length <= 80) return text;
  return fallback;
}

async function runGlobalping(ip, port, protocol, signal) {
  const created = await fetch(GLOBALPING_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(globalpingBody(ip, port, protocol)),
    signal,
  });
  const payload = await created.json().catch(() => ({}));
  if (created.status === 429) throw new Error("这个网络的探测次数用完了，大约一小时后再试");
  if (!created.ok || !payload.id) throw new Error("公开探测接口没有接受这次请求");
  let wait = 400;
  for (let i = 0; i < 20; i += 1) {
    await reachSleep(wait);
    const response = await fetch(`${GLOBALPING_ENDPOINT}/${encodeURIComponent(payload.id)}`, {
      cache: "no-store",
      signal,
      headers: { accept: "application/json" },
    });
    if (response.status === 429) throw new Error("这个网络的探测次数用完了，大约一小时后再试");
    const data = await response.json().catch(() => ({}));
    if (data.status && data.status !== "in-progress") return data;
    wait = 700;
  }
  throw new Error("探测超时");
}

async function loadTcp(ip, port, signal) {
  let fallback = "";
  try {
    const response = await fetch(`/api/reach?ip=${encodeURIComponent(ip)}&port=${port}`, {
      cache: "no-store",
      signal,
      headers: { accept: "application/json" },
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 400) {
      const error = new Error(data.error || "地址不能探测");
      error.client = true;
      throw error;
    }
    const useful = data.tcp && (data.tcp.domestic?.total || 0) + (data.tcp.overseas?.total || 0) > 0;
    if (response.ok && useful) return data.tcp;
    fallback = data.error || "";
  } catch (error) {
    if (error.client || error.name === "AbortError") throw error;
    fallback = "边缘探测没有连上";
  }
  const measurement = await runGlobalping(ip, port, "TCP", signal).catch((error) => {
    if (error.name === "AbortError") throw error;
    const why = probeErrorMessage(error, "备用探测没有连上");
    throw new Error(fallback ? `${fallback}；${why}` : why);
  });
  return packProtocol(probesFromGlobalping(measurement), "globalping");
}

function syncReach(ip) {
  if (!ip) {
    reachAbort?.abort();
    reachSeq += 1;
    reachKey = "";
    paintReach(null);
    return;
  }
  const target = validateTarget(ip, $("#reachPort").value);
  if (target.error) {
    showReachError(target.error);
    return;
  }
  $("#reachErr").hidden = true;
  $("#reachIp").value = target.ip;
  const cached = readReachCache(target.ip, target.port);
  if (cached) {
    reachKey = `${target.ip}|${target.port}`;
    paintReach(cached, { cached: true });
    return;
  }
  if (reachKey === `${target.ip}|${target.port}` && $("#reachGo").disabled) return;
  void runReach(target.ip, target.port);
}

async function runReach(ip, port) {
  const target = validateTarget(ip, port);
  if (target.error) {
    showReachError(target.error);
    return;
  }
  $("#reachErr").hidden = true;
  reachAbort?.abort();
  const controller = new AbortController();
  reachAbort = controller;
  const seq = ++reachSeq;
  reachKey = `${target.ip}|${target.port}`;
  const model = { ip: target.ip, port: target.port, tcp: null, icmp: null, tcpError: "", icmpError: "", pending: true };
  paintReach(model);
  const tcpTask = loadTcp(target.ip, target.port, controller.signal).then(
    (tcp) => { model.tcp = tcp; },
    (error) => { if (error.name !== "AbortError") model.tcpError = probeErrorMessage(error, "端口探测失败"); },
  );
  const icmpTask = runGlobalping(target.ip, target.port, "ICMP", controller.signal).then(
    (measurement) => { model.icmp = packProtocol(probesFromGlobalping(measurement), "globalping"); },
    (error) => { if (error.name !== "AbortError") model.icmpError = probeErrorMessage(error, "浏览器没有连上 ICMP 探测"); },
  );
  await tcpTask;
  if (seq === reachSeq) paintReach(model);
  await icmpTask;
  if (seq !== reachSeq) return;
  model.pending = false;
  paintReach(model);
  if (model.tcp && model.icmp) writeReachCache(model);
}

function fillHosts() {
  document.querySelectorAll(".site-host").forEach((node) => { node.textContent = location.host; });
}

fillHosts();
renderHistory();
renderCidr();
paintPriv();
setInterval(tickClocks, 1000);
tickClocks();

const seen = new IntersectionObserver((entries) => {
  entries.forEach((entry) => { if (entry.isIntersecting) entry.target.classList.add("in"); });
}, { threshold: 0.08 });
document.querySelectorAll(".cell").forEach((cell) => {
  seen.observe(cell);
  if (cell.getBoundingClientRect().top < window.innerHeight) cell.classList.add("in");
});

const input = $("#qInput");
const unlock = () => input.removeAttribute("readonly");
input.addEventListener("focus", unlock);
input.addEventListener("pointerdown", unlock);
$("#qForm").addEventListener("submit", (event) => {
  event.preventDefault();
  runQuery(input.value);
});
document.querySelectorAll("#chips .chip").forEach((button) => {
  button.addEventListener("click", () => {
    input.value = button.dataset.q;
    runQuery(button.dataset.q);
  });
});
$("#meBtn").addEventListener("click", () => {
  if (!state.me?.ip) { toast("还在读取你的地址"); return; }
  input.value = state.me.ip;
  runQuery(state.me.ip);
  $("#detail").scrollIntoView({ behavior: "smooth", block: "start" });
});
$("#barMe").addEventListener("click", () => { if (state.me?.ip) copyText(state.me.ip, "已复制 IP"); });
$("#myIp").addEventListener("click", () => { if (state.me?.ip) copyText(state.me.ip, "已复制 IP"); });
$("#mySum").addEventListener("click", () => {
  if (!state.me) return;
  copyText([`IP: ${state.me.ip}`, `位置: ${placeName(state.me)}`, `运营商: ${orgText(state.me) || "—"}`, `ASN: ${state.me.asn ? `AS${state.me.asn}` : "—"}`, `来源: ${state.me.edge ? "边缘直读" : state.me.sourceText}`].join("\n"), "已复制体检摘要");
});
$("#mapMe").addEventListener("click", () => {
  if (state.me?.lat != null) { MapView.setTarget(state.me); toast("地图已定位到你的位置"); }
  else toast("还没有你的位置数据");
});
$("#mapReset").addEventListener("click", () => {
  MapView.setTarget(state.cur || null);
  toast(state.cur ? "已回到查询目标" : "已清空地图标记");
});
$("#batchGo").addEventListener("click", runBatch);
$("#batchCsv").addEventListener("click", exportCsv);
$("#batchClear").addEventListener("click", () => {
  $("#batchInput").value = "";
  state.batch = [];
  drawBatch();
  $("#batchCount").textContent = "0 / 20";
  show($("#batchProg"), false);
});
$("#batchInput").addEventListener("input", () => {
  $("#batchCount").textContent = `${splitTargets($("#batchInput").value, 20).items.length} / 20`;
});
$("#cidrGo").addEventListener("click", renderCidr);
$("#cidrInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter") { event.preventDefault(); renderCidr(); }
});
document.querySelectorAll(".cidr-chip").forEach((button) => {
  button.addEventListener("click", () => {
    $("#cidrInput").value = button.dataset.c;
    renderCidr();
  });
});
$("#privGo").addEventListener("click", runPriv);
$("#reachGo").addEventListener("click", () => {
  const target = validateTarget($("#reachIp").value, $("#reachPort").value);
  if (target.error) { showReachError(target.error); return; }
  dropReachCache(target.ip, target.port);
  void runReach(target.ip, target.port);
});
$("#reachPort").addEventListener("keydown", (event) => {
  if (event.key === "Enter") { event.preventDefault(); $("#reachGo").click(); }
});
$("#reachIp").addEventListener("keydown", (event) => {
  if (event.key === "Enter") { event.preventDefault(); $("#reachGo").click(); }
});
document.querySelectorAll(".reach-port").forEach((button) => {
  button.addEventListener("click", () => {
    $("#reachPort").value = button.dataset.port;
    if ($("#reachIp").value.trim()) $("#reachGo").click();
  });
});
$("#wipeBtn").addEventListener("click", () => {
  try { localStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ }
  renderHistory();
  toast("本机历史已清除");
});

const initial = new URLSearchParams(location.search).get("q");
if (initial) {
  input.value = initial;
  runQuery(initial, { noUrl: true });
}
loadMe();
