import { expandIPv6, isIPv4, parseIPv6 } from "./net.js";

/** Family-specific public endpoints. The Pages hostname cannot split 4/6 without a custom domain. */
export const STACK_PROBES = {
  4: [
    { name: "icanhazip.com", url: "https://ipv4.icanhazip.com" },
    { name: "ip.sb", url: "https://api-ipv4.ip.sb/ip" },
  ],
  6: [
    { name: "icanhazip.com", url: "https://ipv6.icanhazip.com" },
    { name: "ip.sb", url: "https://api-ipv6.ip.sb/ip" },
  ],
};

export function familyOf(ip) {
  if (typeof ip !== "string") return null;
  const text = ip.trim();
  if (isIPv4(text)) return "4";
  if (parseIPv6(text)) return "6";
  return null;
}

export function sameIp(a, b) {
  const left = familyOf(a);
  const right = familyOf(b);
  if (!left || left !== right) return false;
  if (left === "4") return a.trim() === b.trim();
  const expandedA = expandIPv6(a);
  const expandedB = expandIPv6(b);
  if (expandedA && expandedB) return expandedA === expandedB;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Pull one IP of the requested family out of a plain-text body. */
export function parsePlainIp(text, family) {
  const line = String(text || "").trim().split(/\s+/)[0]?.replace(/^\[|\]$/g, "") || "";
  const got = familyOf(line);
  if (!got || (family && got !== family)) return null;
  return { ip: line, family: got, type: got === "6" ? "IPv6" : "IPv4" };
}
