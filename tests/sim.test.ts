import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROCKETS, rocketCapacityKg, ARRAY } from '../src/sim/data';
import { dataRateKbps, defaultDesign, evaluate, Design, normalise, moonTrajectory } from '../src/sim/design';
import { moonNight } from '../src/sim/moon';
import { MOON } from '../src/sim/data';
import { simulate, monteCarlo, scoreFlight, Decision, FlightResult } from '../src/sim/flight';
import { AU_KM, jdFromDate } from '../src/sim/astro';

test('rocket model: fitted to GTO and Mars figures, it reproduces the published LEO payloads within 15%', () => {
  const leoC3 = -398600.4418 / (6378.137 + 200); // energy of a 200 km orbit
  const f9 = rocketCapacityKg(ROCKETS.find((r) => r.id === 'f9')!, leoC3);
  const fh = rocketCapacityKg(ROCKETS.find((r) => r.id === 'fh')!, leoC3);
  console.log(`  Falcon 9 model ${Math.round(f9)} kg (published 22,800); Falcon Heavy model ${Math.round(fh)} kg (published 63,800)`);
  assert.ok(Math.abs(f9 - 22800) / 22800 < 0.15);
  assert.ok(Math.abs(fh - 63800) / 63800 < 0.15);
  assert.ok(Math.abs(rocketCapacityKg(ROCKETS.find((r) => r.id === 'f9')!, 12) - 4020) < 60, 'Mars anchor');
});

test('solar array model matches OSIRIS-REx: 8.5 m2 gives 1,226 W at 1.36 au and 3,000 W near 0.9 au', () => {
  const w = (au: number) => (8.5 * ARRAY.wPerM2At1Au * 0.92) / (au * au);
  assert.ok(Math.abs(w(1.36) - 1226) / 1226 < 0.15, `${w(1.36)}`);
  assert.ok(Math.abs(w(0.9) - 3000) / 3000 < 0.15, `${w(0.9)}`);
});

test('link budget is in family with Mars Reconnaissance Orbiter (100 W, 3 m dish, 0.5 to 4 Mbps)', () => {
  const far = dataRateKbps(100, 45.9, 2.6 * AU_KM, 6);
  const near = dataRateKbps(100, 45.9, 0.6 * AU_KM, 6);
  console.log(`  model: ${Math.round(far)} kbps at 2.6 au, ${Math.round(near)} kbps at 0.6 au`);
  assert.ok(far > 300 && far < 3000);
  assert.ok(near >= 4000);
});

test('design budgets are sane and the snowball grows faster than the part added', () => {
  const d = defaultDesign('explorer');
  const b0 = evaluate(d);
  const b1 = evaluate({ ...d, instruments: [...d.instruments, 'lidar'] });
  assert.ok(b0.traj.ok);
  assert.ok(b1.mass.wet - b0.mass.wet > 21 * 1.5, `adding 21 kg added ${b1.mass.wet - b0.mass.wet} kg at launch`);
  assert.ok(b1.cost.total > b0.cost.total);
});

test('flights are repeatable, and testing never makes a design less safe', () => {
  const d: Design = { ...defaultDesign('explorer'), launchJd: jdFromDate(2028, 5, 8), arriveJd: jdFromDate(2029, 2, 25), instruments: ['cam', 'tele', 'vnir', 'radio'], adcs: 'precise', antenna: 'hga1', radio: 'r20', storage: 's2', prop: 'biprop' };
  const a = simulate(d, 42), b = simulate(d, 42);
  assert.deepEqual(a.objectives, b.objectives);
  assert.equal(a.events.length, b.events.length);
  const t0 = Date.now();
  const bare = monteCarlo(d, 1000);
  const tested = monteCarlo({ ...d, tests: ['vibe', 'tvac', 'e2e', 'fire', 'dsn', 'ops'], launchJd: d.launchJd }, 1000);
  console.log(`  1,000 flights x2 in ${Date.now() - t0} ms. survive ${bare.survive.toFixed(2)} -> ${tested.survive.toFixed(2)}, success ${bare.success.toFixed(2)} -> ${tested.success.toFixed(2)}, science ${bare.meanScience.toFixed(1)} -> ${tested.meanScience.toFixed(1)}`);
  assert.ok(tested.survive >= bare.survive - 0.001);
  assert.ok(tested.meanScience >= bare.meanScience - 0.5 || tested.success < 0.2, 'science should not fall with testing unless the schedule broke');
  const s = scoreFlight(a, evaluate(d), [], null, 1);
  assert.ok(s.total >= 0 && s.total <= 100);
});

