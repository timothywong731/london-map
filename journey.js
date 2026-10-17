// Fastest journey time (minutes) from one station to every other, by Dijkstra over
// (station, line) states. Shared by the browser and scripts/check-journey.mjs.
// ponytail: averages, not a timetable — waits are half a typical headway and every boarding or
// alighting costs a per-mode platform walk. Swap in TfL Journey Planner calls if exact times matter.

export const BANDS = [
  { max: 15, colour: '#CDE2FB' },
  { max: 30, colour: '#86B6EF' },
  { max: 45, colour: '#3987E5' },
  { max: 60, colour: '#256ABF' },
  { max: 90, colour: '#184F95' },
];
const WAIT = { tube: 2, 'elizabeth-line': 3, overground: 4, 'national-rail': 7, dlr: 3, tram: 4, 'cable-car': 2 };
// Street/concourse <-> platform walk per mode (minutes). A change = ACCESS[from] + ACCESS[to] + WAIT[to].
const ACCESS = { tube: 2, 'elizabeth-line': 4, overground: 1.5, 'national-rail': 2, dlr: 1, tram: 0.5, 'cable-car': 1 };
const WALK_M = 500, WALK_SPEED = 80, WALK_DETOUR = 1.3; // short street walks between nearby stations

export function buildNetwork(graph, stations, modeOf) {
  const n = stations.length, L = graph.lines.length;
  const ride = Array.from({ length: n }, () => []); // ride[a] = [b, line, minutes]
  const linesAt = Array.from({ length: n }, () => new Set());
  for (const [a, b, l, m] of graph.edges) { ride[a].push([b, l, m]); linesAt[a].add(l); }
  const walk = Array.from({ length: n }, () => []);
  const k = Math.cos((51.5 * Math.PI) / 180) * 111320;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const d = Math.hypot((stations[i].lon - stations[j].lon) * k, (stations[i].lat - stations[j].lat) * 111320);
      if (d < WALK_M) { const m = (d * WALK_DETOUR) / WALK_SPEED; walk[i].push([j, m]); walk[j].push([i, m]); }
    }
  const wait = graph.lines.map((id) => WAIT[modeOf(id)] ?? 5);
  const access = graph.lines.map((id) => ACCESS[modeOf(id)] ?? 2);
  return { n, L, ride, linesAt, walk, wait, access };
}

export function travelTimes(net, origin) {
  const { n, L, ride, linesAt, walk, wait, access } = net;
  const FOOT = L, S = L + 1; // state = station * S + line; line === FOOT means on foot in the station
  const dist = new Float64Array(n * S).fill(Infinity);
  const heap = [];
  const push = (state, d) => {
    if (d >= dist[state]) return;
    dist[state] = d;
    heap.push([d, state]);
    for (let i = heap.length - 1; i > 0; ) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]]; i = p;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ; ) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
      }
    }
    return top;
  };
  push(origin * S + FOOT, 0);
  while (heap.length) {
    const [d, state] = pop();
    if (d > dist[state]) continue;
    const s = Math.floor(state / S), l = state % S;
    if (l === FOOT) {
      for (const l2 of linesAt[s]) push(s * S + l2, d + access[l2] + wait[l2]);
      for (const [b, m] of walk[s]) push(b * S + FOOT, d + m);
    } else {
      push(s * S + FOOT, d + access[l]);
      for (const [b, l2, m] of ride[s]) if (l2 === l) push(b * S + l, d + m);
    }
  }
  const out = new Float64Array(n).fill(Infinity);
  for (let s = 0; s < n; s++) out[s] = dist[s * S + FOOT]; // time to be out of the station, on foot
  out[origin] = 0;
  return out;
}

// Time to reach each cell of a lon/lat grid: rail to the best station, then walk from it.
// Row 0 is the north edge. Walking is capped so the area hugs the network, like a real isochrone.
export const WALK_CAP = 20; // minutes on foot from the last station
// Grid covering every station plus the longest walk from it, so outlying stations (e.g. Reading) are shaded too.
export function gridFor(stations, cell = 100) {
  const m = (WALK_CAP * WALK_SPEED) / WALK_DETOUR / 111320 / Math.cos((51.5 * Math.PI) / 180) + 0.005; // degrees, generous
  const lon = stations.map((s) => s.lon), lat = stations.map((s) => s.lat);
  return { w: Math.min(...lon) - m, e: Math.max(...lon) + m, s: Math.min(...lat) - m, n: Math.max(...lat) + m, cell };
}
export function isochroneGrid(stations, times, g, maxMin) {
  const kx = Math.cos((51.5 * Math.PI) / 180) * 111320, ky = 111320;
  const W = Math.ceil(((g.e - g.w) * kx) / g.cell), H = Math.ceil(((g.n - g.s) * ky) / g.cell);
  const field = new Float32Array(W * H).fill(Infinity);
  const v = WALK_SPEED / WALK_DETOUR; // straight-line metres per minute on foot
  stations.forEach((s, i) => {
    const t = times[i];
    if (!(t < maxMin)) return;
    const r = (Math.min(WALK_CAP, maxMin - t) * v) / g.cell; // radius in cells
    const cx = ((s.lon - g.w) * kx) / g.cell, cy = ((g.n - s.lat) * ky) / g.cell;
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(H - 1, Math.ceil(cy + r)); y++)
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(W - 1, Math.ceil(cx + r)); x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d > r) continue;
        const m = t + (d * g.cell) / v;
        if (m < field[y * W + x]) field[y * W + x] = m;
      }
  });
  return { field, W, H };
}

// Image overlays are stretched linearly in Web Mercator, but grid rows are linear in latitude.
// For each row of a Mercator-spaced image of H rows (north first), the grid row to sample.
export function mercatorRows(g, H) {
  const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const yn = merc(g.n), ys = merc(g.s), rows = new Int32Array(H);
  for (let r = 0; r < H; r++) {
    const lat = ((2 * Math.atan(Math.exp(yn + ((r + 0.5) / H) * (ys - yn))) - Math.PI / 2) * 180) / Math.PI;
    rows[r] = Math.min(H - 1, Math.max(0, Math.floor(((g.n - lat) / (g.n - g.s)) * H)));
  }
  return rows;
}
