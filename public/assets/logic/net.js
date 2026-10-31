export const RISK_TIERS = [
  { max: 19, id: "home", label: "住宅 / 企业宽带" },
  { max: 39, id: "transit", label: "机房或骨干出口" },
  { max: 69, id: "cloud", label: "云主机 / 托管" },
  { max: 100, id: "proxy", label: "代理 / VPN 高概率" },
];

const PROXY_WORDS = [
  "vpn", "proxy", "tor exit", "tor-exit", "tunnelbear", "mullvad", "nordvpn",
  "expressvpn", "surfshark", "protonvpn", "ipvanish", "windscribe", "cyberghost",
  "hidemyass", "hide.me", "private internet access", "oxylabs", "brightdata",
  "bright data", "luminati", "smartproxy", "netnut", "geosurf", "iproyal",
  "rayobyte", "webshare", "anonymizer", "socks5", "residential proxy",
];

const CLOUD_WORDS = [
  "amazon", "amazonaws", "aws", "google", "gcp", "microsoft", "azure",
  "digitalocean", "linode", "akamai", "cloudflare", "fastly", "cloudfront",
  "hetzner", "ovh", "vultr", "oracle", "alibaba", "aliyun", "阿里云",
  "tencent", "腾讯云", "huawei cloud", "华为云", "ucloud", "qingcloud", "青云",
  "百度云", "leaseweb", "choopa", "contabo", "rackspace", "softlayer",
  "scaleway", "m247", "datacamp", "cdn77", "stackpath", "incapsula", "imperva",
  "gcore", "g-core", "constant.com", "psychz", "bunny", "cloud",
];

const HOST_WORDS = [
  "hosting", "hostinger", "bluehost", "godaddy", "datacenter", "data center",
  "datacentre", "data centre", "colocation", "dedicated", "vps", "idc", "机房",
];

const TRANSIT_WORDS = [
  "cogent", "level 3", "level3", "lumen", "zayo", "telia", "gtt",
  "hurricane", "pccw", "tata communications", "backbone", "transit",
  "centurylink", "global crossing",
];

const HOME_WORDS = [
  "chinanet", "china telecom", "china unicom", "china mobile", "中国电信",
  "中国联通", "中国移动", "中国广电", "cmcc", "cernet", "comcast", "charter",
  "spectrum", "verizon", "at&t", "deutsche telekom", "vodafone", "orange",
  "telstra", "optus", "docomo", "kddi", "softbank", "sk telecom", "broadband",
  "residential", "家宽", "宽带", "鹏博士", "长城宽带", "歌华", "fiber", "fibre",
  "dsl", "cable", "mobile", "wireless", "cellular", "rogers", "bell canada",
  "sky broadband",
];

// Used only when the provider did not give an organization name.
const ASN_HINTS = {
  13335: ["cloud", "Cloudflare"],
  15169: ["cloud", "Google"],
  396982: ["cloud", "Google Cloud"],
  16509: ["cloud", "Amazon"],
  14618: ["cloud", "Amazon"],
  8075: ["cloud", "Microsoft"],
  14061: ["cloud", "DigitalOcean"],
  16276: ["cloud", "OVH"],
  24940: ["cloud", "Hetzner"],
  20473: ["cloud", "Vultr"],
  63949: ["cloud", "Akamai"],
  20940: ["cloud", "Akamai"],
  54113: ["cloud", "Fastly"],
  37963: ["cloud", "Alibaba"],
  45102: ["cloud", "Alibaba"],
  132203: ["cloud", "Tencent"],
  45090: ["cloud", "Tencent"],
  4134: ["home", "Chinanet"],
  4812: ["home", "China Telecom"],
  4837: ["home", "China Unicom"],
  9808: ["home", "China Mobile"],
  4538: ["home", "CERNET"],
  7922: ["home", "Comcast"],
  7018: ["home", "AT&T"],
  3320: ["home", "Deutsche Telekom"],
};

const INFIX = new Set(["vpn", "proxy", "cloud"]);

export function isIPv4(value) {
  if (typeof value !== "string") return false;
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return false;
    if (Number(part) > 255) return false;
  }
  return true;
}

export function ipv4ToInt(ip) {
  if (!isIPv4(ip)) return null;
  return ip.split(".").reduce((total, part) => total * 256 + Number(part), 0);
}

