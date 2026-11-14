// "How real is this?" The same comparisons the test suite makes, run live in
// the player's browser so anyone can see the model against published values.
import { AU_KM, MU_EARTH, dateFromJd, earthDistanceKm, earthState, jdFromDate, lambert, norm, transferTo } from './astro';
import { APOPHIS, ARRAY, RAMSES_SRC, ROCKETS, Src, rocketCapacityKg } from './data';
import { dataRateKbps } from './design';

export interface Check {
  what: string;
  ours: string;
  published: string;
  src: Src;
  ok: boolean;
  note?: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function runChecks(): Check[] {
  const out: Check[] = [];

  // 1. Lambert solver against a textbook case
  const sol = lambert([15945.34, 0, 0], [12214.83899, 10249.46731, 0], 76 * 60, MU_EARTH);
  out.push({
    what: 'Trajectory solver (Lambert\'s problem)',
    ours: sol ? `departure velocity ${sol.v1[0].toFixed(4)}, ${sol.v1[1].toFixed(4)} km/s` : 'no solution',
    published: '2.0589, 2.9160 km/s',
    src: { label: 'Vallado, Fundamentals of Astrodynamics and Applications, example 7-5', kind: 'public' },
    ok: !!sol && Math.abs(sol.v1[0] - 2.058913) < 2e-4 && Math.abs(sol.v1[1] - 2.915965) < 2e-4,
  });

  // 2. Earth's orbit
  let min = 9, minJd = 0;
  for (let jd = jdFromDate(2028, 1, 1); jd < jdFromDate(2029, 1, 1); jd++) {
    const d = norm(earthState(jd).r) / AU_KM;
    if (d < min) { min = d; minJd = jd; }
  }
  const pd = dateFromJd(minJd);
  out.push({
    what: 'Earth\'s closest point to the Sun in 2028',
    ours: `${min.toFixed(4)} au on ${pd.d} ${MONTHS[pd.m - 1]}`,
    published: '0.9833 au in the first week of January',
    src: { label: 'JPL, Approximate Positions of the Planets (elements used), against the standard almanac value', url: 'https://ssd.jpl.nasa.gov/planets/approx_pos.html', kind: 'nasa' },
    ok: Math.abs(min - 0.9833) < 0.0008 && pd.m === 1 && pd.d <= 8,
  });

  // 3. The Apophis flyby, from elements propagated four years
  let best = Infinity, bestJd = 0;
  for (let jd = jdFromDate(2029, 4, 1); jd < jdFromDate(2029, 5, 1); jd += 0.01) {
    const d = earthDistanceKm(APOPHIS.elements, jd);
    if (d < best) { best = d; bestJd = jd; }
  }
  const hoursOff = (bestJd - APOPHIS.flybyJd) * 24;
  out.push({
    what: 'When Apophis passes Earth',
    ours: `${Math.abs(hoursOff).toFixed(1)} hours ${hoursOff >= 0 ? 'after' : 'before'} NASA's time`,
    published: '13 April 2029, 21:46 UT',
    src: APOPHIS.flybySrc,
    ok: Math.abs(hoursOff) < 6,
    note: `Rounded orbit numbers, moved forward four years with only the Sun's gravity. The model's miss distance (${Math.round(best / 1000).toLocaleString('en-US')},000 km from Earth's centre) is too large, so the game shows NASA's date and distance instead.`,
  });

  // 4. ESA's Ramses trajectory
  let v = Infinity, c3 = 0;
  for (let l = jdFromDate(2028, 4, 24); l <= jdFromDate(2028, 5, 11); l += 1) {
    for (let a = jdFromDate(2029, 2, 1); a <= jdFromDate(2029, 2, 28); a += 1) {
      const t = transferTo(APOPHIS.elements, l, a);
      if (t && t.vinfArr < v) { v = t.vinfArr; c3 = t.c3; }
    }
  }
  out.push({
    what: 'Braking needed on the route ESA chose for Ramses',
    ours: `${v.toFixed(2)} km/s (launch energy ${c3.toFixed(1)} km²/s²)`,
    published: 'under 1.6 km/s, launching 24 April to 11 May 2028',
    src: RAMSES_SRC,
    ok: v < 1.6,
    note: 'The game was given only the two orbits. It found this window by itself.',
  });

  // 5. Rocket model
  const leoC3 = -398600.4418 / (6378.137 + 200);
  const f9 = rocketCapacityKg(ROCKETS.find((r) => r.id === 'f9')!, leoC3);
  const fh = rocketCapacityKg(ROCKETS.find((r) => r.id === 'fh')!, leoC3);
  out.push({
    what: 'Rocket model, extended to low Earth orbit',
    ours: `Falcon 9 ${Math.round(f9 / 100) / 10} t, Falcon Heavy ${Math.round(fh / 100) / 10} t`,
    published: '22.8 t and 63.8 t',
    src: ROCKETS.find((r) => r.id === 'f9')!.src,
    ok: Math.abs(f9 - 22800) / 22800 < 0.15 && Math.abs(fh - 63800) / 63800 < 0.15,
    note: 'The model is fitted to the published payloads to transfer orbit and to Mars. Low Earth orbit was not used in the fit.',
  });

  // 6. Solar power
  const w = (au: number) => (8.5 * ARRAY.wPerM2At1Au * 0.92) / (au * au);
  out.push({
    what: 'Solar panels the size of OSIRIS-REx\'s (8.5 m²)',
    ours: `${Math.round(w(1.36)).toLocaleString('en-US')} W far from the Sun, ${Math.round(w(0.9)).toLocaleString('en-US')} W near it`,
    published: '1,226 W to 3,000 W',
    src: ARRAY.src,
    ok: Math.abs(w(1.36) - 1226) / 1226 < 0.15 && Math.abs(w(0.9) - 3000) / 3000 < 0.15,
  });

  // 7. Radio link
  const far = dataRateKbps(100, 45.9, 2.6 * AU_KM, 6), near = dataRateKbps(100, 45.9, 0.6 * AU_KM, 6);
  out.push({
    what: 'Radio link for a Mars orbiter (100 W, 3 m dish)',
    ours: `${(far / 1000).toFixed(1)} Mbps with Mars far away, ${(near / 1000).toFixed(1)} Mbps close`,
    published: 'about 0.5 to 4 Mbps for Mars Reconnaissance Orbiter',
    src: { label: 'NASA descriptions of Mars Reconnaissance Orbiter telecommunications', kind: 'nasa' },
    ok: far > 300 && far < 3000 && near >= 4000,
    note: 'The game caps the rate at what the transmitter can handle.',
  });
  return out;
}
