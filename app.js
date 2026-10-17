import { MODES } from './lines.js';
import { BANDS, buildNetwork, travelTimes, isochroneGrid, gridFor, mercatorRows } from './journey.js';
import { contours } from 'https://cdn.jsdelivr.net/npm/d3-contour@4.0.2/+esm';

const $ = (id) => document.getElementById(id);
const rad = Math.PI / 180;
const isLight = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255 > 0.6;
};
const metres = (a, b) => Math.hypot((b[0] - a[0]) * 111320 * Math.cos(a[1] * rad), (b[1] - a[1]) * 111320);
const lonLats = (c) => { const o = []; for (let i = 0; i < c.length; i += 3) o.push([c[i], c[i + 1]]); return o; }; // baked [lon, lat, h, ...]; heights unused on a flat map
const fc = (features) => ({ type: 'FeatureCollection', features });
const pt = (coordinates, properties) => ({ type: 'Feature', properties, geometry: { type: 'Point', coordinates } });
const FONT = ['Noto Sans Regular']; // map text can only use the tile server's glyphs

const map = new maplibregl.Map({
  container: 'map', style: 'https://tiles.openfreemap.org/styles/positron',
  center: [-0.118, 51.48], zoom: 10.3, pitch: 45, bearing: 0, maxPitch: 70, attributionControl: { compact: true },
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
const mapReady = new Promise((resolve, reject) => {
  map.once('load', resolve);
  map.once('error', (e) => { if (!map.isStyleLoaded()) reject(e.error); });
});

const [lines, stations, zones, graph, planned] = await Promise.all(
  ['lines', 'stations', 'zones', 'graph', 'planned'].map((f) => fetch(`data/${f}.json`).then((r) => r.json())),
);
try {
  await mapReady;
} catch (err) {
  $('loading').textContent = "Couldn't load the base map";
  $('loading').classList.add('error');
  throw err;
}
const byId = new Map(lines.map((l) => [l.id, l]));
const plannedById = new Map(planned.lines.map((l) => [l.id, l]));
const lineOf = (id) => byId.get(id) || plannedById.get(id);
const vis = (ids, show) => ids.forEach((id) => map.setLayoutProperty(id, 'visibility', show ? 'visible' : 'none'));

// ---------------- zones: alternating soft bands, boundary, number labels ----------------
const ZONE_LAYERS = ['zones-fill', 'zones-line', 'zones-label'];
{
  const rings = zones.map((z) => { const r = []; for (let i = 0; i < z.rings[0].length; i += 2) r.push([z.rings[0][i], z.rings[0][i + 1]]); r.push(r[0]); return r; });
  const area = (r) => r.reduce((a, p, i) => (i ? a + r[i - 1][0] * p[1] - p[0] * r[i - 1][1] : a), 0); // > 0: counter-clockwise
  const wind = (r, ccw) => ((area(r) > 0) === ccw ? r : [...r].reverse()); // the hole must wind against the outer ring
  map.addSource('zones', { type: 'geojson', data: fc(rings.map((r, i) => ({ type: 'Feature', properties: { odd: i % 2 },
    geometry: { type: 'Polygon', coordinates: i ? [wind(r, true), wind(rings[i - 1], false)] : [wind(r, true)] } }))) });
  map.addSource('zone-rings', { type: 'geojson', data: fc(rings.map((r) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: r } }))) });
  map.addLayer({ id: 'zones-fill', type: 'fill', source: 'zones', paint: { 'fill-color': '#10069F', 'fill-opacity': ['case', ['==', ['get', 'odd'], 1], 0.1, 0.04] } });
  map.addLayer({ id: 'zones-line', type: 'line', source: 'zone-rings', paint: { 'line-color': '#10069F', 'line-opacity': 0.35, 'line-width': 1.5 } });
  // label each band midway between its inner and outer ring along two bearings from Charing Cross
  const O = [-0.1247, 51.5081], kx = Math.cos(O[1] * rad);
  const radial = (ring, b) => {
    let best = Infinity, dist = 0;
    for (const [lon, lat] of ring) {
      const x = (lon - O[0]) * kx, y = lat - O[1];
      const a = Math.atan2(x, y), diff = Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
      if (diff < best) (best = diff), (dist = Math.hypot(x, y));
    }
    return dist;
  };
  map.addSource('zone-labels', { type: 'geojson', data: fc(zones.flatMap((z, i) => [35, 215].map((bd) => {
    const b = bd * rad, r = (radial(rings[i], b) + (i ? radial(rings[i - 1], b) : 0)) / 2;
    return pt([O[0] + (Math.sin(b) * r) / kx, O[1] + Math.cos(b) * r], { name: `Zone ${z.zone}` });
  }))) });
  map.addLayer({ id: 'zones-label', type: 'symbol', source: 'zone-labels', layout: { 'text-field': ['get', 'name'], 'text-font': FONT, 'text-size': 16 },
    paint: { 'text-color': '#FFFFFF', 'text-halo-color': '#10069F', 'text-halo-width': 2 } });
}

