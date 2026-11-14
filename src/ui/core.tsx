import { ReactNode, useState, createContext, useContext } from 'react';
import { ADCS, ANTENNAS, BATTERIES, BRIEFS, CLASSES, FLYBY_PASSES, GLOSSARY, INSTRUMENTS, MOON, MOON_OBJECTIVES, MOON_ORBITS, OBJECTIVES, PROPS, RADIOS, REDUNDANCY, ROCKETS, STANDOFFS, STORAGES, Src, TESTS, briefOf } from '../sim/data';
import { fmtDate } from '../sim/astro';
import { Budgets, CONSOLES, ConsoleId, Design, Finding, defaultDesign } from '../sim/design';
import { Calls, FlightResult, GateRecord, McResult } from '../sim/flight';

export type Depth = 'cadet' | 'engineer' | 'chief';
export type Stage = 'setup' | 'pitch' | 'route' | 'build' | 'test' | 'fly' | 'debrief';

export interface Game {
  stage: Stage;
  reached: number; // furthest step unlocked
  depth: Depth;
  players: string[];
  seed: number;
  mission: string;
  design: Design;
  gates: GateRecord[];
  mc: McResult | null;
  mcKey: string;
  result: FlightResult | null;
  calls: Calls; // choices made at in-flight decision points
  flight: number; // counts launches, so each flight plays from the start
  history: Run[]; // earlier flights, for comparison
}

/** One finished flight, kept so the next attempt can be compared with it. */
export interface Run {
  flight: number;
  seed: number;
  design: Design;
  total: number;
  science: number;
  costM: number;
  headline: string;
}

export function headlineOf(res: FlightResult, target: number): string {
  const frac = res.sciencePoints / target;
  return !res.launched ? 'Never flew' : res.lost ? 'Mission lost' : frac >= 0.85 ? 'Mission success' : frac >= 0.5 ? 'Partial success' : 'Science fell short';
}

export const STEPS: { id: Stage; phase: string; name: string; gate: string; next: string }[] = [
  { id: 'pitch', phase: 'Pre-A', name: 'Pitch', gate: 'KDP A', next: 'Phase A: choose the route' },
  { id: 'route', phase: 'Phase A', name: 'Route', gate: 'KDP B', next: 'Phase B: design the spacecraft' },
  { id: 'build', phase: 'Phase B', name: 'Design', gate: 'KDP C', next: 'Phase C and D: build and test' },
  { id: 'test', phase: 'Phase C/D', name: 'Build + test', gate: 'Launch poll', next: 'Launch' },
  { id: 'fly', phase: 'Phase E', name: 'Fly', gate: '', next: '' },
  { id: 'debrief', phase: 'Phase F', name: 'Debrief', gate: '', next: '' },
];

export function newGame(): Game {
  return {
    stage: 'setup', reached: 0, depth: 'cadet', players: ['Flight'], seed: 1 + Math.floor(Math.random() * 99999),
    mission: 'SENTINEL', design: defaultDesign('explorer'), gates: [], mc: null, mcKey: '', result: null,
    calls: {}, flight: 0, history: [],
  };
}

export const DepthContext = createContext<Depth>('cadet');

// ---------- formatting ----------
export const kg = (x: number) => (Math.abs(x) >= 20 ? `${Math.round(x).toLocaleString('en-US')} kg` : `${x.toFixed(1)} kg`);
export const money = (x: number) => `$${x >= 100 ? Math.round(x).toLocaleString('en-US') : x.toFixed(1)}M`;
export const pct = (x: number) => `${Math.round(x * 100)}%`;
export const detail = (m: number) => (!isFinite(m) ? 'none' : m < 1 ? `${Math.round(m * 100)} cm` : `${m.toFixed(1)} m`);
export const rate = (kbps: number) => (kbps >= 1000 ? `${(kbps / 1000).toFixed(1)} Mbps` : `${Math.round(kbps)} kbps`);

// ---------- small pieces ----------
export function Lamp({ s }: { s: 'green' | 'amber' | 'red' | 'good' | 'warn' | 'bad' | 'info' }) {
  const c = s === 'good' ? 'green' : s === 'warn' ? 'amber' : s === 'bad' ? 'red' : s;
  const label = c === 'green' ? 'OK' : c === 'amber' ? 'Caution' : c === 'red' ? 'Problem' : 'Note';
  return <span className={`lamp ${c}`} role="img" aria-label={label} />;
}

