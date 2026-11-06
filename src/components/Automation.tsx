import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { engine, store, useApp } from '../store';
import { totalBars, type AutoLane, type AutoParam, type AutoPoint } from '../engine/types';
import { evalLane } from '../engine/audio';
import { curveFactor } from '../engine/validation';
import { ROLE_COLORS } from '../engine/styles';
import { Btn } from '../ui';

const H = 176, PAD = 14;
const PARAM_LABEL: Record<AutoParam, string> = {
  cutoff: 'Filter cutoff',
  res: 'Resonance',
  rev: 'Reverb send',
  vol: 'Volume',
  hp: 'DJ high-pass',
};

function sampleSegmentY(a: AutoPoint, b: AutoPoint, frac: number, Y: (v: number) => number): number {
  const k = curveFactor(frac, b.curve);
  return Y(a.v + (b.v - a.v) * k);
}

export function AutomationEditor() {
  const app = useApp();
  const p = app.project;
  const sel = app.selection;
  const [trackId, setTrack] = useState<string>('');
  const [param, setParam] = useState<AutoParam>('cutoff');
  const [ppb, setPpb] = useState(12);
  const [tool, setTool] = useState<'bezier' | 'draw'>('bezier');
  const [draft, setDraft] = useState<AutoLane | null>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const phRef = useRef<HTMLDivElement>(null);
  const pinchRef = useRef<{ dist: number; ppb0: number } | null>(null);
  const bars = Math.max(32, totalBars(p));
  const W = bars * ppb + 20;

  useEffect(() => {
    const id = sel.kind === 'track' ? sel.id : sel.kind === 'clip' ? sel.track : null;
    if (id) {
      setTrack(id);
      setParam((q) => (q === 'hp' ? 'cutoff' : q));
    }
  }, [sel]);

  const tid = trackId || p.tracks.find((t) => p.auto.some((a) => a.track === t.id))?.id || p.tracks[0]?.id || 'master';
  const target = tid === 'master' ? 'master' : tid;
  const prm: AutoParam = target === 'master' ? 'hp' : param === 'hp' ? 'cutoff' : param;
  const stored = p.auto.find((a) => a.track === target && a.param === prm);
  const lane = draft ?? stored;
  const track = p.tracks.find((t) => t.id === target);
  const col = track?.color ?? '#06b6d4';
  const secs = useMemo(() => p.sections, [p.sections]);

  useEffect(() => {
    setDraft(null);
  }, [p.revision, p.auto, target, prm]);

  // Live playhead follower
  useEffect(() => {
    let raf = 0;
    const f = () => {
      const st = engine.playing ? engine.getStep() : -1;
      const bar = st >= 0 ? st / 16 : store.get().cursorBar;
      if (phRef.current) phRef.current.style.transform = `translateX(${bar * ppb}px)`;
      raf = requestAnimationFrame(f);
    };
    f();
    return () => cancelAnimationFrame(raf);
  }, [ppb]);

  useEffect(() => {
    const c = cv.current;
    if (!c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 16000 / W);
    c.width = W * dpr;
    c.height = H * dpr;
    c.style.width = W + 'px';
    c.style.height = H + 'px';
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#0e1216';
    g.fillRect(0, 0, W, H);
    const Y = (v: number) => H - PAD - v * (H - 2 * PAD);
    for (const s of secs) {
      g.fillStyle = ROLE_COLORS[s.role] + '14';
      g.fillRect(s.start * ppb, 0, s.bars * ppb, H);
      g.fillStyle = ROLE_COLORS[s.role];
      g.globalAlpha = 0.9;
      g.font = '9px Inter, sans-serif';
      g.fillText(s.name, s.start * ppb + 4, 10);
      g.globalAlpha = 1;
    }
    for (let b = 0; b <= bars; b += 4) {
      g.strokeStyle = b % 16 === 0 ? '#2f3a48' : '#1a2128';
      g.beginPath();
      g.moveTo(b * ppb + 0.5, 0);
      g.lineTo(b * ppb + 0.5, H);
      g.stroke();
    }
    for (const v of [0.25, 0.5, 0.75]) {
      g.strokeStyle = '#1a2128';
      g.beginPath();
      g.moveTo(0, Y(v));
      g.lineTo(W, Y(v));
      g.stroke();
    }
    if (!lane || !lane.pts.length) {
      g.fillStyle = '#64748b';
      g.font = '12px Inter, sans-serif';
      g.fillText('No lane yet — press “Create lane” or a Bezier shape preset above, then click/drag points or curve handles.', 16, H / 2);
      return;
    }

    const traceCurve = () => {
      lane.pts.forEach((q, i) => {
        const x = q.bar * ppb, y = Y(q.v);
        if (i === 0) {
          g.moveTo(x, y);
        } else {
          const prev = lane.pts[i - 1];
          const px = prev.bar * ppb;
          const segW = x - px;
          const cVal = q.curve ?? 0;
          if (Math.abs(cVal) > 0.01 && segW > 4) {
            const steps = Math.min(32, Math.max(8, Math.ceil(segW / 5)));
            for (let s = 1; s <= steps; s++) {
              const frac = s / steps;
              g.lineTo(px + segW * frac, sampleSegmentY(prev, q, frac, Y));
            }
          } else {
            g.lineTo(x, y);
          }
        }
      });
    };

    g.beginPath();
    traceCurve();
    g.lineTo(lane.pts[lane.pts.length - 1].bar * ppb, H);
    g.lineTo(lane.pts[0].bar * ppb, H);
    g.closePath();
    g.fillStyle = col + '22';
    g.fill();

    g.beginPath();
    traceCurve();
    g.strokeStyle = '#06b6d4';
    g.lineWidth = 2;
    g.stroke();

    // Draw interactive Bezier midpoint diamond handles between segments
    for (let i = 1; i < lane.pts.length; i++) {
      const a = lane.pts[i - 1], b = lane.pts[i];
      const segW = (b.bar - a.bar) * ppb;
      if (segW < 18 || Math.abs(b.v - a.v) < 0.01) continue;
      const mx = ((a.bar + b.bar) * 0.5) * ppb;
      const my = sampleSegmentY(a, b, 0.5, Y);
      const curved = Math.abs(b.curve ?? 0) > 0.02;
      g.save();
      g.translate(mx, my);
      g.rotate(Math.PI / 4);
      g.fillStyle = curved ? '#f59e0b' : '#0b0d10';
      g.strokeStyle = curved ? '#fde047' : '#06b6d4';
      g.lineWidth = 1.4;
      g.fillRect(-3.2, -3.2, 6.4, 6.4);
      g.strokeRect(-3.2, -3.2, 6.4, 6.4);
      g.restore();
    }

    // Draw primary node control points
    for (const q of lane.pts) {
      g.beginPath();
      g.arc(q.bar * ppb, Y(q.v), 4.2, 0, Math.PI * 2);
      g.fillStyle = '#0b0d10';
      g.fill();
      g.strokeStyle = '#06b6d4';
      g.lineWidth = 1.8;
      g.stroke();
    }
  }, [lane, W, ppb, secs, bars, col]);

  const commit = (l: AutoLane, label: string) => {
    setDraft(null);
    store.dispatch(
      {
        type: 'SET_AUTO',
        lane: {
          ...l,
          pts: l.pts.map((pt) => (pt.curve !== undefined ? { bar: pt.bar, v: pt.v, curve: pt.curve } : { bar: pt.bar, v: pt.v })),
        },
      },
      label,
      'user'
    );
  };
  const create = () =>
    commit(
      {
        id: `a_${target}_${prm}`,
        track: target,
        param: prm,
        pts: [
          { bar: 0, v: 0.35 },
          { bar: Math.floor(bars * 0.5), v: 0.82, curve: 0.4 },
          { bar: bars, v: 0.35, curve: -0.35 },
        ],
      },
      `Create ${prm} Bezier lane`
    );

  const applyPresetShape = (shape: 'rampUp' | 'rampDown' | 'peakArc' | 'sCurve') => {
    const mid = Math.floor(bars * 0.55);
    const pts: AutoPoint[] =
      shape === 'rampUp'
        ? [
            { bar: 0, v: 0.18 },
            { bar: bars, v: 0.9, curve: 0.48 },
          ]
        : shape === 'rampDown'
          ? [
              { bar: 0, v: 0.9 },
              { bar: bars, v: 0.18, curve: -0.48 },
            ]
          : shape === 'sCurve'
            ? [
                { bar: 0, v: 0.15 },
                { bar: Math.floor(bars * 0.5), v: 0.5, curve: 0.55 },
                { bar: bars, v: 0.9, curve: -0.55 },
              ]
            : [
                { bar: 0, v: 0.22 },
                { bar: Math.max(8, mid - 8), v: 0.88, curve: 0.42 },
                { bar: mid, v: 0.28, curve: -0.45 },
                { bar: Math.min(bars - 4, mid + 32), v: 0.94, curve: 0.5 },
                { bar: bars, v: 0.25, curve: -0.38 },
              ];
    commit({ id: stored?.id ?? `a_${target}_${prm}`, track: target, param: prm, pts }, `Shape ${prm} Bezier automation`);
  };

  const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) {
      e.preventDefault();
      setPpb((z) => Math.max(4, Math.min(36, z + (e.deltaY < 0 ? 2 : -2))));
    }
  }, []);

  const onTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchRef.current = { dist: Math.hypot(dx, dy), ppb0: ppb };
    }
  };
  const onTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2 && pinchRef.current && pinchRef.current.dist > 10) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const scale = Math.hypot(dx, dy) / pinchRef.current.dist;
      setPpb(Math.max(4, Math.min(36, Math.round(pinchRef.current.ppb0 * scale))));
    }
  };
  const onTouchEnd = () => {
    pinchRef.current = null;
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = cv.current!.getBoundingClientRect();
    const Y = (v: number) => H - PAD - v * (H - 2 * PAD);
    const px = e.clientX - r.left, py = e.clientY - r.top;
    const bar = (x: number) => Math.max(0, Math.min(bars, Math.round((x / ppb) * 4) / 4));
    const val = (y: number) => Math.min(1, Math.max(0, (H - PAD - y) / (H - 2 * PAD)));

    const activeLane: AutoLane = lane ?? {
      id: `a_${target}_${prm}`,
      track: target,
      param: prm,
      pts: [
        { bar: 0, v: 0.5 },
        { bar: bars, v: 0.5 },
      ],
    };
    let pts = activeLane.pts.map((q) => ({ ...q }));

    // 1. Freehand Draw / Pencil mode
    if (tool === 'draw') {
      const upsertAt = (bx: number, vy: number) => {
        const b = bar(bx);
        const v = +val(vy).toFixed(3);
        pts = pts.filter((q) => Math.abs(q.bar - b) > 0.2);
        pts.push({ bar: b, v });
        pts.sort((a, z) => a.bar - z.bar);
        setDraft({ ...activeLane, pts: pts.map((q) => ({ ...q })) });
      };
      upsertAt(px, py);
      const mv = (ev: PointerEvent) => upsertAt(ev.clientX - r.left, ev.clientY - r.top);
      const up = () => {
        window.removeEventListener('pointermove', mv);
        window.removeEventListener('pointerup', up);
        commit({ ...activeLane, pts }, `Draw ${prm} automation`);
      };
      window.addEventListener('pointermove', mv);
      window.addEventListener('pointerup', up);
      return;
    }

    // 2. Check if user grabbed a Bezier midpoint diamond handle
    let curveSegIdx = -1;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      if ((b.bar - a.bar) * ppb < 18 || Math.abs(b.v - a.v) < 0.01) continue;
      const mx = ((a.bar + b.bar) * 0.5) * ppb;
      const my = sampleSegmentY(a, b, 0.5, Y);
      if (Math.hypot(mx - px, my - py) < 11) {
        curveSegIdx = i;
        break;
      }
    }

    if (curveSegIdx > 0) {
      if (e.altKey) {
        delete pts[curveSegIdx].curve;
        commit({ ...activeLane, pts }, `Reset ${prm} Bezier curve`);
        return;
      }
      const startY = e.clientY;
      const startCurve = pts[curveSegIdx].curve ?? 0;
      const rising = pts[curveSegIdx].v >= pts[curveSegIdx - 1].v;
      const mv = (ev: PointerEvent) => {
        const dy = (ev.clientY - startY) / 70;
        const delta = rising ? dy : -dy;
        const nextCurve = Math.max(-0.98, Math.min(0.98, +(startCurve + delta).toFixed(3)));
        pts[curveSegIdx] = { ...pts[curveSegIdx], curve: Math.abs(nextCurve) < 0.02 ? undefined : nextCurve };
        setDraft({ ...activeLane, pts: pts.map((q) => ({ ...q })) });
      };
      const up = () => {
        window.removeEventListener('pointermove', mv);
        window.removeEventListener('pointerup', up);
        commit({ ...activeLane, pts }, `Bend ${prm} Bezier curve`);
      };
      window.addEventListener('pointermove', mv);
      window.addEventListener('pointerup', up);
      return;
    }

    // 3. Node hit or insert new automation point
    let hit = pts.findIndex((q) => Math.hypot(q.bar * ppb - px, Y(q.v) - py) < 10);
    if (hit < 0) {
      const b = bar(px);
      pts.push({ bar: b, v: +val(py).toFixed(3) });
      pts.sort((a, z) => a.bar - z.bar);
      hit = pts.findIndex((q) => q.bar === b);
    }
    const cur: AutoLane = { ...activeLane, pts };
    setDraft({ ...cur, pts: pts.map((q) => ({ ...q })) });
    const mv = (ev: PointerEvent) => {
      pts[hit] = { ...pts[hit], bar: bar(ev.clientX - r.left), v: +val(ev.clientY - r.top).toFixed(3) };
      setDraft({ ...cur, pts: pts.map((q) => ({ ...q })) });
    };
    const up = () => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      pts.sort((a, z) => a.bar - z.bar);
      commit({ ...cur, pts }, `Edit ${prm} automation`);
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };

  const onDbl = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!stored) return;
    const r = cv.current!.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    const Y = (v: number) => H - PAD - v * (H - 2 * PAD);

    // Check if double-clicking a Bezier midpoint handle -> reset curve to linear
    for (let i = 1; i < stored.pts.length; i++) {
      const a = stored.pts[i - 1], b = stored.pts[i];
      const mx = ((a.bar + b.bar) * 0.5) * ppb;
      const my = sampleSegmentY(a, b, 0.5, Y);
      if (Math.hypot(mx - px, my - py) < 11) {
        const pts = stored.pts.map((q, k) => (k === i ? { bar: q.bar, v: q.v } : { ...q }));
        commit({ ...stored, pts }, 'Reset segment curve to linear');
        return;
      }
    }

    const idx = stored.pts.findIndex((q) => Math.hypot(q.bar * ppb - px, Y(q.v) - py) < 10);
    if (idx < 0 || stored.pts.length <= 2) return;
    commit({ ...stored, pts: stored.pts.filter((_, i) => i !== idx) }, 'Delete automation point');
  };

  const curVal = lane ? evalLane(lane, store.get().cursorBar) : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line px-2 py-1">
        <select
          aria-label="Automation target"
          value={tid}
          onChange={(e) => setTrack(e.target.value)}
          className="h-6 max-w-[165px] text-[11px]"
        >
          {p.tracks.map((t) => (
            <option key={t.id} value={t.id}>
              {p.auto.some((a) => a.track === t.id) ? '● ' : ''}
              {t.name}
            </option>
          ))}
          <option value="master">Master</option>
        </select>
        {target !== 'master' &&
          (['cutoff', 'res', 'rev', 'vol'] as AutoParam[]).map((k) => (
            <Btn key={k} small active={prm === k} onClick={() => setParam(k)}>
              {p.auto.some((a) => a.track === target && a.param === k) ? '● ' : ''}
              {PARAM_LABEL[k]}
            </Btn>
          ))}
        {target === 'master' && <span className="text-[11px] text-slate-400">{PARAM_LABEL.hp} (exponential ramps)</span>}

        {/* Editing Tool Mode: Bezier Points vs Freehand Draw */}
        <div className="flex items-center gap-0.5 rounded border border-line bg-[#0e1216] p-0.5" role="group" aria-label="Automation tool">
          <button
            type="button"
            onClick={() => setTool('bezier')}
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
              tool === 'bezier' ? 'bg-cyan text-black font-semibold' : 'text-slate-400 hover:text-white'
            }`}
            title="Edit nodes and drag diamond midpoint handles to bend Bezier curves"
          >
            ◆ Bezier
          </button>
          <button
            type="button"
            onClick={() => setTool('draw')}
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
              tool === 'draw' ? 'bg-amber text-black font-semibold' : 'text-slate-400 hover:text-white'
            }`}
            title="Freehand draw automation curve across bars"
          >
            ✎ Draw
          </button>
        </div>

        {!stored && (
          <Btn small tone="amber" onClick={create}>
            Create lane
          </Btn>
        )}
        <Btn small onClick={() => applyPresetShape('rampUp')} title="Generate rising Bezier sweep">
          ↗ Rise
        </Btn>
        <Btn small onClick={() => applyPresetShape('peakArc')} title="Generate multi-section Bezier arc">
          ⌒ Arc
        </Btn>
        <Btn small onClick={() => applyPresetShape('sCurve')} title="Generate smooth S-curve tension">
          ∿ S-Curve
        </Btn>
        <Btn small onClick={() => applyPresetShape('rampDown')} title="Generate falling Bezier sweep">
          ↘ Fall
        </Btn>
        {stored && (
          <Btn small tone="ghost" onClick={() => store.dispatch({ type: 'DEL_AUTO', id: stored.id }, 'Delete lane')}>
            Delete lane
          </Btn>
        )}
        {curVal !== null && (
          <span className="hidden font-mono text-[10px] text-cyan sm:inline" title="Evaluated value at cursor">
            val: {(curVal * 100).toFixed(0)}%
          </span>
        )}
        <div className="ml-auto flex items-center gap-1 rounded border border-line bg-[#0e1216] px-1 py-0.5">
          <button
            type="button"
            aria-label="Zoom out automation"
            onClick={() => setPpb((z) => Math.max(4, z - 2))}
            className="flex h-4 w-4 items-center justify-center rounded bg-elev text-[11px] font-bold text-slate-300 hover:text-amber"
          >
            −
          </button>
          <input
            aria-label="Automation zoom"
            type="range"
            className="!w-16"
            min={4}
            max={36}
            value={ppb}
            onChange={(e) => setPpb(+e.target.value)}
          />
          <button
            type="button"
            aria-label="Zoom in automation"
            onClick={() => setPpb((z) => Math.min(36, z + 2))}
            className="flex h-4 w-4 items-center justify-center rounded bg-elev text-[11px] font-bold text-slate-300 hover:text-amber"
          >
            +
          </button>
        </div>
      </div>
      <div
        onWheel={onWheel}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        className="relative min-h-0 flex-1 overflow-auto bg-[#0e1216]"
      >
        <div className="relative" style={{ width: W, height: H }}>
          <canvas
            ref={cv}
            onPointerDown={onDown}
            onDoubleClick={onDbl}
            className="block cursor-crosshair"
            style={{ touchAction: 'none' }}
          />
          <div
            ref={phRef}
            className="pointer-events-none absolute left-0 top-0 z-10 h-full w-px bg-amber shadow-[0_0_6px_#f59e0b]"
          />
        </div>
      </div>
      <div className="shrink-0 border-t border-line px-2 py-0.5 text-[10px] text-slate-500">
        ◆ Bezier mode: click = add point · drag circle = move node · drag diamond ◆ midpoint = bend Bezier curve tension · double-click = delete/reset. ✎ Draw mode: freehand sketch curves.
      </div>
    </div>
  );
}
