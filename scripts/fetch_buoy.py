#!/usr/bin/env python3
"""Fetch SoMAS GSB Buoy #1 HTML and write same-origin buoy.json for GitHub Pages."""
from __future__ import annotations

import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "buoy.json"
URL = "https://po.somas.stonybrook.edu/GSB/B1RT.html"
UA = "GSBBay/1.0 (crscott2@gmail.com)"
ET = ZoneInfo("America/New_York")


def fetch(url: str, timeout: int = 20) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def parse_buoy(html: str) -> dict:
    def cell(label: str) -> str | None:
        m = re.search(
            rf"<strong>{re.escape(label)}:</strong></td>\s*<td[^>]*>(.*?)</td>",
            html,
            re.I | re.S,
        )
        if not m:
            return None
        text = re.sub(r"<[^>]+>", " ", m.group(1))
        return re.sub(r"\s+", " ", text).strip()

    date_s = cell("Date")
    time_s = cell("Time")
    observed = None
    if date_s and time_s:
        t = re.sub(r"\s*GMT", "", time_s).strip()
        try:
            gmt = datetime.strptime(f"{date_s} {t}", "%m-%d-%Y %H:%M:%S").replace(
                tzinfo=timezone.utc
            )
            observed = gmt.astimezone(ET)
        except ValueError:
            observed = None

    def fnum(s: str | None) -> float | None:
        if not s:
            return None
        m = re.search(r"(-?\d+(?:\.\d+)?)", s)
        return float(m.group(1)) if m else None

    air = cell("Air Temperature") or ""
    water = cell("Water Temperature") or ""
    air_f = fnum(re.search(r"\(([^)]*F)", air).group(1) if "F" in air else air)
    water_f = fnum(re.search(r"\(([^)]*F)", water).group(1) if "F" in water else water)
    wind_dir = cell("Wind Direction") or ""
    compass = None
    deg = None
    cm = re.search(r"from the\s+([A-Z]+)", wind_dir)
    if cm:
        compass = cm.group(1)
    dm = re.search(r"(\d+)\s*o", wind_dir.replace("°", "o"))
    if dm:
        deg = int(dm.group(1))

    age_min = None
    if observed:
        age_min = int((datetime.now(ET) - observed).total_seconds() / 60)

    if observed:
        hour12 = observed.hour % 12 or 12
        ampm = "AM" if observed.hour < 12 else "PM"
        observed_et = f"{hour12}:{observed.minute:02d} {ampm}"
        observed_iso = observed.isoformat()
    else:
        observed_et = None
        observed_iso = None

    return {
        "name": "GSB Buoy #1",
        "source": URL,
        "observedEt": observed_et,
        "observedIso": observed_iso,
        "ageMin": age_min,
        "windKt": fnum(cell("Wind Speed")),
        "gustKt": fnum(cell("Wind Gust")),
        "windDir": compass,
        "windDeg": deg,
        "airF": air_f,
        "waterF": water_f,
        "humidity": fnum(cell("Humidity")),
    }


def main() -> int:
    if len(sys.argv) > 1:
        html = Path(sys.argv[1]).read_text(encoding="utf-8", errors="replace")
    else:
        html = fetch(URL).decode("utf-8", "replace")
    payload = parse_buoy(html)
    payload["fetchedAt"] = datetime.now(ET).isoformat()
    OUT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {OUT} observedEt={payload.get('observedEt')} windKt={payload.get('windKt')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