// ---------------- lines: built and planned share one style ----------------
const WIDTH = { tube: 4, 'elizabeth-line': 5, overground: 3.5, dlr: 3, tram: 3, 'cable-car': 3, 'national-rail': 2, planned: 4 }; // px at zoom 12
const drawn = (l) => l.segs.some((s) => s.c.length >= 6);
const lineFeatures = (ls) => ls.flatMap((l) => l.segs.filter((s) => s.c.length >= 6).map((s) => ({
  type: 'Feature', properties: { line: l.id, colour: l.colour, w: WIDTH[l.mode], t: s.t ? 1 : 0 },
  geometry: { type: 'LineString', coordinates: lonLats(s.c) },
})));
const LINE_STYLE = {
  type: 'line', layout: { 'line-join': 'round', 'line-cap': 'round' },
  paint: {
    'line-color': ['get', 'colour'], 'line-opacity': ['case', ['==', ['get', 't'], 1], 0.5, 1], // tunnels at half strength
    'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 9, ['*', ['get', 'w'], 0.4], 12, ['get', 'w'], 16, ['*', ['get', 'w'], 3]],
  },
};
map.addSource('lines', { type: 'geojson', data: fc(lineFeatures(lines)) });
map.addSource('planned-lines', { type: 'geojson', data: fc(lineFeatures(planned.lines)) });
map.addLayer({ id: 'lines', source: 'lines', ...LINE_STYLE });
map.addLayer({ id: 'planned-lines', source: 'planned-lines', ...LINE_STYLE });
const hidden = new Set(); // line ids switched off in the key
function setLine(id, bar, show) {
  if (show) hidden.delete(id); else hidden.add(id);
  const filter = ['!', ['in', ['get', 'line'], ['literal', [...hidden]]]];
  map.setFilter('lines', filter);
  map.setFilter('planned-lines', filter);
  bar.setAttribute('aria-pressed', String(show));
}

