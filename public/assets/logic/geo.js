import { isNonPublic } from "./net.js";

export const SOURCE_LABELS = {
  edge: "边缘节点",
  "ipwho.is": "ipwho.is",
  "ip.sb": "ip.sb",
  geojs: "geojs.io",
  "ipapi.co": "ipapi.co",
  local: "本地识别",
};

export function sourceLabel(id) {
  return SOURCE_LABELS[id] || id || "未知";
}

function text(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

function cleanNum(value, max) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string" && /^(nil|null|none|n\/a)$/i.test(value.trim())) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || Math.abs(n) > max) return null;
  return n;
}

function cleanAsn(value) {
  if (value === undefined || value === null || value === "") return null;
  const match = String(value).match(/\d+/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isInteger(n) ? n : null;
}

function blankRecord(partial) {
  const ip = text(partial.ip);
  let type = text(partial.type);
  if (type === "4" || type === "v4") type = "IPv4";
  if (type === "6" || type === "v6") type = "IPv6";
  if (type && !/^IPv[46]$/i.test(type) && ip) type = ip.includes(":") ? "IPv6" : "IPv4";
  if (type) type = type.toUpperCase() === "IPV6" ? "IPv6" : type.toUpperCase() === "IPV4" ? "IPv4" : type;
  if (!type && ip) type = ip.includes(":") ? "IPv6" : "IPv4";
  return {
    ip,
    type,
    asn: partial.asn ?? null,
    org: text(partial.org),
    isp: text(partial.isp),
    city: text(partial.city),
    region: text(partial.region),
    country: text(partial.country),
    country_code: text(partial.country_code)?.toUpperCase() || null,
    continent: text(partial.continent)?.toUpperCase() || null,
    latitude: partial.latitude ?? null,
    longitude: partial.longitude ?? null,
    postal: text(partial.postal),
    timezone: text(partial.timezone),
  };
}

export function hasGeoSignal(record) {
  if (!record) return false;
  return Boolean(
    record.country_code || record.country || record.city || record.asn || record.org || record.isp || record.region,
  );
}

function mapIpwho(data) {
  if (!data || data.success === false) return null;
  const connection = data.connection || {};
  const zone = data.timezone && typeof data.timezone === "object" ? data.timezone.id : data.timezone;
  return blankRecord({
    ip: data.ip,
    type: data.type,
    asn: cleanAsn(connection.asn),
    org: connection.org,
    isp: connection.isp,
    city: data.city,
    region: data.region,
    country: data.country,
    country_code: data.country_code,
    continent: data.continent_code,
    latitude: cleanNum(data.latitude, 90),
    longitude: cleanNum(data.longitude, 180),
    postal: data.postal,
    timezone: zone,
  });
}

function mapIpSb(data) {
  if (!data || data.error) return null;
  return blankRecord({
    ip: data.ip,
    asn: cleanAsn(data.asn),
    org: data.asn_organization || data.organization,
    isp: data.isp || data.organization,
    city: data.city,
    region: data.region,
    country: data.country,
    country_code: data.country_code,
    continent: data.continent_code,
    latitude: cleanNum(data.latitude, 90),
    longitude: cleanNum(data.longitude, 180),
    timezone: data.timezone,
  });
}

function mapGeoJs(data) {
  if (!data || data.error) return null;
  return blankRecord({
    ip: data.ip,
    asn: cleanAsn(data.asn ?? data.organization),
    org: data.organization_name || data.organization,
    isp: data.organization_name || null,
    city: data.city,
    region: data.region,
    country: data.country,
    country_code: data.country_code,
    continent: data.continent_code,
    latitude: cleanNum(data.latitude, 90),
    longitude: cleanNum(data.longitude, 180),
    timezone: data.timezone,
  });
}

function mapIpApi(data) {
  if (!data || data.error) return null;
  const countryCode = data.country_code || (String(data.country || "").length === 2 ? data.country : null);
  return blankRecord({
    ip: data.ip,
    type: data.version,
    asn: cleanAsn(data.asn),
    org: data.org,
    isp: null,
    city: data.city,
    region: data.region,
    country: data.country_name || data.country,
    country_code: countryCode,
    continent: data.continent_code,
    latitude: cleanNum(data.latitude, 90),
    longitude: cleanNum(data.longitude, 180),
    postal: data.postal,
    timezone: data.timezone,
  });
}

export const PROVIDERS = [
  {
    id: "ipwho.is",
    url(ip) {
      return ip ? `https://ipwho.is/${encodeURIComponent(ip)}` : "https://ipwho.is/";
    },
    map: mapIpwho,
  },
  {
    id: "ip.sb",
    url(ip) {
      return ip ? `https://api.ip.sb/geoip/${encodeURIComponent(ip)}` : "https://api.ip.sb/geoip";
    },
    map: mapIpSb,
  },
  {
    id: "geojs",
    url(ip) {
      return ip
        ? `https://get.geojs.io/v1/ip/geo/${encodeURIComponent(ip)}.json`
        : "https://get.geojs.io/v1/ip/geo.json";
    },
    map: mapGeoJs,
  },
  {
    id: "ipapi.co",
    url(ip) {
      return ip ? `https://ipapi.co/${encodeURIComponent(ip)}/json/` : "https://ipapi.co/json/";
    },
    map: mapIpApi,
  },
];

function reasonFrom(response, data) {
  if (!response) return "无响应";
  if (response.status === 429 || response.status === 403 || response.status === 402) return "限流";
  if (!response.ok) return `HTTP ${response.status}`;
  if (!data) return "空响应";
  if (data.success === false) return "拒绝";
  const blob = typeof data.message === "string" ? data.message : JSON.stringify(data);
  if (data.error && /limit|quota|rate/i.test(blob)) return "限流";
  if (data.error) return "错误";
  if (typeof data.message === "string" && /limit|quota|rate/i.test(data.message)) return "限流";
  return "无有效字段";
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

export function recordFromEdge(data) {
  if (!data || typeof data !== "object") return null;
  const record = blankRecord({
    ip: data.ip,
    type: data.type,
    asn: cleanAsn(data.asn),
    org: data.org,
    isp: data.isp,
    city: data.city,
    region: data.region,
    country: data.country && String(data.country).length === 2 ? null : data.country,
    country_code: data.country_code || data.country,
    continent: data.continent,
    latitude: cleanNum(data.latitude, 90),
    longitude: cleanNum(data.longitude, 180),
    postal: data.postal,
    timezone: data.timezone,
  });
  record.colo = text(data.colo);
  record.tlsVersion = text(data.tlsVersion);
  record.tlsCipher = text(data.tlsCipher);
  record.httpProtocol = text(data.httpProtocol);
  record.edge = true;
  return record;
}

export function edgeUsable(data) {
  if (!data?.ip || isNonPublic(data.ip)) return false;
  return hasGeoSignal(recordFromEdge(data));
}

export async function lookupGeo(ip, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const skipped = [];
  for (const provider of PROVIDERS) {
    if (options.signal?.aborted) return null;
    const timeout = AbortSignal.timeout(options.timeoutMs || 5000);
    const signal = anySignal([options.signal, timeout]);
    try {
      const response = await fetchImpl(provider.url(ip || null), {
        signal,
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      let data = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }
      if (Array.isArray(data)) data = data[0];
      const record = data ? provider.map(data) : null;
      if (response.ok && record && hasGeoSignal(record)) {
        if (ip && !record.ip) record.ip = ip;
        return { record, source: provider.id, skipped };
      }
      skipped.push({ id: provider.id, reason: reasonFrom(response, data) });
    } catch {
      if (options.signal?.aborted) return null;
      skipped.push({ id: provider.id, reason: signal.aborted ? "超时" : "无响应" });
    }
  }
  return { record: null, source: null, skipped };
}
