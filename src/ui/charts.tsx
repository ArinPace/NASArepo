import { PointerEvent as RPointerEvent, useEffect, useMemo, useRef } from 'react';
import { AU_KM, Elements, earthState, elementsFromState, fmtDate, fmtMonth, jdFromDate, stateFromElements, transferTo, dateFromJd } from '../sim/astro';
import { ANTENNAS, APOPHIS, INSTRUMENTS } from '../sim/data';
import { Budgets, Design, LAST_ARRIVAL_JD, MIN_TOF_DAYS } from '../sim/design';
import { McResult, Sample } from '../sim/flight';

// ---------------------------------------------------------------- launch chart
const L0 = jdFromDate(2027, 9, 1), L1 = jdFromDate(2029, 3, 1);
const A0 = jdFromDate(2028, 1, 1), A1 = LAST_ARRIVAL_JD;
const NX = 110, NY = 94;
let gridCache: { vinf: Float32Array; c3: Float32Array } | null = null;
function grid() {
  if (gridCache) return gridCache;
  const vinf = new Float32Array(NX * NY).fill(NaN), c3 = new Float32Array(NX * NY).fill(NaN);
  for (let i = 0; i < NX; i++) {
    const l = L0 + ((L1 - L0) * i) / (NX - 1);
    for (let j = 0; j < NY; j++) {
      const a = A0 + ((A1 - A0) * j) / (NY - 1);
      if (a - l < MIN_TOF_DAYS) continue;
      const t = transferTo(APOPHIS.elements, l, a);
      if (!t) continue;
      vinf[j * NX + i] = t.vinfArr;
      c3[j * NX + i] = t.c3;
    }
  }
  gridCache = { vinf, c3 };
  return gridCache;
}
const STOPS = [[246, 226, 122], [127, 211, 167], [60, 159, 181], [58, 95, 158], [38, 42, 84]];
function ramp(t: number): string {
  const x = Math.max(0, Math.min(0.9999, t)) * (STOPS.length - 1);
  const k = Math.floor(x), f = x - k;
  const c = STOPS[k].map((v, n) => Math.round(v + (STOPS[k + 1][n] - v) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
export const RAMP_CSS = `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 0.99].map(ramp).join(',')})`;

export function LaunchChart({ d, readyJd, onPick }: { d: Design; readyJd: number; onPick: (launchJd: number, arriveJd: number) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const W = 680, H = 430, ML = 86, MB = 36, MT = 12, MR = 12;
  const flyby = d.missionType === 'flyby';
  const x = (jd: number) => ML + ((jd - L0) / (L1 - L0)) * (W - ML - MR);
  const y = (jd: number) => H - MB - ((jd - A0) / (A1 - A0)) * (H - MB - MT);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#0b111b'; g.fillRect(0, 0, W, H);
    const { vinf, c3 } = grid();
    const cw = (W - ML - MR) / (NX - 1), ch = (H - MB - MT) / (NY - 1);
    for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) {
      const v = vinf[j * NX + i], e = c3[j * NX + i];
      if (isNaN(v) || e > 60) continue;
      g.fillStyle = flyby ? ramp(e / 60) : ramp((v - 1) / 6);
      g.fillRect(ML + i * cw - cw / 2, H - MB - j * ch - ch / 2, cw + 0.6, ch + 0.6);
    }
    // not built yet
    const xr = Math.min(W - MR, Math.max(ML, x(readyJd)));
    g.fillStyle = 'rgba(11,17,27,0.72)'; g.fillRect(ML, MT, xr - ML, H - MB - MT);
    g.strokeStyle = 'rgba(154,170,194,0.35)'; g.lineWidth = 1;
    g.save(); g.beginPath(); g.rect(ML, MT, xr - ML, H - MB - MT); g.clip();
    for (let k = -H; k < W; k += 12) { g.beginPath(); g.moveTo(ML + k, H - MB); g.lineTo(ML + k + H, MT - MB); g.stroke(); }
    g.restore();
    g.font = '11px "Martian Mono", ui-monospace, monospace'; g.fillStyle = '#9aaac2';
    if (xr - ML > 90) g.fillText('not built yet', ML + 8, MT + 16);
    // axes
    g.strokeStyle = '#2a3a56'; g.fillStyle = '#9aaac2'; g.textAlign = 'center';
    for (let yy = 2027, mm = 10; jdFromDate(yy, mm, 1) <= L1; mm += 3) {
      if (mm > 12) { mm -= 12; yy++; }
      const jd = jdFromDate(yy, mm, 1);
      g.beginPath(); g.moveTo(x(jd), H - MB); g.lineTo(x(jd), H - MB + 5); g.stroke();
      g.fillText(fmtMonth(jd), x(jd), H - MB + 17);
    }
    g.textAlign = 'right';
    for (let yy = 2028, mm = 1; jdFromDate(yy, mm, 1) <= A1; mm += 2) {
      if (mm > 12) { mm -= 12; yy++; }
      const jd = jdFromDate(yy, mm, 1);
      g.beginPath(); g.moveTo(ML - 5, y(jd)); g.lineTo(ML, y(jd)); g.stroke();
      g.fillText(fmtMonth(jd), ML - 8, y(jd) + 4);
    }
    g.textAlign = 'center'; g.fillText('launch date', (ML + W - MR) / 2, H - 4);
    g.save(); g.translate(12, (H - MB + MT) / 2); g.rotate(-Math.PI / 2); g.fillText('arrival date', 0, 0); g.restore();
    // Ramses reference
    const rx = x(jdFromDate(2028, 5, 2)), ry = y(jdFromDate(2029, 2, 15));
    g.strokeStyle = '#f3efe6'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(rx, ry - 6); g.lineTo(rx + 6, ry); g.lineTo(rx, ry + 6); g.lineTo(rx - 6, ry); g.closePath(); g.stroke();
    g.fillStyle = '#f3efe6'; g.textAlign = 'left'; g.fillText('ESA Ramses', rx + 10, ry + 4);
    // selection
    const sx = x(d.launchJd), sy = y(d.arriveJd);
    if (sx >= ML && sx <= W - MR && sy >= MT && sy <= H - MB) {
      g.strokeStyle = '#ffffff'; g.lineWidth = 1; g.setLineDash([3, 3]);
      g.beginPath(); g.moveTo(sx, H - MB); g.lineTo(sx, sy); g.lineTo(ML, sy); g.stroke(); g.setLineDash([]);
      g.lineWidth = 2; g.beginPath(); g.arc(sx, sy, 7, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#0b111b'; g.beginPath(); g.arc(sx, sy, 3, 0, Math.PI * 2); g.fill();
    }
  }, [d.launchJd, d.arriveJd, flyby, readyJd]);
  const pick = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (e.type === 'pointermove' && e.buttons === 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W, py = ((e.clientY - r.top) / r.height) * H;
    const fx = Math.max(0, Math.min(1, (px - ML) / (W - ML - MR))), fy = Math.max(0, Math.min(1, (H - MB - py) / (H - MB - MT)));
    const l = L0 + Math.round(fx * (L1 - L0));
    const a = Math.min(A1, Math.max(l + MIN_TOF_DAYS, A0 + Math.round(fy * (A1 - A0))));
    onPick(l, a);
  };
  return (
    <div className="chart-wrap">
      <canvas ref={ref} style={{ width: W, height: H, touchAction: 'none', cursor: 'crosshair' }} onPointerDown={pick} onPointerMove={pick}
        role="img" aria-label={`Launch chart. Selected: launch ${fmtDate(d.launchJd)}, arrive ${fmtDate(d.arriveJd)}. Use the date buttons below to adjust without a pointer.`} />
    </div>
  );
}

// ---------------------------------------------------------------- orbit view
function orbitPath(el: (jd: number) => { r: number[] }, jd0: number, days: number, px: (r: number[]) => string, steps = 90): string {
  let s = '';
  for (let k = 0; k <= steps; k++) s += (k ? 'L' : 'M') + px(el(jd0 + (days * k) / steps).r);
  return s;
}
export function OrbitView({ launchJd, arriveJd, nowJd, stays = true, size = 340, arc = true }: { launchJd: number; arriveJd: number; nowJd?: number; stays?: boolean; size?: number; arc?: boolean }) {
  const c = size / 2, s = (size / 2 - 14) / 1.22;
  const px = (r: number[]) => `${(c + (r[0] / AU_KM) * s).toFixed(1)} ${(c - (r[1] / AU_KM) * s).toFixed(1)}`;
  const pt = (r: number[]) => ({ cx: c + (r[0] / AU_KM) * s, cy: c - (r[1] / AU_KM) * s });
  const paths = useMemo(() => {
    const t = transferTo(APOPHIS.elements, launchJd, arriveJd);
    let tr: Elements | null = null;
    if (t) tr = elementsFromState({ r: t.r1, v: t.v1 }, launchJd);
    return {
      earth: orbitPath(earthState, launchJd, 366, px),
      apo: orbitPath((jd) => stateFromElements(APOPHIS.elements, jd), launchJd, 324, px),
      arc: tr ? orbitPath((jd) => stateFromElements(tr!, jd), launchJd, arriveJd - launchJd, px, 60) : '',
      tr,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launchJd, arriveJd, size]);
  const eL = pt(earthState(launchJd).r), aA = pt(stateFromElements(APOPHIS.elements, arriveJd).r), fb = pt(earthState(APOPHIS.flybyJd).r);
  let now: null | { e: { cx: number; cy: number }; a: { cx: number; cy: number }; sc: { cx: number; cy: number } } = null;
  if (nowJd !== undefined) {
    const e = earthState(nowJd).r, a = stateFromElements(APOPHIS.elements, nowJd).r;
    const sc = nowJd <= launchJd || !paths.tr ? e : nowJd < arriveJd || !stays ? stateFromElements(paths.tr, nowJd).r : a;
    now = { e: pt(e), a: pt(a), sc: pt(sc) };
  }
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label="Top view of the inner solar system: Earth's orbit, the orbit of Apophis, and the spacecraft's path between them.">
      <circle cx={c} cy={c} r={5} fill="#f4c152" />
      <path d={paths.earth} fill="none" stroke="#9aaac2" strokeWidth={1} />
      <path d={paths.apo} fill="none" stroke="#9aaac2" strokeWidth={1} strokeDasharray="3 4" />
      {arc && paths.arc && <path d={paths.arc} fill="none" stroke="#f3efe6" strokeWidth={2} />}
      <circle {...fb} r={9} fill="none" stroke="#ff5a66" strokeWidth={1.2} />
      <text x={fb.cx + 12} y={fb.cy + 4} className="axis">13 Apr 2029</text>
      {!now && <><circle {...eL} r={4} fill="#46d38a" /><text x={eL.cx + 8} y={eL.cy - 6} className="axis">launch</text>
        <circle {...aA} r={4} fill="#f3efe6" /><text x={aA.cx + 8} y={aA.cy - 6} className="axis">arrive</text></>}
      {now && <><circle {...now.e} r={5} fill="#46d38a" /><text x={now.e.cx + 8} y={now.e.cy + 4} className="axis">Earth</text>
        <circle {...now.a} r={3.5} fill="#9aaac2" /><text x={now.a.cx + 8} y={now.a.cy - 6} className="axis">Apophis</text>
        {arc && <circle {...now.sc} r={4} fill="#ffffff" stroke="#0b111b" strokeWidth={1.5} />}</>}
    </svg>
  );
}

// ---------------------------------------------------------------- the Moon and its polar orbit
/** Side view of a polar orbit. The gap to the surface is drawn larger than life so it can be seen. */
export function MoonView({ altKm, progress, size = 300 }: { altKm: number; progress?: number; size?: number }) {
  const c = size / 2, R = size * 0.3, gap = 7 + altKm * 0.22, ro = R + gap;
  const still = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const craters = [[-0.35, -0.3, 0.16], [0.3, -0.45, 0.1], [0.1, 0.05, 0.2], [-0.5, 0.2, 0.09], [0.45, 0.25, 0.13], [-0.1, -0.62, 0.08], [0.02, 0.5, 0.11]];
  const orbit = `M ${c} ${c - ro} A ${ro} ${ro} 0 1 1 ${c} ${c + ro} A ${ro} ${ro} 0 1 1 ${c} ${c - ro}`;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={`The Moon with a spacecraft in a polar orbit ${altKm} km above the surface, passing over both poles on every lap.`}>
      <defs><clipPath id="moon-disc"><circle cx={c} cy={c} r={R} /></clipPath></defs>
      <circle cx={c} cy={c} r={R} fill="#8f98a8" />
      <g clipPath="url(#moon-disc)">
        {craters.map(([x, y, r], k) => <circle key={k} cx={c + x * R} cy={c + y * R} r={r * R} fill="#7b8494" stroke="#a7afbd" strokeWidth={0.6} />)}
        <rect x={c} y={c - R} width={R} height={2 * R} fill="#0b111b" opacity={0.45} />
        <ellipse cx={c} cy={c + R} rx={R * 0.42} ry={R * 0.2} fill="#0b111b" opacity={0.85} />
      </g>
      <path d={orbit} fill="none" stroke="#f3efe6" strokeWidth={1.2} strokeDasharray="2 4" />
      {progress !== undefined && <path d={orbit} fill="none" stroke="#46d38a" strokeWidth={2.5} pathLength={1} strokeDasharray={`${Math.max(0, Math.min(1, progress))} 1`} />}
      <circle r={4.5} fill="#ffffff" stroke="#0b111b" strokeWidth={1.5} cx={still ? c : 0} cy={still ? c - ro : 0}>
        {!still && <animateMotion dur="7s" repeatCount="indefinite" path={orbit} />}
      </circle>
      <text x={c} y={c + R + gap + 16} textAnchor="middle" className="axis">south pole: permanent shadow</text>
      <text x={c} y={c - R - gap - 8} textAnchor="middle" className="axis">{altKm} km up{progress !== undefined ? ` · ${Math.round(Math.max(0, Math.min(1, progress)) * 100)}% of the mapping done` : ''}</text>
    </svg>
  );
}

// ---------------------------------------------------------------- spacecraft drawing
export function CraftView({ d, b }: { d: Design; b: Budgets }) {
  const W = 420, H = 230, cx = W / 2, cy = 120;
  const side = Math.max(44, Math.min(104, 22 + Math.cbrt(b.mass.dryPred) * 9));
  const wing = Math.max(18, Math.min(130, b.arrayM2 * 16));
  const ant = ANTENNAS.find((a) => a.id === d.antenna) ?? ANTENNAS[0];
  const dish = Math.max(4, ant.diameterM * 22);
  const tank = Math.max(4, Math.min(side / 2 - 4, Math.cbrt(b.mass.prop) * 3.2));
  const inst = INSTRUMENTS.filter((i) => d.instruments.includes(i.id));
  const ink = '#eef2f7', rule = '#9aaac2';
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`Spacecraft drawing: ${Math.round(b.mass.dryPred)} kg dry, ${b.arrayM2} square metres of solar panels, ${ant.name}, ${inst.length} instruments.`}>
      {[-1, 1].map((sgn) => (
        <g key={sgn}>
          <line x1={cx + (sgn * side) / 2} y1={cy} x2={cx + sgn * (side / 2 + 10)} y2={cy} stroke={rule} />
          <rect x={sgn > 0 ? cx + side / 2 + 10 : cx - side / 2 - 10 - wing} y={cy - 17} width={wing} height={34} fill="#1a2f55" stroke="#5a7fc0" />
          {Array.from({ length: Math.max(1, Math.floor(wing / 16)) }).map((_, k) => (
            <line key={k} x1={(sgn > 0 ? cx + side / 2 + 10 : cx - side / 2 - 10 - wing) + (k + 1) * 16} x2={(sgn > 0 ? cx + side / 2 + 10 : cx - side / 2 - 10 - wing) + (k + 1) * 16} y1={cy - 17} y2={cy + 17} stroke="#5a7fc0" strokeWidth={0.6} />
          ))}
        </g>
      ))}
      <rect x={cx - side / 2} y={cy - side / 2} width={side} height={side} fill="#1a2538" stroke={ink} strokeWidth={1.5} />
      <circle cx={cx} cy={cy + 2} r={tank} fill="none" stroke={rule} strokeDasharray="2 3" />
      <path d={`M${cx - 7} ${cy + side / 2}L${cx + 7} ${cy + side / 2}L${cx + 12} ${cy + side / 2 + 13}L${cx - 12} ${cy + side / 2 + 13}Z`} fill="none" stroke={ink} />
      <line x1={cx} y1={cy - side / 2} x2={cx} y2={cy - side / 2 - 8} stroke={rule} />
      <path d={`M${cx - dish} ${cy - side / 2 - 8 - dish * 0.45}Q${cx} ${cy - side / 2 - 8 + dish * 0.35} ${cx + dish} ${cy - side / 2 - 8 - dish * 0.45}`} fill="none" stroke={ink} strokeWidth={1.5} />
      {inst.map((i, k) => {
        const n = inst.length, w = Math.min(34, (side - 6) / Math.max(1, Math.min(n, 4)) - 3);
        const col = k % 4, row = Math.floor(k / 4);
        const x0 = cx - side / 2 + 4 + col * (w + 3), y0 = cy - side / 2 + 4 + row * 13;
        return <g key={i.id}><rect x={x0} y={y0} width={w} height={10} fill="#f3efe6" /><title>{i.name}</title></g>;
      })}
      <text x={12} y={H - 30} className="axis">dry {Math.round(b.mass.dryPred)} kg · propellant {Math.round(b.mass.prop)} kg</text>
      <text x={12} y={H - 14} className="axis">{b.arrayM2} m² panels · {ant.name.toLowerCase()} · {inst.map((i) => i.short.toLowerCase()).join(', ') || 'no instruments'}</text>
    </svg>
  );
}

