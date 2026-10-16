// Bakes data/*.json from TfL Unified API + OpenStreetMap (Overpass) + AWS Terrarium DEM.
// Raw responses are cached in .cache/ so re-runs are fast and Overpass is hit once.
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { contours } from 'd3-contour';
import { LINES, OPERATORS } from '../lines.js';

const CACHE = '.cache';
const OUT = 'data';
fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

// Whole network box (Elizabeth line reaches Reading & Shenfield, Met to Chesham).
const BBOX = { s: 51.25, w: -1.0, n: 51.73, e: 0.36 };
// National Rail is clipped to roughly what TfL's rail & tube services map shows.
const NR_BOX = { s: 51.28, w: -0.56, n: 51.70, e: 0.33 };
const GEOID = 46; // EGM96 undulation over London: Terrarium (MSL) -> Cesium (ellipsoid)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cached(name, fetcher) {
  const f = path.join(CACHE, name);
  if (fs.existsSync(f)) return fs.readFileSync(f);
  const buf = await fetcher();
  fs.writeFileSync(f, buf);
  return buf;
}

async function get(url, opts = {}, tries = 5) {
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

const tfl = async (p) => JSON.parse(await cached('tfl_' + p.replace(/\W+/g, '_') + '.json', () => get('https://api.tfl.gov.uk' + p)));

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
async function overpass(name, q) {
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
const R = 6371008.8;
const rad = Math.PI / 180;
function metres(a, b) {
  const x = (b[0] - a[0]) * rad * Math.cos(((a[1] + b[1]) / 2) * rad);
  const y = (b[1] - a[1]) * rad;
  return Math.hypot(x, y) * R;
}
const inBox = (p, b) => p[1] >= b.s && p[1] <= b.n && p[0] >= b.w && p[0] <= b.e;

// Douglas-Peucker on [lon,lat] in a local metric frame, keeping index list.
function simplifyIdx(pts, tol) {
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
async function loadTiles() {
  const x0 = Math.floor(lon2x(BBOX.w)), x1 = Math.floor(lon2x(BBOX.e));
  const y0 = Math.floor(lat2y(BBOX.n)), y1 = Math.floor(lat2y(BBOX.s));
  const jobs = [];
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      jobs.push(async () => {
        const buf = await cached(`dem_${TZ}_${x}_${y}.png`, () => get(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${TZ}/${x}/${y}.png`));
        tiles.set(`${x}/${y}`, PNG.sync.read(buf));
      });
  for (let i = 0; i < jobs.length; i += 16) await Promise.all(jobs.slice(i, i + 16).map((j) => j()));
  console.log('terrain tiles', jobs.length);
}
function ground(lon, lat) {
  const fx = lon2x(lon), fy = lat2y(lat);
  const t = tiles.get(`${Math.floor(fx)}/${Math.floor(fy)}`);
  if (!t) return GEOID;
  const px = Math.min(255, Math.floor((fx % 1) * 256)), py = Math.min(255, Math.floor((fy % 1) * 256));
  const i = (py * 256 + px) * 4, d = t.data;
  return d[i] * 256 + d[i + 1] + d[i + 2] / 256 - 32768 + GEOID;
}

// ---------- OSM ----------
const box = (b) => `(${b.s},${b.w},${b.n},${b.e})`;
async function fetchOsm() {
  const parts = {
    tube: `rel["route"="subway"]${box(BBOX)};`,
    light: `rel["route"~"^(light_rail|tram)$"]${box(BBOX)};`,
    train: `rel["route"="train"]${box(BBOX)};`,
  };
  const rels = [], ways = new Map();
  for (const [name, sel] of Object.entries(parts)) {
    const j = await overpass(name, `[out:json][timeout:600][maxsize:1073741824];${sel}out body;way(r)${box(BBOX)};out body geom;`);
    for (const e of j.elements) {
      if (e.type === 'relation') rels.push(e);
      else if (e.type === 'way' && e.geometry) ways.set(e.id, e);
    }
    console.log('osm', name, j.elements.length);
  }
  return { rels, ways };
}

// Map an OSM route relation to one of our line ids (or null).
function classify(rel) {
  const t = rel.tags || {};
  const hay = [t.name, t.ref, t.network, t.operator, t.brand, t['public_transport:version'] && ''].join(' | ');
  for (const l of LINES) if (l.osm && l.osm.test(hay) && (!l.route || l.route.test(t.route))) return l.id;
  if (t.route !== 'train') return null;
  if (/eurostar|caledonian sleeper|postal/i.test(hay)) return null;
  for (const o of OPERATORS) if (o.osm.test(hay)) return o.id;
  return null;
}

// Chain a relation's member ways into the longest continuous polyline of node coords.
function chain(rel, ways) {
  const pieces = [];
  let cur = null;
  for (const m of rel.members) {
    if (m.type !== 'way' || /platform|stop/.test(m.role)) continue;
    const w = ways.get(m.ref);
    if (!w) { cur = null; continue; }
    const pts = w.geometry.map((g, i) => ({ id: w.nodes[i], p: [g.lon, g.lat] }));
    if (!cur) { cur = pts.slice(); pieces.push(cur); continue; }
    const end = cur[cur.length - 1].id;
    if (pts[0].id === end) cur.push(...pts.slice(1));
    else if (pts[pts.length - 1].id === end) cur.push(...pts.reverse().slice(1));
    else if (cur[0].id === pts[0].id || cur[0].id === pts[pts.length - 1].id) {
      cur.reverse();
      if (pts[0].id !== cur[cur.length - 1].id) pts.reverse();
      cur.push(...pts.slice(1));
    } else { cur = pts.slice(); pieces.push(cur); }
  }
  let best = [], bestLen = 0;
  for (const pc of pieces) {
    let L = 0;
    for (let i = 1; i < pc.length; i++) L += metres(pc[i - 1].p, pc[i].p);
    if (L > bestLen) (best = pc), (bestLen = L);
  }
  return { pts: best, len: bestLen };
}

// ---------- vertical profile (indicative) ----------
const DEPTH = { subsurface: -10, deep: -25, elizabeth: -30, other: -10 };
function tunnelDepth(lineId, layer) {
  const l = LINES.find((x) => x.id === lineId);
  const base = DEPTH[l?.depth || 'other'];
  return base * (1 + 0.25 * Math.max(0, Math.abs(layer || 1) - 1));
}
function wayKind(t) {
  if (t.tunnel && t.tunnel !== 'no') return 'tunnel';
  if (t.bridge && t.bridge !== 'no') return 'bridge';
  if (t.embankment === 'yes') return 'embankment';
  return 'surface';
}
const RAMP = 250; // metres over which a tunnel descends from its portal

async function main() {
  await loadTiles();
  const { rels, ways } = await fetchOsm();

  // node -> kinds of ways touching it, to find tunnel portals
  const nodeKinds = new Map();
  for (const w of ways.values()) {
    const k = wayKind(w.tags || {});
    for (const n of [w.nodes[0], w.nodes[w.nodes.length - 1]]) {
      if (!nodeKinds.has(n)) nodeKinds.set(n, new Set());
      nodeKinds.get(n).add(k);
    }
  }
  const isPortal = (n) => { const s = nodeKinds.get(n); return s && [...s].some((k) => k !== 'tunnel'); };

  // assign ways + routes to lines
  const lineWays = new Map(), lineRoutes = new Map(), wayLines = new Map();
  for (const rel of rels) {
    const id = classify(rel);
    if (!id) continue;
    if (!lineWays.has(id)) lineWays.set(id, new Set()), lineRoutes.set(id, []);
    const isNR = OPERATORS.some((o) => o.id === id);
    for (const m of rel.members) {
      const w = m.type === 'way' && ways.get(m.ref);
      if (!w || /platform|stop/.test(m.role)) continue;
      if (isNR && !w.geometry.some((g) => inBox([g.lon, g.lat], NR_BOX))) continue;
      lineWays.get(id).add(w.id);
      if (!wayLines.has(w.id)) wayLines.set(w.id, []);
      if (!wayLines.get(w.id).includes(id)) wayLines.get(w.id).push(id);
    }
    lineRoutes.get(id).push(chain(rel, ways));
  }

  // height of a vertex for a given line on a given way
  function heights(w, lineId, pts) {
    const kind = wayKind(w.tags || {});
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + metres(pts[i - 1], pts[i]));
    const total = cum[cum.length - 1];
    const startPortal = isPortal(w.nodes[0]), endPortal = isPortal(w.nodes[w.nodes.length - 1]);
    return pts.map((p, i) => {
      const g = ground(p[0], p[1]);
      if (kind === 'bridge') return g + 8;
      if (kind === 'embankment') return g + 4;
      if (kind !== 'tunnel') return g + 2;
      const d = tunnelDepth(lineId, +(w.tags.layer || -1));
      let f = 1;
      if (startPortal) f = Math.min(f, cum[i] / RAMP);
      if (endPortal) f = Math.min(f, (total - cum[i]) / RAMP);
      return g + 2 + (d - 2) * Math.max(0, Math.min(1, f));
    });
  }

  // lateral offset so lines sharing track sit side by side (TfL-map style)
  const SPACING = 7;
  function offset(pts, k) {
    if (!k) return pts;
    return pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const kx = Math.cos(p[1] * rad);
      let dx = (b[0] - a[0]) * kx, dy = b[1] - a[1];
      const L = Math.hypot(dx, dy) || 1;
      dx /= L; dy /= L;
      const s = (k / R) / rad; // metres -> degrees
      return [p[0] - dy * s / kx, p[1] + dx * s];
    });
  }

  const r5 = (v) => Math.round(v * 1e5) / 1e5, r1 = (v) => Math.round(v * 10) / 10;
  const out = [];
  const nodeH = new Map(); // lineId:nodeId -> height, so trains follow the same vertical profile
  for (const def of [...LINES, ...OPERATORS]) {
    const ids = lineWays.get(def.id);
    const segs = [];
    if (ids) {
      for (const wid of ids) {
        const w = ways.get(wid);
        let pts = w.geometry.map((g) => [g.lon, g.lat]);
        const hsFull = heights(w, def.id, pts);
        w.nodes.forEach((n, i) => nodeH.set(def.id + ':' + n, hsFull[i]));
        const keep = simplifyIdx(pts, 3);
        pts = keep.map((i) => pts[i]);
        const hs = keep.map((i) => hsFull[i]);
        const shared = wayLines.get(wid);
        const k = (shared.indexOf(def.id) - (shared.length - 1) / 2) * SPACING;
        pts = offset(pts, k);
        segs.push({ t: wayKind(w.tags || {}) === 'tunnel' ? 1 : 0, c: pts.flatMap((p, i) => [r5(p[0]), r5(p[1]), r1(hs[i])]) });
      }
    }
    // train routes: up to 4 longest distinct chains, heights from the matching way kinds
    const routes = (lineRoutes.get(def.id) || [])
      .filter((r) => r.len > 1500)
      .sort((a, b) => b.len - a.len)
      .filter((r, i, arr) => arr.slice(0, i).every((o) => Math.abs(o.len - r.len) > 800))
      .slice(0, def.mode === 'national-rail' ? 2 : 4)
      .map((r) => {
        let pts = r.pts;
        if (def.mode === 'national-rail') {
          const inside = pts.map((x) => inBox(x.p, NR_BOX));
          pts = pts.slice(inside.indexOf(true), inside.lastIndexOf(true) + 1);
        }
        const keep = simplifyIdx(pts.map((x) => x.p), 4);
        return keep.map((i) => pts[i]).flatMap(({ id, p }) => [r5(p[0]), r5(p[1]), r1(nodeH.get(def.id + ':' + id) ?? ground(p[0], p[1]) + 2)]);
      })
      .filter((r) => r.length >= 6);
    if (!segs.length) console.warn('NO GEOMETRY for', def.id);
    out.push({ id: def.id, name: def.name, mode: def.mode, colour: def.colour, segs, routes });
  }

  // cable car: OSM aerialway not in route relations — use TfL's (straight) geometry
  const cc = out.find((l) => l.id === 'london-cable-car');
  if (cc && !cc.segs.length) {
    const seq = await tfl('/Line/london-cable-car/Route/Sequence/outbound');
    const pts = JSON.parse(seq.lineStrings[0])[0];
    const c = pts.flatMap((p, i) => [p[0], p[1], ground(p[0], p[1]) + 60]);
    cc.segs.push({ t: 0, c });
    cc.routes.push(c);
  }

  // ---------- stations ----------
  const stations = new Map();
  const naptanKey = new Map(); // TfL stop id -> our station key (hub code when there is one)
  const clean = (n) => n.replace(/ (Underground|Rail|DLR|Tram|Elizabeth line)? ?Station.*$/i, '').replace(/ Tram Stop$/i, '').replace(/\s*\(London\)$/, '').replace(/ \(.*?\)$/, (m) => m).trim();
  for (const def of [...LINES, ...OPERATORS]) {
    const sp = await tfl(`/Line/${def.tflId || def.id}/StopPoints`).catch(() => []);
    for (const p of sp) {
      if (!inBox([p.lon, p.lat], def.mode === 'national-rail' ? NR_BOX : BBOX)) continue;
      // tram stops come per platform with no hub: merge them by name
      const key = p.hubNaptanCode || (def.mode === 'tram' ? 'TRAM:' + clean(p.commonName) : p.id);
      naptanKey.set(p.id, key);
      const zone = (p.additionalProperties || []).find((a) => a.key === 'Zone')?.value;
      const zs = (zone || '').split(/[/+]/).map(Number).filter((n) => n >= 1 && n <= 9);
      let s = stations.get(key);
      if (!s) {
        s = { id: key, name: clean(p.commonName), lon: r5(p.lon), lat: r5(p.lat), zones: [], lines: [] };
        stations.set(key, s);
      }
      for (const z of zs) if (!s.zones.includes(z)) s.zones.push(z);
      if (!s.lines.includes(def.id)) s.lines.push(def.id);
    }
  }
  const stationList = [...stations.values()].map((s) => ({ ...s, zones: s.zones.sort(), h: r1(ground(s.lon, s.lat)) }));
  console.log('stations', stationList.length);

  // ---------- journey-time graph: consecutive calls on every TfL service pattern ----------
  // Run time = dwell + track-ish distance / running speed. Express patterns add skip-stop edges.
  const RUN_KMH = { tube: 42, 'elizabeth-line': 60, overground: 45, 'national-rail': 70, dlr: 35, tram: 25, 'cable-car': 7 };
  const index = new Map(stationList.map((st, i) => [st.id, i]));
  const best = new Map(); // "a|b|line" -> minutes
  const allDefs = [...LINES, ...OPERATORS];
  for (const [li, def] of allDefs.entries()) {
    const seq = await tfl(`/Line/${def.id}/Route/Sequence/all`).catch(() => null);
    if (!seq) continue;
    for (const sps of seq.stopPointSequences || [])
      for (const sp of sps.stopPoint) if (def.mode === 'tram' && !naptanKey.has(sp.id) && index.has('TRAM:' + clean(sp.name))) naptanKey.set(sp.id, 'TRAM:' + clean(sp.name));
    for (const sps of seq.stopPointSequences || [])
      for (const sp of sps.stopPoint) for (const k of [sp.id, sp.stationId, sp.topMostParentId]) if (!naptanKey.has(k) && index.has(sp.topMostParentId)) naptanKey.set(k, sp.topMostParentId);
    for (const r of seq.orderedLineRoutes || [])
      addCalls(r.naptanIds.map((n) => index.get(naptanKey.get(n) ?? n)).filter((i) => i !== undefined), li, def.mode);
  }
  // OSM route relations list stops in order: fills patterns TfL's API lacks (e.g. Bexleyheath line)
  const nodeLL = new Map();
  for (const w of ways.values()) w.nodes.forEach((n, i) => nodeLL.set(n, [w.geometry[i].lon, w.geometry[i].lat]));
  for (const rel of rels) {
    const li = allDefs.findIndex((d) => d.id === classify(rel));
    if (li < 0) continue;
    const cand = stationList.map((_, i) => i).filter((i) => stationList[i].lines.includes(allDefs[li].id));
    const calls = [];
    for (const m of rel.members) {
      const p = m.type === 'node' && /^stop/.test(m.role) && nodeLL.get(m.ref);
      if (!p) continue;
      let bi = -1, bd = 400;
      for (const i of cand) { const d = metres(p, [stationList[i].lon, stationList[i].lat]); if (d < bd) (bd = d), (bi = i); }
      if (bi >= 0 && calls[calls.length - 1] !== bi) calls.push(bi);
    }
    addCalls(calls, li, allDefs[li].mode);
  }
  function addCalls(calls, li, mode) {
    for (let i = 1; i < calls.length; i++) {
      const a = calls[i - 1], b = calls[i];
      if (a === b) continue;
      const A = stationList[a], B = stationList[b];
      const km = (metres([A.lon, A.lat], [B.lon, B.lat]) * 1.2) / 1000;
      const min = 0.6 + (km / RUN_KMH[mode]) * 60;
      for (const key of [`${a}|${b}|${li}`, `${b}|${a}|${li}`]) best.set(key, Math.min(best.get(key) ?? Infinity, min));
    }
  }
  const edges = [...best].map(([k, m]) => { const [a, b, l] = k.split('|').map(Number); return [a, b, l, Math.round(m * 10) / 10]; });
  console.log('graph edges', edges.length, 'stations linked', new Set(edges.map((e) => e[0])).size, '/', stationList.length);

  // ---------- zones: smooth nested contours of "zone <= k" ----------
  const zStations = stationList.filter((s) => s.zones.length);
  const G = 160; // grid cell metres
  const zb = { s: 51.22, w: -0.75, n: 51.76, e: 0.45 };
  const W = Math.ceil(metres([zb.w, zb.s], [zb.e, zb.s]) / G), H = Math.ceil(metres([zb.w, zb.s], [zb.w, zb.n]) / G);
  const cellLL = (i, j) => [zb.w + ((i + 0.5) / W) * (zb.e - zb.w), zb.s + ((j + 0.5) / H) * (zb.n - zb.s)];
  // per cell: lowest zone among stations within MARGIN, falling back to nearest station's zone
  const MARGIN = 900;
  const REACH = 3500; // beyond this from any zoned station, outside all zones
  const zoneOf = new Float32Array(W * H);
  const kx = Math.cos(51.5 * rad) * rad * R, ky = rad * R;
  const sxy = zStations.map((s) => [s.lon * kx, s.lat * ky, Math.min(...s.zones)]);
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const [lon, lat] = cellLL(i, j);
      const x = lon * kx, y = lat * ky;
      let best = Infinity, bz = 99, near = 99;
      for (const [sx, sy, z] of sxy) {
        const d = Math.hypot(sx - x, sy - y);
        if (d < best) (best = d), (bz = z);
        if (d < MARGIN && z < near) near = z;
      }
      zoneOf[j * W + i] = best > REACH ? 99 : Math.min(bz, near);
    }
  // box blur the per-zone mask so contours come out smooth
  function blurMask(k) {
    let a = Float64Array.from(zoneOf, (z) => (z <= k ? 1 : 0));
    const r = 4;
    for (let pass = 0; pass < 3; pass++) {
      const b = new Float64Array(a.length);
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        let s = 0, n = 0;
        for (let d = -r; d <= r; d++) { const ii = i + d; if (ii >= 0 && ii < W) { s += a[j * W + ii]; n++; } }
        b[j * W + i] = s / n;
      }
      const c = new Float64Array(a.length);
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        let s = 0, n = 0;
        for (let d = -r; d <= r; d++) { const jj = j + d; if (jj >= 0 && jj < H) { s += b[jj * W + i]; n++; } }
        c[j * W + i] = s / n;
      }
      a = c;
    }
    return a;
  }
  const zones = [];
  for (let k = 1; k <= 9; k++) {
    if (!zStations.some((s) => Math.min(...s.zones) === k)) continue;
    const [mp] = contours().size([W, H]).thresholds([0.5])(blurMask(k));
    const rings = mp.coordinates
      .map((poly) => poly[0]) // outer rings only: zone k's footprint is "<= k"
      .filter((ring) => ring.length > 12)
      .map((ring) => {
        const ll = ring.map(([x, y]) => [zb.w + (x / W) * (zb.e - zb.w), zb.s + (y / H) * (zb.n - zb.s)]);
        const open = ll.slice(0, -1); // closed ring would collapse in Douglas-Peucker
        return simplifyIdx(open, 25).flatMap((i) => [r5(open[i][0]), r5(open[i][1])]);
      });
    zones.push({ zone: k, rings });
  }
  console.log('zones', zones.map((z) => `${z.zone}:${z.rings.length}`).join(' '));

  const write = (f, v) => {
    fs.writeFileSync(path.join(OUT, f), JSON.stringify(v));
    console.log(f, (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0), 'KB');
  };
  write('lines.json', out);
  write('stations.json', stationList);
  write('zones.json', zones);
  write('graph.json', { lines: allDefs.map((d) => d.id), edges });
}

main().catch((e) => { console.error(e); process.exit(1); });
