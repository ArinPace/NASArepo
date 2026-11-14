// The design model: what the players choose, and the budgets that follow
// from those choices (mass, power, data, cost, time, delta-v).
import {
  AU_KM, G0, Transfer, earthDistanceKm, elementsFromState, norm, stateFromElements, transferTo, jdFromDate, earthState,
} from './astro';
import {
  ADCS, ANTENNAS, APOPHIS, ARRAY, BATTERIES, CLASSES, ClassId, DSN, FLYBY_PASSES, INSTRUMENTS, MissionClass, OBJECTIVES,
  PROJECT_START_JD, PROPS, RADIOS, REDUNDANCY, ROCKETS, Redundancy, Rocket, STANDOFFS, STORAGES, TESTS, rocketCapacityKg,
} from './data';

export const MIN_TOF_DAYS = 40;
export const LAST_ARRIVAL_JD = APOPHIS.flybyJd - 3;

export type ConsoleId = 'design' | 'craft' | 'science' | 'comms';
export const CONSOLES: { id: ConsoleId; name: string; owns: string }[] = [
  { id: 'design', name: 'Mission Design', owns: 'Trajectory, rocket, schedule, budget' },
  { id: 'craft', name: 'Spacecraft', owns: 'Mass, power, propulsion, backups' },
  { id: 'science', name: 'Science', owns: 'Objectives, instruments, pointing' },
  { id: 'comms', name: 'Comms and Data', owns: 'Radio, antenna, storage, network time' },
];

export interface Design {
  scenario: 'apophis';
  klass: ClassId;
  objectives: string[];
  missionType: 'rendezvous' | 'flyby';
  launchJd: number;
  arriveJd: number;
  standoff: string;
  rocket: string;
  instruments: string[];
  arrayM2: number;
  autoArray: boolean;
  battery: string;
  antenna: string;
  radio: string;
  prop: string;
  adcs: string;
  storage: string;
  redundancy: Redundancy;
  reservePct: number;
  tests: string[];
  dsnHoursPerDay: number;
}

/** The arrival date that needs the least braking for a given launch date. */
export function bestArrival(launchJd: number, minBeforeDays = 20): number {
  let best = Infinity, bestJd = launchJd + 200;
  for (let a = launchJd + MIN_TOF_DAYS; a <= APOPHIS.flybyJd - 9 - minBeforeDays; a += 2) {
    const t = transferTo(APOPHIS.elements, launchJd, a);
    if (t && t.c3 < 45 && t.vinfArr < best) { best = t.vinfArr; bestJd = a; }
  }
  return bestJd;
}

export function defaultDesign(klass: ClassId = 'explorer'): Design {
  // A lean, valid starting point on a mediocre launch date. Finding the good
  // window and fitting the craft to the science is the players' job.
  const launchJd = jdFromDate(2028, 6, 20);
  return {
    scenario: 'apophis', klass, objectives: ['shape'], missionType: 'rendezvous',
    launchJd, arriveJd: bestArrival(launchJd), standoff: 'mid',
    rocket: klass === 'smallsat' ? 'shared' : klass === 'explorer' ? 'f9r' : 'f9', instruments: ['cam'],
    arrayM2: 2, autoArray: true, battery: 'b1', antenna: 'mga', radio: 'r5', prop: 'mono', adcs: 'basic', storage: 's1',
    redundancy: 'single', reservePct: 10, tests: [], dsnHoursPerDay: 4,
  };
}

const find = <T extends { id: string }>(list: T[], id: string): T => list.find((x) => x.id === id) ?? list[0];

export interface Traj {
  ok: boolean;
  why?: string;
  t?: Transfer;
  c3: number;
  vinfArr: number;
  tofDays: number;
  dvArrive: number;
  dvOps: number;
  dvTotal: number;
  sunAuMax: number;
  sunAuMin: number;
  opsStartJd: number;
  opsEndJd: number;
  beforeDays: number;
  rangeKm: number;
  vRel: number;
}


