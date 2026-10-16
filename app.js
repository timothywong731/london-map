import { MODES } from './lines.js';
import { BANDS, buildNetwork, travelTimes, isochroneGrid, gridFor } from './journey.js';
import { contours } from 'https://cdn.jsdelivr.net/npm/d3-contour@4.0.2/+esm';
// config.js is gitignored: local copy for dev, written from a repo secret by the Pages workflow.
const { ION_TOKEN } = await import('./config.js').catch(() => ({}));

const C = window.Cesium;
if (ION_TOKEN) C.Ion.defaultAccessToken = ION_TOKEN;

const viewer = new C.Viewer('map', {
  terrain: C.Terrain.fromWorldTerrain(),
  baseLayer: C.ImageryLayer.fromWorldImagery({ style: C.IonWorldImageryStyle.AERIAL }),
  baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false,
  navigationHelpButton: false, animation: false, timeline: false, fullscreenButton: false,
  infoBox: false, selectionIndicator: false,
});
const scene = viewer.scene;
scene.globe.depthTestAgainstTerrain = false; // keep tunnels visible through the ground by default
scene.postProcessStages.fxaa.enabled = true;
viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(C.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

const HOME = { destination: C.Cartesian3.fromDegrees(-0.118, 51.33, 19000), orientation: { heading: 0, pitch: C.Math.toRadians(-42), roll: 0 } };
viewer.camera.setView(HOME);

const css = (hex) => C.Color.fromCssColorString(hex);
const isLight = (hex) => { const c = css(hex); return 0.2126 * c.red + 0.7152 * c.green + 0.0722 * c.blue > 0.6; };
const deg = C.Math.toRadians;

// Local frame whose +X points along `bearing` (deg from north), +Z up. Blender assets use +X forward.
function frame(lon, lat, h, bearing) {
  const enu = C.Transforms.eastNorthUpToFixedFrame(C.Cartesian3.fromDegrees(lon, lat, h));
  const b = deg(bearing), s = Math.sin(b), c = Math.cos(b);
  const rot = new C.Matrix4(s, -c, 0, 0, c, s, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1); // row-major: cols = fwd, left, up
  return C.Matrix4.multiply(enu, rot, new C.Matrix4());
}
const gltf = (url, opts) => C.Model.fromGltfAsync({ url, upAxis: C.Axis.Y, forwardAxis: C.Axis.X, ...opts });

const [lines, stations, zones, graph, planned] = await Promise.all(
  ['lines', 'stations', 'zones', 'graph', 'planned'].map((f) => fetch(`data/${f}.json`).then((r) => r.json())),
);
const byId = new Map(lines.map((l) => [l.id, l]));

// ---------------- lines ----------------
const WIDTH = { tube: 4, 'elizabeth-line': 5, overground: 3.5, dlr: 3, tram: 3, 'cable-car': 3, 'national-rail': 2 };
const linePrims = new Map();
for (const l of lines) {
  const col = css(l.colour);
  const instances = l.segs.filter((s) => s.c.length >= 6).map((s) => new C.GeometryInstance({
    geometry: new C.PolylineGeometry({
      positions: C.Cartesian3.fromDegreesArrayHeights(s.c),
      width: WIDTH[l.mode], arcType: C.ArcType.NONE, vertexFormat: C.PolylineColorAppearance.VERTEX_FORMAT,
    }),
    attributes: { color: C.ColorGeometryInstanceAttribute.fromColor(s.t ? col.withAlpha(0.5) : col) },
  }));
  if (!instances.length) continue;
  linePrims.set(l.id, scene.primitives.add(new C.Primitive({
    geometryInstances: instances, appearance: new C.PolylineColorAppearance({ translucent: true }),
  })));
}

// ---------------- zones: alternating soft bands, white boundary, number labels ----------------
const zoneLayer = new C.PrimitiveCollection();
scene.primitives.add(zoneLayer);
{
  const rings = zones.map((z) => z.rings[0]);
  const band = (i) => new C.GeometryInstance({
    geometry: new C.PolygonGeometry({
      polygonHierarchy: new C.PolygonHierarchy(C.Cartesian3.fromDegreesArray(rings[i]),
        i ? [new C.PolygonHierarchy(C.Cartesian3.fromDegreesArray(rings[i - 1]))] : []),
    }),
    attributes: { color: C.ColorGeometryInstanceAttribute.fromColor(i % 2 ? css('#10069F').withAlpha(0.10) : C.Color.WHITE.withAlpha(0.13)) },
  });
  zoneLayer.add(new C.GroundPrimitive({
    geometryInstances: rings.map((_, i) => band(i)),
    appearance: new C.PerInstanceColorAppearance({ flat: true, translucent: true }),
  }));
  zoneLayer.add(new C.GroundPolylinePrimitive({
    geometryInstances: rings.map((r) => new C.GeometryInstance({
      geometry: new C.GroundPolylineGeometry({ positions: C.Cartesian3.fromDegreesArray([...r, r[0], r[1]]), width: 2 }),
      attributes: { color: C.ColorGeometryInstanceAttribute.fromColor(C.Color.WHITE.withAlpha(0.8)) },
    })),
    appearance: new C.PolylineColorAppearance(),
  }));
  // label each band midway between its inner and outer ring along two bearings from Charing Cross
  const O = [-0.1247, 51.5081], kx = Math.cos(deg(O[1]));
  const radial = (ring, b) => {
    let best = Infinity, dist = 0;
    for (let i = 0; i < ring.length; i += 2) {
      const x = (ring[i] - O[0]) * kx, y = ring[i + 1] - O[1];
      const a = Math.atan2(x, y), diff = Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
      if (diff < best) (best = diff), (dist = Math.hypot(x, y));
    }
    return dist;
  };
  const labels = zoneLayer.add(new C.LabelCollection({ scene }));
  zones.forEach((z, i) => {
    for (const bd of [35, 215]) {
      const b = deg(bd), r = (radial(rings[i], b) + (i ? radial(rings[i - 1], b) : 0)) / 2;
      labels.add({
        position: C.Cartesian3.fromDegrees(O[0] + (Math.sin(b) * r) / kx, O[1] + Math.cos(b) * r),
        text: `Zone ${z.zone}`, font: '500 20px Jost, sans-serif', fillColor: C.Color.WHITE,
        outlineColor: css('#10069F'), outlineWidth: 4, style: C.LabelStyle.FILL_AND_OUTLINE,
        heightReference: C.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Infinity,
        distanceDisplayCondition: new C.DistanceDisplayCondition(0, 120000),
      });
    }
  });
}

// ---------------- stations: TfL map style — interchange rings and line-coloured ticks ----------------
const stationLayer = new C.PrimitiveCollection();
scene.primitives.add(stationLayer);
const NEAR = 6000;
{
  const points = stationLayer.add(new C.PointPrimitiveCollection());
  const labels = stationLayer.add(new C.LabelCollection({ scene }));
  // nearest vertex of a line to a station -> where the tick sits and which way it points
  function attach(st, line) {
    let best = Infinity, at = null;
    for (const s of line.segs) {
      const c = s.c;
      for (let i = 0; i < c.length; i += 3) {
        const d = (c[i] - st.lon) ** 2 + (c[i + 1] - st.lat) ** 2;
        if (d < best) {
          best = d;
          const j = i + 3 < c.length ? i : i - 3;
          at = { lon: c[i], lat: c[i + 1], h: c[i + 2], dx: (c[j + 3] - c[j]) * Math.cos(deg(st.lat)), dy: c[j + 4] - c[j + 1] };
        }
      }
    }
    return at;
  }
  for (const st of stations) {
    const ground = st.h + 3;
    const interchange = st.lines.length > 1;
    const line = byId.get(st.lines[0]);
    if (interchange) {
      points.add({ id: st, position: C.Cartesian3.fromDegrees(st.lon, st.lat, ground), pixelSize: 7, color: C.Color.WHITE,
        outlineColor: C.Color.BLACK, outlineWidth: 2, disableDepthTestDistance: Infinity,
        distanceDisplayCondition: new C.DistanceDisplayCondition(NEAR, 2e5) });
      gltf('assets/station_interchange.glb', { id: st, modelMatrix: C.Matrix4.multiplyByUniformScale(frame(st.lon, st.lat, ground, 0), 14, new C.Matrix4()),
        minimumPixelSize: 10, distanceDisplayCondition: new C.DistanceDisplayCondition(0, NEAR) }).then((m) => stationLayer.add(m));
    } else if (line?.segs.length) {
      const a = attach(st, line);
      if (!a) continue;
      const bearing = (Math.atan2(a.dx, a.dy) * 180) / Math.PI + 90; // perpendicular to the track
      gltf('assets/station_tick.glb', { id: st, color: css(line.colour), colorBlendMode: C.ColorBlendMode.MIX, colorBlendAmount: 1,
        modelMatrix: C.Matrix4.multiplyByScale(frame(a.lon, a.lat, a.h + 1, bearing), new C.Cartesian3(28, 14, 4), new C.Matrix4()), // 28 m x 6 m x 1 m bar
        distanceDisplayCondition: new C.DistanceDisplayCondition(0, NEAR) }).then((m) => stationLayer.add(m));
      points.add({ id: st, position: C.Cartesian3.fromDegrees(a.lon, a.lat, a.h + 1), pixelSize: 4, color: C.Color.WHITE,
        outlineColor: css(line.colour), outlineWidth: 1.5, disableDepthTestDistance: Infinity,
        distanceDisplayCondition: new C.DistanceDisplayCondition(NEAR, 40000) });
    }
    labels.add({ id: st, position: C.Cartesian3.fromDegrees(st.lon, st.lat, ground + 8), text: st.name,
      font: `500 ${interchange ? 15 : 13}px Jost, sans-serif`, fillColor: C.Color.WHITE, outlineColor: css('#1D1D1B'),
      outlineWidth: 3, style: C.LabelStyle.FILL_AND_OUTLINE, horizontalOrigin: C.HorizontalOrigin.LEFT,
      pixelOffset: new C.Cartesian2(10, 0), disableDepthTestDistance: Infinity,
      distanceDisplayCondition: new C.DistanceDisplayCondition(0, interchange ? 9000 : 3500) });
  }
}

// ---------------- simulated trains ----------------
const TRAIN_MODEL = { tube: 'train_tube', 'elizabeth-line': 'train_rail', overground: 'train_rail', 'national-rail': 'train_rail', dlr: 'train_dlr', tram: 'train_tram', 'cable-car': 'gondola' };
const SPEED = { tube: 9, 'elizabeth-line': 14, overground: 11, 'national-rail': 18, dlr: 8, tram: 6, 'cable-car': 5 }; // m/s, average incl. stops
const HEADWAY = { tube: 200, 'elizabeth-line': 360, overground: 600, 'national-rail': 900, dlr: 300, tram: 420, 'cable-car': 40 }; // s
const trains = [];
let trainLayer = null, simTime = 0, speedMult = 10, lastFrame = 0;

function buildTrains() {
  trainLayer = scene.primitives.add(new C.PrimitiveCollection());
  const dots = trainLayer.add(new C.PointPrimitiveCollection());
  for (const l of lines) {
    for (const r of l.routes) {
      const pos = [], cum = [0];
      for (let i = 0; i < r.length; i += 3) pos.push(C.Cartesian3.fromDegrees(r[i], r[i + 1], r[i + 2] + 2));
      for (let i = 1; i < pos.length; i++) cum.push(cum[i - 1] + C.Cartesian3.distance(pos[i - 1], pos[i]));
      const L = cum[cum.length - 1];
      if (L < 500) continue;
      const v = SPEED[l.mode], n = Math.min(24, Math.max(1, Math.round((2 * L) / (v * HEADWAY[l.mode]))));
      for (let k = 0; k < n; k++) {
        const t = { line: l.id, pos, cum, L, v, phase: (k / n) * 2 * L + Math.random() * 200, model: null,
          dot: dots.add({ pixelSize: 5, color: css(l.colour), outlineColor: C.Color.WHITE, outlineWidth: 1,
            disableDepthTestDistance: Infinity, distanceDisplayCondition: new C.DistanceDisplayCondition(9000, 2e5) }) };
        gltf(`assets/${TRAIN_MODEL[l.mode]}.glb`, { color: css(l.colour), colorBlendMode: C.ColorBlendMode.HIGHLIGHT,
          minimumPixelSize: 30, maximumScale: 25, distanceDisplayCondition: new C.DistanceDisplayCondition(0, 9000) })
          .then((m) => { t.model = trainLayer.add(m); });
        trains.push(t);
      }
    }
  }
  console.log('trains', trains.length);
}

const sP = new C.Cartesian3(), sF = new C.Cartesian3(), sU = new C.Cartesian3(), sL = new C.Cartesian3();
function placeTrains() {
  for (const t of trains) {
    const visible = linePrims.get(t.line)?.show !== false;
    t.dot.show = visible;
    if (t.model) t.model.show = visible;
    if (!visible) continue;
    const s = (((t.phase + t.v * simTime) % (2 * t.L)) + 2 * t.L) % (2 * t.L);
    const fwd = s < t.L, d = fwd ? s : 2 * t.L - s;
    let lo = 0, hi = t.cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t.cum[m] <= d) lo = m; else hi = m; }
    const seg = t.cum[hi] - t.cum[lo] || 1;
    C.Cartesian3.lerp(t.pos[lo], t.pos[hi], (d - t.cum[lo]) / seg, sP);
    C.Cartesian3.normalize(C.Cartesian3.subtract(t.pos[hi], t.pos[lo], sF), sF);
    if (!fwd) C.Cartesian3.negate(sF, sF);
    C.Ellipsoid.WGS84.geodeticSurfaceNormal(sP, sU);
    C.Cartesian3.normalize(C.Cartesian3.cross(sU, sF, sL), sL);
    C.Cartesian3.cross(sL, sU, sF);
    C.Cartesian3.add(sP, C.Cartesian3.multiplyByScalar(sL, 3, new C.Cartesian3()), sP); // UK trains keep left
    t.dot.position = sP;
    if (t.model) {
      const m = t.model.modelMatrix;
      m[0] = sF.x; m[1] = sF.y; m[2] = sF.z; m[3] = 0;
      m[4] = sL.x; m[5] = sL.y; m[6] = sL.z; m[7] = 0;
      m[8] = sU.x; m[9] = sU.y; m[10] = sU.z; m[11] = 0;
      m[12] = sP.x; m[13] = sP.y; m[14] = sP.z; m[15] = 1;
    }
  }
}
scene.preRender.addEventListener(() => {
  const now = performance.now();
  const dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0;
  lastFrame = now;
  if (!trainLayer?.show) return;
  simTime += dt * speedMult;
  placeTrains();
});

