// Sanity checks on the baked data. Run: npm run check
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { LINES, OPERATORS, TERMINALS } from '../lines.js';

const read = (f) => JSON.parse(fs.readFileSync(`data/${f}.json`, 'utf8'));
const lines = read('lines'), stations = read('stations'), zones = read('zones'), terminals = read('terminals');

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
assert.equal(terminals.length, TERMINALS.length);
for (const t of terminals) assert.ok(fs.existsSync(`assets/terminal_${t.model}.glb`), `model for ${t.id}`);

console.log(`ok: ${lines.length} lines, ${stations.length} stations, ${zones.length} zones, ${terminals.length} terminals`);
