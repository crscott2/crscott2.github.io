// GSB buoy Worker (Cloudflare Workers free tier).
// GET /  -> clean buoy JSON (same shape as buoy.json + sourceLabel), cached 5 min.
// Primary: SoMAS GSB Buoy #1 HTML (parsed like scripts/fetch_buoy.py).
// Fallback / water-temp fill: NOAA NDBC 44069 realtime2 text (same buoy, has WTMP).

const SOMAS_URL = "https://po.somas.stonybrook.edu/GSB/B1RT.html";
const NDBC_URL = "https://www.ndbc.noaa.gov/data/realtime2/44069.txt";
const NDBC_PAGE = "https://www.ndbc.noaa.gov/station_page.php?station=44069";
const UA = "GSBBay-Worker/1.0 (crscott2@gmail.com)";
const ET = "America/New_York";
const CACHE_SECONDS = 300;
const ALLOWED_ORIGINS = [
  "https://crscott2.github.io",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
];
const COMPASS16 = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];

function compass16(deg) {
  if (deg == null || Number.isNaN(Number(deg))) return null;
  const d = ((Number(deg) % 360) + 360) % 360;
  return COMPASS16[Math.round(d / 22.5) % 16];
}

function etParts(d) {
  const o = {};
  for (const p of new Intl.DateTimeFormat("en-US", {
    timeZone: ET, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(d)) if (p.type !== "literal") o[p.type] = p.value;
  return o;
}
function toEtIso(d) {
  const p = etParts(d);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  const off = Math.round((asUtc - d.getTime()) / 60000);
  const sign = off >= 0 ? "+" : "-", a = Math.abs(off);
  const pad = (n) => String(n).padStart(2, "0");
  return `${p.year}-${p.month}-${p.day}T${pad(+p.hour % 24)}:${p.minute}:${p.second}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}
function etClock(d) {
  return new Intl.DateTimeFormat("en-US", { timeZone: ET, hour: "numeric", minute: "2-digit", hour12: true })
    .format(d).replace(/\u202f|\u00a0/g, " ");
}
function fnum(s) {
  if (s == null || s === "") return null;
  const m = String(s).match(/(-?\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

// Mirrors scripts/fetch_buoy.py parse_buoy().
export function parseSomas(html) {
  const cell = (label) => {
    const esc = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = html.match(new RegExp("<strong>" + esc + ":</strong></td>\\s*<td[^>]*>(.*?)</td>", "is"));
    return m ? m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : null;
  };
  const dateS = cell("Date"), timeS = cell("Time");
  let observed = null;
  if (dateS && timeS) {
    const dm = dateS.match(/(\d{1,2})-(\d{1,2})-(\d{4})/);
    const tm = timeS.replace(/\s*GMT/i, "").match(/(\d{1,2}):(\d{2}):(\d{2})/);
    if (dm && tm) observed = new Date(Date.UTC(+dm[3], +dm[1] - 1, +dm[2], +tm[1], +tm[2], +tm[3]));
  }
  const air = cell("Air Temperature") || "", water = cell("Water Temperature") || "";
  const airM = air.includes("F") ? air.match(/\(([^)]*F)/) : null;
  const waterM = water.includes("F") ? water.match(/\(([^)]*F)/) : null;
  const wd = cell("Wind Direction") || "";
  const cm = wd.match(/from the\s+([A-Z]+)/);
  const dg = wd.replace(/\u00b0/g, "o").match(/(\d+)\s*o/);
  return {
    observed,
    windKt: fnum(cell("Wind Speed")),
    gustKt: fnum(cell("Wind Gust")),
    windDir: cm ? cm[1] : null,
    windDeg: dg ? parseInt(dg[1], 10) : null,
    airF: fnum(airM ? airM[1] : air),
    waterF: fnum(waterM ? waterM[1] : water),
    humidity: fnum(cell("Humidity")),
    sourceLabel: "SoMAS",
    source: SOMAS_URL,
  };
}

export function parseNdbc(text) {
  const row = String(text).split("\n").find((l) => l && l[0] !== "#");
  if (!row) throw new Error("NDBC: no data rows");
  const c = row.trim().split(/\s+/);
  const v = (i) => (c[i] == null || c[i] === "MM" ? null : parseFloat(c[i]));
  const observed = new Date(Date.UTC(+c[0], +c[1] - 1, +c[2], +c[3], +c[4]));
  if (Number.isNaN(observed.getTime())) throw new Error("NDBC: bad time");
  const toF = (x) => (x == null ? null : Math.round((x * 9 / 5 + 32) * 100) / 100);
  const toKt = (x) => (x == null ? null : Math.round(x * 1.943844 * 100) / 100);
  return {
    observed,
    windKt: toKt(v(6)), gustKt: toKt(v(7)),
    windDeg: v(5), windDir: compass16(v(5)),
    airF: toF(v(13)), waterF: toF(v(14)), humidity: null,
    sourceLabel: "NDBC 44069",
    source: NDBC_PAGE,
  };
}

async function getText(url, extraHeaders) {
  const r = await fetch(url, {
    headers: Object.assign({ "User-Agent": UA, Accept: "*/*" }, extraHeaders || {}),
    cf: { cacheTtl: 60 },
  });
  if (!r.ok && r.status !== 206) throw new Error(url + " HTTP " + r.status);
  return r.text();
}

export async function buildPayload() {
  const errors = [];
  const [somas, ndbc] = await Promise.all([
    getText(SOMAS_URL).then(parseSomas).catch((e) => { errors.push("somas: " + e.message); return null; }),
    // First ~4 KB is plenty (newest rows are at the top of a ~400 KB file).
    getText(NDBC_URL, { Range: "bytes=0-4095" }).then(parseNdbc).catch((e) => { errors.push("ndbc: " + e.message); return null; }),
  ]);
  const ok = (b) => b && b.observed && b.windKt != null;
  let best = null, other = null;
  if (ok(somas) && (!ok(ndbc) || somas.observed >= ndbc.observed)) { best = somas; other = ndbc; }
  else if (ok(ndbc)) { best = ndbc; other = somas; }
  if (!best) return { ok: false, errors };
  const out = {
    name: "GSB Buoy #1",
    source: best.source,
    sourceLabel: best.sourceLabel,
    observedEt: etClock(best.observed),
    observedIso: toEtIso(best.observed),
    ageMin: Math.floor((Date.now() - best.observed.getTime()) / 60000),
    windKt: best.windKt, gustKt: best.gustKt, windDir: best.windDir, windDeg: best.windDeg,
    airF: best.airF, waterF: best.waterF, humidity: best.humidity,
    fetchedAt: toEtIso(new Date()),
    via: "worker",
  };
  // Water temp fill from the other feed if its reading is within 6 h of the chosen one.
  if (out.waterF == null && other && other.waterF != null && other.observed &&
      Math.abs(best.observed.getTime() - other.observed.getTime()) <= 6 * 3600000) {
    out.waterF = other.waterF;
    out.waterAsOf = etClock(other.observed);
  }
  if (errors.length) out.errors = errors;
  out.ok = true;
  return out;
}

function corsHeaders(req) {
  const origin = req.headers.get("Origin");
  const h = { "Access-Control-Allow-Methods": "GET, OPTIONS", Vary: "Origin" };
  if (origin && ALLOWED_ORIGINS.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

export default {
  async fetch(req, env, ctx) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
    if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
    const cache = caches.default;
    const key = new Request(new URL("/__gsb_buoy_v1", req.url).toString());
    let res = await cache.match(key);
    if (!res) {
      const payload = await buildPayload();
      res = new Response(JSON.stringify(payload, null, 2), {
        status: payload.ok ? 200 : 502,
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=" + CACHE_SECONDS },
      });
      if (payload.ok) ctx.waitUntil(cache.put(key, res.clone()));
    }
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(corsHeaders(req))) out.headers.set(k, v);
    out.headers.set("Cache-Control", "public, max-age=" + CACHE_SECONDS);
    return out;
  },
};
