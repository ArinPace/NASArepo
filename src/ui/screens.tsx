import { ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { C_KM_S, fmtDate, jdFromDate } from '../sim/astro';
import {
  ADCS, ANTENNAS, APOPHIS, ARRAY, BATTERIES, BRIEFS, CLASSES, DATA_CHECKED, FLYBY_PASSES, INSTRUMENTS, OBJECTIVES, PROPS, RADIOS, RAMSES_SRC,
  REDUNDANCY, RISK_CLASS_SRC, ROCKETS, Redundancy, STANDOFFS, STORAGES, TESTS, rocketCapacityKg, Choice, briefOf,
} from '../sim/data';
import { Check, runChecks } from '../sim/checks';
import { Budgets, CONSOLES, Design, LAST_ARRIVAL_JD, MIN_TOF_DAYS, SnowballStep, bestArrival, defaultDesign, earthKmAt, evaluate, snowball } from '../sim/design';
import { FlightResult, McResult, monteCarlo, scoreFlight, simulate } from '../sim/flight';
import { CostCurve, CraftView, LaunchChart, OddsChart, OrbitView, Postcard, RAMP_CSS, Telemetry } from './charts';
import { DepthContext, FindingRow, Game, Lamp, Poll, STEPS, SrcTag, Term, consoleOwners, decodeShare, detail, diffDesign, encodeShare, headlineOf, kg, money, pct, rate } from './core';

type Set = (patch: Partial<Design>) => void;
const todayJd = () => Date.now() / 86400000 + 2440587.5;

function Head({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <div className="head">
      <span className="eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      {children && <p className="lede">{children}</p>}
    </div>
  );
}

// ================================================================ setup
export function Setup({ g, update, start }: { g: Game; update: (p: Partial<Game>) => void; start: () => void }) {
  const [code, setCode] = useState('');
  const [bad, setBad] = useState(false);
  const now = todayJd();
  const days = Math.max(0, Math.round(APOPHIS.flybyJd - now));
  const setPlayer = (i: number, name: string) => update({ players: g.players.map((p, k) => (k === i ? name : p)) });
  return (
    <div className="work">
      <section className="hero">
        <div className="head" style={{ gap: 16 }}>
          <span className="eyebrow">A space mission design game on real NASA and JPL data</span>
          <h1><span className="go">Go</span> / <span className="nogo">No-Go</span></h1>
          <p className="lede">Design a real mission to asteroid Apophis. Defend it at four review gates. Fly it, then find out which decision made the difference.</p>
          <p className="countdown"><b>{days.toLocaleString('en-US')}</b> days until Apophis passes 32,000 km above Earth on 13 April 2029. <SrcTag src={APOPHIS.flybySrc} /></p>
        </div>
        <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <OrbitView launchJd={g.design.launchJd} arriveJd={g.design.arriveJd} nowJd={now} size={340} arc={false} />
          <figcaption className="small muted">Earth and Apophis today, from published orbital elements. The red ring marks where they meet. <SrcTag src={APOPHIS.elementsSrc} /></figcaption>
        </figure>
      </section>
      <section className="panel">
        <h3>Choose your mission</h3>
        <div className="grid two">
          {BRIEFS.map((x) => (
            <button type="button" key={x.id} className="card" aria-pressed={g.design.scenario === x.id}
              onClick={() => g.design.scenario !== x.id && update({ design: defaultDesign(x.klass, x.id), mc: null, mcKey: '', gates: [], reached: 0 })}>
              <span className="name">{x.name} <span className="tag">{x.tag}</span></span>
              <span>{x.blurb}</span>
              <span className="what">{x.twist}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="panel">
        <h3>Crew</h3>
        <div className="grid">
          <label>Mission name<input id="mission-name" type="text" maxLength={24} value={g.mission} onChange={(e) => update({ mission: e.target.value.toUpperCase() })} /></label>
          {g.players.map((p, i) => (
            <label key={i}>{g.players.length === 1 ? 'Flight director' : `Player ${i + 1}`}<input id={`player-${i}`} type="text" maxLength={16} value={p} onChange={(e) => setPlayer(i, e.target.value)} /></label>
          ))}
        </div>
        <div className="row">
          {g.players.length < 4 && <button type="button" className="btn ghost small" onClick={() => update({ players: [...g.players, `Player ${g.players.length + 1}`] })}>Add a player</button>}
          {g.players.length > 1 && <button type="button" className="btn ghost small" onClick={() => update({ players: g.players.slice(0, -1) })}>Remove a player</button>}
          <span className="muted small">{g.players.length === 1 ? 'Solo: you make every call and the consoles advise you.' : `${g.players.length} players share one screen. Each owns a console and votes at every gate.`}</span>
        </div>
      </section>
      <section className="panel">
        <h3>How deep do you want to go?</h3>
        <div className="grid">
          {([['cadet', 'Cadet', 'Plain words and traffic lights. No formulas.'], ['engineer', 'Engineer', 'Numbers, units and where they come from.'], ['chief', 'Chief engineer', 'The equations behind every meter.']] as const).map(([id, name, what]) => (
            <button type="button" key={id} className="card" aria-pressed={g.depth === id} onClick={() => update({ depth: id })}>
              <span className="name">{name}</span><span className="what">{what}</span>
            </button>
          ))}
        </div>
        <p className="muted small">You can switch at any time. Tap any dotted word in the game for an explanation.</p>
      </section>
      <div className="row">
        <button type="button" className="btn" onClick={start}>Begin Pre-Phase A</button>
        <label style={{ flex: 1, minWidth: 220 }}>Or load a shared mission code
          <input id="share-in" type="text" value={code} onChange={(e) => { setCode(e.target.value); setBad(false); }} placeholder="Paste a code" />
        </label>
        <button type="button" className="btn ghost small" disabled={!code.trim()} onClick={() => {
          const s = decodeShare(code);
          if (s) update({ design: s.design, seed: s.seed, mission: s.mission, stage: 'build', reached: 3, mc: null, result: null, gates: [] });
          else setBad(true);
        }}>Load</button>
        {bad && <span className="small" role="alert">That code could not be read. Check that all of it was copied.</span>}
      </div>
      <Validation />
    </div>
  );
}

/** Runs the model against published values in the player's own browser. */
function Validation() {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const good = checks ? checks.filter((c) => c.ok).length : 0;
  return (
    <section className="panel">
      <h3>How real is this?</h3>
      <p className="muted small">The orbits, launch windows, rocket, solar panel and radio models are compared with published numbers. Press the button and your browser repeats every comparison now, with nothing looked up.</p>
      <div className="row">
        <button type="button" className="btn ghost small" onClick={() => setChecks(runChecks())}>{checks ? 'Run the checks again' : 'Run the checks'}</button>
        {checks && <span className="small" role="status"><Lamp s={good === checks.length ? 'green' : 'amber'} /> {good} of {checks.length} agree with the published values.</span>}
      </div>
      {checks && (
        <div className="chart-wrap">
          <table>
            <thead><tr><th></th><th>Check</th><th>This game computes</th><th>Published</th><th>Source</th></tr></thead>
            <tbody>
              {checks.map((c) => (
                <tr key={c.what}>
                  <td><Lamp s={c.ok ? 'green' : 'red'} /></td>
                  <td>{c.what}{c.note && <div className="small muted">{c.note}</div>}</td>
                  <td className="num">{c.ours}</td><td className="num">{c.published}</td><td><SrcTag src={c.src} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ================================================================ pitch
export function Pitch({ d, set, setDesign }: { d: Design; set: Set; setDesign: (d: Design) => void }) {
  const klass = CLASSES.find((c) => c.id === d.klass)!;
  const brief = briefOf(d.scenario);
  const target = Math.round(klass.scienceTarget * brief.targetMult);
  const points = OBJECTIVES.filter((o) => d.objectives.includes(o.id)).reduce((s, o) => s + o.weight, 0);
  return (
    <>
      <Head eyebrow="Pre-Phase A · concept studies" title="Pitch the mission">
        On 13 April 2029 a 340-metre asteroid passes closer to Earth than our television satellites. Earth's gravity will stretch it, shake it and bend its path. What do you want to learn, and how big a mission will you ask for?
      </Head>
      <section className="panel">
        <h3>Mission class <SrcTag src={RISK_CLASS_SRC} /></h3>
        <div className="grid two">
          {CLASSES.map((c) => (
            <button type="button" key={c.id} className="card" aria-pressed={d.klass === c.id} onClick={() => d.klass !== c.id && setDesign({ ...defaultDesign(c.id, d.scenario), objectives: d.objectives })}>
              <span className="name">{c.name} <span className="tag">{c.nasaClass}</span></span>
              <span className="facts num"><span>cap {money(c.capM)}</span><span>{c.devMonths} months to build</span></span>
              <span className="what">{c.blurb}</span>
            </button>
          ))}
        </div>
        <p className="muted small">{brief.name}: building starts on {fmtDate(brief.startJd)}. A {klass.name} cannot launch before {fmtDate(brief.startJd + klass.devMonths * 30.44)}. Cost caps and build times are game values.</p>
      </section>
      <section className="panel">
        <h3>Science objectives <span className="num">{points} points chosen · {target} is a full score for a {klass.name}</span></h3>
        <div className="grid two">
          {OBJECTIVES.map((o) => {
            const on = d.objectives.includes(o.id);
            return (
              <button type="button" key={o.id} className="card" role="checkbox" aria-checked={on} onClick={() => set({ objectives: on ? d.objectives.filter((x) => x !== o.id) : [...d.objectives, o.id] })}>
                <span className="name">{o.name} <span className="tag">{o.weight} points</span></span>
                <span>{o.question}</span>
                <span className="what">Needs: {o.needs}.</span>
              </button>
            );
          })}
        </div>
      </section>
      <section className="panel">
        <h3>Science traceability</h3>
        <p className="muted small">NASA proposals must show how each goal traces down to an instrument. This is yours.</p>
        <div className="chart-wrap">
          <table>
            <thead><tr><th>Objective</th><th>Must observe</th><th>Instruments that can do it</th></tr></thead>
            <tbody>
              {OBJECTIVES.filter((o) => d.objectives.includes(o.id)).map((o) => (
                <tr key={o.id}><td>{o.name}</td><td>{o.segments.join(', ')} the flyby</td><td>{o.instruments.map((i) => INSTRUMENTS.find((x) => x.id === i)!.name).join(' or ')}</td></tr>
              ))}
              {d.objectives.length === 0 && <tr><td colSpan={3} className="muted">Pick an objective above.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

// ================================================================ route
export function Route({ d, b, set }: { d: Design; b: Budgets; set: Set }) {
  const t = b.traj;
  const stands = d.missionType === 'rendezvous' ? STANDOFFS : FLYBY_PASSES;
  const nudge = (dl: number, da: number) => {
    const l = d.launchJd + dl;
    set({ launchJd: l, arriveJd: Math.min(LAST_ARRIVAL_JD, Math.max(l + MIN_TOF_DAYS, d.arriveJd + da)) });
  };
  const light = t.ok ? earthKmAt(d.arriveJd) / C_KM_S : 0;
  return (
    <>
      <Head eyebrow="Phase A · concept and technology development" title="Choose the route">
        Every square on this chart is a real trip: leave Earth on one date, reach Apophis on another. The positions come from published orbits, so the good dates here are the good dates in real life.
      </Head>
      <section className="panel">
        <h3>Stop or fly past?</h3>
        <div className="grid two">
          <button type="button" className="card" aria-pressed={d.missionType === 'rendezvous'} onClick={() => set({ missionType: 'rendezvous', standoff: 'mid' })}>
            <span className="name">Rendezvous</span><span className="what">Brake to match the asteroid's speed and stay with it through the flyby. Costs propellant.</span>
          </button>
          <button type="button" className="card" aria-pressed={d.missionType === 'flyby'} onClick={() => set({ missionType: 'flyby', standoff: 'mid' })}>
            <span className="name">Flyby</span><span className="what">Shoot past without braking. Cheap and light, but the encounter lasts minutes.</span>
          </button>
        </div>
      </section>
      <section className="panel">
        <h3>Launch chart <SrcTag src={APOPHIS.elementsSrc} /></h3>
        <div className="split">
          <div>
            <LaunchChart d={d} readyJd={b.time.readyJd} onPick={(l, a) => set({ launchJd: l, arriveJd: a })} />
            <div className="legend" style={{ marginTop: 8 }}>
              <span>{d.missionType === 'rendezvous' ? 'little braking' : 'gentle launch'}</span>
              <span style={{ width: 120, height: 10, background: RAMP_CSS, display: 'inline-block' }} />
              <span>{d.missionType === 'rendezvous' ? '7 km/s of braking' : 'hard launch'}</span>
              <span>◇ where ESA's Ramses flies <SrcTag src={RAMSES_SRC} /></span>
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <button type="button" className="btn ghost small" onClick={() => nudge(-5, 0)}>Launch 5 days earlier</button>
              <button type="button" className="btn ghost small" onClick={() => nudge(5, 0)}>Launch 5 days later</button>
              <button type="button" className="btn ghost small" onClick={() => nudge(0, -5)}>Arrive 5 days earlier</button>
              <button type="button" className="btn ghost small" onClick={() => nudge(0, 5)}>Arrive 5 days later</button>
              <button type="button" className="btn ghost small" onClick={() => set({ arriveJd: bestArrival(d.launchJd, d.missionType === 'flyby' ? -6 : 20) })}>Best arrival for this launch</button>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <table>
              <tbody>
                <tr><td>Launch</td><td className="r num">{fmtDate(d.launchJd)}</td></tr>
                <tr><td>Arrive</td><td className="r num">{fmtDate(d.arriveJd)}</td></tr>
                <tr><td>Flight time</td><td className="r num">{Math.round(d.arriveJd - d.launchJd)} days</td></tr>
                <tr><td><Term k="c3">Launch energy</Term></td><td className="r num">{t.ok ? `${t.c3.toFixed(1)} km²/s²` : '—'}</td></tr>
                <tr><td><Term k="vinf">Arrival speed</Term></td><td className="r num">{t.ok ? `${t.vinfArr.toFixed(2)} km/s` : '—'}</td></tr>
                <tr><td><Term k="dv">Delta-v after launch</Term></td><td className="r num">{t.ok ? `${(t.dvTotal * 1000).toFixed(0)} m/s` : '—'}</td></tr>
                {d.missionType === 'rendezvous' && <tr><td>At Apophis before the flyby</td><td className="r num">{t.ok ? `${Math.round(t.beforeDays)} days` : '—'}</td></tr>}
                <tr><td>Radio delay on arrival</td><td className="r num">{t.ok ? (light >= 60 ? `${Math.floor(light / 60)} min ${Math.round(light % 60)} s` : `${Math.round(light)} s`) : '—'}</td></tr>
              </tbody>
            </table>
            {!t.ok && <div className="finding"><Lamp s="red" /><div>{t.why}</div></div>}
            <OrbitView launchJd={d.launchJd} arriveJd={d.arriveJd} size={300} />
          </div>
        </div>
      </section>
      <section className="panel">
        <h3>{d.missionType === 'rendezvous' ? 'How close will you fly?' : 'How close will you pass?'} {d.missionType === 'rendezvous' && <SrcTag src={{ label: 'Distances follow the Ramses plan: 20 km down to 1 km before the flyby, 5 km during it.', url: 'https://pd.jaxa.jp/articles/en/pd_and_ramses_en.html', kind: 'public' }} />}</h3>
        <div className="grid">
          {stands.map((s) => (
            <button type="button" key={s.id} className="card" aria-pressed={d.standoff === s.id} onClick={() => set({ standoff: s.id })}>
              <span className="name">{s.name}</span><span className="what">{s.what}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="panel">
        <h3>Rocket</h3>
        <div className="grid two">
          {ROCKETS.map((r) => {
            const cap = t.ok ? rocketCapacityKg(r, t.c3) : 0;
            const fits = cap >= b.mass.wet;
            return (
              <button type="button" key={r.id} className="card" aria-pressed={d.rocket === r.id} onClick={() => set({ rocket: r.id })}>
                <span className="name">{r.name} <Lamp s={!t.ok ? 'info' : fits ? 'green' : 'red'} /></span>
                <span className="facts num"><span>{money(r.priceM)}</span><span>lifts {kg(cap)} on these dates</span></span>
                <span className="what">{r.blurb}</span>
                <span className="row" style={{ gap: 6 }}><SrcTag src={r.src} /></span>
              </button>
            );
          })}
        </div>
        <p className="muted small">Your spacecraft currently weighs {kg(b.mass.wet)} fuelled. That changes with every part you add in Phase B.</p>
      </section>
    </>
  );
}

// ================================================================ build
function Options<T extends Choice>({ title, list, value, onPick, extra }: { title: string; list: T[]; value: string; onPick: (id: string) => void; extra?: (x: T) => string }) {
  return (
    <section className="panel">
      <h3>{title}</h3>
      <div className="grid">
        {list.map((x) => (
          <button type="button" key={x.id} className="card" aria-pressed={value === x.id} onClick={() => onPick(x.id)}>
            <span className="name">{x.name}</span>
            <span className="facts num"><span>{x.massKg} kg</span>{x.powerW > 0 && <span>{x.powerW} W</span>}<span>{money(x.costM)}</span>{extra && <span>{extra(x)}</span>}</span>
            <span className="what">{x.what}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function Thousand({ d, b, mc, stale, run, set }: { d: Design; b: Budgets; mc: McResult | null; stale: boolean; run: () => void; set: Set }) {
  const depth = useContext(DepthContext);
  return (
    <section className="panel">
      <h3>A thousand flights</h3>
      <p className="muted small">The game flies this exact design 1,000 times with different luck: launch failures, stuck panels, solar storms, late parts, cost growth. Real projects do the same before they commit.</p>
      <div className="row">
        <button type="button" className="btn small" onClick={run}>{mc && !stale ? 'Fly 1,000 again' : 'Fly this design 1,000 times'}</button>
        {mc && stale && <span className="small"><Lamp s="amber" /> The design changed since the last run.</span>}
      </div>
      {mc && (
        <div className="split" style={{ opacity: stale ? 0.5 : 1 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="row" style={{ gap: 24 }}>
              <div><div className="score" style={{ fontSize: '3.4rem', color: mc.success >= 0.8 ? 'var(--go)' : mc.success >= 0.5 ? 'var(--hold)' : 'var(--nogo)' }}>{pct(mc.success)}</div><div className="small muted">succeed</div></div>
              <div><div className="score" style={{ fontSize: '3.4rem' }}>{pct(mc.survive)}</div><div className="small muted">survive</div></div>
            </div>
            <div className="chart-wrap"><OddsChart mc={mc} /></div>
            <p className="small muted">Success means the spacecraft survives and returns at least half the science a {b.klass.name} should.</p>
            {mc.problems.length > 0 && (
              <table><thead><tr><th>What went wrong most often</th><th className="r">Flights</th></tr></thead>
                <tbody>{mc.problems.map((p) => <tr key={p.title}><td>{p.title}</td><td className="r num">{pct(p.share)}</td></tr>)}</tbody></table>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="chart-wrap"><CostCurve mc={mc} capM={b.cost.cap} budgetM={b.cost.total} /></div>
            <p className="small">
              <b>The 70% rule.</b> NASA policy recommends budgeting large projects at the cost that 70% of simulated outcomes stay under. <SrcTag src={{ label: 'NASA joint cost and schedule confidence level policy, as described by Prince and Smart', url: 'https://ntrs.nasa.gov/api/citations/20180005523/downloads/20180005523.pdf', kind: 'nasa' }} /><br />
              For this design that is <span className="num">{money(mc.cost70)}</span>. Your budget with reserve is <span className="num">{money(b.cost.total)}</span>, which covers <span className="num">{pct(mc.costCurve.filter((p) => p.costM <= b.cost.total).length ? mc.costCurve.filter((p) => p.costM <= b.cost.total).slice(-1)[0].share : 0.05)}</span> of outcomes.
              {depth !== 'cadet' && ` ${pct(mc.costConfidence)} of flights finish under the ${money(b.cost.cap)} cap.`}
            </p>
            <label>Cost reserve: {d.reservePct}%<input id="reserve" type="range" min={0} max={40} step={5} value={d.reservePct} onChange={(e) => set({ reservePct: Number(e.target.value) })} /></label>
          </div>
        </div>
      )}
    </section>
  );
}

export function Build({ d, b, set, ripple }: { d: Design; b: Budgets; set: Set; ripple: SnowballStep[] }) {
  const toggle = (id: string) => set({ instruments: d.instruments.includes(id) ? d.instruments.filter((x) => x !== id) : [...d.instruments, id] });
  return (
    <>
      <Head eyebrow="Phase B · preliminary design" title="Design the spacecraft">
        Add a part and watch what it drags along with it. A heavier camera needs more power, bigger panels, more structure, more propellant and sometimes a bigger rocket.
      </Head>
      <section className="panel">
        <h3>Your spacecraft</h3>
        <div className="split">
          <div className="chart-wrap"><CraftView d={d} b={b} /></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="eyebrow">The snowball · your last change</span>
            {ripple.length === 0 ? <p className="muted small">Change something below to see how it ripples through the design.</p> : (
              <div className="ripple" aria-live="polite">
                {ripple.map((s, k) => (
                  <span key={s.label + k} style={{ display: 'contents' }}>
                    {k > 0 && <span className="arrow">→</span>}
                    <span className="step" style={{ animationDelay: `${k * 0.12}s` }}>{s.label} <span className="num">{s.delta > 0 ? '+' : '−'}{s.unit === '$M' ? `$${Math.abs(s.delta).toFixed(1)}M` : `${Math.abs(s.delta) >= 10 ? Math.round(Math.abs(s.delta)) : Math.abs(s.delta).toFixed(1)} ${s.unit}`}</span></span>
                  </span>
                ))}
              </div>
            )}
            <p className="small muted">Picture detail right now: <span className="num">{detail(b.resolutionM)}</span> per pixel from {b.traj.rangeKm} km.</p>
          </div>
        </div>
      </section>
      <section className="panel">
        <h3>Instruments</h3>
        <div className="grid two">
          {INSTRUMENTS.map((i) => (
            <button type="button" key={i.id} className="card" role="checkbox" aria-checked={d.instruments.includes(i.id)} onClick={() => toggle(i.id)}>
              <span className="name">{i.name}</span>
              <span className="facts num"><span>{i.massKg} kg</span><span>{i.powerW} W</span><span>{money(i.costM)}</span><span>{i.dataMbPerHour} Mb/h</span></span>
              <span className="what">{i.what}</span>
              <span className="row" style={{ gap: 6 }}><SrcTag src={i.src} />{i.trl < 7 && <span className="tag" title="Technology readiness level">New tech · TRL {i.trl}</span>}</span>
            </button>
          ))}
        </div>
        <p className="muted small"><Term k="trl">Readiness level</Term> below 7 means the part has never flown. It adds a month to the build and may arrive late.</p>
      </section>
      <Options title="Antenna" list={ANTENNAS} value={d.antenna} onPick={(id) => set({ antenna: id })} extra={(x) => `${x.gainDb} dB`} />
      <Options title="Transmitter" list={RADIOS} value={d.radio} onPick={(id) => set({ radio: id })} extra={(x) => `${x.rfW} W radio power`} />
      <section className="panel">
        <h3>Network time</h3>
        <label>Deep Space Network contact: {d.dsnHoursPerDay} hours a day ({money(b.cost.dsn)} over the mission)
          <input id="dsn" type="range" min={1} max={12} step={1} value={d.dsnHoursPerDay} onChange={(e) => set({ dsnHoursPerDay: Number(e.target.value) })} />
        </label>
        <p className="muted small">The 34 m dishes in California, Spain and Australia are shared with every other deep-space mission. More hours cost more. <Term k="link">Why distance matters</Term></p>
      </section>
      <Options title="Recorder" list={STORAGES} value={d.storage} onPick={(id) => set({ storage: id })} />
      <Options title="Propulsion" list={PROPS} value={d.prop} onPick={(id) => set({ prop: id })} extra={(x) => `${x.ispS} s`} />
      <Options title="Pointing" list={ADCS} value={d.adcs} onPick={(id) => set({ adcs: id })} />
      <section className="panel">
        <h3><Term k="redundancy">Backups</Term></h3>
        <div className="grid">
          {(Object.keys(REDUNDANCY) as Redundancy[]).map((id) => (
            <button type="button" key={id} className="card" aria-pressed={d.redundancy === id} onClick={() => set({ redundancy: id })}>
              <span className="name">{REDUNDANCY[id].name}</span>
              <span className="facts num"><span>mass ×{REDUNDANCY[id].massMult}</span><span>cost ×{REDUNDANCY[id].costMult}</span>{REDUNDANCY[id].months > 0 && <span>+{REDUNDANCY[id].months} mo</span>}</span>
              <span className="what">{REDUNDANCY[id].what}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="panel">
        <h3>Power <SrcTag src={ARRAY.src} /></h3>
        <div className="row">
          <button type="button" className="card" style={{ flex: '1 1 220px' }} aria-pressed={d.autoArray} onClick={() => set({ autoArray: true })}><span className="name">Size panels for me</span><span className="what">Keeps a 30% power margin as the design changes.</span></button>
          <button type="button" className="card" style={{ flex: '1 1 220px' }} aria-pressed={!d.autoArray} onClick={() => set({ autoArray: false, arrayM2: b.arrayM2 })}><span className="name">I will size them</span><span className="what">Set the area yourself and carry the risk.</span></button>
        </div>
        {!d.autoArray && <label>Solar panel area: {d.arrayM2} m²<input id="array" type="range" min={0.5} max={14} step={0.25} value={d.arrayM2} onChange={(e) => set({ arrayM2: Number(e.target.value) })} /></label>}
        <div className="grid">
          {BATTERIES.map((x) => (
            <button type="button" key={x.id} className="card" aria-pressed={d.battery === x.id} onClick={() => set({ battery: x.id })}>
              <span className="name">{x.name}</span><span className="facts num"><span>{x.massKg} kg</span><span>{x.wh} Wh</span><span>{money(x.costM)}</span></span>
            </button>
          ))}
        </div>
      </section>
      <section className="panel">
        <h3>Review board findings</h3>
        {b.findings.length === 0 ? <p className="small"><Lamp s="green" /> No findings. Every console is green.</p> : b.findings.map((f) => <FindingRow f={f} key={f.id} />)}
      </section>
    </>
  );
}

// ================================================================ test
export function TestScreen({ d, b, set }: { d: Design; b: Budgets; set: Set }) {
  const toggle = (id: string) => set({ tests: d.tests.includes(id) ? d.tests.filter((x) => x !== id) : [...d.tests, id] });
  return (
    <>
      <Head eyebrow="Phases C and D · final design, assembly, test, launch" title="Build and test">
        Every test costs money and days. Every test you skip is a bet that nothing is wrong. The spacecraft must be finished by {fmtDate(d.launchJd)}, and it is currently due on {fmtDate(b.time.readyJd)}.
      </Head>
      <section className="panel">
        <h3>Test campaign</h3>
        <div className="grid two">
          {TESTS.map((t) => (
            <button type="button" key={t.id} className="card" role="checkbox" aria-checked={d.tests.includes(t.id)} onClick={() => toggle(t.id)}>
              <span className="name">{t.name}</span>
              <span className="facts num"><span>{money(t.costM * b.klass.testCostMult)}</span><span>{t.weeks} weeks</span></span>
              <span className="what">{t.what}</span>
              <span className="small">Catches: {t.catches.toLowerCase()}.</span>
            </button>
          ))}
        </div>
      </section>
      <section className="panel">
        <h3>Review board findings</h3>
        {b.findings.length === 0 ? <p className="small"><Lamp s="green" /> No findings. Every console is green.</p> : b.findings.map((f) => <FindingRow f={f} key={f.id} />)}
      </section>
    </>
  );
}

// ================================================================ fly
export function Fly({ g, res, done, call }: { g: Game; res: FlightResult; done: () => void; call: (id: string, option: string) => void }) {
  const d = g.design;
  const events = useMemo(() => [...res.events].sort((x, y) => x.jd - y.jd || x.n - y.n), [res]);
  const first = Math.min(d.launchJd - 6, ...res.events.map((e) => e.jd));
  const last = Math.max(...res.events.map((e) => e.jd), d.launchJd + 1) + 1;
  const arrive = Math.min(last - 0.5, Math.max(first + 1, res.arrivedJd));
  // cruise takes 35% of the film, operations the rest
  const jdOf = (x: number) => (x < 0.35 ? first + (x / 0.35) * (arrive - first) : arrive + ((x - 0.35) / 0.65) * (last - arrive));
  const pOf = (jd: number) => (jd <= arrive ? 0.35 * Math.max(0, (jd - first) / (arrive - first)) : 0.35 + 0.65 * Math.min(1, (jd - arrive) / (last - arrive)));
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [p, setP] = useState(reduce ? 1 : 0); // progress 0..1
  const [playing, setPlaying] = useState(!reduce);
  const [speed, setSpeed] = useState(1);
  const logRef = useRef<HTMLDivElement>(null);
  const resume = useRef<number | null>(null);
  // The film stops at the next call the team has not made yet.
  const pending = res.decisions.find((x) => !x.byPlayer) ?? null;
  const pLimit = pending ? pOf(pending.jd) : 1;
  const pe = Math.min(p, pLimit);
  const waiting = !!pending && p >= pLimit;
  useEffect(() => {
    if (!playing || waiting) return;
    const id = setInterval(() => setP((x) => Math.min(1, x + (0.05 / 34) * speed)), 50);
    return () => clearInterval(id);
  }, [playing, speed, waiting]);
  useEffect(() => { if (p >= 1 && !pending) setPlaying(false); }, [p, pending]);
  useEffect(() => {
    // After a call the flight is simulated again. Pick the film up at the same date.
    if (resume.current === null) return;
    const jd = resume.current;
    resume.current = null;
    setP((x) => (x >= 1 ? 1 : Math.min(1, pOf(jd) + 0.001)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res]);
  const jd = jdOf(pe);
  const over = pe >= 1 && !pending;
  const shown = events.filter((e) => (over || e.jd <= jd) && (!pending || e.n < pending.n));
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [shown.length]);
  const light = earthKmAt(Math.max(d.launchJd, Math.min(jd, APOPHIS.flybyJd + 30))) / C_KM_S;
  const stays = d.missionType === 'rendezvous' && !res.becameFlyby && res.launched;
  const flown = res.launched && (!pending || pending.phase !== 'launch');
  const owners = consoleOwners(g.players);
  const owner = pending ? owners[CONSOLES.findIndex((c) => c.id === pending.console)] : null;
  const made = res.decisions.filter((x) => x.byPlayer);
  return (
    <>
      <Head eyebrow={`Phase E · operations · world number ${g.seed}`} title={`${g.mission || 'Mission'} ${!res.launched && over ? 'never left Earth' : flown ? 'is flying' : 'is on the pad'}`} />
      {waiting && pending && (
        <section className="poll call" aria-live="assertive" aria-label="A call for the flight team">
          <div className="head">
            <span className="eyebrow">{fmtDate(pending.jd)} · {CONSOLES.find((c) => c.id === pending.console)!.name} console · {owner === null || owner === undefined ? (g.players.length > 1 ? 'the team decides' : 'your call') : `${g.players[owner]}'s call`}</span>
            <h2>{pending.title}</h2>
            <p>{pending.text}</p>
          </div>
          <div className="grid two">
            {pending.options.map((o) => (
              <button type="button" key={o.id} className="card" onClick={() => { resume.current = pending.jd; call(pending.id, o.id); }}>
                <span className="name">{o.label}</span><span className="what">{o.what}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      <div className="split">
        <section className="panel">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div><div className="eyebrow">Mission date</div><div className="score" style={{ fontSize: '2.6rem' }}>{fmtDate(jd)}</div></div>
            <div><div className="eyebrow">Radio delay, one way</div><div className="num" style={{ fontSize: '1.2rem' }}>{jd < d.launchJd || !flown ? '—' : light >= 60 ? `${Math.floor(light / 60)} min ${Math.round(light % 60)} s` : `${light.toFixed(1)} s`}</div></div>
          </div>
          <div className="chart-wrap" style={{ display: 'flex', justifyContent: 'center' }}>
            <OrbitView launchJd={d.launchJd} arriveJd={d.arriveJd} nowJd={flown ? jd : d.launchJd} stays={stays} size={340} />
          </div>
          <div className="row">
            <button type="button" className="btn small" disabled={waiting} onClick={() => { if (over) setP(0); setPlaying(!playing || over); }}>{over ? 'Replay' : playing ? 'Pause' : 'Play'}</button>
            <button type="button" className="btn ghost small" aria-pressed={speed === 4} onClick={() => setSpeed(speed === 1 ? 4 : 1)}>{speed === 1 ? 'Faster' : 'Normal speed'}</button>
            <button type="button" className="btn ghost small" disabled={waiting || over} onClick={() => { setP(1); setPlaying(true); }}>{pending ? 'Skip to the next call' : 'Skip to the end'}</button>
          </div>
          <input type="range" id="scrub" aria-label="Mission timeline" min={0} max={1} step={0.002} value={pe} onChange={(e) => { setP(Math.min(pLimit, Number(e.target.value))); setPlaying(false); }} />
          {made.length > 0 && (
            <div className="small muted">
              Calls made: {made.map((x) => `${x.title.toLowerCase()} → ${x.options.find((o) => o.id === x.chosen)!.label.toLowerCase()}`).join(' · ')}
            </div>
          )}
        </section>
        <section className="panel">
          <h3>Flight log</h3>
          <div className="log" ref={logRef} aria-live="polite">
            {shown.map((e) => (
              <div className={`event ${e.tone}`} key={e.n}>
                <span className="when">{fmtDate(e.jd)}</span><Lamp s={e.tone} />
                <div><b>{e.title}.</b> {e.text}</div>
              </div>
            ))}
            {waiting && <div className="event warn"><span className="when">{fmtDate(jd)}</span><Lamp s="warn" /><div><b>Waiting for a call.</b> The flight team needs a decision.</div></div>}
          </div>
          {res.samples.length > 1 && jd >= res.samples[0].jd && (
            <>
              <div className="chart-wrap"><Telemetry samples={res.samples} nowJd={jd} pick={(s) => s.kbps} log label={`Downlink rate, kbps (now ${rate((res.samples.filter((s) => s.jd <= jd).slice(-1)[0] ?? res.samples[0]).kbps)})`} /></div>
              <div className="chart-wrap"><Telemetry samples={res.samples} nowJd={jd} pick={(s) => s.sentGb} label={`Data safely on Earth, Gb (now ${(res.samples.filter((s) => s.jd <= jd).slice(-1)[0] ?? res.samples[0]).sentGb.toFixed(1)})`} /></div>
            </>
          )}
          {over && <button type="button" className="btn" onClick={done}>Read the debrief</button>}
        </section>
      </div>
    </>
  );
}

// ================================================================ debrief
export function Debrief({ g, b, res, mc, again, newLuck, reset }: { g: Game; b: Budgets; res: FlightResult; mc: McResult | null; again: () => void; newLuck: () => void; reset: () => void }) {
  const score = useMemo(() => scoreFlight(res, b, g.gates, mc ? mc.success : null, g.players.length), [res, b, g.gates, mc, g.players.length]);
  const frac = res.sciencePoints / b.klass.scienceTarget;
  const headline = headlineOf(res, b.klass.scienceTarget);
  const [copied, setCopied] = useState('');
  const calls = res.decisions.filter((x) => x.byPlayer);
  const runs = g.history;
  const code = encodeShare(g);
  const parts: [string, number, number, string][] = [
    ['Science value', score.science, 40, score.notes.science], ['Mission performance', score.performance, 20, score.notes.performance],
    ['Efficient use of resources', score.efficiency, 20, score.notes.efficiency], ['Quality of decisions', score.decisions, 10, score.notes.decisions],
    ['Team collaboration', score.teamwork, 10, score.notes.teamwork],
  ];
  const bad = res.causes.filter((c) => !c.good), good = res.causes.filter((c) => c.good);
  const d = g.design;
  return (
    <>
      <Head eyebrow={`Phase F · closeout · ${g.mission || 'Mission'} · world number ${g.seed}`} title={headline}>
        {res.lost ? `${res.lostWhy}. ` : ''}{res.gb.sent.toFixed(res.gb.sent < 10 ? 1 : 0)} Gb of data reached Earth. The final bill was {money(res.finalCostM)} against a cap of {money(b.cost.cap)}.
      </Head>
      <div className="split">
        <section className="panel">
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div className="score" style={{ color: score.total >= 80 ? 'var(--go)' : score.total >= 55 ? 'var(--hold)' : 'var(--nogo)' }}>{Math.round(score.total)}</div>
            <div className="muted">out of 100</div>
          </div>
          <div className="bars">
            {parts.map(([name, v, max, note]) => (
              <div key={name} className="meter">
                <span className="line"><span className="label" style={{ fontSize: '0.95rem' }}>{name}</span><span className="num">{v.toFixed(0)} / {max}</span></span>
                <span className="bar"><span className={`fill ${v / max >= 0.75 ? '' : v / max >= 0.45 ? 'amber' : 'red'}`} style={{ width: `${Math.max(2, (v / max) * 100)}%` }} /></span>
                <span className="detail">{note}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <h3>The postcard</h3>
          {res.gb.sent > 0 && isFinite(res.resolutionM) ? (
            <>
              <Postcard resolutionM={res.resolutionM} quality={Math.min(1, res.gb.sent / Math.max(0.01, res.gb.made))} />
              <p className="small">What your best camera resolved: <span className="num">{detail(res.resolutionM)}</span> per pixel. Apophis is about 340 m across.</p>
              <p className="small muted">A simulated view drawn by the game at the detail your mission achieved. It is not a real image of Apophis.</p>
            </>
          ) : <p className="small muted">No pictures came home.</p>}
        </section>
      </div>
      <section className="panel">
        <h3>Science return</h3>
        <div className="chart-wrap">
          <table>
            <thead><tr><th>Objective</th><th className="r">Worth</th><th className="r">Achieved</th><th>What limited it</th></tr></thead>
            <tbody>{res.objectives.map((o) => <tr key={o.id}><td>{o.name}</td><td className="r num">{o.weight}</td><td className="r num">{pct(o.achieved)}</td><td>{o.note}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <h3>Why it happened</h3>
        <p className="muted small">Each line links an outcome to the decision behind it. Fly the same world again with one change and the line changes with it.</p>
        {bad.length === 0 && good.length === 0 && <p className="small">Nothing notable went wrong or was narrowly avoided.</p>}
        {bad.map((c, k) => <div className="finding" key={`b${k}`}><Lamp s="red" /><div><b>{c.effect}</b> <span className="fix">{c.decision}</span></div></div>)}
        {good.map((c, k) => <div className="finding" key={`g${k}`}><Lamp s="green" /><div><b>{c.effect}</b> <span className="fix">{c.decision}</span></div></div>)}
        {calls.length > 0 && (
          <div className="chart-wrap">
            <table>
              <thead><tr><th>Call made in flight</th><th>Date</th><th>The team chose</th></tr></thead>
              <tbody>{calls.map((x) => <tr key={x.id}><td>{x.title}</td><td className="num">{fmtDate(x.jd)}</td><td>{x.options.find((o) => o.id === x.chosen)!.label}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </section>
      {runs.length > 1 && (
        <section className="panel">
          <h3>Flight history</h3>
          <p className="muted small">Every flight of this mission so far. The same world number means the same luck, so the score change comes from your changes alone.</p>
          <div className="chart-wrap">
            <table>
              <thead><tr><th className="r">Flight</th><th className="r">World</th><th className="r">Score</th><th>Outcome</th><th className="r">Science</th><th className="r">Final cost</th><th>What changed from the flight before</th></tr></thead>
              <tbody>
                {runs.map((r, k) => {
                  const prev = k > 0 ? runs[k - 1] : null;
                  const diff = prev ? diffDesign(prev.design, r.design) : [];
                  const delta = prev ? Math.round(r.total) - Math.round(prev.total) : 0;
                  return (
                    <tr key={r.flight}>
                      <td className="r num">{k + 1}</td><td className="r num">{r.seed}</td>
                      <td className="r num">{Math.round(r.total)}{prev && <span style={{ color: delta > 0 ? 'var(--go)' : delta < 0 ? 'var(--nogo)' : undefined }}> ({delta > 0 ? '+' : delta < 0 ? '−' : '±'}{Math.abs(delta)})</span>}</td>
                      <td>{r.headline}</td><td className="r num">{r.science.toFixed(0)}</td><td className="r num">{money(r.costM)}</td>
                      <td className="small">{!prev ? 'First flight' : diff.length === 0 ? (prev.seed === r.seed ? 'Same design, different calls in flight' : 'Same design, new luck') : `${diff.slice(0, 6).join(' · ')}${diff.length > 6 ? ` · and ${diff.length - 6} more` : ''}${prev.seed !== r.seed ? ' · new luck' : ''}`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <div className="split">
        <section className="panel">
          <h3>The odds</h3>
          {mc ? (
            <>
              <div className="chart-wrap"><OddsChart mc={mc} mark={frac} /></div>
              <p className="small">Before launch, {pct(mc.success)} of 1,000 simulated flights of this design succeeded. {res.lost || frac < 0.5 ? (mc.success >= 0.7 ? 'This flight was one of the unlucky ones. The design was sound.' : 'This result was always likely. The design carried the risk.') : mc.success >= 0.7 ? 'This flight went the way a sound design usually goes.' : 'This flight beat the odds. A different world would probably have ended worse.'}</p>
            </>
          ) : <p className="small muted">You launched without flying this exact design 1,000 times first, so nobody knew the odds.</p>}
        </section>
        <section className="panel">
          <h3>Reality check <SrcTag src={RAMSES_SRC} /></h3>
          <div className="chart-wrap">
            <table>
              <thead><tr><th></th><th>Yours</th><th>ESA's Ramses</th></tr></thead>
              <tbody>
                <tr><td>Launch</td><td className="num">{fmtDate(d.launchJd)}</td><td className="num">24 Apr to 11 May 2028</td></tr>
                <tr><td>Arrival</td><td className="num">{fmtDate(res.arrivedJd)}</td><td className="num">February 2029</td></tr>
                <tr><td>Delta-v</td><td className="num">{(b.dv.needed * 1000).toFixed(0)} m/s</td><td className="num">under 1,600 m/s</td></tr>
                <tr><td>Launch mass</td><td className="num">{kg(b.mass.wet)}</td><td className="num">about 1,300 kg</td></tr>
                <tr><td>Distance</td><td className="num">{b.traj.rangeKm} km</td><td className="num">20 km to 1 km, 5 km at flyby</td></tr>
                <tr><td>Backups</td><td>{REDUNDANCY[d.redundancy].name}</td><td>Almost entirely single string</td></tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
      <section className="panel">
        <h3>Try again</h3>
        <div className="row">
          <button type="button" className="btn" onClick={again}>Change the design, same luck</button>
          <button type="button" className="btn ghost" onClick={newLuck}>Same design, new luck</button>
          <button type="button" className="btn ghost" onClick={reset}>New mission</button>
        </div>
        <label>Mission code. Anyone who loads it flies this design in this world.
          <input id="share-out" type="text" readOnly value={code} onFocus={(e) => e.currentTarget.select()} />
        </label>
        <div className="row">
          <button type="button" className="btn ghost small" onClick={async () => { try { await navigator.clipboard.writeText(code); setCopied('Copied.'); } catch { setCopied('Select the code and copy it by hand.'); } }}>Copy the code</button>
          <span className="small" role="status">{copied}</span>
        </div>
      </section>
    </>
  );
}

export function Credits() {
  return (
    <footer className="credits">
      <span>Orbits, launch windows and the flyby date come from public NASA and JPL sources, checked on {DATA_CHECKED}. Anything marked “game value” is a plausible number chosen for the game.</span>
      <span>Built for the NASA Space Apps Challenge 2026. Not affiliated with or endorsed by NASA, ESA or JAXA.</span>
      <span>The code was written with Claude, an AI assistant. How it was used is recorded in AI_USE.md in the project repository.</span>
    </footer>
  );
}
export { STEPS, monteCarlo, simulate, evaluate, snowball };
