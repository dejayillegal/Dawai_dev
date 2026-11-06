import { useEffect, useRef } from 'react';
import { engine, store, useApp } from '../store';
import type { ScCfg, ScGroup } from '../engine/types';
import { Badge, Btn, DeviceModule, RotaryKnob } from '../ui';

const NAMES: Record<ScGroup, string> = {
  bass: 'Bass Bus · Sub / Rumble / Rolling Bass',
  harm: 'Harmony Bus · Pads / Stabs / Drones',
  fx: 'FX Bus · Reverb Return / Textures',
};

const SC_PRESETS: { name: string; cfg: ScCfg }[] = [
  { name: 'Sub Duck', cfg: { thr: -26, ratio: 8, atk: 0.8, rel: 110, hpf: 60, knee: 4, mix: 0.92 } },
  { name: 'Peak Pump', cfg: { thr: -30, ratio: 12, atk: 0.5, rel: 145, hpf: 90, knee: 3, mix: 1.0 } },
  { name: 'Gentle', cfg: { thr: -20, ratio: 4, atk: 3.5, rel: 90, hpf: 120, knee: 8, mix: 0.65 } },
  { name: 'Industrial', cfg: { thr: -34, ratio: 18, atk: 0.2, rel: 190, hpf: 50, knee: 1, mix: 1.0 } },
];

function gr(inDb: number, thr: number, ratio: number, knee: number) {
  const o = inDb - thr;
  const k = Math.max(0.01, knee);
  if (2 * o < -k) return 0;
  if (2 * Math.abs(o) <= k) return ((1 - 1 / ratio) * Math.pow(o + k / 2, 2)) / (2 * k);
  return (1 - 1 / ratio) * o;
}

