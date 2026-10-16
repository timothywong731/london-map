# London 3D Rail Map — Design

## Intent
A public, Google-Earth-style 3D map of London's rail network on GitHub Pages
(`timothywong731/london-map`). Showcase quality: real terrain + satellite, every TfL
mode and the National Rail services shown on TfL's *London rail and tube services* map,
official colours, fare zones, optional animated trains. Phase 2 adds HS2 and the West
London Orbital as "planned" lines with no structural change.

## Decisions (agreed)
| Topic | Decision |
|---|---|
| Engine | CesiumJS (CDN) + Cesium ion: World Terrain, Bing satellite, optional OSM Buildings |
| Token | `ION_TOKEN` constant in `config.js`; user supplies a URL-restricted token. Cesium default token used until then |
| Build | No bundler. Static `index.html` + ES modules. Node bake script produces data. Deployed by GitHub Actions Pages workflow |
| Data | Baked once by `scripts/build-data.mjs`, committed: TfL Unified API (lines, stations, zones) + OSM Overpass (track geometry, tunnel/bridge tags) |
| Animation | Simulated: trains move along real route geometry at per-mode average speed and headway. Toggle + speed multiplier |
| Blender | glTF assets: train per mode, station marker, interchange marker, stylised landmarks for the big London terminals |

## Data
- **Lines** (`data/lines.json`): TfL lines — 11 Tube, DLR, Elizabeth, 6 Overground
  (Liberty, Lioness, Mildmay, Suffragette, Weaver, Windrush), Trams, IFS Cloud Cable Car —
  plus National Rail operators clipped to a Greater-London box. One record per line with
  `{id, name, mode, colour, segments[]}`; each segment is a polyline of `[lon, lat, h]`.
  OSM route relations are matched to TfL line ids by name/network; NR grouped by operator.
- **Vertical profile**: no open dataset gives per-segment depth in metres. OSM tags tell
  us truthfully whether each segment is in tunnel, on bridge/viaduct, or at surface
  (e.g. the Metropolitan line is mostly surface beyond Finchley Road). Depth is
  *indicative*: tunnel depth by line class × `|layer|` (sub-surface −10 m, deep tube −25 m,
  Elizabeth −30 m, other −10 m), bridge/viaduct +8 m, surface +2 m above terrain. Portal
  ramps interpolate over ~150 m. Terrain height baked from AWS Terrarium DEM (z13) +
  constant London geoid offset (EGM96 ≈ 46 m) to match Cesium's ellipsoidal heights.
  UI labels this "indicative depth".
- **Stations** (`data/stations.json`): name, zone(s), lines, interchange flag, terminal flag.
- **Zones** (`data/zones.json`): zones 1–9 derived from station zones: Voronoi cells of
  stations (zone = lowest of split zones "2/3"), dissolved per zone into rings, then
  buffered outward by a margin (~400 m), smoothed (Chaikin) and simplified, so boundaries
  read as soft concentric bands rather than jagged cells. Approximate by nature —
  labelled as such.

## Colours
Official TfL palette per line (Bakerloo `#B36305`, Central `#E32017`, Circle `#FFD300`,
District `#00782A`, H&C `#F3A9BB`, Jubilee `#A0A5A9`, Metropolitan `#9B0056`, Northern
`#000000` with white casing, Piccadilly `#003688`, Victoria `#0098D4`, W&C `#95CDBA`,
DLR `#00A4A7`, Elizabeth `#6950A1`, Tram `#84B817`, Cable Car `#E21836`, Overground
lines per 2024 identity). National Rail drawn in muted operator colours, thinner.

## Rendering
- Lines: Cesium `PolylineCollection`, width by mode; tunnel segments drawn semi-
  transparent. `depthTestAgainstTerrain` off by default so tunnels stay visible;
  "Underground view" toggle makes the globe translucent and lets the camera go below.
- Stations: Blender marker glTF near (≤ 6 km), point + label further out.
- Terminals: Blender landmark glTF placed at station with hand-set heading.
- Zones: ground-clamped translucent bands with zone number labels.
- Trains: one `Model` per train, position/orientation updated per frame from distance
  along the route.

## UI
Left panel: layer toggles grouped by mode with colour swatches (each line toggleable),
zones, stations, terminals, 3D buildings, animated trains (+ speed), underground view.
Click a station → card with zone and lines. Fly-to home view.

## Phase 2 hook
Planned lines carry `status: "planned"` → dashed material, "Planned" legend group.

## Testing
`scripts/check-data.mjs`: asserts every TfL line present with geometry, colours valid,
stations have zones, zones 1–6 rings exist. Visual verification in browser (Playwright
screenshots) locally and on the deployed URL.
