# Switch the map engine from Cesium to MapLibre; draw planned lines like built ones

Date: 2026-10-17. Status: design approved in chat, pending spec review.

## Goal

Replace CesiumJS with MapLibre GL JS on a light OSM vector basemap. Why:
- a cleaner map style;
- a lighter page that runs better on phones;
- no Cesium ion account or token.

The map can still tilt, rotate and show 3D buildings. 3D models are dropped.

In the same change, planned lines (HS2, West London Orbital) are drawn exactly like built lines,
using the same line style and station markers. Their planned status shows only in the key (the
"Planned" group), on the station card (badge, opening text, "(planned)" chips), and through the
"Planned lines" switch.

Out of scope:
- changes to the data bake, journey times or the card's content;
- National Rail across GB;
- 3D terrain.

## Engine and basemap

- MapLibre GL JS `maplibre-gl@5.6.0` from jsdelivr (JS and CSS), loaded in place of Cesium.
- Basemap: the OpenFreeMap Positron style, `https://tiles.openfreemap.org/styles/positron`. It
  needs no key. Its attribution (OpenFreeMap, OpenMapTiles, OpenStreetMap contributors) stays
  visible.
- Start view: centre `[-0.118, 51.48]`, zoom about 10.3, pitch 45, bearing 0. Tilt and rotate stay
  on. Double-click zoom stays at MapLibre's default.
- Clicking a station uses `flyTo` to the station: zoom about 13, pitch 45.

## How each feature carries over

All map content goes into GeoJSON sources plus style layers, built once from the JSON already in
`data/`. Coordinates are `[lon, lat]`; the baked heights (every third number in the line
coordinate arrays) are ignored.

### Lines
- Each line becomes one `line` layer. Its colour comes from feature properties.
- Width depends on the mode, using today's `WIDTH` table as the value at zoom 12, interpolated
  with zoom.
- Tunnel segments (`s.t`) are drawn at 50% opacity, as now.
- Planned lines use the same layer style. Their `mode: 'planned'` is used only to group them in
  the key, with one width of 4 for both.
- Key bars toggle the visibility of each line, filtering the layer by line id.

### Stations
These follow today's rules:
- **Interchanges (more than one line):** a `circle` layer with white fill and a black 2 px outline.
- **Other stations:** a tick, a short bar in the line colour placed across the track at the
  nearest point of the line.
  - The code that finds that point and the track's direction is reused.
  - The tick is a `symbol` layer using one white bar icon added with `map.addImage` (SDF, so it
    can be tinted), with `icon-color` set from the line colour.
  - It uses `icon-rotate` from the computed bearing and `icon-rotation-alignment: map`.
- **Labels:** a `symbol` layer, Jost if available, otherwise the basemap's fonts.
  - Dark text with a white halo, which reads best on Positron.
  - Interchange labels appear from zoom 12 and other labels from zoom 13.5.

Planned stations follow the same rules:
- **Planned-only stations** get a tick or an interchange circle on the same rule.
- **Existing stations that gain a planned line** (`existing` set) get an interchange circle in the
  planned layers, so for example Neasden reads as an interchange while planned lines show.
- Hollow rings and italic labels are removed.

### Planned switch
It sets the visibility of every planned layer: lines, ticks, circles and labels.

### Fare zones
Shaded zone areas with outlines, in today's colours. They are hidden or shown by the "Fare zones"
switch.

### Trains
- Kept as dots only: one GeoJSON point source holding all trains, with a `circle` layer of radius
  3 in the line colour and a white outline.
- The source is updated with `setData` on `requestAnimationFrame` while the trains switch is on.
- The motion maths moves from Cartesian to lon/lat, using linear interpolation along the route and
  cumulative distances in metres.
- The keep-left offset is dropped.
- Dots for lines that are hidden in the key are left out.

### Reachable area
- The same canvas as now is shown as an `image` source over `GRID`'s corners, with raster opacity
  0.72.
- Contours come from `d3-contour` as now and go into a GeoJSON `line` source as white 1.5 px lines.
- The origin label and the band dots go into one GeoJSON source with `circle` and `symbol` layers,
  styled as now: a blue origin label on a background, 16 px.
- These layers sit below the station layers.

### Hover and tap tooltip
On `mousemove`, and on a click that misses a station, `e.lngLat` is turned into a grid cell, using
the same lookup as now without picking against the globe.

### Clicks
- `map.on('click')` runs `queryRenderedFeatures` over the station layers, and the feature's
  `id` property finds the station object.
- A planned station with `existing` set opens the existing station, as now.

### 3D buildings
- The switch adds or shows a `fill-extrusion` layer on the basemap's `openmaptiles` source,
  source-layer `building`, with `render_height` and `render_min_height`, in a neutral light grey.
- It is off by default, as now.

## Removed

- Cesium (script, CSS, viewer), the ion token, `config.js`, and its gitignore entry.
- The deploy step "Write config.js from secret". The cache-bust sed no longer mentions `config`.
- The "See underground" switch and its code.
- 3D models:
  - `assets/` is deleted entirely: the station, train, gondola and Old Oak Common glbs and the
    `.blend` source. Git history keeps them.
  - The workflow no longer copies `assets`.
  - `build-planned.mjs` no longer writes `models`, `planned.json` is re-baked without them, and
    the glb check in `check-data.mjs` is removed.
- The dashed planned styles in `style.css` (`.bar.planned`, `#card li.planned`). The "Planned"
  badge on the card stays.
- The `frame`/`gltf` helpers and the Old Oak Common building-hide style.

## Unchanged

- The data files and bake scripts, apart from `models` above.
- `journey.js` and `lines.js`.
- The panel, search, card, key grouping and tooltip markup.
- The page title "London Rail 3D" stays, since the map still tilts and shows 3D buildings.

## Docs and housekeeping

- README: the opening paragraph names MapLibre and OpenFreeMap; the Cesium token paragraph is
  removed.
- Memory: "Blender required" no longer applies.
- After deploy, the user deletes the `CESIUM_ION_TOKEN` repo secret and revokes the ion token.
  Claude does not touch secrets.

## Checks

- `check-data.mjs` and `check-journey.mjs` pass, minus the glb check.
- New in `check-data.mjs`:
  - `app.js` and `index.html` contain no `Cesium`;
  - `planned.json` has no `models` key.
- Browser check (Playwright, local then live):
  - no console errors;
  - lines, ticks and interchange circles render;
  - HS2 and WLO look identical in style to built lines, and the planned switch hides them;
  - clicking a station opens the card, journey-time shading and tooltip;
  - Old Oak Common's planned card still shows the badge and has no times;
  - the trains switch moves dots;
  - the 3D buildings switch extrudes buildings;
  - at phone width (390 px) the panel and card work.

## Risks

- **Train dot performance.** `setData` every frame with several hundred points could stutter on
  phones. If it does, updates are throttled to 30 fps. No other workaround is planned.
- **Tick icon at all zooms.** A fixed-pixel tick can look oversized at low zoom. Ticks are hidden
  below zoom 11, where today's fallback dots took over, and a small white circle with a line-colour
  outline shows instead at zooms 9–11.
- **OpenFreeMap availability.** It is a free, donation-run service. If it fails, the page shows
  "Couldn't load the base map" in the existing `#loading` error style. There is no fallback
  provider.
