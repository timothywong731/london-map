// Plausibility checks for journey times against typical TfL journey-planner figures.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { LINES, OPERATORS } from '../lines.js';
import { buildNetwork, travelTimes } from '../journey.js';

const read = (f) => JSON.parse(fs.readFileSync(`data/${f}.json`, 'utf8'));
const stations = read('stations'), graph = read('graph');
const modes = new Map([...LINES, ...OPERATORS].map((l) => [l.id, l.mode]));
const net = buildNetwork(graph, stations, (id) => modes.get(id));
const idx = (name) => { const i = stations.findIndex((s) => s.name === name); assert.ok(i >= 0, name); return i; };

const cases = [
  // [from, to, min, max] — real door-to-platform-ish ranges incl. waiting
  ['Oxford Circus', 'Victoria', 4, 10],
  ['Oxford Circus', 'Stratford', 14, 28],
  ["King's Cross St. Pancras", 'Liverpool Street', 8, 20],
  ['Paddington', 'Canary Wharf', 18, 35],
  ['Waterloo', 'Wimbledon', 12, 30],
  ['Bank', 'Heathrow Terminals 2 & 3', 40, 75],
];
for (const [a, b, lo, hi] of cases) {
  const t = travelTimes(net, idx(a))[idx(b)];
  console.log(`${a} -> ${b}: ${t.toFixed(1)} min`);
  assert.ok(t >= lo && t <= hi, `${a} -> ${b} = ${t.toFixed(1)}, expected ${lo}-${hi}`);
}
const all = travelTimes(net, idx('Oxford Circus'));
const reach = (m) => [...all].filter((t) => t <= m).length;
console.log('from Oxford Circus within 15/30/45/60/90:', [15, 30, 45, 60, 90].map(reach).join(' / '));
assert.ok(reach(90) > stations.length * 0.8, 'most of the network within 90 min of Oxford Circus');
console.log('ok');
