import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { Design, SnowballStep, evaluate, forGate, normalise, snowball } from './sim/design';
import { GateRecord, monteCarlo, scoreFlight, simulate } from './sim/flight';
import { DepthContext, Depth, Game, Poll, Rail, Run, STEPS, Stage, encodeShare, headlineOf, newGame, saveBest } from './ui/core';
import { briefOf } from './sim/data';
import { Build, Credits, Debrief, Fly, Pitch, Route, Setup, TestScreen, Thousand } from './ui/screens';

const KEY = 'go-no-go-v1';
type Saved = Pick<Game, 'stage' | 'reached' | 'depth' | 'players' | 'seed' | 'mission' | 'design' | 'gates' | 'calls' | 'flight' | 'history'>;
const saveable = (g: Game): Saved => ({
  stage: g.stage === 'fly' ? 'test' : g.stage, reached: g.reached, depth: g.depth, players: g.players, seed: g.seed, mission: g.mission, design: g.design, gates: g.gates,
  calls: g.stage === 'fly' ? {} : g.calls, flight: g.flight, history: g.history,
});
function restore(data: unknown): Partial<Game> {
  const s = data as Partial<Saved> | null;
  if (!s || typeof s !== 'object' || !s.design || !s.design.klass || !Array.isArray(s.design.instruments) || !Array.isArray(s.players)) return {};
  const out: Partial<Game> = { ...s, calls: s.calls && typeof s.calls === 'object' ? s.calls : {}, flight: typeof s.flight === 'number' ? s.flight : 0, history: Array.isArray(s.history) ? s.history : [] };
  if (s.stage === 'debrief' && typeof s.seed === 'number') out.result = simulate(s.design, s.seed, undefined, out.calls);
  return out;
}

type Hot = { snapshot?: (f: () => unknown) => void; ready?: (f: (data: unknown) => void) => void; data?: unknown };
const hot = (window as unknown as { claude?: { hot?: Hot } }).claude?.hot;