export function SrcTag({ src }: { src: Src }) {
  const text = src.kind === 'nasa' ? 'NASA data' : src.kind === 'public' ? 'Published' : 'Game value';
  return src.url ? (
    <a className={`tag ${src.kind}`} href={src.url} target="_blank" rel="noreferrer" title={src.label}>{text}</a>
  ) : (
    <span className={`tag ${src.kind}`} title={src.label}>{text}</span>
  );
}

/** A term the player can tap for an explanation at their chosen depth. */
export function Term({ k, children }: { k: keyof typeof GLOSSARY | string; children: ReactNode }) {
  const depth = useContext(DepthContext);
  const [open, setOpen] = useState(false);
  const g = GLOSSARY[k as string];
  if (!g) return <>{children}</>;
  return (
    <>
      <button type="button" className="term" aria-expanded={open} onClick={() => setOpen(!open)}>{children}</button>
      {open && <span className="explain" style={{ display: 'block', margin: '6px 0' }} role="note">{g[depth]}</span>}
    </>
  );
}

export function Meter(props: { label: string; value: string; fill: number; status: 'green' | 'amber' | 'red'; detail: string; explain?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" className="meter" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="line">
          <span className="label"><Lamp s={props.status} />{props.label}</span>
          <span className="num">{props.value}</span>
        </span>
        <span className="bar"><span className={`fill ${props.status}`} style={{ width: `${Math.max(2, Math.min(100, props.fill * 100))}%` }} /></span>
        <span className="detail">{props.detail}</span>
      </button>
      {open && props.explain && <div className="explain" style={{ marginTop: 6 }}>{props.explain}</div>}
    </div>
  );
}

export function FindingRow({ f }: { f: Finding }) {
  return (
    <div className="finding">
      <Lamp s={f.level} />
      <div>{f.text} <span className="fix">{f.fix}</span></div>
    </div>
  );
}

const st = (ok: boolean, warn: boolean): 'green' | 'amber' | 'red' => (!ok ? 'red' : warn ? 'amber' : 'green');

