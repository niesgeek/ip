import { familyOf, sameIp } from "./stack.js";

/** One-shot DNS leak sample. The unique name is the redirect target; the JSON names the resolver that asked. */
export const EDNS_URL = "https://edns.ip-api.com/json";
export const EDNS_VENDOR = "ip-api.com";

export function parseEdns(payload) {
  const dns = payload && typeof payload === "object" ? payload.dns : null;
  if (!dns || typeof dns !== "object") return null;
  const ip = String(dns.ip || "").trim();
  if (!familyOf(ip)) return null;
  const geo = String(dns.geo || "").trim();
  const parts = geo.split(" - ");
  const country = parts.length >= 2 ? parts[0].trim() : "";
  const org = parts.length >= 2 ? parts.slice(1).join(" - ").trim() : geo;
  return { ip, geo, country, org };
}

export function dedupeResolvers(rows) {
  const out = [];
  for (const row of rows || []) {
    if (!row?.ip) continue;
    if (out.some((item) => sameIp(item.ip, row.ip))) continue;
    out.push(row);
  }
  return out;
}

/**
 * Compare resolver egress addresses with the exits already on the page.
 * exits: [{ ip, asn, cc }]
 */
export function compareResolvers(resolvers, exits) {
  const list = dedupeResolvers(resolvers);
  const known = (exits || []).filter((row) => row && familyOf(row.ip));
  if (!list.length) return { id: "empty", resolvers: [] };
  const annotated = list.map((row) => {
    const same = known.find((exit) => sameIp(exit.ip, row.ip));
    const asn = row.asn == null ? null : Number(row.asn);
    const exitAsn = known.find((exit) => exit.asn != null && Number(exit.asn) === asn);
    let relation = "different";
    if (same) relation = "same-ip";
    else if (asn && exitAsn) relation = "same-asn";
    return { ...row, relation };
  });
  let id = "different";
  if (annotated.every((row) => row.relation === "same-ip")) id = "same-ip";
  else if (annotated.every((row) => row.relation === "same-ip" || row.relation === "same-asn")) id = "same-asn";
  return { id, resolvers: annotated };
}