// ---------------------------------------------------------------- small charts
export function OddsChart({ mc, mark }: { mc: McResult; mark?: number }) {
  const W = 420, H = 170, ML = 8, MB = 22, MT = 38, bw = (W - ML * 2) / 10;
  const top = Math.max(...mc.hist, 0.05);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`Spread of science return across ${mc.n} simulated flights. ${Math.round(mc.success * 100)}% reach at least half the science target.`}>
      {mc.hist.map((h, k) => (
        <g key={k}>
          <rect x={ML + k * bw + 2} y={H - MB - (h / top) * (H - MB - MT)} width={bw - 4} height={(h / top) * (H - MB - MT)} fill={k >= 5 ? '#46d38a' : '#3a4a68'} />
          {h > 0.02 && <text x={ML + k * bw + bw / 2} y={H - MB - (h / top) * (H - MB - MT) - 4} textAnchor="middle" className="axis">{Math.round(h * 100)}%</text>}
        </g>
      ))}
      <line x1={ML} x2={W - ML} y1={H - MB} y2={H - MB} stroke="#2a3a56" />
      {[0, 50, 100].map((p) => <text key={p} x={ML + (p / 100) * (W - ML * 2)} y={H - 6} textAnchor={p === 0 ? 'start' : p === 100 ? 'end' : 'middle'} className="axis">{p === 100 ? '100% of science target' : `${p}%`}</text>)}
      {mark !== undefined && <g><line x1={ML + Math.min(0.995, mark) * (W - ML * 2)} x2={ML + Math.min(0.995, mark) * (W - ML * 2)} y1={16} y2={H - MB} stroke="#ffffff" strokeWidth={2} /><text x={ML + Math.min(0.995, mark) * (W - ML * 2) + (mark > 0.7 ? 2 : -2)} y={11} textAnchor={mark > 0.7 ? 'end' : 'start'} className="axis" style={{ fill: '#fff' }}>this flight</text></g>}
    </svg>
  );
}

