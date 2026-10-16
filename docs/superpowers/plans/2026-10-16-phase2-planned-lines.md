# Phase 2 Planned Lines (HS2 + West London Orbital) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw HS2 and the West London Orbital as dashed "planned" lines with hollow-ring stations, a "Planned lines" toggle and key group, planned-aware station cards, and a Blender-made Old Oak Common station model.

**Architecture:**
- A new bake script, `scripts/build-planned.mjs`, routes each planned line over OSM track by shortest path through its stops in order. It adds an indicative vertical profile and writes `data/planned.json`.
- The existing data files and the journey graph are untouched, so planned lines can never leak into journey times.
- The bake helpers it needs move out of `build-data.mjs` into `scripts/bake-lib.mjs`.
- `app.js` loads `planned.json` and renders it in its own `plannedLayer`, behind one toggle.

**Tech Stack:**
- Node 22 ES modules
- Overpass API
- AWS Terrarium DEM (`pngjs`)
- CesiumJS 1.145.0 (CDN)
- Blender MCP for the station model (glTF export)
- Playwright MCP for in-browser validation

**Spec:** `docs/superpowers/specs/2026-10-16-phase2-planned-lines-design.md`

## Global Constraints

- `config.js` (Cesium ion token) is gitignored and must NEVER be committed. Before every commit, run `git diff --cached | grep -c eyJhbGci`; it must print `0`.
- Planned lines are excluded from `data/graph.json`, the journey times and the animated trains.
- Card text, copied verbatim:
  - HS2: "Planned — opening 2036–39 (Euston 2040–43)"
  - WLO: "Proposed — opening early-to-mid 2030s"
- Colours:
  - HS2 is `#005F83`. The HS2 design system site was offline while this plan was written, so this is a one-line constant to change once the brand colour is confirmed.
  - WLO is `#EF7B10`, Overground orange.