// trains sit above the lines and below the stations
map.addSource('trains', { type: 'geojson', data: fc([]) });
map.addLayer({ id: 'trains', type: 'circle', source: 'trains', paint: {
  'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 2, 14, 4.5], 'circle-color': ['get', 'colour'],
  'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 1 } });

// ---------------- stations: TfL map style — interchange circles and line-coloured ticks ----------------
// nearest vertex of a line to a station -> where the tick sits and which way the track runs (deg from north)
function attach(st, line) {
  let best = Infinity, at = null;
  for (const s of line.segs) {
    const c = s.c;
    for (let i = 0; i < c.length; i += 3) {
      const d = (c[i] - st.lon) ** 2 + (c[i + 1] - st.lat) ** 2;
      if (d < best) {
        best = d;
        const j = i + 3 < c.length ? i : i - 3;
        at = { lon: c[i], lat: c[i + 1], bearing: Math.atan2((c[j + 3] - c[j]) * Math.cos(st.lat * rad), c[j + 4] - c[j + 1]) / rad };
      }
    }
  }
  return at;
}
// a marker and a label per station; `ref` is the station id a click opens
function stationFeatures(st, lineIds, ref) {
  const label = pt([st.lon, st.lat], { ref, kind: 'label', name: st.name, ix: lineIds.length > 1 ? 1 : 0 });
  if (lineIds.length > 1) return [pt([st.lon, st.lat], { ref, kind: 'ix' }), label];
  const line = lineOf(lineIds[0]), a = line && attach(st, line);
  if (!a) return [label];
  // the tick image is a horizontal bar; rotating it by the track bearing lays it across the track
  return [pt([a.lon, a.lat], { ref, kind: 'tick', colour: line.colour, icon: `tick${line.colour}`, rot: a.bearing }), label];
}
for (const colour of new Set([...lines, ...planned.lines].map((l) => l.colour))) {
  const ctx = Object.assign(document.createElement('canvas'), { width: 28, height: 10 }).getContext('2d');
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, 28, 10);
  map.addImage(`tick${colour}`, ctx.getImageData(0, 0, 28, 10), { pixelRatio: 2 });
}
// built and planned stations get the same five layers, so they look identical
function stationLayers(src) {
  const kind = (k) => ['==', ['get', 'kind'], k];
  const text = { 'text-field': ['get', 'name'], 'text-font': FONT, 'text-anchor': 'left', 'text-offset': [0.8, 0] };
  const paint = { 'text-color': '#1D1D1B', 'text-halo-color': '#FFFFFF', 'text-halo-width': 1.5 };
  const layers = [
    { id: `${src}-dot`, type: 'circle', source: src, minzoom: 9, maxzoom: 11, filter: kind('tick'), // ticks are too small to read when zoomed out
      paint: { 'circle-radius': 2.5, 'circle-color': '#FFFFFF', 'circle-stroke-color': ['get', 'colour'], 'circle-stroke-width': 1.5 } },
    { id: `${src}-tick`, type: 'symbol', source: src, minzoom: 11, filter: kind('tick'),
      layout: { 'icon-image': ['get', 'icon'], 'icon-rotate': ['get', 'rot'], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.8, 15, 1.6] } },
    { id: `${src}-ix`, type: 'circle', source: src, filter: kind('ix'),
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 3, 14, 6], 'circle-color': '#FFFFFF', 'circle-stroke-color': '#000000',
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 9, 1.5, 14, 2] } },
    { id: `${src}-label-ix`, type: 'symbol', source: src, minzoom: 12, filter: ['all', kind('label'), ['==', ['get', 'ix'], 1]], layout: { ...text, 'text-size': 13 }, paint },
    { id: `${src}-label`, type: 'symbol', source: src, minzoom: 13.5, filter: ['all', kind('label'), ['==', ['get', 'ix'], 0]], layout: { ...text, 'text-size': 12 }, paint },
  ];
  layers.forEach((l) => map.addLayer(l));
  return layers.map((l) => l.id);
}
map.addSource('stations', { type: 'geojson', data: fc(stations.flatMap((st) => stationFeatures(st, st.lines, st.id))) });
const STATION_LAYERS = stationLayers('stations');

// ---------------- planned lines (phase 2): drawn like built ones, never in journey times ----------------
const plannedByStation = new Map(); // existing station id -> planned stations there (for card chips)
map.addSource('planned', { type: 'geojson', data: fc(planned.stations.flatMap((st) => {
  st.planned = true;
  if (!st.existing) return stationFeatures(st, [...st.lines, ...st.also], st.id);
  plannedByStation.set(st.existing, [...(plannedByStation.get(st.existing) || []), st]);
  const ex = stations.find((s) => s.id === st.existing); // gains a line, so it reads as an interchange while planned lines show
  return ex ? [pt([ex.lon, ex.lat], { ref: ex.id, kind: 'ix' })] : [];
})) });
const PLANNED_LAYERS = ['planned-lines', ...stationLayers('planned')];
let plannedOn = true;

