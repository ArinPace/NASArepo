// Bundled data. Every entry carries a source. kind 'game' means the number is
// a game value: plausible and labelled, but not copied from a public source.
import { Elements, jdFromDate } from './astro';

export interface Src {
  label: string;
  url?: string;
  kind: 'nasa' | 'public' | 'game';
}
const game = (label: string): Src => ({ label, kind: 'game' });

export const DATA_CHECKED = '14 November 2026';

// ---------------------------------------------------------------- Apophis
export const APOPHIS = {
  name: '99942 Apophis',
  // JPL Small-Body Database orbit as listed on Wikipedia, epoch 5 May 2025.
  // Used unmodified. Two-body propagation of these rounded elements puts the
  // Earth flyby about 3 hours from NASA's published time (see tests).
  elements: { a: 0.9224, e: 0.1911, i: 3.341, node: 203.9, peri: 126.7, M0: 90.28, epoch: 2460800.5 } as Elements,
  elementsSrc: {
    label: 'JPL Small-Body Database orbit (epoch JD 2460800.5), as listed on Wikipedia',
    url: 'https://en.wikipedia.org/wiki/99942_Apophis',
    kind: 'public',
  } as Src,
  flybyJd: jdFromDate(2029, 4, 13) + 21.77 / 24, // 13 April 2029, about 21:46 UT
  flybySrc: {
    label: 'NASA: Apophis passes about 32,000 km above Earth on 13 April 2029',
    url: 'https://science.nasa.gov/solar-system/asteroids/apophis-facts',
    kind: 'nasa',
  } as Src,
  diameterM: 340,
  rotationH: 30.6,
};

// ---------------------------------------------------------------- mission briefs
/** A scenario: the same asteroid and physics, a different starting position. */
export interface Brief {
  id: string;
  name: string;
  tag: string;
  startJd: number; // the day building can begin
  targetMult: number; // scales the science a class is expected to return
  capMult: number; // scales the cost cap
  ranked: boolean; // whether flights count for the best-flights board
  klass: 'smallsat' | 'explorer' | 'flagship'; // suggested class
  blurb: string;
  twist: string;
}
export const BRIEFS: Brief[] = [
  {
    id: 'apophis', name: 'Witness', tag: 'The full mission', startJd: jdFromDate(2026, 12, 1), targetMult: 1, capMult: 1, ranked: true, klass: 'explorer',
    blurb: 'Work starts on 1 December 2026. You have 28 months to be at Apophis before Earth pulls on it, and to stay through the flyby.',
    twist: 'Time is on your side if you find the right launch window.',
  },
  {
    id: 'lastcall', name: 'Last call', tag: 'Hard: 16 months', startJd: jdFromDate(2027, 12, 1), targetMult: 0.6, capMult: 1, ranked: true, klass: 'smallsat',
    blurb: 'The big mission was cancelled. Work starts on 1 December 2027 with 16 months left. The slow, cheap routes have already closed.',
    twist: 'Only fast routes remain. Get anything there and bring home what you can.',
  },
  {
    id: 'moon', name: 'Ice Hunter', tag: 'A different world', startJd: jdFromDate(2026, 12, 1), targetMult: 1.1, capMult: 1, ranked: true, klass: 'explorer',
    blurb: 'Map the ice hidden in craters at the Moon\'s south pole that have not seen sunlight in perhaps billions of years. No launch window to chase this time.',
    twist: 'The fight is with fuel, batteries and the Moon\'s long nights. Lower orbits see more and cost more to hold.',
  },
  {
    id: 'sandbox', name: 'Sandbox', tag: 'No limits', startJd: jdFromDate(2025, 1, 1), targetMult: 1, capMult: 20, ranked: false, klass: 'flagship',
    blurb: 'Money and build time are no object: the cost cap is 20 times higher and the hardware is always ready. The physics does not bend.',
    twist: 'For trying ideas. Flights here stay off the best-flights board.',
  },
];
export const briefOf = (id: string): Brief => BRIEFS.find((x) => x.id === id) ?? BRIEFS[0];