export function CostCurve({ mc, capM, budgetM }: { mc: McResult; capM: number; budgetM: number }) {
  const W = 420, H = 150, ML = 34, MB = 22, MR = 10, MT = 8;
  const lo = Math.min(mc.costCurve[0].costM, budgetM) * 0.97, hi = Math.max(mc.costCurve[mc.costCurve.length - 1].costM, capM, budgetM) * 1.03;
  const x = (c: number) => ML + ((c - lo) / (hi - lo)) * (W - ML - MR), y = (s: number) => H - MB - s * (H - MB - MT);
  const path = mc.costCurve.map((p, k) => `${k ? 'L' : 'M'}${x(p.costM).toFixed(1)} ${y(p.share).toFixed(1)}`).join('');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`Cost confidence curve. 70% of simulated projects finish at or under $${Math.round(mc.cost70)} million.`}>
      <line x1={ML} x2={W - MR} y1={y(0.7)} y2={y(0.7)} stroke="#2a3a56" strokeDasharray="3 3" />
      <text x={ML - 4} y={y(0.7) + 3} textAnchor="end" className="axis">70%</text>
      <text x={ML - 4} y={y(0) + 3} textAnchor="end" className="axis">0</text>
      <text x={ML - 4} y={y(1) + 6} textAnchor="end" className="axis">100%</text>
      <line x1={x(capM)} x2={x(capM)} y1={MT} y2={H - MB} stroke="#ff5a66" /><text x={x(capM) - 4} y={MT + 9} textAnchor="end" className="axis" style={{ fill: '#ff5a66' }}>cap</text>
      <line x1={x(budgetM)} x2={x(budgetM)} y1={MT} y2={H - MB} stroke="#f3efe6" strokeDasharray="2 2" /><text x={x(budgetM) + 4} y={H - MB - 4} className="axis" style={{ fill: '#f3efe6' }}>your budget</text>
      <path d={path} fill="none" stroke="#46d38a" strokeWidth={2} />
      <circle cx={x(mc.cost70)} cy={y(0.7)} r={4} fill="#46d38a" />
      <text x={ML} y={H - 6} className="axis">${Math.round(lo)}M</text><text x={W - MR} y={H - 6} textAnchor="end" className="axis">${Math.round(hi)}M final cost</text>
    </svg>
  );
}