// ---------------- simulated trains ----------------
const SPEED = { tube: 9, 'elizabeth-line': 14, overground: 11, 'national-rail': 18, dlr: 8, tram: 6, 'cable-car': 5 }; // m/s, average incl. stops
const HEADWAY = { tube: 200, 'elizabeth-line': 360, overground: 600, 'national-rail': 900, dlr: 300, tram: 420, 'cable-car': 40 }; // s
const trains = [];
let simTime = 0, speedMult = 10, lastFrame = 0, raf = 0;
function buildTrains() {
  for (const l of lines) for (const r of l.routes) {
    const pts = lonLats(r), cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + metres(pts[i - 1], pts[i]));
    const L = cum.at(-1);
    if (L < 500) continue;
    const v = SPEED[l.mode], n = Math.min(24, Math.max(1, Math.round((2 * L) / (v * HEADWAY[l.mode]))));
    for (let k = 0; k < n; k++) trains.push({ line: l.id, colour: l.colour, pts, cum, L, v, phase: (k / n) * 2 * L + Math.random() * 200 });
  }
  console.log('trains', trains.length);
}
// each train runs to the end of its route and back
function trainFeatures() {
  const out = [];
  for (const t of trains) {
    if (hidden.has(t.line)) continue;
    const s = (((t.phase + t.v * simTime) % (2 * t.L)) + 2 * t.L) % (2 * t.L), d = s < t.L ? s : 2 * t.L - s;
    let lo = 0, hi = t.cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t.cum[m] <= d) lo = m; else hi = m; }
    const f = (d - t.cum[lo]) / (t.cum[hi] - t.cum[lo] || 1), a = t.pts[lo], b = t.pts[hi];
    out.push(pt([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], { colour: t.colour }));
  }
  return out;
}
// ponytail: setData every frame; throttle to 30 fps if phones stutter
function animate(now) {
  const dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0;
  lastFrame = now;
  simTime += dt * speedMult;
  map.getSource('trains').setData(fc(trainFeatures()));
  raf = requestAnimationFrame(animate);
}

// ---------------- UI ----------------
const on = (id, fn) => $(id).addEventListener('change', (e) => fn(e.target.checked));
on('t-zones', (v) => vis(ZONE_LAYERS, v));
on('t-stations', (v) => vis(STATION_LAYERS, v));
on('t-planned', (v) => { plannedOn = v; vis(PLANNED_LAYERS, v); });
on('t-trains', (v) => {
  if (v && !trains.length) buildTrains();
  cancelAnimationFrame(raf);
  if (v) { lastFrame = 0; raf = requestAnimationFrame(animate); } else map.getSource('trains').setData(fc([]));
});
document.querySelectorAll('input[name=speed]').forEach((r) => r.addEventListener('change', () => (speedMult = +r.value)));
on('t-buildings', (v) => {
  if (map.getLayer('buildings-3d')) return vis(['buildings-3d'], v);
  if (v) map.addLayer({ id: 'buildings-3d', type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'building', minzoom: 13,
    paint: { 'fill-extrusion-color': '#E4E4E2', 'fill-extrusion-height': ['get', 'render_height'],
      'fill-extrusion-base': ['get', 'render_min_height'], 'fill-extrusion-opacity': 0.85 } }, 'zones-fill');
});

$('collapse').addEventListener('click', () => {
  const c = $('panel').classList.toggle('collapsed');
  $('collapse').setAttribute('aria-expanded', String(!c));
  $('collapse').title = c ? 'Show layers' : 'Hide layers';
});

