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

// London terminals that get a Blender landmark model. heading = compass bearing the tracks leave on.
export const TERMINALS = [
  { id: 'paddington', name: 'Paddington', lon: -0.1757, lat: 51.5160, model: 'paddington', heading: 299 },
  { id: 'marylebone', name: 'Marylebone', lon: -0.1631, lat: 51.5225, model: 'marylebone', heading: 330 },
  { id: 'euston', name: 'Euston', lon: -0.1337, lat: 51.5281, model: 'euston', heading: 350 },
  { id: 'st-pancras', name: 'St Pancras International', lon: -0.1263, lat: 51.5313, model: 'st-pancras', heading: 352 },
  { id: 'kings-cross', name: "King's Cross", lon: -0.1232, lat: 51.5320, model: 'kings-cross', heading: 352 },
  { id: 'liverpool-street', name: 'Liverpool Street', lon: -0.0815, lat: 51.5181, model: 'liverpool-street', heading: 10 },
  { id: 'fenchurch-street', name: 'Fenchurch Street', lon: -0.0788, lat: 51.5116, model: 'fenchurch-street', heading: 95 },
  { id: 'cannon-street', name: 'Cannon Street', lon: -0.0905, lat: 51.5110, model: 'cannon-street', heading: 170 },
  { id: 'london-bridge', name: 'London Bridge', lon: -0.0861, lat: 51.5050, model: 'london-bridge', heading: 100 },
  { id: 'waterloo', name: 'Waterloo', lon: -0.1133, lat: 51.5031, model: 'waterloo', heading: 215 },
  { id: 'charing-cross', name: 'Charing Cross', lon: -0.1247, lat: 51.5081, model: 'charing-cross', heading: 165 },
  { id: 'victoria', name: 'Victoria', lon: -0.1440, lat: 51.4955, model: 'victoria', heading: 200 },
  { id: 'blackfriars', name: 'Blackfriars', lon: -0.1035, lat: 51.5093, model: 'blackfriars', heading: 172 },
];
