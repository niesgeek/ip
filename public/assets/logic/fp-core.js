/**
 * Pure helpers for the local fingerprint page.
 * Browser probes live in fingerprint.js. Nothing here touches the DOM,
 * storage, or the network.
 */

export const GROUPS = [
  { id: "identity", name: "身份与客户端提示", blurb: "浏览器自称的产品串，以及 Client Hints" },
  { id: "locale", name: "语言与时区", blurb: "语言顺序、时区名和数字格式" },
  { id: "screen", name: "屏幕与媒体", blurb: "分辨率、像素比和 CSS 媒体特征" },
  { id: "device", name: "硬件与能力", blurb: "核心数、触控、存储和接口是否存在" },
  { id: "render", name: "渲染测量", blurb: "画布、WebGL、音频、字体和布局" },
  { id: "network", name: "连接回执", blurb: "同源接口读到的 TLS、线路和请求头" },
];

/** Local entropy weights. They are guesses for the estimate, not measured visitor stats. */
export const SIGNALS = [
  { id: "ua", group: "identity", bits: 6, name: "User-Agent", note: "页面脚本读到的产品串。它和请求头里的客户端提示应当能对上。" },
  { id: "platform", group: "identity", bits: 2, name: "navigator.platform", note: "老字段。各家浏览器已经把它冻成少数几个固定值。" },
  { id: "vendor", group: "identity", bits: 2, name: "navigator.vendor", note: "有的内核会留空。留空本身也是一种读数，不是故障。" },
  { id: "app-version", group: "identity", bits: 2, name: "navigator.appVersion", note: "通常和 User-Agent 同源。单独看意义不大，和 User-Agent 对不上才值得注意。" },
  { id: "product", group: "identity", bits: 1, name: "navigator.product", note: "历史字段，很多内核一直填同一个词。" },
  { id: "ua-brands", group: "identity", bits: 4, name: "客户端提示 · 品牌", note: "低熵品牌列表。Firefox 和 Safari 通常不提供这个接口。" },
  { id: "ua-platform", group: "identity", bits: 3, name: "客户端提示 · 平台", note: "低熵平台名，和 navigator.platform 不是同一个字段。" },
  { id: "ua-mobile", group: "identity", bits: 1, name: "客户端提示 · 移动端", note: "浏览器说自己是不是手机。和触控点数打架时值得看一眼。" },
  { id: "ua-full", group: "identity", bits: 4, name: "客户端提示 · 完整版本", note: "高熵版本号。浏览器可以拒绝，拒绝会标成被拦住。" },
  { id: "ua-platform-version", group: "identity", bits: 3, name: "客户端提示 · 平台版本", note: "操作系统版本。不是所有浏览器都给。" },
  { id: "ua-arch", group: "identity", bits: 2, name: "客户端提示 · 架构与位宽", note: "例如 x86 或 arm，以及 32 / 64 位。" },
  { id: "ua-model", group: "identity", bits: 2, name: "客户端提示 · 设备型号", note: "桌面端经常是空的。空着会标成未提供。" },
  { id: "ua-form", group: "identity", bits: 1, name: "客户端提示 · 设备形态", note: "较新的接口才会给，例如桌面、平板。" },
  { id: "lang", group: "locale", bits: 3, name: "首选语言", note: "navigator.language，一般是语言列表的第一项。" },
  { id: "langs", group: "locale", bits: 3, name: "语言偏好顺序", note: "完整列表比单个语言标签更能分开不同的设置。" },
  { id: "tz", group: "locale", bits: 4, name: "IANA 时区", note: "来自系统时区。换了出口 IP 也不一定会跟着变。" },
  { id: "tz-offset", group: "locale", bits: 2, name: "UTC 偏移", note: "当前偏移，含夏令时。应当和时区名对得上。" },
  { id: "intl", group: "locale", bits: 2, name: "区域解析选项", note: "日历、数字系统和小时制，来自系统区域设置。" },
  { id: "locale-format", group: "locale", bits: 2, name: "数字与日期格式", note: "用一个固定的时刻格式化，避免「今天」每天把指纹 ID 改掉。" },
  { id: "screen", group: "screen", bits: 4, name: "屏幕分辨率", note: "CSS 像素。物理像素还要乘下面的设备像素比。" },
  { id: "avail", group: "screen", bits: 2, name: "可用屏幕", note: "扣掉任务栏或菜单栏之后的尺寸。" },
  { id: "dpr", group: "screen", bits: 2, name: "设备像素比", note: "和系统缩放有关。显示保留两位，参与 ID 的是浏览器给的原值。" },
  { id: "depth", group: "screen", bits: 1, name: "色深", note: "多数设备都是 24 或 32，区分度本来就低。" },
  { id: "viewport", group: "screen", bits: 2, name: "视口 / 窗口", note: "拖动窗口就会变，所以是易变项，不进入指纹 ID。" },
  { id: "orientation", group: "screen", bits: 1, name: "屏幕方向", note: "桌面浏览器大多一直是横屏。" },
  { id: "extended", group: "screen", bits: 1, name: "是否多屏", note: "只说明有没有扩展屏，不给出每块屏的内容。" },
  { id: "scheme", group: "screen", bits: 1, name: "深色 / 浅色", note: "系统的颜色方案偏好。" },
  { id: "contrast", group: "screen", bits: 1, name: "对比度偏好", note: "多数人是默认。调高对比度的人会不一样。" },
  { id: "motion", group: "screen", bits: 1, name: "减少动效", note: "系统是否要求减少动画。" },
  { id: "pointer", group: "screen", bits: 2, name: "主指针", note: "fine 多半是鼠标，coarse 多半是手指。" },
  { id: "hover", group: "screen", bits: 1, name: "能否悬停", note: "有没有能悬停的指针。" },
  { id: "gamut", group: "screen", bits: 2, name: "色域", note: "屏幕大致落在 sRGB、P3 还是更广的色域。" },
  { id: "forced", group: "screen", bits: 1, name: "强制配色", note: "系统高对比度模式打开时才会是 active。" },
  { id: "display-mode", group: "screen", bits: 1, name: "显示模式", note: "普通标签页一般是 browser。装到桌面的应用可能是 standalone。" },
  { id: "cores", group: "device", bits: 2, name: "逻辑处理器数", note: "hardwareConcurrency。有的隐私模式会不给。" },
  { id: "memory", group: "device", bits: 1, name: "内存档位", note: "部分浏览器只给一个粗档位，不是真实内存容量。" },
  { id: "touch", group: "device", bits: 2, name: "最大触控点数", note: "0 也是有效读数，表示没有触控点。" },
  { id: "caps", group: "device", bits: 3, name: "接口是否存在", note: "只检查接口在不在，不会去申请权限。" },
  { id: "cookies", group: "device", bits: 1, name: "Cookie 开关", note: "读的是浏览器开关。这一页自己不写 Cookie。" },
  { id: "network", group: "device", bits: 2, name: "网络类型估计", note: "有效类型、下行和时延会随线路变化，不进入指纹 ID。" },
  { id: "storage", group: "device", bits: 2, name: "存储配额", note: "已用量会变，所以整项都视为易变，不进入指纹 ID。" },
  { id: "permissions", group: "device", bits: 2, name: "权限状态", note: "只查询状态。不会调用摄像头、麦克风或定位。" },
  { id: "plugins", group: "device", bits: 1, name: "PDF 与插件", note: "现代浏览器的插件列表通常很短。" },
  { id: "canvas", group: "render", bits: 8, name: "Canvas 绘图", note: "画一套固定图形再抽样像素。驱动和字体不同，结果就不同。" },
  { id: "webgl-renderer", group: "render", bits: 5, name: "WebGL 渲染器", note: "显卡字符串。有的浏览器只给一个掩码后的通用名字。" },
  { id: "webgl-params", group: "render", bits: 4, name: "WebGL 参数与扩展", note: "纹理上限、精度和扩展列表，比型号字符串更难临时改掉。" },
  { id: "webgl2", group: "render", bits: 2, name: "WebGL 版本", note: "有没有 WebGL 2。" },
  { id: "audio", group: "render", bits: 5, name: "离线音频采样", note: "离线渲染一段振荡波，取固定下标的样本。不会出声，也不要麦克风。" },
  { id: "fonts", group: "render", bits: 7, name: "字体宽度", note: "不能枚举已装字体，所以量同一段文字在候选字体下的宽度。" },
  { id: "layout", group: "render", bits: 4, name: "布局尺寸", note: "屏幕外的若干小盒子的宽高。字号和字体栈不同，尺寸就不同。" },
  { id: "antialias", group: "render", bits: 3, name: "文字抗锯齿", note: "奇偶列的透明度累加。抗锯齿设置不同，分布就不同。" },
  { id: "offscreen", group: "render", bits: 1, name: "离屏画布", note: "OffscreenCanvas 能不能创建、能不能读像素。" },
  { id: "tls", group: "network", bits: 2, name: "TLS 版本", note: "边缘从这条连接读到的版本，不是页面猜的。" },
  { id: "cipher", group: "network", bits: 2, name: "TLS 加密套件", note: "协商结果。它不是 JA3：JA3 看的是握手时提出的整份列表。" },
  { id: "ja3", group: "network", bits: 0, name: "JA3 / JA4", note: "需要 TLS Client Hello。这个接口不返回该字段，免费 Pages 一般也没有。" },
  { id: "asn", group: "network", bits: 3, name: "ASN 与运营商", note: "出口网络的自治系统编号和名称。" },
  { id: "colo", group: "network", bits: 2, name: "接入节点", note: "边缘机房代号，以及边缘标注的位置。" },
  { id: "proto", group: "network", bits: 2, name: "协议与地址", note: "HTTP 版本、IP 版本和这次连接的地址。换网络后地址会变，指纹 ID 也会变。" },
  { id: "lang-header", group: "network", bits: 2, name: "语言：请求头与页面", note: "Accept-Language 和 navigator.languages 归一化后比较。" },
  { id: "ua-header", group: "network", bits: 2, name: "客户端提示：请求头与页面", note: "浏览器已经发给本站的 Sec-CH-UA，和页面里读到的品牌列表比较。" },
];