test('in-flight calls: the past never changes when the team makes a different call', () => {
  const base: Design = { ...defaultDesign('explorer'), launchJd: jdFromDate(2028, 5, 8), arriveJd: jdFromDate(2029, 2, 25), instruments: ['cam', 'tele', 'vnir', 'radio'], adcs: 'precise', antenna: 'mga', radio: 'r5', storage: 's1', prop: 'biprop' };
  const flyby: Design = { ...defaultDesign('smallsat'), missionType: 'flyby', rocket: 'small', launchJd: jdFromDate(2028, 12, 1), arriveJd: jdFromDate(2029, 4, 9) };
  const seen = new Map<string, number>();
  let checked = 0;
  const moon: Design = normalise({ ...defaultDesign('explorer', 'moon'), objectives: ['ice', 'cold', 'site'], instruments: ['lend', 'diviner', 'lroc'], standoff: 'mid', months: 12, battery: 'b2' });
  const moonThin: Design = normalise({ ...defaultDesign('explorer', 'moon'), objectives: ['ice'], instruments: ['lend', 'diviner'], standoff: 'close', months: 12, battery: 'b1' });
  for (const d of [base, flyby, moon, moonThin]) {
    for (let seed = 1; seed <= 150; seed++) {
      const calls: Record<string, string> = {};
      for (let step = 0; step < 8; step++) {
        const res: FlightResult = simulate(d, seed, undefined, calls);
        const next: Decision | undefined = res.decisions.find((x) => !x.byPlayer);
        if (!next) break;
        seen.set(next.id.replace(/-\d+$/, ''), (seen.get(next.id.replace(/-\d+$/, '')) ?? 0) + 1);
        assert.ok(next.options.some((o) => o.id === next.chosen), 'the default is one of the options');
        assert.equal(new Set(next.options.map((o) => o.id)).size, next.options.length);
        const before = res.events.filter((e) => e.n < next.n).map((e) => `${e.jd.toFixed(3)} ${e.title}`);
        for (const o of next.options) {
          const alt: FlightResult = simulate(d, seed, undefined, { ...calls, [next.id]: o.id });
          assert.deepEqual(alt.events.filter((e) => e.n < next.n).map((e) => `${e.jd.toFixed(3)} ${e.title}`), before, `${next.id} option ${o.id} rewrote the past`);
          const made: Decision = alt.decisions.find((x) => x.id === next.id)!;
          assert.ok(made.byPlayer && made.chosen === o.id);
          checked++;
        }
        calls[next.id] = next.options[(seed + step) % next.options.length].id;
      }
    }
  }
  console.log(`  ${checked} alternative calls checked. Calls met: ${[...seen.entries()].map(([k, v]) => `${k} ${v}`).join(', ')}`);
  for (const id of ['wx', 'watch', 'storm', 'recorder', 'mosaic', 'ecl-e2812', 'low']) assert.ok((seen.get(id) ?? 0) > 0, `${id} never came up`);
});

test('in-flight calls: launching through marginal winds loses about one flight in eight; holding loses none to wind', () => {
  const d: Design = { ...defaultDesign('explorer'), launchJd: jdFromDate(2028, 5, 8), arriveJd: jdFromDate(2029, 2, 25), prop: 'biprop' };
  let asked = 0, lostGo = 0, lostHold = 0;
  for (let seed = 1; seed <= 3000; seed++) {
    const res = simulate(d, seed);
    if (!res.decisions.some((x) => x.id === 'wx')) continue;
    asked++;
    if (simulate(d, seed, undefined, { wx: 'go' }).events.some((e) => e.text.includes('wind shear'))) lostGo++;
    if (simulate(d, seed, undefined, { wx: 'hold' }).events.some((e) => e.text.includes('wind shear'))) lostHold++;
  }
  console.log(`  weather call came up in ${asked} of 3,000 worlds; GO lost ${lostGo} (${((100 * lostGo) / asked).toFixed(1)}%), hold lost ${lostHold}`);
  assert.ok(asked > 800 && asked < 1300);
  assert.ok(lostGo / asked > 0.09 && lostGo / asked < 0.16);
  assert.equal(lostHold, 0);
});

test('the live validation panel agrees with the published values', async () => {
  const { runChecks } = await import('../src/sim/checks');
  const checks = runChecks();
  for (const c of checks) console.log(`  ${c.ok ? 'ok ' : 'BAD'} ${c.what}: ${c.ours} (published: ${c.published})`);
  assert.ok(checks.length >= 10);
  assert.ok(checks.every((c) => c.ok));
});

test('Last call: with 16 months, no rendezvous is possible and a fast flyby still works', () => {
  const d = defaultDesign('smallsat', 'lastcall');
  const b = evaluate(d);
  assert.equal(d.missionType, 'flyby');
  assert.ok(b.traj.ok, 'the default flyby has a valid path');
  assert.ok(b.traj.vinfArr > 4, `late routes arrive fast: ${b.traj.vinfArr.toFixed(1)} km/s`);
  console.log(`  default Last call flyby: launch energy ${b.traj.c3.toFixed(1)} km2/s2, arrival ${b.traj.vinfArr.toFixed(1)} km/s, slack ${Math.round(b.time.slackDays)} days, findings: ${b.findings.map((f) => f.id).join(', ') || 'none'}`);
  const stop = evaluate({ ...d, missionType: 'rendezvous' });
  assert.ok(!stop.mass.feasible || stop.mass.margin < 0 || stop.findings.some((f) => f.level === 'red'), 'stopping at Apophis from a late launch should not close');
});

