// Shared by the bake script and the browser app.
// Colours: TfL colour standard (Pantone-derived hexes). `osm` matches OSM route relation
// name/network/operator/brand; `depth` picks the indicative tunnel depth class.

export const MODES = {
  tube: 'Underground',
  'elizabeth-line': 'Elizabeth line',
  overground: 'Overground',
  dlr: 'DLR',
  tram: 'Trams',
  'cable-car': 'Cable car',
  'national-rail': 'National Rail',
  planned: 'Planned (not yet built)',
};

const tube = (id, name, colour, depth, re) => ({ id, name, mode: 'tube', colour, depth, osm: re, route: /^subway$/ });
const og = (id, name, colour) => ({ id, name, mode: 'overground', colour, depth: 'other', osm: new RegExp(`\\b${name}\\b`, 'i'), route: /^train$/ });

export const LINES = [
  tube('bakerloo', 'Bakerloo', '#A45A2A', 'deep', /Bakerloo/i),
  tube('central', 'Central', '#DA291C', 'deep', /\bCentral\b/i),
  tube('circle', 'Circle', '#FFCD00', 'subsurface', /\bCircle\b/i),
  tube('district', 'District', '#007A33', 'subsurface', /\bDistrict\b/i),
  tube('hammersmith-city', 'Hammersmith & City', '#E89CAE', 'subsurface', /Hammersmith (&|and) City/i),
  tube('jubilee', 'Jubilee', '#7C878E', 'deep', /Jubilee/i),
  tube('metropolitan', 'Metropolitan', '#840B55', 'subsurface', /Metropolitan/i),
  tube('northern', 'Northern', '#000000', 'deep', /\bNorthern\b/i),
  tube('piccadilly', 'Piccadilly', '#10069F', 'deep', /Piccadilly/i),
  tube('victoria', 'Victoria', '#00A3E0', 'deep', /\bVictoria line|^Victoria\b|Victoria: /i),
  tube('waterloo-city', 'Waterloo & City', '#6ECEB2', 'deep', /Waterloo (&|and) City/i),
  { id: 'elizabeth', name: 'Elizabeth line', mode: 'elizabeth-line', colour: '#6950A1', depth: 'elizabeth', osm: /Elizabeth line/i, route: /^train$/ },
  og('liberty', 'Liberty', '#606667'),
  og('lioness', 'Lioness', '#EF9600'),
  og('mildmay', 'Mildmay', '#2774AE'),
  og('suffragette', 'Suffragette', '#5BA763'),
  og('weaver', 'Weaver', '#893B67'),
  og('windrush', 'Windrush', '#D22730'),
  { id: 'dlr', name: 'DLR', mode: 'dlr', colour: '#00AFAD', depth: 'other', osm: /Docklands Light Railway|\bDLR\b/i, route: /^light_rail$/ },
  { id: 'tram', name: 'Trams', mode: 'tram', colour: '#5FB526', depth: 'other', osm: /London Trams|Tramlink/i, route: /^tram$/ },
  { id: 'london-cable-car', name: 'IFS Cloud Cable Car', mode: 'cable-car', colour: '#C8102E', depth: 'other' },
];

// National Rail, in the order they are tested (GTR brands before "Thameslink").
const nr = (id, name, colour, re) => ({ id, name, mode: 'national-rail', colour, osm: re });
export const OPERATORS = [
  nr('heathrow-express', 'Heathrow Express', '#532E63', /Heathrow Express/i),
  nr('gatwick-express', 'Gatwick Express', '#EB1E2D', /Gatwick Express/i),
  nr('great-northern', 'Great Northern', '#0099CC', /Great Northern/i),
  nr('southern', 'Southern', '#8CC63E', /\bSouthern\b/i),
  nr('thameslink', 'Thameslink', '#E9438D', /Thameslink/i),
  nr('southeastern', 'Southeastern', '#1E90FF', /South ?eastern/i),
  nr('south-western-railway', 'South Western Railway', '#24398C', /South Western Railway/i),
  nr('great-western-railway', 'Great Western Railway', '#0A493E', /Great Western/i),
  nr('c2c', 'c2c', '#B7007C', /\bc2c\b/i),
  nr('greater-anglia', 'Greater Anglia', '#D70428', /Greater Anglia/i),
  nr('chiltern-railways', 'Chiltern Railways', '#00BFFF', /Chiltern/i),
  nr('avanti-west-coast', 'Avanti West Coast', '#004354', /Avanti/i),
  nr('london-north-eastern-railway', 'LNER', '#CE0E2D', /LNER|London North Eastern/i),
  nr('east-midlands-railway', 'East Midlands Railway', '#713563', /East Midlands/i),
  nr('west-midlands-trains', 'London Northwestern', '#FF8300', /West Midlands|London Northwestern/i),
  nr('lumo', 'Lumo', '#2B6EF5', /Lumo/i),
  nr('grand-central', 'Grand Central', '#1D1D1B', /Grand Central/i),
];

// Planned railways (phase 2) — drawn dashed, never in journey times or train animation.
// Stops without lon/lat are existing stations (looked up by name in data/stations.json);
// coordinates of new stations are from OSM construction sites / TfL WLO material (approximate).
export const PLANNED = [
  {
    id: 'hs2', name: 'HS2', mode: 'planned', colour: '#005F83', width: 5, // ponytail: HS2 brand colour unconfirmed (design system offline) — change here
    opens: 'Planned — opening 2036–39 (Euston 2040–43)',
    osm: { select: 'way["railway"="construction"]', bbox: { s: 51.48, w: -1.95, n: 52.76, e: -0.12 } },
    stops: [
      { name: 'Euston', hs2Lon: -0.1355, hs2Lat: 51.5300 },
      { name: 'Old Oak Common', lon: -0.24798, lat: 51.52493, also: ['elizabeth', 'great-western-railway'] },
      { name: 'Birmingham Interchange', lon: -1.70067, lat: 52.45209 },
      { name: 'Birmingham Curzon Street', lon: -1.88964, lat: 52.48046 },
    ],
    // Delta Junction (Water Orton) north to the West Coast Main Line at Handsacre
    branches: [[
      { name: 'Delta Junction', lon: -1.7345, lat: 52.5155, waypoint: true },
      { name: 'Handsacre Junction', lon: -1.8205, lat: 52.7302, waypoint: true },
    ]],
  },
  {
    id: 'west-london-orbital', name: 'West London Orbital', mode: 'planned', colour: '#EF7B10', width: 3.5,
    opens: 'Proposed — opening early-to-mid 2030s',
    osm: { select: 'way["railway"="rail"][!"service"]', bbox: { s: 51.44, w: -0.39, n: 51.60, e: -0.20 } },
    stops: [
      { name: 'Hendon' },
      { name: 'Brent Cross West' },
      { name: 'Neasden', lon: -0.24738, lat: 51.55320 },   // new, on the Dudding Hill line
      { name: 'Harlesden', lon: -0.25652, lat: 51.54139 }, // new, on the Dudding Hill line
      { name: 'Old Oak Common Lane', lon: -0.25387, lat: 51.52518 },
      { name: 'Acton Central' },
      { name: 'South Acton' },
      { name: 'Lionel Road', lon: -0.29135, lat: 51.49061 },
      { name: 'Brentford' },
      { name: 'Syon Lane' },
      { name: 'Isleworth' },
      { name: 'Hounslow' },
    ],
    branches: [],
  },
];
