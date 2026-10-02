const rate = 7900;
const loadedMiles = 2222;
const deadheadMiles = 328;
const fuelGallons = 327;
const fuelPrice = 3.6;
const fuel = fuelGallons * fuelPrice;
const tolls = 182.5;
const maintenance = 220;
const other = 96.3;
const costs = fuel + tolls + maintenance + other;
const profit = rate - costs;

// This is a visual fixture only. No broker, payment, GPS, or document data is written.
export const mockLoad = Object.freeze({
  number: '1169284',
  status: 'completed',
  pickupRef: '0093119929 / 226939',
  deliveryRef: 'JEA-49 / 800',
  pickup: { city: 'Seattle', state: 'WA', facility: 'Lineage Logistics', date: 'Sep 21, 2026 · 2:00 PM' },
  delivery: { city: 'Lebanon', state: 'IN', facility: 'US Cold', date: 'Sep 23, 2026' },
  equipment: '53′ Reefer', cargo: 'Seafood', temperature: '−10°F',
  weightLbs: 43000, pallets: 26, loadedMiles, deadheadMiles,
  rate, ratePerMile: rate / loadedMiles,
  fuelGallons, fuelPrice, fuel,
  tolls, maintenance, other, costs, profit,
  profitPerMile: profit / loadedMiles,
  margin: profit / rate * 100,
  drivingMinutes: Math.round(loadedMiles / 65 * 60),
  deadheadMinutes: 312,
  stopMinutes: 330,
  restMinutes: 547,
  otherExpenseItems: Object.freeze([
    { name: 'Tolls', amount: 182.5 },
    { name: 'Parking', amount: 45 },
    { name: 'Truck wash', amount: 28.3 },
    { name: 'Other', amount: 23 },
  ]),
  // Approximate waypoints for the visual demo route; no route or GPS claim.
  routePoints: Object.freeze([
    { latitude: 47.6062, longitude: -122.3321 },
    { latitude: 47.5, longitude: -117.4 },
    { latitude: 46.9, longitude: -112.0 },
    { latitude: 45.8, longitude: -107.5 },
    { latitude: 43.9, longitude: -101.1 },
    { latitude: 42.8, longitude: -96.8 },
    { latitude: 41.5, longitude: -92.0 },
    { latitude: 41.7, longitude: -87.7 },
    { latitude: 40.1, longitude: -86.5 },
  ]),
});

// A second visual fixture keeps both table status tabs populated.
export const mockActiveLoad = Object.freeze({
  ...mockLoad,
  number: '1169285',
  status: 'active',
  pickupRef: '0093119930 / 226940',
  deliveryRef: 'JEA-50 / 801',
  pickup: Object.freeze({ ...mockLoad.pickup, date: 'Oct 2, 2026 · 2:00 PM' }),
  delivery: Object.freeze({ ...mockLoad.delivery, date: 'Oct 4, 2026' }),
});