// ---------------------------------------------------------------- classes
export type ClassId = 'smallsat' | 'explorer' | 'flagship';
export interface MissionClass {
  id: ClassId;
  name: string;
  nasaClass: string;
  blurb: string;
  capM: number; // cost cap, $M
  devMonths: number; // design + build time before launch
  busMassKg: number; // structure-independent base hardware
  busPowerW: number;
  busCostM: number;
  opsCostPerMonthM: number;
  testCostMult: number;
  failureMult: number; // process rigour: lower is safer
  scienceTarget: number; // weighted science points that count as a full score
  src: Src;
}
export const CLASSES: MissionClass[] = [
  {
    id: 'smallsat', name: 'SmallSat', nasaClass: 'Class D',
    blurb: 'Fast and cheap. NASA accepts a high risk of failure, like CYGNSS or TROPICS.',
    capM: 90, devMonths: 11, busMassKg: 22, busPowerW: 28, busCostM: 9, opsCostPerMonthM: 0.4,
    testCostMult: 0.4, failureMult: 1.35, scienceTarget: 40,
    src: game('Game values. Risk class from NASA NPR 8705.4 (Class D: high risk tolerance).'),
  },
  {
    id: 'explorer', name: 'Explorer', nasaClass: 'Class B/C',
    blurb: 'A mid-size mission. Backups for critical parts, like Psyche or Mars Reconnaissance Orbiter.',
    capM: 450, devMonths: 14, busMassKg: 150, busPowerW: 120, busCostM: 65, opsCostPerMonthM: 1.5,
    testCostMult: 1, failureMult: 1, scienceTarget: 65,
    src: game('Game values. Risk class from NASA NPR 8705.4 (Class B and C).'),
  },
  {
    id: 'flagship', name: 'Flagship', nasaClass: 'Class A',
    blurb: 'Big, careful and slow. Failure is not an option, like the James Webb Space Telescope.',
    capM: 1200, devMonths: 17, busMassKg: 380, busPowerW: 260, busCostM: 210, opsCostPerMonthM: 4,
    testCostMult: 2.2, failureMult: 0.7, scienceTarget: 90,
    src: game('Game values. Risk class from NASA NPR 8705.4 (Class A: lowest risk tolerance).'),
  },
];
export const RISK_CLASS_SRC: Src = {
  label: 'NASA Launch Services risk classification fact sheet',
  url: 'https://www.nasa.gov/wp-content/uploads/2023/12/risk-classification-fact-sheet.pdf',
  kind: 'nasa',
};

// ---------------------------------------------------------------- rockets
export interface Rocket {
  id: string;
  name: string;
  blurb: string;
  p0: number; // kg to C3 = 0
  k: number; // km^2/s^2: capacity falls by e for every k of launch energy
  priceM: number;
  failure: number;
  shared?: boolean;
  src: Src;
  priceSrc: Src;
}
// Capacity model: kg(C3) = p0 * exp(-C3 / k), an exponential through the
// operator's published geostationary-transfer and Mars payloads. It also
// reproduces the published low-Earth-orbit payloads within 15% (see tests).
export const ROCKETS: Rocket[] = [
  {
    id: 'small', name: 'Small launcher + kick stage', blurb: 'A dedicated ride for a spacecraft the size of a suitcase.',
    p0: 150, k: 30, priceM: 12, failure: 0.07,
    src: game('Game value, modelled on Rocket Lab Electron with a kick stage (the CAPSTONE launch).'),
    priceSrc: game('Game value.'),
  },
  {
    id: 'shared', name: 'Shared ride', blurb: 'Second passenger on someone else\'s rocket. Cheap, but their delays become yours.',
    p0: 1500, k: 60, priceM: 30, failure: 0.02, shared: true,
    src: game('Game value. Real precedent: ESA\'s Ramses (about 1.3 tonnes) shares a Japanese H3 with DESTINY+.'),
    priceSrc: game('Game value.'),
  },
  {
    id: 'f9r', name: 'Falcon 9, booster recovered', blurb: 'The workhorse, with the first stage landing on a ship.',
    p0: 3626, k: 38.9, priceM: 70, failure: 0.01,
    src: { label: 'Falcon 9 curve scaled to the published 5,500 kg to GTO with a drone-ship landing', url: 'https://en.wikipedia.org/wiki/Falcon_9', kind: 'public' },
    priceSrc: { label: 'SpaceX standard price, $69.75M', url: 'https://spacex.com/media/Capabilities&Services.pdf', kind: 'public' },
  },
  {
    id: 'f9', name: 'Falcon 9, expended', blurb: 'All the performance, none of the booster back.',
    p0: 5472, k: 38.9, priceM: 95, failure: 0.01,
    src: { label: 'Fit to SpaceX figures: 8,300 kg to GTO, 4,020 kg to Mars', url: 'https://spacex.com/media/Capabilities&Services.pdf', kind: 'public' },
    priceSrc: game('Game value. Expendable flights cost more than the $69.75M standard price.'),
  },
  {
    id: 'fh', name: 'Falcon Heavy, expended', blurb: 'Three cores. Lifts almost anything, at a price.',
    p0: 20460, k: 60.9, priceM: 150, failure: 0.03,
    src: { label: 'Fit to SpaceX figures: 26,700 kg to GTO, 16,800 kg to Mars', url: 'https://spacex.com/vehicles/falcon-heavy', kind: 'public' },
    priceSrc: game('Game value for an expendable flight. The 2020 list price started at $90M.'),
  },
];
export const rocketCapacityKg = (r: Rocket, c3: number) => r.p0 * Math.exp(-c3 / r.k);

