# GSB buoy Worker (Cloudflare Workers, free plan)

Serves clean, fresh buoy JSON to the GSB Conditions app, replacing the slow GitHub Action and the dead public CORS proxies.

- **Primary source:** the SoMAS GSB Buoy #1 page (`B1RT.html`), parsed the same way as `scripts/fetch_buoy.py`.
- **Fallback:** NOAA NDBC 44069 realtime text, which is the same buoy and includes water temp. Whichever feed has the newer reading wins, and missing water temp is filled from the other feed if it's under 6 hours old (labeled with `waterAsOf`).
- **Caching:** results are cached for 5 minutes, so traffic to SoMAS and NOAA stays tiny.
- **CORS:** allows `https://crscott2.github.io`, plus localhost:8765 for testing.
- **Response:** the same fields as `buoy.json`, plus `sourceLabel`, `observedIso` and `via: "worker"`.

## Turn it on in the app
After deploying, set `WORKER_URL` near the top of `app.js` to the Worker URL, e.g.
`const WORKER_URL = "https://gsb-buoy.<your-subdomain>.workers.dev/";`
then bump the version. While it's empty, nothing changes. When set, the Worker becomes the first buoy source, `buoy.json` and the Action remain as backup, and backup wind (KISP/KHWV/Open-Meteo) still applies if the buoy itself is stale.

## Deploy, easiest way (dashboard, no tools)
1. Log in at https://dash.cloudflare.com
2. In the left menu, go to **Compute (Workers)** → **Workers & Pages** → **Create** → **Create Worker** (start from "Hello World").
3. Name it `gsb-buoy` → **Deploy**.
4. Click **Edit code**, delete everything, paste the whole contents of `worker.js`, and click **Deploy**.
5. Copy the URL shown (`https://gsb-buoy.<something>.workers.dev`) and send it back to set `WORKER_URL`.

## Deploy with wrangler (CLI)
```
npm i -g wrangler
cd worker
CLOUDFLARE_API_TOKEN=... npx wrangler deploy
```
The token comes from **My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" template**.

## Local test
```
npx wrangler@3 dev --local --port 8787
curl -H 'Origin: https://crscott2.github.io' http://localhost:8787/
```
