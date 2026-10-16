// Bakes data/planned.json: planned railways routed over OSM track through their stops in order.
// Vertical profile is indicative, from OSM tunnel/bridge tags, as in build-data.mjs.
import fs from 'node:fs';
import { PLANNED } from '../lines.js';
import { overpass, metres, rad, simplifyIdx, loadTilesFor, ground, wayKind, RAMP } from './bake-lib.mjs';

const stations = JSON.parse(fs.readFileSync('data/stations.json', 'utf8'));
const box = (b) => `(${b.s},${b.w},${b.n},${b.e})`;
const r5 = (v) => Math.round(v * 1e5) / 1e5, r1 = (v) => Math.round(v * 10) / 10;
const GAP = 60;    // join way ends this close to another way's node (construction mapping has gaps)
const SNAP = 600;  // a station must be this close to track
const SNAP_WP = 1500;
const DEPTH = -25; // HS2/WLO tunnels: "deep" class

// Graph over OSM ways: node id -> [[node id, metres, way id]]
function buildGraph(ways) {
  const ll = new Map(), adj = new Map();
  const link = (a, b, m, w) => {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push([b, m, w]);
    adj.get(b).push([a, m, w]);
  };
  for (const w of ways) w.nodes.forEach((n, i) => {
    ll.set(n, [w.geometry[i].lon, w.geometry[i].lat]);
    if (i) link(w.nodes[i - 1], n, metres(ll.get(w.nodes[i - 1]), ll.get(n)), w.id);
  });
  // bridge small gaps: each way end to the nearest node in a different way not already near by track within GAP
  // ponytail: O(ends x nodes) scan, fine for ~1k ways; grid-hash if the corridor grows
  const all = [...ll];
  const wayOf = new Map();
  for (const w of ways) for (const n of w.nodes) wayOf.set(n, w.id);
  for (const w of ways) for (const end of [w.nodes[0], w.nodes.at(-1)]) {
    // skip nodes already reachable along track within 100 m (catches gaps between parallel tracks too)
    const near = new Set([end]), q = [[end, 0]];
    for (const [x, d] of q) for (const [m, w] of adj.get(x)) if (!near.has(m) && d + w < 100) (near.add(m), q.push([m, d + w]));
    let best = null, bd = GAP;
    for (const [n, p] of all) {
      if (near.has(n) || wayOf.get(n) === w.id) continue;
      const d = metres(ll.get(end), p);
      if (d < bd) (bd = d), (best = n);
    }
    if (best) { link(end, best, bd, w.id); }
  }
  return { ll, adj };
}

function nearestNode(g, p, max) {
  let best = null, bd = max;
  for (const [n, q] of g.ll) { const d = metres(p, q); if (d < bd) (bd = d), (best = n); }
  return best;
}

// Dijkstra; returns [{ node, way }] from a to b (way = the way of the edge arriving at node)
function path(g, a, b) {
  const dist = new Map([[a, 0]]), prev = new Map(), done = new Set();
  const heap = [[0, a]];
  while (heap.length) {
    let mi = 0;
    for (let i = 1; i < heap.length; i++) if (heap[i][0] < heap[mi][0]) mi = i; // ponytail: linear-scan PQ, fine for <100k nodes
    const [d, n] = heap.splice(mi, 1)[0];
    if (done.has(n)) continue;
    done.add(n);
    if (n === b) break;
    for (const [m, w, way] of g.adj.get(n) || []) {
      const nd = d + w;
      if (nd < (dist.get(m) ?? Infinity)) { dist.set(m, nd); prev.set(m, [n, way]); heap.push([nd, m]); }
    }
  }
  if (!done.has(b)) return null;
  const out = [];
  for (let n = b; n !== a; n = prev.get(n)[0]) out.push({ node: n, way: prev.get(n)[1] });
  out.push({ node: a, way: out.at(-1)?.way });
  return out.reverse();
}

// Route through stops in order; heights with tunnel ramps; split into tunnel / surface runs
function route(g, waysById, stops, label, onto) {
  const nodes = stops.map((s, i) => {
    if (i === 0 && onto) { // a branch starts on the main route: nearest node of the main path
      let b = null, bd = Infinity;
      for (const m of onto) { const d = metres([s.lon, s.lat], g.ll.get(m)); if (d < bd) (bd = d), (b = m); }
      return b;
    }
    const n = nearestNode(g, [s.lon, s.lat], s.waypoint ? SNAP_WP : SNAP);
    if (!n) throw new Error(`${label}: no track within ${s.waypoint ? SNAP_WP : SNAP} m of ${s.name}`);
    return n;
  });
  const steps = [];
  for (let i = 1; i < nodes.length; i++) {
    const p = path(g, nodes[i - 1], nodes[i]);
    if (!p) throw new Error(`${label}: no track path ${stops[i - 1].name} -> ${stops[i].name} (add a waypoint)`);
    steps.push(...(i > 1 ? p.slice(1) : p));
  }
  const pts = steps.map((s) => g.ll.get(s.node));
  const tun = steps.map((s) => wayKind(waysById.get(s.way)?.tags || {}) === 'tunnel');
  const kind = steps.map((s) => wayKind(waysById.get(s.way)?.tags || {}));
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + metres(pts[i - 1], pts[i]));
  return { pts, tun, kind, cum, ids: steps.map((s) => s.node) };
}