// ---------------------------------------------------------------- parts
export interface Instrument {
  id: string;
  name: string;
  short: string;
  what: string;
  massKg: number;
  powerW: number;
  costM: number;
  trl: number; // technology readiness level, 1-9
  dataMbPerHour: number;
  ifovUrad?: number; // angular size of one pixel, microradians
  needsPointing?: boolean;
  world?: 'moon'; // flies only in the lunar mission
  src: Src;
}
export const INSTRUMENTS: Instrument[] = [
  {
    id: 'cam', name: 'Framing camera', short: 'Camera',
    what: 'Wide, sturdy camera. Also used to steer near the asteroid.',
    massKg: 2.5, powerW: 5, costM: 3, trl: 9, dataMbPerHour: 220, ifovUrad: 94,
    src: game('Representative of asteroid framing cameras such as those on Hera and Ramses.'),
  },
  {
    id: 'tele', name: 'Telescopic camera', short: 'Telescope',
    what: 'A 20 cm telescope that sees pebbles from kilometres away. Needs steady pointing.',
    massKg: 8, powerW: 15, costM: 18, trl: 9, dataMbPerHour: 650, ifovUrad: 13.5, needsPointing: true,
    src: game('Modelled on PolyCam from OSIRIS-REx. Mass, power and cost are representative.'),
  },
  {
    id: 'vnir', name: 'Visible-infrared spectrometer', short: 'Spectrometer',
    what: 'Splits reflected sunlight to tell which minerals are on the surface.',
    massKg: 17.8, powerW: 8.8, costM: 22, trl: 9, dataMbPerHour: 60,
    src: { label: 'OVIRS on OSIRIS-REx: 17.8 kg, 8.8 W average', url: 'https://link.springer.com/10.1007/s11214-018-0482-9', kind: 'public' },
  },
  {
    id: 'tir', name: 'Thermal spectrometer', short: 'Thermal',
    what: 'Measures heat glow to find rock type and how fast the surface warms and cools.',
    massKg: 6.3, powerW: 10.8, costM: 12, trl: 9, dataMbPerHour: 25,
    src: game('Modelled on OTES from OSIRIS-REx. Values are representative.'),
  },
  {
    id: 'lidar', name: 'Laser altimeter', short: 'Laser',
    what: 'Fires laser pulses to build a 3D model of the asteroid, centimetre by centimetre.',
    massKg: 21, powerW: 59, costM: 20, trl: 9, dataMbPerHour: 90,
    src: game('Modelled on OLA from OSIRIS-REx. Values are representative.'),
  },
  {
    id: 'radar', name: 'Radar CubeSat', short: 'Radar',
    what: 'A released mini-satellite whose radio waves pass through the asteroid and reveal voids.',
    massKg: 14, powerW: 12, costM: 15, trl: 6, dataMbPerHour: 40,
    src: { label: 'Concept from Ramses, which carries a radar on a deployable CubeSat. Values are game values.', url: 'https://pd.jaxa.jp/articles/en/pd_and_ramses_en.html', kind: 'game' },
  },
  {
    id: 'seis', name: 'Seismometer lander', short: 'Lander',
    what: 'A shoebox that lands and feels the asteroid shake as Earth\'s gravity squeezes it.',
    massKg: 16, powerW: 8, costM: 21, trl: 5, dataMbPerHour: 8,
    src: game('Game values. Ramses studied a CubeSat lander for Apophis.'),
  },
  {
    id: 'radio', name: 'Radio science', short: 'Radio',
    what: 'Tracks tiny shifts in the radio signal to weigh the asteroid.',
    massKg: 1.5, powerW: 3, costM: 2, trl: 9, dataMbPerHour: 1, needsPointing: true,
    src: game('Representative ultra-stable oscillator. Ramses and Hera both fly radio science.'),
  },
];