export function SidechainPanel({ group }: { group: ScGroup }) {
  const app = useApp();
  const p = app.project;
  const c = p.sc[group];
  const curve = useRef<HTMLCanvasElement>(null);
  const wave = useRef<HTMLCanvasElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const txt = useRef<HTMLSpanElement>(null);
  const targets = p.tracks.filter((t) => t.sc === group);
  const set = (patch: Partial<typeof c>) =>
    store.dispatch({ type: 'SET_SC', group, patch }, `Sidechain ${group}`, 'user', `sc:${group}`);

  useEffect(() => {
    const cv = curve.current;
    if (!cv) return;
    const g = cv.getContext('2d')!;
    const W = cv.width, H = cv.height;
    g.fillStyle = '#0b0e12';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = '#1e2630';
    for (let i = 0; i <= 4; i++) {
      g.beginPath();
      g.moveTo((i * W) / 4, 0);
      g.lineTo((i * W) / 4, H);
      g.moveTo(0, (i * H) / 4);
      g.lineTo(W, (i * H) / 4);
      g.stroke();
    }
    const X = (db: number) => ((db + 60) / 60) * W;
    const Y = (db: number) => H - ((db + 60) / 60) * H;
    g.strokeStyle = '#334155';
    g.setLineDash([3, 3]);
    g.beginPath();
    g.moveTo(0, H);
    g.lineTo(W, 0);
    g.stroke();
    g.setLineDash([]);
    g.strokeStyle = '#06b6d4';
    g.lineWidth = 2;
    g.beginPath();
    for (let x = 0; x <= W; x += 2) {
      const i = (x / W) * 60 - 60;
      const o = i - gr(i, c.thr, c.ratio, c.knee);
      if (x === 0) g.moveTo(x, Y(o));
      else g.lineTo(x, Y(o));
    }
    g.stroke();
    g.fillStyle = '#f59e0b';
    g.fillRect(X(c.thr) - 1, 0, 2, H);
  }, [c.thr, c.ratio, c.knee]);

  useEffect(() => {
    let raf = 0;
    const f = () => {
      const h = engine.graph?.hist[group] ?? [];
      const cv = wave.current;
      if (cv) {
        const g = cv.getContext('2d')!;
        const W = cv.width, H = cv.height;
        g.fillStyle = '#0b0e12';
        g.fillRect(0, 0, W, H);
        g.strokeStyle = '#1e2630';
        g.beginPath();
        g.moveTo(0, H / 2);
        g.lineTo(W, H / 2);
        g.stroke();
        const n = Math.min(h.length, 300);
        const dx = W / 300;
        for (let i = 0; i < n; i++) {
          const e = h[h.length - n + i];
          const x = W - (n - i) * dx;
          const kh = Math.max(0, (e.key + 60) / 60) * (H / 2);
          g.fillStyle = 'rgba(6,182,212,0.55)';
          g.fillRect(x, H / 2 - kh, dx + 0.5, kh);
          const gh = Math.min(1, e.gr / 24) * (H / 2);
          g.fillStyle = 'rgba(245,158,11,0.9)';
          g.fillRect(x, H / 2, dx + 0.5, gh);
        }
        const last = h[h.length - 1];
        const grv = last ? last.gr : 0;
        if (bar.current) bar.current.style.height = `${Math.min(100, (grv / 24) * 100)}%`;
        if (txt.current) txt.current.textContent = engine.playing ? `−${grv.toFixed(1)} dB` : '— dB';
      }
      raf = requestAnimationFrame(f);
    };
    f();
    return () => cancelAnimationFrame(raf);
  }, [group]);

  return (
    <div className="space-y-2.5 p-2.5">
      <DeviceModule
        title={`Sidechain Compressor · ${group.toUpperCase()}`}
        category="Dynamics · AudioWorklet"
        active={p.scOn}
        color="#06b6d4"
        onToggle={() => store.dispatch({ type: 'SET_SC_ON', on: !p.scOn }, 'Sidechain on/off')}
        right={
          <Badge color={engine.workletOk || !engine.ctx ? '#06b6d4' : '#f59e0b'}>
            {engine.ctx ? (engine.workletOk ? 'AudioWorklet DSP' : 'Envelope Fallback') : 'Worklet Ready'}
          </Badge>
        }
      >
        <div className="mb-2 flex flex-wrap items-center justify-between gap-1">
          <div className="flex gap-1">
            {(['bass', 'harm', 'fx'] as ScGroup[]).map((g) => (
              <Btn key={g} small active={g === group} onClick={() => store.select({ kind: 'device', id: g })}>
                SC · {g.toUpperCase()}
              </Btn>
            ))}
          </div>
          <Btn
            small
            active={p.scOn}
            tone={p.scOn ? 'cyan' : 'default'}
            onClick={() => store.dispatch({ type: 'SET_SC_ON', on: !p.scOn }, 'Sidechain on/off')}
          >
            {p.scOn ? 'ACTIVE' : 'BYPASSED'}
          </Btn>
        </div>

        <div className="mb-2 text-[10px] text-slate-400">{NAMES[group]}</div>

        {/* Live Key Input & Gain Reduction Oscilloscope + Transfer Curve */}
        <div className="mb-3 grid grid-cols-[92px_1fr_28px] gap-2">
          <div>
            <div className="mb-0.5 text-[8px] uppercase tracking-wider text-slate-500">Knee / Ratio</div>
            <canvas ref={curve} width={92} height={74} className="h-[74px] w-[92px] rounded border border-line bg-[#0b0e12]" />
          </div>
          <div>
            <div className="mb-0.5 text-[8px] uppercase tracking-wider text-slate-500">
              Kick Key (cyan) · Gain Reduction (amber)
            </div>
            <canvas ref={wave} width={280} height={74} className="h-[74px] w-full rounded border border-line bg-[#0b0e12]" />
          </div>
          <div className="flex flex-col items-center">
            <div className="mb-0.5 text-[8px] uppercase tracking-wider text-slate-500">GR</div>
            <div className="relative h-[58px] w-3 overflow-hidden rounded-sm border border-line bg-[#0b0e12]">
              <div ref={bar} className="absolute left-0 top-0 w-full bg-amber" style={{ height: 0 }} />
            </div>
            <span ref={txt} className="mt-0.5 whitespace-nowrap font-mono text-[8px] tabular-nums text-amber">
              — dB
            </span>
          </div>
        </div>

        {/* Rotary Knobs Grid */}
        <div className="grid grid-cols-4 gap-2 rounded border border-line bg-[#0c1015] p-2 sm:grid-cols-7">
          <RotaryKnob
            label="Threshold"
            value={c.thr}
            min={-60}
            max={0}
            step={0.5}
            defaultValue={-24}
            color="#f59e0b"
            onChange={(v) => set({ thr: v })}
            fmt={(v) => `${v.toFixed(1)}dB`}
          />
          <RotaryKnob
            label="Ratio"
            value={c.ratio}
            min={1}
            max={20}
            step={0.1}
            defaultValue={6}
            color="#06b6d4"
            onChange={(v) => set({ ratio: v })}
            fmt={(v) => `${v.toFixed(1)}:1`}
          />
          <RotaryKnob
            label="Attack"
            value={c.atk}
            min={0.1}
            max={100}
            step={0.1}
            defaultValue={1.5}
            color="#06b6d4"
            onChange={(v) => set({ atk: v })}
            fmt={(v) => `${v.toFixed(1)}ms`}
          />
          <RotaryKnob
            label="Release"
            value={c.rel}
            min={10}
            max={1000}
            step={5}
            defaultValue={120}
            color="#06b6d4"
            onChange={(v) => set({ rel: v })}
            fmt={(v) => `${Math.round(v)}ms`}
          />
          <RotaryKnob
            label="Key HPF"
            value={c.hpf}
            min={20}
            max={500}
            step={1}
            defaultValue={80}
            color="#22c55e"
            onChange={(v) => set({ hpf: v })}
            fmt={(v) => `${Math.round(v)}Hz`}
          />
          <RotaryKnob
            label="Knee"
            value={c.knee}
            min={0}
            max={24}
            step={0.5}
            defaultValue={4}
            color="#a78bfa"
            onChange={(v) => set({ knee: v })}
            fmt={(v) => `${v.toFixed(1)}dB`}
          />
          <RotaryKnob
            label="Wet / Dry"
            value={c.mix}
            min={0}
            max={1}
            step={0.01}
            defaultValue={0.9}
            color="#f59e0b"
            onChange={(v) => set({ mix: v })}
            fmt={(v) => `${Math.round(v * 100)}%`}
          />
        </div>

        {/* Techno Sidechain Presets */}
        <div className="mt-2.5 flex flex-wrap items-center gap-1">
          <span className="mr-1 text-[9px] uppercase tracking-wider text-slate-500">Presets:</span>
          {SC_PRESETS.map((pr) => (
            <Btn key={pr.name} small onClick={() => set(pr.cfg)}>
              {pr.name}
            </Btn>
          ))}
        </div>

        <div className="mt-2.5 border-t border-line pt-2">
          <div className="mb-1 text-[9px] uppercase tracking-wider text-slate-500">
            Ducked Destinations (Key = Pre-Solo Kick)
          </div>
          <div className="flex flex-wrap gap-1">
            {targets.length ? (
              targets.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => store.select({ kind: 'track', id: t.id })}
                  className="rounded px-1.5 py-0.5 text-[10px] font-medium transition-opacity hover:opacity-80"
                  style={{ background: t.color + '33', color: t.color }}
                >
                  {t.name}
                </button>
              ))
            ) : (
              <span className="text-[10px] text-slate-500">None assigned — route a track to this bus in Track Inspect</span>
            )}
          </div>
        </div>
      </DeviceModule>
    </div>
  );
}