export function trajectory(d: Design): Traj {
  const bad = (why: string): Traj => ({
    ok: false, why, c3: 0, vinfArr: 0, tofDays: d.arriveJd - d.launchJd, dvArrive: 0, dvOps: 0, dvTotal: 0,
    sunAuMax: 1.1, sunAuMin: 0.75, opsStartJd: d.arriveJd, opsEndJd: d.arriveJd, beforeDays: 0, rangeKm: 20, vRel: 0,
  });
  if (d.arriveJd - d.launchJd < MIN_TOF_DAYS) return bad(`The trip must take at least ${MIN_TOF_DAYS} days.`);
  if (d.arriveJd > LAST_ARRIVAL_JD) return bad('Arrive before 10 April 2029. After the flyby Apophis is on a new orbit.');
  const t = transferTo(APOPHIS.elements, d.launchJd, d.arriveJd);
  if (!t) return bad('No direct path exists for these dates.');
  const rendezvous = d.missionType === 'rendezvous';
  const stand = find(rendezvous ? STANDOFFS : FLYBY_PASSES, d.standoff);
  const dvArrive = rendezvous ? t.vinfArr : 0;
  const dvOps = 0.03 + stand.dvKmS;
  const opsStartJd = rendezvous ? d.arriveJd + 7 : d.arriveJd - 1;
  const opsEndJd = rendezvous ? APOPHIS.flybyJd + 30 : d.arriveJd + 1;
  // Sun distance along the cruise and during operations
  let sunMax = 0, sunMin = 9;
  const tr = elementsFromState({ r: t.r1, v: t.v1 }, d.launchJd);
  for (let k = 0; k <= 12; k++) {
    const jd = d.launchJd + (t.tofDays * k) / 12;
    const r = norm(stateFromElements(tr, jd).r) / AU_KM;
    sunMax = Math.max(sunMax, r); sunMin = Math.min(sunMin, r);
  }
  for (let jd = opsStartJd; jd <= opsEndJd; jd += 5) {
    const r = norm(stateFromElements(APOPHIS.elements, jd).r) / AU_KM;
    sunMax = Math.max(sunMax, r); sunMin = Math.min(sunMin, r);
  }
  return {
    ok: true, t, c3: t.c3, vinfArr: t.vinfArr, tofDays: t.tofDays, dvArrive, dvOps,
    dvTotal: (dvArrive + dvOps) * 1.1,
    sunAuMax: sunMax, sunAuMin: sunMin, opsStartJd, opsEndJd,
    beforeDays: rendezvous ? Math.max(0, APOPHIS.flybyJd - 2 - opsStartJd) : 0,
    rangeKm: stand.km, vRel: rendezvous ? 0 : t.vinfArr,
  };
}

// ---------- link budget ----------
const LAMBDA_M = 0.0355; // X-band, 8.45 GHz
/** Downlink data rate to a 34 m Deep Space Network dish, kilobits per second. */
export function dataRateKbps(rfW: number, gainDb: number, distKm: number, maxMbps: number): number {
  const eirp = 10 * Math.log10(rfW) + gainDb;
  const pathLoss = 20 * Math.log10((4 * Math.PI * distKm * 1000) / LAMBDA_M);
  const required = 1 + 3 + 2; // Eb/N0 for a coded link + link margin + pointing and circuit losses, dB
  const dbHz = eirp + DSN.gOverT - pathLoss + 228.6 - required;
  return Math.min(maxMbps * 1000, Math.pow(10, dbHz / 10) / 1000);
}

export const SCIENCE_HOURS_PER_DAY = 8;
const STRUCT_FRAC = 0.26; // structure 18%, harness 4%, thermal 4% of dry mass
const GROWTH = 1.15; // mass growth allowance on the current estimate

export interface Finding {
  id: string;
  console: ConsoleId;
  level: 'red' | 'amber';
  text: string;
  fix: string;
}

