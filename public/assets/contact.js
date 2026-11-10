import { applyDom, bindLangToggle, getLang, onLang } from "./logic/i18n.js";

const INBOX = "i@wi.fs.kg";
const COPY = {
  zh: {
    title: "联系 · IP Lookup",
    desc: "站内留言表单还没开通，不会假装已经发出。直接发邮件到 i@wi.fs.kg，主题带 [ip]，看得出信是从 IP 站来的。",
    eyebrow: "Contact · 直接发信",
    h1a: "有话直说，",
    h1b: "一封邮件",
    h1c: "就到。",
    lede: "这个部署还没有发信接口，页面不会假装留言已经送出。IP 查错了、页面不好用，直接写到 i@wi.fs.kg。这是 IP Lookup 的联系页，信箱和 wi.fs.kg 是同一个。",
    n1: "没有发信接口：这个站点不代发邮件。按钮会打开你自己的邮箱。",
    n2: "由你自己发出：写完在邮件客户端里发送。本站不会显示「已经送到」。",
    n3: "回信时间：通常是看到就回，忙起来可能要一两天。技术问题请把地址和复现步骤写在邮件里。",
    mailK: "发到这个地址",
    mailFine: "打开你的邮件应用，主题已写上 [ip]。正文请自己写，然后发送。",
    subject: "[ip] 来自联系页面",
    tagsK: "快速起头",
    tagsFine: "点一下会在留言框里带出提纲，按着填完直接发。",
    wrong: "数据不准",
    api: "接口建议",
    bug: "Bug 反馈",
    other: "随便聊聊",
    name: "称呼",
    opt: "选填",
    email: "邮箱",
    req: "必填",
    msg: "留言",
    human: "安全校验",
    auto: "自动完成",
    tsOff: "这个部署还没打开自动校验",
    hintAuto: "通常一秒内自动通过。只有可疑流量才会被要求手动确认一次。",
    hintBlocked: "安全校验没加载出来，多半是拦截插件拦住了。关掉它再刷新，或直接写信到 i@wi.fs.kg。",
    hintNoKey: "这个部署还没打开安全校验。表单可以填，发不出去就直接写信。",
    hintNoMail: "发信通道还没配好。直接写信到 i@wi.fs.kg，看到的时间一样。",
    send: "发送留言",
    sending: "发送中…",
    consent: "提交即表示同意我们仅为回复此留言而使用你填写的邮箱。内容不会公开展示。",
    doneT: "已经送到了",
    doneP: "谢谢你的留言。回信会发到",
    again: "再写一封",
    home: "回查询台",
    homeD: "位置、线路、风险，还在原来那一页。",
    fp: "浏览器指纹",
    fpD: "本地采样，不上传，刷新即清。",
    cli: "终端接口",
    cliD: "curl 一行取 IP，/json 取整份情报。",
    phName: "怎么称呼你",
    phMsg: "想说什么都可以，越具体越好。",
    err: {
      INVALID_EMAIL: "邮箱格式看起来不对",
      MESSAGE_TOO_SHORT: "再多写几个字吧",
      MESSAGE_TOO_LONG: "留言太长了",
      TURNSTILE_REQUIRED: "上面的安全校验还没通过",
      TURNSTILE_FAILED: "安全校验没通过。也可以直接写信到 i@wi.fs.kg",
      NOT_CONFIGURED: "发信通道还没配好。可以直接写信到 i@wi.fs.kg",
      RATE_LIMITED: "发得太勤了，稍后再试",
      SEND_FAILED: "这会儿没送出去。可以直接写信到 i@wi.fs.kg",
      NETWORK: "网络好像不太通。也可以直接写信到 i@wi.fs.kg",
      REJECTED: "这条留言没能收下",
    },
    tpl: {
      wrong: "查询的 IP 或域名：\n期望的结果：\n实际显示：\n",
      api: "想加的字段或能力：\n用在什么场景：\n",
      bug: "出问题的页面：\n复现步骤：\n1. \n2. \n浏览器与系统：\n",
      other: "想说的：\n",
    },
    form: {
      eyebrow: "Contact · 直达信箱",
      h1b: "一封信",
      lede: "IP 查错了、接口想加字段、页面不好用，写在这里。不用注册。留言投到和 wi.fs.kg 相同的信箱 i@wi.fs.kg，回信地址是你自己填的邮箱。这是 IP Lookup，不是 WHOIS 站。",
      n1: "只送这一封信：不会把你加进任何列表。",
      n2: "带上必要的上下文：留言会附带页面地址和浏览器标识，方便复现。",
      n3: "回信时间：通常是看到就回，忙起来可能要一两天。",
    },
  },
  en: {
    title: "Contact · IP Lookup",
    desc: "The form is not enabled on this deploy, and the page will not pretend a note was sent. Write to i@wi.fs.kg. The subject starts with [ip].",
    eyebrow: "Contact · email directly",
    h1a: "Say it plain. ",
    h1b: "One email",
    h1c: " gets there.",
    lede: "This deploy has no mail API, so the page will not pretend a note was sent. A wrong IP, a bug, or a suggestion: write to i@wi.fs.kg. This is the IP Lookup contact page. The inbox is the same one wi.fs.kg uses.",
    n1: "No mail API: this site does not relay mail. The button opens your own mail app.",
    n2: "You send it: write it there and send it yourself. This page will not say it was delivered.",
    n3: "Reply time: usually when it is seen, a day or two when things are busy. For anything technical, include the address and the steps.",
    mailK: "Write here",
    mailFine: "Opens your mail app with the subject set to [ip]. Write the body, then send it yourself.",
    subject: "[ip] from the contact page",
    tagsK: "Start from",
    tagsFine: "A tap drops an outline into the box. Fill it in and send.",
    wrong: "Wrong data",
    api: "API idea",
    bug: "Bug",
    other: "Just saying hi",
    name: "Name",
    opt: "optional",
    email: "Email",
    req: "required",
    msg: "Message",
    human: "Security check",
    auto: "automatic",
    tsOff: "Automatic check is not switched on here",
    hintAuto: "Usually clears in a second. Only suspicious traffic is asked to confirm.",
    hintBlocked: "The security check did not load, usually because a blocker stopped it. Allow it and refresh, or write to i@wi.fs.kg.",
    hintNoKey: "This deploy has not switched on the security check. If the form will not send, write the email instead.",
    hintNoMail: "Outgoing mail is not configured. Write to i@wi.fs.kg and it will be seen just the same.",
    send: "Send note",
    sending: "Sending…",
    consent: "Sending means this address is used only to reply. The note is not shown in public.",
    doneT: "It has been delivered",
    doneP: "Thanks. The reply goes to",
    again: "Write another",
    home: "Back to lookup",
    homeD: "Place, route, and risk are still on the main page.",
    fp: "Browser fingerprint",
    fpD: "Sampled locally. Not uploaded. A refresh clears it.",
    cli: "Terminal API",
    cliD: "One curl returns the IP. /json returns the record.",
    phName: "What should I call you",
    phMsg: "Whatever it is, the more specific the better.",
    err: {
      INVALID_EMAIL: "That email looks wrong",
      MESSAGE_TOO_SHORT: "Write a few more words",
      MESSAGE_TOO_LONG: "That note is too long",
      TURNSTILE_REQUIRED: "The security check above has not finished",
      TURNSTILE_FAILED: "The security check did not pass. You can also write to i@wi.fs.kg",
      NOT_CONFIGURED: "Outgoing mail is not configured. Write to i@wi.fs.kg instead",
      RATE_LIMITED: "That is a lot of notes. Try again shortly",
      SEND_FAILED: "It did not go out just now. Write to i@wi.fs.kg instead",
      NETWORK: "The network looks unhappy. You can also write to i@wi.fs.kg",
      REJECTED: "This note could not be accepted",
    },
    tpl: {
      wrong: "IP or domain:\nExpected:\nWhat it showed:\n",
      api: "Field or capability:\nWhere it would be used:\n",
      bug: "Page:\nSteps:\n1. \n2. \nBrowser and OS:\n",
      other: "Note:\n",
    },
    form: {
      eyebrow: "Contact · straight to the inbox",
      h1b: "One letter",
      lede: "A wrong IP, a missing API field, or a page that fights you: write it here. No account. The note goes to i@wi.fs.kg, the same inbox as wi.fs.kg, and the reply goes to the address you type. This is IP Lookup, not the WHOIS site.",
      n1: "Just this one letter: you are not added to a list.",
      n2: "Enough context to match it up: the page address and browser come along.",
      n3: "Reply time: usually when it is seen, a day or two when things are busy.",
    },
  },
};