// key: one bar per line, grouped by mode
const key = $('key');
for (const [mode, label] of Object.entries(MODES)) {
  const group = [...lines, ...planned.lines].filter((l) => l.mode === mode && drawn(l));
  if (!group.length) continue;
  const sec = document.createElement('section');
  sec.className = 'mode' + (mode === 'national-rail' ? ' rail' : '');
  sec.innerHTML = `<div class="mode-head"><h2>${label}</h2>${group.length > 1 ? '<button type="button">Hide all</button>' : ''}</div>`;
  const bars = group.map((l) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'bar' + (isLight(l.colour) ? ' light' : '');
    b.style.setProperty('--c', l.colour);
    b.textContent = l.name;
    b.setAttribute('aria-pressed', 'true');
    b.onclick = () => setLine(l.id, b, b.getAttribute('aria-pressed') !== 'true');
    sec.appendChild(b);
    return [l.id, b];
  });
  const all = sec.querySelector('.mode-head button');
  if (all) all.onclick = () => {
    const show = all.textContent === 'Show all';
    bars.forEach(([id, b]) => setLine(id, b, show));
    all.textContent = show ? 'Hide all' : 'Show all';
  };
  key.appendChild(sec);
}

// ---------------- station card + journey times ----------------
const net = buildNetwork(graph, stations, (id) => byId.get(id)?.mode);
const stationIndex = new Map(stations.map((st, i) => [st, i]));
// Grid the reachable-area map is computed on: ~100 m cells over the whole network
const GRID = gridFor(stations);
let isoField = null; // the shown grid + origin, for the hover tooltip
map.addSource('iso-contours', { type: 'geojson', data: fc([]) });
map.addLayer({ id: 'iso-contours', type: 'line', source: 'iso-contours', paint: { 'line-color': '#FFFFFF', 'line-opacity': 0.9, 'line-width': 1.5 } }, 'lines');
map.addSource('iso', { type: 'geojson', data: fc([]) });
map.addImage('tag', { width: 16, height: 16, data: new Uint8Array(16 * 16 * 4).map((_, i) => [16, 6, 159, 255][i % 4]) }); // TfL blue, stretched behind the "from" name (1 px would blur into a glow)
const isDot = ['==', ['get', 'kind'], 'dot'], isOrigin = ['==', ['get', 'kind'], 'origin'];
const darkText = { 'text-color': '#1D1D1B', 'text-halo-color': '#FFFFFF', 'text-halo-width': 1.5 };
map.addLayer({ id: 'iso-dots', type: 'circle', source: 'iso', minzoom: 12.3, filter: isDot,
  paint: { 'circle-radius': 3, 'circle-color': '#FFFFFF', 'circle-stroke-color': '#1D1D1B', 'circle-stroke-width': 1.5 } });
map.addLayer({ id: 'iso-labels', type: 'symbol', source: 'iso', minzoom: 13.3, filter: isDot,
  layout: { 'text-field': ['get', 'name'], 'text-font': FONT, 'text-size': 12, 'text-anchor': 'top', 'text-offset': [0, 0.8] }, paint: darkText });
map.addLayer({ id: 'iso-origin', type: 'circle', source: 'iso', filter: isOrigin,
  paint: { 'circle-radius': 8, 'circle-color': '#FFFFFF', 'circle-stroke-color': '#DA291C', 'circle-stroke-width': 4 } });
map.addLayer({ id: 'iso-origin-label', type: 'symbol', source: 'iso', filter: isOrigin, layout: {
  'text-field': ['get', 'name'], 'text-font': FONT, 'text-size': 16, 'text-anchor': 'bottom', 'text-offset': [0, -1.1], 'text-allow-overlap': true,
  'icon-image': 'tag', 'icon-text-fit': 'both', 'icon-text-fit-padding': [5, 9, 5, 9], 'icon-allow-overlap': true }, paint: { 'text-color': '#FFFFFF' } });

