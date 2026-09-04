/* GSB Bay — client-side gather/parse/stoplight (static GitHub Pages). */
(function () {
  "use strict";

  const ET = "America/New_York";
  const KT_TO_MPH = 1.150779448;
  const PLACE = "Great South Bay · Patchogue–Sayville";
  const BUOY_URL = "https://po.somas.stonybrook.edu/GSB/B1RT.html";
  // SoMAS B1RT.html sends no Access-Control-Allow-Origin. Direct fetch is tried
  // first; cors.sh next; same-origin buoy.json; NWS 44069; allorigins last.
  const BUOY_CORS_SH = "https://proxy.cors.sh/" + BUOY_URL;
  const BUOY_PROXY = "https://api.allorigins.win/raw?url=" + encodeURIComponent(BUOY_URL);
  const NWS_44069 = "https://api.weather.gov/stations/44069/observations/latest";
  const NDBC_44069 = "https://www.ndbc.noaa.gov/station_page.php?station=44069";
  const MARINE_TGFTP = "https://tgftp.nws.noaa.gov/data/forecasts/marine/coastal/an/anz345.txt";
  const CWF_LIST = "https://api.weather.gov/products/types/CWF/locations/OKX";
  const ALERTS_URL = "https://api.weather.gov/alerts/active?zone=ANZ345,NYZ080";
  const TIDES_BASE =
    "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter" +
    "?product=predictions&application=GSBBay&datum=MLLW&station=8514322" +
    "&time_zone=lst_ldt&units=english&format=json";

  function pad(n, w) {
    return String(n).padStart(w || 2, "0");
  }

  function mphOf(kt) {
    if (kt == null || Number.isNaN(Number(kt))) return null;
    return Math.round(Number(kt) * KT_TO_MPH);
  }

  function etParts(d) {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: ET,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    const o = {};
    for (const p of fmt.formatToParts(d)) {
      if (p.type !== "literal") o[p.type] = p.value;
    }
    let h = +o.hour;
    if (h === 24) h = 0;
    return { y: +o.year, mo: +o.month, d: +o.day, h: h, mi: +o.minute, s: +o.second };
  }

  function etOffset(d) {
    const p = etParts(d);
    const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
    const diffMin = Math.round((asUtc - d.getTime()) / 60000);
    const sign = diffMin >= 0 ? "+" : "-";
    const abs = Math.abs(diffMin);
    return sign + pad(Math.floor(abs / 60)) + ":" + pad(abs % 60);
  }

  function toEtIso(d) {
    const p = etParts(d);
    return (
      p.y +
      "-" +
      pad(p.mo) +
      "-" +
      pad(p.d) +
      "T" +
      pad(p.h) +
      ":" +
      pad(p.mi) +
      ":" +
      pad(p.s) +
      etOffset(d)
    );
  }

  function formatEtClock(d) {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: ET,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
      .format(d)
      .replace(/\u202f/g, " ")
      .replace(/\u00a0/g, " ");
  }

  function yyyymmddEt(d) {
    const p = etParts(d);
    return p.y + pad(p.mo) + pad(p.d);
  }

  function parseNoaaEt(tstr) {
    const m = String(tstr).match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3], h = +m[4], mi = +m[5];
    for (const off of ["-04:00", "-05:00"]) {
      const dt = new Date(m[1] + "-" + m[2] + "-" + m[3] + "T" + m[4] + ":" + m[5] + ":00" + off);
      const p = etParts(dt);
      if (p.y === y && p.mo === mo && p.d === d && p.h === h && p.mi === mi) return dt;
    }
    return new Date(m[1] + "-" + m[2] + "-" + m[3] + "T" + m[4] + ":" + m[5] + ":00-04:00");
  }

  function etMidnight(d) {
    const p = etParts(d);
    return parseNoaaEt(p.y + "-" + pad(p.mo) + "-" + pad(p.d) + " 00:00");
  }

  function moonPhase(when) {
    when = when || new Date();
    const known = Date.UTC(2000, 0, 6, 18, 14, 0);
    const synodic = 29.530588853;
    const days = (when.getTime() - known) / 86400000;
    let age = days % synodic;
    if (age < 0) age += synodic;
    const idx = Math.floor((age / synodic) * 8 + 0.5) % 8;
    const symbols = Array.from({length: 8}, (_, i) => String.fromCodePoint(0x1F311 + i));
    const names = [
      "New moon",
      "Waxing crescent",
      "First quarter",
      "Waxing gibbous",
      "Full moon",
      "Waning gibbous",
      "Last quarter",
      "Waning crescent",
    ];
    return { symbol: symbols[idx], name: names[idx], ageDays: Math.round(age * 10) / 10 };
  }

  function fnum(s) {
    if (s == null || s === "") return null;
    const m = String(s).match(/(-?\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : null;
  }

  function cell(html, label) {
    const esc = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp("<strong>" + esc + ":</strong></td>\\s*<td[^>]*>(.*?)</td>", "is");
    const m = html.match(re);
    if (!m) return null;
    return m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }

  function parseBuoy(html) {
    const dateS = cell(html, "Date");
    const timeS = cell(html, "Time");
    let observed = null;
    if (dateS && timeS) {
      const t = timeS.replace(/\s*GMT/i, "").trim();
      const dm = dateS.match(/(\d{1,2})-(\d{1,2})-(\d{4})/);
      const tm = t.match(/(\d{1,2}):(\d{2}):(\d{2})/);
      if (dm && tm) {
        observed = new Date(
          Date.UTC(+dm[3], +dm[1] - 1, +dm[2], +tm[1], +tm[2], +tm[3])
        );
      }
    }
    const air = cell(html, "Air Temperature") || "";
    const water = cell(html, "Water Temperature") || "";
    const airM = air.indexOf("F") >= 0 ? air.match(/\(([^)]*F)/) : null;
    const waterM = water.indexOf("F") >= 0 ? water.match(/\(([^)]*F)/) : null;
    const airF = fnum(airM ? airM[1] : air);
    const waterF = fnum(waterM ? waterM[1] : water);
    const windDir = cell(html, "Wind Direction") || "";
    let compass = null;
    let deg = null;
    const cm = windDir.match(/from the\s+([A-Z]+)/);
    if (cm) compass = cm[1];
    const dgm = windDir.replace(/\u00b0/g, "o").match(/(\d+)\s*o/);
    if (dgm) deg = parseInt(dgm[1], 10);
    let ageMin = null;
    if (observed) ageMin = Math.floor((Date.now() - observed.getTime()) / 60000);
    return {
      name: "GSB Buoy #1",
      source: BUOY_URL,
      observedEt: observed ? formatEtClock(observed) : null,
      observedIso: observed ? toEtIso(observed) : null,
      ageMin: ageMin,
      windKt: fnum(cell(html, "Wind Speed")),
      gustKt: fnum(cell(html, "Wind Gust")),
      windDir: compass,
      windDeg: deg,
      airF: airF,
      waterF: waterF,
      humidity: fnum(cell(html, "Humidity")),
    };
  }

  const COMPASS16 = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];

  function compass16(deg) {
    if (deg == null || Number.isNaN(Number(deg))) return null;
    const d = ((Number(deg) % 360) + 360) % 360;
    return COMPASS16[Math.round(d / 22.5) % 16];
  }

  function nwsVal(obj) {
    if (!obj || obj.value == null) return null;
    const n = Number(obj.value);
    return Number.isNaN(n) ? null : n;
  }

  function parseNws44069(data) {
    const p = (data && data.properties) || {};
    const observed = p.timestamp ? new Date(p.timestamp) : null;
    const okObs = observed && !Number.isNaN(observed.getTime());
    const kmh = nwsVal(p.windSpeed);
    const gustKmh = nwsVal(p.windGust);
    const c = nwsVal(p.temperature);
    const rh = nwsVal(p.relativeHumidity);
    const deg = nwsVal(p.windDirection);
    let ageMin = null;
    if (okObs) ageMin = Math.floor((Date.now() - observed.getTime()) / 60000);
    return {
      name: "GSB Buoy #1",
      source: NDBC_44069,
      observedEt: okObs ? formatEtClock(observed) : null,
      observedIso: okObs ? toEtIso(observed) : null,
      ageMin: ageMin,
      windKt: kmh != null ? kmh / 1.852 : null,
      gustKt: gustKmh != null ? gustKmh / 1.852 : null,
      windDir: compass16(deg),
      windDeg: deg != null ? Math.round(deg) : null,
      airF: c != null ? c * 9 / 5 + 32 : null,
      waterF: null,
      humidity: rh != null ? Math.round(rh) : null,
    };
  }

  function titleCase(s) {
    return String(s).toLowerCase().replace(/(^|[^a-z])([a-z])/g, function (_a, a, b) {
      return a + b.toUpperCase();
    });
  }

  function parseMarine(text) {
    let block = text;
    const bm = text.match(/ANZ345[^\n]*\n([\s\S]*?)(?:\n\$\$|\nANZ\d{3}-|$)/);
    if (bm) block = bm[0];
    let issued = null;
    const im = block.match(/(\d{1,3}\s+[AP]M\s+EDT\s+\w+\s+\w+\s+\d+\s+\d{4})/);
    if (im) issued = im[1];
    const periods = [];
    const re = /\.([A-Z][A-Z0-9 /]+?)\.{3}([\s\S]*?)(?=\n\.|$)/g;
    let m;
    while ((m = re.exec(block))) {
      const body = m[2].replace(/\s+/g, " ").trim();
      periods.push({ name: titleCase(m[1].trim()), text: body });
    }
    return {
      zone: "ANZ345",
      zoneName: "South Shore Bays from Jones Inlet through Shinnecock Bay",
      issued: issued,
      periods: periods.slice(0, 6),
      source: MARINE_TGFTP,
    };
  }

  function packExtreme(p) {
    if (!p) return null;
    return {
      type: p.type === "H" ? "High" : "Low",
      time: formatEtClock(p.t),
      iso: toEtIso(p.t),
      ft: Math.round(p.v * 100) / 100,
    };
  }

  function parseTides(data) {
    const preds = data.predictions || [];
    const now = new Date();
    const parsed = [];
    for (const p of preds) {
      const t = parseNoaaEt(p.t);
      if (!t) continue;
      parsed.push({ t: t, v: parseFloat(p.v), type: p.type });
    }
    parsed.sort(function (a, b) { return a.t - b.t; });
    const nxtH = parsed.find(function (p) { return p.t > now && p.type === "H"; });
    const nxtL = parsed.find(function (p) { return p.t > now && p.type === "L"; });
    let prev = null;
    for (const p of parsed) {
      if (p.t <= now) prev = p;
      else break;
    }
    let state = null;
    if (prev && (nxtH || nxtL)) {
      const cands = [nxtH, nxtL].filter(Boolean);
      cands.sort(function (a, b) { return a.t - b.t; });
      state = cands[0].type === "H" ? "rising" : "falling";
    }
    return {
      station: "8514322",
      stationName: "Patchogue",
      state: state,
      nextHigh: packExtreme(nxtH),
      nextLow: packExtreme(nxtL),
      source: "https://tidesandcurrents.noaa.gov/noaatidepredictions.html?id=8514322",
      extremes: parsed.map(packExtreme),
    };
  }

  function windTideFlow(buoy, tides) {
    if (!buoy || !tides || buoy.windDeg == null || !tides.state) return null;
    const state = tides.state;
    let currentEast, currentName, currentDir;
    if (state === "rising") {
      currentEast = 1.0; currentName = "flood"; currentDir = "west to east";
    } else if (state === "falling") {
      currentEast = -1.0; currentName = "ebb"; currentDir = "east to west";
    } else {
      return null;
    }
    let slackKind = null;
    const now = new Date();
    let best = 999.0;
    const cands = (tides.extremes || []).slice();
    if (tides.nextHigh) cands.push(tides.nextHigh);
    if (tides.nextLow) cands.push(tides.nextLow);
    for (const ext of cands) {
      if (!ext || !ext.iso) continue;
      const tt = new Date(ext.iso);
      if (Number.isNaN(tt.getTime())) continue;
      const mins = Math.abs(tt.getTime() - now.getTime()) / 60000;
      if (mins <= 40 && mins < best) {
        best = mins;
        const typ = (ext.type || "").toLowerCase();
        slackKind = typ.charAt(0) === "h" ? "high" : "low";
      }
    }
    const fromDeg = Number(buoy.windDeg);
    const ue = -Math.sin((fromDeg * Math.PI) / 180);
    let verdict, detail;
    if (slackKind === "high") {
      verdict = "slack_high";
      detail = "Slack high. Tide is standing near high.";
    } else if (slackKind === "low") {
      verdict = "slack_low";
      detail = "Slack low. Tide is standing near low.";
    } else if (Math.abs(ue) < 0.35) {
      verdict = "cross";
      detail = "Wind is mostly north/south. Not really with or against the east-west tide.";
    } else if (ue * currentEast > 0) {
      verdict = "with";
      detail = "Wind and tide are moving the same way.";
    } else {
      verdict = "against";
      detail = "Wind against tide.";
    }
    const labels = {
      with: "Wind with tide",
      against: "Wind against tide",
      cross: "Cross tide",
      slack_high: "Slack high",
      slack_low: "Slack low",
      turning: "Tide turning",
    };
    return {
      verdict: verdict,
      label: labels[verdict],
      tide: currentName,
      waterMoves: currentDir,
      windFrom: buoy.windDir,
      windDeg: buoy.windDeg,
      detail: detail,
    };
  }


  /** ET wall-clock → epoch ms (uses parseNoaaEt / etParts). */
  function etWallMs(base, dayOff, hour, minute) {
    const approx = new Date(etMidnight(base).getTime() + dayOff * 86400000 + 12 * 3600000);
    const p = etParts(approx);
    const dt = parseNoaaEt(
      p.y + "-" + pad(p.mo) + "-" + pad(p.d) + " " + pad(hour) + ":" + pad(minute || 0)
    );
    return dt ? dt.getTime() : null;
  }

  function etWeekdayUpper(d) {
    return new Intl.DateTimeFormat("en-US", { timeZone: ET, weekday: "long" })
      .format(d)
      .toUpperCase();
  }

  /**
   * Map a CWF period name to {start,end} epoch ms in ET, or null if unknown.
   * Empty name → [now, now+4h] (near-term catch-all).
   */
  function periodTimeRange(name, now) {
    now = now || new Date();
    const raw = String(name == null ? "" : name).trim();
    if (!raw) {
      const t = now.getTime();
      return { start: t, end: t + 4 * 3600 * 1000 };
    }
    const n = raw.toUpperCase().replace(/\s+/g, " ").trim();
    const pNow = etParts(now);

    if (/^(EARLY |LATE )?THIS MORNING$/.test(n)) {
      return { start: etWallMs(now, 0, 5, 0), end: etWallMs(now, 0, 12, 0) };
    }
    if (/^(REST OF )?THIS AFTERNOON$/.test(n)) {
      return { start: etWallMs(now, 0, 12, 0), end: etWallMs(now, 0, 18, 0) };
    }
    if (n === "THIS EVENING") {
      return { start: etWallMs(now, 0, 18, 0), end: etWallMs(now, 0, 22, 0) };
    }
    // OVERNIGHT: after 18:00 → next calendar morning 00–06; else tonight 18→06
    if (n === "OVERNIGHT") {
      if (pNow.h >= 18) {
        return { start: etWallMs(now, 1, 0, 0), end: etWallMs(now, 1, 6, 0) };
      }
      return { start: etWallMs(now, 0, 18, 0), end: etWallMs(now, 1, 6, 0) };
    }
    if (n === "TONIGHT" || n === "REST OF TONIGHT") {
      return { start: etWallMs(now, 0, 18, 0), end: etWallMs(now, 1, 6, 0) };
    }
    if (n === "TODAY" || n === "REST OF TODAY") {
      const dayStart = etWallMs(now, 0, 6, 0);
      const dayEnd = etWallMs(now, 0, 18, 0);
      const start = Math.max(now.getTime(), dayStart);
      return { start: start, end: dayEnd };
    }

    const WEEKDAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
    let isNight = false;
    let dayToken = null;
    const nightM = n.match(/^([A-Z]+) NIGHT$/);
    if (nightM && WEEKDAYS.indexOf(nightM[1]) >= 0) {
      dayToken = nightM[1];
      isNight = true;
    } else if (WEEKDAYS.indexOf(n) >= 0) {
      dayToken = n;
      isNight = false;
    }
    if (dayToken) {
      for (let i = 0; i < 8; i++) {
        const approx = new Date(etMidnight(now).getTime() + i * 86400000 + 12 * 3600000);
        if (etWeekdayUpper(approx) !== dayToken) continue;
        if (isNight) {
          return { start: etWallMs(now, i, 18, 0), end: etWallMs(now, i + 1, 6, 0) };
        }
        return { start: etWallMs(now, i, 6, 0), end: etWallMs(now, i, 18, 0) };
      }
      return null;
    }

    // Unknown named period
    return null;
  }

  /**
   * Periods whose ET range overlaps [now, now+hours]. Default hours=4.
   * Sanity: at 08:00 ET, TONIGHT is excluded; THIS MORNING and THIS AFTERNOON
   * (window touches 12:00) are included. At 19:00 ET, TONIGHT is included.
   */
  function periodsInNextHours(periods, hours, now) {
    if (hours == null || hours === undefined) hours = 4;
    now = now || new Date();
    const t0 = now.getTime();
    const t1 = t0 + hours * 3600 * 1000;
    return (periods || []).filter(function (p) {
      const r = periodTimeRange(p && p.name, now);
      if (!r) return false;
      return r.start <= t1 && r.end > t0;
    });
  }

  function parseWaveFt(marine) {
    if (!marine) return [null, null];
    const periods = marine.periods || [];
    if (!periods.length) return [null, null];
    const text = periods[0].text || "";
    const m = text.match(/waves?\s+(\d+(?:\.\d+)?)(?:\s*(?:to|-)\s*(\d+(?:\.\d+)?))?\s*ft/i);
    if (!m) return [null, text];
    return [parseFloat(m[2] || m[1]), text];
  }

  function gfmt(n) { return String(Number(n)); }

  function driftStoplight(flow) {
    const rank = { green: 0, yellow: 1, red: 2 };
    if (!flow) return { color: "yellow", factors: [] };
    const factors = [];
    const v = flow.verdict;
    if (v === "against") factors.push(["wind-vs-tide", "red", "Wind against tide"]);
    else if (v === "with") factors.push(["wind-vs-tide", "green", "Wind with tide"]);
    else if (v === "slack_high" || v === "turning") {
      factors.push(["wind-vs-tide", "green", v === "slack_high" ? "Slack high" : "Tide turning"]);
    } else if (v === "slack_low") factors.push(["wind-vs-tide", "green", "Slack low"]);
    else if (v === "cross" || v) factors.push(["wind-vs-tide", "yellow", flow.label || "Cross tide"]);
    let color = "green";
    for (const f of factors) {
      if (rank[f[1]] > rank[color]) color = f[1];
    }
    if (!factors.length) color = "yellow";
    return {
      color: color,
      factors: factors.map(function (f) { return { id: f[0], color: f[1], text: f[2] }; }),
    };
  }

  function stoplight(buoy, marine, flow, alerts) {
    const rank = { green: 0, yellow: 1, red: 2 };
    const factors = [];

    const kt = (buoy || {}).windKt;
    if (kt != null) {
      const mph = mphOf(kt);
      if (kt > 15) factors.push(["wind", "red", mph + " mph"]);
      else if (kt < 10) factors.push(["wind", "green", mph + " mph"]);
      else factors.push(["wind", "yellow", mph + " mph"]);
    }

    // Near-term CWF only (~next 4 hours) so evening tstm/rain do not paint a fine morning yellow/red.
    const allPeriods = ((marine || {}).periods || []);
    let near = periodsInNextHours(allPeriods, 4);
    if (!near.length && allPeriods.length) near = [allPeriods[0]];
    const marineNear = { periods: near };

    const wave = parseWaveFt(marineNear)[0];
    if (wave != null) {
      if (wave > 2) factors.push(["waves", "red", gfmt(wave) + " ft"]);
      else if (wave <= 1) factors.push(["waves", "green", gfmt(wave) + " ft or less"]);
      else factors.push(["waves", "yellow", gfmt(wave) + " ft"]);
    }

    const blob = near.map(function (p) {
      return (p.text || "") + " " + (p.name || "");
    }).join(" ").toLowerCase();
    const alertBlob = (alerts || []).map(function (a) {
      return (a.event || "") + " " + (a.headline || "");
    }).join(" ").toLowerCase();
    const alltxt = blob + " " + alertBlob;

    const hasLightning = /\blightning\b/.test(alltxt);
    const hasTstm = /\b(tstm|tstms|thunder|thunderstorms?|t-storms?)\b/.test(alltxt);
    if (hasLightning) factors.push(["lightning", "red", "Lightning"]);
    else if (hasTstm) factors.push(["tstm", "yellow", "Thunderstorms in the forecast"]);

    let hasMarineWarn = false;
    for (const a of alerts || []) {
      const ev = ((a.event || "") + " " + (a.headline || "")).toLowerCase();
      if (ev.indexOf("rip current") >= 0) continue;
      if (/\bstatement\b/.test(ev) && !/\b(watch|warning)\b/.test(ev) && ev.indexOf("special weather") < 0) continue;
      if (
        ev.indexOf("special weather") >= 0 ||
        ev.indexOf("special marine") >= 0 ||
        ev.indexOf("small craft") >= 0 ||
        /\bgale\b/.test(ev) ||
        ev.indexOf("hurricane") >= 0 ||
        ev.indexOf("storm warning") >= 0 ||
        ev.indexOf("storm watch") >= 0 ||
        /\b(watch|warning)\b/.test(ev)
      ) {
        hasMarineWarn = true;
        factors.push(["marine-warning", "red", (a.event || "Marine warning").trim()]);
        break;
      }
    }
    if (!hasMarineWarn && /special weather|special marine|small craft|\bgale\b|storm warning|hurricane/.test(alltxt)) {
      const label = alltxt.indexOf("special weather") >= 0 ? "Special Weather Statement" : "Marine watch/warning";
      factors.push(["marine-warning", "red", label]);
    }

    const hasDenseFog = /dense fog/.test(alltxt);
    const hasPatchyFog = /patchy fog/.test(alltxt);
    const hasFog = /\bfog\b/.test(alltxt);
    if (hasDenseFog) factors.push(["fog", "red", "Dense fog"]);
    else if (hasPatchyFog) factors.push(["fog", "yellow", "Patchy fog"]);

    const rainHits = [];
    const rainRe = /\b((?:light\s+)?)(rain|showers?|drizzle)\b/g;
    let rm;
    while ((rm = rainRe.exec(alltxt))) rainHits.push(rm);
    const hasLightRain = rainHits.some(function (x) { return String(x[1] || "").trim() === "light"; });
    const hasRain = rainHits.some(function (x) { return String(x[1] || "").trim() !== "light"; });
    if (hasRain) factors.push(["rain", "yellow", "Rain in the forecast"]);
    else if (hasLightRain) factors.push(["rain", "green", "Light rain"]);

    const hasFair = /\b(clear|sunny|fair|partly cloudy|mostly cloudy|mostly sunny|cloudy)\b/.test(alltxt);
    if (hasFair && !hasTstm && !hasRain && !hasLightRain && !hasFog) {
      factors.push(["sky", "green", "Fair / cloudy skies"]);
    }

    let color = "green";
    for (const f of factors) {
      if (rank[f[1]] > rank[color]) color = f[1];
    }
    return {
      color: color,
      factors: factors.map(function (f) { return { id: f[0], color: f[1], text: f[2] }; }),
    };
  }

  async function getText(url, opts) {
    const r = await fetch(url, Object.assign({ cache: "no-store" }, opts || {}));
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.text();
  }

  async function getJson(url, opts) {
    return JSON.parse(await getText(url, opts));
  }

  async function fetchBuoy() {
    try {
      return parseBuoy(await getText(BUOY_URL));
    } catch (e1) {
      try {
        return parseBuoy(await getText(BUOY_CORS_SH));
      } catch (eCors) {
        try {
          const snap = await getJson("./buoy.json?t=" + Date.now());
          if (snap && snap.windKt != null) {
            if (snap.observedIso) {
              const t = Date.parse(snap.observedIso);
              if (!Number.isNaN(t)) snap.ageMin = Math.floor((Date.now() - t) / 60000);
            }
            return snap;
          }
          throw new Error("buoy snapshot missing windKt");
        } catch (e2) {
          try {
            return parseNws44069(
              await getJson(NWS_44069, {
                headers: {
                  Accept: "application/geo+json",
                  "User-Agent": "GSBBay/1.0",
                },
              })
            );
          } catch (e3) {
            // Direct SoMAS has no CORS; allorigins is last-resort for THAT HTML PAGE ONLY.
            return parseBuoy(await getText(BUOY_PROXY));
          }
        }
      }
    }
  }

  async function fetchMarine() {
    try {
      const list = await getJson(CWF_LIST, { headers: { Accept: "application/ld+json" } });
      const graph = list["@graph"] || [];
      if (!graph.length) throw new Error("no CWF products");
      const url = graph[0]["@id"] || "https://api.weather.gov/products/" + graph[0].id;
      const prod = await getJson(url, { headers: { Accept: "application/ld+json" } });
      const parsed = parseMarine(prod.productText || "");
      parsed.source = CWF_LIST;
      return parsed;
    } catch (e) {
      const parsed = parseMarine(await getText(MARINE_TGFTP));
      parsed.source = MARINE_TGFTP;
      return parsed;
    }
  }

  async function fetchTides() {
    const now = new Date();
    const start = new Date(now.getTime() - 6 * 3600 * 1000);
    const end = new Date(now.getTime() + 48 * 3600 * 1000);
    const hiloUrl = TIDES_BASE + "&interval=hilo&begin_date=" + yyyymmddEt(start) + "&end_date=" + yyyymmddEt(end);
    const tides = parseTides(await getJson(hiloUrl));
    const day0 = etMidnight(now);
    const dayStamp = yyyymmddEt(day0);
    const curveUrl = TIDES_BASE + "&interval=6&begin_date=" + dayStamp + "&end_date=" + dayStamp;
    try {
      const curveRaw = await getJson(curveUrl);
      const curve = [];
      for (const p of curveRaw.predictions || []) {
        const t = parseNoaaEt(p.t);
        if (!t) continue;
        const mins = Math.floor((t.getTime() - day0.getTime()) / 60000);
        curve.push({ m: mins, v: Math.round(parseFloat(p.v) * 1000) / 1000 });
      }
      tides.curve = curve;
      const dp = etParts(day0);
      tides.day = dp.y + "-" + pad(dp.mo) + "-" + pad(dp.d);
      tides.nowMin = Math.floor((now.getTime() - day0.getTime()) / 60000);
    } catch (ce) {
      tides.curve = [];
      tides._curveError = String(ce && ce.message ? ce.message : ce);
    }
    return tides;
  }

  async function fetchAlerts() {
    const data = await getJson(ALERTS_URL, { headers: { Accept: "application/geo+json" } });
    const out = [];
    for (const f of data.features || []) {
      const p = f.properties || {};
      const event = p.event || "";
      if (event.toLowerCase().indexOf("rip current") >= 0) continue;
      out.push({ event: event, headline: p.headline || event, severity: p.severity });
    }
    return out;
  }

  async function gather() {
    const out = {
      ok: true,
      fetchedAt: toEtIso(new Date()),
      place: PLACE,
      buoy: null,
      marine: null,
      tides: null,
      alerts: [],
      radar: {
        site: "KOKX",
        label: "NWS Upton radar",
        loop: "https://radar.weather.gov/ridge/standard/KOKX_loop.gif",
        latest: "https://radar.weather.gov/ridge/standard/KOKX_0.gif",
        page: "https://radar.weather.gov/station/KOKX",
      },
      errors: [],
    };

    await Promise.all([
      fetchBuoy().then(function (b) { out.buoy = b; }).catch(function (e) {
        out.errors.push("buoy: " + (e && e.message ? e.message : e));
      }),
      fetchMarine().then(function (m) { out.marine = m; }).catch(function (e) {
        out.errors.push("marine: " + (e && e.message ? e.message : e));
      }),
      fetchTides().then(function (t) {
        out.tides = t;
        if (t && t._curveError) {
          out.errors.push("tide-curve: " + t._curveError);
          delete t._curveError;
        }
      }).catch(function (e) {
        out.errors.push("tides: " + (e && e.message ? e.message : e));
      }),
      fetchAlerts().then(function (a) { out.alerts = a; }).catch(function (e) {
        out.errors.push("alerts: " + (e && e.message ? e.message : e));
      }),
    ]);

    try { out.flow = windTideFlow(out.buoy, out.tides); }
    catch (e) { out.errors.push("flow: " + (e && e.message ? e.message : e)); out.flow = null; }
    try { out.drift = driftStoplight(out.flow); }
    catch (e) {
      out.errors.push("drift: " + (e && e.message ? e.message : e));
      out.drift = { color: "yellow", factors: [] };
    }
    try { out.stoplight = stoplight(out.buoy, out.marine, out.flow, out.alerts); }
    catch (e) {
      out.errors.push("stoplight: " + (e && e.message ? e.message : e));
      out.stoplight = { color: "yellow", factors: [] };
    }
    if (out.buoy && Object.prototype.hasOwnProperty.call(out.buoy, "windKt")) {
      out.buoy.windMph = mphOf(out.buoy.windKt);
      out.buoy.gustMph = mphOf(out.buoy.gustKt);
    }
    if (out.tides && typeof out.tides === "object") out.tides.moon = moonPhase();
    else out.moon = moonPhase();
    return out;
  }

  window.GSB = {
    gather: gather,
    parseBuoy: parseBuoy,
    parseNws44069: parseNws44069,
    parseMarine: parseMarine,
    parseTides: parseTides,
    stoplight: stoplight,
    driftStoplight: driftStoplight,
    windTideFlow: windTideFlow,
    moonPhase: moonPhase,
    mphOf: mphOf,
    periodTimeRange: periodTimeRange,
    periodsInNextHours: periodsInNextHours,
  };
})();
