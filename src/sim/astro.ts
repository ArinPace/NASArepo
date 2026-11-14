// Orbital mechanics used by the game. Everything here is standard two-body
// astrodynamics (Kepler's equation, a universal-variable Lambert solver,
// patched conics). Inputs are published orbital elements; see DATA_SOURCES.md.

export const AU_KM = 149597870.7; // km, IAU 2012 definition
export const MU_SUN = 1.32712440018e11; // km^3/s^2
export const MU_EARTH = 398600.4418; // km^3/s^2
export const MU_MOON = 4902.800066; // km^3/s^2
export const R_EARTH = 6378.137; // km
export const R_MOON = 1737.4; // km
export const EARTH_MOON_KM = 384400; // km, mean distance
export const DAY_S = 86400;
export const G0 = 9.80665; // m/s^2
export const C_KM_S = 299792.458;
export const SOLAR_CONSTANT = 1361; // W/m^2 at 1 au

export type Vec = [number, number, number];
export const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const norm = (a: Vec) => Math.sqrt(dot(a, a));
const RAD = Math.PI / 180;

// ---------- calendar ----------
/** Julian date at 0h UT of a Gregorian calendar date. */
export function jdFromDate(y: number, m: number, d: number): number {
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  const jdn =
    d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
  return jdn - 0.5;
}
export function dateFromJd(jd: number): { y: number; m: number; d: number } {
  const z = Math.floor(jd + 0.5);
  const a0 = Math.floor((z - 1867216.25) / 36524.25);
  const a = z + 1 + a0 - Math.floor(a0 / 4);
  const b = a + 1524;
  const c = Math.floor((b - 122.1) / 365.25);
  const d0 = Math.floor(365.25 * c);
  const e = Math.floor((b - d0) / 30.6001);
  const d = b - d0 - Math.floor(30.6001 * e);
  const m = e < 14 ? e - 1 : e - 13;
  const y = m > 2 ? c - 4716 : c - 4715;
  return { y, m, d };
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtDate(jd: number): string {
  const { y, m, d } = dateFromJd(jd);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
export function fmtMonth(jd: number): string {
  const { y, m } = dateFromJd(jd);
  return `${MONTHS[m - 1]} ${y}`;
}

// ---------- Kepler ----------
export interface Elements {
  a: number; // semi-major axis, au
  e: number;
  i: number; // deg
  node: number; // longitude of ascending node, deg
  peri: number; // argument of perihelion, deg
  M0: number; // mean anomaly at epoch, deg
  epoch: number; // JD
}
export interface State {
  r: Vec; // km
  v: Vec; // km/s
}

export function solveKepler(M: number, e: number): number {
  let m = M % (2 * Math.PI);
  if (m > Math.PI) m -= 2 * Math.PI;
  if (m < -Math.PI) m += 2 * Math.PI;
  let E = e < 0.8 ? m : Math.PI * Math.sign(m || 1);
  for (let k = 0; k < 50; k++) {
    const dE = (E - e * Math.sin(E) - m) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-13) break;
  }
  return E;
}

/** Heliocentric ecliptic J2000 state from Keplerian elements (two-body). */
export function stateFromElements(el: Elements, jd: number, mu = MU_SUN): State {
  const a = el.a * AU_KM;
  const n = Math.sqrt(mu / (a * a * a)); // rad/s
  const M = el.M0 * RAD + n * (jd - el.epoch) * DAY_S;
  const E = solveKepler(M, el.e);
  const cosE = Math.cos(E);
  const sinE = Math.sin(E);
  const b = Math.sqrt(1 - el.e * el.e);
  const rr = a * (1 - el.e * cosE);
  const xp = a * (cosE - el.e);
  const yp = a * b * sinE;
  const k = Math.sqrt(mu * a) / rr;
  const vxp = -k * sinE;
  const vyp = k * b * cosE;
  const cw = Math.cos(el.peri * RAD), sw = Math.sin(el.peri * RAD);
  const co = Math.cos(el.node * RAD), so = Math.sin(el.node * RAD);
  const ci = Math.cos(el.i * RAD), si = Math.sin(el.i * RAD);
  const rot = (x: number, y: number): Vec => [
    (cw * co - sw * so * ci) * x + (-sw * co - cw * so * ci) * y,
    (cw * so + sw * co * ci) * x + (-sw * so + cw * co * ci) * y,
    sw * si * x + cw * si * y,
  ];
  return { r: rot(xp, yp), v: rot(vxp, vyp) };
}

/** Osculating elements from a state vector (elliptical orbits only). */
export function elementsFromState(s: State, jd: number, mu = MU_SUN): Elements {
  const r = norm(s.r), v2 = dot(s.v, s.v);
  const h = cross(s.r, s.v);
  const hn = norm(h);
  const energy = v2 / 2 - mu / r;
  const a = -mu / (2 * energy);
  const evec = sub(scale(cross(s.v, h), 1 / mu), scale(s.r, 1 / r));
  const e = norm(evec);
  const i = Math.acos(Math.max(-1, Math.min(1, h[2] / hn)));
  const nvec: Vec = [-h[1], h[0], 0];
  const nn = norm(nvec);
  let node = 0, peri = 0;
  if (nn > 1e-9) {
    node = Math.atan2(nvec[1], nvec[0]);
    peri = Math.acos(Math.max(-1, Math.min(1, dot(nvec, evec) / (nn * e))));
    if (evec[2] < 0) peri = 2 * Math.PI - peri;
  } else {
    peri = Math.atan2(evec[1], evec[0]);
  }
  let nu = Math.acos(Math.max(-1, Math.min(1, dot(evec, s.r) / (e * r))));
  if (dot(s.r, s.v) < 0) nu = 2 * Math.PI - nu;
  const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
  const M = E - e * Math.sin(E);
  return { a: a / AU_KM, e, i: i / RAD, node: node / RAD, peri: peri / RAD, M0: M / RAD, epoch: jd };
}

// ---------- Earth ----------
// JPL "Keplerian Elements for Approximate Positions of the Major Planets",
// Table 1 (valid 1800-2050), Earth-Moon barycenter row.
// https://ssd.jpl.nasa.gov/planets/approx_pos.html
const EM = {
  a: [1.00000261, 0.00000562],
  e: [0.01671123, -0.00004392],
  I: [-0.00001531, -0.01294668],
  L: [100.46457166, 35999.37244981],
  peri: [102.93768193, 0.32327364],
  node: [0.0, 0.0],
};
export function earthElements(jd: number): Elements {
  const T = (jd - 2451545.0) / 36525;
  const f = (p: number[]) => p[0] + p[1] * T;
  const node = f(EM.node);
  const lonPeri = f(EM.peri);
  return { a: f(EM.a), e: f(EM.e), i: f(EM.I), node, peri: lonPeri - node, M0: f(EM.L) - lonPeri, epoch: jd };
}
export function earthState(jd: number): State {
  return stateFromElements(earthElements(jd), jd);
}

// ---------- Lambert ----------
function stumpff(z: number): [number, number] {
  if (z > 1e-6) {
    const s = Math.sqrt(z);
    return [(1 - Math.cos(s)) / z, (s - Math.sin(s)) / (s * s * s)];
  }
  if (z < -1e-6) {
    const s = Math.sqrt(-z);
    return [(Math.cosh(s) - 1) / -z, (Math.sinh(s) - s) / (s * s * s)];
  }
  return [0.5 - z / 24, 1 / 6 - z / 120];
}

/**
 * Single-revolution Lambert solver (universal variables, bisection).
 * Returns the departure and arrival velocities of the prograde transfer
 * between r1 and r2 that takes `tof` seconds.
 */
export function lambert(r1: Vec, r2: Vec, tof: number, mu = MU_SUN, prograde = true): { v1: Vec; v2: Vec } | null {
  const r1n = norm(r1), r2n = norm(r2);
  const c = cross(r1, r2);
  let dth = Math.acos(Math.max(-1, Math.min(1, dot(r1, r2) / (r1n * r2n))));
  if (prograde ? c[2] < 0 : c[2] >= 0) dth = 2 * Math.PI - dth;
  const A = Math.sin(dth) * Math.sqrt((r1n * r2n) / (1 - Math.cos(dth)));
  if (!isFinite(A) || Math.abs(A) < 1e-6) return null;
  let lo = -4 * Math.PI * Math.PI * 16;
  let hi = 4 * Math.PI * Math.PI;
  let z = 0, y = 0;
  const sqmu = Math.sqrt(mu);
  for (let k = 0; k < 200; k++) {
    const [C, S] = stumpff(z);
    y = r1n + r2n + (A * (z * S - 1)) / Math.sqrt(C);
    if (A > 0 && y < 0) {
      lo = z;
      z = (lo + hi) / 2;
      continue;
    }
    const chi = Math.sqrt(y / C);
    const t = (chi * chi * chi * S + A * Math.sqrt(y)) / sqmu;
    if (Math.abs(t - tof) < 1e-7 * tof) break;
    if (t <= tof) lo = z;
    else hi = z;
    z = (lo + hi) / 2;
  }
  if (!(y > 0)) return null;
  const f = 1 - y / r1n;
  const g = A * Math.sqrt(y / mu);
  const gdot = 1 - y / r2n;
  const v1 = scale(sub(r2, scale(r1, f)), 1 / g);
  const v2 = scale(sub(scale(r2, gdot), r1), 1 / g);
  if (!isFinite(v1[0]) || !isFinite(v2[0])) return null;
  return { v1, v2 };
}

export interface Transfer {
  launchJd: number;
  arriveJd: number;
  tofDays: number;
  c3: number; // km^2/s^2, launch energy the rocket must supply
  vinfDep: number; // km/s
  vinfArr: number; // km/s, speed relative to the target on arrival
  v1: Vec; // heliocentric departure velocity
  r1: Vec;
}

/** Ballistic transfer from Earth to a body with the given elements. */
export function transferTo(target: Elements, launchJd: number, arriveJd: number): Transfer | null {
  const tof = (arriveJd - launchJd) * DAY_S;
  if (tof <= 0) return null;
  const e = earthState(launchJd);
  const t = stateFromElements(target, arriveJd);
  const sol = lambert(e.r, t.r, tof);
  if (!sol) return null;
  const vd = norm(sub(sol.v1, e.v));
  const va = norm(sub(sol.v2, t.v));
  return { launchJd, arriveJd, tofDays: arriveJd - launchJd, c3: vd * vd, vinfDep: vd, vinfArr: va, v1: sol.v1, r1: e.r };
}

/** Distance between Earth and a body, km. */
export function earthDistanceKm(target: Elements, jd: number): number {
  return norm(sub(stateFromElements(target, jd).r, earthState(jd).r));
}

// ---------- Moon (patched conics) ----------
export function circularSpeed(mu: number, r: number) {
  return Math.sqrt(mu / r);
}
export function orbitPeriodS(mu: number, a: number) {
  return 2 * Math.PI * Math.sqrt((a * a * a) / mu);
}
/** Burn needed to capture from a hyperbolic approach (speed vinf far away) into an orbit with the given periapsis and apoapsis radii. */
export function captureDv(mu: number, vinf: number, rPeri: number, rApo: number): number {
  const vHyp = Math.sqrt(vinf * vinf + (2 * mu) / rPeri);
  const a = (rPeri + rApo) / 2;
  const vOrb = Math.sqrt(mu * (2 / rPeri - 1 / a));
  return vHyp - vOrb;
}
/** Worst-case fraction of a circular orbit spent in the body's shadow (Sun in the orbit plane). */
export function maxEclipseFraction(rBody: number, rOrbit: number): number {
  return Math.asin(Math.min(1, rBody / rOrbit)) / Math.PI;
}
/** Launch energy for a Hohmann-like transfer from a 200 km parking orbit out to the Moon's distance. */
export function lunarTransferC3(): number {
  const rp = R_EARTH + 200;
  const a = (rp + EARTH_MOON_KM) / 2;
  return -MU_EARTH / a; // km^2/s^2 (negative: still bound to Earth)
}