export interface Choice {
  id: string;
  name: string;
  what: string;
  massKg: number;
  powerW: number;
  costM: number;
  src: Src;
}
export interface AntennaChoice extends Choice { gainDb: number; diameterM: number }
export interface RadioChoice extends Choice { rfW: number; maxMbps: number }
export interface PropChoice extends Choice { ispS: number; tankFrac: number }
export interface BatteryChoice extends Choice { wh: number }
export interface StorageChoice extends Choice { gb: number }
export interface AdcsChoice extends Choice { precise: boolean; wheels: number }

// X-band downlink, 8.45 GHz. Gain = 0.55 * (pi * D / wavelength)^2.
export const ANTENNAS: AntennaChoice[] = [
  { id: 'lga', name: 'Patch antenna', what: 'Flat, cheap, talks in every direction and therefore slowly.', massKg: 0.3, powerW: 0, costM: 0.2, gainDb: 6, diameterM: 0.05, src: game('Representative low-gain patch.') },
  { id: 'mga', name: '30 cm dish', what: 'A dinner plate. Fine close to Earth.', massKg: 1.5, powerW: 0, costM: 1, gainDb: 25.9, diameterM: 0.3, src: game('Gain from the dish formula. Mass and cost are game values.') },
  { id: 'hga1', name: '1 m dish', what: 'The standard choice for small deep-space craft.', massKg: 6, powerW: 0, costM: 4, gainDb: 36.3, diameterM: 1, src: game('Gain from the dish formula. Mass and cost are game values.') },
  { id: 'hga2', name: '2 m dish', what: 'A big ear. Heavy, and it must point at Earth precisely.', massKg: 16, powerW: 0, costM: 9, gainDb: 42.4, diameterM: 2, src: game('Gain from the dish formula. Mass and cost are game values.') },
];
export const RADIOS: RadioChoice[] = [
  { id: 'r5', name: '5 W transmitter', what: 'CubeSat-class radio.', massKg: 2, powerW: 20, costM: 1.5, rfW: 5, maxMbps: 2, src: game('Representative small deep-space transponder.') },
  { id: 'r20', name: '20 W transmitter', what: 'A solid-state amplifier.', massKg: 4, powerW: 65, costM: 4, rfW: 20, maxMbps: 6, src: game('Representative X-band solid-state amplifier.') },
  { id: 'r100', name: '100 W transmitter', what: 'A travelling-wave tube, as on Mars orbiters.', massKg: 8, powerW: 220, costM: 9, rfW: 100, maxMbps: 6, src: game('Representative travelling-wave tube amplifier, as on Mars Reconnaissance Orbiter.') },
];
export const PROPS: PropChoice[] = [
  { id: 'mono', name: 'Hydrazine thrusters', what: 'Simple and reliable. Burns a lot of propellant per push.', massKg: 6, powerW: 4, costM: 3, ispS: 225, tankFrac: 0.12, src: game('Typical monopropellant hydrazine: specific impulse about 225 s.') },
  { id: 'biprop', name: 'Two-propellant engine', what: 'Fuel plus oxidiser. A third more push per kilogram, more plumbing.', massKg: 18, powerW: 8, costM: 12, ispS: 320, tankFrac: 0.1, src: game('Typical bipropellant: specific impulse about 320 s.') },
];
export const BATTERIES: BatteryChoice[] = [
  { id: 'b1', name: 'Small battery', what: '150 Wh.', massKg: 2, powerW: 0, costM: 0.3, wh: 150, src: game('Lithium-ion at roughly 100 Wh/kg at pack level.') },
  { id: 'b2', name: 'Medium battery', what: '500 Wh.', massKg: 6, powerW: 0, costM: 0.8, wh: 500, src: game('Lithium-ion at roughly 100 Wh/kg at pack level.') },
  { id: 'b3', name: 'Large battery', what: '1,500 Wh.', massKg: 16, powerW: 0, costM: 2, wh: 1500, src: game('Lithium-ion at roughly 100 Wh/kg at pack level.') },
];
export const STORAGES: StorageChoice[] = [
  { id: 's1', name: '32 Gb recorder', what: 'Fills in hours with a telescope running.', massKg: 3, powerW: 10, costM: 1.5, gb: 32, src: game('Game value.') },
  { id: 's2', name: '128 Gb recorder', what: 'Room for a few days of data.', massKg: 6, powerW: 18, costM: 4, gb: 128, src: game('Game value.') },
  { id: 's3', name: '512 Gb recorder', what: 'Holds weeks of data through a bad patch.', massKg: 10, powerW: 30, costM: 9, gb: 512, src: game('Game value.') },
];
export const ADCS: AdcsChoice[] = [
  { id: 'basic', name: 'Basic pointing', what: 'Three wheels and one star tracker. No spare wheel.', massKg: 6, powerW: 12, costM: 2.5, precise: false, wheels: 3, src: game('Game value.') },
  { id: 'precise', name: 'Precise pointing', what: 'Four wheels, two star trackers, a gyro unit. Steady enough for a telescope.', massKg: 14, powerW: 28, costM: 8, precise: true, wheels: 4, src: game('Game value.') },
];
export type Redundancy = 'single' | 'selective' | 'full';
export const REDUNDANCY: Record<Redundancy, { name: string; what: string; massMult: number; costMult: number; risk: number; months: number }> = {
  single: { name: 'Single string', what: 'One of everything. Light and cheap. Ramses flies this way to save mass.', massMult: 1, costMult: 1, risk: 1, months: 0 },
  selective: { name: 'Selective backups', what: 'Spare computer and radio. The usual middle path.', massMult: 1.35, costMult: 1.3, risk: 0.6, months: 1 },
  full: { name: 'Full backups', what: 'Two of everything that can fail.', massMult: 1.9, costMult: 1.8, risk: 0.3, months: 2 },
};
export const RAMSES_SRC: Src = {
  label: 'ESA Ramses: launch window 24 April to 11 May 2028, 10-month transfer, under 1.6 km/s, about 1.3 tonnes',
  url: 'https://chances.unibe.ch/instrument__mission/mission_overview/index_eng.html',
  kind: 'public',
};

