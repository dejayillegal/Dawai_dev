import { useEffect, useRef } from 'react';
import { engine, store, useApp } from '../store';
import type { ScGroup } from '../engine/types';
import { RotaryKnob } from '../ui';
import { cn } from '../utils/cn';

const buf = new Float32Array(256);
function peakOf(a?: AnalyserNode) {
  if (!a) return 0;
  a.getFloatTimeDomainData(buf);
  let m = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = Math.abs(buf[i]);
    if (v > m) m = v;
  }
  return m;
}
const toPct = (lin: number) => Math.max(0, Math.min(100, ((20 * Math.log10(lin + 1e-6) + 54) / 54) * 100));

export function Mixer() {
  const app = useApp();
  const p = app.project;
  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  const mref = useRef<HTMLDivElement | null>(null);
  const mtxt = useRef<HTMLSpanElement | null>(null);
  const hold = useRef<Record<string, number>>({});

  const holdRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const mHoldRef = useRef<HTMLDivElement | null>(null);
  const peakHold = useRef<Record<string, { val: number; ts: number }>>({});

  useEffect(() => {
    let raf = 0;
    let lastTick = 0;
    const f = (now: number) => {
      // Sample at ~25fps (40ms) so the 85ms CSS cubic-bezier transition smoothly interpolates bar motion
      if (now - lastTick >= 40) {
        lastTick = now;
        const g = engine.graph;
        for (const t of p.tracks) {
          const el = refs.current[t.id];
          if (!el) continue;
          const v = g && !t.mute ? peakOf(g.strips.get(t.id)?.analyser) : 0;
          const prev = hold.current[t.id] ?? 0;
          const cur = v >= prev ? v : prev * 0.84;
          hold.current[t.id] = cur < 0.0004 ? 0 : cur;
          const pct = toPct(hold.current[t.id]);
          el.style.height = `${pct.toFixed(1)}%`;
          el.style.opacity = pct > 0.5 ? '1' : '0.35';
          el.style.filter = pct > 88 ? 'brightness(1.25) saturate(1.2)' : 'none';

          const ph = peakHold.current[t.id] ?? { val: 0, ts: now };
          if (cur >= ph.val || now - ph.ts > 900) {
            ph.val = cur >= ph.val ? cur : ph.val * 0.88;
            if (cur >= ph.val) ph.ts = now;
            peakHold.current[t.id] = ph;
          }
          const holdEl = holdRefs.current[t.id];
          if (holdEl) {
            const holdPct = toPct(ph.val);
            holdEl.style.bottom = `${Math.min(98, Math.max(0, holdPct)).toFixed(1)}%`;
            holdEl.style.opacity = holdPct > 2 ? '0.95' : '0';
            holdEl.style.backgroundColor =
              holdPct > 90 ? '#ef4444' : holdPct > 72 ? '#f59e0b' : '#38bdf8';
          }
        }

        const mp = g ? peakOf(g.analyser) : 0;
        const prevM = hold.current.master ?? 0;
        const mh = mp >= prevM ? mp : prevM * 0.86;
        hold.current.master = mh < 0.0004 ? 0 : mh;
        const mPct = toPct(hold.current.master);
        if (mref.current) {
          mref.current.style.height = `${mPct.toFixed(1)}%`;
          mref.current.style.opacity = mPct > 0.5 ? '1' : '0.35';
          mref.current.style.filter = mPct > 88 ? 'brightness(1.25) saturate(1.2)' : 'none';
        }
        const mph = peakHold.current.master ?? { val: 0, ts: now };
        if (mh >= mph.val || now - mph.ts > 1000) {
          mph.val = mh >= mph.val ? mh : mph.val * 0.9;
          if (mh >= mph.val) mph.ts = now;
          peakHold.current.master = mph;
        }
        if (mHoldRef.current) {
          const mhPct = toPct(mph.val);
          mHoldRef.current.style.bottom = `${Math.min(98.5, Math.max(0, mhPct)).toFixed(1)}%`;
          mHoldRef.current.style.opacity = mhPct > 2 ? '1' : '0';
          mHoldRef.current.style.backgroundColor =
            mhPct > 90 ? '#ef4444' : mhPct > 72 ? '#f59e0b' : '#22d3ee';
        }
        if (mtxt.current) {
          mtxt.current.textContent = mh > 0.0005 ? `${(20 * Math.log10(mh)).toFixed(1)}` : '-∞';
        }
      }
      raf = requestAnimationFrame(f);
    };
    raf = requestAnimationFrame(f);
    return () => cancelAnimationFrame(raf);
  }, [p.tracks]);

  const sel = app.selection;
  return (
    <div className="flex h-full min-h-0 gap-1 overflow-x-auto bg-bg p-1.5">
      {p.tracks.map((t) => {
        const isSel = (sel.kind === 'track' && sel.id === t.id) || (sel.kind === 'clip' && sel.track === t.id);
        const upd = (
          patch: Parameters<typeof store.dispatch>[0] extends infer C
            ? C extends { type: 'SET_TRACK'; patch: infer P }
              ? P
              : never
            : never,
          key: string
        ) => store.dispatch({ type: 'SET_TRACK', id: t.id, patch }, `Mixer · ${t.name}`, 'user', `${key}:${t.id}`);
        return (
          <div
            key={t.id}
            onClick={() => store.select({ kind: 'track', id: t.id })}
            className={cn(
              'flex w-[76px] shrink-0 flex-col items-stretch gap-1 rounded-md border bg-panel p-1.5 transition-colors',
              isSel ? 'border-amber bg-[#161c24]' : 'border-line'
            )}
          >
            <div className="h-1.5 rounded-full" style={{ background: t.color }} />
            <div className="truncate text-center text-[10px] font-semibold leading-tight text-slate-200" title={t.name}>
              {t.name}
            </div>

            {/* Compact Rotary Send & Pan Dials */}
            <div className="grid grid-cols-2 gap-0.5 rounded bg-[#0c1015] py-1">
              <RotaryKnob
                label={`${t.name} pan`}
                value={t.pan}
                min={-1}
                max={1}
                step={0.02}
                defaultValue={0}
                size={30}
                bipolar
                color="#38bdf8"
                disabled={t.lock}
                onChange={(v) => upd({ pan: v }, 'pan')}
                fmt={(v) => (Math.abs(v) < 0.03 ? 'C' : v < 0 ? `${Math.round(-v * 50)}L` : `${Math.round(v * 50)}R`)}
              />
              <RotaryKnob
                label={`${t.name} reverb send`}
                value={t.rev}
                min={0}
                max={1}
                step={0.01}
                defaultValue={0.15}
                size={30}
                color="#06b6d4"
                disabled={t.lock}
                onChange={(v) => upd({ rev: v }, 'rev')}
                fmt={(v) => `${Math.round(v * 100)}%`}
              />
            </div>

            {/* Vertical Fader + Smooth CSS-Transitioned Peak Meter */}
            <div className="flex min-h-0 flex-1 justify-center gap-2 py-0.5">
              <div
                className="relative w-3 overflow-hidden rounded-sm border border-[#1d2530] bg-[#080b0f] shadow-inner"
                title={`${t.name} Peak Level Meter`}
              >
                {/* Subtle dB scale tick lines */}
                <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-between py-1 opacity-25">
                  <div className="h-px w-full bg-red-400/70" />
                  <div className="h-px w-full bg-amber/60" />
                  <div className="h-px w-full bg-slate-500" />
                  <div className="h-px w-full bg-slate-600" />
                  <div className="h-px w-full bg-slate-700" />
                </div>
                {/* Smooth CSS-transitioned active level bar */}
                <div
                  ref={(el) => {
                    refs.current[t.id] = el;
                  }}
                  className=" absolute bottom-0 left-0 right-0 rounded-t-[1px] will-change-[height,opacity,filter]"
                  style={{
                    height: '0%',
                    opacity: 0.35,
                    background: 'linear-gradient(to top, #10b981 0%, #22c55e 58%, #f59e0b 84%, #ef4444 100%)',
                    boxShadow: '0 0 8px rgba(34, 197, 94, 0.28)',
                    transition:
                      'height 85ms cubic-bezier(0.22, 1, 0.36, 1), opacity 140ms ease-out, filter 120ms ease-out',
                  }}
                />
                {/* Smooth CSS-transitioned floating peak-hold cap */}
                <div
                  ref={(el) => {
                    holdRefs.current[t.id] = el;
                  }}
                  className="pointer-events-none absolute left-0 right-0 h-[2px] rounded-full"
                  style={{
                    bottom: '0%',
                    opacity: 0,
                    backgroundColor: '#38bdf8',
                    boxShadow: '0 0 4px currentColor',
                    transition: 'bottom 130ms cubic-bezier(0.22, 1, 0.36, 1), opacity 220ms ease-out, background-color 150ms ease',
                  }}
                />
              </div>
              <input
                aria-label={`${t.name} volume`}
                className="vert"
                type="range"
                min={0}
                max={1.4}
                step={0.01}
                value={t.vol}
                disabled={t.lock}
                onChange={(e) => upd({ vol: +e.target.value }, 'vol')}
              />
            </div>

            <div className="text-center font-mono text-[9px] tabular-nums text-slate-300">
              {t.vol > 0.001 ? `${(20 * Math.log10(t.vol)).toFixed(1)}dB` : '-∞'}
            </div>

            <select
              aria-label={`${t.name} sidechain`}
              value={t.sc ?? ''}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => upd({ sc: (e.target.value || null) as ScGroup | null }, 'sc')}
              className="h-5 !px-0.5 text-[9px]"
            >
              <option value="">no sc</option>
              <option value="bass">sc·bass</option>
              <option value="harm">sc·harm</option>
              <option value="fx">sc·fx</option>
            </select>

            <div className="flex gap-0.5">
              <button
                type="button"
                aria-label={`mute ${t.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  upd({ mute: !t.mute }, 'mute');
                }}
                className={cn(
                  'h-5 flex-1 rounded-sm text-[9px] font-bold',
                  t.mute ? 'bg-red-500 text-white' : 'bg-[#232b35] text-slate-400 hover:text-white'
                )}
              >
                M
              </button>
              <button
                type="button"
                aria-label={`solo ${t.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  upd({ solo: !t.solo }, 'solo');
                }}
                className={cn(
                  'h-5 flex-1 rounded-sm text-[9px] font-bold',
                  t.solo ? 'bg-amber text-black' : 'bg-[#232b35] text-slate-400 hover:text-white'
                )}
              >
                S
              </button>
            </div>
          </div>
        );
      })}

      {/* Master Bus Strip */}
      <div
        className="flex w-[88px] shrink-0 cursor-pointer flex-col items-stretch gap-1 rounded-md border border-amber/60 bg-panel p-1.5"
        onClick={() => store.select({ kind: 'device', id: 'master' })}
      >
        <div className="h-1.5 rounded-full bg-amber" />
        <div className="text-center text-[10px] font-bold tracking-wider text-amber">MASTER</div>
        <div className="flex flex-col gap-0.5">
          {(['bass', 'harm', 'fx'] as ScGroup[]).map((g) => (
            <button
              key={g}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                store.select({ kind: 'device', id: g });
              }}
              className="rounded bg-[#1a222c] py-0.5 text-[8px] font-semibold uppercase text-cyan hover:bg-cyan/20"
            >
              SC · {g}
            </button>
          ))}
        </div>
        <div className="flex min-h-0 flex-1 justify-center py-0.5">
          <div
            className="relative w-4 overflow-hidden rounded-sm border border-[#1d2530] bg-[#080b0f] shadow-inner"
            title="Master Bus Peak Level Meter"
          >
            {/* Subtle dB scale tick lines */}
            <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-between py-1 opacity-30">
              <div className="h-px w-full bg-red-400/80" />
              <div className="h-px w-full bg-amber/70" />
              <div className="h-px w-full bg-slate-500" />
              <div className="h-px w-full bg-slate-600" />
              <div className="h-px w-full bg-slate-700" />
            </div>
            {/* Smooth CSS-transitioned master peak bar */}
            <div
              ref={mref}
              className="absolute bottom-0 left-0 right-0 rounded-t-[1px] will-change-[height,opacity,filter]"
              style={{
                height: '0%',
                opacity: 0.35,
                background: 'linear-gradient(to top, #10b981 0%, #22c55e 58%, #f59e0b 84%, #ef4444 100%)',
                boxShadow: '0 0 10px rgba(245, 158, 11, 0.28)',
                transition:
                  'height 85ms cubic-bezier(0.22, 1, 0.36, 1), opacity 140ms ease-out, filter 120ms ease-out',
              }}
            />
            {/* Smooth CSS-transitioned master floating peak-hold cap */}
            <div
              ref={mHoldRef}
              className="pointer-events-none absolute left-0 right-0 h-[2px] rounded-full"
              style={{
                bottom: '0%',
                opacity: 0,
                backgroundColor: '#22d3ee',
                boxShadow: '0 0 5px currentColor',
                transition: 'bottom 130ms cubic-bezier(0.22, 1, 0.36, 1), opacity 220ms ease-out, background-color 150ms ease',
              }}
            />
          </div>
        </div>
        <div className="text-center font-mono text-[9px] tabular-nums text-slate-200">
          <span ref={mtxt}>-∞</span> dBFS
        </div>
        <div className="rounded bg-amber/15 py-0.5 text-center font-mono text-[8px] font-semibold uppercase text-amber">
          {p.params.mode} lim
        </div>
      </div>
    </div>
  );
}
