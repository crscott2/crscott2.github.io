/* GSB Conditions — wall-frame (1280x800) view. Reuses window.GSB.gather() from ../app.js.
   Plain ES2017, no build step; targets old Android WebView (Chromium ~106). */
(function () {
  "use strict";

  var ET = "America/New_York";
  var LAT = 40.738, LNG = -73.052;           // Bayport / Patchogue
  var DATA_EVERY_MS = 5 * 60 * 1000;          // data refresh
  var RELOAD_EVERY_MS = 60 * 60 * 1000;       // full page reload (pick up deploys)
  var STALE_AFTER_MS = 20 * 60 * 1000;        // no successful refresh for this long → stale
  var SHIFT_EVERY_MS = 3 * 60 * 1000;         // anti burn-in drift
  var params = parseQuery();
  var lastGood = null, lastGoodAt = 0, lastTryFailed = false, loading = false;
  var startedAt = Date.now();

  function $(id) { return document.getElementById(id); }
  function parseQuery() {
    var o = {};
    location.search.replace(/^\?/, "").split("&").forEach(function (kv) {
      if (!kv) return;
      var p = kv.split("=");
      o[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || "");
    });
    return o;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function num(n) { return n == null || isNaN(n) ? null : Number(n); }
  function r0(n) { n = num(n); return n == null ? "—" : String(Math.round(n)); }
  function clockEt(d, withAmPm) {
    var s = new Intl.DateTimeFormat("en-US", { timeZone: ET, hour: "numeric", minute: "2-digit", hour12: true })
      .format(d).replace(/\u202f|\u00a0/g, " ");
    return withAmPm === false ? s.replace(/\s?[AP]M$/i, "") : s;
  }
  function ampmEt(d) { var m = clockEt(d).match(/[AP]M$/i); return m ? m[0] : ""; }
  function dateEt(d) {
    return new Intl.DateTimeFormat("en-US", { timeZone: ET, weekday: "long", month: "short", day: "numeric" }).format(d);
  }
  function hourEt(d) {
    return new Intl.DateTimeFormat("en-US", { timeZone: ET, hour: "numeric", hour12: true }).format(d).replace(/\u202f|\u00a0/g, " ");
  }
  function minsSinceMidnightEt(d) {
    var p = new Intl.DateTimeFormat("en-US", { timeZone: ET, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
    var h = 0, m = 0;
    p.forEach(function (x) { if (x.type === "hour") h = +x.value % 24; if (x.type === "minute") m = +x.value; });
    return h * 60 + m;
  }

  /* ---------- fit 1280x800 stage to whatever the viewport is ---------- */
  function fit() {
    var w = window.innerWidth || 1280, h = window.innerHeight || 800;
    var s = Math.min(w / 1280, h / 800);
    var st = $("stage");
    var x = Math.max(0, (w - 1280 * s) / 2), y = Math.max(0, (h - 800 * s) / 2);
    var t = "translate(" + x + "px," + y + "px) scale(" + s + ")";
    st.style.webkitTransform = t; st.style.transform = t;
  }

  /* ---------- night mode (sunset → sunrise, with 9pm–6am fallback) ---------- */
  function sunTimes(date) {
    var rad = Math.PI / 180, dayMs = 86400000, J1970 = 2440588, J2000 = 2451545;
    var d = date.getTime() / dayMs - 0.5 + J1970 - J2000;
    var lw = rad * -LNG, phi = rad * LAT;
    var n = Math.round(d - 0.0009 - lw / (2 * Math.PI));
    var ds = 0.0009 + lw / (2 * Math.PI) + n;
    var M = rad * (357.5291 + 0.98560028 * ds);
    var C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    var L = M + C + rad * 102.9372 + Math.PI;
    var dec = Math.asin(Math.sin(L) * Math.sin(rad * 23.4397));
    var Jnoon = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
    var w = Math.acos((Math.sin(rad * -0.833) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)));
    var a = 0.0009 + (w + lw) / (2 * Math.PI) + n;
    var Jset = J2000 + a + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
    var Jrise = Jnoon - (Jset - Jnoon);
    function fromJ(j) { return new Date((j + 0.5 - J1970) * dayMs); }
    return { rise: fromJ(Jrise), set: fromJ(Jset) };
  }
  function isNight(now) {
    if (params.theme === "night") return true;
    if (params.theme === "day") return false;
    try {
      var st = sunTimes(now);
      if (!isNaN(st.rise.getTime()) && !isNaN(st.set.getTime())) {
        var pad = 20 * 60000; // stay bright ~20 min past sunset / go bright ~20 min before sunrise
        return now.getTime() > st.set.getTime() + pad || now.getTime() < st.rise.getTime() - pad;
      }
    } catch (e) {}
    var m = minsSinceMidnightEt(now);
    return m >= 21 * 60 || m < 6 * 60;
  }
  function applyTheme() {
    var night = isNight(new Date());
    var has = /\bnight\b/.test(document.body.className);
    if (night !== has) document.body.className = night ? "night" : "";
  }

  /* ---------- anti burn-in: drift inner frame within ±10px / ±8px ---------- */
  var shiftStep = 0;
  function shift() {
    if (params.noshift) return;
    shiftStep++;
    var x = Math.round(Math.sin(shiftStep * 0.9) * 10);
    var y = Math.round(Math.cos(shiftStep * 0.7) * 8);
    var t = "translate(" + x + "px," + y + "px)";
    var el = $("inner");
    el.style.webkitTransform = t; el.style.transform = t;
  }

  /* ---------- clock ---------- */
  function tickClock() {
    var now = new Date();
    $("time").innerHTML = esc(clockEt(now, false)) + "<small>" + esc(ampmEt(now)) + "</small>";
    $("date").textContent = dateEt(now);
    renderStatus();
  }

  /* ---------- wind dial ---------- */
  function dialSvg(fromDeg, mph) {
    var cx = 150, cy = 150, R = 128, s = "";
    s += '<circle cx="150" cy="150" r="' + R + '" fill="none" stroke="var(--line)" stroke-width="2"/>';
    for (var i = 0; i < 72; i++) {
      var a = i * 5 * Math.PI / 180, long = i % 18 === 0, mid = i % 9 === 0;
      var r1 = R - (long ? 16 : mid ? 11 : 6);
      s += '<line x1="' + (cx + Math.sin(a) * r1).toFixed(1) + '" y1="' + (cy - Math.cos(a) * r1).toFixed(1) +
        '" x2="' + (cx + Math.sin(a) * R).toFixed(1) + '" y2="' + (cy - Math.cos(a) * R).toFixed(1) +
        '" stroke="var(--cream2)" stroke-opacity="' + (long ? 0.9 : mid ? 0.6 : 0.3) + '" stroke-width="' + (long ? 3 : 1.5) + '"/>';
    }
    [["N", 0], ["E", 90], ["S", 180], ["W", 270]].forEach(function (c) {
      var a = c[1] * Math.PI / 180, rr = R - 34;
      s += '<text x="' + (cx + Math.sin(a) * rr).toFixed(1) + '" y="' + (cy - Math.cos(a) * rr + 9).toFixed(1) +
        '" text-anchor="middle" font-size="26" font-weight="600" fill="var(--brass)" font-family="Oswald, Arial Narrow, sans-serif">' + c[0] + "</text>";
    });
    if (fromDeg != null && !isNaN(fromDeg)) {
      // Arrow shows where the wind is blowing TO (tail on the "from" side of the ring).
      var to = (Number(fromDeg) + 180) % 360;
      s += '<g transform="rotate(' + to + ' 150 150)">' +
        '<line x1="150" y1="226" x2="150" y2="96" stroke="var(--hi)" stroke-width="10" stroke-linecap="round"/>' +
        '<polygon points="150,52 124,104 176,104" fill="var(--hi)"/>' +
        '<circle cx="150" cy="232" r="9" fill="var(--brass)"/>' +
        "</g>";
    }
    return s;
  }

  /* ---------- waves from NWS coastal waters forecast ---------- */
  function wavesOf(marine) {
    var periods = (marine && marine.periods) || [];
    if (!periods.length) return null;
    var near = periods;
    try { near = window.GSB.periodsInNextHours(periods, 4); } catch (e) {}
    if (!near.length) near = [periods[0]];
    var text = near[0].text || "";
    var m = text.match(/waves?\s+(?:around\s+)?(\d+(?:\.\d+)?)(?:\s*(?:to|-)\s*(\d+(?:\.\d+)?))?\s*(?:ft|feet)(\s+or\s+less)?/i);
    if (!m) return { label: null, period: near[0].name };
    var label = m[3] ? "≤" + m[1] : (m[2] ? m[1] + "–" + m[2] : m[1]);
    return { label: label, period: near[0].name };
  }

  /* ---------- tide chart ---------- */
  function tideSvg(t, w, h) {
    var curve = (t && t.curve) || [];
    if (curve.length < 4) return '<div class="muted" style="font-size:20px;padding-top:60px;text-align:center">Tide curve unavailable</div>';
    var pad = { l: 8, r: 8, t: 34, b: 30 };
    var vs = curve.map(function (p) { return p.v; });
    var vmin = Math.min.apply(null, vs), vmax = Math.max.apply(null, vs);
    var span = Math.max(0.4, vmax - vmin);
    vmin -= span * 0.08; vmax += span * 0.12;
    function x(m) { return pad.l + (m / 1440) * (w - pad.l - pad.r); }
    function y(v) { return pad.t + (1 - (v - vmin) / (vmax - vmin)) * (h - pad.t - pad.b); }
    var d = curve.map(function (p, i) { return (i ? "L" : "M") + x(p.m).toFixed(1) + "," + y(p.v).toFixed(1); }).join(" ");
    var area = d + " L" + x(curve[curve.length - 1].m).toFixed(1) + "," + (h - pad.b) + " L" + x(curve[0].m).toFixed(1) + "," + (h - pad.b) + " Z";
    var s = "";
    [0, 180, 360, 540, 720, 900, 1080, 1260, 1440].forEach(function (m) {
      s += '<line x1="' + x(m) + '" x2="' + x(m) + '" y1="' + pad.t + '" y2="' + (h - pad.b) + '" stroke="var(--tide-grid)" stroke-width="1"/>';
      if (m % 360 === 0) {
        var lbl = m === 0 || m === 1440 ? "12a" : m === 720 ? "12p" : m < 720 ? (m / 60) + "a" : ((m - 720) / 60) + "p";
        var anchor = m === 0 ? "start" : m === 1440 ? "end" : "middle";
        s += '<text x="' + x(m) + '" y="' + (h - 6) + '" text-anchor="' + anchor + '" font-size="17" fill="var(--muted)">' + lbl + "</text>";
      }
    });
    s += '<path d="' + area + '" fill="var(--tide-fill)"/>';
    s += '<path d="' + d + '" fill="none" stroke="var(--tide-line)" stroke-width="3.5" stroke-linejoin="round"/>';
    (t.extremes || []).forEach(function (e) {
      if (!e || !e.iso || !t.day || e.iso.indexOf(t.day) !== 0) return;
      var pm = e.iso.match(/T(\d{2}):(\d{2})/);
      if (!pm) return;
      var m = (+pm[1]) * 60 + (+pm[2]);
      var xx = x(m), yy = y(e.ft);
      var hi = e.type === "High";
      var ty = hi ? yy - 12 : yy + 24;
      if (ty > h - pad.b - 2) ty = yy - 12;
      var anchor = xx < 50 ? "start" : xx > w - 50 ? "end" : "middle";
      s += '<circle cx="' + xx.toFixed(1) + '" cy="' + yy.toFixed(1) + '" r="5" fill="var(--hi)"/>';
      s += '<text x="' + xx.toFixed(1) + '" y="' + ty.toFixed(1) + '" text-anchor="' + anchor + '" font-size="18" font-weight="600" fill="var(--cream)">' +
        (hi ? "H " : "L ") + esc(e.time.replace(/:00 /, " ").replace(" ", "").toLowerCase()) + "</text>";
    });
    var nowM = minsSinceMidnightEt(new Date());
    s += '<line x1="' + x(nowM) + '" x2="' + x(nowM) + '" y1="' + (pad.t - 6) + '" y2="' + (h - pad.b) + '" stroke="var(--now)" stroke-width="3" stroke-dasharray="6 5"/>';
    // dot on curve at now
    var best = curve[0];
    curve.forEach(function (p) { if (Math.abs(p.m - nowM) < Math.abs(best.m - nowM)) best = p; });
    s += '<circle cx="' + x(nowM).toFixed(1) + '" cy="' + y(best.v).toFixed(1) + '" r="8" fill="var(--now)" stroke="var(--card2)" stroke-width="3"/>';
    var left = nowM > 1100;
    var ny = Math.min(h - pad.b - 8, Math.max(pad.t + 14, y(best.v) + 6));
    s += '<text x="' + (x(nowM) + (left ? -16 : 16)).toFixed(1) + '" y="' + ny.toFixed(1) + '" text-anchor="' + (left ? "end" : "start") +
      '" font-size="18" font-weight="600" fill="var(--now)">NOW ' + best.v.toFixed(1) + " ft</text>";
    return '<svg viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" font-family="Oswald, Arial Narrow, sans-serif">' + s + "</svg>";
  }

  /* ---------- render ---------- */
  function render(d) {
    var b = d.buoy || {}, t = d.tides || {}, fl = d.flow || {}, sl = d.stoplight || {};
    var color = sl.color || "yellow";
    $("lamps").className = "lamps on-" + color;
    $("go-word").textContent = color === "green" ? "Good to go" : color === "red" ? "Stay in" : "Use caution";
    $("go-why").textContent = (sl.factors || []).map(function (f) { return f.text; }).filter(Boolean).join(" · ");

    var mph = b.windMph != null ? b.windMph : (num(b.windKt) != null ? Math.round(b.windKt * 1.150779) : null);
    var gust = b.gustMph != null ? b.gustMph : (num(b.gustKt) != null ? Math.round(b.gustKt * 1.150779) : null);
    $("wind-mph").textContent = mph == null ? "—" : mph;
    $("gust-mph").textContent = gust == null ? "—" : gust;
    $("wind-kt").textContent = num(b.windKt) != null ? "(" + Math.round(b.windKt) + "/" + r0(b.gustKt) + " kt)" : "";
    $("wind-dir").textContent = b.windDir || "—";
    $("wind-deg").textContent = num(b.windDeg) != null ? Math.round(b.windDeg) + "°" : "";
    $("dial").innerHTML = dialSvg(num(b.windDeg), mph);

    $("water").textContent = num(b.waterF) != null ? Math.round(b.waterF) + "°" : "—";
    $("water-note").textContent = b.waterNote || "";
    $("air").textContent = num(b.airF) != null ? Math.round(b.airF) + "°" : "—";
    var wv = wavesOf(d.marine);
    $("waves").textContent = wv && wv.label ? wv.label : "—";
    $("waves-unit").textContent = wv && wv.label ? "ft" : "";

    if (fl.label) {
      $("flow").className = "flow " + (fl.verdict || "");
      $("flow").textContent = fl.label;
      var tideWord = fl.tide ? fl.tide.charAt(0).toUpperCase() + fl.tide.slice(1) : "";
      $("flow-sub").textContent = tideWord + (fl.waterMoves ? " · water " + fl.waterMoves : "");
    } else {
      $("flow").className = "flow"; $("flow").textContent = "—"; $("flow-sub").textContent = "";
    }

    // next few hours of sky / rain (Weather Underground hourly, NWS fallback)
    var hours = ((d.hourly && d.hourly.hours) || []).slice(0, 3);
    $("wx").innerHTML = hours.length ? '<div class="k" style="font-size:15px">Next hours</div>' + hours.map(function (h) {
      var pop = h.precipChance != null && Number(h.precipChance) > 0 ? Math.round(h.precipChance) + "%" : "";
      return '<div class="wx-row"><span>' + esc(hourEt(new Date(h.start))) + "</span><span>" + esc(h.phrase || "—") + "</span><span>" + esc(pop) + "</span></div>";
    }).join("") : "";

    // tide
    var st = t.state;
    $("tide-state").innerHTML = st ? '<span class="arrow">' + (st === "rising" ? "▲" : "▼") + "</span> " + esc(st.charAt(0).toUpperCase() + st.slice(1)) : "—";
    var nx = [t.nextHigh, t.nextLow].filter(Boolean).sort(function (a, c) { return Date.parse(a.iso) - Date.parse(c.iso); });
    $("tide-next").innerHTML = nx.map(function (e) {
      return '<div><span class="lbl">' + (e.type === "High" ? "High" : "Low") + "</span><b>" + esc(e.time) + '</b> <span class="muted ft">' + e.ft.toFixed(1) + " ft</span></div>";
    }).join("") + (t.moon && t.moon.name ? '<div class="muted" style="font-size:18px;margin-top:4px">' + esc(t.moon.name) + "</div>" : "");
    var box = $("tide-chart");
    $("tide-chart").innerHTML = tideSvg(t, Math.max(300, box.clientWidth || 520), Math.max(160, box.clientHeight || 300));

    // alerts (rip current already filtered by app.js)
    var al = d.alerts || [];
    var ab = $("alert");
    if (al.length) {
      ab.innerHTML = "⚠ " + al.map(function (a) {
        return esc(a.event || "Alert") + (a.window ? '<span class="when">' + esc(a.window) + "</span>" : "");
      }).join(" &nbsp;·&nbsp; ");
      ab.className = "show";
    } else {
      ab.className = ""; ab.innerHTML = "";
    }
  }

  function renderStatus() {
    var now = Date.now();
    var stale = false, parts = [];
    if (!lastGoodAt) {
      parts.push(lastTryFailed ? "Can't reach data — retrying" : "Loading…");
      stale = lastTryFailed;
    } else {
      var ageMin = Math.floor((now - lastGoodAt) / 60000);
      parts.push("Updated " + clockEt(new Date(lastGoodAt)) + " ET" + (ageMin >= 2 ? " (" + ageMin + " min ago)" : ""));
      var b = (lastGood && lastGood.buoy) || {};
      if (b.observedIso) {
        var oa = Math.floor((now - Date.parse(b.observedIso)) / 60000);
        parts.push("buoy reading " + clockEt(new Date(Date.parse(b.observedIso))) + " ET" + (isNaN(oa) ? "" : " (" + oa + " min ago)"));
        if (oa > 90) stale = true;
      } else if (!lastGood || !lastGood.buoy) {
        parts.push("buoy unavailable"); stale = true;
      }
      if (now - lastGoodAt > STALE_AFTER_MS || lastTryFailed) stale = true;
    }
    $("updated").textContent = parts.join(" · ");
    $("stale").className = stale ? "badge show" : "badge";
  }

  // When app.js falls back to NWS 44069 (no water temp), backfill water temp
  // from the Actions-built ../buoy.json if it's from the last 6 hours.
  function waterBackfill(d) {
    if (!d || !d.buoy || num(d.buoy.waterF) != null) return Promise.resolve(d);
    return fetch("../buoy.json?t=" + Date.now(), { cache: "no-store" }).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (snap) {
      if (snap && num(snap.waterF) != null && snap.observedIso) {
        var age = (Date.now() - Date.parse(snap.observedIso)) / 60000;
        if (age >= 0 && age <= 360) { d.buoy.waterF = snap.waterF; d.buoy.waterNote = "as of " + clockEt(new Date(Date.parse(snap.observedIso))); }
      }
      return d;
    }).catch(function () { return d; });
  }

  function refresh() {
    if (loading || !window.GSB || !window.GSB.gather) { lastTryFailed = !window.GSB; renderStatus(); return; }
    loading = true;
    window.GSB.gather().then(waterBackfill).then(function (d) {
      loading = false;
      var usable = d && (d.buoy || d.tides || d.marine);
      if (!usable) throw new Error("no data: " + ((d && d.errors) || []).join("; "));
      // Keep last good buoy if only the buoy failed this round.
      if (!d.buoy && lastGood && lastGood.buoy) d.buoy = lastGood.buoy;
      lastGood = d; lastGoodAt = Date.now(); lastTryFailed = false;
      try { render(d); } catch (e) { if (window.console) console.warn("render", e); }
      renderStatus();
      if (d.errors && d.errors.length && window.console) console.info("GSB partial errors:", d.errors.join(" | "));
    }).catch(function (e) {
      loading = false; lastTryFailed = true; renderStatus();
      if (window.console) console.warn("GSB refresh failed", e);
    });
  }

  // Hourly: reload page to pick up deploys, but only if the page is reachable
  // (so a network blip never leaves the frame on a browser error page).
  function maybeReload() {
    if (Date.now() - startedAt < RELOAD_EVERY_MS - 1000) return;
    fetch(location.pathname + "?ping=" + Date.now(), { cache: "no-store" }).then(function (r) {
      if (r.ok) location.reload();
    }).catch(function () {});
  }

  window.addEventListener("resize", function () { fit(); if (lastGood) render(lastGood); });
  // Tap anywhere = refresh now.
  document.addEventListener("click", function () { refresh(); });
  document.addEventListener("visibilitychange", function () { if (!document.hidden) refresh(); });

  fit();
  applyTheme();
  tickClock();
  refresh();
  setInterval(tickClock, 15000);
  setInterval(applyTheme, 60000);
  setInterval(refresh, DATA_EVERY_MS);
  setInterval(maybeReload, 5 * 60000);
  setInterval(shift, SHIFT_EVERY_MS);
  // Redraw the tide "now" marker every minute between data refreshes.
  setInterval(function () { if (lastGood) { try { render(lastGood); } catch (e) {} } }, 60000);

  window.GSBFrame = { refresh: refresh, isNight: isNight, sunTimes: sunTimes };
})();