export function intToIpv4(value) {
  const n = value >>> 0;
  return [24, 16, 8, 0].map((shift) => (n >>> shift) & 255).join(".");
}

export function parseIPv6(input) {
  if (typeof input !== "string") return null;
  let text = input.trim().toLowerCase();
  if (!text) return null;
  if (text.startsWith("[") && text.endsWith("]")) text = text.slice(1, -1);
  const dotted = text.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) {
    if (!isIPv4(dotted[2])) return null;
    const n = ipv4ToInt(dotted[2]);
    text = `${dotted[1]}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  if (text.includes(":::")) return null;
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if (halves.length === 1 && head.length !== 8) return null;
  if (halves.length === 2 && head.length + tail.length > 7) return null;
  const zeros = halves.length === 2 ? Array(8 - head.length - tail.length).fill("0") : [];
  const groups = [...head, ...zeros, ...tail];
  if (groups.length !== 8) return null;
  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    value = (value << 16n) + BigInt(Number.parseInt(group, 16));
  }
  return value;
}

export function formatIPv6(value) {
  if ((value >> 32n) === 0xffffn) return `::ffff:${intToIpv4(Number(value & 0xffffffffn))}`;
  const groups = [];
  for (let i = 0; i < 8; i += 1) {
    const shift = BigInt(112 - 16 * i);
    groups.push(Number((value >> shift) & 0xffffn).toString(16));
  }
  let bestStart = -1;
  let bestLen = 0;
  let index = 0;
  while (index < 8) {
    if (groups[index] !== "0") {
      index += 1;
      continue;
    }
    let end = index;
    while (end < 8 && groups[end] === "0") end += 1;
    if (end - index > bestLen) {
      bestStart = index;
      bestLen = end - index;
    }
    index = end;
  }
  if (bestLen < 2) return groups.join(":");
  const head = groups.slice(0, bestStart).join(":");
  const tail = groups.slice(bestStart + bestLen).join(":");
  if (!head && !tail) return "::";
  if (!head) return `::${tail}`;
  if (!tail) return `${head}::`;
  return `${head}::${tail}`;
}

export function expandIPv6(ip) {
  const value = parseIPv6(ip);
  if (value == null) return null;
  const groups = [];
  for (let i = 0; i < 8; i += 1) {
    const shift = BigInt(112 - 16 * i);
    groups.push(Number((value >> shift) & 0xffffn).toString(16).padStart(4, "0"));
  }
  return groups.join(":");
}

export function ipVersion(ip) {
  if (isIPv4(ip)) return 4;
  if (parseIPv6(ip) != null) return 6;
  return null;
}

function v4Mask(prefix) {
  if (prefix <= 0) return 0;
  if (prefix >= 32) return 0xffffffff;
  return (0xffffffff << (32 - prefix)) >>> 0;
}

function ipv4Cidr(ip, prefix) {
  const addressInt = ipv4ToInt(ip);
  const mask = v4Mask(prefix);
  const network = (addressInt & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  const total = 2 ** (32 - prefix);
  let first = network;
  let last = broadcast;
  let usable = total;
  let note = "已扣除网络地址与广播地址";
  if (prefix === 32) {
    first = network;
    last = network;
    usable = 1;
    note = "单主机 /32";
  } else if (prefix === 31) {
    first = network;
    last = broadcast;
    usable = 2;
    note = "/31 按 RFC 3021，两个地址都可用，不保留网络地址和广播地址";
  } else {
    first = (network + 1) >>> 0;
    last = (broadcast - 1) >>> 0;
    usable = total - 2;
  }
  const address = intToIpv4(addressInt);
  return {
    version: 4,
    address,
    prefix,
    input: `${address}/${prefix}`,
    network: intToIpv4(network),
    broadcast: intToIpv4(broadcast),
    netmask: intToIpv4(mask),
    wildcard: intToIpv4(~mask >>> 0),
    first: intToIpv4(first),
    last: intToIpv4(last),
    total,
    totalText: String(total),
    usable,
    usableText: String(usable),
    note,
  };
}

const V6_FULL = (1n << 128n) - 1n;

function v6Mask(prefix) {
  if (prefix <= 0) return 0n;
  if (prefix >= 128) return V6_FULL;
  const host = BigInt(128 - prefix);
  return (V6_FULL >> host) << host;
}

function ipv6Cidr(ip, prefix) {
  const addressInt = parseIPv6(ip);
  const mask = v6Mask(prefix);
  const network = addressInt & mask;
  const last = network | (V6_FULL ^ mask);
  const hostBits = 128 - prefix;
  const totalText = hostBits >= 32 ? `2^${hostBits}` : (1n << BigInt(hostBits)).toString();
  const address = formatIPv6(addressInt);
  return {
    version: 6,
    address,
    prefix,
    input: `${address}/${prefix}`,
    network: formatIPv6(network),
    broadcast: null,
    netmask: formatIPv6(mask),
    wildcard: formatIPv6(V6_FULL ^ mask),
    first: formatIPv6(network),
    last: formatIPv6(last),
    total: null,
    totalText,
    usable: null,
    usableText: totalText,
    note: prefix === 128 ? "单主机 /128" : "IPv6 不使用广播地址，整段都可以编号",
  };
}

export function parseCidr(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return { ok: false, error: "请输入网段，例如 192.168.1.0/24" };
  const slash = raw.lastIndexOf("/");
  let addr = raw;
  let prefix = null;
  if (slash !== -1) {
    addr = raw.slice(0, slash).trim();
    const bits = raw.slice(slash + 1).trim();
    if (!/^\d+$/.test(bits)) return { ok: false, error: "前缀长度必须是数字" };
    prefix = Number(bits);
  }
  if (addr.startsWith("[") && addr.endsWith("]")) addr = addr.slice(1, -1);
  if (isIPv4(addr)) {
    const bits = prefix == null ? 32 : prefix;
    if (bits < 0 || bits > 32) return { ok: false, error: "IPv4 前缀长度要在 0 到 32 之间" };
    return { ok: true, ...ipv4Cidr(addr, bits) };
  }
  if (parseIPv6(addr) != null) {
    const bits = prefix == null ? 128 : prefix;
    if (bits < 0 || bits > 128) return { ok: false, error: "IPv6 前缀长度要在 0 到 128 之间" };
    return { ok: true, ...ipv6Cidr(addr, bits) };
  }
  return { ok: false, error: "无法识别这个地址" };
}

export function containingNetwork(ip) {
  if (isIPv4(ip)) return `${intToIpv4(ipv4ToInt(ip) & 0xffffff00)}/24`;
  const value = parseIPv6(ip);
  if (value == null) return null;
  const mask = v6Mask(64);
  return `${formatIPv6(value & mask)}/64`;
}

export function ptrName(ip) {
  if (isIPv4(ip)) return `${ip.split(".").reverse().join(".")}.in-addr.arpa`;
  const value = parseIPv6(ip);
  if (value == null) return null;
  const nibbles = value.toString(16).padStart(32, "0").split("").reverse().join(".");
  return `${nibbles}.ip6.arpa`;
}

function isNonPublicV4(n) {
  const inNet = (base, bits) => {
    const mask = v4Mask(bits);
    return ((n >>> 0) & mask) === ((base >>> 0) & mask);
  };
  return (
    inNet(ipv4ToInt("0.0.0.0"), 8) ||
    inNet(ipv4ToInt("10.0.0.0"), 8) ||
    inNet(ipv4ToInt("127.0.0.0"), 8) ||
    inNet(ipv4ToInt("169.254.0.0"), 16) ||
    inNet(ipv4ToInt("172.16.0.0"), 12) ||
    inNet(ipv4ToInt("192.168.0.0"), 16) ||
    inNet(ipv4ToInt("100.64.0.0"), 10) ||
    inNet(ipv4ToInt("224.0.0.0"), 4) ||
    inNet(ipv4ToInt("240.0.0.0"), 4)
  );
}

export function isNonPublic(ip) {
  if (isIPv4(ip)) return isNonPublicV4(ipv4ToInt(ip));
  const value = parseIPv6(ip);
  if (value == null) return true;
  if ((value >> 32n) === 0xffffn) return isNonPublicV4(Number(value & 0xffffffffn));
  if (value === 0n || value === 1n) return true;
  const b0 = Number((value >> 120n) & 0xffn);
  const b1 = Number((value >> 112n) & 0xffn);
  if ((b0 & 0xfe) === 0xfc) return true;
  if (b0 === 0xfe && (b1 & 0xc0) === 0x80) return true;
  return false;
}

export function parseTarget(raw) {
  const original = String(raw ?? "").trim().replace(/^['"]|['"]$/g, "");
  if (!original) return { error: "请输入 IP 或域名" };
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(original) || original.startsWith("//");
  if (!hasScheme && original.includes("/")) {
    const cidr = parseCidr(original);
    if (cidr.ok) {
      return { kind: "ip", ip: cidr.address, version: cidr.version, cidr: cidr.input };
    }
  }
  let text = original;
  if (hasScheme) {
    try {
      const url = new URL(original.startsWith("//") ? `https:${original}` : original);
      text = url.hostname;
    } catch {
      return { error: "无法解析这个地址" };
    }
  } else {
    text = text.split(/[/?#]/)[0].trim();
    const bracket = text.match(/^\[([^\]]+)\](?::\d+)?$/);
    if (bracket) text = bracket[1];
    else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(text)) text = text.replace(/:\d+$/, "");
    else if (!text.includes(":") && /:\d+$/.test(text)) text = text.replace(/:\d+$/, "");
  }
  text = text.replace(/\.$/, "");
  if (isIPv4(text)) return { kind: "ip", ip: text, version: 4 };
  const v6 = parseIPv6(text);
  if (v6 != null) return { kind: "ip", ip: formatIPv6(v6), version: 6 };
  let host = text;
  try {
    host = new URL(`http://${text}`).hostname;
  } catch {
    return { error: "域名格式不正确" };
  }
  host = host.replace(/\.$/, "").toLowerCase();
  if (!host.includes(".")) return { error: "请输入完整域名" };
  if (
    !/^[a-z0-9._-]+$/.test(host) ||
    host.includes("..") ||
    host.startsWith(".") ||
    host.endsWith(".") ||
    host.startsWith("-") ||
    host.endsWith("-")
  ) {
    return { error: "域名格式不正确" };
  }
  return { kind: "domain", domain: host };
}