// ---------------- UI ----------------
const $ = (id) => document.getElementById(id);
const on = (id, fn) => $(id).addEventListener('change', (e) => fn(e.target.checked));

on('t-zones', (v) => (zoneLayer.show = v));
on('t-stations', (v) => (stationLayer.show = v));
on('t-trains', (v) => {
  if (v && !trainLayer) buildTrains();
  if (trainLayer) trainLayer.show = v;
  scene.requestRender();
});
document.querySelectorAll('input[name=speed]').forEach((r) => r.addEventListener('change', () => (speedMult = +r.value)));

let buildings = null;
on('t-buildings', async (v) => {
  if (v && !buildings) buildings = scene.primitives.add(await C.createOsmBuildingsAsync());
  if (buildings) buildings.show = v;
});
on('t-underground', (v) => {
  const g = scene.globe;
  g.translucency.enabled = v;
  g.translucency.frontFaceAlphaByDistance = new C.NearFarScalar(800, 0.25, 40000, 0.75);
  g.depthTestAgainstTerrain = v;
  scene.screenSpaceCameraController.enableCollisionDetection = !v;
});

$('collapse').addEventListener('click', () => {
  const c = $('panel').classList.toggle('collapsed');
  $('collapse').setAttribute('aria-expanded', String(!c));
  $('collapse').title = c ? 'Show layers' : 'Hide layers';
});