- Line style: dashed, in the line colour. Planned stations are hollow rings in the line colour.
- The "Planned lines" switch is on by default and toggles the lines, the stations and the Old Oak Common model together.
- Model: `assets/old_oak_common.glb`, under 1.5 MB, +X forward, Y up. Its source lives in `assets/source/london-map-assets.blend`.
- Match the surrounding code style: terse, comment density as in `app.js`, no new npm dependencies.
- Commit trailer, on every commit:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01EFdk69C451uireZ4375Dei
  ```

**Spec amendment, made in Task 2:** the spec says planned lines and stations go into
`lines.json` and `stations.json`. This plan writes them to a separate `data/planned.json` instead.
`stations.json` indices are positional and `graph.json` depends on them, so keeping planned data
separate is what guarantees "not in journey times". The behaviour is otherwise identical.

## Review Focus

1. **Selecting a planned station.** Selecting Old Oak Common, by search or by click, while another
   station's reachable area is shown must clear the shading and show the planned card. It must not
   crash on a missing journey-graph index. (Task 4, browser check 1.)
2. **Name collisions in search.** Typing "Neasden" or "Harlesden" must select the existing tube
   station, not the planned WLO stop. Unique planned names such as "Old Oak Common" and
   "Lionel Road" must be searchable. (Task 4, browser check 2.)
3. **Switch versus key bars.** Turning "Planned lines" off hides the dashed lines, the rings and
   the model. Turning it back on restores each line according to its own key bar state.
   (Task 4, browser check 3.)
4. **Existing stations on planned lines.** Euston and Hounslow keep their journey-time card and
   also show "HS2 (planned)" / "West London Orbital (planned)" chips. (Task 4, browser check 4.)
5. **Planned stations stay out of journey times.** No planned station or line appears in the
   journey-time band lists. Hovering the reachable area still works.
   (Task 3, data check; Task 4, browser check 5.)

---

### Task 1: Extract shared bake helpers into `scripts/bake-lib.mjs`

The bake helpers move out with no behaviour change. Proof: re-running the bake produces
byte-identical `data/*.json`, served from the local `.cache/`.

**Files:**
- Create: `scripts/bake-lib.mjs`
- Modify: `scripts/build-data.mjs` (lines 1–135: imports, `cached`, `get`, `tfl` stays, `overpass`,
  geometry helpers, terrain, `wayKind`)

**Interfaces:**
- Produces, as exports of `scripts/bake-lib.mjs`:
  - `CACHE`
  - `GEOID`
  - `sleep(ms)`
  - `cached(name, fetcher) -> Promise<Buffer>`
  - `get(url, opts?, tries?) -> Promise<Buffer>`
  - `overpass(name, query) -> Promise<object>`
  - `R`
  - `rad`
  - `metres([lon,lat],[lon,lat]) -> number`
  - `inBox([lon,lat], {s,w,n,e}) -> bool`
  - `simplifyIdx(pts, tol) -> number[]`
  - `loadTiles(bbox) -> Promise<number>`, which loads every z12 tile in the bbox
  - `loadTilesFor(points[[lon,lat]]) -> Promise<number>`, which loads only the tiles the points touch
  - `ground(lon, lat) -> number`, the ellipsoid height in metres
  - `wayKind(tags) -> 'tunnel'|'bridge'|'embankment'|'surface'`
  - `RAMP` (250)

- [ ] **Step 1: Record the current data checksum**

Run: `cd "C:/Users/Timothy Wong/Repositories/london-map" && sha1sum data/*.json > "$TEMP/data.sha1" && cat "$TEMP/data.sha1"`
Expected: four lines, one per JSON file.

- [ ] **Step 2: Create `scripts/bake-lib.mjs`**

Move these items verbatim out of `build-data.mjs`:
- the bodies of `sleep`, `cached`, `get`, `OVERPASS`, `overpass`, `R`, `rad`, `metres`, `inBox` and
  `simplifyIdx`;
- the terrain block (`TZ`, `tiles`, `lon2x`, `lat2y`, `ground`);
- `wayKind`;
- `RAMP`.

Export each of them. Then replace `loadTiles` with these two functions:

```js
// Bake helpers shared by build-data.mjs and build-planned.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

export const CACHE = '.cache';
fs.mkdirSync(CACHE, { recursive: true });
export const GEOID = 46; // EGM96 undulation over London: Terrarium (MSL) -> Cesium (ellipsoid)
// ... moved helpers, each prefixed with `export` ...

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
```

- [ ] **Step 3: Rewire `build-data.mjs`**

Delete the moved code and import it:

```js
import fs from 'node:fs';
import path from 'node:path';
import { contours } from 'd3-contour';
import { LINES, OPERATORS } from '../lines.js';
import { CACHE, GEOID, cached, get, overpass, R, rad, metres, inBox, simplifyIdx, loadTiles, ground, wayKind, RAMP } from './bake-lib.mjs';
```

In `main()`, replace `await loadTiles();` with:

```js
console.log('terrain tiles', await loadTiles(BBOX));
```

Keep in `build-data.mjs`:
- `tfl` (TfL-specific);
- `OUT`, `BBOX`, `NR_BOX`;
- the `fs.mkdirSync(OUT…)` call;
- everything from `fetchOsm` down, except `wayKind` and `RAMP`.

- [ ] **Step 4: Re-bake and verify the output is identical**

Run: `node scripts/build-data.mjs > /dev/null && sha1sum -c "$TEMP/data.sha1" && npm run -s check | tail -1`
Expected:
- four `OK` lines;
- `ok` from the journey check;
- no network fetches, because everything is cached.

If any file differs, the extraction changed behaviour. Diff against `git show HEAD:scripts/build-data.mjs` and fix it before continuing.

- [ ] **Step 5: Commit**

```bash
git add scripts/bake-lib.mjs scripts/build-data.mjs
git diff --cached | grep -c eyJhbGci   # must print 0
git commit -m "Extract shared bake helpers into scripts/bake-lib.mjs"   # plus the trailer
```

---

### Task 2: Planned line definitions and failing data checks

**Files:**
- Modify: `lines.js` (append `PLANNED`; add `planned` to `MODES`)
- Modify: `scripts/check-data.mjs` (append the planned checks)
- Modify: `docs/superpowers/specs/2026-10-16-phase2-planned-lines-design.md` (Output section: amend
  it to say `data/planned.json`)

**Interfaces:**
- Produces: `PLANNED` from `lines.js`, an array of objects with these fields:
  - `id`, `name`, `mode: 'planned'`, `colour`, `opens`, `width`, `osm`
  - `osm`: `{ select: string, bbox: {s,w,n,e} }`
  - `stops`: `[{ name, lon?, lat?, waypoint?, also? }]`
  - `branches`: an array of `stops`-shaped arrays
- A stop without `lon`/`lat` is an existing station, looked up by exact name in
  `data/stations.json`.
- `waypoint: true` marks a routing point only, never a station.
- `also` lists existing line ids that the planned station will also serve (shown as planned chips).
- Produces the shape of `data/planned.json`, which Task 3 writes:
  ```
  { lines: [{ id, name, mode:'planned', colour, opens, width, segs:[{ t:0|1, c:[lon,lat,h,...] }] }],
    stations: [{ id, name, lon, lat, h, lines:[plannedIds], also:[lineIds], existing: stationId|null, opens }],
    models: [{ file, lon, lat, h, bearing }] }
  ```

- [ ] **Step 1: Write the failing checks**

Append to `scripts/check-data.mjs`, before the final `console.log`:

```js
// ---------- phase 2: planned lines ----------
import { PLANNED } from '../lines.js';
const planned = read('planned');
const graph = read('graph');
const llen = (c) => { let L = 0; for (let i = 3; i < c.length; i += 3) L += Math.hypot((c[i] - c[i - 3]) * 69500, (c[i + 1] - c[i - 2]) * 111320); return L; };
const hs2 = planned.lines.find((l) => l.id === 'hs2'), wlo = planned.lines.find((l) => l.id === 'west-london-orbital');
assert.ok(hs2 && wlo, 'both planned lines baked');
const mainLen = hs2.segs.filter((s) => !s.branch).reduce((a, s) => a + llen(s.c), 0) / 1000;
assert.ok(mainLen > 200 && mainLen < 240, `HS2 Euston-Curzon Street ${mainLen.toFixed(0)} km, expected 200-240`);
// longest continuous tunnel = Chilterns (~16 km); adjacent tunnel segs are one run
let run = 0, longest = 0;
for (const s of hs2.segs.filter((s) => !s.branch)) { run = s.t ? run + llen(s.c) : 0; longest = Math.max(longest, run); }
assert.ok(longest > 14000 && longest < 18000, `HS2 longest tunnel ${(longest / 1000).toFixed(1)} km, expected 14-18 (Chilterns)`);
// WLO passes every stop, in order, within 150 m
const wloPts = wlo.segs.flatMap((s) => { const o = []; for (let i = 0; i < s.c.length; i += 3) o.push([s.c[i], s.c[i + 1]]); return o; });
let at = 0;
for (const name of PLANNED.find((p) => p.id === 'west-london-orbital').stops.filter((s) => !s.waypoint).map((s) => s.name)) {
  const st = planned.stations.find((s) => s.name === name && s.lines.includes('west-london-orbital'));
  assert.ok(st, `WLO station ${name} baked`);
  let bi = -1, bd = Infinity;
  for (let i = at; i < wloPts.length; i++) { const d = Math.hypot((wloPts[i][0] - st.lon) * 69500, (wloPts[i][1] - st.lat) * 111320); if (d < bd) (bd = d), (bi = i); }
  assert.ok(bd < 150, `WLO passes ${name} (${bd.toFixed(0)} m)`);
  at = bi;
}
// planned lines never reach journey times
for (const p of PLANNED) assert.ok(!graph.lines.includes(p.id), `${p.id} not in journey graph`);
assert.ok(planned.stations.find((s) => s.name === 'Euston')?.existing, 'Euston links to the existing station');
const glb = 'assets/old_oak_common.glb';
assert.ok(fs.existsSync(glb) && fs.statSync(glb).size < 1.5e6, 'Old Oak Common model exists, < 1.5 MB');
```

Move the `PLANNED` import up next to the existing `lines.js` import (ES imports must be top-level):
change line 4 to `import { LINES, OPERATORS, PLANNED } from '../lines.js';` and drop the inline
`import` above.

- [ ] **Step 2: Run the check and see it fail**

Run: `node scripts/check-data.mjs`
Expected: FAIL, for one of two reasons:
- `SyntaxError: The requested module '../lines.js' does not provide an export named 'PLANNED'`;
- or, once Step 3 is done, `ENOENT ... data/planned.json`.

- [ ] **Step 3: Add `PLANNED` to `lines.js`**

```js
// add to MODES (last entry, so the key lists it at the bottom)
  planned: 'Planned (not yet built)',
```

Append to the end of the file:

```js
// Planned railways (phase 2) — drawn dashed, never in journey times or train animation.
// Stops without lon/lat are existing stations (looked up by name in data/stations.json);
// coordinates of new stations are from OSM construction sites / TfL WLO material (approximate).
export const PLANNED = [
  {
    id: 'hs2', name: 'HS2', mode: 'planned', colour: '#005F83', width: 5, // ponytail: HS2 brand colour unconfirmed (design system offline) — change here
    opens: 'Planned — opening 2036–39 (Euston 2040–43)',
    osm: { select: 'way["railway"="construction"]', bbox: { s: 51.48, w: -1.95, n: 52.76, e: -0.12 } },
    stops: [
      { name: 'Euston', hs2Lon: -0.1355, hs2Lat: 51.5300 },
      { name: 'Old Oak Common', lon: -0.24798, lat: 51.52493, also: ['elizabeth', 'great-western-railway'] },
      { name: 'Birmingham Interchange', lon: -1.70067, lat: 52.45209 },
      { name: 'Birmingham Curzon Street', lon: -1.88964, lat: 52.48046 },
    ],
    // Delta Junction (Water Orton) north to the West Coast Main Line at Handsacre
    branches: [[
      { name: 'Delta Junction', lon: -1.7345, lat: 52.5155, waypoint: true },
      { name: 'Handsacre Junction', lon: -1.8205, lat: 52.7302, waypoint: true },
    ]],
  },
  {
    id: 'west-london-orbital', name: 'West London Orbital', mode: 'planned', colour: '#EF7B10', width: 3.5,
    opens: 'Proposed — opening early-to-mid 2030s',
    osm: { select: 'way["railway"="rail"][!"service"]', bbox: { s: 51.44, w: -0.39, n: 51.60, e: -0.20 } },
    stops: [
      { name: 'Hendon' },
      { name: 'Brent Cross West' },
      { name: 'Neasden', lon: -0.24738, lat: 51.55320 },   // new, on the Dudding Hill line
      { name: 'Harlesden', lon: -0.25652, lat: 51.54139 }, // new, on the Dudding Hill line
      { name: 'Old Oak Common Lane', lon: -0.25387, lat: 51.52518 },
      { name: 'Acton Central' },
      { name: 'South Acton' },
      { name: 'Lionel Road', lon: -0.29135, lat: 51.49061 },
      { name: 'Brentford' },
      { name: 'Syon Lane' },
      { name: 'Isleworth' },
      { name: 'Hounslow' },
    ],
    branches: [],
  },
];
```

For Euston:
- `hs2Lon`/`hs2Lat` is where the HS2 platforms are, west of today's station. It is used for
  routing and for the ring.
- Because the stop has no `lon`/`lat`, the name lookup links it to the existing Euston station for
  the card chip.

- [ ] **Step 4: Amend the spec**

In the spec's "Output" section, replace the three bullets with:

```markdown
- `data/planned.json` (new): `{ lines, stations, models }`, written by `scripts/build-planned.mjs`.
  `lines.json`, `stations.json` and `graph.json` are unchanged — planned data lives apart so it can
  never enter journey times (graph indices are positional over stations.json).
- Planned stations at an existing station carry `existing: <station id>` so the card can add a
  "(planned)" chip there.
```

- [ ] **Step 5: Run the check again**

Run: `node scripts/check-data.mjs`
Expected: FAIL with `ENOENT: no such file or directory, open 'data/planned.json'`. That is
correct; Task 3 creates the file.

- [ ] **Step 6: Commit**

```bash
git add lines.js scripts/check-data.mjs docs/superpowers/specs/2026-10-16-phase2-planned-lines-design.md
git diff --cached | grep -c eyJhbGci   # 0
git commit -m "Planned line definitions (HS2, WLO) and failing data checks"   # plus the trailer
```

---

### Task 3: Bake `data/planned.json` (`scripts/build-planned.mjs`)

**Files:**
- Create: `scripts/build-planned.mjs`
- Modify: `package.json` (the `data` script runs both bakes)
- Modify: `app.js:39` (fetch list, so the deploy cache-bust covers `planned.json`; see Step 6)

**Interfaces:**
- Consumes: the `bake-lib.mjs` exports (Task 1), `PLANNED` (Task 2) and `data/stations.json`.
- Produces: `data/planned.json` in the shape defined in Task 2.
- `segs[].branch` is `true` for branch segments.
- `models[0]` is Old Oak Common, with `bearing` = the direction of the HS2 track at Old Oak Common,
  in degrees from north.

- [ ] **Step 1: Write the bake script**

```js
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
  // bridge small gaps: each way end to the nearest node of a different way within GAP
  // ponytail: O(ends x nodes) scan, fine for ~1k ways; grid-hash if the corridor grows
  const all = [...ll];
  const wayOf = new Map();
  for (const w of ways) for (const n of w.nodes) wayOf.set(n, w.id);
  for (const w of ways) for (const end of [w.nodes[0], w.nodes.at(-1)]) {
    if (adj.get(end).length > 1) continue; // already joined
    let best = null, bd = GAP;
    for (const [n, p] of all) {
      if (wayOf.get(n) === w.id) continue;
      const d = metres(ll.get(end), p);
      if (d < bd) (bd = d), (best = n);
    }
    if (best) link(end, best, bd, w.id);
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
function route(g, waysById, stops, label) {
  const nodes = stops.map((s) => {
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
  return { pts, tun, kind, cum };
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
    const branches = def.branches.map((b, i) => route(g, waysById, b, `${def.id} branch ${i}`));
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
```

- [ ] **Step 2: Run the bake**

Run: `node scripts/build-planned.mjs`

Expected:
- HS2: about 600–700 ways, main route 215–235 km, branch 20–35 km.
- WLO: main route 20–30 km.
- `planned.json` is under 300 KB, with 15 stations.

On a `no track path` error:
- Plot the two named stops and the ways near them. Usually it's a gap over 60 m.
- Fix it with a `waypoint: true` stop on mapped track either side of the gap.
- If the gap is genuinely unmapped, raise `GAP` to at most 150.
- Never draw straight lines.

- [ ] **Step 3: Check that the WLO route follows the Dudding Hill line, not the Chiltern main line**

Run: `node -e "const p=require('./data/planned.json');const w=p.lines.find(l=>l.id==='west-london-orbital');const c=w.segs.flatMap(s=>s.c);let n=0;for(let i=0;i<c.length;i+=3)if(c[i+1]>51.545&&c[i+1]<51.556&&c[i]<-0.26)n++;console.log('pts west of Neasden on Chiltern side:',n)"`
Expected: `0`. If the count is above 0, the route cut along the Chiltern line. Add a
`waypoint: true` stop on the Dudding Hill line between Brent Cross West and Neasden, at
`{ lon: -0.2380, lat: 51.5620 }` (a node on the line from the earlier probe), then re-run Step 2.

- [ ] **Step 4: Run the data checks**

Run: `node scripts/check-data.mjs`
Expected: everything passes except the last assertion, `Old Oak Common model exists`, which Task 5
satisfies.

To proceed meanwhile, temporarily comment out that one assertion. Restore it in Task 5, Step 6.

If the HS2 length or tunnel checks fail:
- print `longest` and the main length;
- tunnel under 14 km means the Chiltern tunnel ways have a non-tunnel gap; inspect the
  `kind` sequence around 51.60–51.68 N;
- length over 240 km means the route took a detour; add a waypoint.

- [ ] **Step 5: Wire up the `data` script**

In `package.json`, change `"data"` to `"node scripts/build-data.mjs && node scripts/build-planned.mjs"`.

- [ ] **Step 6: Load `planned.json` with the other data**

So that the deploy cache-bust (`data/${f}.json` → `?v=`) covers it, change `app.js:38–40` to:

```js
const [lines, stations, zones, graph, planned] = await Promise.all(
  ['lines', 'stations', 'zones', 'graph', 'planned'].map((f) => fetch(`data/${f}.json`).then((r) => r.json())),
);
```

- [ ] **Step 7: Commit**

```bash
git add scripts/build-planned.mjs data/planned.json package.json app.js scripts/check-data.mjs
git diff --cached | grep -c eyJhbGci   # 0
git commit -m "Bake planned HS2 and West London Orbital routes from OSM track"   # plus the trailer
```

---

### Task 4: Render planned lines, stations, toggle, key and cards

**Files:**
- Modify: `index.html` (the switch, below "See underground")
- Modify: `app.js`:
  - planned layer, after the stations block (`// ---------------- simulated trains` is the next marker);
  - key loop (uses `[...lines, ...planned.lines]`);
  - `setLine`;
  - `selectStation`;
  - the click handler;
  - search (`byName`).
- Modify: `style.css` (`.bar.planned`, `#card li.planned`, `.badge`)

**Interfaces:**
- Consumes: `planned` (Task 3, Step 6) and `MODES.planned` (Task 2).
- Produces, used by Task 5:
  - `plannedLayer` (a `C.PrimitiveCollection`, toggled by `#t-planned`);
  - `plannedPrims: Map<lineId, C.PrimitiveCollection>`;
  - `plannedByStation: Map<existingStationId, plannedStation[]>`.

- [ ] **Step 1: Add the switch to `index.html`**

Put it right after the "See underground" `label.switch`, copying that element's exact markup
pattern:

```html
<label class="switch"><input type="checkbox" id="t-planned" checked> Planned lines</label>
```

(Before inserting, check how the existing switches are written in `index.html` and match them
exactly.)

- [ ] **Step 2: Render the planned layer in `app.js`**

Insert this before `// ---------------- simulated trains ----------------`:

```js
// ---------------- planned lines (phase 2): dashed, hollow-ring stations, never in journey times ----------------
const plannedLayer = scene.primitives.add(new C.PrimitiveCollection());
const plannedPrims = new Map();
const plannedByStation = new Map(); // existing station id -> planned stations there (for card chips)
const plannedById = new Map(planned.lines.map((l) => [l.id, l]));
for (const l of planned.lines) {
  const group = plannedLayer.add(new C.PrimitiveCollection());
  for (const t of [0, 1]) {
    const segs = l.segs.filter((s) => s.t === t && s.c.length >= 6);
    if (!segs.length) continue;
    group.add(new C.Primitive({
      geometryInstances: segs.map((s) => new C.GeometryInstance({ geometry: new C.PolylineGeometry({
        positions: C.Cartesian3.fromDegreesArrayHeights(s.c), width: l.width, arcType: C.ArcType.NONE,
        vertexFormat: C.PolylineMaterialAppearance.VERTEX_FORMAT }) })),
      appearance: new C.PolylineMaterialAppearance({ material: C.Material.fromType('PolylineDash', {
        color: css(l.colour).withAlpha(t ? 0.5 : 1), gapColor: C.Color.TRANSPARENT, dashLength: 20 }) }),
    }));
  }
  plannedPrims.set(l.id, group);
}
{
  const rings = plannedLayer.add(new C.PointPrimitiveCollection());
  const labels = plannedLayer.add(new C.LabelCollection({ scene }));
  for (const st of planned.stations) {
    st.planned = true;
    if (st.existing) {
      if (!plannedByStation.has(st.existing)) plannedByStation.set(st.existing, []);
      plannedByStation.get(st.existing).push(st);
    }
    const col = css(plannedById.get(st.lines[0]).colour), pos = C.Cartesian3.fromDegrees(st.lon, st.lat, st.h + 4);
    rings.add({ id: st, position: pos, pixelSize: 11, color: C.Color.WHITE.withAlpha(0.01), outlineColor: col, outlineWidth: 3,
      disableDepthTestDistance: Infinity, distanceDisplayCondition: new C.DistanceDisplayCondition(0, 3e5) });
    if (!st.existing) labels.add({ id: st, position: pos, text: st.name, font: 'italic 500 14px Jost, sans-serif', fillColor: C.Color.WHITE,
      outlineColor: css('#1D1D1B'), outlineWidth: 3, style: C.LabelStyle.FILL_AND_OUTLINE, horizontalOrigin: C.HorizontalOrigin.LEFT,
      pixelOffset: new C.Cartesian2(10, 0), disableDepthTestDistance: Infinity, distanceDisplayCondition: new C.DistanceDisplayCondition(0, 60000) });
  }
}
```

Notes:
- The ring fill uses alpha 0.01 rather than 0, so the hollow centre stays pickable.
- Italic labels are the TfL map's convention for "planned/under construction".

- [ ] **Step 3: Wire the switch**

Next to the other `on('t-…')` calls, add:

```js
on('t-planned', (v) => { plannedLayer.show = v; scene.requestRender(); });
```

- [ ] **Step 4: Key group and `setLine`**

In the key loop:
- change `const group = lines.filter((l) => l.mode === mode && linePrims.has(l.id));` to
  `const group = [...lines, ...planned.lines].filter((l) => l.mode === mode && (linePrims.has(l.id) || plannedPrims.has(l.id)));`;
- change `b.className = 'bar' + (isLight(l.colour) ? ' light' : '');` to
  `b.className = 'bar' + (isLight(l.colour) ? ' light' : '') + (l.mode === 'planned' ? ' planned' : '');`.

Change `setLine` to:

```js
function setLine(id, bar, show) {
  (linePrims.get(id) || plannedPrims.get(id)).show = show;
  bar.setAttribute('aria-pressed', String(show));
}
```

Review Focus 3 holds automatically:
- the bars set the per-line group's `show`;
- the switch sets the parent `plannedLayer.show`;
- the two compose.

- [ ] **Step 5: Station card — planned stations and planned chips**

At the top of `selectStation(st, fly)`, before the existing card code:

```js
  if (st.planned && !st.existing) return selectPlanned(st, fly);
```

Planned stations at existing stations (Euston, Hounslow and others) are routed by the click handler
to the existing station object instead; see Step 6.

In `selectStation`, after `$('card-lines').replaceChildren(...)`, add the planned chips:

```js
  for (const p of plannedByStation.get(st.id) || []) $('card-lines').append(...p.lines.map(plannedChip));
  $('card-times').closest('.times').hidden = false;
```

Add near `selectStation`:

```js
const plannedChip = (id) => {
  const l = plannedById.get(id) || byId.get(id), li = document.createElement('li');
  li.textContent = `${l?.name || id} (planned)`;
  li.className = 'planned';
  li.style.setProperty('--c', l?.colour || '#777');
  return li;
};
// Planned-only station: badge + opening text, no journey times (they cover today's network only)
function selectPlanned(st, fly) {
  clearSelection();
  $('card-name').textContent = st.name;
  $('card-zone').innerHTML = '<span class="badge">Planned</span> ';
  $('card-zone').append(st.opens);
  $('card-lines').replaceChildren(...st.lines.map(plannedChip), ...st.also.map(plannedChip));
  $('card-times').closest('.times').hidden = true;
  $('card').hidden = false;
  if (fly) viewer.camera.flyTo({ destination: C.Cartesian3.fromDegrees(st.lon, st.lat - 0.16, 16000), orientation: { heading: 0, pitch: deg(-45), roll: 0 }, duration: 1.5 });
}
```

`clearSelection()` hides the card; the lines after it show the card again. That order matters:
`clearSelection` also removes any reachable-area shading (Review Focus 1).

- [ ] **Step 6: Click and search**

Change the `LEFT_CLICK` body to:

```js
  let st = scene.pick(e.position)?.id;
  if (st?.planned && st.existing) st = stations.find((s) => s.id === st.existing); // e.g. Euston: today's station + planned chip
  if (st?.lines) selectStation(st);
  else showTip(e.position);
```

After the existing `byName` loop, add planned-only stations whose names are free, so that "Neasden"
stays the tube station (Review Focus 2):

```js
for (const st of planned.stations) if (!st.existing && !byName.has(st.name)) byName.set(st.name, st);
```

This must come before the `$('station-list').append(...)` line, so the datalist includes them.
Move that line below if needed.

- [ ] **Step 7: Styles**

Append to `style.css`:

```css
/* planned lines: dashed bar / chip, like TfL's "under construction" notation */
.bar.planned { background: repeating-linear-gradient(90deg, var(--c) 0 12px, transparent 12px 18px) bottom / 100% 4px no-repeat, #F2F2F0; color: var(--ink); font-style: italic; }
.bar.planned[aria-pressed="false"] { color: var(--muted); background: #F2F2F0; }
#card li.planned { background: repeating-linear-gradient(90deg, var(--c) 0 10px, transparent 10px 15px) bottom / 100% 3px no-repeat, #F2F2F0; color: var(--ink); font-style: italic; }
.badge { display: inline-block; background: var(--ink); color: #fff; border-radius: 3px; padding: 0 6px; font-size: 12.5px; font-weight: 600; margin-right: 4px; }
```

- [ ] **Step 8: Browser checks for the Review Focus**

Run `npm run serve` if `curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/` is not
`200`. Then run this with Playwright `browser_run_code_unsafe`:

```js
async (page) => {
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('http://localhost:8080/');
  await page.getByText('Loading the network…').waitFor({ state: 'hidden', timeout: 60000 });
  const pick = async (n) => { await page.fill('#station-search', n); await page.evaluate(() => document.getElementById('station-search').dispatchEvent(new Event('change'))); await page.waitForTimeout(4000); };
  const card = () => page.evaluate(() => { const $ = (id) => document.getElementById(id);
    return { name: $('card-name').textContent, zone: $('card-zone').textContent, lines: [...$('card-lines').children].map((l) => l.textContent), times: !document.querySelector('#card .times').hidden }; });
  const r = {};
  await pick('Oxford Circus');                       // 1: planned station while an area is shown
  await pick('Old Oak Common');
  r.ooc = await card();                              // expect zone starts 'Planned', lines incl 'HS2 (planned)', 'Elizabeth line (planned)', times false
  await page.mouse.move(720, 450); await page.waitForTimeout(300);
  r.tipAfterPlanned = await page.evaluate(() => document.getElementById('tip').hidden); // expect true (area cleared)
  await pick('Neasden'); r.neasden = await card();   // 2: expect lines ['Jubilee'], times true
  await pick('Lionel Road'); r.lionel = await card(); //    expect a planned card for WLO
  await page.click('#t-planned', { force: true });   // 3: switch off then on
  r.offChecked = await page.isChecked('#t-planned');
  await page.click('#t-planned', { force: true });
  await pick('Euston'); r.euston = await card();     // 4: expect times true and 'HS2 (planned)' chip
  await pick('Hounslow'); r.hounslow = await card(); //    expect 'West London Orbital (planned)' chip
  r.bandNames = await page.evaluate(() => [...document.querySelectorAll('#card-times ol button')].map((b) => b.textContent)); // 5
  r.plannedInBands = r.bandNames.filter((n) => ['Lionel Road', 'Old Oak Common Lane', 'Birmingham Interchange', 'Birmingham Curzon Street'].includes(n));
  r.errs = errs;
  return r;
}
```

Expected:
- `ooc.zone` starts with `Planned`, `ooc.lines` contains `HS2 (planned)` and
  `Elizabeth line (planned)`, and `ooc.times === false`.
- `tipAfterPlanned === true`.
- `neasden.lines` deep-equals `['Jubilee']` (the tube station) and `neasden.times === true`.
- `lionel.lines` contains `West London Orbital (planned)`.
- `offChecked === false`.
- `euston.times === true` and `euston.lines` includes `HS2 (planned)`.
- `hounslow.lines` includes `West London Orbital (planned)`.
- `plannedInBands` is `[]`.
- `errs` is `[]`.

Also take one screenshot at default zoom with planned on. It should show dashed HS2 heading
north-west out of London, and the WLO dashed orange loop in west London.

- [ ] **Step 9: Run all checks and commit**

Run: `npm run -s check | tail -2`
Expected: `ok` lines. The model assertion stays commented out until Task 5.

```bash
git add index.html app.js style.css
git diff --cached | grep -c eyJhbGci   # 0
git commit -m "Render planned HS2 and West London Orbital: dashed lines, ring stations, toggle, planned cards"   # plus the trailer
```

---

### Task 5: Old Oak Common station model (Blender MCP) and placement

**Files:**
- Modify: `assets/source/london-map-assets.blend` (new collection `OldOakCommon`)
- Create: `assets/old_oak_common.glb`
- Modify: `app.js` (place the model inside the planned layer block)
- Modify: `scripts/check-data.mjs` (restore the model assertion)

**Interfaces:**
- Consumes: `planned.models[0]` `{ file, lon, lat, h, bearing }` (Task 3), plus `plannedLayer`,
  `frame()` and `gltf()` (existing helpers in `app.js`).

- [ ] **Step 1: Check the Blender connection and the scene**

Call `mcp__blender__get_addon_status`, then `mcp__blender__get_scene_info`.

Open `assets/source/london-map-assets.blend` with:

```python
bpy.ops.wm.open_mainfile(filepath=r"C:\Users\Timothy Wong\Repositories\london-map\assets\source\london-map-assets.blend")
```

Expected: existing collections for the trains and station markers.

- [ ] **Step 2: Build the massing**

Work in metres, Blender Z up, +X along the tracks, origin at ground level at the centre of the
station hall.

The model is approximate massing of the published WSP / Wilkinson Eyre design:
- **Hall:** a 300 m (X) × 110 m (Y) box, 12 m high walls.
- **Wave roof:** 30 ribs at 10 m spacing along X. Each rib is a 2 m-wide arched beam spanning Y,
  with its crown height varying `18 + 6 * sin(i / 29 * pi)` m.
- **Roof skin:** a translucent roof skin between the ribs, made from the same profile as a
  solidified surface 0.3 m thick.
- **Glazed ends:** both ends of the hall (Y faces at X = ±150) are glazed. Use a pale blue-grey
  glass material, alpha 0.5.
- **Surface platforms (Elizabeth line/GWR):** north of the hall, eight platforms, each a
  250 m × 8 m × 1 m slab, at Y = 65…135 m with 1 m gaps. Over them, a canopy: a
  250 m × 70 m × 0.5 m slab at 7 m height.
- **HS2 box:** south of the hall, the top of the HS2 platform box. A 400 m × 60 m frame of
  1.5 m-wide edges, 1 m high, around a dark recessed plane at −2 m, standing in for the open box
  (the real platforms are 20 m down and would be hidden by terrain).

Materials, all Principled BSDF:
- hall walls `#D9D6CF`
- ribs `#8A8F94`
- roof skin `#C9D3DB` (alpha 0.6)
- platforms `#9A9A96`
- canopy `#E6E6E6`
- HS2 box rim `#005F83` (the HS2 colour)

Look up Principled nodes by type, not by name (MCP server instruction). Join the meshes into as
few objects as possible before export, as was done for the trains, to keep primitives low.

Check the result with `mcp__blender__look`:
- one oblique view;
- one top view.

The roof should read as a wave and the three zones should be clearly distinct.

- [ ] **Step 3: Export**

Select only the `OldOakCommon` collection objects, then:

```python
bpy.ops.export_scene.gltf(filepath=r"C:\Users\Timothy Wong\Repositories\london-map\assets\old_oak_common.glb",
    export_format='GLB', use_selection=True, export_yup=True, export_apply=True)
bpy.ops.wm.save_mainfile()
```

Run: `ls -l assets/old_oak_common.glb`
Expected: under 1.5 MB. If it is larger, decimate the ribs or reduce the subdivision.

- [ ] **Step 4: Place the model in `app.js`**

At the end of the planned-layer block from Task 4, Step 2, add:

```js
for (const m of planned.models)
  gltf(`assets/${m.file}`, { modelMatrix: frame(m.lon, m.lat, m.h, m.bearing),
    distanceDisplayCondition: new C.DistanceDisplayCondition(0, 40000) }).then((mdl) => plannedLayer.add(mdl));
```

`frame()` aligns +X with `bearing`, which is the HS2 track direction at Old Oak Common.
If the screenshot shows the model at right angles to the tracks, the bearing is correct and the
model's long axis was built along Y. Rebuild it along X; don't patch the bearing.

- [ ] **Step 5: Check the model against the 3D buildings**

In the browser:
- turn on "3D buildings";
- fly to Old Oak Common: search "Old Oak Common", then zoom to about 1.5 km;
- take a screenshot.

If OSM buildings overlap the model footprint, hide them inside the footprint with a style. Add it
in `app.js` where `buildings` is created:

```js
if (v && !buildings) {
  buildings = scene.primitives.add(await C.createOsmBuildingsAsync());
  // hide OSM buildings inside the Old Oak Common model footprint (~400 x 250 m)
  buildings.style = new C.Cesium3DTileStyle({ show: '!(${feature["cesium#latitude"]} > 51.5225 && ${feature["cesium#latitude"]} < 51.5275 && ${feature["cesium#longitude"]} > -0.2530 && ${feature["cesium#longitude"]} < -0.2430)' });
}
```

Skip this if the screenshot shows no overlap; the site is a construction area in OSM.

- [ ] **Step 6: Restore the model assertion and run the checks**

Uncomment the `Old Oak Common model exists` assertion in `scripts/check-data.mjs`.

Run: `npm run -s check | tail -2`
Expected: everything passes.

- [ ] **Step 7: Commit**

```bash
git add assets/old_oak_common.glb assets/source/london-map-assets.blend app.js scripts/check-data.mjs
git diff --cached | grep -c eyJhbGci   # 0
git commit -m "Old Oak Common HS2 station model (Blender) placed on the planned layer"   # plus the trailer
```

---

### Task 6: Docs, deploy and live validation

**Files:**
- Modify: `README.md` (phase 2 section: what is planned, the data sources, that it's indicative)
- Modify: the memory file `london-map-phases.md` (mark phase 2 shipped)

- [ ] **Step 1: README**

Add under the existing feature list:

```markdown
### Planned lines (phase 2)
HS2 (Euston – Old Oak Common – Birmingham Interchange – Curzon Street, with the link to the West Coast
Main Line) and the proposed West London Orbital (Hendon – Hounslow) are drawn dashed, with hollow-ring
stations. They are not in journey times or the train animation. Routes follow OpenStreetMap track
(HS2 is mapped as under construction); new station positions and tunnel depths are approximate.
Toggle them with "Planned lines". Opening dates as of October 2026: HS2 2036–39 (Euston 2040–43), WLO
early-to-mid 2030s (not yet approved).
```

- [ ] **Step 2: Push and watch the deploy**

```bash
git add README.md && git diff --cached | grep -c eyJhbGci   # 0
git commit -m "README: planned lines"   # plus the trailer
git push && gh run watch $(gh run list -L1 --json databaseId -q '.[0].databaseId') --exit-status
```

Expected: the run concludes with `success`. The workflow's own checks include the planned checks.

- [ ] **Step 3: Validate live**

Re-run the Task 4, Step 8 Playwright script against
`https://timothywong731.github.io/london-map/`, in a new browser context (no cache).
Expected:
- the same results as locally;
- every data/code request carries `?v=<commit>`;
- `planned.json?v=` is among them.

Take one screenshot zoomed out over HS2, and one of Old Oak Common close up with the model.
Review both by eye.

- [ ] **Step 4: Update memory**

In `london-map-phases.md`, replace the "Phase 2 spec approved…" sentence with:
"Phase 2 shipped <date>: HS2 + WLO dashed planned layer (data/planned.json via
scripts/build-planned.mjs) and the Old Oak Common model."
Keep the National Rail descoped note.