const $ = (id) => document.getElementById(id);
const state = { ready: false, siteKey: "", widgetId: null, sending: false, blocked: false, cfg: false };

function pack() {
  const lang = getLang() === "en" ? "en" : "zh";
  const base = COPY[lang];
  if (!state.ready) return base;
  return { ...base, ...base.form };
}

function text(id, value) {
  const node = $(id);
  if (node) node.textContent = value;
}

function paint() {
  const t = pack();
  document.title = t.title;
  const desc = document.querySelector('meta[name="description"]');
  if (desc) desc.setAttribute("content", t.desc);
  text("cEyebrow", t.eyebrow);
  text("cH1a", t.h1a);
  text("cH1b", t.h1b);
  text("cH1c", t.h1c);
  const lede = $("cLede");
  if (lede) {
    const safe = t.lede.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
    lede.innerHTML = safe
      .replaceAll("i@wi.fs.kg", "\u0000inbox\u0000")
      .replaceAll("wi.fs.kg", "<b>wi.fs.kg</b>")
      .replaceAll("\u0000inbox\u0000", "<b>i@wi.fs.kg</b>")
      .replaceAll("IP Lookup", "<b>IP Lookup</b>");
  }
  text("cNote1", t.n1);
  text("cNote2", t.n2);
  text("cNote3", t.n3);
  text("cMailK", t.mailK);
  text("cMailFine", t.mailFine);
  text("cTagsK", t.tagsK);
  text("cTagsFine", t.tagsFine);
  text("cTagWrong", t.wrong);
  text("cTagApi", t.api);
  text("cTagBug", t.bug);
  text("cTagOther", t.other);
  text("cNameK", t.name);
  text("cNameOpt", t.opt);
  text("cEmailK", t.email);
  text("cEmailReq", t.req);
  text("cMsgK", t.msg);
  text("cMsgReq", t.req);
  text("cHumanK", t.human);
  text("cHumanOpt", t.auto);
  text("cTsOff", t.tsOff);
  text("cConsent", t.consent);
  text("cDoneT", t.doneT);
  text("cDoneP1", t.doneP);
  text("cAgain", t.again);
  text("cPnHome", t.home);
  text("cPnHomeD", t.homeD);
  text("cPnFp", t.fp);
  text("cPnFpD", t.fpD);
  text("cPnCli", t.cli);
  text("cPnCliD", t.cliD);
  if ($("cName")) $("cName").placeholder = t.phName;
  if ($("cMsg")) $("cMsg").placeholder = t.phMsg;
  if ($("cSendTxt") && !state.sending) text("cSendTxt", t.send);
  const subject = encodeURIComponent(t.subject);
  const link = $("mailtoLink");
  if (link) link.href = `mailto:${INBOX}?subject=${subject}`;
  const hint = $("cHumanHint");
  if (hint) {
    if (state.blocked) hint.textContent = t.hintBlocked;
    else if (!state.cfg) hint.textContent = t.hintAuto;
    else if (!state.siteKey) hint.textContent = t.hintNoKey;
    else if (!state.ready) hint.textContent = t.hintNoMail;
    else hint.textContent = t.hintAuto;
  }
}

