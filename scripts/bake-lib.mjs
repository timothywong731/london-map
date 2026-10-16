// Bake helpers shared by build-data.mjs and build-planned.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

export const CACHE = '.cache';
fs.mkdirSync(CACHE, { recursive: true });
export const GEOID = 46; // EGM96 undulation over London: Terrarium (MSL) -> Cesium (ellipsoid)

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function cached(name, fetcher) {
  const f = path.join(CACHE, name);
  if (fs.existsSync(f)) return fs.readFileSync(f);
  const buf = await fetcher();
  fs.writeFileSync(f, buf);
  return buf;
}

export async function get(url, opts = {}, tries = 5) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'london-map-bake/1.0' }, ...opts });
      if (!r.ok) throw new Error(`${r.status} ${url.slice(0, 80)}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (i >= tries) throw e;
      console.warn('retry', i + 1, e.message);
      await sleep(5000 * (i + 1));
    }
  }
}

export const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
export async function overpass(name, q) {
  const buf = await cached('osm_' + name + '.json', async () => {
    for (let i = 0; ; i++) {
      const url = OVERPASS[i % OVERPASS.length];
      try {
        const b = await get(url, { method: 'POST', body: new URLSearchParams({ data: q }) }, 0);
        JSON.parse(b); // reject HTML error pages
        return b;
      } catch (e) {
        if (i > 8) throw e;
        console.warn('overpass retry', name, e.message);
        await sleep(15000);
      }
    }
  });
  return JSON.parse(buf);
}

// ---------- geometry helpers ----------
export const R = 6371008.8;
export const rad = Math.PI / 180;
export function metres(a, b) {
  const x = (b[0] - a[0]) * rad * Math.cos(((a[1] + b[1]) / 2) * rad);
  const y = (b[1] - a[1]) * rad;
  return Math.hypot(x, y) * R;
}
export const inBox = (p, b) => p[1] >= b.s && p[1] <= b.n && p[0] >= b.w && p[0] <= b.e;

// Douglas-Peucker on [lon,lat] in a local metric frame, keeping index list.
export function simplifyIdx(pts, tol) {
  if (pts.length < 3) return pts.map((_, i) => i);
  const k = Math.cos(pts[0][1] * rad) * rad * R, m = rad * R;
  const xy = pts.map((p) => [p[0] * k, p[1] * m]);
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let best = 0, bi = -1;
    const [ax, ay] = xy[a], [bx, by] = xy[b];
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((xy[i][0] - ax) * dy - (xy[i][1] - ay) * dx) / L;
      if (d > best) (best = d), (bi = i);
    }
    if (best > tol) {
      keep[bi] = 1;
      stack.push([a, bi], [bi, b]);
    }
  }
  return [...keep.keys()].filter((i) => keep[i]);
}

// ---------- terrain (AWS Terrarium, z12 ≈ 38 m) ----------
const TZ = 12;
const tiles = new Map();
const lon2x = (lon) => ((lon + 180) / 360) * 2 ** TZ;
const lat2y = (lat) => ((1 - Math.log(Math.tan(lat * rad) + 1 / Math.cos(lat * rad)) / Math.PI) / 2) * 2 ** TZ;
async function loadTileSet(keys) {
  const jobs = [...keys].filter((k) => !tiles.has(k)).map((k) => async () => {
    const [x, y] = k.split('/');
    const buf = await cached(`dem_${TZ}_${x}_${y}.png`, () => get(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${TZ}/${x}/${y}.png`));
    tiles.set(k, PNG.sync.read(buf));
  });
  for (let i = 0; i < jobs.length; i += 16) await Promise.all(jobs.slice(i, i + 16).map((j) => j()));
  return jobs.length;
}
export function loadTiles(b) {
  const keys = new Set();
  for (let x = Math.floor(lon2x(b.w)); x <= Math.floor(lon2x(b.e)); x++)
    for (let y = Math.floor(lat2y(b.n)); y <= Math.floor(lat2y(b.s)); y++) keys.add(`${x}/${y}`);
  return loadTileSet(keys);
}
export const loadTilesFor = (pts) => loadTileSet(new Set(pts.map(([lon, lat]) => `${Math.floor(lon2x(lon))}/${Math.floor(lat2y(lat))}`)));
export function ground(lon, lat) {
  const fx = lon2x(lon), fy = lat2y(lat);
  const t = tiles.get(`${Math.floor(fx)}/${Math.floor(fy)}`);
  if (!t) return GEOID;
  const px = Math.min(255, Math.floor((fx % 1) * 256)), py = Math.min(255, Math.floor((fy % 1) * 256));
  const i = (py * 256 + px) * 4, d = t.data;
  return d[i] * 256 + d[i + 1] + d[i + 2] / 256 - 32768 + GEOID;
}

export function wayKind(t) {
  if (t.tunnel && t.tunnel !== 'no') return 'tunnel';
  if (t.bridge && t.bridge !== 'no') return 'bridge';
  if (t.embankment === 'yes') return 'embankment';
  return 'surface';
}
export const RAMP = 250; // metres over which a tunnel descends from its portal
