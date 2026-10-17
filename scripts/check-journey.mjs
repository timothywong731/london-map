// Plausibility checks for journey times against typical TfL journey-planner figures.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { LINES, OPERATORS } from '../lines.js';
import { buildNetwork, travelTimes, isochroneGrid, gridFor, mercatorRows, withPlanned, PLANNED_RUN } from '../journey.js';

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
const G = gridFor(stations);
const { field, W, H } = isochroneGrid(stations, all, G, 90);
const cellAt = (lon, lat, f = field) => f[Math.floor(((G.n - lat) * 111320) / 100) * W + Math.floor(((lon - G.w) * Math.cos((51.5 * Math.PI) / 180) * 111320) / 100)];
const oc = stations[idx('Oxford Circus')];
assert.ok(cellAt(oc.lon, oc.lat) < 2, 'origin cell ~0 min');
assert.ok(cellAt(oc.lon + 0.003, oc.lat) < 6, '200 m walk from origin is a few minutes');
assert.equal(cellAt(G.w + 0.01, G.n - 0.01), Infinity, 'empty countryside corner is unreachable');
// every station sits inside the grid, including the far west Elizabeth line (Reading was once cut off)
for (const name of ['Reading', 'Shenfield', 'Heathrow Terminal 5']) {
  const i = idx(name), s = stations[i];
  const own = isochroneGrid(stations, travelTimes(net, i), G, 90).field;
  assert.ok(cellAt(s.lon, s.lat, own) < 2, `${name} is shaded around itself`);
}
console.log('grid', W, 'x', H, 'cells');
console.log('ok');
// the shaded image is laid on a Web Mercator map: rows are resampled so mid-image sits slightly north of mid-latitude
{
  const G = gridFor(stations), H = 600, rows = mercatorRows(G, H);
  assert.equal(rows[0], 0, 'first Mercator row samples the north edge');
  assert.equal(rows[H - 1], H - 1, 'last Mercator row samples the south edge');
  assert.ok(rows[H / 2] < H / 2 && rows[H / 2] > H / 2 - 10, `mid Mercator row samples grid row ${rows[H / 2]}`);
}
// planned lines join the network: HS2 near its published 45-49 min, the WLO a real shortcut
{
  const P = withPlanned(graph, stations, read('planned'), PLANNED_RUN);
  const pnet = buildNetwork(P.graph, P.stations, (id) => modes.get(id) ?? PLANNED_RUN[id].like);
  const at = (name) => { const i = P.stations.findIndex((s) => s.name === name); assert.ok(i >= 0, name); return i; };
  const euston = travelTimes(pnet, at('Euston'))[at('Birmingham Curzon Street')];
  console.log(`Euston -> Birmingham Curzon Street (planned): ${euston.toFixed(1)} min`);
  assert.ok(euston >= 40 && euston <= 55, `HS2 Euston -> Curzon Street = ${euston.toFixed(1)}`);
  const today = travelTimes(net, idx('Hendon'))[idx('Hounslow')], wlo = travelTimes(pnet, at('Hendon'))[at('Hounslow')];
  console.log(`Hendon -> Hounslow: today ${today.toFixed(1)}, with WLO ${wlo.toFixed(1)} min`);
  assert.ok(wlo < today - 15, 'the WLO cuts Hendon -> Hounslow by well over 15 min');
  const ooc = travelTimes(pnet, at('Old Oak Common'))[at('Paddington')];
  console.log(`Old Oak Common -> Paddington (Elizabeth line): ${ooc.toFixed(1)} min`);
  assert.ok(ooc < 20, 'Old Oak Common is an Elizabeth line stop (6 min ride + platform walks and wait)');
  assert.equal(P.stations.length, stations.length + read('planned').stations.filter((s) => !s.existing).length, 'stops at existing stations reuse them');
}
console.log('planned ok');
