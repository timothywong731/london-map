# Phase 2 — Planned lines: HS2 and West London Orbital

Date: 2026-10-16. Status: approved in chat, pending spec review.

## Goal

Show two railways that are planned but not yet built — HS2 (London–Birmingham) and the
West London Orbital (WLO) — on the 3D map. Make it unmistakable that they do not run today, and
let the viewer hide them with a toggle. Add a Blender-made 3D model of the HS2 Old Oak Common station.

Out of scope (descoped by the user): GB-wide National Rail. Also out: preview trains on planned
lines, a "fly to HS2" control, and HS2 Phase 2 (cancelled 2023).

## Facts used (as of October 2026)

- **HS2:** Euston – Old Oak Common – Birmingham Interchange – Birmingham Curzon Street, plus the
  Delta Junction link to the West Coast Main Line.
  - First services between Old Oak Common and Curzon Street are targeted for 2036–39.
  - Euston services are targeted for 2040–43.
  - Card text: "Planned — opening 2036–39 (Euston 2040–43)".
- **WLO:** Hendon – Hounslow, mostly on existing track: the Dudding Hill freight line, the North
  London line and the Hounslow loop. Funding for design work was agreed in March 2026, and a
  decision on seeking powers is due in 2027.
  - Card text: "Proposed — opening early-to-mid 2030s".
  - New stations: Neasden, Harlesden, Old Oak Common Lane and Lionel Road.
  - Calling pattern used: Hendon, Brent Cross West, Neasden, Harlesden, Old Oak Common Lane,
    Acton Central, South Acton, Lionel Road, Brentford, Syon Lane, Isleworth, Hounslow.
  - The calling pattern is checked against TfL's 2026 material during implementation, and the
    spec is updated if it differs.

## Data (scripts/build-data.mjs)

### Line definitions (lines.js)

`PLANNED` is a new export with the same fields as `LINES`, plus:
- `status: 'planned'`
- `opens`: the card text above
- `stops`: ordered station names, each with lon/lat for stations that don't exist yet

Colours:
- HS2 uses the HS2 Ltd brand colour, confirmed from hs2.org.uk during implementation.
- WLO uses Overground orange `#EF7B10`.

### HS2 geometry

- Taken from Overpass: ways tagged `railway=construction` + `construction=rail` (or
  `construction:railway=rail`) named HS2 / High Speed 2, inside a corridor box from London to
  Birmingham.
- The ways are chained into one route by shortest path through the ordered stops, over a graph
  built from those ways.
- The Delta Junction link is drawn as its own polyline.
- Vertical profile follows the existing rules (OSM `tunnel`, `bridge`, `embankment` and `layer`
  tags, with 250 m portal ramps). HS2 tunnels use the "deep" class, at −25 m.
- Heights: the DEM sampling is extended to the Terrarium z12 tiles that HS2 touches, about 60
  tiles. The geoid offset stays +46 m; the error is about 2 m at Birmingham, which is acceptable.

### WLO geometry

- The route is the shortest path over an OSM `railway=rail` graph inside the existing BBOX,
  passing through the WLO stops in order.
- New stations use hand-placed coordinates from TfL material.

### Output

- `data/lines.json` gains the two planned lines.
- `data/stations.json` gains:
  - planned-only stations, with `planned: true`;
  - a `plannedLines` list on existing stations that a planned line serves (for example Euston,
    Hendon and Hounslow).
- `data/graph.json` does **not** include planned lines, so journey times stay "today's network".

## App (app.js, index.html, style.css)

- **Lines:** planned lines are rendered with `PolylineMaterialAppearance` and the `PolylineDash`
  material in the line colour. They are separate primitives, so the toggle simply hides them.
- **Planned stations:** hollow rings, drawn as point primitives with a transparent fill and a
  line-coloured outline. Existing stations keep their current marker.
- **Panel:**
  - a "Planned lines" switch, on by default;
  - a "Planned" group in the line key, with HS2 and WLO bars that behave like the existing bars;
  - the switch toggles the dashed lines, the planned stations and the Old Oak Common model together.
- **Station card:**
  - Planned station: shows a "Planned" badge and the `opens` text, and no journey-time section.
  - Existing station with a planned line: shows that line in the lines list, with a "(planned)"
    suffix and a dashed chip style.
- **Excluded:** no animated trains run on planned lines. Searching for a planned station works,
  but selecting it only shows the card, with no reachable area.

## Old Oak Common model (Blender MCP)

- Modelled in `assets/source/london-map-assets.blend` and exported to `assets/old_oak_common.glb`,
  with +X forward and Y up as before.
- To-scale massing based on the published design:
  - a long station hall with a ribbed, wave-profile roof;
  - glazed entrances;
  - surface platforms for the Elizabeth line and GWR;
  - the open HS2 platform box at low level.
- Plain materials. Kept small enough to load quickly; the target is under 1 MB.
- Placed at the real site and heading on the terrain. It shows only while the planned-lines switch
  is on.
- If OSM 3D buildings overlap the footprint, those features are hidden with a tileset style
  condition on their IDs or footprint.

## Checks (scripts/check-data.mjs)

- HS2 length from Euston to Curzon Street is 200–240 km.
- HS2 has a continuous tunnel section of 14–18 km (the Chilterns).
- The WLO polyline passes within 150 m of every stop, in order.
- No planned line id appears in `graph.json`.
- `assets/old_oak_common.glb` exists and is under 1.5 MB.
- The existing journey checks still pass unchanged.

## Risks

- **HS2 gaps in OSM.** If OSM is incomplete along HS2, the path finder fails. The bake then
  reports the gap; the fix is a manual waypoint, not a straight-line fill.
- **WLO through freight yards.** Shortest-path routing may cut through freight yard tracks.
  Waypoints at the stops keep it on the main line, and the check catches deviations.