// Shade every band (an image over the grid's corners) and outline it with smooth contours.
function drawReachableArea(times, from) {
  const { field, W, H } = isochroneGrid(stations, times, GRID, BANDS.at(-1).max);
  isoField = { field, W, H, from };
  const canvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = canvas.getContext('2d'), img = ctx.createImageData(W, H);
  const rgb = BANDS.map((b) => [1, 3, 5].map((i) => parseInt(b.colour.slice(i, i + 2), 16)));
  const rows = mercatorRows(GRID, H); // the map stretches the image in Mercator; resample so bands sit where the tooltip says
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const b = BANDS.findIndex((k) => field[rows[y] * W + x] <= k.max);
    if (b >= 0) img.data.set([...rgb[b], 255], (y * W + x) * 4);
  }
  ctx.putImageData(img, 0, 0);
  const url = canvas.toDataURL(), coordinates = [[GRID.w, GRID.n], [GRID.e, GRID.n], [GRID.e, GRID.s], [GRID.w, GRID.s]];
  if (map.getSource('iso-image')) map.getSource('iso-image').updateImage({ url, coordinates });
  else {
    map.addSource('iso-image', { type: 'image', url, coordinates });
    map.addLayer({ id: 'iso-image', type: 'raster', source: 'iso-image', paint: { 'raster-opacity': 0.72, 'raster-fade-duration': 0 } }, 'iso-contours');
  }
  vis(['iso-image'], true);

  // contour lines: d3 fills "value >= threshold", so contour the negated times
  const neg = Float64Array.from(field, (v) => (Number.isFinite(v) ? -v : -1e4));
  const toLL = ([x, y]) => [GRID.w + (x / W) * (GRID.e - GRID.w), GRID.n - (y / H) * (GRID.n - GRID.s)];
  const outlines = [];
  for (const band of BANDS) {
    const [mp] = contours().size([W, H]).thresholds([-band.max])(neg);
    for (const poly of mp.coordinates) for (const ring of poly)
      if (ring.length >= 8) outlines.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: ring.map(toLL) } });
  }
  map.getSource('iso-contours').setData(fc(outlines));
}
const fmt = (m) => (m < 60 ? `${Math.round(m)} min` : `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')}`);
const flyTo = (st) => map.flyTo({ center: [st.lon, st.lat], zoom: 11, pitch: 45, duration: 1500 });

const plannedChip = (id) => {
  const l = lineOf(id), li = document.createElement('li');
  li.textContent = `${l?.name || id} (planned)`;
  li.style.setProperty('--c', l?.colour || '#777');
  if (l && isLight(l.colour)) li.className = 'light';
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
  if (fly) flyTo(st);
}

function selectStation(st, fly = false) {
  if (st.planned && !st.existing) return selectPlanned(st, fly);
  $('card-name').textContent = st.name;
  $('card-zone').textContent = st.zones.length ? `Zone ${st.zones.join('/')}` : 'Outside the fare zones';
  $('card-lines').replaceChildren(...st.lines.map((id) => {
    const l = byId.get(id), li = document.createElement('li');
    li.textContent = l?.name || id;
    li.style.setProperty('--c', l?.colour || '#777');
    if (l && isLight(l.colour)) li.className = 'light';
    return li;
  }));
  if (plannedOn) for (const p of plannedByStation.get(st.id) || []) $('card-lines').append(...p.lines.map(plannedChip));
  $('card-times').closest('.times').hidden = false;
  $('card').hidden = false;
  if (fly) flyTo(st);

  // reachable area: rail (with changes between lines) then a walk from the station
  const origin = stationIndex.get(st), times = travelTimes(net, origin);
  vis([...STATION_LAYERS, ...ZONE_LAYERS], false); // markers and zone rings would clutter the shaded bands
  drawReachableArea(times, st.name);
  const groups = BANDS.map(() => []), iso = [];
  stations.forEach((s, i) => {
    const t = times[i], b = BANDS.findIndex((x) => t <= x.max);
    if (b < 0) return;
    if (i === origin) { iso.push(pt([s.lon, s.lat], { ref: s.id, kind: 'origin', name: s.name })); return; }
    groups[b].push([t, s]);
    iso.push(pt([s.lon, s.lat], { ref: s.id, kind: 'dot', name: `${s.name} ${fmt(t)}` }));
  });
  map.getSource('iso').setData(fc(iso));
  $('card-times').replaceChildren(...BANDS.map((band, b) => {
    const list = groups[b].sort((x, y) => x[0] - y[0]);
    const prev = b ? BANDS[b - 1].max : 0;
    const li = document.createElement('li');
    li.innerHTML = `<details><summary><i style="--c:${band.colour}"></i><span>${prev ? `${prev}–${band.max}` : `Under ${band.max}`} min</span><b>${list.length}</b></summary><ol></ol></details>`;
    li.querySelector('ol').append(...list.map(([t, s]) => {
      const o = document.createElement('li');
      o.innerHTML = '<button type="button"></button><span></span>';
      o.querySelector('button').textContent = s.name;
      o.querySelector('span').textContent = fmt(t);
      o.querySelector('button').onclick = () => selectStation(s, true);
      return o;
    }));
    return li;
  }));
}
function clearSelection() {
  $('card').hidden = true;
  map.getSource('iso').setData(fc([]));
  map.getSource('iso-contours').setData(fc([]));
  if (map.getLayer('iso-image')) vis(['iso-image'], false);
  isoField = null;
  $('tip').hidden = true;
  vis(STATION_LAYERS, $('t-stations').checked);
  vis(ZONE_LAYERS, $('t-zones').checked);
}

