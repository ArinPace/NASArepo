// Flight simulation. One seed = one possible world. The same seed always
// produces the same hardware luck, so changing the design and flying again
// shows exactly what that change bought.
import { APOPHIS, ARRAY, DSN, FLYBY_PASSES, INSTRUMENTS, Instrument, OBJECTIVES, REDUNDANCY, STANDOFFS, rocketCapacityKg, ANTENNAS, RADIOS, ADCS, STORAGES } from './data';
import { Budgets, ConsoleId, Design, LAST_ARRIVAL_JD, SCIENCE_HOURS_PER_DAY, dataRateKbps, earthKmAt, evaluate, sunAuAt, trajectory } from './design';
import { fmtDate, transferTo } from './astro';

/** Deterministic number in [0, 1) from a seed and a label. */
export function draw(seed: number, key: string): number {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < key.length; i++) {
    const ch = key.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return ((h2 >>> 0) * 4294967296 + (h1 >>> 0)) / 18446744073709551616;
}

export type Phase = 'build' | 'launch' | 'cruise' | 'arrival' | 'science' | 'flyby' | 'end';
export interface FlightEvent {
  n: number; // order in which the simulation produced it
  jd: number;
  phase: Phase;
  tone: 'good' | 'warn' | 'bad' | 'info';
  title: string;
  text: string;
}
export interface Cause {
  good: boolean;
  decision: string;
  effect: string;
}
/** A call the flight team has to make while the mission is flying. */
export interface Decision {
  id: string;
  n: number; // events produced before the call was needed
  jd: number;
  phase: Phase;
  console: ConsoleId;
  title: string;
  text: string;
  options: { id: string; label: string; what: string }[];
  chosen: string;
  byPlayer: boolean;
}
export type Calls = Record<string, string>;
export interface ObjectiveResult {
  id: string;
  name: string;
  weight: number;
  achieved: number;
  note: string;
}
export interface Sample {
  jd: number;
  earthKm: number;
  kbps: number;
  storedGb: number;
  sentGb: number;
}
export interface FlightResult {
  seed: number;
  events: FlightEvent[];
  decisions: Decision[];
  causes: Cause[];
  lost: boolean;
  lostWhy: string;
  launched: boolean;
  becameFlyby: boolean;
  arrivedJd: number;
  objectives: ObjectiveResult[];
  sciencePoints: number;
  gb: { made: number; sent: number; dropped: number };
  finalCostM: number;
  overrunM: number;
  opsDaysPlanned: number;
  opsDaysDone: number;
  resolutionM: number;
  samples: Sample[];
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const find = <T extends { id: string }>(list: T[], id: string): T => list.find((x) => x.id === id) ?? list[0];

const fmtRes = (m: number) => (!isFinite(m) ? 'nothing' : m < 1 ? `${Math.max(1, Math.round(m * 100))} cm` : `${m.toFixed(1)} m`);

function imagingQuality(resM: number): number {
  if (!isFinite(resM)) return 0;
  if (resM <= 0.1) return 1;
  if (resM >= 5) return 0.2;
  return 1 - 0.8 * (Math.log(resM / 0.1) / Math.log(50));
}

/**
 * Fly one mission. `calls` holds the choices the players made at in-flight
 * decision points; where a call is missing the flight team's default is used.
 */
export function simulate(d0: Design, seed: number, b0?: Budgets, calls: Calls = {}): FlightResult {
  let d = d0;
  let b = b0 ?? evaluate(d);
  const ev: FlightEvent[] = [];
  const causes: Cause[] = [];
  const decisions: Decision[] = [];
  const say = (jd: number, phase: Phase, tone: FlightEvent['tone'], title: string, text: string) => ev.push({ n: ev.length, jd, phase, tone, title, text });
  const ask = (id: string, jd: number, phase: Phase, console: ConsoleId, title: string, text: string, options: Decision['options'], fallback: string): string => {
    const made = calls[id] !== undefined && options.some((o) => o.id === calls[id]);
    const chosen = made ? calls[id] : fallback;
    decisions.push({ id, n: ev.length, jd, phase, console, title, text, options, chosen, byPlayer: made });
    return chosen;
  };
  const has = (t: string) => d.tests.includes(t);
  const cm = b.klass.failureMult;
  const r = (key: string) => draw(seed, key);
  /**
   * Roll one failure mode. `base` is the chance with no protection, `actual`
   * the chance after the team's choices. Records why it did or did not happen.
   */
  const roll = (key: string, base: number, actual: number, missing: string, saved: string, effect: string): boolean => {
    const u = r(key);
    if (u < actual) {
      causes.push({ good: false, decision: actual < base * 0.99 || !missing ? `Bad luck. This had a ${Math.max(1, Math.round(actual * 100))}% chance even with the precautions taken.` : missing, effect });
      return true;
    }
    if (u < base && saved) causes.push({ good: true, decision: saved, effect: `Avoided: ${effect.charAt(0).toLowerCase()}${effect.slice(1)}` });
    return false;
  };
  const res: FlightResult = {
    seed, events: ev, decisions, causes, lost: false, lostWhy: '', launched: false, becameFlyby: false, arrivedJd: d.arriveJd,
    objectives: [], sciencePoints: 0, gb: { made: 0, sent: 0, dropped: 0 }, finalCostM: b.cost.estimate, overrunM: 0,
    opsDaysPlanned: Math.max(1, b.traj.opsEndJd - b.traj.opsStartJd), opsDaysDone: 0, resolutionM: b.resolutionM, samples: [],
  };
  const finish = () => {
    scoreObjectives();
    return res;
  };
  const lose = (jd: number, phase: Phase, title: string, text: string) => {
    res.lost = true;
    res.lostWhy = title;
    say(jd, phase, 'bad', title, text);
  };

  // ---- state that failures change
  let active = INSTRUMENTS.filter((i) => d.instruments.includes(i.id));
  const quality: Record<string, number> = {};
  for (const i of active) quality[i.id] = 1;
  let powerFactor = 1, gainLossDb = 0, rateFactorDays = 0, pointingDegraded = false, storageFactor = 1;
  let standKm = b.traj.rangeKm;
  const days = { before: 0, during: 0, after: 0 };
  let flybyCoverage = 0;
  let duringKm = standKm; // where the spacecraft watches the Earth flyby from
  let mosaicBlur = 1; // a wide flyby mosaic halves the detail
  let wantedGb = 0, triage = false; // data the instruments would have recorded at full rate
  /** Best picture detail from a given distance, metres per pixel. */
  const detailAt = (km: number, fly: boolean): number => {
    const adcs0 = find(ADCS, d.adcs);
    let best = Infinity;
    for (const c of active.filter((i) => i.ifovUrad)) {
      let x = c.ifovUrad! * 1e-6 * km * 1000;
      if (c.needsPointing && (!adcs0.precise || pointingDegraded)) x *= 3;
      if (fly) x = Math.max(x, 0.15 * b.traj.vinfArr) * mosaicBlur;
      x /= Math.max(0.2, quality[c.id]);
      best = Math.min(best, x);
    }
    return best;
  };

  function scoreObjectives() {
    const adcs = find(ADCS, d.adcs);
    const sentShare = wantedGb > 0 ? clamp01(((triage ? 1.3 : 1) * res.gb.sent) / wantedGb) : 0;
    const has_ = (id: string) => active.some((i) => i.id === id);
    const point = (i: Instrument) => (pointingDegraded ? (i.needsPointing ? 0.5 : 0.85) : 1);
    // best picture detail achieved
    const fly = res.becameFlyby || d.missionType === 'flyby';
    const resM = detailAt(standKm, fly);
    const resDuring = fly ? resM : detailAt(duringKm, false);
    res.resolutionM = fly ? resM : Math.min(resM, days.during > 0 ? resDuring : Infinity);
    for (const id of d.objectives) {
      const o = OBJECTIVES.find((x) => x.id === id)!;
      let q = 0, note = '';
      const limit = (parts: [number, string][]) => {
        let v = 1, worst = 1, why = 'Fully achieved.';
        for (const [x, label] of parts) {
          v *= x;
          if (x < worst) { worst = x; why = label; }
        }
        q = v; note = worst >= 0.97 ? 'Fully achieved.' : why;
      };
      const bestCam = active.filter((i) => i.ifovUrad).sort((a, c2) => a.ifovUrad! - c2.ifovUrad!)[0];
      if (res.gb.made <= 0) { q = 0; note = res.launched ? 'No data was collected.' : 'The mission never flew.'; }
      else if (id === 'shape') {
        const viaLidar = has_('lidar') ? (standKm <= 5 ? 0.9 : 0.6) * quality.lidar : 0;
        const viaCam = bestCam ? imagingQuality(resM) * point(bestCam) : 0;
        const cov = fly ? flybyCoverage : clamp01(days.before / 14);
        limit([[Math.max(viaLidar, viaCam), `Picture detail was ${resM < 1 ? `${Math.round(resM * 100)} cm` : `${resM.toFixed(1)} m`} per pixel.`], [cov, fly ? 'A flyby sees one side, once.' : `Only ${Math.round(days.before)} days of mapping before the flyby.`], [sentShare, `Only ${Math.round(sentShare * 100)}% of the data reached Earth.`]]);
      } else if (id === 'change') {
        if (fly || !bestCam) { q = 0; note = fly ? 'The spacecraft was not there to watch.' : 'No camera.'; }
        else limit([[(0.5 * imagingQuality(resM) + 0.5 * imagingQuality(resDuring)) * point(bestCam), `Picture detail was ${fmtRes(resM)} per pixel before and after, ${fmtRes(resDuring)} during the flyby.`], [clamp01(days.before / 14), `Only ${Math.round(days.before)} days of "before" pictures.`], [clamp01(days.during / 3), 'Missed part of the closest approach.'], [clamp01(days.after / 7), `Only ${Math.round(days.after)} days of "after" pictures.`], [sentShare, `Only ${Math.round(sentShare * 100)}% of the data reached Earth.`]]);
      } else if (id === 'comp') {
        const inst = has_('vnir') ? 1 * quality.vnir : has_('tir') ? 0.7 * quality.tir : 0;
        const cov = fly ? flybyCoverage : clamp01(days.before / 10);
        limit([[inst, has_('vnir') || has_('tir') ? 'The thermal spectrometer alone gives a partial answer.' : 'No spectrometer flew.'], [standKm > 10 && !fly ? 0.8 : 1, 'From 20 km the spectrometer blends large areas together.'], [cov, fly ? 'A flyby sees one side, once.' : `Only ${Math.round(days.before)} days of measurements.`], [sentShare, `Only ${Math.round(sentShare * 100)}% of the data reached Earth.`]]);
      } else if (id === 'inside') {
        let inst = 0, why = 'No radar or lander flew.';
        if (fly) { inst = 0; why = 'A flyby cannot release a CubeSat or lander.'; }
        else {
          if (has_('seis')) {
            const fail = r('lander') < 0.3 * (has('ops') ? 0.7 : 1) * (standKm > 10 ? 1.4 : 1);
            if (fail) { why = 'The lander bounced off and was lost.'; causes.push({ good: false, decision: has('ops') ? 'Bad luck. Landing on a tumbling 340 m rock is hard even when rehearsed.' : 'The landing was never rehearsed, and the lander is new technology.', effect: 'The seismometer lander bounced off Apophis.' }); }
            else inst = Math.max(inst, quality.seis);
          }
          if (has_('radar')) {
            const fail = r('cubesat') < 0.15 * (has('e2e') ? 0.6 : 1);
            if (fail) { if (inst === 0) why = 'The radar CubeSat never answered after release.'; }
            else inst = Math.max(inst, 0.9 * quality.radar * (standKm > 10 ? 0.6 : 1));
          }
        }
        limit([[inst, why], [fly ? 0 : clamp01((days.before + days.during) / 10), 'Too little time to sound the interior.'], [sentShare, `Only ${Math.round(sentShare * 100)}% of the data reached Earth.`]]);
      } else if (id === 'mass') {
        const inst = has_('radio') ? 1 : 0;
        const dist = fly ? 0.08 : standKm <= 1 ? 1 : standKm <= 5 ? 0.85 : 0.5;
        limit([[inst, 'No radio science package.'], [dist, fly ? 'A fast flyby barely feels the asteroid\'s pull.' : 'Farther away, the asteroid\'s pull on the spacecraft is too faint to weigh it well.'], [adcs.precise && !pointingDegraded ? 1 : 0.7, 'Wobbly pointing adds noise to the tracking.'], [fly ? 1 : clamp01(days.before / 21), `Only ${Math.round(days.before)} days of tracking.`]]);
      }
      res.objectives.push({ id, name: o.name, weight: o.weight, achieved: clamp01(q), note });
    }
    res.sciencePoints = res.objectives.reduce((s, o) => s + o.weight * o.achieved, 0);
  }

  // ================= build =================
  const startJd = b.time.readyJd - 60;
  {
    const u = r('cost');
    const newTech = active.filter((i) => i.trl < 7).length;
    const growth = (-0.05 + 0.5 * Math.pow(u, 1.7)) * (1 + 0.15 * newTech);
    res.overrunM = b.cost.estimate * growth;
    res.finalCostM = b.cost.estimate + res.overrunM;
    if (res.overrunM > b.cost.reserve + 0.5) {
      say(startJd, 'build', res.finalCostM > b.cost.cap ? 'bad' : 'warn', `Costs grew ${Math.round(growth * 100)}%`,
        res.finalCostM > b.cost.cap ? `The project ends $${Math.round(res.finalCostM - b.cost.cap)}M over the cap. Headquarters holds a termination review and lets you continue, barely.` : `Growth of $${Math.round(res.overrunM)}M used up the $${Math.round(b.cost.reserve)}M reserve and more, but the total stays under the cap.`);
      causes.push({ good: false, decision: `Cost reserve was set at ${d.reservePct}%.`, effect: `Cost growth of ${Math.round(growth * 100)}% was more than the reserve could absorb.` });
    } else if (res.overrunM > 1) {
      say(startJd, 'build', 'good', `Costs grew ${Math.round(growth * 100)}%, inside reserves`, `The $${Math.round(b.cost.reserve)}M reserve absorbed $${Math.round(res.overrunM)}M of growth.`);
      causes.push({ good: true, decision: `Cost reserve was set at ${d.reservePct}%.`, effect: `Cost growth of ${Math.round(growth * 100)}% was absorbed without touching the cap.` });
    }
    let slack = b.time.slackDays;
    for (const i of [...active]) {
      if (i.trl >= 7) continue;
      if (r(`late-${i.id}`) < 0.35 * (has('tvac') ? 0.7 : 1)) {
        if (slack >= 30) {
          slack -= 30;
          say(startJd + 20, 'build', 'warn', `${i.name} delivered a month late`, 'Schedule slack absorbed the delay.');
          causes.push({ good: true, decision: `The launch date left ${Math.round(b.time.slackDays)} days of slack.`, effect: `${i.name} arrived a month late and still made the flight.` });
        } else {
          active = active.filter((x) => x.id !== i.id);
          say(startJd + 20, 'build', 'bad', `${i.name} was not ready`, 'With no slack left, the spacecraft shipped without it.');
          causes.push({ good: false, decision: `New technology (readiness level ${i.trl}) with only ${Math.round(Math.max(0, b.time.slackDays))} days of schedule slack.`, effect: `${i.name} missed the launch and was left behind.` });
        }
      }
    }
  }

  // ================= launch =================
  let launchJd = d.launchJd;
  if (!b.traj.ok || b.mass.margin < 0 || !b.mass.feasible || b.time.slackDays < 0) {
    lose(launchJd, 'launch', 'Never left the ground', !b.traj.ok ? 'There was no valid trajectory.' : b.time.slackDays < 0 ? 'The spacecraft was not finished when the launch window closed.' : 'The spacecraft was too heavy for its rocket.');
    causes.push({ good: false, decision: 'The team voted GO with a red finding still open.', effect: 'The mission could not launch.' });
    return finish();
  }
  /** Find a path after a launch delay: the planned arrival first, then later ones, then a flyby. */
  const replan = (slip: number): { arr: number; flyby: boolean } | null => {
    const tryDates = (arr: number) => {
      const t = transferTo(APOPHIS.elements, d.launchJd + slip, arr);
      if (!t) return null;
      const okMass = rocketCapacityKg(b.rocket, t.c3) >= b.mass.wet;
      const okDv = d.missionType === 'flyby' || t.vinfArr + b.traj.dvOps <= b.traj.dvTotal;
      return { t, okMass, okDv };
    };
    for (let arr = d.arriveJd; arr <= LAST_ARRIVAL_JD; arr += 3) {
      const x = tryDates(arr);
      if (x && x.okMass && x.okDv) return { arr, flyby: false };
    }
    for (let arr = d.arriveJd; arr <= LAST_ARRIVAL_JD; arr += 3) {
      const x = tryDates(arr);
      if (x && x.okMass) return { arr, flyby: true };
    }
    return null;
  };
  /** Launch `slip` days late on the path found by replan. */
  const applySlip = (slip: number, fix: { arr: number; flyby: boolean }, who: string, risky: string) => {
    launchJd = d.launchJd + slip;
    const wasFlyby = d.missionType === 'flyby';
    d = { ...d, launchJd, arriveJd: fix.arr };
    const bb = evaluate(d);
    b = { ...bb, mass: b.mass, cost: b.cost, time: b.time };
    res.arrivedJd = fix.arr;
    res.opsDaysPlanned = Math.max(1, b.traj.opsEndJd - b.traj.opsStartJd);
    if (fix.flyby && !wasFlyby) {
      res.becameFlyby = true;
      say(launchJd, 'launch', 'bad', `Launch slipped ${slip} days`, 'The later path arrives too fast to brake with the propellant on board. The mission becomes a flyby.');
      causes.push({ good: false, decision: risky, effect: 'The delayed launch left too little propellant to stop at Apophis.' });
    } else {
      say(launchJd, 'launch', 'warn', `Launch slipped ${slip} days`, `${who} Margins covered a new path arriving ${fmtDate(fix.arr)}.`);
      causes.push({ good: true, decision: 'Mass and propellant margins were kept in hand.', effect: `A ${slip}-day launch slip was absorbed.` });
    }
  };
  if (b.rocket.shared && r('share-slip') < 0.3) {
    const slip = Math.round(20 + 40 * r('share-days'));
    const fix = replan(slip);
    if (!fix) {
      lose(d.launchJd + slip, 'launch', 'Missed the window', `The main passenger slipped ${slip} days. By then no path to Apophis fit the rocket.`);
      causes.push({ good: false, decision: 'A shared ride with thin mass and propellant margins.', effect: `A ${slip}-day delay by the main passenger closed the launch window.` });
      return finish();
    }
    applySlip(slip, fix, 'The main passenger was late.', 'A shared ride, with propellant sized for the original dates only.');
  }
  if (!b.rocket.shared && r('wx') < 0.35) {
    // Launch-day weather: the first call the team makes for real.
    const fix = replan(3);
    const stops = d.missionType !== 'flyby';
    const holdWhat = !fix ? 'No path to Apophis fits this rocket three days from now. The mission would be over.'
      : fix.flyby && stops ? 'Three days from now the trip needs more braking than the tanks hold. The mission would become a flyby.'
      : fix.arr !== d.arriveJd ? `Your margins cover it, with arrival moved to ${fmtDate(fix.arr)}.` : 'Your mass and propellant margins cover a three-day slip.';
    const pick = ask('wx', launchJd - 0.2, 'launch', 'design', 'Winds aloft are at the limit',
      `Weather balloons show strong wind shear 12 km above the pad. The rocket is fuelled and the count is holding at T minus 10 minutes. The next opening is in three days.`,
      [{ id: 'hold', label: 'NO-GO. Hold three days', what: holdWhat },
        { id: 'go', label: 'GO. Launch today', what: 'About one chance in eight that wind shear breaks up the rocket. (Game value.)' }],
      fix && !(fix.flyby && stops) ? 'hold' : 'go');
    if (pick === 'go') {
      if (r('wx-fail') < 0.125) {
        lose(launchJd, 'launch', 'Launch failure', `${b.rocket.name} broke up in wind shear 70 seconds after liftoff.`);
        causes.push({ good: false, decision: 'The team called GO with winds at the limit.', effect: 'The rocket broke up in wind shear.' });
        return finish();
      }
      causes.push({ good: true, decision: 'The team called GO with winds at the limit. One time in eight that ends the mission on the pad.', effect: 'Launched on the planned day through marginal winds.' });
    } else if (!fix) {
      lose(d.launchJd + 3, 'launch', 'Missed the window', 'The team held for weather. Three days later no path to Apophis fit the rocket.');
      causes.push({ good: false, decision: 'Mass and propellant margins were too thin to move the launch by even three days.', effect: 'A weather hold closed the launch window.' });
      return finish();
    } else {
      if (r('wx-fail') < 0.125) causes.push({ good: true, decision: 'The team called NO-GO with winds at the limit.', effect: 'Avoided: the rocket would have broken up in wind shear.' });
      applySlip(3, fix, 'The team held for weather.', 'Propellant was sized for the original dates only, with nothing spare for a weather hold.');
    }
  }
  if (roll('launch', b.rocket.failure, b.rocket.failure, `${b.rocket.name} fails about ${Math.round(b.rocket.failure * 100)}% of the time. Only a different rocket changes that.`, '', 'The rocket failed during ascent.')) {
    lose(launchJd, 'launch', 'Launch failure', `${b.rocket.name} did not reach escape. The spacecraft was lost.`);
    return finish();
  }
  res.launched = true;
  say(launchJd, 'launch', 'good', 'Liftoff', `${b.rocket.name} threw ${Math.round(b.mass.wet)} kg toward Apophis with a launch energy of ${b.traj.c3.toFixed(1)} km²/s².`);

  // ================= cruise =================
  const tof = d.arriveJd - launchJd;
  if (roll('deploy-array', 0.06 * cm, 0.06 * cm * (has('vibe') ? 0.3 : 1), 'No shake test was bought.', 'The shake test found a sticky panel hinge on the ground.', 'A solar panel jammed half open.')) {
    powerFactor = 0.55;
    say(launchJd + 0.5, 'cruise', 'bad', 'Solar panel jammed', 'One wing is stuck half open. Power is down by almost half for the whole mission.');
  }
  if (d.antenna.startsWith('hga') && roll('deploy-dish', 0.04 * cm, 0.04 * cm * (has('vibe') ? 0.3 : 1), 'No shake test was bought.', 'The shake test showed the dish release pins needed more force.', 'The dish did not open fully.')) {
    gainLossDb = 10;
    say(launchJd + 2, 'cruise', 'bad', 'Dish stuck', 'The antenna did not open fully, as on Galileo in 1991. Data rate drops tenfold.');
  }
  if (active.length && roll('thermal', 0.05 * cm, 0.05 * cm * (has('tvac') ? 0.3 : 1), 'No thermal vacuum test was bought.', 'Thermal vacuum testing exposed a lens mount that shifted in the cold.', 'An instrument drifted out of focus in the cold.')) {
    const pick = active[Math.floor(r('thermal-pick') * active.length)];
    quality[pick.id] = 0.5;
    say(launchJd + tof * 0.2, 'cruise', 'warn', `${pick.name} degraded`, 'First-light checks show it shifted in the cold of deep space. It works at half quality.');
  }
  let arrivalDelay = 0;
  if (roll('sw', 0.12 * cm, 0.12 * cm * (has('e2e') ? 0.35 : 1), 'The flight software was never run end to end on the real hardware.', 'The test-as-you-fly campaign found a command that would have rebooted the computer.', 'A software fault put the spacecraft in safe mode.')) {
    const near = r('sw-when') > 0.8;
    say(launchJd + tof * (near ? 0.93 : 0.5), 'cruise', 'warn', 'Safe mode', near ? 'A fault days before arrival forced a rushed re-plan. Arrival slips 8 days.' : 'The spacecraft shut down non-essentials and called home. The team recovered it in 9 days.');
    if (near) arrivalDelay += 8;
  }
  if (roll('radio', 0.05 * cm, 0.05 * cm * (has('dsn') ? 0.3 : 1), 'The radio was never tested against the Deep Space Network.', 'The network compatibility test caught a wrong coding setting.', 'The ground could not decode the high-rate signal.')) {
    rateFactorDays = 20;
    say(launchJd + tof * 0.3, 'cruise', 'warn', 'High-rate link failed', 'The ground cannot decode the fast mode. Data runs at half rate until a patch arrives.');
  }
  const stormHit = (jd: number, key: string, phase: Phase) => {
    if (d.redundancy === 'single' && r(`${key}-dmg`) < 0.15 * cm) {
      storageFactor *= 0.5;
      say(jd, phase, 'bad', 'Solar storm damage', 'Charged particles from a solar flare killed half the recorder. There was no spare.');
      causes.push({ good: false, decision: 'Single-string electronics, with no spare recorder.', effect: 'A solar storm destroyed half the data storage.' });
    } else {
      say(jd, phase, 'info', 'Solar storm', d.redundancy === 'single' ? 'A flare raised radiation levels. The spacecraft rode it out in safe mode.' : 'A flare upset one computer. The spare took over within seconds.');
    }
  };
  const nStorm = Math.floor(r('storm-n') * 1.6 * (tof / 365) + r('storm-n2'));
  for (let k = 0; k < Math.min(2, nStorm); k++) stormHit(launchJd + tof * r(`storm-t${k}`), `storm-c${k}`, 'cruise');

  // ================= arrival =================
  const redRisk = d.redundancy === 'single' ? 1 : d.redundancy === 'selective' ? 0.7 : 0.4;
  const adcs = find(ADCS, d.adcs);
  let arriveJd = d.arriveJd + arrivalDelay;
  if (d.missionType === 'rendezvous' && !res.becameFlyby) {
    const base = 0.07 * cm;
    const actual = base * (has('fire') ? 0.4 : 1) * (has('ops') ? 0.6 : 1) * redRisk;
    const missing = !has('fire') ? 'The engine was never hot-fired on the ground.' : !has('ops') ? 'The arrival was never rehearsed.' : '';
    if (roll('burn', base, actual, missing, has('fire') ? 'The hot-fire test found a slow valve, replaced before launch.' : 'Rehearsals caught a wrong burn direction in the plan.', 'The braking burn cut off early.')) {
      if (d.redundancy !== 'single' || r('burn-luck') < 0.3) {
        arriveJd += 9;
        say(arriveJd - 9, 'arrival', 'warn', 'Braking burn cut short', d.redundancy !== 'single' ? 'A valve stuck. The backup string finished the burn 9 days later.' : 'A valve stuck, then freed itself. A second attempt 9 days later worked.');
      } else {
        res.becameFlyby = true;
        say(arriveJd, 'arrival', 'bad', 'Could not stop', `The engine quit mid-burn with no backup. The spacecraft sails past Apophis at ${b.traj.vinfArr.toFixed(1)} km/s.`);
        causes.push({ good: false, decision: 'Single-string propulsion on a mission that must brake to succeed.', effect: 'One stuck valve turned a rendezvous into a flyby.' });
      }
    }
    if (!res.becameFlyby) say(arriveJd, 'arrival', 'good', 'Arrived at Apophis', `Speed matched after a ${(b.traj.dvArrive * 1000).toFixed(0)} m/s burn. The asteroid is a tumbling dot ${Math.round(standKm)} km away.`);
  }
  res.arrivedJd = arriveJd;
  const radio = find(RADIOS, d.radio), antenna = find(ANTENNAS, d.antenna), storage = find(STORAGES, d.storage);
  const busW = b.power.science - active.reduce((s, i) => s + i.powerW, 0) - 0; // science load without instruments (approx.)
  const payloadW = Math.max(1, active.reduce((s, i) => s + i.powerW, 0));
  const rateAt = (jd: number, dayIndex: number) =>
    dataRateKbps(radio.rfW, antenna.gainDb - gainLossDb, Math.max(60000, earthKmAt(jd)), radio.maxMbps) * (dayIndex < rateFactorDays ? 0.5 : 1);
  const dutyAt = (jd: number) => {
    const sun = sunAuAt(jd);
    const avail = b.arrayM2 * (ARRAY.wPerM2At1Au / (sun * sun)) * 0.92 * powerFactor;
    return clamp01(Math.max(powerFactor < 1 ? 0.1 : 0, (avail - busW) / payloadW));
  };
  let stored = 0;
  const cap = () => storage.gb * storageFactor;

  if (res.becameFlyby || d.missionType === 'flyby') {
    // ---------- fast flyby ----------
    const pass = find(FLYBY_PASSES, res.becameFlyby ? 'far' : d.standoff);
    standKm = pass.km;
    const v = Math.max(0.3, b.traj.vinfArr);
    let aim = 1;
    const baseAim = pass.risk * cm * 3;
    const actualAim = baseAim * (adcs.precise ? 0.5 : 1) * (has('ops') ? 0.6 : 1);
    let wide = false;
    if (!res.becameFlyby) {
      const pick = ask('mosaic', arriveJd - 2, 'arrival', 'science', 'Plan the flyby pictures',
        `Apophis is still a dot. Its position along the track is uncertain by a few seconds of flight, and at ${v.toFixed(1)} km/s the close pass at ${Math.round(pass.km)} km is over in minutes.`,
        [{ id: 'narrow', label: 'Narrow strip, full detail', what: `Best detail. About ${Math.max(1, Math.round(actualAim * 100))}% chance the cameras stare at empty sky during the closest minutes.` },
          { id: 'wide', label: 'Wide mosaic, half the detail', what: 'Sweep a wide patch of sky so Apophis is sure to be in frame. Every picture has half the detail.' }], 'narrow');
      wide = pick === 'wide';
      if (wide) {
        mosaicBlur = 2;
        if (r('aim') < actualAim) causes.push({ good: true, decision: 'The team chose a wide mosaic for the flyby.', effect: 'Avoided: a narrow strip would have missed Apophis at closest approach.' });
        else causes.push({ good: false, decision: 'The team chose a wide mosaic for the flyby.', effect: 'Every flyby picture has half the detail a narrow strip would have given.' });
      }
    }
    if (!res.becameFlyby && !wide && roll('aim', baseAim, actualAim, !adcs.precise ? 'Basic pointing on a close, fast pass.' : 'The flyby sequence was never rehearsed.', 'Rehearsals caught a timing error in the flyby sequence.', 'The cameras pointed at empty sky during the closest minutes.')) {
      aim = 0.25;
      say(arriveJd, 'arrival', 'bad', 'Pointing error at closest approach', 'The timing was off by seconds. Most frames show black sky.');
    }
    const hours = Math.min(12, (2 * 20000) / v / 3600);
    const duty = dutyAt(arriveJd);
    const made = (active.reduce((s, i) => s + i.dataMbPerHour, 0) * hours * duty) / 1000;
    const kept = Math.min(made, cap());
    res.gb.made = made;
    wantedGb = made;
    res.gb.dropped = made - kept;
    const perDay = (rateAt(arriveJd, 99) * d.dsnHoursPerDay * 3600) / 1e6;
    res.gb.sent = Math.min(kept, perDay * 30);
    flybyCoverage = 0.7 * aim * (res.becameFlyby ? 0.6 : 1);
    res.opsDaysDone = res.becameFlyby ? res.opsDaysPlanned * 0.05 : res.opsDaysPlanned;
    for (let k = 0; k <= 10; k++) res.samples.push({ jd: arriveJd + k * 3, earthKm: earthKmAt(arriveJd + k * 3), kbps: rateAt(arriveJd + k * 3, 99), storedGb: Math.max(0, kept - perDay * k * 3), sentGb: Math.min(kept, perDay * k * 3) });
    say(arriveJd, 'flyby', aim === 1 ? 'good' : 'warn', `Flyby at ${Math.round(pass.km)} km`, `Apophis swept past at ${v.toFixed(1)} km/s. ${made.toFixed(1)} Gb recorded in ${hours.toFixed(1)} hours; playback takes ${Math.ceil(kept / Math.max(0.01, perDay))} days.`);
    say(arriveJd + 30, 'end', 'info', 'Playback complete', `${res.gb.sent.toFixed(1)} Gb reached Earth.`);
    return finish();
  }

  // ---------- rendezvous operations, one day at a time ----------
  const stand0 = find(STANDOFFS, d.standoff);
  const opsStart = arriveJd + 7, opsEnd = APOPHIS.flybyJd + 30;
  const total = Math.max(1, Math.round(opsEnd - opsStart));
  let safeUntil = -1, alive = true, announcedFlyby = false, wheelOut = false, navDone = false;
  let watchAsked = false, recAsked = false, extraDsn = 0, genFactor = 1;
  const debrisRisk = (km: number) => (km <= 1 ? 0.1 : km <= 5 ? 0.03 : 0.005) * cm;
  const navBase = stand0.risk * cm;
  const navActual = navBase * (adcs.precise ? 0.5 : 1) * (has('ops') ? 0.6 : 1);
  const navDay = Math.floor(r('nav-day') * total);
  const stormDays = [Math.floor(r('ops-storm-a') * total * 3), Math.floor(r('ops-storm-b') * total * 8)];
  const wheelDay = r('wheel') < 0.1 * cm * (adcs.wheels >= 4 ? 0.15 : 1) ? Math.floor(r('wheel-day') * total) : -1;
  if (wheelDay < 0 && r('wheel') < 0.1 * cm && adcs.wheels >= 4) causes.push({ good: true, decision: 'Precise pointing carries a fourth, spare wheel.', effect: 'Avoided: a wheel failure that would have blurred every picture.' });
  for (let k = 0; k < total && alive; k++) {
    const jd = opsStart + k;
    const seg: 'before' | 'during' | 'after' = jd < APOPHIS.flybyJd - 1.5 ? 'before' : jd <= APOPHIS.flybyJd + 1.5 ? 'during' : 'after';
    if (!watchAsked && jd >= APOPHIS.flybyJd - 5) {
      watchAsked = true;
      if (seg === 'before' && active.length > 0) {
        const now = standKm <= 1 ? 1 : standKm <= 5 ? 5 : 20;
        const pick = ask('watch', jd, 'science', 'science', 'Where to watch the flyby from',
          `In five days Earth's gravity will stretch and shake Apophis. It may shed dust and boulders, and nobody knows how much. The spacecraft is ${Math.round(standKm)} km away.`,
          [20, 5, 1].map((km) => ({
            id: `w${km}`, label: `${km === now ? 'Stay at' : km > now ? 'Back off to' : 'Move in to'} ${km} km`,
            what: `${isFinite(detailAt(km, false)) ? `Pictures show ${fmtRes(detailAt(km, false))} per pixel. ` : ''}About ${debrisRisk(km) * 100 < 1 ? 'a 1 in 200' : `${Math.round(debrisRisk(km) * 100)}%`} chance of a debris strike. (Game value.)`,
          })), `w${now}`);
        duringKm = Number(pick.slice(1));
      }
    }
    if (seg === 'during' && !announcedFlyby) {
      announcedFlyby = true;
      say(APOPHIS.flybyJd, 'flyby', 'good', 'Earth flyby', `Apophis passes inside the ring of geostationary satellites. Earth's gravity tugs at its surface and twists its spin. You are there, ${Math.round(duringKm)} km away.`);
      const u = r('debris');
      if (u < debrisRisk(duringKm)) {
        const cams = active.filter((i) => i.ifovUrad);
        if (r('debris-kill') < 0.35) {
          alive = false;
          lose(APOPHIS.flybyJd + 0.2, 'flyby', 'Struck by debris', `A boulder shaken loose from Apophis hit the spacecraft ${Math.round(duringKm)} km out. Contact was lost.`);
          causes.push({ good: false, decision: `The team watched the flyby from ${Math.round(duringKm)} km.`, effect: 'Debris shed by Apophis destroyed the spacecraft.' });
          break;
        }
        if (cams.length) quality[cams[0].id] *= 0.5;
        say(APOPHIS.flybyJd + 0.2, 'flyby', 'bad', 'Hit by dust', `Grit from Apophis sandblasted the spacecraft ${Math.round(duringKm)} km out.${cams.length ? ` ${cams[0].name} lost half its sharpness.` : ''}`);
        causes.push({ good: false, decision: `The team watched the flyby from ${Math.round(duringKm)} km.`, effect: 'Dust shed by Apophis damaged the optics.' });
      } else if (duringKm > 1 && u < debrisRisk(1)) {
        causes.push({ good: true, decision: `The team watched the flyby from ${Math.round(duringKm)} km.`, effect: 'Avoided: debris from Apophis swept through the 1 km hover point.' });
      }
    }
    if (k === wheelDay && !wheelOut) {
      wheelOut = true; pointingDegraded = true;
      say(jd, 'science', 'bad', 'Reaction wheel failed', 'With three wheels and no spare, pointing now wobbles. Pictures blur and tracking gets noisy.');
      causes.push({ good: false, decision: 'Basic pointing has three wheels and no spare.', effect: 'One wheel failure degraded pointing for the rest of the mission.' });
    }
    if (stormDays.includes(k)) {
      const dmg = (d.redundancy === 'single' ? 0.3 : d.redundancy === 'selective' ? 0.1 : 0.03) * cm;
      const pick = ask(`storm-${k}`, jd, 'science', 'craft', 'Solar storm warning',
        `Forecasters see a strong flare heading for the spacecraft${seg === 'during' ? ', just as Apophis passes Earth' : ''}. It arrives within hours.`,
        [{ id: 'safe', label: 'Shelter for three days', what: 'Instruments off, electronics in their safest state. No damage. Three days of observations lost.' },
          { id: 'ride', label: 'Keep observing', what: `No days lost. About ${Math.max(1, Math.round(dmg * 100))}% chance of lasting damage with ${REDUNDANCY[d.redundancy].name.toLowerCase()}. (Game value.)` }], 'safe');
      if (pick === 'safe') {
        safeUntil = k + 3;
        say(jd, 'science', 'info', 'Sheltered from a solar storm', 'Instruments were off for three days. Nothing was damaged.');
        if (r(`ops-storm-${k}-dmg`) < dmg) causes.push({ good: true, decision: 'The team sheltered from a solar storm.', effect: 'Avoided: radiation damage to the recorder and an instrument.' });
      } else if (r(`ops-storm-${k}-dmg`) < dmg) {
        storageFactor *= 0.5;
        const hit = active.length ? active[Math.floor(r(`ops-storm-${k}-pick`) * active.length)] : null;
        if (hit) quality[hit.id] *= 0.6;
        say(jd, 'science', 'bad', 'Solar storm damage', `Charged particles killed half the recorder${hit ? ` and degraded the ${hit.name.toLowerCase()}` : ''}.`);
        causes.push({ good: false, decision: `The team kept observing through a solar storm with ${REDUNDANCY[d.redundancy].name.toLowerCase()}.`, effect: 'Radiation destroyed half the data storage and degraded an instrument.' });
      } else {
        say(jd, 'science', 'good', 'Rode out a solar storm', 'The team kept observing. Radiation levels rose and nothing broke.');
        causes.push({ good: true, decision: 'The team kept observing through a solar storm.', effect: 'Kept three days of observations that sheltering would have cost.' });
      }
    }
    if (k === navDay && !navDone) {
      navDone = true;
      if (roll('nav', navBase, navActual, !adcs.precise ? `Basic pointing while flying ${stand0.km} km from the surface.` : 'Close operations were never rehearsed.', 'Rehearsals taught the team to spot a drifting hover early.', 'Navigation lost track of the asteroid.')) {
        if (stand0.id === 'close' && r('nav-crash') < 0.3) {
          alive = false;
          lose(jd, 'science', 'Struck the asteroid', 'A navigation error at 1 km left no time to react. Contact was lost.');
          break;
        }
        standKm = 20; safeUntil = k + 6;
        say(jd, 'science', 'warn', 'Emergency retreat', 'The spacecraft lost its lock on Apophis and backed away to 20 km on its own. Six days lost, and the team keeps its distance from now on.');
      }
    }
    const working = k >= safeUntil;
    const duty = working ? dutyAt(jd) : 0;
    const full = (active.reduce((s, i) => s + i.dataMbPerHour, 0) * SCIENCE_HOURS_PER_DAY * duty * (seg === 'during' ? 2 : 1)) / 1000;
    const kbps = rateAt(jd, k);
    if (!recAsked && working && stored > 0.85 * cap() && k < total - 10 && full > (kbps * d.dsnHoursPerDay * 3600) / 1e6) {
      recAsked = true;
      const left = total - k;
      const extraCost = (4 * left * DSN.costPerHourK * 5) / 1000;
      const pick = ask('recorder', jd, 'science', 'comms', 'The recorder is almost full',
        `Instruments record ${full.toFixed(1)} Gb a day and the link sends ${((kbps * d.dsnHoursPerDay * 3600) / 1e6).toFixed(1)} Gb. The ${storage.gb} Gb recorder is ${Math.round((100 * stored) / cap())}% full with ${left} days to go.`,
        [{ id: 'dsn', label: 'Buy emergency network time', what: `Four more hours a day until the end. Short-notice time on a crowded network costs five times the usual rate: $${extraCost.toFixed(1)}M. (Game value.)` },
          { id: 'triage', label: 'Record less, keep the best', what: 'Instruments drop to 60% of their data rate and the science team chooses what matters most.' },
          { id: 'none', label: 'Change nothing', what: 'When the recorder fills, it overwrites its oldest data.' }], 'none');
      if (pick === 'dsn') {
        extraDsn = 4;
        res.finalCostM += extraCost;
        say(jd, 'science', 'info', 'Emergency network time bought', `Four extra hours a day for $${extraCost.toFixed(1)}M.`);
        causes.push({ good: res.finalCostM <= b.cost.cap, decision: `The team bought emergency network time for $${extraCost.toFixed(1)}M.`, effect: res.finalCostM <= b.cost.cap ? 'The recorder stopped filling and the bill stayed under the cap.' : 'The recorder stopped filling, but the bill went over the cap.' });
      } else if (pick === 'triage') {
        genFactor = 0.6; triage = true;
        say(jd, 'science', 'info', 'Science team rations data', 'Instruments now record 60% of their full rate, best targets first.');
        causes.push({ good: true, decision: 'The team rationed data when the recorder filled.', effect: 'Less was recorded, but what mattered most reached Earth.' });
      }
    }
    const made = full * genFactor;
    const down = (kbps * (d.dsnHoursPerDay + extraDsn) * 3600) / 1e6;
    stored += made; res.gb.made += made; wantedGb += full;
    const sent = Math.min(stored, down);
    stored -= sent; res.gb.sent += sent;
    if (stored > cap()) { res.gb.dropped += stored - cap(); stored = cap(); }
    if (working) { days[seg] += duty; res.opsDaysDone += 1; }
    if (k % 3 === 0 || seg === 'during') res.samples.push({ jd, earthKm: earthKmAt(jd), kbps, storedGb: stored, sentGb: res.gb.sent });
  }
  if (alive) {
    const lastRate = (rateAt(opsEnd, 999) * (d.dsnHoursPerDay + extraDsn) * 3600) / 1e6;
    const tail = Math.min(stored, lastRate * 30);
    res.gb.sent += tail;
    if (dutyAt(opsStart + 5) < 0.95 && powerFactor === 1) causes.push({ good: false, decision: 'The solar panels were sized below the full science load.', effect: 'Instruments had to take turns, which cut the data collected.' });
    if (res.gb.dropped > 0.05 * res.gb.made) causes.push({ good: false, decision: `A ${antenna.name.toLowerCase()} with a ${radio.name.toLowerCase()}, ${d.dsnHoursPerDay + extraDsn} network hours a day and a ${storage.gb} Gb recorder.`, effect: `${Math.round((100 * res.gb.dropped) / res.gb.made)}% of the data was overwritten before it could be sent.` });
    else if (res.gb.made > 0) causes.push({ good: true, decision: 'Downlink and recorder were sized to the instruments.', effect: 'Almost all recorded data reached Earth.' });
    say(opsEnd, 'end', 'info', 'End of mission', `${res.gb.sent.toFixed(0)} Gb reached Earth out of ${res.gb.made.toFixed(0)} Gb recorded.`);
  }
  return finish();
}

// ---------------------------------------------------------------- scoring
export interface GateRecord {
  gate: string;
  votes: { console: string; vote: 'go' | 'nogo'; by: 'player' | 'auto'; reason: string }[];
  redOpen: number;
  amberOpen: number;
  overrides: number; // NO-GO votes that were overruled
}
export interface Score {
  science: number;
  performance: number;
  efficiency: number;
  decisions: number;
  teamwork: number;
  total: number;
  notes: Record<string, string>;
}
export function scoreFlight(res: FlightResult, b: Budgets, gates: GateRecord[], odds: number | null, players: number): Score {
  const notes: Record<string, string> = {};
  const science = 40 * Math.min(1, res.sciencePoints / b.klass.scienceTarget);
  notes.science = `${res.sciencePoints.toFixed(0)} science points against the ${b.klass.name} target of ${b.klass.scienceTarget}.`;
  const arrivedAsPlanned = res.launched && !res.becameFlyby && !res.lost;
  const performance = (res.launched ? 4 : 0) + (arrivedAsPlanned ? 6 : res.becameFlyby ? 2 : 0) + (res.launched && !res.lost ? 4 : 0) + 6 * Math.min(1, res.opsDaysDone / res.opsDaysPlanned);
  notes.performance = !res.launched ? 'The mission never flew.' : res.lost ? `Lost: ${res.lostWhy.toLowerCase()}.` : res.becameFlyby ? 'Reached Apophis but could not stay.' : `Operated ${Math.round(res.opsDaysDone)} of ${Math.round(res.opsDaysPlanned)} planned days.`;
  let efficiency = 20;
  const over = Math.max(0, res.finalCostM - b.cost.cap) / b.cost.cap;
  efficiency -= Math.min(12, 40 * over);
  if (b.cheaperRocket) efficiency -= 3;
  if (b.power.margin > 1.5) efficiency -= 2;
  if (b.data.genGbDay > 0 && b.data.downGbDayWorst > 6 * b.data.genGbDay) efficiency -= 2;
  if (res.lost || !res.launched) efficiency *= 0.5;
  efficiency = Math.max(0, efficiency);
  notes.efficiency = over > 0 ? `Finished $${Math.round(res.finalCostM - b.cost.cap)}M over the cap.` : b.cheaperRocket ? 'Under the cap, but a cheaper rocket would have done.' : `Finished at $${Math.round(res.finalCostM)}M against a $${b.cost.cap}M cap.`;
  const last = gates[gates.length - 1];
  const reds = gates.reduce((s, g) => s + g.redOpen, 0);
  let decisions = 10 - 2.5 * reds - Math.min(4, 0.75 * (last ? last.amberOpen : 0));
  decisions -= odds === null ? 2 : odds < 0.5 ? 3 : odds < 0.7 ? 1.5 : 0;
  decisions = Math.max(0, decisions);
  notes.decisions = reds > 0 ? `${reds} red finding${reds > 1 ? 's were' : ' was'} waved through a gate.` : odds === null ? 'Launched without flying the 1,000 simulated flights of this design first.' : odds < 0.7 ? `Launched knowing only ${Math.round(odds * 100)}% of simulated flights succeeded.` : last && last.amberOpen > 0 ? `${last.amberOpen} amber finding${last.amberOpen > 1 ? 's' : ''} still open at launch.` : 'Every gate was passed with findings closed.';
  const overrides = gates.reduce((s, g) => s + g.overrides, 0);
  const playerVotes = gates.flatMap((g) => g.votes.filter((v) => v.by === 'player'));
  const withReason = playerVotes.length ? playerVotes.filter((v) => v.reason.trim().length > 2).length / playerVotes.length : 0;
  const teamwork = players <= 1 ? Math.max(0, 6 + (overrides === 0 ? 4 : 4 - 2 * overrides)) : Math.max(0, 10 * (0.4 + 0.3 * withReason + 0.3 * (overrides === 0 ? 1 : 0.4)));
  notes.teamwork = overrides > 0 ? `${overrides} NO-GO call${overrides > 1 ? 's were' : ' was'} overruled.` : players > 1 ? `${Math.round(withReason * 100)}% of votes came with a reason.` : 'No console was overruled.';
  const total = science + performance + efficiency + decisions + teamwork;
  return { science, performance, efficiency, decisions, teamwork, total, notes };
}

// ---------------------------------------------------------------- 1,000 flights
export interface McResult {
  n: number;
  survive: number; // share of flights not lost
  success: number; // share that also reached half the class science target
  meanScience: number; // mean science points
  hist: number[]; // 10 bins of science points / target
  problems: { title: string; share: number }[];
  costConfidence: number; // share of flights that finished under the cap
  costCurve: { costM: number; share: number }[]; // cumulative curve for the 70% rule
  cost70: number;
}
export function monteCarlo(d: Design, n = 1000, baseSeed = 20290413): McResult {
  const b = evaluate(d);
  const hist = new Array(10).fill(0);
  const counts = new Map<string, number>();
  let survive = 0, success = 0, sum = 0, under = 0;
  const costs: number[] = [];
  for (let k = 0; k < n; k++) {
    const res = simulate(d, baseSeed + k * 7919, b);
    if (!res.lost) survive++;
    const frac = res.sciencePoints / b.klass.scienceTarget;
    if (!res.lost && frac >= 0.5) success++;
    sum += res.sciencePoints;
    hist[Math.min(9, Math.floor(Math.min(0.999, frac) * 10))]++;
    if (res.finalCostM <= b.cost.cap) under++;
    costs.push(res.finalCostM);
    for (const e of res.events) {
      if (e.tone !== 'bad') continue;
      const key = e.title.replace(/[\d.]+%?/g, '').replace(/\s+/g, ' ').replace(' days', '').trim();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  costs.sort((x, y) => x - y);
  const costCurve = [5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95].map((p) => ({ costM: costs[Math.min(n - 1, Math.floor((p / 100) * n))], share: p / 100 }));
  const problems = [...counts.entries()].map(([title, c]) => ({ title, share: c / n })).sort((x, y) => y.share - x.share).slice(0, 5);
  return { n, survive: survive / n, success: success / n, meanScience: sum / n, hist: hist.map((h) => h / n), problems, costConfidence: under / n, costCurve, cost70: costs[Math.floor(0.7 * n)] };
}
export { trajectory };
