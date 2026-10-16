// Plausibility checks for journey times against typical TfL journey-planner figures.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { LINES, OPERATORS } from '../lines.js';
import { buildNetwork, travelTimes, isochroneGrid } from '../journey.js';

const read = (f) => JSON.parse(fs.readFileSync(`data/${f}.json`, 'utf8'));
const stations = read('stations'), graph = read('graph');
const modes = new Map([...LINES, ...OPERATORS].map((l) => [l.id, l.mode]));
const net = buildNetwork(graph, stations, (id) => modes.get(id));
const idx = (name) => { const i = stations.findIndex((s) => s.name === name); assert.ok(i >= 0, name); return i; };

const cases = [
  // [from, to, min, max] — station entrance to station exit, incl. platform walks and waits
  ['Oxford Circus', 'Victoria', 6, 12],
  ['Oxford Circus', 'Stratford', 16, 30],
  ["King's Cross St. Pancras", 'Liverpool Street', 10, 22],
  ['Paddington', 'Canary Wharf', 20, 38],
  ['Waterloo', 'Wimbledon', 14, 32],
  ['Bank', 'Heathrow Terminals 2 & 3', 42, 78],
];
for (const [a, b, lo, hi] of cases) {
  const t = travelTimes(net, idx(a))[idx(b)];
  console.log(`${a} -> ${b}: ${t.toFixed(1)} min`);
  assert.ok(t >= lo && t <= hi, `${a} -> ${b} = ${t.toFixed(1)}, expected ${lo}-${hi}`);
}
// changing lines must cost something: KX -> Bank via Northern only vs a route needing a change
const kx = travelTimes(net, idx("King's Cross St. Pancras"));
assert.ok(kx[idx('Canary Wharf')] > kx[idx('Bank')] + 5, 'a change (Bank -> DLR/Jubilee) adds real time');
const all = travelTimes(net, idx('Oxford Circus'));
const reach = (m) => [...all].filter((t) => t <= m).length;
console.log('from Oxford Circus within 15/30/45/60/90:', [15, 30, 45, 60, 90].map(reach).join(' / '));
assert.ok(reach(90) > stations.length * 0.8, 'most of the network within 90 min of Oxford Circus');
// reachable area: origin cell is ~0, a cell far beyond walking range of any station is unreachable
const G = { w: -0.62, e: 0.38, s: 51.26, n: 51.74, cell: 100 };
const { field, W, H } = isochroneGrid(stations, all, G, 90);
const cellAt = (lon, lat) => field[Math.floor(((G.n - lat) * 111320) / 100) * W + Math.floor(((lon - G.w) * Math.cos((51.5 * Math.PI) / 180) * 111320) / 100)];
const oc = stations[idx('Oxford Circus')];
assert.ok(cellAt(oc.lon, oc.lat) < 2, 'origin cell ~0 min');
assert.ok(cellAt(oc.lon + 0.003, oc.lat) < 6, '200 m walk from origin is a few minutes');
assert.equal(cellAt(-0.61, 51.735), Infinity, 'empty countryside corner is unreachable');
console.log('grid', W, 'x', H, 'cells');
console.log('ok');
