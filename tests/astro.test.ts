import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lambert, jdFromDate, dateFromJd, earthState, norm, AU_KM, MU_EARTH, MU_MOON, R_MOON,
  stateFromElements, elementsFromState, earthDistanceKm, transferTo, captureDv, maxEclipseFraction,
  orbitPeriodS, lunarTransferC3,
} from '../src/sim/astro';
import { APOPHIS } from '../src/sim/data';

test('calendar: J2000 and round trip', () => {
  assert.equal(jdFromDate(2000, 1, 1), 2451544.5);
  assert.equal(jdFromDate(2029, 4, 13), 2462239.5);
  assert.deepEqual(dateFromJd(jdFromDate(2028, 2, 29)), { y: 2028, m: 2, d: 29 });
});

test('Lambert solver reproduces the textbook case (Vallado, example 7-5)', () => {
  const sol = lambert([15945.34, 0, 0], [12214.83899, 10249.46731, 0], 76 * 60, MU_EARTH)!;
  assert.ok(Math.abs(sol.v1[0] - 2.058913) < 2e-4, `v1x ${sol.v1[0]}`);
  assert.ok(Math.abs(sol.v1[1] - 2.915965) < 2e-4, `v1y ${sol.v1[1]}`);
  assert.ok(Math.abs(sol.v2[0] - -3.451565) < 2e-4, `v2x ${sol.v2[0]}`);
  assert.ok(Math.abs(sol.v2[1] - 0.910315) < 2e-4, `v2y ${sol.v2[1]}`);
});

test('Earth stays between 0.983 and 1.017 au and is near perihelion in early January', () => {
  let min = 9, minJd = 0, max = 0;
  for (let jd = jdFromDate(2028, 1, 1); jd < jdFromDate(2029, 1, 1); jd++) {
    const d = norm(earthState(jd).r) / AU_KM;
    if (d < min) { min = d; minJd = jd; }
    max = Math.max(max, d);
  }
  assert.ok(min > 0.9825 && min < 0.9840, `perihelion ${min}`);
  assert.ok(max > 1.0160 && max < 1.0175, `aphelion ${max}`);
  const { m, d } = dateFromJd(minJd);
  assert.ok(m === 1 && d <= 8, `perihelion date ${m}/${d}`);
});

test('elements <-> state round trip', () => {
  const jd = jdFromDate(2028, 6, 1);
  const s = stateFromElements(APOPHIS.elements, jd);
  const el = elementsFromState(s, jd);
  const s2 = stateFromElements(el, jd + 40);
  const s3 = stateFromElements(APOPHIS.elements, jd + 40);
  assert.ok(norm([s2.r[0] - s3.r[0], s2.r[1] - s3.r[1], s2.r[2] - s3.r[2]]) < 50, 'positions agree to 50 km');
});

test('Apophis: the published orbit, propagated 4 years, passes Earth within 6 hours of NASA\'s time', () => {
  let best = Infinity, bestJd = 0;
  for (let jd = jdFromDate(2029, 3, 1); jd < jdFromDate(2029, 6, 1); jd += 0.01) {
    const d = earthDistanceKm(APOPHIS.elements, jd);
    if (d < best) { best = d; bestJd = jd; }
  }
  const hoursOff = (bestJd - APOPHIS.flybyJd) * 24;
  console.log(`  model closest approach is ${hoursOff.toFixed(1)} h from NASA's time, ${Math.round(best).toLocaleString()} km from Earth's centre`);
  assert.ok(Math.abs(hoursOff) < 6, `closest approach off by ${hoursOff} h`);
  assert.ok(best < 384400, `miss distance ${best} km should be inside the Moon's orbit`);
});

test('Apophis: a rendezvous like ESA Ramses (launch spring 2028, arrive Feb 2029) is cheap', () => {
  // ESA quotes a 24 Apr - 11 May 2028 window, a 10-month transfer and under 1.6 km/s of delta-v.
  let best = Infinity, bestC3 = 0;
  for (let l = jdFromDate(2028, 4, 24); l <= jdFromDate(2028, 5, 11); l += 1) {
    for (let a = jdFromDate(2029, 2, 1); a <= jdFromDate(2029, 2, 28); a += 1) {
      const t = transferTo(APOPHIS.elements, l, a);
      if (t && t.vinfArr < best) { best = t.vinfArr; bestC3 = t.c3; }
    }
  }
  console.log(`  best arrival speed in that window: ${best.toFixed(2)} km/s at C3 ${bestC3.toFixed(1)} km2/s2`);
  assert.ok(best < 1.6, `arrival v-infinity ${best} km/s should be under ESA's 1.6 km/s`);
  assert.ok(bestC3 < 40, `C3 ${bestC3}`);
});

test('Moon: capture burn, orbit period and eclipse match Lunar Reconnaissance Orbiter experience', () => {
  const r = R_MOON + 50;
  const period = orbitPeriodS(MU_MOON, r) / 60;
  assert.ok(period > 110 && period < 116, `50 km orbit period ${period} min (LRO: about 113)`);
  const ecl = maxEclipseFraction(R_MOON, r) * period;
  assert.ok(ecl > 44 && ecl < 50, `max eclipse ${ecl} min (LRO: about 48)`);
  const dv = captureDv(MU_MOON, 0.83, R_MOON + 100, R_MOON + 100);
  assert.ok(dv > 0.75 && dv < 0.9, `capture burn ${dv} km/s`);
  const c3 = lunarTransferC3();
  assert.ok(c3 > -2.2 && c3 < -1.8, `lunar transfer C3 ${c3}`);
});
