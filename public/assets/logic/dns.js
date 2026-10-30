import { isIPv4, parseIPv6, ptrName } from "./net.js";

const RESOLVERS = [
  {
    id: "google",
    url: (name, type) => `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`,
  },
  {
    id: "cloudflare",
    url: (name, type) => `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`,
    headers: { accept: "application/dns-json" },
  },
  {
    id: "alidns",
    url: (name, type) => `https://dns.alidns.com/resolve?name=${encodeURIComponent(name)}&type=${type}`,
  },
  {
    id: "dnspod",
    url: (name, type) => `https://doh.pub/dns-query?name=${encodeURIComponent(name)}&type=${type}`,
    headers: { accept: "application/dns-json" },
  },
];

const TYPE_NAME = {
  1: "A",
  2: "NS",
  5: "CNAME",
  12: "PTR",
  15: "MX",
  16: "TXT",
  28: "AAAA",
  257: "CAA",
};

export function decodeTxt(data) {
  const parts = [];
  const re = /"((?:\\.|[^"\\])*)"/g;
  let match = re.exec(String(data ?? ""));
  while (match) {
    parts.push(match[1].replace(/\\(.)/g, "$1"));
    match = re.exec(String(data ?? ""));
  }
  if (parts.length) return parts.join("");
  return String(data ?? "").replace(/^"|"$/g, "");
}

function normalizeRow(row) {
  const type = Number(row.type);
  const raw = String(row.data ?? "");
  let text = raw;
  if (type === 16) text = decodeTxt(raw);
  else if (type === 15) {
    const mx = raw.match(/^(\d+)\s+(\S+)$/);
    if (!mx) text = raw;
    else if (mx[2] === ".") text = `${mx[1]} .`;
    else text = `${mx[1]} ${mx[2].replace(/\.$/, "")}`;
  } else if (type === 2 || type === 5 || type === 12) text = raw.replace(/\.$/, "");
  else if (type === 257) text = raw.replace(/"/g, "");
  return {
    type,
    typeName: TYPE_NAME[type] || String(type),
    name: String(row.name || "").replace(/\.$/, ""),
    ttl: Number(row.TTL ?? row.ttl ?? 0),
    text,
  };
}

function rowsFrom(json, typeNum) {
  const answer = Array.isArray(json?.Answer) ? json.Answer : [];
  const authority = typeNum === 2 && Array.isArray(json?.Authority) ? json.Authority : [];
  return [...answer, ...authority]
    .filter((row) => {
      const type = Number(row.type);
      if (type === typeNum) return true;
      return (typeNum === 1 || typeNum === 28) && type === 5;
    })
    .map(normalizeRow);
}

function scoreOf(json, typeNum) {
  if (!json || typeof json.Status !== "number" || json.Status !== 0) return -1;
  const exact = rowsFrom(json, typeNum).filter((row) => row.type === typeNum);
  if (typeNum === 16) {
    const length = exact.reduce((total, row) => total + row.text.length, 0);
    return exact.length * 100000 + length;
  }
  return exact.length;
}

function anySignal(signals) {
  const controller = new AbortController();
  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) {
      controller.abort();
      return controller.signal;
    }
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return controller.signal;
}

export async function resolveType(name, typeName, typeNum, options = {}) {
  if (options.signal?.aborted) return { records: [], source: null, error: true };
  const fetchImpl = options.fetchImpl || fetch;
  const timeout = AbortSignal.timeout(options.timeoutMs || 5000);
  const signal = anySignal([options.signal, timeout]);
  const results = await Promise.all(
    RESOLVERS.map(async (resolver) => {
      try {
        const response = await fetchImpl(resolver.url(name, typeName), {
          headers: resolver.headers,
          signal,
          cache: "no-store",
        });
        if (!response.ok) return null;
        return { source: resolver.id, json: await response.json() };
      } catch {
        return null;
      }
    }),
  );
  let best = null;
  for (const item of results) {
    if (!item) continue;
    const score = scoreOf(item.json, typeNum);
    if (!best || score > best.score) best = { ...item, score };
  }
  if (!best || best.score < 0) return { records: [], source: null, error: true };
  return { records: rowsFrom(best.json, typeNum), source: best.source, error: false };
}