// Solar array: OSIRIS-REx makes 1,226 to 3,000 W from 8.5 m2 between 1.36 and
// 0.9 au, which is about 270 W per m2 at 1 au.
export const ARRAY = {
  wPerM2At1Au: 270,
  kgPerM2: 3.6,
  costMPerM2: 0.7,
  src: { label: 'OSIRIS-REx fact sheet: 8.5 m2 of panels give 1,226 to 3,000 W', url: 'https://www.nasa.gov/wp-content/uploads/2016/06/osiris_rex_factsheet5-25.pdf', kind: 'nasa' } as Src,
};

// Deep Space Network 34 m dish at X-band.
export const DSN = {
  gOverT: 54, // dB/K, approximate
  costPerHourK: 5, // $ thousand per hour, game value
  src: game('Approximate figure of merit for a 34 m antenna at X-band, after the DSN Telecommunications Link Design Handbook (810-005).'),
};

// ---------------------------------------------------------------- tests
export interface TestOption {
  id: string;
  name: string;
  what: string;
  costM: number;
  weeks: number;
  catches: string;
}
export const TESTS: TestOption[] = [
  { id: 'vibe', name: 'Shake test', what: 'Bolt the spacecraft to a table that shakes like a rocket.', costM: 2, weeks: 3, catches: 'Panels and antennas that jam after launch' },
  { id: 'tvac', name: 'Thermal vacuum', what: 'Weeks in a chamber swinging from space-cold to Sun-hot.', costM: 3, weeks: 4, catches: 'Parts that crack, fog or drift with temperature' },
  { id: 'e2e', name: 'Test as you fly', what: 'Run the real flight software through the whole mission on the real hardware.', costM: 2, weeks: 4, catches: 'Software and sequence errors' },
  { id: 'fire', name: 'Engine hot-fire', what: 'Fire the thrusters on the ground with flight valves.', costM: 1.5, weeks: 2, catches: 'Engine and valve faults at the arrival burn' },
  { id: 'dsn', name: 'Network compatibility', what: 'Plug the radio into a Deep Space Network test rig.', costM: 0.8, weeks: 1, catches: 'Radio settings the ground cannot decode' },
  { id: 'ops', name: 'Flight rehearsals', what: 'The team flies the critical days in a simulator, with surprises.', costM: 1, weeks: 2, catches: 'Human error on the days that matter' },
];