export function Telemetry({ samples, nowJd, pick, label, log }: { samples: Sample[]; nowJd: number; pick: (s: Sample) => number; label: string; log?: boolean }) {
  const W = 420, H = 96, ML = 6, MB = 16, MT = 16;
  if (samples.length < 2) return null;
  const f = (v: number) => (log ? Math.log10(Math.max(1e-3, v)) : v);
  const vals = samples.map((s) => f(pick(s)));
  const lo = Math.min(...vals), hi = Math.max(...vals, lo + 1e-6);
  const j0 = samples[0].jd, j1 = samples[samples.length - 1].jd;
  const x = (jd: number) => ML + ((jd - j0) / (j1 - j0)) * (W - ML * 2), y = (v: number) => H - MB - ((v - lo) / (hi - lo)) * (H - MB - MT);
  const shown = samples.filter((s) => s.jd <= nowJd);
  const path = shown.map((s, k) => `${k ? 'L' : 'M'}${x(s.jd).toFixed(1)} ${y(f(pick(s))).toFixed(1)}`).join('');
  const last = shown[shown.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label}>
      <text x={ML} y={11} className="axis">{label}</text>
      <line x1={ML} x2={W - ML} y1={H - MB} y2={H - MB} stroke="#2a3a56" />
      {j0 < APOPHIS.flybyJd && j1 > APOPHIS.flybyJd && <><line x1={x(APOPHIS.flybyJd)} x2={x(APOPHIS.flybyJd)} y1={MT} y2={H - MB} stroke="#ff5a66" strokeDasharray="2 3" /><text x={x(APOPHIS.flybyJd)} y={H - 3} textAnchor="middle" className="axis">flyby</text></>}
      {path && <path d={path} fill="none" stroke="#f3efe6" strokeWidth={1.8} />}
      {last && <circle cx={x(last.jd)} cy={y(f(pick(last)))} r={3.5} fill="#fff" />}
      <text x={ML} y={H - 3} className="axis">{fmtDate(j0)}</text><text x={W - ML} y={H - 3} textAnchor="end" className="axis">{fmtDate(j1)}</text>
    </svg>
  );
}

