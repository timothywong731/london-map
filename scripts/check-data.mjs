// Sanity checks on the baked data. Run: npm run check
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { LINES, OPERATORS, PLANNED } from '../lines.js';

const read = (f) => JSON.parse(fs.readFileSync(`data/${f}.json`, 'utf8'));
const lines = read('lines'), stations = read('stations'), zones = read('zones');

for (const def of LINES) {
  const l = lines.find((x) => x.id === def.id);
  assert.ok(l?.segs.length, `TfL line ${def.id} has geometry`);
  assert.ok(l.routes.length, `TfL line ${def.id} has a train route`);
  assert.match(l.colour, /^#[0-9A-F]{6}$/i);
}
assert.ok(lines.filter((l) => l.mode === 'national-rail' && l.segs.length).length >= OPERATORS.length - 2, 'most NR operators have geometry');

const deep = lines.find((l) => l.id === 'victoria').segs.flatMap((s) => s.c.filter((_, i) => i % 3 === 2));
const met = lines.find((l) => l.id === 'metropolitan').segs.filter((s) => !s.t).length;
assert.ok(Math.min(...deep) < 30, 'Victoria line goes underground (ellipsoid height < 30 m)');
assert.ok(met > 100, 'Metropolitan line has surface sections');

for (const z of [1, 2, 3, 4, 5, 6]) {
  const ring = zones.find((x) => x.zone === z)?.rings[0];
  assert.ok(ring?.length >= 20, `zone ${z} has a ring`);
}
const named = (n) => stations.find((s) => s.name === n);
assert.deepEqual(named('Oxford Circus').zones, [1]);
assert.ok(named('Stratford').lines.length >= 5, 'Stratford is an interchange');

// ---------- phase 2: planned lines ----------
const planned = read('planned');
const graph = read('graph');
const llen = (c) => { let L = 0; for (let i = 3; i < c.length; i += 3) L += Math.hypot((c[i] - c[i - 3]) * 69500, (c[i + 1] - c[i - 2]) * 111320); return L; };
const hs2 = planned.lines.find((l) => l.id === 'hs2'), wlo = planned.lines.find((l) => l.id === 'west-london-orbital');
assert.ok(hs2 && wlo, 'both planned lines baked');
const mainLen = hs2.segs.filter((s) => !s.branch).reduce((a, s) => a + llen(s.c), 0) / 1000;
const allLen = hs2.segs.reduce((a, s) => a + llen(s.c), 0) / 1000;
assert.ok(mainLen > 165 && mainLen < 190, `HS2 Euston-Curzon Street ${mainLen.toFixed(0)} km, expected 165-190`);
assert.ok(allLen > 190 && allLen < 235, `HS2 incl. Handsacre link ${allLen.toFixed(0)} km, expected 190-235`);
// tunnel runs on the main route (adjacent tunnel segs are one run): Chilterns ~16 km; Euston-Northolt ~22.6 km is the longest
const runs = []; let run = 0;
for (const s of hs2.segs.filter((s) => !s.branch)) { if (s.t) run += llen(s.c); else if (run) (runs.push(run), (run = 0)); }
if (run) runs.push(run);
assert.ok(runs.some((r) => r > 14000 && r < 18000), `HS2 Chilterns tunnel 14-18 km missing; runs km: ${runs.map((r) => (r / 1000).toFixed(1))}`);
assert.ok(Math.max(...runs) < 25000, `HS2 longest tunnel ${(Math.max(...runs) / 1000).toFixed(1)} km, expected < 25`);
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
// restored in Task 5 (model)
// assert.ok(fs.existsSync(glb) && fs.statSync(glb).size < 1.5e6, 'Old Oak Common model exists, < 1.5 MB');

console.log(`ok: ${lines.length} lines, ${stations.length} stations, ${zones.length} zones`);