const CATALOG = new Map(SIGNALS.map((row) => [row.id, row]));
const GROUP_NAME = new Map(GROUPS.map((group) => [group.id, group.name]));

export function idsIn(group) {
  return SIGNALS.filter((row) => row.group === group).map((row) => row.id);
}

export function groupName(id) {
  return GROUP_NAME.get(id) || id;
}

export function makeSignal(spec) {
  const meta = CATALOG.get(spec.id);
  if (!meta) throw new Error(`unknown signal ${spec.id}`);
  let status = spec.status || "absent";
  const value = spec.value == null ? "" : String(spec.value);
  if (!value && (status === "ok" || status === "volatile")) status = "absent";
  const hash = spec.hash == null ? value : String(spec.hash);
  return {
    id: meta.id,
    group: meta.group,
    name: meta.name,
    note: spec.note == null ? meta.note : String(spec.note),
    bits: meta.bits,
    value,
    status,
    detail: spec.detail == null ? "" : String(spec.detail),
    hash,
  };
}

export function dedupeSignals(signals) {
  const seen = new Set();
  const out = [];
  for (const row of signals || []) {
    if (!row || seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

export function orderSignals(signals) {
  const rank = new Map(SIGNALS.map((row, index) => [row.id, index]));
  return dedupeSignals(signals).slice().sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999));
}

export function missingSignalIds(signals) {
  const have = new Set((signals || []).map((row) => row.id));
  return SIGNALS.map((row) => row.id).filter((id) => !have.has(id));
}

/** Stable serialization for the fingerprint ID. Volatile rows are omitted. */
export function canonical(signals) {
  const rows = [];
  for (const row of dedupeSignals(signals)) {
    if (!row || row.status === "volatile") continue;
    rows.push(`${row.id}\u241e${row.status}\u241e${row.hash}`);
  }
  rows.sort();
  return rows.join("\n");
}

export function entropyBits(signals) {
  let total = 0;
  for (const row of dedupeSignals(signals)) {
    if (row.status === "ok") total += row.bits;
    else if (row.status === "volatile") total += row.bits / 2;
  }
  return Math.round(total * 10) / 10;
}

export function collisionText(bits) {
  const value = Number(bits);
  if (!Number.isFinite(value) || value <= 1) {
    return "本地估算：这些信号几乎分不开常见设备。不是实测访客比例。";
  }
  const denom = 2 ** value;
  if (denom < 1000) {
    const n = Math.max(2, Math.round(denom));
    return `本地估算：大约每 ${n} 份组合里有 1 份相同。不是实测访客比例。`;
  }
  const exp = Math.floor(Math.log10(denom));
  const mant = denom / 10 ** exp;
  const shown = mant >= 10 ? mant.toFixed(0) : mant.toFixed(1);
  return `本地估算：大约 1 / ${shown}×10^${exp}。不是实测访客比例。`;
}

export function estimateUniqueness(bits) {
  let title;
  let detail;
  if (bits < 12) {
    title = "估算：很常见";
    detail = "按本地权重加总，这组信号在常见环境里会大量重复。";
  } else if (bits < 22) {
    title = "估算：有点区别";
    detail = "能把范围缩小一些，离「只有一台设备」还很远。";
  } else if (bits < 32) {
    title = "估算：比较少见";
    detail = "渲染和字体测量占了大头。真实人群里很多项会一起出现，实际没这么稀有。";
  } else {
    title = "估算：看起来很稀有";
    detail = "这是把各项当成互不相关之后的乐观上界。本站没有访客统计。";
  }
  return { title, detail, collision: collisionText(bits) };
}

export function summarize(signals) {
  const counts = { ok: 0, absent: 0, blocked: 0, volatile: 0 };
  const rows = dedupeSignals(signals);
  for (const row of rows) {
    if (counts[row.status] == null) counts[row.status] = 0;
    counts[row.status] += 1;
  }
  const bits = entropyBits(rows);
  return { counts, bits, uniqueness: estimateUniqueness(bits), total: rows.length };
}

export function diffSignals(previous, next) {
  const before = new Map(dedupeSignals(previous).map((row) => [row.id, row]));
  const after = new Map(dedupeSignals(next).map((row) => [row.id, row]));
  const changes = [];
  for (const row of after.values()) {
    const old = before.get(row.id);
    if (!old) {
      changes.push({ id: row.id, name: row.name, kind: "added", before: "", after: row.value, status: row.status });
      continue;
    }
    if (old.value !== row.value || old.status !== row.status) {
      changes.push({
        id: row.id,
        name: row.name,
        kind: "changed",
        before: old.value,
        after: row.value,
        beforeStatus: old.status,
        status: row.status,
      });
    }
  }
  for (const row of before.values()) {
    if (!after.has(row.id)) {
      changes.push({ id: row.id, name: row.name, kind: "removed", before: row.value, after: "", status: row.status });
    }
  }
  return changes;
}

export async function sha256Hex(text) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof TextEncoder === "undefined") {
    throw new Error("SHA-256 unavailable");
  }
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(String(text)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function formatDigest(hex, visible) {
  const clean = String(hex || "").replace(/\s+/g, "").toLowerCase();
  const shown = visible == null ? clean : clean.slice(0, visible);
  const parts = [];
  for (let i = 0; i < shown.length; i += 8) parts.push(shown.slice(i, i + 8));
  return parts.join(" ");
}

export function normalizeLangTag(raw) {
  const token = String(raw ?? "").trim().split(";")[0].trim().replace(/_/g, "-");
  if (!token || token === "*") return "";
  const parts = token.split("-").filter(Boolean);
  if (!parts.length) return "";
  const language = parts[0].toLowerCase();
  if (parts.length === 1) return language;
  const region = parts[1];
  const regionNorm = /^[a-z]{2}$/i.test(region) || /^\d{3}$/.test(region) ? region.toUpperCase() : region.toLowerCase();
  return [language, regionNorm, ...parts.slice(2).map((part) => part.toLowerCase())].join("-");
}

export function compareLanguageLists(headerValue, navigatorLangs) {
  const header = String(headerValue ?? "").split(",").map(normalizeLangTag).filter(Boolean);
  const page = (navigatorLangs || []).map(normalizeLangTag).filter(Boolean);
  if (!header.length || !page.length) return "insufficient";
  if (header.join(",") === page.join(",")) return "exact";
  if (header.length === page.length && header.every((tag) => page.includes(tag))) return "reordered";
  if (header.length > page.length && header.slice(0, page.length).join(",") === page.join(",")) return "prefix";
  return "mismatch";
}

export function parseSecChUa(header) {
  const text = String(header ?? "");
  const out = [];
  const pattern = /"((?:[^"\\]|\\.)*)"\s*;\s*v\s*=\s*"((?:[^"\\]|\\.)*)"/g;
  let match = pattern.exec(text);
  while (match) {
    out.push({ brand: match[1].replace(/\\"/g, '"'), version: match[2] });
    match = pattern.exec(text);
  }
  return out;
}

function brandKey(item) {
  return `${item.brand}/${item.version}`;
}

export function compareBrandLists(headerValue, pageBrands) {
  const header = parseSecChUa(headerValue);
  const page = (pageBrands || []).map((item) => ({
    brand: String(item?.brand || ""),
    version: String(item?.version || ""),
  })).filter((item) => item.brand);
  const headerKeys = header.map(brandKey).sort();
  const pageKeys = page.map(brandKey).sort();
  if (!header.length) return { relation: "unparsed", header: headerKeys, page: pageKeys };
  const relation = headerKeys.join("|") === pageKeys.join("|") ? "exact" : "mismatch";
  return { relation, header: headerKeys, page: pageKeys };
}

const LANG_LABEL = {
  exact: "和页面一致",
  reordered: "标签相同，顺序不同",
  prefix: "页面是请求头的前半段",
  mismatch: "和页面不一致",
  insufficient: "缺少一边的语言信息",
};

function textOrEmpty(value) {
  return value == null ? "" : String(value);
}

export function networkSignals({ connection, brands = [], languages = [] } = {}) {
  const ja3 = makeSignal({
    id: "ja3",
    status: "absent",
    value: "接口里没有这一项",
    hash: "absent",
    detail: "边缘 JSON 只有 TLS 版本和加密套件，没有 Client Hello 指纹。免费的 Cloudflare Pages 通常也不提供 JA3 / JA4，所以这里不编造。",
  });
  if (!connection || connection.edge !== true) {
    const note = "没有读到 /api/whoami，连接层信息先空着。";
    return idsIn("network").map((id) => (id === "ja3"
      ? ja3
      : makeSignal({ id, status: "blocked", value: "没有回执", hash: "blocked", note })));
  }

  const tls = textOrEmpty(connection.tlsVersion);
  const cipher = textOrEmpty(connection.tlsCipher);
  const asn = connection.asn == null || connection.asn === "" ? "" : `AS${connection.asn}`;
  const org = textOrEmpty(connection.org || connection.isp);
  const asnShown = [asn, org].filter(Boolean).join(" · ");
  const colo = textOrEmpty(connection.colo);
  const place = [connection.city, connection.country, connection.timezone].filter(Boolean).join(" / ");
  const coloShown = [colo, place].filter(Boolean).join(" · ");
  const protoShown = [connection.httpProtocol, connection.type, connection.ip].filter(Boolean).join(" · ");
  const langRelation = compareLanguageLists(connection.acceptLanguage, languages);
  const langHeader = textOrEmpty(connection.acceptLanguage);
  const langPage = (languages || []).join(",");
  const brandCompare = compareBrandLists(connection.secChUa, brands);
  const platformHeader = textOrEmpty(connection.secChUaPlatform);
  const mobileHeader = textOrEmpty(connection.secChUaMobile);

  let uaValue = "请求里没有 Sec-CH-UA";
  let uaStatus = "absent";
  let uaHash = "absent";
  if (connection.secChUa) {
    if (brandCompare.relation === "unparsed") {
      uaValue = "请求头没能解析成品牌列表";
      uaStatus = "blocked";
      uaHash = `unparsed\u241e${connection.secChUa}`;
    } else if (brandCompare.relation === "exact") {
      uaValue = "和页面里的品牌一致";
      uaStatus = "ok";
      uaHash = `exact\u241e${brandCompare.header.join(",")}\u241e${brandCompare.page.join(",")}\u241e${platformHeader}\u241e${mobileHeader}`;
    } else {
      uaValue = "和页面里的品牌不一致";
      uaStatus = "ok";
      uaHash = `mismatch\u241e${brandCompare.header.join(",")}\u241e${brandCompare.page.join(",")}\u241e${platformHeader}\u241e${mobileHeader}`;
    }
  }

  return [
    makeSignal({ id: "tls", status: tls ? "ok" : "absent", value: tls, hash: tls, detail: tls }),
    makeSignal({ id: "cipher", status: cipher ? "ok" : "absent", value: cipher, hash: cipher, detail: cipher }),
    ja3,
    makeSignal({
      id: "asn",
      status: asnShown ? "ok" : "absent",
      value: asnShown,
      hash: `${connection.asn ?? ""}\u241e${connection.org || ""}\u241e${connection.isp || ""}`,
      detail: asnShown,
    }),
    makeSignal({
      id: "colo",
      status: coloShown ? "ok" : "absent",
      value: coloShown,
      hash: `${colo}\u241e${connection.country || ""}\u241e${connection.timezone || ""}`,
      detail: coloShown,
    }),
    makeSignal({
      id: "proto",
      status: protoShown ? "ok" : "absent",
      value: protoShown,
      hash: `${connection.httpProtocol || ""}\u241e${connection.type || ""}\u241e${connection.ip || ""}`,
      detail: protoShown,
    }),
    makeSignal({
      id: "lang-header",
      status: langRelation === "insufficient" ? "absent" : "ok",
      value: LANG_LABEL[langRelation],
      hash: `${langRelation}\u241e${langHeader}\u241e${langPage}`,
      detail: `Accept-Language：${langHeader || "（空）"}\nnavigator.languages：${langPage || "（空）"}`,
    }),
    makeSignal({
      id: "ua-header",
      status: uaStatus,
      value: uaValue,
      hash: uaHash,
      detail: [
        `Sec-CH-UA：${connection.secChUa || "（空）"}`,
        `Sec-CH-UA-Platform：${platformHeader || "（空）"}`,
        `Sec-CH-UA-Mobile：${mobileHeader || "（空）"}`,
        `页面品牌：${brandCompare.page.join(", ") || "（没有）"}`,
      ].join("\n"),
    }),
  ];
}

function usable(row) {
  if (!row || row.status === "absent" || row.status === "blocked") return "";
  return row.value || "";
}

export function buildPortrait(signals, connection = null) {
  const byId = new Map(dedupeSignals(signals).map((row) => [row.id, row]));
  const read = (id) => usable(byId.get(id));
  const paragraphs = [];

  const env = [];
  if (read("platform")) env.push(`平台标识是 ${read("platform")}`);
  if (read("langs")) env.push(`语言顺序是 ${read("langs")}`);
  if (read("tz")) env.push(`时区是 ${read("tz")}`);
  if (read("screen")) env.push(`屏幕是 ${read("screen")}`);
  if (read("dpr")) env.push(`设备像素比是 ${read("dpr")}`);
  if (env.length) paragraphs.push(`浏览器直接报出来的环境：${env.join("，")}。`);

  const hardware = [];
  if (read("cores")) hardware.push(`${read("cores")} 个逻辑处理器`);
  if (read("touch")) hardware.push(`最多 ${read("touch")} 个触控点`);
  if (read("webgl-renderer")) hardware.push(`WebGL 渲染器是 ${read("webgl-renderer")}`);
  if (read("fonts")) hardware.push(`字体测量是 ${read("fonts")}`);
  if (hardware.length) paragraphs.push(`和机器更相关的读数：${hardware.join("，")}。`);

  const notes = [];
  const langRow = byId.get("lang-header");
  if (langRow && langRow.value && langRow.status !== "blocked") notes.push(`语言对照：${langRow.value}。`);
  const uaRow = byId.get("ua-header");
  if (uaRow && uaRow.value && uaRow.status !== "blocked") notes.push(`客户端提示对照：${uaRow.value}。`);
  const pageTz = read("tz");
  const edgeTz = connection?.timezone ? String(connection.timezone) : "";
  if (pageTz && edgeTz) {
    notes.push(edgeTz === pageTz
      ? `连接回执里的时区也是 ${edgeTz}。`
      : `连接回执里的时区是 ${edgeTz}，和页面时区不一样。`);
  }
  if (connection?.colo) notes.push(`边缘节点代号是 ${connection.colo}。`);
  if (connection?.city || connection?.country) {
    notes.push(`边缘给这次连接标的位置是 ${[connection.city, connection.country].filter(Boolean).join(" / ")}。`);
  }
  if (!read("webgl-renderer")) notes.push("没有拿到 WebGL 渲染器字符串。");
  if (notes.length) paragraphs.push(notes.join(""));

  if (!paragraphs.length) paragraphs.push("这一轮没有足够的读数可以写成一段话。");
  return paragraphs;
}