// ---------------------------------------------------------------- the Postcard
function h2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return h2(xi, yi) * (1 - u) * (1 - v) + h2(xi + 1, yi) * u * (1 - v) + h2(xi, yi + 1) * (1 - u) * v + h2(xi + 1, yi + 1) * u * v;
}
function height(u: number, v: number): number {
  const a = 1 - ((u + 0.26) / 0.6) ** 2 - (v / 0.44) ** 2;
  const b = 1 - ((u - 0.4) / 0.4) ** 2 - ((v + 0.04) / 0.34) ** 2;
  const m = Math.max(a, b);
  return m <= 0 ? -1 : Math.sqrt(m) * (0.9 + 0.2 * noise(u * 7 + 3, v * 7));
}
/** A simulated picture of the asteroid, drawn at the detail the mission achieved. */
export function Postcard({ resolutionM, quality }: { resolutionM: number; quality: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const n = Math.max(3, Math.min(160, Math.round(450 / Math.max(0.5, resolutionM * 1.6))));
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    cv.width = n; cv.height = n;
    const g = cv.getContext('2d')!;
    const img = g.createImageData(n, n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const u = ((i + 0.5) / n) * 2.3 - 1.15, v = ((j + 0.5) / n) * 2.3 - 1.15;
      const z = height(u, v);
      let c = h2(i * 3.1, j * 7.7) > 0.992 ? 150 : 8;
      if (z > 0) {
        const e = 0.02;
        const nx = -(height(u + e, v) - height(u - e, v)) / (2 * e), ny = -(height(u, v + e) - height(u, v - e)) / (2 * e);
        const len = Math.hypot(nx * 0.6, ny * 0.6, 1);
        const light = Math.max(0, (nx * 0.6 * -0.62 + ny * 0.6 * -0.48 + 0.62) / len);
        const rocks = 0.72 + 0.28 * noise(u * 26, v * 26) + (noise(u * 60 + 9, v * 60) > 0.78 ? 0.18 : 0);
        c = Math.min(255, 22 + 215 * light * rocks);
      }
      const k = (j * n + i) * 4;
      const grain = (h2(i + 0.3, j + 0.9) - 0.5) * 60 * (1 - quality);
      img.data[k] = Math.max(0, Math.min(255, c * 1.02 + grain));
      img.data[k + 1] = Math.max(0, Math.min(255, c * 0.97 + grain));
      img.data[k + 2] = Math.max(0, Math.min(255, c * 0.9 + grain));
      img.data[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, [n, quality]);
  return <canvas ref={ref} className="postcard" style={{ aspectRatio: '1 / 1' }} role="img" aria-label={`Simulated view of Apophis at ${resolutionM < 1 ? `${Math.round(resolutionM * 100)} centimetres` : `${resolutionM.toFixed(1)} metres`} per pixel.`} />;
}
export { dateFromJd };