// journey time of the reachable-area grid cell under a point (hover, or tap on touch screens)
const tip = $('tip');
function showTip(p, ll) {
  let t = Infinity;
  if (isoField) {
    const { field, W, H } = isoField;
    const x = Math.floor(((ll.lng - GRID.w) / (GRID.e - GRID.w)) * W);
    const y = Math.floor(((GRID.n - ll.lat) / (GRID.n - GRID.s)) * H);
    if (x >= 0 && x < W && y >= 0 && y < H) t = field[y * W + x];
  }
  const band = BANDS.find((b) => t <= b.max);
  if (!band) { tip.hidden = true; return; }
  tip.innerHTML = `<i style="--c:${band.colour}"></i><b>${t < 1 ? 'Under 1 min' : fmt(t)}</b><span></span>`;
  tip.querySelector('span').textContent = `from ${isoField.from}`;
  tip.style.left = `${p.x}px`; tip.style.top = `${p.y}px`;
  tip.hidden = false;
}
const stationByRef = new Map([...stations, ...planned.stations].map((s) => [s.id, s]));
const CLICKABLE = [...STATION_LAYERS, ...PLANNED_LAYERS.slice(1), 'iso-dots', 'iso-origin'];
map.on('click', (e) => {
  const { x, y } = e.point;
  const f = map.queryRenderedFeatures([[x - 6, y - 6], [x + 6, y + 6]], { layers: CLICKABLE })[0];
  const st = f && stationByRef.get(f.properties.ref); // a planned marker at e.g. Euston opens today's station
  if (st) selectStation(st);
  else showTip(e.point, e.lngLat);
});
map.on('mousemove', (e) => showTip(e.point, e.lngLat));
map.getCanvas().addEventListener('mouseleave', () => { tip.hidden = true; });
$('card-close').onclick = clearSelection;

// station search: native datalist over unique station names
const byName = new Map();
for (const st of stations) if (!byName.has(st.name)) byName.set(st.name, st);
for (const st of planned.stations) if (!st.existing && !byName.has(st.name)) byName.set(st.name, st);
$('station-list').append(...[...byName.keys()].sort().map((n) => Object.assign(document.createElement('option'), { value: n })));
$('station-search').addEventListener('change', (e) => {
  const st = byName.get(e.target.value.trim());
  if (st && (plannedOn || !st.planned || st.existing)) { selectStation(st, true); e.target.blur(); }
});

$('loading').classList.add('done');
window.__map = { map, lines, trains }; // handy for debugging in the console