function App({ boot }: { boot: Partial<Game> }) {
  const [g, setG] = useState<Game>(() => ({ ...newGame(), ...boot }));
  const [ripple, setRipple] = useState<SnowballStep[]>([]);
  const latest = useRef(g);
  latest.current = g;
  const b = useMemo(() => evaluate(g.design), [g.design]);
  const update = (p: Partial<Game>) => setG((x) => ({ ...x, ...p }));
  const set = (patch: Partial<Design>) => {
    const next = normalise({ ...g.design, ...patch });
    setRipple(snowball(b, evaluate(next)));
    update({ design: next });
  };
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(saveable(g))); } catch { /* storage is optional */ }
  }, [g]);
  useEffect(() => { hot?.snapshot?.(() => saveable(latest.current)); }, []);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [g.stage]);

  const bGate = useMemo(() => forGate(b, g.stage), [b, g.stage]);
  const idx = STEPS.findIndex((s) => s.id === g.stage);
  const step = STEPS[idx];
  const stale = g.mcKey !== JSON.stringify(g.design);
  const runMc = () => update({ mc: monteCarlo(g.design, 1000), mcKey: JSON.stringify(g.design) });
  const pass = (rec: GateRecord) => {
    const gates = [...g.gates.filter((x) => x.gate !== rec.gate), rec];
    if (g.stage === 'test') update({ gates, calls: {}, flight: g.flight + 1, result: simulate(g.design, g.seed, b, {}), stage: 'fly', reached: Math.max(g.reached, 4) });
    else update({ gates, stage: STEPS[idx + 1].id, reached: Math.max(g.reached, idx + 1) });
  };
  const setDesign = (design: Design) => { setRipple([]); update({ design: normalise(design) }); };
  const call = (id: string, option: string) => {
    const calls = { ...g.calls, [id]: option };
    update({ calls, result: simulate(g.design, g.seed, b, calls) });
  };
  const toDebrief = () => {
    const res = g.result!;
    const score = scoreFlight(res, b, g.gates, g.mc && !stale ? g.mc.success : null, g.players.length);
    const run: Run = { flight: g.flight, seed: g.seed, design: g.design, total: score.total, science: res.sciencePoints, costM: res.finalCostM, headline: headlineOf(res, b.klass.scienceTarget) };
    const brief = briefOf(g.design.scenario);
    if (brief.ranked) {
      saveBest({ mission: g.mission || 'Mission', crew: g.players.join(', '), brief: brief.name, klass: b.klass.name, total: Math.round(score.total), headline: run.headline, when: new Date().toISOString().slice(0, 10), code: encodeShare(g) });
    }
    update({ stage: 'debrief', reached: 5, history: [...g.history.filter((r) => r.flight !== g.flight), run].slice(-8) });
  };

  let body: JSX.Element;
  if (g.stage === 'setup') {
    body = <div className="stage wide"><Setup g={g} update={update} start={() => update({ stage: 'pitch' })} /></div>;
  } else if (g.stage === 'fly' && g.result) {
    body = <div className="stage wide"><div className="work"><Fly key={g.flight} g={g} res={g.result} done={toDebrief} call={call} /></div></div>;
  } else if (g.stage === 'debrief' && g.result) {
    body = (
      <div className="stage wide"><div className="work">
        <Debrief g={g} b={b} res={g.result} mc={stale ? null : g.mc}
          again={() => update({ stage: 'build' })}
          newLuck={() => { const seed = 1 + Math.floor(Math.random() * 99999); update({ seed, calls: {}, flight: g.flight + 1, result: simulate(g.design, seed, b, {}), stage: 'fly' }); }}
          reset={() => { setRipple([]); setG(newGame()); }} />
      </div></div>
    );
  } else {
    body = (
      <div className="stage">
        <div className="work">
          {g.stage === 'pitch' && <Pitch d={g.design} set={set} setDesign={setDesign} />}
          {g.stage === 'route' && <Route d={g.design} b={b} set={set} />}
          {g.stage === 'build' && <Build d={g.design} b={b} set={set} ripple={ripple} />}
          {g.stage === 'test' && <TestScreen d={g.design} b={b} set={set} />}
          {(g.stage === 'build' || g.stage === 'test') && <Thousand d={g.design} b={b} mc={g.mc} stale={stale} run={runMc} set={set} />}
          {step && step.gate && (
            <Poll key={g.stage} gate={step.gate} next={step.next} b={bGate} players={g.players} onPass={pass}
              onFix={() => window.scrollTo({ top: 0, behavior: 'smooth' })} />
          )}
        </div>
        <Rail b={bGate} d={g.design} />
      </div>
    );
  }

  return (
    <DepthContext.Provider value={g.depth}>
      <div className="shell">
        <header className="top">
          <button type="button" className="wordmark" onClick={() => update({ stage: 'setup' })} aria-label="GO / NO-GO, back to the start">
            <span className="go">GO</span><span className="slash">/</span><span className="nogo">NO-GO</span>
          </button>
          <nav className="track" aria-label="Mission phases">
            {STEPS.map((s, i) => {
              const open = i <= g.reached && s.id !== 'fly' && (s.id !== 'debrief' || !!g.result) && g.stage !== 'setup';
              return (
                <button type="button" key={s.id} className={`seg ${g.stage !== 'setup' && i < idx ? 'done' : ''} ${i === idx ? 'now' : ''}`} disabled={!open}
                  aria-current={i === idx ? 'step' : undefined} onClick={() => update({ stage: s.id as Stage })}>
                  <b>{s.name}</b><span>{s.phase}</span>
                </button>
              );
            })}
          </nav>
          <div className="depth" role="group" aria-label="Level of detail">
            {(['cadet', 'engineer', 'chief'] as Depth[]).map((dp) => (
              <button type="button" key={dp} aria-pressed={g.depth === dp} onClick={() => update({ depth: dp })}>{dp === 'chief' ? 'Chief' : dp[0].toUpperCase() + dp.slice(1)}</button>
            ))}
          </div>
        </header>
        {body}
        <Credits />
      </div>
    </DepthContext.Provider>
  );
}

function start(data: unknown) {
  let saved: unknown = data;
  if (!saved || (typeof saved === 'object' && Object.keys(saved as object).length === 0)) {
    try { saved = JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { saved = null; }
  }
  createRoot(document.getElementById('root')!).render(<App boot={restore(saved)} />);
}
if (hot?.ready) hot.ready(start);
else start(hot?.data ?? null);