// ---------------------------------------------------------------- objectives
export interface Objective {
  id: string;
  name: string;
  question: string;
  needs: string; // plain words
  weight: number;
  instruments: string[]; // any one of these can measure it
  segments: ('before' | 'during' | 'after')[];
}
export const OBJECTIVES: Objective[] = [
  { id: 'shape', name: 'Map it before', question: 'What does Apophis look like before Earth touches it?', needs: 'A camera, and at least two weeks at the asteroid before 13 April', weight: 20, instruments: ['tele', 'cam', 'lidar'], segments: ['before'] },
  { id: 'change', name: 'Watch it change', question: 'Does Earth\'s gravity trigger landslides or change its spin?', needs: 'A camera at the asteroid before, during and after the flyby', weight: 30, instruments: ['tele', 'cam'], segments: ['before', 'during', 'after'] },
  { id: 'comp', name: 'What it is made of', question: 'Which minerals cover it, and does the flyby expose fresh ones?', needs: 'A spectrometer', weight: 15, instruments: ['vnir', 'tir'], segments: ['before'] },
  { id: 'inside', name: 'Look inside', question: 'Is it solid rock or a pile of rubble with empty gaps?', needs: 'The radar CubeSat or the seismometer lander', weight: 20, instruments: ['radar', 'seis'], segments: ['before', 'during'] },
  { id: 'mass', name: 'Weigh it', question: 'How heavy is it? Planetary defence needs this number.', needs: 'Radio science and weeks spent close to the asteroid', weight: 15, instruments: ['radio'], segments: ['before'] },
];

// Standoff distances used by Ramses: 20 km down to 1 km before closest
// approach, hovering at 5 km during it.
export interface Standoff { id: string; name: string; km: number; dvKmS: number; risk: number; what: string }
export const STANDOFFS: Standoff[] = [
  { id: 'far', name: 'Keep 20 km away', km: 20, dvKmS: 0.02, risk: 0.003, what: 'Safe. Details smaller than a car are lost to all but the telescope.' },
  { id: 'mid', name: 'Hover at 5 km', km: 5, dvKmS: 0.04, risk: 0.015, what: 'Where Ramses plans to sit during the flyby.' },
  { id: 'close', name: 'Come in to 1 km', km: 1, dvKmS: 0.08, risk: 0.06, what: 'Superb detail. One navigation slip can end the mission.' },
];
export const FLYBY_PASSES: Standoff[] = [
  { id: 'far', name: 'Pass at 1,000 km', km: 1000, dvKmS: 0, risk: 0.005, what: 'Easy to hit. Only the telescope sees much.' },
  { id: 'mid', name: 'Pass at 200 km', km: 200, dvKmS: 0, risk: 0.02, what: 'A good compromise.' },
  { id: 'close', name: 'Pass at 50 km', km: 50, dvKmS: 0, risk: 0.06, what: 'Sharp pictures for a few minutes, if the aim is true.' },
];

export const GLOSSARY: Record<string, { cadet: string; engineer: string; chief: string }> = {
  c3: {
    cadet: 'How hard the rocket has to throw the spacecraft away from Earth. A harder throw means a lighter spacecraft.',
    engineer: 'Launch energy (C3) is the square of the speed left over after escaping Earth, in km²/s². Rocket capacity drops as C3 rises.',
    chief: 'C3 = v∞² at departure. Capacity is modelled as m(C3) = m₀·exp(−C3/k), fitted to published GTO and Mars payloads.',
  },
  dv: {
    cadet: 'Every change of speed in space costs propellant. Delta-v is the total speed change the mission needs.',
    engineer: 'Delta-v is the sum of all burns after launch: matching speed with the target, corrections and station keeping.',
    chief: 'Δv = Isp·g₀·ln(m₀/m_f). Propellant grows exponentially with Δv, and the tanks that hold it add dry mass, which adds propellant.',
  },
  margin: {
    cadet: 'Spare room. Designs always grow, so engineers leave a gap between what they need and what they have.',
    engineer: 'Margin is capacity minus need, as a share of capacity. Early designs carry 15% growth allowance plus margin on top.',
    chief: 'Mass margin = (launch capacity − predicted wet mass) / capacity. Predicted dry mass is the current estimate plus 15% growth allowance.',
  },
  link: {
    cadet: 'A radio signal spreads out like light from a torch. Four times farther away means sixteen times weaker, so data flows more slowly.',
    engineer: 'Data rate depends on transmitter power, dish size at both ends, and the square of distance.',
    chief: 'R = EIRP + G/T − L_space + 228.6 − Eb/N0 − margin (dB). L_space = (4πd/λ)². A 34 m DSN dish gives G/T ≈ 54 dB/K at X-band.',
  },
  trl: {
    cadet: 'How grown-up a piece of technology is, from 1 (an idea) to 9 (already flown in space).',
    engineer: 'Technology readiness level. Parts below TRL 7 have not flown and are more likely to arrive late or fail.',
    chief: 'TRL per NASA scale. Each level below 7 adds delivery-slip and in-flight failure probability unless testing buys it down.',
  },
  redundancy: {
    cadet: 'Carrying a spare. If one computer dies, the other takes over. Spares cost mass and money.',
    engineer: 'Single-string designs have one of each unit. Redundant designs survive one failure, at the cost of mass, power and money.',
    chief: 'Redundancy multiplies avionics, radio and pointing mass by 1.35 (selective) or 1.9 (full) and scales fault-to-loss probability by 0.6 or 0.3.',
  },
  vinf: {
    cadet: 'How fast you are still going, compared with the asteroid, when you get there. To stay, you must brake by that much.',
    engineer: 'Arrival speed relative to the target (v-infinity). A rendezvous must cancel it with the engine; a flyby keeps it.',
    chief: 'v∞,arr = |v_transfer − v_target| from the Lambert solution. For a small body the capture burn is v∞ itself.',
  },
};