export interface Budgets {
  traj: Traj;
  klass: MissionClass;
  rocket: Rocket;
  arrayM2: number;
  mass: { payload: number; bus: number; dryCbe: number; dryPred: number; prop: number; wet: number; capacity: number; margin: number; feasible: boolean };
  power: { arrayW: number; science: number; comm: number; safe: number; worst: number; margin: number };
  data: { genGbDay: number; kbpsWorst: number; kbpsBest: number; downGbDayWorst: number; storageGb: number; fillDays: number; earthKmMax: number; earthKmMin: number };
  cost: { hardware: number; wraps: number; launch: number; ops: number; tests: number; dsn: number; estimate: number; reserve: number; total: number; cap: number; margin: number };
  time: { devMonths: number; readyJd: number; slackDays: number; missionMonths: number };
  dv: { needed: number; ispS: number };
  resolutionM: number;
  cheaperRocket: Rocket | null;
  findings: Finding[];
  consoles: Record<ConsoleId, 'green' | 'amber' | 'red'>;
}

export function evaluate(d: Design, trajIn?: Traj): Budgets {
  const traj = trajIn ?? trajectory(d);
  const klass = find(CLASSES, d.klass);
  const rocket = find(ROCKETS, d.rocket);
  const instruments = INSTRUMENTS.filter((i) => d.instruments.includes(i.id));
  const antenna = find(ANTENNAS, d.antenna), radio = find(RADIOS, d.radio), prop = find(PROPS, d.prop);
  const battery = find(BATTERIES, d.battery), storage = find(STORAGES, d.storage), adcs = find(ADCS, d.adcs);
  const red = REDUNDANCY[d.redundancy];
  const tests = TESTS.filter((t) => d.tests.includes(t.id));

  // ----- power (decides the array, which feeds mass)
  const busW = klass.busPowerW * 1.08 + (storage.powerW + adcs.powerW) * (1 + (red.massMult - 1) * 0.25) + prop.powerW;
  const payloadW = instruments.reduce((s, i) => s + i.powerW, 0);
  const science = busW + payloadW + radio.powerW * 0.2;
  const comm = busW + radio.powerW + payloadW * 0.2;
  const safe = busW * 0.6;
  const worst = Math.max(science, comm);
  const wPerM2 = (ARRAY.wPerM2At1Au / (traj.sunAuMax * traj.sunAuMax)) * 0.92;
  const arrayM2 = d.autoArray ? Math.max(0.5, Math.ceil(((worst * 1.3) / wPerM2) * 4) / 4) : d.arrayM2;
  const arrayW = arrayM2 * wPerM2;
  const power = { arrayW, science, comm, safe, worst, margin: (arrayW - worst) / worst };

  // ----- mass, with the propellant snowball solved in closed form
  const payload = instruments.reduce((s, i) => s + i.massKg, 0);
  const electronics = (storage.massKg + adcs.massKg + radio.massKg + antenna.massKg) * red.massMult;
  const bus = klass.busMassKg + electronics + battery.massKg + arrayM2 * ARRAY.kgPerM2 + 2 + prop.massKg;
  const fixed = (payload + bus) / (1 - STRUCT_FRAC);
  const ratio = Math.exp((traj.dvTotal * 1000) / (prop.ispS * G0));
  const q = (ratio - 1) * 1.03; // propellant per kg of dry mass, with 3% left in the tanks
  const denom = 1 - GROWTH * prop.tankFrac * q;
  const feasible = denom > 0.05;
  const dryPred = feasible ? (GROWTH * fixed) / denom : GROWTH * fixed * 20;
  const propKg = dryPred * q;
  const wet = dryPred + propKg;
  const capacity = traj.ok ? rocketCapacityKg(rocket, traj.c3) : 0;
  const mass = { payload, bus, dryCbe: fixed, dryPred, prop: propKg, wet, capacity, margin: capacity > 0 ? (capacity - wet) / capacity : -1, feasible };

  // ----- data
  let earthKmMax = 0, earthKmMin = Infinity;
  for (let jd = traj.opsStartJd; jd <= traj.opsEndJd + 0.01; jd += Math.max(0.5, (traj.opsEndJd - traj.opsStartJd) / 40)) {
    const km = earthDistanceKm(APOPHIS.elements, jd);
    earthKmMax = Math.max(earthKmMax, km); earthKmMin = Math.min(earthKmMin, km);
  }
  const genGbDay = (instruments.reduce((s, i) => s + i.dataMbPerHour, 0) * SCIENCE_HOURS_PER_DAY) / 1000;
  const kbpsWorst = dataRateKbps(radio.rfW, antenna.gainDb, earthKmMax, radio.maxMbps);
  const kbpsBest = dataRateKbps(radio.rfW, antenna.gainDb, earthKmMin, radio.maxMbps);
  const downGbDayWorst = (kbpsWorst * d.dsnHoursPerDay * 3600) / 1e6;
  const fillDays = genGbDay > downGbDayWorst ? storage.gb / (genGbDay - downGbDayWorst) : Infinity;
  const data = { genGbDay, kbpsWorst, kbpsBest, downGbDayWorst, storageGb: storage.gb, fillDays, earthKmMax, earthKmMin };

  // ----- cost ($M)
  const hardware =
    klass.busCostM + instruments.reduce((s, i) => s + i.costM, 0) +
    (storage.costM + adcs.costM + radio.costM + antenna.costM) * red.costMult +
    battery.costM + arrayM2 * ARRAY.costMPerM2 + 0.5 + prop.costM;
  const wraps = hardware * 0.3;
  const missionMonths = Math.max(1, (traj.opsEndJd - d.launchJd) / 30.44);
  const ops = missionMonths * klass.opsCostPerMonthM;
  const testCost = tests.reduce((s, t) => s + t.costM, 0) * klass.testCostMult;
  const dsnDays = traj.opsEndJd - traj.opsStartJd + traj.tofDays * 0.15;
  const dsn = (d.dsnHoursPerDay * dsnDays * DSN.costPerHourK) / 1000;
  const estimate = hardware + wraps + rocket.priceM + ops + testCost + dsn;
  const reserve = (estimate * d.reservePct) / 100;
  const cost = { hardware, wraps, launch: rocket.priceM, ops, tests: testCost, dsn, estimate, reserve, total: estimate + reserve, cap: klass.capM, margin: (klass.capM - estimate - reserve) / klass.capM };

  // ----- time
  const newTech = instruments.filter((i) => i.trl < 7).length;
  const devMonths = klass.devMonths + red.months + newTech + (tests.reduce((s, t) => s + t.weeks, 0) * 0.6) / 4.345; // tests overlap with assembly
  const readyJd = PROJECT_START_JD + devMonths * 30.44;
  const time = { devMonths, readyJd, slackDays: d.launchJd - readyJd, missionMonths };

  // ----- image detail
  const cams = instruments.filter((i) => i.ifovUrad);
  let resolutionM = Infinity;
  for (const c of cams) {
    let r = c.ifovUrad! * 1e-6 * traj.rangeKm * 1000;
    if (c.needsPointing && !adcs.precise) r *= 3; // jitter blurs a telescope on basic pointing
    if (traj.vRel > 0) r = Math.max(r, 0.3 * traj.vRel); // motion smear on a fast flyby
    resolutionM = Math.min(resolutionM, r);
  }

  // ----- review board findings
  const f: Finding[] = [];
  const add = (id: string, console: ConsoleId, level: 'red' | 'amber', text: string, fix: string) => f.push({ id, console, level, text, fix });
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  if (!traj.ok) add('traj', 'design', 'red', traj.why ?? 'No valid trajectory.', 'Pick new dates on the launch chart.');
  if (traj.ok && !feasible) add('snowball', 'craft', 'red', 'The propellant snowball never stops: every extra kilogram of tank needs more propellant than it holds.', 'Arrive more slowly, switch to the two-propellant engine, or fly past instead of stopping.');
  else if (traj.ok && mass.margin < 0) add('mass', 'craft', 'red', `Too heavy. ${rocket.name} can throw ${Math.round(capacity)} kg at this launch energy and the spacecraft weighs ${Math.round(wet)} kg fuelled.`, 'Shed mass, choose easier dates, or buy a bigger rocket.');
  else if (traj.ok && mass.margin < 0.1) add('mass', 'craft', 'amber', `Launch mass margin is only ${pct(mass.margin)}. Designs gain weight as they are built.`, 'Aim for 10% or more.');
  const cheaperRocket = traj.ok && feasible && mass.margin >= 0
    ? ROCKETS.filter((x) => x.priceM < rocket.priceM && !x.shared && rocketCapacityKg(x, traj.c3) >= wet * 1.1).sort((x, y) => x.priceM - y.priceM)[0] ?? null
    : null;
  if (cheaperRocket) add('rocket-big', 'design', 'amber', `The rocket is ${pct(mass.margin)} empty. ${cheaperRocket.name} could lift this for $${Math.round(rocket.priceM - cheaperRocket.priceM)}M less.`, 'Try a smaller rocket.');
  if (power.margin < 0) add('power', 'craft', 'red', `Power is short by ${Math.round(worst - arrayW)} W at ${traj.sunAuMax.toFixed(2)} au from the Sun.`, 'Add solar panel area or switch something off.');
  else if (power.margin < 0.2) add('power', 'craft', 'amber', `Power margin is ${pct(power.margin)}. Panels degrade and dust up.`, 'Aim for 30%.');
  if (d.redundancy === 'single' && d.klass === 'flagship') add('string', 'craft', 'amber', 'A flagship with no backups. Class A missions are expected to survive any single failure.', 'Add backups.');
  if (d.redundancy === 'full' && d.klass === 'smallsat') add('string', 'craft', 'amber', 'Full backups on a SmallSat. The mass and cost may outweigh the benefit.', 'Consider selective backups.');
  for (const id of d.objectives) {
    const o = OBJECTIVES.find((x) => x.id === id)!;
    if (!o.instruments.some((i) => d.instruments.includes(i))) add(`obj-${id}`, 'science', 'red', `"${o.name}" has no instrument that can measure it.`, `Add one of: ${o.instruments.map((i) => INSTRUMENTS.find((x) => x.id === i)!.short).join(', ')}.`);
    if (d.missionType === 'flyby' && o.segments.length > 1) add(`obj-seg-${id}`, 'science', 'red', `"${o.name}" needs you to stay with the asteroid. A flyby is gone in minutes.`, 'Switch to a rendezvous or drop this objective.');
  }
  if (d.objectives.length === 0) add('obj-none', 'science', 'red', 'No science objective chosen.', 'Pick at least one.');
  if (d.missionType === 'rendezvous' && traj.ok && traj.beforeDays < 14 && d.objectives.some((o) => o !== 'mass')) add('late', 'science', 'amber', `Only ${Math.round(traj.beforeDays)} days at the asteroid before the flyby. A full map takes about two weeks.`, 'Arrive earlier.');
  if (d.instruments.includes('tele') && !adcs.precise) add('jitter', 'science', 'amber', 'The telescope will blur on basic pointing.', 'Fit precise pointing.');
  if (d.standoff === 'close' && !adcs.precise && d.missionType === 'rendezvous') add('close', 'science', 'amber', 'Flying 1 km from a tumbling asteroid on basic pointing is risky.', 'Fit precise pointing or stand off at 5 km.');
  if (genGbDay > downGbDayWorst * 1.02) {
    const level = fillDays < 5 ? 'red' : 'amber';
    add('data', 'comms', level, `Instruments make ${genGbDay.toFixed(1)} Gb a day. At the farthest point you can send ${downGbDayWorst.toFixed(1)} Gb. The recorder fills in ${fillDays.toFixed(0)} days.`, 'Bigger dish, stronger transmitter, more network hours, or a bigger recorder.');
  }
  else if (genGbDay > 0 && downGbDayWorst > 6 * genGbDay && (d.antenna !== 'lga' || d.radio !== 'r5')) add('comm-big', 'comms', 'amber', `You can send ${Math.round(downGbDayWorst / genGbDay)} times more data than the instruments make.`, 'A smaller dish, a weaker transmitter or fewer network hours would save mass and money.');
  if (d.antenna === 'hga2' && !adcs.precise) add('dish-point', 'comms', 'amber', 'A 2 m dish has a beam narrower than basic pointing can hold.', 'Fit precise pointing or a smaller dish.');
  if (cost.margin < 0) add('cost', 'design', 'red', `Over the cost cap by $${Math.round(cost.total - cost.cap)}M.`, 'Cut hardware, tests or the rocket. Or lower reserves and accept the risk.');
  else if (d.reservePct < 15) add('reserve', 'design', 'amber', `Cost reserve is ${d.reservePct}%. Projects this early usually hold 20% or more.`, 'Raise reserves if the cap allows.');
  if (traj.ok && time.slackDays < 0) add('late-build', 'design', 'red', `The spacecraft will not be ready. It needs ${Math.round(-time.slackDays)} more days before launch.`, 'Launch later, drop tests or new technology, or pick a smaller class.');
  else if (traj.ok && time.slackDays < 30) add('slack', 'design', 'amber', `Only ${Math.round(time.slackDays)} days of schedule slack before launch.`, 'One late part and you miss the window.');
  if (rocket.shared && time.slackDays >= 0) add('shared', 'design', 'amber', 'A shared ride leaves when the main passenger is ready, not when you are.', 'Carry extra propellant, or buy your own rocket.');

  const consoles = { design: 'green', craft: 'green', science: 'green', comms: 'green' } as Record<ConsoleId, 'green' | 'amber' | 'red'>;
  for (const x of f) {
    if (x.level === 'red') consoles[x.console] = 'red';
    else if (consoles[x.console] === 'green') consoles[x.console] = 'amber';
  }
  return { traj, klass, rocket, arrayM2, mass, power, data, cost, time, dv: { needed: traj.dvTotal, ispS: prop.ispS }, resolutionM, cheaperRocket, findings: f, consoles };
}

