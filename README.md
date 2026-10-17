# London Tube and Rail Map

Interactive map of London's rail network, built with MapLibre GL JS on an OpenFreeMap basemap. Tilt and rotate it, and switch on 3D buildings.

- Underground, Elizabeth line, the six Overground lines, DLR, Trams, IFS Cloud Cable Car and the National Rail services within London, in TfL's official colours
- Track geometry from OpenStreetMap; sections in tunnel are drawn at half strength
- Fare zones 1–9 (approximate boundaries, derived from TfL station zones)
- Simulated trains, and journey times with a shaded reachable area from any station

## Planned lines (phase 2)
HS2 (Euston – Old Oak Common – Birmingham Interchange – Curzon Street, with the link to the West Coast
Main Line) and the proposed West London Orbital (Hendon – Hounslow) are drawn like the built lines, with the same station markers; the key, the station card and the "Planned lines" switch mark them as planned. They are not in journey times or the train animation. Routes follow OpenStreetMap track
(HS2 is mapped as under construction); new station positions are approximate.
Toggle them with "Planned lines". Opening dates as of October 2026: HS2 2036–39 (Euston 2040–43), WLO
early-to-mid 2030s (not yet approved).

## Run locally

```sh
npm install        # bake-script dependencies only
npm run data       # rebuild data/*.json from TfL + OSM (cached in .cache/)
npm run check      # sanity-check the baked data
npm run serve      # http://localhost:8080
```

Data: © OpenStreetMap contributors (ODbL), Transport for London Unified API. Basemap: OpenFreeMap, © OpenMapTiles.
