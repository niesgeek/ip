import {
  collectProbes,
  directoryFromOutstanding,
  packProtocol,
  parseAntifloodCookie,
  parsePingPeDirectory,
  parsePingPeTask,
} from "../../public/assets/logic/reach.js";

// port.ping.pe does not send CORS headers, and the start token is bound to the
// IP that loaded the page. Fetching the page and posting the start back to the
// same host lets the runtime reuse that connection.
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const DEFAULT_COOKIE = "antiflood=302f662b44e592d9b78e46b19b2073c2";
const HOST = "https://tcp.ping.pe";

export function tcpPageUrl(ip, port) {
  if (String(ip).includes(":")) return `${HOST}/[${ip}]:${port}`;
  return `${HOST}/${ip}:${port}`;
}

function sleepDefault(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timeoutSignal(ms) {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  return undefined;
}

async function requestText(fetchImpl, url, { method = "GET", headers, body, timeoutMs = 12000 } = {}) {
  const response = await fetchImpl(url, {
    method,
    headers,
    body,
    redirect: method === "POST" ? "manual" : "follow",
    signal: timeoutSignal(timeoutMs),
  });
  const text = await response.text();
  if (text.length > 2_000_000) throw new Error("探测页过大");
  return text;
}

function htmlHeaders(cookie) {
  return { "user-agent": UA, accept: "text/html", cookie };
}

async function loadPage(fetchImpl, url, cookie) {
  let currentCookie = cookie;
  let html = await requestText(fetchImpl, url, { headers: htmlHeaders(currentCookie) });
  let task = parsePingPeTask(html);
  if (!task) {
    const fresh = parseAntifloodCookie(html);
    if (fresh) currentCookie = fresh;
    const retryUrl = url.includes("?") ? `${url}&browsercheck=ok` : `${url}?browsercheck=ok`;
    html = await requestText(fetchImpl, retryUrl, { headers: htmlHeaders(currentCookie) });
    task = parsePingPeTask(html);
  }
  return { html, task, cookie: currentCookie, pageUrl: url };
}

function failureMessage(payload) {
  const raw = String(payload?.error || "");
  if (payload?.error_code === "too_many_active_tasks" || /too many/i.test(raw)) {
    return { error: "探测节点正忙，请稍等一会儿再试", retry: false };
  }
  if (/token/i.test(raw)) return { error: "探测服务没有接上，请再试一次", retry: true };
  return { error: "探测没有启动", retry: false };
}

async function beginTask(fetchImpl, loaded) {
  const body = new URLSearchParams({
    query: loaded.task.query,
    start_token: loaded.task.token,
  });
  const text = await requestText(fetchImpl, `${HOST}/ajax_startTask_v1.php`, {
    method: "POST",
    headers: {
      "user-agent": UA,
      accept: "application/json, text/javascript, */*; q=0.01",
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      origin: HOST,
      referer: loaded.pageUrl,
      cookie: loaded.cookie,
      "x-requested-with": "XMLHttpRequest",
    },
    body,
  });
  let payload = null;
  try { payload = JSON.parse(text); } catch { payload = null; }
  const streamId = payload?.data?.stream_id != null ? String(payload.data.stream_id) : "";
  if (payload?.ok && /^\d+$/.test(streamId)) {
    return { streamId, interval: Number(payload.data.interval_s) || loaded.task.interval || 3 };
  }
  return failureMessage(payload);
}

async function pollTask(fetchImpl, loaded, started, options) {
  const directory = parsePingPeDirectory(loaded.html);
  const items = [];
  const wait = Math.min(4000, Math.max(1200, Math.round((started.interval || 3) * 1100)));
  const deadline = Date.now() + (options.budgetMs ?? 14000);
  const polls = options.maxPolls ?? 3;
  for (let i = 0; i < polls; i += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0 && i > 0) break;
    await options.sleep(Math.min(wait, Math.max(0, remaining)));
    let payload = null;
    try {
      const text = await requestText(
        fetchImpl,
        `${HOST}/ajax_getPingResults_v2.php?type=tcp&totalPolls=${i}&stream_id=${started.streamId}`,
        {
          headers: {
            "user-agent": UA,
            accept: "application/json, text/javascript, */*; q=0.01",
            referer: loaded.pageUrl,
            cookie: loaded.cookie,
            "x-requested-with": "XMLHttpRequest",
          },
          timeoutMs: 10000,
        },
      );
      payload = JSON.parse(text);
    } catch {
      continue;
    }
    directoryFromOutstanding(payload?.state, directory);
    if (Array.isArray(payload?.data)) items.push(...payload.data);
    const packed = packProtocol(collectProbes("tcp", items, directory), "ping.pe");
    const outstanding = Number(payload?.state?.outstandingNodeCount ?? 999);
    const enough = packed.domestic.total >= 3 && packed.overseas.total >= 4;
    if (outstanding === 0 && packed.domestic.total + packed.overseas.total > 0) break;
    if (enough && outstanding <= 25) break;
  }
  return collectProbes("tcp", items, directory);
}

async function stopTask(fetchImpl, streamId, cookie) {
  if (!/^\d+$/.test(String(streamId || ""))) return;
  await requestText(fetchImpl, `${HOST}/ajax_stopTask.php?stream_id=${streamId}`, {
    headers: { "user-agent": UA, accept: "*/*", cookie },
    timeoutMs: 8000,
  });
}

export async function fetchTcpProbes(ip, port, deps = {}) {
  const fetchImpl = deps.fetch || fetch;
  const sleep = deps.sleep || sleepDefault;
  let cookie = DEFAULT_COOKIE;
  let lastError = "探测没有启动";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const loaded = await loadPage(fetchImpl, tcpPageUrl(ip, port), cookie);
    cookie = loaded.cookie || cookie;
    if (!loaded.task) {
      lastError = "探测页没有准备好，请稍后再试";
      continue;
    }
    const started = await beginTask(fetchImpl, loaded);
    if (!started.streamId) {
      lastError = started.error || lastError;
      if (!started.retry) return { error: lastError };
      continue;
    }
    try {
      const probes = await pollTask(fetchImpl, loaded, started, {
        sleep,
        maxPolls: deps.maxPolls,
        budgetMs: deps.budgetMs,
      });
      return { probes };
    } catch {
      return { error: "探测结果没有读完，请稍后再试" };
    } finally {
      try { await stopTask(fetchImpl, started.streamId, loaded.cookie); } catch { /* result already in hand */ }
    }
  }
  return { error: lastError };
}