// ---------------------------------------------------------------- Ice Hunter: the Moon
// Instrument masses and powers are the published figures for the Lunar
// Reconnaissance Orbiter payload. Costs and data rates are game values.
export const LRO_SRC: Src = { label: 'NASA Lunar Reconnaissance Orbiter launch press kit, as reprinted by Spaceflight Now', url: 'https://spaceflightnow.com/atlas/av020/090610lro.html', kind: 'nasa' };
export const LRO_ORBIT_SRC: Src = { label: 'Vondrak and others, LRO mission overview, NASA Technical Reports Server', url: 'https://ntrs.nasa.gov/api/citations/20140000908/downloads/20140000908.pdf', kind: 'nasa' };
export const LRO_DATA_SRC: Src = { label: 'eoPortal, Lunar Reconnaissance Orbiter', url: 'https://eoportal.org/satellite-missions/lro', kind: 'public' };
export const ECLIPSE_SRC: Src = { label: 'Eclipse predictions by Fred Espenak, NASA GSFC', url: 'https://eclipse.gsfc.nasa.gov/LEdecade/LEdecade2021.html', kind: 'nasa' };

INSTRUMENTS.push(
  {
    id: 'lend', name: 'Neutron detector', short: 'Neutron detector', world: 'moon',
    what: 'Counts neutrons leaking out of the soil. Fewer neutrons means hydrogen, and hydrogen means water ice. Sees patches 10 km wide from 50 km up, and needs months of counting.',
    massKg: 25.8, powerW: 11.6, costM: 14, trl: 9, dataMbPerHour: 2, src: LRO_SRC,
  },
  {
    id: 'mns', name: 'Compact neutron counter', short: 'Compact counter', world: 'moon',
    what: 'A shoebox-sized neutron counter for small spacecraft. It finds hydrogen, with a fainter signal and a blurrier map than the full detector.',
    massKg: 4, powerW: 10, costM: 5, trl: 8, dataMbPerHour: 1,
    src: game('Game values, modelled on the miniature neutron spectrometer flown on NASA\'s LunaH-Map CubeSat.'),
  },
  {
    id: 'lola', name: 'Laser altimeter', short: 'Laser altimeter', world: 'moon',
    what: 'Fires laser pulses at the ground and times the echo. Maps slopes and the floors of craters that never see the Sun.',
    massKg: 11.3, powerW: 33.4, costM: 13, trl: 9, dataMbPerHour: 150, src: LRO_SRC,
  },
  {
    id: 'diviner', name: 'Thermal radiometer', short: 'Radiometer', world: 'moon',
    what: 'Takes the temperature of the ground, day and night. Ice lasts only where it stays colder than about minus 160 °C.',
    massKg: 11.0, powerW: 24.7, costM: 10, trl: 9, dataMbPerHour: 80, src: LRO_SRC,
  },
  {
    id: 'minirf', name: 'Imaging radar', short: 'Radar', world: 'moon',
    what: 'Lights the ground with its own radio beam, so it sees into permanent shadow and a little way under the surface.',
    massKg: 13.8, powerW: 7.0, costM: 12, trl: 9, dataMbPerHour: 2000, src: LRO_SRC,
  },
  {
    id: 'lroc', name: 'Mapping camera', short: 'Mapping camera', world: 'moon',
    what: 'Sharp pictures of sunlit ground: 50 cm per pixel from 50 km. Finds the boulders at a landing site. Makes a flood of data.',
    massKg: 19.2, powerW: 24.0, costM: 20, trl: 9, dataMbPerHour: 6000, ifovUrad: 10, src: LRO_SRC,
  },
);
export const instrumentsFor = (scenario: string): Instrument[] => INSTRUMENTS.filter((i) => (scenario === 'moon' ? i.world === 'moon' : !i.world));