/** The live budget rail: the six resources the challenge asks to keep in view. */
export function Rail({ b, d }: { b: Budgets; d: Design }) {
  const depth = useContext(DepthContext);
  const chief = depth === 'chief', cadet = depth === 'cadet';
  const m = b.mass, p = b.power, c = b.cost, t = b.time, da = b.data;
  const dataOk = da.genGbDay <= da.downGbDayWorst * 1.02 || da.fillDays >= 5;
  const moon = d.scenario === 'moon';
  return (
    <aside className="rail" aria-label="Mission budgets">
      <div className="panel">
        <h3>Budgets</h3>
        <Meter label="Mass" value={b.traj.ok ? `${kg(m.wet)} / ${kg(m.capacity)}` : 'no route'} fill={m.capacity > 0 ? m.wet / m.capacity : 1}
          status={st(b.traj.ok && m.feasible && m.margin >= 0, m.margin < 0.1)}
          detail={b.traj.ok ? `${pct(Math.max(-9.99, m.margin))} margin on ${b.rocket.name}` : 'Choose dates first'}
          explain={cadet ? 'Fuelled weight against what the rocket can throw. Leave spare room: designs gain weight.' : <>Dry {kg(m.dryPred)} (includes 15% growth allowance) + propellant {kg(m.prop)}.{chief && <> Rocket: m(C3) = {Math.round(b.rocket.p0)}·exp(−C3/{b.rocket.k}) at C3 = {b.traj.c3.toFixed(1)} km²/s².</>}</>} />
        <Meter label="Power" value={`${Math.round(p.worst)} / ${Math.round(p.arrayW)} W`} fill={p.worst / Math.max(1, p.arrayW)}
          status={st(p.margin >= 0, p.margin < 0.2)} detail={`${pct(p.margin)} margin, ${b.arrayM2} m² of panels`}
          explain={cadet ? 'What the spacecraft uses against what its solar panels make at the farthest point from the Sun.' : <>Science mode {Math.round(p.science)} W, downlink mode {Math.round(p.comm)} W, safe mode {Math.round(p.safe)} W. Panels sized at {b.traj.sunAuMax.toFixed(2)} au.{chief && ' P = 270 W/m² × area ÷ distance² × 0.92.'}</>} />
        <Meter label="Data" value={`${da.genGbDay.toFixed(1)} / ${da.downGbDayWorst.toFixed(1)} Gb/day`} fill={da.genGbDay / Math.max(0.01, da.downGbDayWorst)}
          status={st(dataOk, da.genGbDay > da.downGbDayWorst * 1.02)} detail={`${rate(da.kbpsWorst)} at worst, ${rate(da.kbpsBest)} at best`}
          explain={cadet ? 'What the instruments record each day against what the radio can send home.' : <>Earth is {moon ? `${Math.round(da.earthKmMax).toLocaleString('en-US')} km` : `${(da.earthKmMax / 149597870.7).toFixed(2)} au`} away at the farthest point of operations. Recorder holds {da.storageGb} Gb.{chief && ' Rate = EIRP + G/T − path loss + 228.6 − 6 dB.'}</>} />
        <Meter label="Budget" value={`${money(c.total)} / ${money(c.cap)}`} fill={c.total / c.cap}
          status={st(c.margin >= 0, d.reservePct < 15)} detail={`${d.reservePct}% reserve inside the total`}
          explain={<>Hardware {money(c.hardware)}, management and integration {money(c.wraps)}, rocket {money(c.launch)}, operations {money(c.ops)}, tests {money(c.tests)}, network time {money(c.dsn)}, reserve {money(c.reserve)}.</>} />
        {moon ? (
          <Meter label="Time" value={t.slackDays >= 0 ? `${Math.round(t.slackDays)} days spare` : `${Math.round(-t.slackDays)} days too late`} fill={Math.min(1, (b.traj.opsEndJd - briefOf(d.scenario).startJd) / (MOON.deadlineJd - briefOf(d.scenario).startJd))}
            status={st(!b.findings.some((f) => f.id === 'm-late' && f.level === 'red'), t.slackDays < 0)} detail={`${t.devMonths.toFixed(1)} months to build, ${d.months ?? 12} months of mapping`}
            explain={`Time to build, fly and finish mapping, counted from ${fmtDate(briefOf(d.scenario).startJd)}, against ${fmtDate(MOON.deadlineJd)}, the day the landing site is chosen (a game premise). Data sent later does not count.`} />
        ) : (
          <Meter label="Time" value={b.traj.ok ? `${Math.round(t.slackDays)} days slack` : 'no route'} fill={b.traj.ok ? Math.min(1, t.devMonths * 30.44 / Math.max(1, t.devMonths * 30.44 + t.slackDays)) : 1}
            status={st(!b.traj.ok || t.slackDays >= 0, t.slackDays < 30)} detail={`${t.devMonths.toFixed(1)} months to build, ${t.missionMonths.toFixed(0)} months to fly`}
            explain={`Time to design, build and test, counted from ${fmtDate(briefOf(d.scenario).startJd)}, against your launch date. Apophis will not wait.`} />
        )}
        <Meter label="Delta-v" value={`${(b.dv.needed * 1000).toFixed(0)} m/s`} fill={Math.min(1, b.dv.needed / 6)}
          status={st(m.feasible, b.dv.needed > 3.5)} detail={`${kg(m.prop)} of propellant at ${b.dv.ispS} s`}
          explain={cadet ? `Total change of speed after launch. Braking ${moon ? 'into orbit around the Moon' : 'to stay with Apophis'} is the biggest part.` : <>Braking {(b.traj.dvArrive * 1000).toFixed(0)} m/s + operations {(b.traj.dvOps * 1000).toFixed(0)} m/s + 10% margin.{chief && ' Δv = Isp·g₀·ln(m₀/m_f).'}</>} />
      </div>
      <div className="panel">
        <h3>Consoles</h3>
        {CONSOLES.map((k) => (
          <div className="row" key={k.id} style={{ gap: 8 }}>
            <Lamp s={b.consoles[k.id]} />
            <span style={{ fontWeight: 700 }}>{k.name}</span>
            <span className="muted small">{((n) => (n === 0 ? 'no findings' : n === 1 ? '1 finding' : `${n} findings`))(b.findings.filter((f) => f.console === k.id).length)}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}

// ---------- the GO / NO-GO poll ----------
export function consoleOwners(players: string[]): (number | null)[] {
  if (players.length <= 1) return [null, null, null, null];
  if (players.length === 2) return [0, 1, 0, 1];
  if (players.length === 3) return [0, 1, 2, null];
  return [0, 1, 2, 3];
}

export function Poll(props: { gate: string; next: string; b: Budgets; players: string[]; onPass: (g: GateRecord) => void; onFix: () => void }) {
  const { b, players } = props;
  const owners = consoleOwners(players);
  const [votes, setVotes] = useState<Record<string, 'go' | 'nogo' | undefined>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const rows = CONSOLES.map((c, i) => {
    const mine = b.findings.filter((f) => f.console === c.id);
    const auto = owners[i] === null;
    const autoVote: 'go' | 'nogo' = b.consoles[c.id] === 'red' ? 'nogo' : 'go';
    const vote = auto ? autoVote : votes[c.id];
    return { c, mine, auto, vote, owner: auto ? 'Auto' : players[owners[i]!] };
  });
  const waiting = rows.filter((r) => !r.vote).length;
  const nogo = rows.filter((r) => r.vote === 'nogo').length;
  const record = (overrides: number): GateRecord => ({
    gate: props.gate,
    votes: rows.map((r) => ({ console: r.c.name, vote: r.vote ?? 'go', by: r.auto ? 'auto' : 'player', reason: r.auto ? (r.mine[0]?.text ?? 'No findings.') : (reasons[r.c.id] ?? '') })),
    redOpen: b.findings.filter((f) => f.level === 'red').length,
    amberOpen: b.findings.filter((f) => f.level === 'amber').length,
    overrides,
  });
  return (
    <section className="poll" aria-label={`${props.gate} poll`}>
      <div className="head">
        <span className="eyebrow">{props.gate} · every console reports</span>
        <h2>Go / No-Go poll</h2>
        <p className="muted">{players.length > 1 ? 'Each console owner votes. One NO-GO holds the mission until it is fixed or the team overrules it.' : 'You are the flight director. The consoles report; the call is yours.'}</p>
      </div>
      <div className="consoles">
        {rows.map((r) => (
          <div className="console" key={r.c.id}>
            <header>
              <span className="cname">{r.c.name}</span>
              <Lamp s={b.consoles[r.c.id as ConsoleId]} />
            </header>
            <span className="muted small">{r.owner} · {r.c.owns}</span>
            {r.mine.length === 0 && <span className="small">No findings.</span>}
            {r.mine.map((f) => <FindingRow f={f} key={f.id} />)}
            {r.auto ? (
              <div className="votes"><span className={`vote ${r.vote}`} aria-pressed="true" style={{ textAlign: 'center' }}>{r.vote === 'go' ? 'GO' : 'NO-GO'}</span></div>
            ) : (
              <>
                <input type="text" id={`why-${r.c.id}`} aria-label={`${r.c.name} reason`} placeholder="One-line reason" value={reasons[r.c.id] ?? ''} onChange={(e) => setReasons({ ...reasons, [r.c.id]: e.target.value })} />
                <div className="votes">
                  <button type="button" className="vote go" aria-pressed={r.vote === 'go'} onClick={() => setVotes({ ...votes, [r.c.id]: 'go' })}>GO</button>
                  <button type="button" className="vote nogo" aria-pressed={r.vote === 'nogo'} onClick={() => setVotes({ ...votes, [r.c.id]: 'nogo' })}>NO-GO</button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
      {waiting > 0 ? (
        <p className="muted">Waiting for {waiting} vote{waiting > 1 ? 's' : ''}.</p>
      ) : nogo > 0 ? (
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="verdict nogo">No-Go</div>
          <div className="row">
            <button type="button" className="btn" onClick={props.onFix}>Go back and fix it</button>
            <button type="button" className="btn ghost" onClick={() => props.onPass(record(nogo))}>Overrule and proceed</button>
          </div>
        </div>
      ) : (
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="verdict go">Go</div>
          <div className="row">
            <button type="button" className="btn ghost" onClick={props.onFix}>Keep working</button>
            <button type="button" className="btn" onClick={() => props.onPass(record(0))}>{props.next}</button>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------- what changed between two designs
export function diffDesign(a: Design, b: Design): string[] {
  const out: string[] = [];
  const nm = <T extends { id: string; name: string }>(list: T[], id: string) => list.find((x) => x.id === id)?.name ?? id;
  const swap = <T extends { id: string; name: string }>(label: string, list: T[], x: string, y: string) => { if (x !== y) out.push(`${label}: ${nm(list, x)} → ${nm(list, y)}`); };
  const sets = <T extends { id: string; name: string }>(label: string, list: T[], x: string[], y: string[]) => {
    for (const id of y) if (!x.includes(id)) out.push(`+ ${label}${nm(list, id)}`);
    for (const id of x) if (!y.includes(id)) out.push(`− ${label}${nm(list, id)}`);
  };
  swap('Mission', BRIEFS, a.scenario, b.scenario);
  swap('Class', CLASSES, a.klass, b.klass);
  if (a.missionType !== b.missionType) out.push(b.missionType === 'flyby' ? 'Rendezvous → flyby' : 'Flyby → rendezvous');
  const moon = b.scenario === 'moon';
  if (!moon && Math.abs(a.launchJd - b.launchJd) >= 1) out.push(`Launch ${fmtDate(a.launchJd)} → ${fmtDate(b.launchJd)}`);
  if (!moon && Math.abs(a.arriveJd - b.arriveJd) >= 1) out.push(`Arrival ${fmtDate(a.arriveJd)} → ${fmtDate(b.arriveJd)}`);
  if (moon && (a.months ?? 12) !== (b.months ?? 12)) out.push(`Mapping ${a.months ?? 12} → ${b.months ?? 12} months`);
  if (a.standoff !== b.standoff || a.missionType !== b.missionType) {
    const la = moon ? MOON_ORBITS : a.missionType === 'flyby' ? FLYBY_PASSES : STANDOFFS, lb = moon ? MOON_ORBITS : b.missionType === 'flyby' ? FLYBY_PASSES : STANDOFFS;
    out.push(`${moon ? 'Orbit' : 'Distance'}: ${nm(la, a.standoff)} → ${nm(lb, b.standoff)}`);
  }
  swap('Rocket', ROCKETS, a.rocket, b.rocket);
  sets('objective: ', [...OBJECTIVES, ...MOON_OBJECTIVES], a.objectives, b.objectives);
  sets('', INSTRUMENTS, a.instruments, b.instruments);
  swap('Antenna', ANTENNAS, a.antenna, b.antenna);
  swap('Transmitter', RADIOS, a.radio, b.radio);
  swap('Recorder', STORAGES, a.storage, b.storage);
  swap('Propulsion', PROPS, a.prop, b.prop);
  swap('Pointing', ADCS, a.adcs, b.adcs);
  swap('Battery', BATTERIES, a.battery, b.battery);
  if (a.redundancy !== b.redundancy) out.push(`Backups: ${REDUNDANCY[a.redundancy].name} → ${REDUNDANCY[b.redundancy].name}`);
  if (a.reservePct !== b.reservePct) out.push(`Cost reserve ${a.reservePct}% → ${b.reservePct}%`);
  if (a.dsnHoursPerDay !== b.dsnHoursPerDay) out.push(`Network time ${a.dsnHoursPerDay} → ${b.dsnHoursPerDay} h a day`);
  if (a.autoArray !== b.autoArray || (!b.autoArray && a.arrayM2 !== b.arrayM2)) out.push(b.autoArray ? 'Solar panels sized automatically' : `Solar panels set to ${b.arrayM2} m²`);
  sets('test: ', TESTS, a.tests, b.tests);
  return out;
}

// ---------- best flights on this device
export interface Best {
  mission: string;
  crew: string;
  brief: string;
  klass: string;
  total: number;
  headline: string;
  when: string;
  code: string;
}
const BEST_KEY = 'go-no-go-best-v1';
export function loadBest(): Best[] {
  try {
    const list = JSON.parse(localStorage.getItem(BEST_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((x) => x && typeof x.total === 'number' && typeof x.code === 'string').slice(0, 8) : [];
  } catch {
    return [];
  }
}
export function saveBest(entry: Best): void {
  try {
    const list = [...loadBest().filter((x) => x.code !== entry.code || x.total > entry.total), entry]
      .filter((x, k, all) => all.findIndex((y) => y.code === x.code) === k)
      .sort((x, y) => y.total - x.total)
      .slice(0, 8);
    localStorage.setItem(BEST_KEY, JSON.stringify(list));
  } catch {
    /* the board is optional */
  }
}

// ---------- share codes ----------
export function encodeShare(g: Game): string {
  try {
    return btoa(unescape(encodeURIComponent(JSON.stringify({ v: 1, d: g.design, s: g.seed, m: g.mission }))));
  } catch {
    return '';
  }
}
export function decodeShare(code: string): { design: Design; seed: number; mission: string } | null {
  try {
    const o = JSON.parse(decodeURIComponent(escape(atob(code.trim()))));
    if (o && o.v === 1 && o.d && typeof o.s === 'number') return { design: { ...defaultDesign(o.d.klass, o.d.scenario), ...o.d }, seed: o.s, mission: String(o.m ?? 'SENTINEL').slice(0, 24) };
  } catch {
    /* not a valid code */
  }
  return null;
}
