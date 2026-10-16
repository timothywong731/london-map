// Fastest journey time (minutes) from one station to every other, by Dijkstra over
// (station, line) states. Shared by the browser and scripts/check-journey.mjs.
// ponytail: averages, not a timetable — first wait = half a typical headway, changes cost a
// fixed walk. Swap in TfL Journey Planner calls if exact times ever matter.

export const BANDS = [
  { max: 15, colour: '#CDE2FB' },
  { max: 30, colour: '#86B6EF' },
  { max: 45, colour: '#3987E5' },
  { max: 60, colour: '#256ABF' },
  { max: 90, colour: '#184F95' },
];
const WAIT = { tube: 2, 'elizabeth-line': 3, overground: 4, 'national-rail': 7, dlr: 3, tram: 4, 'cable-car': 2 };
const CHANGE = 3; // walk between platforms when leaving a train
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
  return { n, L, ride, linesAt, walk, wait };
}

export function travelTimes(net, origin) {
  const { n, L, ride, linesAt, walk, wait } = net;
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
      for (const l2 of linesAt[s]) push(s * S + l2, d + wait[l2]);
      for (const [b, m] of walk[s]) push(b * S + FOOT, d + m);
    } else {
      push(s * S + FOOT, d + CHANGE);
      for (const [b, l2, m] of ride[s]) if (l2 === l) push(b * S + l, d + m);
    }
  }
  const out = new Float64Array(n).fill(Infinity);
  for (let s = 0; s < n; s++) for (let l = 0; l < S; l++) out[s] = Math.min(out[s], dist[s * S + l]);
  out[origin] = 0;
  return out;
}
