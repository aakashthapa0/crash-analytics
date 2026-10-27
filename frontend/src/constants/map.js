// Configured geography frames county navigation; crash coordinates and filter choices come from the API.

// High-precision centroids for the 17 Lubbock District counties
export const countyCentroids = {
  BAILEY: [34.2158, -102.7452],
  CASTRO: [34.5313, -102.3054],
  COCHRAN: [33.6037, -102.7393],
  CROSBY: [33.6654, -101.3311],
  DAWSON: [32.7168, -101.9546],
  FLOYD: [34.0535, -101.3893],
  GAINES: [32.7515, -102.7087],
  GARZA: [33.1845, -101.3626],
  HALE: [34.1529, -101.753],
  HOCKLEY: [33.5864, -102.2909],
  LAMB: [34.0155, -102.3405],
  LUBBOCK: [33.559, -101.8885],
  LYNN: [33.178, -101.8118],
  PARMER: [34.5161, -102.7981],
  SWISHER: [34.5284, -101.7798],
  TERRY: [33.1769, -102.2924],
  YOAKUM: [33.0876, -102.8251],
};

// Complete geo-bounding box framing all 17 Lubbock District counties (Gaines to Parmer)
export const LUBBOCK_DISTRICT_BOUNDS = [
  [32.48, -103.12], // SW corner (Yoakum/Gaines NM border)
  [34.80, -101.00], // NE corner (Swisher/Floyd edge)
];
export const LUBBOCK_DISTRICT_CENTER = [33.64, -102.06];

export const mapSeverityColors = {
  K: '#c93b2b', // Fatal: dark red / crimson
  A: '#ea7a35', // Suspected Serious: warm amber / orange
  B: '#e5a83b', // Minor: golden peach / sand
  C: '#5c7d6e', // Possible: muted sage / slate
};
