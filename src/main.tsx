import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { Design, SnowballStep, evaluate, forGate, snowball } from './sim/design';
import { GateRecord, monteCarlo, simulate } from './sim/flight';
import { DepthContext, Depth, Game, Poll, Rail, STEPS, Stage, newGame } from './ui/core';
import { Build, Credits, Debrief, Fly, Pitch, Route, Setup, TestScreen, Thousand } from './ui/screens';

const KEY = 'go-no-go-v1';
type Saved = Pick<Game, 'stage' | 'reached' | 'depth' | 'players' | 'seed' | 'mission' | 'design' | 'gates'>;
const saveable = (g: Game): Saved => ({
  stage: g.stage === 'fly' ? 'test' : g.stage, reached: g.reached, depth: g.depth, players: g.players, seed: g.seed, mission: g.mission, design: g.design, gates: g.gates,
});
function restore(data: unknown): Partial<Game> {
  const s = data as Partial<Saved> | null;
  if (!s || typeof s !== 'object' || !s.design || !s.design.klass || !Array.isArray(s.design.instruments) || !Array.isArray(s.players)) return {};
  const out: Partial<Game> = { ...s };
  if (s.stage === 'debrief' && typeof s.seed === 'number') out.result = simulate(s.design, s.seed);
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
    const next = { ...g.design, ...patch };
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
    if (g.stage === 'test') update({ gates, result: simulate(g.design, g.seed, b), stage: 'fly', reached: Math.max(g.reached, 4) });
    else update({ gates, stage: STEPS[idx + 1].id, reached: Math.max(g.reached, idx + 1) });
  };
  const setDesign = (design: Design) => { setRipple([]); update({ design }); };

  let body: JSX.Element;
  if (g.stage === 'setup') {
    body = <div className="stage wide"><Setup g={g} update={update} start={() => update({ stage: 'pitch' })} /></div>;
  } else if (g.stage === 'fly' && g.result) {
    body = <div className="stage wide"><div className="work"><Fly key={`${g.seed}-${g.result.events.length}`} g={g} res={g.result} done={() => update({ stage: 'debrief', reached: 5 })} /></div></div>;
  } else if (g.stage === 'debrief' && g.result) {
    body = (
      <div className="stage wide"><div className="work">
        <Debrief g={g} b={b} res={g.result}
          again={() => update({ stage: 'build' })}
          newLuck={() => { const seed = 1 + Math.floor(Math.random() * 99999); update({ seed, result: simulate(g.design, seed, b), stage: 'fly' }); }}
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
