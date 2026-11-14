// Ice Hunter: operations in a polar orbit of the Moon. The build, launch,
// cruise and capture burn are shared with the Apophis missions in flight.ts;
// this file flies the mapping phase day by day and scores the science.
import type { Budgets, ConsoleId, Design } from './design';
import type { Cause, Decision, FlightEvent, FlightResult, Phase } from './flight';
import { ADCS, ANTENNAS, ARRAY, BATTERIES, DSN, Instrument, MOON, MOON_OBJECTIVES, MOON_ORBITS, RADIOS, REDUNDANCY, STORAGES } from './data';
import { MU_MOON, R_MOON, maxEclipseFraction, orbitPeriodS } from './astro';
import { SCIENCE_HOURS_PER_DAY, dataRateKbps } from './design';

export interface MoonCtx {
  d: Design;
  b: Budgets;
  res: FlightResult;
  causes: Cause[];
  cm: number; // failure multiplier of the mission class
  arriveJd: number;
  active: Instrument[];
  quality: Record<string, number>;
  powerFactor: number;
  gainLossDb: number;
  rateFactorDays: number;
  storageFactor: number;
  dvPenalty: number; // km/s spent cleaning up a rough capture burn
  r: (key: string) => number;
  has: (test: string) => boolean;
  say: (jd: number, phase: Phase, tone: FlightEvent['tone'], title: string, text: string) => void;
  ask: (id: string, jd: number, phase: Phase, console: ConsoleId, title: string, text: string, options: Decision['options'], fallback: string) => string;
  roll: (key: string, base: number, actual: number, missing: string, saved: string, effect: string) => boolean;
  lose: (jd: number, phase: Phase, title: string, text: string) => void;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const find = <T extends { id: string }>(list: T[], id: string): T => list.find((x) => x.id === id) ?? list[0];
const wh = (x: number) => Math.round(x).toLocaleString('en-US');

/** How well a camera resolves the ground, 0 to 1. Same curve as the asteroid missions. */
function imagingQuality(resM: number): number {
  if (!isFinite(resM)) return 0;
  if (resM <= 0.1) return 1;
  if (resM >= 5) return 0.2;
  return 1 - 0.8 * (Math.log(resM / 0.1) / Math.log(50));
}

/** Night on each lap of a circular orbit at this height, in hours, and the lap time. */
export function moonNight(altKm: number): { periodH: number; nightH: number; nightFrac: number } {
  const periodH = orbitPeriodS(MU_MOON, R_MOON + altKm) / 3600;
  const nightFrac = maxEclipseFraction(R_MOON, R_MOON + altKm);
  return { periodH, nightH: periodH * nightFrac, nightFrac };
}

/** Objectives for a mission that returned nothing. */
export function moonEmpty(d: Design, res: FlightResult): void {
  res.objectives = d.objectives.flatMap((id) => {
    const o = MOON_OBJECTIVES.find((x) => x.id === id);
    return o ? [{ id, name: o.name, weight: o.weight, achieved: 0, note: res.launched ? 'No data was collected.' : 'The mission never flew.' }] : [];
  });
  res.sciencePoints = 0;
}

export function moonOps(c: MoonCtx): void {
  const { d, b, res, causes, cm, r, has, say, ask, roll, lose } = c;
  const orbit = find(MOON_ORBITS, d.standoff);
  const months = d.months ?? 12;
  const adcs = find(ADCS, d.adcs), radio = find(RADIOS, d.radio), antenna = find(ANTENNAS, d.antenna);
  const storage = find(STORAGES, d.storage), battery = find(BATTERIES, d.battery);
  const active = c.active;
  const quality = c.quality;
  let storageFactor = c.storageFactor;
  const { periodH, nightH, nightFrac } = moonNight(orbit.km);
  const payloadW = Math.max(1, active.reduce((s, i) => s + i.powerW, 0));
  const busW = b.power.safe / 0.6; // the safe-mode load is 60% of the bus load
  const availW = (b.arrayM2 * ARRAY.wPerM2At1Au * 0.92 * (1 - nightFrac * 1.15) * c.powerFactor) / (1.02 * 1.02);
  let duty = clamp01(Math.max(c.powerFactor < 1 ? 0.1 : 0, (availW - busW) / payloadW));
  // A battery too small for the night means the instruments sleep through it.
  const nightShort = battery.wh * 0.7 < (busW + payloadW * duty) * nightH;
  if (nightShort) {
    duty *= 1 - nightFrac;
    say(c.arriveJd + 3, 'science', 'warn', 'Battery too small for the night', `The instruments switch off for ${Math.round(nightH * 60)} minutes of every ${Math.round(periodH * 60)}-minute lap to keep the spacecraft alive.`);
    causes.push({ good: false, decision: `A ${battery.wh} Wh battery in an orbit with ${Math.round(nightH * 60)} minutes of night each lap.`, effect: `The instruments were off for ${Math.round(nightFrac * 100)}% of every lap.` });
  }

  const opsStart = c.arriveJd + MOON.commissionDays;
  const opsEnd = opsStart + months * 30.44;
  const total = Math.max(1, Math.round(opsEnd - opsStart));
  res.opsDaysPlanned = total;
  say(opsStart, 'science', 'info', 'Mapping begins', `Check-out is complete. ${active.length} instrument${active.length === 1 ? '' : 's'} mapping from ${orbit.km} km for ${months} months.`);

  let dvLeft = Math.max(0, b.traj.dvTotal - b.traj.dvArrive - c.dvPenalty); // km/s for holding the orbit
  const skPerDay = orbit.skMsYr / 365 / 1000;
  let pointing = 1; // falls if a wheel fails with no spare
  let stored = 0, wanted = 0, triage = false, genFactor = 1, extraDsn = 0, recAsked = false;
  let effDays = 0; // days of mapping that count: instruments working, before the decision date
  let safeUntil = -1, alive = true, eclipseSeen = false, lowPass = false, decayAt = -1;
  const cap = () => storage.gb * storageFactor;
  const kbpsAt = (k: number) => dataRateKbps(radio.rfW, antenna.gainDb - c.gainLossDb, MOON.earthKmMax, radio.maxMbps) * (k < c.rateFactorDays ? 0.5 : 1);
  const stormDays = [Math.floor(r('ops-storm-a') * total * 3), Math.floor(r('ops-storm-b') * total * 8)];
  const wheelDay = Math.floor(r('wheel-day') * total);
  const wheelFails = r('wheel') < 0.1 * cm * Math.max(0.5, months / 12);
  const missDay = Math.floor(r('sk-miss-day') * total);
  const redRisk = d.redundancy === 'single' ? 1 : d.redundancy === 'selective' ? 0.5 : 0.2;
  const missBase = orbit.risk * cm * 4 * Math.max(0.5, months / 12);
  const missActual = missBase * redRisk * (has('ops') ? 0.6 : 1);
  const eclipses = MOON.eclipses.filter((e) => e.jd >= opsStart && e.jd < opsEnd);

  let k = 0;
  for (; k < total && alive; k++) {
    const jd = opsStart + k;

    // ---- holding the orbit
    if (decayAt < 0) {
      dvLeft -= skPerDay;
      if (dvLeft <= 0) {
        decayAt = k + Math.round(orbit.km <= 30 ? 20 : orbit.km <= 50 ? 60 : 150);
        say(jd, 'science', 'bad', 'Out of propellant', `The last correcting burn used the tanks. The orbit will sink into the surface in about ${decayAt - k} days.`);
        causes.push({ good: false, decision: `Propellant was sized with nothing spare for a ${orbit.km} km orbit.`, effect: 'The spacecraft ran out of propellant before the mapping was finished.' });
      }
    } else if (k >= decayAt) {
      alive = false;
      say(jd, 'end', 'bad', 'Impact', 'With no propellant to hold it up, the orbit decayed and the spacecraft struck the Moon.');
      break;
    }
    if (k === missDay && roll('sk-miss', missBase, missActual, d.redundancy === 'single' ? 'A single computer flying a low orbit.' : 'The correcting burns were never rehearsed.', d.redundancy !== 'single' ? 'The backup computer flew the correcting burn on time.' : 'Rehearsals caught a wrong burn direction in the plan.', 'A correcting burn was missed and the orbit sagged.')) {
      const fix = 0.012 * (50 / orbit.km);
      if (dvLeft >= fix) {
        dvLeft -= fix;
        safeUntil = Math.max(safeUntil, k + 6);
        say(jd, 'science', 'warn', 'Missed a correcting burn', `The low point of the orbit sank to ${Math.round(orbit.km * 0.35)} km before a recovery burn of ${Math.round(fix * 1000)} m/s. Six days of mapping lost.`);
      } else {
        alive = false;
        lose(jd, 'science', 'Struck the Moon', 'A correcting burn was missed, and there was too little propellant left to climb back. The orbit clipped a mountain.');
        break;
      }
    }

    // ---- hardware
    if (k === wheelDay && wheelFails) {
      if (adcs.wheels >= 4) {
        say(jd, 'science', 'info', 'Reaction wheel failed', 'The spare wheel took over. Pointing is unaffected.');
        causes.push({ good: true, decision: 'Precise pointing carries a fourth, spare wheel.', effect: 'Avoided: a failed reaction wheel would have blurred the camera and the laser.' });
      } else {
        pointing = 0.6;
        say(jd, 'science', 'bad', 'Reaction wheel failed', 'With three wheels and no spare, the spacecraft now steers with thrusters. Pointing is rough.');
        causes.push({ good: false, decision: 'Basic pointing has three wheels and no spare.', effect: 'One wheel failed and the camera and laser lost their sharpness.' });
      }
    }
    if (stormDays.includes(k)) {
      const dmg = (d.redundancy === 'single' ? 0.3 : d.redundancy === 'selective' ? 0.1 : 0.03) * cm;
      const pick = ask(`storm-${k}`, jd, 'science', 'craft', 'Solar storm warning',
        'Forecasters see a strong flare heading for the Moon. It arrives within hours.',
        [{ id: 'safe', label: 'Shelter for three days', what: 'Instruments off, electronics in their safest state. No damage. Three days of mapping lost.' },
          { id: 'ride', label: 'Keep mapping', what: `No days lost. About ${Math.max(1, Math.round(dmg * 100))}% chance of lasting damage with ${REDUNDANCY[d.redundancy].name.toLowerCase()}. (Game value.)` }], 'safe');
      if (pick === 'safe') {
        safeUntil = Math.max(safeUntil, k + 3);
        say(jd, 'science', 'info', 'Sheltered from a solar storm', 'Instruments were off for three days. Nothing was damaged.');
        if (r(`ops-storm-${k}-dmg`) < dmg) causes.push({ good: true, decision: 'The team sheltered from a solar storm.', effect: 'Avoided: radiation damage to the recorder and an instrument.' });
      } else if (r(`ops-storm-${k}-dmg`) < dmg) {
        storageFactor *= 0.5;
        const hit = active.length ? active[Math.floor(r(`ops-storm-${k}-pick`) * active.length)] : null;
        if (hit) quality[hit.id] *= 0.6;
        say(jd, 'science', 'bad', 'Solar storm damage', `Charged particles killed half the recorder${hit ? ` and degraded the ${hit.name.toLowerCase()}` : ''}.`);
        causes.push({ good: false, decision: `The team kept mapping through a solar storm with ${REDUNDANCY[d.redundancy].name.toLowerCase()}.`, effect: 'Radiation destroyed half the data storage and degraded an instrument.' });
      } else {
        say(jd, 'science', 'good', 'Rode out a solar storm', 'The team kept mapping. Radiation levels rose and nothing broke.');
        causes.push({ good: true, decision: 'The team kept mapping through a solar storm.', effect: 'Kept three days of mapping that sheltering would have cost.' });
      }
    }

    // ---- Earth's shadow
    const ecl = eclipses.find((e) => Math.floor(e.jd - opsStart) === k);
    if (ecl) {
      const dark = ecl.hours + nightH;
      const needOff = (b.power.safe * dark) / 0.9, needOn = ((busW + payloadW) * dark) / 0.9;
      const radiometer = active.some((i) => i.id === 'diviner');
      const pick = ask(`ecl-${ecl.id}`, jd - 1, 'science', 'craft', 'Earth\'s shadow is coming',
        `Tomorrow, ${ecl.name}, the Moon passes through Earth's shadow. For about ${ecl.hours.toFixed(1)} hours the spacecraft gets no sunlight, on top of the usual ${Math.round(nightH * 60)} minutes of night each lap. The battery holds ${wh(battery.wh)} Wh.`,
        [{ id: 'off', label: 'Switch everything off', what: `Instruments and most heaters off. Needs ${wh(needOff)} Wh. ${battery.wh >= needOff ? 'The battery covers it.' : 'The battery does not cover it, and the spacecraft may freeze.'} Two days of mapping lost.` },
          { id: 'on', label: 'Keep the instruments on', what: `Needs ${wh(needOn)} Wh. ${battery.wh >= needOn ? 'The battery covers it.' : 'The battery runs flat partway through.'}${radiometer ? ' The radiometer would watch the ground cool as the shadow crosses it, which no ordinary night shows.' : ''}` }], 'off');
      const need = pick === 'on' ? needOn : needOff;
      if (battery.wh >= need) {
        if (pick === 'on') {
          say(ecl.jd, 'science', 'good', 'Mapped through the eclipse', `The battery carried the full load through ${dark.toFixed(1)} dark hours.${radiometer ? ' The radiometer recorded the surface cooling in Earth\'s shadow.' : ''}`);
          if (radiometer) { eclipseSeen = true; causes.push({ good: true, decision: `A ${battery.wh} Wh battery, and the call to keep observing through the eclipse.`, effect: 'The radiometer measured how fast the ground cools, which shows what the soil is made of.' }); }
        } else {
          safeUntil = Math.max(safeUntil, k + 2);
          say(ecl.jd, 'science', 'info', 'Slept through the eclipse', 'Everything went off and came back on. Two days of mapping lost.');
        }
      } else if (r(`ecl-${ecl.id}-luck`) < (pick === 'on' ? 0.6 : 0.5)) {
        alive = false;
        lose(ecl.jd, 'science', 'Froze in Earth\'s shadow', `The battery ran flat ${Math.round((battery.wh / need) * dark * 10) / 10} hours into the eclipse. The spacecraft never answered again.`);
        causes.push({ good: false, decision: pick === 'on' ? `The team kept the instruments on through an eclipse the ${battery.wh} Wh battery could not cover.` : `A ${battery.wh} Wh battery on a mission that flies through a total lunar eclipse.`, effect: 'The battery ran flat in Earth\'s shadow and the spacecraft froze.' });
        break;
      } else {
        safeUntil = Math.max(safeUntil, k + 14);
        const hit = active.length ? active[Math.floor(r(`ecl-${ecl.id}-pick`) * active.length)] : null;
        if (hit) quality[hit.id] *= 0.6;
        say(ecl.jd, 'science', 'bad', 'Battery ran flat in the eclipse', `The spacecraft shut down cold and woke when sunlight returned. Recovery took two weeks${hit ? ` and the ${hit.name.toLowerCase()} came back degraded` : ''}.`);
        causes.push({ good: false, decision: pick === 'on' ? `The team kept the instruments on through an eclipse the ${battery.wh} Wh battery could not cover.` : `A ${battery.wh} Wh battery on a mission that flies through a total lunar eclipse.`, effect: 'The battery ran flat in Earth\'s shadow. Two weeks and some instrument quality were lost.' });
      }
    }

    // ---- data
    const working = k >= safeUntil && decayAt < 0;
    const full = working ? (active.reduce((s, i) => s + i.dataMbPerHour, 0) * SCIENCE_HOURS_PER_DAY * duty) / 1000 : 0;
    const kbps = kbpsAt(k);
    const baseDown = (kbps * d.dsnHoursPerDay * 3600) / 1e6;
    if (!recAsked && working && stored > 0.85 * cap() && k < total - 10 && full > baseDown) {
      recAsked = true;
      const left = total - k;
      const extraCost = (4 * left * DSN.costPerHourK * 5) / 1000;
      const pick = ask('recorder', jd, 'science', 'comms', 'The recorder is almost full',
        `Instruments record ${full.toFixed(1)} Gb a day and the link sends ${baseDown.toFixed(1)} Gb. The ${storage.gb} Gb recorder is ${Math.round((100 * stored) / cap())}% full with ${left} days to go.`,
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
    stored += made; res.gb.made += made; wanted += full;
    const sent = Math.min(stored, down);
    stored -= sent; res.gb.sent += sent;
    if (stored > cap()) { res.gb.dropped += stored - cap(); stored = cap(); }
    if (working && jd < MOON.deadlineJd) effDays += duty;
    if (k % 3 === 0) res.samples.push({ jd, earthKm: 384400, kbps, storedGb: stored, sentGb: res.gb.sent });
  }
  res.opsDaysDone = k;

  // ---- one last call: spend the spare propellant on a low pass?
  if (alive && decayAt < 0 && dvLeft >= 0.05 && opsEnd < MOON.deadlineJd - 30 && active.length > 0) {
    const risk = 0.08 * cm * (adcs.precise ? 0.6 : 1) * (has('ops') ? 0.6 : 1);
    const pick = ask('low', opsEnd, 'end', 'design', 'Spare propellant: one more month?',
      `The planned mapping is done and ${Math.round(dvLeft * 1000)} m/s of propellant is left. The science team wants a final month skimming 20 km above the south pole.`,
      [{ id: 'dive', label: 'Fly the low pass', what: `About a fifth more detail over the pole. Uses 50 m/s. About ${Math.max(1, Math.round(risk * 100))}% chance of clipping a crater rim, which would cost the data still on the recorder. (Game value.)` },
        { id: 'end', label: 'End the mission as planned', what: 'Keep what you have.' }], 'end');
    if (pick === 'dive') {
      dvLeft -= 0.05;
      if (r('low-crash') < risk) {
        res.gb.dropped += stored; stored = 0;
        say(opsEnd + 12, 'end', 'bad', 'Clipped a crater rim', 'Twelve days into the low pass the spacecraft struck high ground near the pole. The data still on board was lost.');
        causes.push({ good: false, decision: 'The team flew a final pass 20 km above the south pole.', effect: 'The spacecraft struck a crater rim before it could send the low-pass data.' });
      } else {
        lowPass = true;
        say(opsEnd + 30, 'end', 'good', 'Low pass complete', 'A month at 20 km gave the sharpest view of the pole yet.');
        causes.push({ good: true, decision: 'The team spent spare propellant on a final pass 20 km above the south pole.', effect: 'The maps of the pole gained about a fifth more detail.' });
      }
    }
  }
  if (alive) {
    // play back what is still on the recorder
    const tail = Math.min(stored, ((kbpsAt(999) * (d.dsnHoursPerDay + extraDsn) * 3600) / 1e6) * 30);
    res.gb.sent += tail; res.gb.dropped += stored - tail;
    say(opsEnd + (lowPass ? 32 : 2), 'end', 'info', 'Mapping complete', `${res.gb.sent.toFixed(0)} Gb reached Earth from ${Math.round(effDays)} working days of mapping.`);
  }
  if (res.gb.dropped > 0.05 * Math.max(1, res.gb.made)) causes.push({ good: false, decision: `A ${antenna.name.toLowerCase()} with a ${radio.name.toLowerCase()}, ${d.dsnHoursPerDay + extraDsn} network hours a day and a ${storage.gb} Gb recorder.`, effect: `${Math.round((100 * res.gb.dropped) / res.gb.made)}% of the recorded data was overwritten before it could be sent.` });
  else if (res.gb.made > 0) causes.push({ good: true, decision: 'Downlink and recorder were sized to the instruments.', effect: 'Almost all recorded data reached Earth.' });
  const afterDeadline = Math.max(0, Math.min(opsEnd, opsStart + k) - MOON.deadlineJd);
  if (afterDeadline > 5) causes.push({ good: false, decision: 'The spacecraft was ready late, or the mission was planned too long.', effect: `${Math.round(afterDeadline)} days of mapping came after the landing site was chosen and did not count.` });

  // ---- score the science
  const sentShare = wanted > 0 ? clamp01(((triage ? 1.3 : 1) * res.gb.sent) / wanted) : 0;
  const m = effDays / 30.44; // months of mapping that count
  const q = (id: string) => (active.some((i) => i.id === id) ? quality[id] : 0);
  const altKm = orbit.km;
  const low = lowPass ? 1.2 : 1;
  const resM = active.some((i) => i.id === 'lroc') ? (10e-6 * altKm * 1000 * (lowPass ? 0.4 : 1)) / Math.max(0.2, quality.lroc * pointing) : Infinity;
  res.resolutionM = resM;
  const sentNote = `Only ${Math.round(sentShare * 100)}% of the data reached Earth.`;
  const timeNote = (need: number) => `Only ${m.toFixed(1)} months of mapping counted. A full answer takes about ${need}.`;
  res.objectives = [];
  for (const id of d.objectives) {
    const o = MOON_OBJECTIVES.find((x) => x.id === id);
    if (!o) continue;
    let v = 1, worst = 1, why = 'Fully achieved.';
    const limit = (parts: [number, string][]) => {
      for (const [x, label] of parts) { v *= x; if (x < worst) { worst = x; why = label; } }
    };
    if (res.gb.made <= 0) { v = 0; why = 'No data was collected.'; }
    else if (id === 'ice') limit([[Math.max(q('lend'), 0.6 * q('mns')), q('lend') > 0 || q('mns') === 0 ? 'The neutron detector did not fly, or was damaged.' : 'The compact counter gives a fainter, blurrier hydrogen map than the full detector.'], [clamp01((altKm <= 30 ? 1 : altKm <= 50 ? 0.85 : 0.55) * low), `From ${altKm} km the detector blends patches ${Math.round((MOON.lro.neutronKm * altKm) / 50)} km wide.`], [Math.sqrt(clamp01(m / 12)), timeNote(12)], [sentShare, sentNote]]);
    else if (id === 'cold') limit([[q('diviner'), 'The thermal radiometer did not fly, or was damaged.'], [altKm > 50 ? 0.8 : 1, 'From 100 km small cold traps blur into their warm surroundings.'], [clamp01(Math.pow(clamp01(m / 9), 0.7) + (eclipseSeen ? 0.12 : 0)), timeNote(9)], [sentShare, sentNote]]);
    else if (id === 'dark') limit([[Math.max(q('lola') * pointing, 0.6 * q('minirf')), q('lola') > 0 ? 'Rough pointing smeared the laser spots.' : 'Radar alone gives a rougher map than the laser.'], [clamp01((altKm <= 30 ? 1 : altKm <= 50 ? 0.95 : 0.75) * low), `From ${altKm} km the laser spots are farther apart.`], [clamp01(m / 10), timeNote(10)], [sentShare, sentNote]]);
    else if (id === 'under') limit([[q('minirf'), 'The imaging radar did not fly, or was damaged.'], [altKm <= 30 ? 1 : altKm <= 50 ? 0.9 : 0.7, `From ${altKm} km the radar echo is weaker.`], [clamp01(m / 6), timeNote(6)], [sentShare, sentNote]]);
    else if (id === 'site') limit([[clamp01(imagingQuality(resM) + (q('lola') > 0 ? 0.15 : 0)), `Pictures show ${resM < 1 ? `${Math.round(resM * 100)} cm` : `${resM.toFixed(1)} m`} per pixel${q('lola') > 0 ? '' : ', with no laser to measure slopes'}.`], [q('lroc') > 0 ? 1 : 0, 'The mapping camera did not fly.'], [clamp01(m / 4), timeNote(4)], [sentShare, sentNote]]);
    res.objectives.push({ id, name: o.name, weight: o.weight, achieved: clamp01(v), note: worst >= 0.97 ? 'Fully achieved.' : why });
  }
  res.sciencePoints = res.objectives.reduce((s, o) => s + o.weight * o.achieved, 0);
}