/** Only the findings a given gate can act on. Early gates do not judge parts that are chosen later. */
export function forGate(b: Budgets, stage: string): Budgets {
  if (stage !== 'pitch' && stage !== 'route') return b;
  const keep = (id: string) =>
    stage === 'pitch'
      ? id === 'obj-none'
      : ['traj', 'late-build', 'slack', 'shared', 'late', 'cost', 'obj-none', 'mass', 'snowball'].includes(id) || id.startsWith('obj-seg-');
  const findings = b.findings.filter((f) => keep(f.id));
  const consoles = { design: 'green', craft: 'green', science: 'green', comms: 'green' } as Budgets['consoles'];
  for (const x of findings) {
    if (x.level === 'red') consoles[x.console] = 'red';
    else if (consoles[x.console] === 'green') consoles[x.console] = 'amber';
  }
  return { ...b, findings, consoles };
}

/** The Snowball: how one change ripples through the design. */
export interface SnowballStep { label: string; delta: number; unit: string }
export function snowball(before: Budgets, after: Budgets): SnowballStep[] {
  const steps: SnowballStep[] = [];
  const push = (label: string, delta: number, unit: string, min = 0.05) => {
    if (Math.abs(delta) >= min) steps.push({ label, delta, unit });
  };
  push('Instruments', after.mass.payload - before.mass.payload, 'kg');
  push('Power needed', after.power.worst - before.power.worst, 'W', 0.5);
  push('Solar panels', (after.arrayM2 - before.arrayM2) * ARRAY.kgPerM2, 'kg');
  push('Bus hardware', after.mass.bus - before.mass.bus - (after.arrayM2 - before.arrayM2) * ARRAY.kgPerM2, 'kg');
  push('Structure and growth allowance', after.mass.dryPred - before.mass.dryPred - (after.mass.payload - before.mass.payload) - (after.mass.bus - before.mass.bus), 'kg');
  push('Propellant', after.mass.prop - before.mass.prop, 'kg');
  push('Launch mass', after.mass.wet - before.mass.wet, 'kg');
  push('Cost', after.cost.total - before.cost.total, '$M', 0.05);
  return steps;
}

/** Earth to spacecraft distance during operations, km. */
const memoE = new Map<number, number>(), memoS = new Map<number, number>();
export function earthKmAt(jd: number): number {
  const key = Math.round(jd * 100);
  let v = memoE.get(key);
  if (v === undefined) {
    v = earthDistanceKm(APOPHIS.elements, jd);
    if (memoE.size < 50000) memoE.set(key, v);
  }
  return v;
}
export function sunAuAt(jd: number): number {
  const key = Math.round(jd * 100);
  let v = memoS.get(key);
  if (v === undefined) {
    v = norm(stateFromElements(APOPHIS.elements, jd).r) / AU_KM;
    if (memoS.size < 50000) memoS.set(key, v);
  }
  return v;
}
export { earthState };
