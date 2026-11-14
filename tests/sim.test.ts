import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROCKETS, rocketCapacityKg, ARRAY } from '../src/sim/data';
import { dataRateKbps, defaultDesign, evaluate, Design } from '../src/sim/design';
import { simulate, monteCarlo, scoreFlight } from '../src/sim/flight';
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