test('Ice Hunter: the trip and the orbit match Lunar Reconnaissance Orbiter', () => {
  const d = normalise({ ...defaultDesign('explorer', 'moon'), standoff: 'mid', months: 12 });
  const t = moonTrajectory(d);
  const night = moonNight(50);
  console.log(`  launch energy ${t.c3.toFixed(2)} km2/s2, arrival speed ${t.vinfArr.toFixed(2)} km/s, capture ${(t.dvArrive * 1000).toFixed(0)} m/s, lap ${(night.periodH * 60).toFixed(0)} min, night ${(night.nightH * 60).toFixed(0)} min`);
  assert.ok(t.c3 > -2.5 && t.c3 < -1.5, 'a lunar transfer is just short of escape');
  assert.ok(t.dvArrive > 0.75 && t.dvArrive < 0.95, 'capture into a 50 km orbit takes 800 to 900 m/s');
  assert.ok(Math.abs(night.periodH * 60 - 113) < 2, 'LRO laps the Moon in about 113 minutes');
  assert.ok(Math.abs(night.nightH * 60 - 48) < 3, 'up to 48 minutes of each lap is in shadow');
  // capture plus a year at 50 km must fit inside LRO's published 1,263 m/s
  assert.ok((t.dvArrive + t.dvOps) * 1000 < MOON.lro.dvMs, `${((t.dvArrive + t.dvOps) * 1000).toFixed(0)} m/s`);
  assert.ok(moonTrajectory({ ...d, standoff: 'close' }).dvTotal > t.dvTotal && moonTrajectory({ ...d, standoff: 'far' }).dvTotal < t.dvTotal, 'lower orbits cost more to hold');
});

test('Ice Hunter: batteries, the deadline and the odds behave', () => {
  const lean = defaultDesign('explorer', 'moon');
  assert.ok(evaluate(lean).findings.some((f) => f.id === 'battery' && f.level === 'red'), 'the small battery cannot carry an Explorer through the night');
  const good: Design = normalise({ ...lean, objectives: ['ice', 'cold', 'dark'], instruments: ['lend', 'diviner', 'lola'], standoff: 'mid', months: 12, battery: 'b2', tests: ['e2e', 'fire'], reservePct: 15, redundancy: 'selective' });
  const b = evaluate(good);
  assert.deepEqual(b.findings.filter((f) => f.level === 'red').map((f) => f.id), []);
  const late = evaluate(normalise({ ...good, klass: 'flagship', rocket: 'f9', months: 18, battery: 'b3' }));
  assert.ok(late.findings.some((f) => f.id === 'm-late'), 'a Flagship cannot map for 18 months before the decision date');
  const mc = monteCarlo(good, 1000);
  const mcLean = monteCarlo(lean, 400);
  console.log(`  LRO-like Explorer: mass ${Math.round(b.mass.wet)} kg, power ${Math.round(b.power.worst)} W, cost $${Math.round(b.cost.total)}M, ${Math.round(b.time.slackDays)} days spare; 1,000 flights: ${(mc.success * 100).toFixed(0)}% succeed, ${(mc.survive * 100).toFixed(0)}% survive, mean science ${mc.meanScience.toFixed(1)} of ${b.klass.scienceTarget}`);
  assert.ok(mc.success > 0.7 && mc.success < 0.99);
  assert.ok(mcLean.success < 0.05, 'one instrument and six months is not enough science');
  // the eclipse call: a big battery can observe through Earth's shadow, a small one cannot
  let froze = 0, sawEclipse = 0, bonus = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const small = simulate(normalise({ ...good, battery: 'b1' }), seed, undefined, { 'ecl-e2812': 'on' });
    if (small.decisions.some((x) => x.id === 'ecl-e2812')) { sawEclipse++; if (small.lostWhy.includes('Froze')) froze++; }
    const big = simulate(normalise({ ...good, battery: 'b3' }), seed, undefined, { 'ecl-e2812': 'on' });
    assert.ok(!big.lostWhy.includes('Froze'));
    if (big.events.some((e) => e.title === 'Mapped through the eclipse')) bonus++;
  }
  console.log(`  eclipse of 31 Dec 2028 met in ${sawEclipse} of 300 worlds; small battery kept on froze ${froze}; large battery mapped through it ${bonus} times`);
  assert.ok(sawEclipse > 250 && froze > 0.4 * sawEclipse && bonus > 250);
});
