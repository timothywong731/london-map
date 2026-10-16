# London Rail 3D

Interactive 3D map of London's rail network on real terrain and satellite imagery, built with CesiumJS.

- Underground, Elizabeth line, the six Overground lines, DLR, Trams, IFS Cloud Cable Car and the National Rail services within London, in TfL's official colours
- Track geometry from OpenStreetMap, including which sections run in tunnel, at grade or on bridges. Tunnel depths are indicative.
- Fare zones 1–9 (approximate boundaries, derived from TfL station zones)
- Simulated trains, plus stylised landmark models of the London terminals made in Blender (`assets/source/london-map-assets.blend`)

## Planned lines (phase 2)
HS2 (Euston – Old Oak Common – Birmingham Interchange – Curzon Street, with the link to the West Coast
Main Line) and the proposed West London Orbital (Hendon – Hounslow) are drawn dashed, with hollow-ring
stations. They are not in journey times or the train animation. Routes follow OpenStreetMap track
(HS2 is mapped as under construction); new station positions and tunnel depths are approximate.
Toggle them with "Planned lines". Opening dates as of October 2026: HS2 2036–39 (Euston 2040–43), WLO
early-to-mid 2030s (not yet approved).

## Run locally

```sh
npm install        # bake-script dependencies only
npm run data       # rebuild data/*.json from TfL + OSM (cached in .cache/)
npm run check      # sanity-check the baked data
npm run serve      # http://localhost:8080
```

Set your Cesium ion token in `config.js` (restrict it to your Pages URL). Until you do, Cesium's demo token is used.

Data: © OpenStreetMap contributors (ODbL), Transport for London Unified API, AWS Terrain Tiles.
