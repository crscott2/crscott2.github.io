var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// .wrangler/tmp/bundle-yhVKKI/strip-cf-connecting-ip-header.js
function stripCfConnectingIPHeader(input, init) {
  const request = new Request(input, init);
  request.headers.delete("CF-Connecting-IP");
  return request;
}
__name(stripCfConnectingIPHeader, "stripCfConnectingIPHeader");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    return Reflect.apply(target, thisArg, [
      stripCfConnectingIPHeader.apply(null, argArray)
    ]);
  }
});

// worker.js
var SOMAS_URL = "https://po.somas.stonybrook.edu/GSB/B1RT.html";
var NDBC_URL = "https://www.ndbc.noaa.gov/data/realtime2/44069.txt";
var NDBC_PAGE = "https://www.ndbc.noaa.gov/station_page.php?station=44069";
var UA = "GSBBay-Worker/1.0 (crscott2@gmail.com)";
var ET = "America/New_York";
var CACHE_SECONDS = 300;
var ALLOWED_ORIGINS = [
  "https://crscott2.github.io",
  "http://localhost:8765",
  "http://127.0.0.1:8765"
];
var COMPASS16 = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
function compass16(deg) {
  if (deg == null || Number.isNaN(Number(deg)))
    return null;
  const d = (Number(deg) % 360 + 360) % 360;
  return COMPASS16[Math.round(d / 22.5) % 16];
}
__name(compass16, "compass16");
function etParts(d) {
  const o = {};
  for (const p of new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(d))
    if (p.type !== "literal")
      o[p.type] = p.value;
  return o;
}
__name(etParts, "etParts");
function toEtIso(d) {
  const p = etParts(d);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  const off = Math.round((asUtc - d.getTime()) / 6e4);
  const sign = off >= 0 ? "+" : "-", a = Math.abs(off);
  const pad = /* @__PURE__ */ __name((n) => String(n).padStart(2, "0"), "pad");
  return `${p.year}-${p.month}-${p.day}T${pad(+p.hour % 24)}:${p.minute}:${p.second}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}
__name(toEtIso, "toEtIso");
function etClock(d) {
  return new Intl.DateTimeFormat("en-US", { timeZone: ET, hour: "numeric", minute: "2-digit", hour12: true }).format(d).replace(/\u202f|\u00a0/g, " ");
}
__name(etClock, "etClock");
function fnum(s) {
  if (s == null || s === "")
    return null;
  const m = String(s).match(/(-?\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}
__name(fnum, "fnum");
function parseSomas(html) {
  const cell = /* @__PURE__ */ __name((label) => {
    const esc = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = html.match(new RegExp("<strong>" + esc + ":</strong></td>\\s*<td[^>]*>(.*?)</td>", "is"));
    return m ? m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : null;
  }, "cell");
  const dateS = cell("Date"), timeS = cell("Time");
  let observed = null;
  if (dateS && timeS) {
    const dm = dateS.match(/(\d{1,2})-(\d{1,2})-(\d{4})/);
    const tm = timeS.replace(/\s*GMT/i, "").match(/(\d{1,2}):(\d{2}):(\d{2})/);
    if (dm && tm)
      observed = new Date(Date.UTC(+dm[3], +dm[1] - 1, +dm[2], +tm[1], +tm[2], +tm[3]));
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
    source: SOMAS_URL
  };
}
__name(parseSomas, "parseSomas");
function parseNdbc(text) {
  const row = String(text).split("\n").find((l) => l && l[0] !== "#");
  if (!row)
    throw new Error("NDBC: no data rows");
  const c = row.trim().split(/\s+/);
  const v = /* @__PURE__ */ __name((i) => c[i] == null || c[i] === "MM" ? null : parseFloat(c[i]), "v");
  const observed = new Date(Date.UTC(+c[0], +c[1] - 1, +c[2], +c[3], +c[4]));
  if (Number.isNaN(observed.getTime()))
    throw new Error("NDBC: bad time");
  const toF = /* @__PURE__ */ __name((x) => x == null ? null : Math.round((x * 9 / 5 + 32) * 100) / 100, "toF");
  const toKt = /* @__PURE__ */ __name((x) => x == null ? null : Math.round(x * 1.943844 * 100) / 100, "toKt");
  return {
    observed,
    windKt: toKt(v(6)),
    gustKt: toKt(v(7)),
    windDeg: v(5),
    windDir: compass16(v(5)),
    airF: toF(v(13)),
    waterF: toF(v(14)),
    humidity: null,
    sourceLabel: "NDBC 44069",
    source: NDBC_PAGE
  };
}
__name(parseNdbc, "parseNdbc");
async function getText(url, extraHeaders) {
  const r = await fetch(url, {
    headers: Object.assign({ "User-Agent": UA, Accept: "*/*" }, extraHeaders || {}),
    cf: { cacheTtl: 60 }
  });
  if (!r.ok && r.status !== 206)
    throw new Error(url + " HTTP " + r.status);
  return r.text();
}
__name(getText, "getText");
async function buildPayload() {
  const errors = [];
  const [somas, ndbc] = await Promise.all([
    getText(SOMAS_URL).then(parseSomas).catch((e) => {
      errors.push("somas: " + e.message);
      return null;
    }),
    // First ~4 KB is plenty (newest rows are at the top of a ~400 KB file).
    getText(NDBC_URL, { Range: "bytes=0-4095" }).then(parseNdbc).catch((e) => {
      errors.push("ndbc: " + e.message);
      return null;
    })
  ]);
  const ok = /* @__PURE__ */ __name((b) => b && b.observed && b.windKt != null, "ok");
  let best = null, other = null;
  if (ok(somas) && (!ok(ndbc) || somas.observed >= ndbc.observed)) {
    best = somas;
    other = ndbc;
  } else if (ok(ndbc)) {
    best = ndbc;
    other = somas;
  }
  if (!best)
    return { ok: false, errors };
  const out = {
    name: "GSB Buoy #1",
    source: best.source,
    sourceLabel: best.sourceLabel,
    observedEt: etClock(best.observed),
    observedIso: toEtIso(best.observed),
    ageMin: Math.floor((Date.now() - best.observed.getTime()) / 6e4),
    windKt: best.windKt,
    gustKt: best.gustKt,
    windDir: best.windDir,
    windDeg: best.windDeg,
    airF: best.airF,
    waterF: best.waterF,
    humidity: best.humidity,
    fetchedAt: toEtIso(/* @__PURE__ */ new Date()),
    via: "worker"
  };
  if (out.waterF == null && other && other.waterF != null && other.observed && Date.now() - other.observed.getTime() <= 6 * 36e5) {
    out.waterF = other.waterF;
    out.waterAsOf = etClock(other.observed);
  }
  if (errors.length)
    out.errors = errors;
  out.ok = true;
  return out;
}
__name(buildPayload, "buildPayload");
function corsHeaders(req) {
  const origin = req.headers.get("Origin");
  const h = { "Access-Control-Allow-Methods": "GET, OPTIONS", Vary: "Origin" };
  if (origin && ALLOWED_ORIGINS.includes(origin))
    h["Access-Control-Allow-Origin"] = origin;
  return h;
}
__name(corsHeaders, "corsHeaders");
var worker_default = {
  async fetch(req, env, ctx) {
    if (req.method === "OPTIONS")
      return new Response(null, { status: 204, headers: corsHeaders(req) });
    if (req.method !== "GET")
      return new Response("Method not allowed", { status: 405 });
    const cache = caches.default;
    const key = new Request(new URL("/__gsb_buoy_v1", req.url).toString());
    let res = await cache.match(key);
    if (!res) {
      const payload = await buildPayload();
      res = new Response(JSON.stringify(payload, null, 2), {
        status: payload.ok ? 200 : 502,
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=" + CACHE_SECONDS }
      });
      if (payload.ok)
        ctx.waitUntil(cache.put(key, res.clone()));
    }
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(corsHeaders(req)))
      out.headers.set(k, v);
    out.headers.set("Cache-Control", "public, max-age=" + CACHE_SECONDS);
    return out;
  }
};

// ../../pwtest/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../pwtest/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-yhVKKI/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// ../../pwtest/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-yhVKKI/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof __Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
__name(__Facade_ScheduledController__, "__Facade_ScheduledController__");
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = (request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    };
    #dispatcher = (type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    };
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  buildPayload,
  middleware_loader_entry_default as default,
  parseNdbc,
  parseSomas
};
//# sourceMappingURL=worker.js.map