export const MOON_OBJECTIVES: Objective[] = [
  { id: 'ice', name: 'Find the hydrogen', question: 'Where is hydrogen buried at the south pole, and how much?', needs: 'A neutron detector and many months of counting', weight: 30, instruments: ['lend', 'mns'], segments: [] },
  { id: 'cold', name: 'Map the cold traps', question: 'Which crater floors stay cold enough to keep ice for billions of years?', needs: 'The thermal radiometer through most of a year of seasons', weight: 20, instruments: ['diviner'], segments: [] },
  { id: 'dark', name: 'Chart the dark craters', question: 'What is the shape of the ground where sunlight never reaches?', needs: 'The laser altimeter, or the radar for a rougher answer', weight: 20, instruments: ['lola', 'minirf'], segments: [] },
  { id: 'under', name: 'Look under the surface', question: 'Is there ice mixed into the top metre of soil?', needs: 'The imaging radar', weight: 15, instruments: ['minirf'], segments: [] },
  { id: 'site', name: 'Certify a landing site', question: 'Is there a flat, boulder-free place to land next to the ice?', needs: 'The mapping camera. The laser altimeter adds slopes', weight: 15, instruments: ['lroc'], segments: [] },
];
export const objectivesFor = (scenario: string): Objective[] => (scenario === 'moon' ? MOON_OBJECTIVES : OBJECTIVES);

export interface MoonOrbit extends Standoff { skMsYr: number }
// The 50 km case follows LRO, which held that orbit with monthly burns from a
// 1,263 m/s propellant budget. The other two rates are game values: lumps in
// the Moon's gravity pull low orbits out of shape faster.
export const MOON_ORBITS: MoonOrbit[] = [
  { id: 'far', name: '100 km orbit', km: 100, dvKmS: 0, risk: 0.003, skMsYr: 40, what: 'Stable and cheap to hold. Every instrument sees a patch twice as wide as from 50 km.' },
  { id: 'mid', name: '50 km orbit', km: 50, dvKmS: 0, risk: 0.01, skMsYr: 150, what: 'Where Lunar Reconnaissance Orbiter mapped. Needs a correcting burn every month.' },
  { id: 'close', name: '30 km orbit', km: 30, dvKmS: 0, risk: 0.03, skMsYr: 400, what: 'The sharpest view. The Moon\'s lumpy gravity drags the orbit down, so it burns fuel fast.' },
];
export const MOON = {
  src: LRO_ORBIT_SRC,
  transitDays: 5, // LRO flew a four to five day minimum-energy transfer
  commissionDays: 30, // check-out before mapping starts (game value)
  deadlineJd: jdFromDate(2029, 7, 1), // game premise: the landing site is chosen on this date
  earthKmMin: 363300, earthKmMax: 405500, // the Moon's distance at perigee and apogee
  // Total lunar eclipses: Earth's shadow covers the Moon, and a spacecraft
  // there loses the Sun. Hours are the umbral phase from the NASA tables.
  eclipses: [
    { id: 'e2812', name: '31 December 2028', jd: jdFromDate(2028, 12, 31) + 16.89 / 24, hours: 3.48 },
    { id: 'e2906', name: '26 June 2029', jd: jdFromDate(2029, 6, 26) + 3.39 / 24, hours: 3.67 },
    { id: 'e2912', name: '20 December 2029', jd: jdFromDate(2029, 12, 20) + 22.72 / 24, hours: 3.55 },
  ],
  eclipseSrc: ECLIPSE_SRC,
  // Published LRO figures, for the debrief comparison and the checks
  lro: { wetKg: 1916, dryKg: 1018, fuelKg: 898, dvMs: 1263, powerW: 685, altKm: 50, periodMin: 113, speedKmS: 1.6, costM: 500, gbPerDay: 572, camResM: 0.5, neutronKm: 10 },
};