function heightsAndSegs(r, extra = {}) {
  const { pts, tun, kind, cum } = r;
  const hs = pts.map((p, i) => {
    const g = ground(p[0], p[1]);
    if (kind[i] === 'bridge') return g + 8;
    if (kind[i] === 'embankment') return g + 4;
    if (!tun[i]) return g + 2;
    let s = i, e = i; // this tunnel run's extent, for portal ramps
    while (s > 0 && tun[s - 1]) s--;
    while (e < pts.length - 1 && tun[e + 1]) e++;
    const f = Math.min(1, (cum[i] - cum[s]) / RAMP, (cum[e] - cum[i]) / RAMP);
    return g + 2 + (DEPTH - 2) * Math.max(0, f);
  });
  const segs = [];
  for (let i = 0; i < pts.length; ) {
    let j = i;
    while (j + 1 < pts.length && tun[j + 1] === tun[i]) j++;
    const a = Math.max(0, i - 1), sub = pts.slice(a, j + 1), subH = hs.slice(a, j + 1); // overlap 1 pt so runs join
    const keep = simplifyIdx(sub, 3);
    segs.push({ t: tun[i] ? 1 : 0, ...extra, c: keep.flatMap((k) => [r5(sub[k][0]), r5(sub[k][1]), r1(subH[k])]) });
    i = j + 1;
  }
  return segs;
}

async function main() {
  const out = { lines: [], stations: [], models: [] };
  for (const def of PLANNED) {
    const stops = def.stops.map((s) => {
      const ex = s.lon === undefined ? stations.find((x) => x.name === s.name) : null;
      if (s.lon === undefined && !ex) throw new Error(`${def.id}: existing station "${s.name}" not in stations.json`);
      return { ...s, lon: s.hs2Lon ?? s.lon ?? ex.lon, lat: s.hs2Lat ?? s.lat ?? ex.lat, existing: ex?.id ?? null };
    });
    const j = await overpass('planned_' + def.id, `[out:json][timeout:600];${def.osm.select}${box(def.osm.bbox)};out body geom;`);
    const ways = j.elements.filter((e) => e.type === 'way' && e.geometry);
    const waysById = new Map(ways.map((w) => [w.id, w]));
    const g = buildGraph(ways);
    const main = route(g, waysById, stops, def.id);
    const branches = def.branches.map((b, i) => route(g, waysById, b, `${def.id} branch ${i}`, main.ids));
    console.log(def.id, 'ways', ways.length, 'main km', (main.cum.at(-1) / 1000).toFixed(1), 'branches km', branches.map((b) => (b.cum.at(-1) / 1000).toFixed(1)).join(','));
    console.log('terrain tiles', await loadTilesFor([...main.pts, ...branches.flatMap((b) => b.pts)]));
    const segs = [...heightsAndSegs(main), ...branches.flatMap((b) => heightsAndSegs(b, { branch: true }))];
    out.lines.push({ id: def.id, name: def.name, mode: def.mode, colour: def.colour, opens: def.opens, width: def.width, segs });
    for (const s of stops.filter((x) => !x.waypoint)) {
      const prev = out.stations.find((x) => x.name === s.name && x.existing === s.existing);
      if (prev) { prev.lines.push(def.id); continue; }
      out.stations.push({ id: 'PLANNED:' + s.name, name: s.name, lon: r5(s.lon), lat: r5(s.lat), h: r1(ground(s.lon, s.lat)),
        lines: [def.id], also: s.also || [], existing: s.existing, opens: def.opens });
    }
    if (def.id === 'hs2') {
      const ooc = stops[1], i = main.pts.reduce((bi, p, k) => (metres(p, [ooc.lon, ooc.lat]) < metres(main.pts[bi], [ooc.lon, ooc.lat]) ? k : bi), 0);
      const a = main.pts[Math.max(0, i - 5)], b = main.pts[Math.min(main.pts.length - 1, i + 5)];
      const bearing = (Math.atan2((b[0] - a[0]) * Math.cos(a[1] * rad), b[1] - a[1]) * 180) / Math.PI;
      out.models.push({ file: 'old_oak_common.glb', lon: r5(ooc.lon), lat: r5(ooc.lat), h: r1(ground(ooc.lon, ooc.lat)), bearing: Math.round(bearing) });
    }
  }
  fs.writeFileSync('data/planned.json', JSON.stringify(out));
  console.log('planned.json', (fs.statSync('data/planned.json').size / 1024).toFixed(0), 'KB;', out.stations.length, 'stations');
}
main().catch((e) => { console.error(e); process.exit(1); });