export function splitTargets(text, limit = 20) {
  const parts = String(text ?? "")
    .split(/[\s,，;；]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const items = [];
  const seen = new Set();
  for (const part of parts) {
    const key = part.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(part);
  }
  return { items: items.slice(0, limit), truncated: items.length > limit, total: items.length };
}

function matches(text, keyword) {
  const needle = keyword.toLowerCase();
  if (INFIX.has(needle) || /[\u4e00-\u9fff]/.test(needle) || needle.length >= 5) {
    return text.includes(needle);
  }
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, "i").test(text);
}

function findKeyword(text, words) {
  return words.find((word) => matches(text, word)) || null;
}

export function tierFor(score) {
  return RISK_TIERS.find((tier) => score <= tier.max) || RISK_TIERS[RISK_TIERS.length - 1];
}

function finish(score, reasons) {
  const tier = tierFor(score);
  return { score, reasons, tier: tier.id, label: tier.label };
}

export function assessRisk(input = {}) {
  if (input.local) return finish(5, ["这是私网、回环或未指定地址，没有公网归属地"]);
  const text = `${input.org || ""} ${input.isp || ""}`.toLowerCase();
  const proxy = text.trim() ? findKeyword(text, PROXY_WORDS) : null;
  if (proxy) return finish(84, [`名称命中「${proxy}」，更像代理或 VPN 出口`]);
  const cloud = text.trim() ? findKeyword(text, CLOUD_WORDS) : null;
  if (cloud) return finish(56, [`名称命中「${cloud}」，更像云厂商、CDN 或云主机`]);
  const host = text.trim() ? findKeyword(text, HOST_WORDS) : null;
  if (host) return finish(48, [`名称命中「${host}」，更像托管或机房`]);
  const transit = text.trim() ? findKeyword(text, TRANSIT_WORDS) : null;
  if (transit) return finish(30, [`名称命中「${transit}」，更像骨干或中转网络`]);
  const home = text.trim() ? findKeyword(text, HOME_WORDS) : null;
  if (home) return finish(8, [`名称命中「${home}」，更像住宅宽带或移动网络`]);
  const hint = ASN_HINTS[Number(input.asn)];
  if (hint) {
    const [kind, name] = hint;
    if (kind === "cloud") return finish(56, [`ASN ${Number(input.asn)} 是 ${name}`]);
    return finish(8, [`ASN ${Number(input.asn)} 是 ${name}`]);
  }
  if (!text.trim()) return finish(14, ["没有运营商名称，只能按偏低的默认分估计"]);
  return finish(14, ["没有命中云、代理或住宅关键词"]);
}