function showForm(on) {
  state.ready = on;
  $("cform").hidden = !on;
  $("mailtoCard").hidden = on;
  $("contactTags").hidden = !on;
  paint();
}

function setState(message, kind) {
  const node = $("cState");
  node.textContent = message || "";
  node.className = `cform-state${kind ? ` ${kind}` : ""}`;
}

function countUp() {
  const n = $("cMsg").value.length;
  $("cCount").textContent = `${n} / 5000`;
}

function widgetTheme() {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function renderWidget() {
  if (!state.siteKey || !window.turnstile) return false;
  if (state.widgetId != null) {
    try { window.turnstile.remove(state.widgetId); } catch { /* already gone */ }
    state.widgetId = null;
  }
  try {
    state.widgetId = window.turnstile.render("#tsWidget", {
      sitekey: state.siteKey,
      theme: widgetTheme(),
      language: getLang() === "en" ? "en" : "zh-cn",
    });
    $("tsSlot").classList.remove("is-off");
    $("tsFallback").hidden = true;
    state.blocked = false;
    return true;
  } catch {
    state.blocked = true;
    paint();
    return false;
  }
}

function loadTurnstile() {
  if (document.getElementById("cfTurnstile")) return;
  const script = document.createElement("script");
  script.id = "cfTurnstile";
  script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  script.async = true;
  script.onload = () => { renderWidget(); };
  document.head.appendChild(script);
}

function token() {
  const hidden = document.querySelector('[name="cf-turnstile-response"]');
  if (hidden?.value) return hidden.value;
  if (window.turnstile && state.widgetId != null) {
    try { return window.turnstile.getResponse(state.widgetId) || ""; } catch { return ""; }
  }
  return "";
}

$("cMsg").addEventListener("input", countUp);
countUp();
document.querySelectorAll(".ctag").forEach((button) => {
  button.addEventListener("click", () => {
    const tpl = pack().tpl[button.dataset.k] || "";
    const box = $("cMsg");
    box.value = (box.value ? `${box.value.replace(/\s*$/, "")}\n` : "") + tpl;
    countUp();
    box.focus();
  });
});

$("cform").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.sending) return;
  const t = pack();
  const email = $("cEmail").value.trim();
  const message = $("cMsg").value.trim();
  if (!/^[^\s@,;:<>()]+@[^\s@,;:<>()]+\.[^\s@,;:<>()]+$/.test(email)) {
    setState(t.err.INVALID_EMAIL, "err");
    return;
  }
  if ([...message].length < 5) { setState(t.err.MESSAGE_TOO_SHORT, "err"); return; }
  if ([...message].length > 5000) { setState(t.err.MESSAGE_TOO_LONG, "err"); return; }
  const turnstile = token();
  if (state.siteKey && !turnstile) {
    setState(state.blocked ? t.hintBlocked : t.err.TURNSTILE_REQUIRED, "err");
    return;
  }
  state.sending = true;
  $("cSend").disabled = true;
  text("cSendTxt", t.sending);
  setState(t.sending, "busy");
  try {
    const response = await fetch("/api/contact", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: $("cName").value.trim(),
        email,
        message,
        website: $("cSite").value,
        turnstile,
        page: `${location.pathname}${location.search}`,
        lang: getLang(),
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      const code = data.code || "NETWORK";
      setState(t.err[code] || t.err.SEND_FAILED, "err");
      return;
    }
    $("cDoneTo").textContent = email;
    $("cform").reset();
    countUp();
    setState("");
    $("cform").classList.add("is-done");
    $("cDone").hidden = false;
  } catch {
    setState(pack().err.NETWORK, "err");
  } finally {
    state.sending = false;
    $("cSend").disabled = false;
    text("cSendTxt", pack().send);
  }
});

$("cAgain").addEventListener("click", () => {
  $("cform").classList.remove("is-done");
  $("cDone").hidden = true;
  setState("");
  $("cName").focus();
});

function boot() {
  paint();
  applyDom(document);
  bindLangToggle();
}

onLang(() => { paint(); });
boot();

fetch("/api/contact/config").then((response) => response.json()).then((cfg) => {
  state.cfg = true;
  state.siteKey = cfg?.siteKey || "";
  showForm(Boolean(cfg?.ready));
  if (state.ready && state.siteKey) loadTurnstile();
  else paint();
}).catch(() => {
  state.cfg = true;
  showForm(false);
});

document.addEventListener("ip-theme", () => {
  if (state.widgetId != null) renderWidget();
});