export async function lookupDns(domain, options = {}) {
  const jobs = [
    ["A", domain, "A", 1],
    ["AAAA", domain, "AAAA", 28],
    ["MX", domain, "MX", 15],
    ["TXT", domain, "TXT", 16],
    ["NS", domain, "NS", 2],
    ["CAA", domain, "CAA", 257],
    ["DMARC", `_dmarc.${domain}`, "TXT", 16],
  ];
  const entries = await Promise.all(
    jobs.map(async ([key, name, typeName, typeNum]) => [key, await resolveType(name, typeName, typeNum, options)]),
  );
  return Object.fromEntries(entries);
}

export function addressesOf(dns) {
  const ips = [];
  for (const key of ["A", "AAAA"]) {
    for (const row of dns?.[key]?.records || []) {
      if (row.type === 1 || row.type === 28) ips.push(row.text);
    }
  }
  return [...new Set(ips)];
}

export async function lookupPtr(ip, options = {}) {
  if (!isIPv4(ip) && parseIPv6(ip) == null) return null;
  const name = ptrName(ip);
  const found = await resolveType(name, "PTR", 12, options);
  const row = found.records.find((item) => item.type === 12);
  return row ? row.text : null;
}

function truncate(value, max = 220) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function summarizeMail({ txt = [], dmarc = [], mx = [] } = {}) {
  const txts = txt.map((row) => row.text).filter(Boolean);
  const spfs = txts.filter((item) => /^v=spf1\b/i.test(item.trim()));
  const dmarcs = dmarc.map((row) => row.text).filter((item) => /^v=dmarc1\b/i.test(item.trim()));
  const findings = [];

  if (spfs.length === 0) {
    findings.push({ level: "warn", title: "没有 SPF", detail: "TXT 里没有 v=spf1，别人可能伪造这个域名发信。" });
  } else {
    if (spfs.length > 1) {
      findings.push({ level: "bad", title: "SPF 重复", detail: "有多条 SPF，收信方可能直接判不合规。" });
    }
    const spf = spfs[0];
    const all = spf.match(/(?:^|\s)([+\-~?])?all(?:\s|$)/i);
    if (!all) {
      findings.push({ level: "info", title: "SPF 未写 all", detail: `记录存在，但没有 all 机制。${truncate(spf)}` });
    } else if (all[1] === "-") {
      findings.push({ level: "ok", title: "SPF -all", detail: "未授权来源会被拒绝。" });
    } else if (all[1] === "~") {
      findings.push({ level: "warn", title: "SPF ~all", detail: "未授权来源只是软失败，通常只会被标记。" });
    } else if (all[1] === "?") {
      findings.push({ level: "warn", title: "SPF ?all", detail: "中性结果，没有明确拒绝。" });
    } else {
      findings.push({ level: "bad", title: "SPF +all", detail: "几乎允许任何人用这个域名发信。" });
    }
  }

  if (dmarcs.length === 0) {
    findings.push({ level: "warn", title: "没有 DMARC", detail: "_dmarc 上没有 v=DMARC1，收信方缺少域名策略。" });
  } else {
    const policy = dmarcs[0].match(/\bp\s*=\s*(reject|quarantine|none)\b/i);
    if (!policy) {
      findings.push({ level: "warn", title: "DMARC 无策略", detail: "有记录，但没有读到 p=。" });
    } else if (policy[1].toLowerCase() === "reject") {
      findings.push({ level: "ok", title: "DMARC reject", detail: "未通过校验的邮件应被拒绝。" });
    } else if (policy[1].toLowerCase() === "quarantine") {
      findings.push({ level: "ok", title: "DMARC quarantine", detail: "未通过校验的邮件应被隔离。" });
    } else {
      findings.push({ level: "warn", title: "DMARC none", detail: "只监测，不拦截伪造邮件。" });
    }
  }

  const nullMx = mx.length > 0 && mx.every((row) => String(row.text).trim() === "0 .");
  if (mx.length === 0) {
    findings.push({ level: "info", title: "没有 MX", detail: "这个域名可能不接收邮件。" });
  } else if (nullMx) {
    findings.push({ level: "info", title: "空 MX", detail: "MX 是 0 .，这个域名明确表示不收信。" });
  } else {
    findings.push({ level: "ok", title: "有 MX", detail: mx.map((row) => row.text).join("、") });
  }

  return { findings, spf: spfs[0] || "", dmarc: dmarcs[0] || "" };
}