// key: one bar per line, grouped by mode
const key = $('key');
for (const [mode, label] of Object.entries(MODES)) {
  const group = lines.filter((l) => l.mode === mode && linePrims.has(l.id));
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
function setLine(id, bar, show) {
  linePrims.get(id).show = show;
  bar.setAttribute('aria-pressed', String(show));
}

// ---------------- station card + journey times ----------------
const net = buildNetwork(graph, stations, (id) => byId.get(id)?.mode);
const stationIndex = new Map(stations.map((st, i) => [st, i]));
const isoLayer = scene.primitives.add(new C.PrimitiveCollection());
const isoDots = isoLayer.add(new C.PointPrimitiveCollection());
const isoLabels = isoLayer.add(new C.LabelCollection({ scene }));
const isoOutlines = isoLayer.add(new C.PrimitiveCollection());
let isoImagery = null, isoField = null; // isoField: the shown grid + origin, for the hover tooltip
// Grid the reachable-area map is computed on: ~100 m cells over the whole network
const GRID = gridFor(stations);

// Shade every band on the ground (an image draped on the terrain) and outline it with smooth contours.
async function drawReachableArea(times, from) {
  const { field, W, H } = isochroneGrid(stations, times, GRID, BANDS.at(-1).max);
  isoField = { field, W, H, from };
  const canvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = canvas.getContext('2d'), img = ctx.createImageData(W, H);
  const rgb = BANDS.map((b) => [1, 3, 5].map((i) => parseInt(b.colour.slice(i, i + 2), 16)));
  for (let i = 0; i < field.length; i++) {
    const b = BANDS.findIndex((x) => field[i] <= x.max);
    if (b < 0) continue;
    img.data.set([...rgb[b], 255], i * 4);
  }
  ctx.putImageData(img, 0, 0);
  const provider = await C.SingleTileImageryProvider.fromUrl(canvas.toDataURL(), {
    rectangle: C.Rectangle.fromDegrees(GRID.w, GRID.s, GRID.e, GRID.n),
  });
  if (isoImagery) viewer.imageryLayers.remove(isoImagery);
  isoImagery = viewer.imageryLayers.addImageryProvider(provider);
  isoImagery.alpha = 0.72;

  // contour lines: d3 fills "value >= threshold", so contour the negated times
  const neg = Float64Array.from(field, (v) => (Number.isFinite(v) ? -v : -1e4));
  const toLL = ([x, y]) => [GRID.w + (x / W) * (GRID.e - GRID.w), GRID.n - (y / H) * (GRID.n - GRID.s)];
  isoOutlines.removeAll();
  const instances = [];
  for (const band of BANDS) {
    const [mp] = contours().size([W, H]).thresholds([-band.max])(neg);
    for (const poly of mp.coordinates) for (const ring of poly) {
      if (ring.length < 8) continue;
      instances.push(new C.GeometryInstance({
        geometry: new C.GroundPolylineGeometry({ positions: C.Cartesian3.fromDegreesArray(ring.flatMap(toLL)), width: 1.5 }),
        attributes: { color: C.ColorGeometryInstanceAttribute.fromColor(C.Color.WHITE.withAlpha(0.9)) },
      }));
    }
  }
  if (instances.length) isoOutlines.add(new C.GroundPolylinePrimitive({ geometryInstances: instances, appearance: new C.PolylineColorAppearance() }));
}
const fmt = (m) => (m < 60 ? `${Math.round(m)} min` : `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')}`);

function selectStation(st, fly = false) {
  $('card-name').textContent = st.name;
  $('card-zone').textContent = st.zones.length ? `Zone ${st.zones.join('/')}` : 'Outside the fare zones';
  $('card-lines').replaceChildren(...st.lines.map((id) => {
    const l = byId.get(id), li = document.createElement('li');
    li.textContent = l?.name || id;
    li.style.setProperty('--c', l?.colour || '#777');
    if (l && isLight(l.colour)) li.className = 'light';
    return li;
  }));
  $('card').hidden = false;
  if (fly) viewer.camera.flyTo({ destination: C.Cartesian3.fromDegrees(st.lon, st.lat - 0.16, 16000), orientation: { heading: 0, pitch: deg(-45), roll: 0 }, duration: 1.5 });

  // reachable area: rail (with changes between lines) then a walk from the station
  const origin = stationIndex.get(st), times = travelTimes(net, origin);
  isoDots.removeAll(); isoLabels.removeAll();
  stationLayer.show = zoneLayer.show = false; // markers and zone rings would clutter the shaded bands
  drawReachableArea(times, st.name);
  const groups = BANDS.map(() => []);
  stations.forEach((s, i) => {
    const t = times[i], b = BANDS.findIndex((x) => t <= x.max);
    if (b < 0) return;
    const pos = C.Cartesian3.fromDegrees(s.lon, s.lat, s.h + 6);
    if (i === origin) {
      isoDots.add({ id: s, position: pos, pixelSize: 16, color: C.Color.WHITE, outlineColor: css('#DA291C'), outlineWidth: 4, disableDepthTestDistance: Infinity });
      // the "from" station: a TfL-blue name tag above the dot, visible at every zoom
      isoLabels.add({ position: pos, text: s.name, font: '500 16px Jost, sans-serif', fillColor: C.Color.WHITE,
        showBackground: true, backgroundColor: css('#10069F'), backgroundPadding: new C.Cartesian2(9, 5),
        pixelOffset: new C.Cartesian2(0, -16), verticalOrigin: C.VerticalOrigin.BOTTOM, disableDepthTestDistance: Infinity });
      return;
    }
    groups[b].push([t, s]);
    isoDots.add({ id: s, position: pos, pixelSize: 6, color: C.Color.WHITE, outlineColor: css('#1D1D1B'), outlineWidth: 1.5,
      disableDepthTestDistance: Infinity, distanceDisplayCondition: new C.DistanceDisplayCondition(0, 9000) });
    isoLabels.add({ position: pos, text: `${s.name} ${fmt(t)}`, font: '500 12px Jost, sans-serif', fillColor: C.Color.WHITE,
      outlineColor: css('#1D1D1B'), outlineWidth: 3, style: C.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new C.Cartesian2(0, 14),
      disableDepthTestDistance: Infinity, distanceDisplayCondition: new C.DistanceDisplayCondition(0, 7000) });
  });
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
  scene.requestRender();
}
function clearSelection() {
  $('card').hidden = true;
  isoDots.removeAll(); isoLabels.removeAll(); isoOutlines.removeAll();
  if (isoImagery) viewer.imageryLayers.remove(isoImagery);
  isoImagery = isoField = null;
  $('tip').hidden = true;
  stationLayer.show = $('t-stations').checked;
  zoneLayer.show = $('t-zones').checked;
}

// journey time of the reachable-area grid cell under a screen point (hover, or tap on touch screens)
const tip = $('tip');
function showTip(p) {
  const hit = isoField && scene.globe.pick(viewer.camera.getPickRay(p), scene);
  const ll = hit && C.Cartographic.fromCartesian(hit);
  let t = Infinity;
  if (ll) {
    const { field, W, H } = isoField;
    const x = Math.floor(((C.Math.toDegrees(ll.longitude) - GRID.w) / (GRID.e - GRID.w)) * W);
    const y = Math.floor(((GRID.n - C.Math.toDegrees(ll.latitude)) / (GRID.n - GRID.s)) * H);
    if (x >= 0 && x < W && y >= 0 && y < H) t = field[y * W + x];
  }
  const band = BANDS.find((b) => t <= b.max);
  if (!band) { tip.hidden = true; return; }
  tip.innerHTML = `<i style="--c:${band.colour}"></i><b>${t < 1 ? 'Under 1 min' : fmt(t)}</b><span></span>`;
  tip.querySelector('span').textContent = `from ${isoField.from}`;
  tip.style.left = `${p.x}px`; tip.style.top = `${p.y}px`;
  tip.hidden = false;
}
const handler = new C.ScreenSpaceEventHandler(scene.canvas);
handler.setInputAction((e) => {
  const st = scene.pick(e.position)?.id;
  if (st?.lines) selectStation(st);
  else showTip(e.position);
}, C.ScreenSpaceEventType.LEFT_CLICK);
handler.setInputAction((e) => showTip(e.endPosition), C.ScreenSpaceEventType.MOUSE_MOVE);
$('card-close').onclick = clearSelection;
scene.canvas.addEventListener('mouseleave', () => { tip.hidden = true; });

// station search: native datalist over unique station names
const byName = new Map();
for (const st of stations) if (!byName.has(st.name)) byName.set(st.name, st);
$('station-list').append(...[...byName.keys()].sort().map((n) => Object.assign(document.createElement('option'), { value: n })));
$('station-search').addEventListener('change', (e) => {
  const st = byName.get(e.target.value.trim());
  if (st) { selectStation(st, true); e.target.blur(); }
});

$('loading').classList.add('done');
window.__map = { viewer, lines, trains }; // handy for debugging in the console
