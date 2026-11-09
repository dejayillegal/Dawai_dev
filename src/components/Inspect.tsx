import { uid } from '../engine/theory';
import { useEffect, useRef, useState } from 'react';
import { engine, store, useApp } from '../store';
import { LAYERS, ROLE_COLORS, ROLE_NAMES } from '../engine/styles';
import type { AutoParam, ProdMode, ScGroup, SynthKind, Track } from '../engine/types';
import { evalLane } from '../engine/audio';
import { newClipAt, regenerateSectionNow, setLayerLevel, splitSelectedAtPlayhead } from '../actions';
import { Badge, Btn, DeviceModule, RotaryKnob, Section, Slider } from '../ui';
import { SidechainPanel } from './Sidechain';
import { actRegenSection } from '../engine/assist';
import { totalBars } from '../engine/types';
import { exportClipToMidi } from '../engine/midiExport';
import { settingsStore, useSettings } from '../engine/settings';
import {
  applyDevicePresetToTrackPatch,
  deleteDevicePreset,
  loadDevicePresets,
  saveDevicePreset,
  type DevicePreset,
} from '../engine/presets';
import { TrackColorPickerTrigger } from './TrackColorDialog';

const ALL_SYNTHS: { id: SynthKind; label: string; cat: string }[] = [
  { id: 'kick', label: '909 / Industrial Kick', cat: 'Drums & Low' },
  { id: 'sub', label: 'Sub Sine / Saturation', cat: 'Drums & Low' },
  { id: 'rumble', label: 'Techno Rumble Sub', cat: 'Drums & Low' },
  { id: 'midbass', label: 'Rolling Saw Bass', cat: 'Drums & Low' },
  { id: 'acid', label: 'TB-303 Acid Bassline', cat: 'Synths' },
  { id: 'stab', label: 'Detuned Minor Chord Stab', cat: 'Synths' },
  { id: 'lead', label: 'Unison Anthem Lead', cat: 'Synths' },
  { id: 'arp', label: 'FM Pluck Arpeggiator', cat: 'Synths' },
  { id: 'pad', label: 'Warm Lush Pad', cat: 'Harmony' },
  { id: 'dubchord', label: 'Dub Techno Chord Tank', cat: 'Harmony' },
  { id: 'drone', label: 'Fifth Harmonic Drone', cat: 'Harmony' },
  { id: 'hat', label: 'Closed Metallic Hat', cat: 'Percussion' },
  { id: 'ohat', label: 'Offbeat Open Hat', cat: 'Percussion' },
  { id: 'ride', label: '909 Ride Cymbal', cat: 'Percussion' },
  { id: 'shaker', label: 'Maraca / Groove Shaker', cat: 'Percussion' },
  { id: 'clap', label: 'Layered Analog Clap', cat: 'Percussion' },
  { id: 'snare', label: 'Snare / Rimshot', cat: 'Percussion' },
  { id: 'perc', label: 'FM Modular Percussion', cat: 'Percussion' },
  { id: 'conga', label: 'Tuned Tribal Conga', cat: 'Percussion' },
  { id: 'tom', label: 'Low-Mid Tom Pulse', cat: 'Percussion' },
  { id: 'clang', label: 'Industrial Metal Clang', cat: 'Percussion' },
  { id: 'noise', label: 'Filtered Noise Texture', cat: 'FX & Transitions' },
  { id: 'crackle', label: 'Vinyl Dust & Crackle', cat: 'FX & Transitions' },
  { id: 'riser', label: 'Pitch & Filter Riser', cat: 'FX & Transitions' },
  { id: 'impact', label: 'Sub Boom Impact', cat: 'FX & Transitions' },
  { id: 'downlift', label: 'Downlifter Sweep', cat: 'FX & Transitions' },
  { id: 'crash', label: 'Crash / Reverse Cymbal', cat: 'FX & Transitions' },
];

/**
 * Interactive Ableton Auto Filter XY Frequency Response Plot.
 * Drag horizontally for Cutoff, vertically for Resonance.
 */
function AutoFilterPlot({
  cutoff,
  res,
  color,
  disabled,
  onChange,
}: {
  cutoff: number;
  res: number;
  color: string;
  disabled?: boolean;
  onChange: (patch: { cutoff?: number; res?: number }) => void;
}) {
  const cvRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = cvRef.current;
    if (!cv) return;
    const g = cv.getContext('2d')!;
    const W = cv.width, H = cv.height;
    g.fillStyle = '#090c10';
    g.fillRect(0, 0, W, H);

    // Grid lines
    g.strokeStyle = '#19202a';
    g.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      g.beginPath();
      g.moveTo((W * i) / 4, 0);
      g.lineTo((W * i) / 4, H);
      g.moveTo(0, (H * i) / 4);
      g.lineTo(W, (H * i) / 4);
      g.stroke();
    }

    // 24dB Low-pass + Resonance response curve
    const fc = 0.08 + cutoff * 0.84;
    const qPeak = res * 0.52;
    g.beginPath();
    for (let x = 0; x <= W; x += 2) {
      const f = x / W;
      let gain = 0.55;
      if (f <= fc) {
        const dist = (fc - f) / Math.max(0.04, fc);
        const bell = Math.exp(-Math.pow(dist * 5.5, 2)) * qPeak;
        gain = 0.55 + bell;
      } else {
        const roll = (f - fc) / Math.max(0.05, 1 - fc);
        const bell = Math.exp(-Math.pow(roll * 6, 2)) * qPeak;
        gain = Math.max(0.02, 0.55 + bell - Math.pow(roll, 1.5) * 0.95);
      }
      const y = H - Math.min(0.95, Math.max(0.04, gain)) * H;
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.strokeStyle = color;
    g.lineWidth = 2;
    g.stroke();

    g.lineTo(W, H);
    g.lineTo(0, H);
    g.closePath();
    g.fillStyle = color + '24';
    g.fill();

    // Node handle
    const hx = fc * W;
    const hy = H - Math.min(0.92, 0.55 + qPeak) * H;
    g.beginPath();
    g.arc(hx, hy, 4.5, 0, Math.PI * 2);
    g.fillStyle = '#0b0e12';
    g.fill();
    g.strokeStyle = '#ffffff';
    g.lineWidth = 1.6;
    g.stroke();
  }, [cutoff, res, color]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    const cv = cvRef.current!;
    e.currentTarget.setPointerCapture(e.pointerId);
    const update = (cx: number, cy: number) => {
      const r = cv.getBoundingClientRect();
      const nx = Math.max(0, Math.min(1, (cx - r.left) / r.width));
      const ny = Math.max(0, Math.min(1, 1 - (cy - r.top) / r.height));
      onChange({ cutoff: +nx.toFixed(2), res: +ny.toFixed(2) });
    };
    update(e.clientX, e.clientY);
    const mv = (ev: PointerEvent) => update(ev.clientX, ev.clientY);
    const up = () => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      try {
        cv.releasePointerCapture(e.pointerId);
      } catch {
        // ignore if already released
      }
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  return (
    <canvas
      ref={cvRef}
      width={220}
      height={64}
      onPointerDown={onPointerDown}
      className="h-16 w-full cursor-crosshair rounded border border-line bg-[#090c10]"
      style={{ touchAction: 'none' }}
      title="Drag X = Filter Cutoff · Drag Y = Resonance Q"
    />
  );
}

export function MasterDevice() {
  const app = useApp();
  const settings = useSettings();
  const p = app.project;
  const P = p.params;
  const cv = useRef<HTMLCanvasElement>(null);
  const setParam = (patch: Partial<typeof P>, key: string) =>
    store.dispatch({ type: 'SET_PARAMS', patch }, `Master · ${key}`, 'user', `master:${key}`);

  const eqLow = settings.eqLow ?? 0;
  const eqMid = settings.eqMid ?? 0;
  const eqHigh = settings.eqHigh ?? 0;
  const isEqFlat = Math.abs(eqLow) < 0.05 && Math.abs(eqMid) < 0.05 && Math.abs(eqHigh) < 0.05;

  useEffect(() => {
    let raf = 0;
    const data = new Uint8Array(512);
    const f = () => {
      const c = cv.current;
      if (c) {
        const g = c.getContext('2d')!;
        const W = c.width;
        const H = c.height;
        g.fillStyle = '#090c10';
        g.fillRect(0, 0, W, H);
        g.strokeStyle = '#19202a';
        g.lineWidth = 1;
        for (let i = 1; i < 4; i++) {
          g.beginPath();
          g.moveTo(0, (H * i) / 4);
          g.lineTo(W, (H * i) / 4);
          g.stroke();
        }
        const a = engine.graph?.analyser;
        if (a) {
          a.getByteFrequencyData(data);
          const n = 96;
          for (let i = 0; i < n; i++) {
            const idx = Math.floor(Math.pow(i / n, 2.2) * 400) + 1;
            const v = data[idx] / 255;
            g.fillStyle = i < 28 ? '#f59e0b' : i < 64 ? '#06b6d4' : '#a78bfa';
            g.fillRect((i / n) * W, H * (1 - v), W / n - 1, H * v);
          }
        } else {
          g.fillStyle = '#64748b';
          g.font = '10px Inter, sans-serif';
          g.fillText('Press Play (▶) for real-time 96-band FFT · Live 3-Band EQ curve active', 10, H - 10);
        }

        // Draw 3-Band Master EQ composite frequency response curve (Pre-Limiter)
        const st = settingsStore.get();
        const lowDb = st.eqLow ?? 0;
        const midDb = st.eqMid ?? 0;
        const highDb = st.eqHigh ?? 0;
        const midY = H * 0.5;

        // 0 dB reference line
        g.strokeStyle = 'rgba(148, 163, 184, 0.25)';
        g.setLineDash([3, 3]);
        g.beginPath();
        g.moveTo(0, midY);
        g.lineTo(W, midY);
        g.stroke();
        g.setLineDash([]);

        // Composite Low Shelf (x ~ 0.18), Mid Bell (x ~ 0.50), High Shelf (x ~ 0.82)
        g.beginPath();
        for (let x = 0; x <= W; x += 2) {
          const norm = x / W;
          const lowResp = lowDb / (1 + Math.exp((norm - 0.24) * 14));
          const midResp = midDb * Math.exp(-Math.pow((norm - 0.5) / 0.17, 2));
          const highResp = highDb / (1 + Math.exp(-(norm - 0.76) * 14));
          const totalDb = Math.max(-14, Math.min(14, lowResp + midResp + highResp));
          const y = midY - (totalDb / 14) * (H * 0.42);
          if (x === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.strokeStyle = '#38bdf8';
        g.lineWidth = 2;
        g.stroke();

        // Band handles
        const bands = [
          { x: W * 0.16, db: lowDb, color: '#f59e0b' },
          { x: W * 0.5, db: midDb, color: '#06b6d4' },
          { x: W * 0.84, db: highDb, color: '#a78bfa' },
        ];
        for (const b of bands) {
          const by = midY - (b.db / 14) * (H * 0.42);
          g.beginPath();
          g.arc(b.x, by, 3.5, 0, Math.PI * 2);
          g.fillStyle = b.color;
          g.fill();
          g.strokeStyle = '#090c10';
          g.lineWidth = 1.2;
          g.stroke();
        }
      }
      raf = requestAnimationFrame(f);
    };
    f();
    return () => cancelAnimationFrame(raf);
  }, []);

  const hasHpAuto = p.auto.some((a) => a.track === 'master' && a.param === 'hp');
  const toggleHpAuto = () => {
    const existing = p.auto.find((a) => a.track === 'master' && a.param === 'hp');
    if (existing) {
      store.dispatch({ type: 'DEL_AUTO', id: existing.id }, 'Remove Master HP automation');
    } else {
      const tb = Math.max(32, totalBars(p));
      store.dispatch(
        {
          type: 'SET_AUTO',
          lane: {
            id: 'a_master_hp',
            track: 'master',
            param: 'hp',
            pts: [
              { bar: 0, v: 0 },
              { bar: Math.floor(tb * 0.5), v: 0.35 },
              { bar: Math.floor(tb * 0.5) + 0.01, v: 0 },
              { bar: tb, v: 0 },
            ],
          },
        },
        'Create Master DJ HPF sweep'
      );
    }
  };

  return (
    <div className="space-y-2.5 p-2.5">
      <DeviceModule
        title="Master Bus · 3-Band EQ, Spectrum & Limiter"
        category="Mastering Suite"
        color="#f59e0b"
        right={<Badge color="#f59e0b">{P.mode.toUpperCase()}</Badge>}
      >
        <canvas ref={cv} width={320} height={84} className="mb-2 h-21 w-full rounded border border-line bg-[#090c10]" />
        <div className="mb-2 text-[10px] text-slate-400">
          Signal path: <b className="text-slate-200">DJ High-Pass (20Hz–1.8kHz)</b> →{' '}
          <b className="text-cyan">3-Band Master EQ (Low/Mid/High)</b> →{' '}
          <b className="text-slate-200">Brickwall Limiter ({settings.limiterCeiling.toFixed(1)} dB)</b> →{' '}
          <b className="text-slate-200">WaveShaper Saturator</b>
        </div>

        {/* 3-Band Master EQ (Pre-Limiter Spectral Shaping) */}
        <div className="mb-2.5 rounded border border-line bg-[#0c1015] p-2">
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-200">
                3-Band Master EQ <span className="text-[9px] font-normal text-cyan">(Pre-Limiter Spectral Shaping)</span>
              </div>
              <div className="text-[8.5px] text-slate-400">
                Low Shelf 110 Hz · Mid Peak 1.0 kHz (Q 0.85) · High Shelf 6.5 kHz
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              <Btn
                small
                active={isEqFlat}
                onClick={() => settingsStore.set({ eqLow: 0, eqMid: 0, eqHigh: 0 })}
                title="Reset all 3 EQ bands to 0.0 dB"
              >
                Flat 0dB
              </Btn>
              <Btn
                small
                onClick={() => settingsStore.set({ eqLow: 3.0, eqMid: -1.5, eqHigh: 2.5 })}
                title="Club Sub & High Air smile curve"
              >
                Sub+Air
              </Btn>
              <Btn
                small
                onClick={() => settingsStore.set({ eqLow: 2.5, eqMid: 1.0, eqHigh: -2.0 })}
                title="Warm analog tape roll-off"
              >
                Warm
              </Btn>
              <Btn
                small
                onClick={() => settingsStore.set({ eqLow: 3.5, eqMid: -2.5, eqHigh: -1.5 })}
                title="Subterranean dark warehouse voicing"
              >
                Dark Vault
              </Btn>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 pt-1">
            <RotaryKnob
              label="Low (110Hz)"
              value={eqLow}
              min={-12}
              max={12}
              step={0.5}
              defaultValue={0}
              bipolar
              color="#f59e0b"
              onChange={(v) => settingsStore.set({ eqLow: v })}
              fmt={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}dB`}
              hint="Master Low Shelf at 110 Hz (pre-limiter sub & kick weight)"
            />
            <RotaryKnob
              label="Mid (1.0kHz)"
              value={eqMid}
              min={-12}
              max={12}
              step={0.5}
              defaultValue={0}
              bipolar
              color="#06b6d4"
              onChange={(v) => settingsStore.set({ eqMid: v })}
              fmt={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}dB`}
              hint="Master Mid Peaking Bell at 1.0 kHz (Q=0.85 body & vocal presence)"
            />
            <RotaryKnob
              label="High (6.5kHz)"
              value={eqHigh}
              min={-12}
              max={12}
              step={0.5}
              defaultValue={0}
              bipolar
              color="#a78bfa"
              onChange={(v) => settingsStore.set({ eqHigh: v })}
              fmt={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}dB`}
              hint="Master High Shelf at 6.5 kHz (hats, air & transient shimmer)"
            />
          </div>
        </div>

        <div className="mb-2.5">
          <div className="mb-1 text-[9px] uppercase tracking-wider text-slate-400">Analog Saturation &amp; Voicing Mode</div>
          <div className="flex gap-1">
            {(['clean', 'hybrid', 'industrial'] as ProdMode[]).map((m) => (
              <Btn
                key={m}
                small
                className="flex-1 capitalize"
                active={P.mode === m}
                onClick={() => setParam({ mode: m }, 'mode')}
              >
                {m}
              </Btn>
            ))}
          </div>
        </div>

        {/* Master Macro & Mastering Knobs */}
        <div className="grid grid-cols-3 gap-2 rounded border border-line bg-[#0c1015] p-2 sm:grid-cols-6">
          <RotaryKnob
            label="Saturation"
            value={P.dirt}
            min={0}
            max={1}
            step={0.01}
            defaultValue={0.3}
            color="#f59e0b"
            onChange={(v) => setParam({ dirt: v }, 'dirt')}
            fmt={(v) => `${Math.round(v * 100)}%`}
          />
          <RotaryKnob
            label="Dub Space"
            value={P.depth}
            min={0}
            max={1}
            step={0.01}
            defaultValue={0.4}
            color="#06b6d4"
            onChange={(v) => setParam({ depth: v }, 'depth')}
            fmt={(v) => `${Math.round(v * 100)}%`}
          />
          <RotaryKnob
            label="Swing"
            value={P.swing}
            min={0.5}
            max={0.68}
            step={0.005}
            defaultValue={0.54}
            color="#22c55e"
            onChange={(v) => setParam({ swing: v }, 'swing')}
            fmt={(v) => `${(v * 100).toFixed(1)}%`}
          />
          <RotaryKnob
            label="Acid Drive"
            value={P.acid}
            min={0}
            max={1}
            step={0.01}
            defaultValue={0.5}
            color="#fbbf24"
            onChange={(v) => setParam({ acid: v }, 'acid')}
            fmt={(v) => `${Math.round(v * 100)}%`}
          />
          <RotaryKnob
            label="Density"
            value={P.density}
            min={0}
            max={1}
            step={0.01}
            defaultValue={0.65}
            color="#a78bfa"
            onChange={(v) => setParam({ density: v }, 'density')}
            fmt={(v) => `${Math.round(v * 100)}%`}
          />
          <RotaryKnob
            label="Tempo"
            value={P.bpm}
            min={110}
            max={150}
            step={1}
            defaultValue={135}
            color="#f97316"
            onChange={(v) => setParam({ bpm: v }, 'bpm')}
            fmt={(v) => `${Math.round(v)}`}
          />
        </div>

        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-1 border-t border-line pt-2">
          <div className="flex gap-1">
            {(['bass', 'harm', 'fx'] as ScGroup[]).map((g) => (
              <Btn key={g} small tone="cyan" onClick={() => store.select({ kind: 'device', id: g })}>
                SC · {g.toUpperCase()}
              </Btn>
            ))}
          </div>
          <Btn small active={hasHpAuto} onClick={toggleHpAuto}>
            {hasHpAuto ? '● DJ HPF Automated' : '+ Automate DJ HPF'}
          </Btn>
        </div>
      </DeviceModule>
    </div>
  );
}

/**
 * Horizontal Ableton Live-style Device Rack for the bottom dock ('Devices' tab).
 * Displays Instrument, Auto Filter (with XY curve), Space Sends, Sidechain Bus, and Master Limiter side by side.
 */
export function DeviceRack({ onOpenAuto }: { onOpenAuto?: () => void }) {
  const app = useApp();
  const p = app.project;
  const sel = app.selection;
  const [liveBar, setLiveBar] = useState(() => app.cursorBar);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      if (now - last >= 45) {
        last = now;
        const st = engine.playing ? engine.getStep() : -1;
        setLiveBar(st >= 0 ? st / 16 : store.get().cursorBar);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const activeTrack: Track | undefined =
    sel.kind === 'track'
      ? p.tracks.find((t) => t.id === sel.id)
      : sel.kind === 'clip'
        ? p.tracks.find((t) => t.id === sel.track)
        : p.tracks[0];

  if (sel.kind === 'device') {
    return (
      <div className="h-full overflow-y-auto bg-bg">
        {sel.id === 'master' ? <MasterDevice /> : <SidechainPanel group={sel.id} />}
      </div>
    );
  }

  if (!activeTrack) {
    return (
      <div className="h-full overflow-y-auto bg-bg">
        <MasterDevice />
      </div>
    );
  }

  const t = activeTrack;
  const def = LAYERS[t.layer];
  const up = (patch: Partial<Track>, k: string) =>
    store.dispatch({ type: 'SET_TRACK', id: t.id, patch }, `Device · ${t.name}`, 'user', `${k}:${t.id}`);
  const findLane = (param: AutoParam) => p.auto.find((a) => a.track === t.id && a.param === param);
  const lane = (param: AutoParam) => !!findLane(param);
  const liveVal = (param: AutoParam, base: number) => {
    const l = findLane(param);
    return l && l.pts.length ? evalLane(l, liveBar) : base;
  };
  const ensureAutoLane = (param: AutoParam) => {
    const exists = findLane(param);
    if (!exists) {
      const tb = Math.max(32, totalBars(p));
      const base = param === 'cutoff' ? t.cutoff : param === 'res' ? t.res : param === 'rev' ? t.rev : t.vol;
      store.dispatch(
        {
          type: 'SET_AUTO',
          lane: {
            id: `a_${t.id}_${param}`,
            track: t.id,
            param,
            pts: [
              { bar: 0, v: Math.min(1, Math.max(0, base)) },
              { bar: Math.floor(tb * 0.5), v: Math.min(1, Math.max(0, base + 0.3)), curve: 0.4 },
              { bar: tb, v: Math.min(1, Math.max(0, base)), curve: -0.35 },
            ],
          },
        },
        `Create ${param} automation`
      );
    }
    store.select({ kind: 'track', id: t.id });
    onOpenAuto?.();
  };

  const scGroup: ScGroup = t.sc ?? 'bass';
  const scCfg = p.sc[scGroup];
  const liveCut = liveVal('cutoff', t.cutoff);
  const liveRes = liveVal('res', t.res);
  const liveRev = liveVal('rev', t.rev);
  const liveVol = lane('vol') ? t.vol * liveVal('vol', 1) : t.vol;

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      {/* Track Device Chain Selector + Preset Management Bar */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line bg-panel px-2.5 py-1">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Track Chain:</span>
          {p.tracks.map((trk) => (
            <button
              key={trk.id}
              type="button"
              onClick={() => store.select({ kind: 'track', id: trk.id })}
              className={`flex shrink-0 items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-medium transition-colors ${
                trk.id === t.id ? 'border-amber bg-amber/15 text-amber' : 'border-line bg-elev text-slate-300 hover:text-white'
              }`}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: trk.color }} />
              <span>{trk.name}</span>
            </button>
          ))}
        </div>
        <DevicePresetManager track={t} compact />
      </div>

      {/* Horizontal Ableton Device Modules */}
      <div className="flex min-h-0 flex-1 gap-2.5 overflow-x-auto p-2.5">
        {/* 1. Instrument Module */}
        <DeviceModule
          title={`Instrument · ${t.synth.toUpperCase()}`}
          category={def?.reg ?? t.group}
          active={!t.mute}
          color={t.color}
          onToggle={() => up({ mute: !t.mute }, 'mute')}
          className="w-[248px] shrink-0"
          right={<Badge color={t.color}>{t.group}</Badge>}
        >
          <label className="mb-1.5 block text-[9px] uppercase tracking-wider text-slate-400">
            Synthesizer Engine (27 Archetypes)
            <select
              aria-label="Synthesizer archetype"
              value={t.synth}
              disabled={t.lock}
              onChange={(e) => up({ synth: e.target.value as SynthKind }, 'synth')}
              className="mt-0.5 w-full text-[11px] font-medium text-slate-100 normal-case"
            >
              {ALL_SYNTHS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.cat} · {s.label} ({s.id})
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2 rounded border border-line bg-[#0c1015] p-1.5">
            <RotaryKnob
              label="Volume"
              value={t.vol}
              liveValue={liveVol}
              min={0}
              max={1.4}
              step={0.01}
              defaultValue={def?.vol ?? 0.6}
              size={42}
              color={t.color}
              automated={lane('vol')}
              disabled={t.lock}
              onChange={(v) => up({ vol: v }, 'vol')}
              fmt={(v) => (v > 0.001 ? `${(20 * Math.log10(v)).toFixed(1)}dB` : '-∞')}
            />
            <RotaryKnob
              label="Pan"
              value={t.pan}
              min={-1}
              max={1}
              step={0.02}
              defaultValue={0}
              size={42}
              bipolar
              color="#38bdf8"
              disabled={t.lock}
              onChange={(v) => up({ pan: v }, 'pan')}
              fmt={(v) => (Math.abs(v) < 0.02 ? 'C' : v < 0 ? `${Math.round(-v * 50)}L` : `${Math.round(v * 50)}R`)}
            />
          </div>
          <div className="mt-1.5">
            <Slider
              label="Output Gain Fader"
              value={t.vol}
              min={0}
              max={1.4}
              step={0.01}
              disabled={t.lock}
              onChange={(v) => up({ vol: v }, 'vol')}
              fmt={(v) => (v > 0.001 ? `${(20 * Math.log10(v)).toFixed(1)} dB` : '-∞')}
            />
          </div>
          <div className="mt-1.5 flex gap-1">
            <Btn small active={t.mute} onClick={() => up({ mute: !t.mute }, 'mute')}>
              Mute
            </Btn>
            <Btn small active={t.solo} onClick={() => up({ solo: !t.solo }, 'solo')}>
              Solo
            </Btn>
            <Btn small tone="amber" onClick={() => newClipAt(t.id, Math.floor(store.get().cursorBar))}>
              + Clip
            </Btn>
          </div>
        </DeviceModule>

        {/* 2. Auto Filter 24dB Module */}
        <DeviceModule
          title="Auto Filter · 24dB Ladder"
          category="Audio Effect"
          color="#06b6d4"
          className="w-[262px] shrink-0"
          right={
            <Btn small tone="ghost" onClick={() => ensureAutoLane('cutoff')} title="Edit filter automation">
              {lane('cutoff') ? '● Auto' : '+ Auto'}
            </Btn>
          }
        >
          <AutoFilterPlot
            cutoff={liveCut}
            res={liveRes}
            color="#06b6d4"
            disabled={t.lock}
            onChange={(patch) => up(patch, 'filter')}
          />
          <div className="mt-1.5 grid grid-cols-2 gap-2 rounded border border-line bg-[#0c1015] p-1.5">
            <RotaryKnob
              label="Filter Offset"
              value={t.cutoff}
              liveValue={liveCut}
              min={0}
              max={1}
              step={0.01}
              defaultValue={0.5}
              size={42}
              bipolar
              color="#06b6d4"
              automated={lane('cutoff')}
              disabled={t.lock}
              onChange={(v) => up({ cutoff: v }, 'cut')}
              fmt={(v) => `${Math.round((v - 0.5) * 6000)}ct`}
            />
            <RotaryKnob
              label="Resonance"
              value={t.res}
              liveValue={liveRes}
              min={0}
              max={1}
              step={0.01}
              defaultValue={0.3}
              size={42}
              color="#f472b6"
              automated={lane('res')}
              disabled={t.lock}
              onChange={(v) => up({ res: v }, 'res')}
              fmt={(v) => `${Math.round(v * 100)}%`}
            />
          </div>
          <div className="mt-1.5">
            <Slider
              label="Cutoff Frequency Sweep"
              value={liveCut}
              min={0}
              max={1}
              step={0.01}
              cy={lane('cutoff')}
              disabled={t.lock}
              onChange={(v) => up({ cutoff: v }, 'cut')}
              fmt={(v) => `${Math.round((v - 0.5) * 6000)} ct`}
            />
          </div>
        </DeviceModule>

        {/* 3. Cathedral Reverb & Dotted Delay Sends */}
        <DeviceModule
          title="Space · Reverb & Echo"
          category="Send Returns"
          color="#a78bfa"
          className="w-[238px] shrink-0"
          right={
            <Btn small tone="ghost" onClick={() => ensureAutoLane('rev')}>
              {lane('rev') ? '● Auto' : '+ Auto'}
            </Btn>
          }
        >
          <div className="grid grid-cols-2 gap-2 rounded border border-line bg-[#0c1015] p-1.5">
            <RotaryKnob
              label="Reverb Send"
              value={t.rev}
              liveValue={liveRev}
              min={0}
              max={1}
              step={0.01}
              defaultValue={def?.rev ?? 0.15}
              size={42}
              color="#a78bfa"
              automated={lane('rev')}
              disabled={t.lock}
              onChange={(v) => up({ rev: v }, 'rev')}
              fmt={(v) => `${Math.round(v * 100)}%`}
            />
            <RotaryKnob
              label="Delay Send"
              value={t.del}
              min={0}
              max={1}
              step={0.01}
              defaultValue={def?.del ?? 0.1}
              size={42}
              color="#22c55e"
              disabled={t.lock}
              onChange={(v) => up({ del: v }, 'del')}
              fmt={(v) => `${Math.round(v * 100)}%`}
            />
          </div>
          <div className="mt-1.5 space-y-1">
            <Slider
              label="Reverb Wet Level"
              value={liveRev}
              min={0}
              max={1}
              step={0.01}
              cy={lane('rev')}
              disabled={t.lock}
              onChange={(v) => up({ rev: v }, 'rev')}
              fmt={(v) => `${Math.round(v * 100)}%`}
            />
            <Slider
              label="3/16 Dub Delay Level"
              value={t.del}
              min={0}
              max={1}
              step={0.01}
              disabled={t.lock}
              onChange={(v) => up({ del: v }, 'del')}
              fmt={(v) => `${Math.round(v * 100)}%`}
            />
          </div>
        </DeviceModule>

        {/* 4. Glue Sidechain Bus Compressor */}
        <DeviceModule
          title={`Sidechain · ${t.sc ? t.sc.toUpperCase() : 'BYPASS'}`}
          category="Kick Key Ducking"
          active={!!t.sc && p.scOn}
          color="#f59e0b"
          className="w-[264px] shrink-0"
          right={
            <select
              aria-label="Track sidechain bus"
              value={t.sc ?? ''}
              onChange={(e) => up({ sc: (e.target.value || null) as ScGroup | null }, 'sc')}
              className="h-5 !py-0 px-1 text-[9px]"
            >
              <option value="">No SC</option>
              <option value="bass">SC Bass</option>
              <option value="harm">SC Harm</option>
              <option value="fx">SC FX</option>
            </select>
          }
        >
          <div className="grid grid-cols-3 gap-1.5 rounded border border-line bg-[#0c1015] p-1.5">
            <RotaryKnob
              label="Threshold"
              value={scCfg.thr}
              min={-60}
              max={0}
              step={0.5}
              defaultValue={-24}
              size={40}
              color="#f59e0b"
              disabled={!t.sc}
              onChange={(v) => store.dispatch({ type: 'SET_SC', group: scGroup, patch: { thr: v } }, 'SC Threshold')}
              fmt={(v) => `${v.toFixed(0)}dB`}
            />
            <RotaryKnob
              label="Ratio"
              value={scCfg.ratio}
              min={1}
              max={20}
              step={0.5}
              defaultValue={6}
              size={40}
              color="#06b6d4"
              disabled={!t.sc}
              onChange={(v) => store.dispatch({ type: 'SET_SC', group: scGroup, patch: { ratio: v } }, 'SC Ratio')}
              fmt={(v) => `${v.toFixed(0)}:1`}
            />
            <RotaryKnob
              label="Wet/Dry"
              value={scCfg.mix}
              min={0}
              max={1}
              step={0.01}
              defaultValue={0.9}
              size={40}
              color="#22c55e"
              disabled={!t.sc}
              onChange={(v) => store.dispatch({ type: 'SET_SC', group: scGroup, patch: { mix: v } }, 'SC Mix')}
              fmt={(v) => `${Math.round(v * 100)}%`}
            />
          </div>
          <div className="mt-1.5">
            <Slider
              label="Release Time"
              value={scCfg.rel}
              min={30}
              max={600}
              step={5}
              disabled={!t.sc}
              onChange={(v) => store.dispatch({ type: 'SET_SC', group: scGroup, patch: { rel: v } }, 'SC Release')}
              fmt={(v) => `${Math.round(v)} ms`}
            />
          </div>
          <div className="mt-1.5 flex justify-between">
            <Btn small tone="cyan" onClick={() => store.select({ kind: 'device', id: scGroup })}>
              Full SC Scope ›
            </Btn>
            <Btn small onClick={() => store.select({ kind: 'device', id: 'master' })}>
              Master Rack ›
            </Btn>
          </div>
        </DeviceModule>
      </div>
    </div>
  );
}

function DevicePresetManager({ track, compact = false }: { track: Track; compact?: boolean }) {
  const settings = useSettings();
  const [presets, setPresets] = useState<DevicePreset[]>(() => loadDevicePresets());
  const [selectedId, setSelectedId] = useState<string>(() => {
    const list = loadDevicePresets();
    const match = list.find((p) => p.track.synth === track.synth);
    return match?.id ?? list[0]?.id ?? '';
  });
  const [isSaving, setIsSaving] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const selectedPreset = presets.find((p) => p.id === selectedId) ?? presets[0];

  const applyPreset = (preset: DevicePreset | undefined) => {
    if (!preset || track.lock) return;
    store.dispatch(
      {
        type: 'SET_TRACK',
        id: track.id,
        patch: applyDevicePresetToTrackPatch(preset),
      },
      `Preset · ${preset.name}`
    );
    settingsStore.set({
      eqLow: preset.eq.eqLow,
      eqMid: preset.eq.eqMid,
      eqHigh: preset.eq.eqHigh,
    });
    setStatusMsg(`Loaded "${preset.name}"`);
    setTimeout(() => setStatusMsg(null), 2200);
  };

  const handleSave = () => {
    const nameToSave = presetName.trim() || `${track.name} · ${track.synth.toUpperCase()}`;
    const saved = saveDevicePreset(
      nameToSave,
      track,
      {
        eqLow: settings.eqLow,
        eqMid: settings.eqMid,
        eqHigh: settings.eqHigh,
      },
      'Custom'
    );
    const updated = loadDevicePresets();
    setPresets(updated);
    setSelectedId(saved.id);
    setPresetName('');
    setIsSaving(false);
    setStatusMsg(`Saved "${saved.name}"`);
    setTimeout(() => setStatusMsg(null), 2200);
  };

  const handleDelete = () => {
    if (!selectedPreset || selectedPreset.builtIn) return;
    const updated = deleteDevicePreset(selectedPreset.id);
    setPresets(updated);
    setSelectedId(updated[0]?.id ?? '');
    setStatusMsg(`Deleted preset`);
    setTimeout(() => setStatusMsg(null), 2000);
  };

  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-cyan-300">Rack Preset:</span>
        <select
          aria-label="Device Rack Preset"
          value={selectedId}
          disabled={track.lock}
          onChange={(e) => {
            const id = e.target.value;
            setSelectedId(id);
            const found = presets.find((p) => p.id === id);
            if (found) applyPreset(found);
          }}
          className="h-6 rounded border border-line bg-elev px-1.5 text-[10px] font-medium text-slate-100"
        >
          {presets.map((pr) => (
            <option key={pr.id} value={pr.id}>
              {pr.builtIn ? `[${pr.category}] ` : '★ [User] '}
              {pr.name}
            </option>
          ))}
        </select>
        <Btn
          small
          tone="cyan"
          disabled={track.lock || !selectedPreset}
          onClick={() => applyPreset(selectedPreset)}
          title="Apply selected preset (Synth, Filter Cutoff/Res, Reverb/Delay Sends & 3-Band EQ)"
        >
          Load
        </Btn>
        {!isSaving ? (
          <Btn
            small
            tone="amber"
            disabled={track.lock}
            onClick={() => {
              setPresetName(`${track.name} Custom`);
              setIsSaving(true);
            }}
            title="Save current track Filter, Sends, Synth & EQ configuration as a preset"
          >
            + Save Preset
          </Btn>
        ) : (
          <div className="flex items-center gap-1">
            <input
              type="text"
              aria-label="New preset name"
              placeholder="Preset name..."
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave();
                if (e.key === 'Escape') setIsSaving(false);
              }}
              className="h-6 w-32 rounded border border-amber/60 bg-[#0b0e12] px-1.5 text-[10px] text-slate-100"
            />
            <Btn small tone="amber" onClick={handleSave}>
              Save
            </Btn>
            <Btn small tone="ghost" onClick={() => setIsSaving(false)}>
              ✕
            </Btn>
          </div>
        )}
        {selectedPreset && !selectedPreset.builtIn && (
          <Btn small tone="red" onClick={handleDelete} title="Delete custom preset">
            Del
          </Btn>
        )}
        {statusMsg && <span className="text-[9px] font-medium text-emerald-400">{statusMsg}</span>}
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-md border border-line bg-[#0b0f14] p-2">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-cyan-300">
          Device Rack Preset (EQ · Filter · Sends)
        </span>
        {statusMsg && <span className="text-[9px] font-medium text-emerald-400">{statusMsg}</span>}
      </div>
      <div className="flex items-center gap-1.5">
        <select
          aria-label="Track Device Preset"
          value={selectedId}
          disabled={track.lock}
          onChange={(e) => {
            const id = e.target.value;
            setSelectedId(id);
            const found = presets.find((p) => p.id === id);
            if (found) applyPreset(found);
          }}
          className="h-7 flex-1 rounded border border-line bg-elev px-2 text-[11px] font-medium text-slate-100"
        >
          {presets.map((pr) => (
            <option key={pr.id} value={pr.id}>
              {pr.builtIn ? `[${pr.category}] ` : '★ [User] '}
              {pr.name}
            </option>
          ))}
        </select>
        <Btn small tone="cyan" disabled={track.lock || !selectedPreset} onClick={() => applyPreset(selectedPreset)}>
          Load
        </Btn>
        {selectedPreset && !selectedPreset.builtIn && (
          <Btn small tone="red" onClick={handleDelete}>
            Del
          </Btn>
        )}
      </div>
      {selectedPreset && (
        <div className="mt-1.5 flex flex-wrap gap-1 text-[9px] font-mono text-slate-400">
          <span className="rounded bg-[#131922] px-1.5 py-0.5 text-slate-300">
            SYNTH: {selectedPreset.track.synth}
          </span>
          <span className="rounded bg-[#131922] px-1.5 py-0.5 text-cyan-300">
            CUT/RES: {Math.round(selectedPreset.track.cutoff * 100)}%/{Math.round(selectedPreset.track.res * 100)}%
          </span>
          <span className="rounded bg-[#131922] px-1.5 py-0.5 text-violet-300">
            REV/DEL: {Math.round(selectedPreset.track.rev * 100)}%/{Math.round(selectedPreset.track.del * 100)}%
          </span>
          <span className="rounded bg-[#131922] px-1.5 py-0.5 text-amber">
            EQ: {selectedPreset.eq.eqLow >= 0 ? '+' : ''}
            {selectedPreset.eq.eqLow}/{selectedPreset.eq.eqMid >= 0 ? '+' : ''}
            {selectedPreset.eq.eqMid}/{selectedPreset.eq.eqHigh >= 0 ? '+' : ''}
            {selectedPreset.eq.eqHigh}dB
          </span>
        </div>
      )}
      <div className="mt-2 flex items-center gap-1.5">
        <input
          type="text"
          aria-label="Save preset name"
          placeholder={`Save current (${track.name}) as preset...`}
          value={presetName}
          disabled={track.lock}
          onChange={(e) => setPresetName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSave();
          }}
          className="h-7 flex-1 rounded border border-line bg-elev px-2 text-[11px] text-slate-100"
        />
        <Btn small tone="amber" disabled={track.lock} onClick={handleSave}>
          Save Preset
        </Btn>
      </div>
    </div>
  );
}

export function Inspect() {
  const app = useApp();
  const p = app.project;
  const sel = app.selection;

  if (sel.kind === 'device') {
    return sel.id === 'master' ? <MasterDevice /> : <SidechainPanel group={sel.id as ScGroup} />;
  }

  if (sel.kind === 'section') {
    const s = p.sections.find((x) => x.id === sel.id);
    if (!s) return null;
    const i = p.sections.indexOf(s);
    const next = p.sections[i + 1];
    const prev = p.sections[i - 1];
    const B = s.start;
    const incoming = p.tracks
      .filter((t) => t.group === 'Transition')
      .flatMap((t) =>
        t.clips.filter((c) => c.start >= B - 9 && c.start <= B + 0.01).map((c) => `${c.label} @${c.start + 1}`)
      );
    const dE = prev ? s.energy - prev.energy : 0;
    const layers = p.tracks.filter((t) => t.group !== 'Transition' && LAYERS[t.layer]);
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title="Section & Macro Energy" collapsible right={<Badge color={ROLE_COLORS[s.role]}>{ROLE_NAMES[s.role]}</Badge>}>
          <div className="mb-2 flex items-center justify-between text-[12px]">
            <b>{s.name}</b>
            <span className="font-mono tabular-nums text-slate-400">
              bars {s.start + 1}–{s.start + s.bars} ({s.bars})
            </span>
          </div>
          <Slider
            label="Target energy"
            value={s.energy}
            min={0.05}
            max={1}
            disabled={s.lock}
            onChange={(v) =>
              store.dispatch({ type: 'SET_SECTION', id: s.id, patch: { energy: v } }, `Energy · ${s.name}`, 'user', `energy:${s.id}`)
            }
          />
          <div className="mt-2 flex flex-wrap gap-1">
            <Btn
              small
              active={s.lock}
              onClick={() => store.dispatch({ type: 'SET_SECTION', id: s.id, patch: { lock: !s.lock } }, 'Lock section')}
            >
              🔒 Lock
            </Btn>
            <Btn small disabled={s.lock} onClick={() => regenerateSectionNow(s.id)}>
              ↻ Regenerate
            </Btn>
            <Btn small tone="cyan" onClick={() => store.propose(() => actRegenSection(p, s.id, 'darker'))}>
              AI: darker
            </Btn>
            <Btn small tone="cyan" onClick={() => store.propose(() => actRegenSection(p, s.id, 'harder'))}>
              AI: harder
            </Btn>
            <Btn
              small
              onClick={() =>
                store.dispatch({ type: 'SET_LOOP', loop: { on: true, a: s.start, b: s.start + s.bars } }, 'Loop section')
              }
            >
              Loop
            </Btn>
          </div>
        </Section>
        <Section title="Transition rules" collapsible>
          <div className="space-y-1 text-[11px] text-slate-300">
            <div>
              Incoming ΔE:{' '}
              <b className={dE > 0.25 ? 'text-amber' : dE < -0.2 ? 'text-violet-400' : ''}>
                {dE >= 0 ? '+' : ''}
                {dE.toFixed(2)}
              </b>{' '}
              <span className="text-slate-500">
                {dE > 0.25
                  ? '→ riser · fill · void · impact · HP sweep'
                  : dE < -0.2
                    ? '→ delay throw · downlifter · pad swell'
                    : prev
                      ? '→ light phrase hit'
                      : '(first section)'}
              </span>
            </div>
            <div className="text-slate-400">Atoms placed before this section:</div>
            <div className="flex flex-wrap gap-1">
              {incoming.length ? (
                incoming.map((x, k) => (
                  <span key={k} className="rounded bg-pink-500/15 px-1.5 py-0.5 text-[10px] text-pink-300">
                    {x}
                  </span>
                ))
              ) : (
                <span className="text-[10px] text-slate-500">none</span>
              )}
            </div>
            {next && (
              <div className="text-[10px] text-slate-500">
                Outgoing ΔE: {(next.energy - s.energy >= 0 ? '+' : '') + (next.energy - s.energy).toFixed(2)} → {next.name}
              </div>
            )}
          </div>
        </Section>
        <Section title="Active layer mask">
          <div className="space-y-0.5">
            {layers.map((t) => {
              const lv = s.levels[t.id] ?? s.levels[t.layer] ?? 0;
              const key = `${s.id}:${t.id}`;
              const ov = p.overrides[key];
              return (
                <div key={t.id} className="flex items-center gap-1.5 text-[10px]">
                  <span className="w-24 truncate" style={{ color: t.color }}>
                    {t.name}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#0e1216]">
                    <div className="h-full rounded-full" style={{ width: `${lv * 100}%`, background: t.color }} />
                  </div>
                  <span className="w-7 text-right font-mono tabular-nums text-slate-400">{Math.round(lv * 100)}</span>
                  {([
                    ['off', 0],
                    ['½', 0.45],
                    ['full', 1],
                    ['auto', null],
                  ] as const).map(([lab, v]) => (
                    <button
                      key={lab}
                      disabled={s.lock || t.lock}
                      onClick={() => setLayerLevel(s.id, t.id, v)}
                      className={`h-4 rounded px-1 text-[8px] ${
                        (v === null ? ov === undefined : ov === v)
                          ? 'bg-amber text-black'
                          : 'bg-[#232b35] text-slate-400 hover:text-white'
                      }`}
                    >
                      {lab}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </Section>
      </div>
    );
  }

  if (sel.kind === 'track') {
    const t = p.tracks.find((x) => x.id === sel.id);
    if (!t) return null;
    const def = LAYERS[t.layer];
    const up = (patch: Partial<typeof t>, k: string) =>
      store.dispatch({ type: 'SET_TRACK', id: t.id, patch }, `Track · ${t.name}`, 'user', `${k}:${t.id}`);
    const lane = (param: string) => p.auto.some((a) => a.track === t.id && a.param === param);
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title="Track & Instrument" right={<Badge color={t.color}>{t.group}</Badge>}>
          <input
            value={t.name}
            onChange={(e) => up({ name: e.target.value }, 'name')}
            aria-label="Track name"
            className="mb-2 h-8 w-full rounded-md border border-line bg-elev px-2 text-[12px] font-semibold"
          />
          <div className="mb-2 flex flex-wrap gap-1">
            <Btn small active={t.mute} onClick={() => up({ mute: !t.mute }, 'mute')}>
              Mute
            </Btn>
            <Btn small active={t.solo} onClick={() => up({ solo: !t.solo }, 'solo')}>
              Solo
            </Btn>
            <Btn small active={t.lock} onClick={() => up({ lock: !t.lock }, 'lock')}>
              🔒 Lock edits
            </Btn>
            <Btn
              small
              tone="amber"
              disabled={t.lock}
              onClick={() => newClipAt(t.id, Math.floor(store.get().cursorBar))}
            >
              + Clip
            </Btn>
            <TrackColorPickerTrigger track={t} label="🎨 Track Color" compact />
          </div>
          <label className="block text-[10px] uppercase tracking-wider text-slate-400">
            Synth Engine ({def?.reg ?? 'user'})
            <select
              aria-label="Synth Engine"
              value={t.synth}
              disabled={t.lock}
              onChange={(e) => up({ synth: e.target.value as SynthKind }, 'synth')}
              className="mt-0.5 w-full text-[11px] font-medium text-slate-200 normal-case"
            >
              {ALL_SYNTHS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.cat} · {s.label} ({s.id})
                </option>
              ))}
            </select>
          </label>
          <DevicePresetManager track={t} />
        </Section>

        <Section title="Auto Filter · Tone & Sends">
          <div className="mb-2">
            <AutoFilterPlot
              cutoff={t.cutoff}
              res={t.res}
              color={t.color}
              disabled={t.lock || lane('cutoff')}
              onChange={(patch) => up(patch, 'filter')}
            />
          </div>
          {/* Ableton-style Rotary Knob Rack */}
          <div className="grid grid-cols-3 gap-2 rounded border border-line bg-[#0c1015] p-2">
            <RotaryKnob
              label="Volume"
              value={t.vol}
              min={0}
              max={1.4}
              step={0.01}
              defaultValue={def?.vol ?? 0.6}
              color={t.color}
              automated={lane('vol')}
              disabled={t.lock}
              onChange={(v) => up({ vol: v }, 'vol')}
              fmt={(v) => (v > 0.001 ? `${(20 * Math.log10(v)).toFixed(1)} dB` : '-∞')}
            />
            <RotaryKnob
              label="Pan"
              value={t.pan}
              min={-1}
              max={1}
              step={0.02}
              defaultValue={0}
              bipolar
              color="#38bdf8"
              disabled={t.lock}
              onChange={(v) => up({ pan: v }, 'pan')}
              fmt={(v) => (Math.abs(v) < 0.02 ? 'C' : v < 0 ? `${Math.round(-v * 50)}L` : `${Math.round(v * 50)}R`)}
            />
            <RotaryKnob
              label={`Filter offset${lane('cutoff') ? ' (automated)' : ''}`}
              value={t.cutoff}
              min={0}
              max={1}
              step={0.01}
              defaultValue={0.5}
              bipolar
              color="#06b6d4"
              automated={lane('cutoff')}
              disabled={t.lock || lane('cutoff')}
              onChange={(v) => up({ cutoff: v }, 'cut')}
              fmt={(v) => `${Math.round((v - 0.5) * 6000)} ct`}
            />
            <RotaryKnob
              label={`Resonance${lane('res') ? ' (automated)' : ''}`}
              value={t.res}
              min={0}
              max={1}
              step={0.01}
              defaultValue={0.3}
              color="#f472b6"
              automated={lane('res')}
              disabled={t.lock || lane('res')}
              onChange={(v) => up({ res: v }, 'res')}
              fmt={(v) => `${Math.round(v * 100)}%`}
            />
            <RotaryKnob
              label="Reverb send"
              value={t.rev}
              min={0}
              max={1}
              step={0.01}
              defaultValue={def?.rev ?? 0.15}
              color="#a78bfa"
              automated={lane('rev')}
              disabled={t.lock || lane('rev')}
              hint={lane('rev') ? 'Automated — edit in the Automation tab' : undefined}
              onChange={(v) => up({ rev: v }, 'rev')}
              fmt={(v) => `${Math.round(v * 100)}%`}
            />
            <RotaryKnob
              label="Delay send"
              value={t.del}
              min={0}
              max={1}
              step={0.01}
              defaultValue={def?.del ?? 0.1}
              color="#22c55e"
              disabled={t.lock}
              onChange={(v) => up({ del: v }, 'del')}
              fmt={(v) => `${Math.round(v * 100)}%`}
            />
          </div>
        </Section>

        <Section title="Routing · sidechain">
          <label className="block text-[10px] uppercase tracking-wider text-slate-400">
            Ducked by Kick via
            <select
              value={t.sc ?? ''}
              onChange={(e) => up({ sc: (e.target.value || null) as ScGroup | null }, 'sc')}
              className="mt-0.5 w-full text-[11px] normal-case"
            >
              <option value="">— none (direct to master)</option>
              <option value="bass">Bass bus compressor</option>
              <option value="harm">Harmony bus compressor</option>
              <option value="fx">FX bus compressor</option>
            </select>
          </label>
          <div className="mt-2 flex flex-wrap gap-1">
            {t.sc && (
              <Btn small tone="cyan" onClick={() => store.select({ kind: 'device', id: t.sc as ScGroup })}>
                Open sidechain device ›
              </Btn>
            )}
            <Btn small onClick={() => store.select({ kind: 'device', id: 'master' })}>
              Master suite ›
            </Btn>
            <Btn
              small
              tone="red"
              onClick={() => {
                store.dispatch(
                  {
                    type: 'PATCH',
                    patch: {
                      tracks: p.tracks.filter((x) => x.id !== t.id),
                      auto: p.auto.filter((a) => a.track !== t.id),
                    },
                  },
                  `Remove ${t.name}`
                );
                store.select({ kind: 'none' });
              }}
            >
              Remove track
            </Btn>
          </div>
        </Section>
      </div>
    );
  }

  if (sel.kind === 'clip') {
    const t = p.tracks.find((x) => x.id === sel.track);
    const c = t?.clips.find((x) => x.id === sel.id);
    if (!t || !c) return null;
    const up = (patch: Partial<typeof c>, k: string) =>
      store.dispatch({ type: 'SET_CLIP', id: c.id, patch }, `Clip · ${c.label}`, 'user', `${k}:${c.id}`);
    const tb = totalBars(p);
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section
          title="Clip"
          right={
            <div className="flex items-center gap-1.5">
              <TrackColorPickerTrigger track={t} label="🎨 Track Color" compact />
              <Badge color={t.color}>{t.name}</Badge>
            </div>
          }
        >
          <input
            value={c.label}
            onChange={(e) => up({ label: e.target.value }, 'label')}
            aria-label="Clip name"
            className="mb-2 h-8 w-full rounded-md border border-line bg-elev px-2 text-[12px]"
          />
          <div className="grid grid-cols-4 gap-1.5 rounded border border-line bg-[#0c1015] p-2">
            <RotaryKnob
              label="Clip gain"
              value={c.gain}
              min={0}
              max={1.5}
              step={0.01}
              defaultValue={1}
              size={42}
              color={t.color}
              onChange={(v) => up({ gain: v }, 'gain')}
              fmt={(v) => `${Math.round(v * 100)}%`}
            />
            <RotaryKnob
              label="Transpose"
              value={c.transpose}
              min={-24}
              max={24}
              step={1}
              defaultValue={0}
              size={42}
              bipolar
              color="#06b6d4"
              onChange={(v) => up({ transpose: v }, 'tr')}
              fmt={(v) => `${v > 0 ? '+' : ''}${v}st`}
            />
            <RotaryKnob
              label="Loop (steps)"
              value={c.loop}
              min={1}
              max={64}
              step={1}
              defaultValue={16}
              size={42}
              color="#a78bfa"
              onChange={(v) => up({ loop: v }, 'loop')}
              fmt={(v) => `${Math.round(v)}st`}
            />
            <RotaryKnob
              label="Phase"
              value={c.off}
              min={0}
              max={Math.max(1, c.loop - 1)}
              step={0.5}
              defaultValue={0}
              size={42}
              color="#22c55e"
              onChange={(v) => up({ off: v }, 'off')}
              fmt={(v) => `${v.toFixed(1)}`}
            />
          </div>
        </Section>
        <Section title="Position & Actions">
          <div className="space-y-1.5">
            <Slider
              label="Start (bars)"
              value={c.start}
              min={0}
              max={tb}
              step={1}
              onChange={(v) => up({ start: v }, 'start')}
              fmt={(v) => `Bar ${v + 1}`}
            />
            <Slider
              label="Length (bars)"
              value={c.len}
              min={0.25}
              max={Math.max(8, tb)}
              step={0.25}
              onChange={(v) => up({ len: v }, 'len')}
              fmt={(v) => `${v} bars`}
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            <Btn small active={c.mute} onClick={() => up({ mute: !c.mute }, 'mute')}>
              Mute clip
            </Btn>
            <Btn small onClick={splitSelectedAtPlayhead} title="Ctrl/Cmd+E">
              Split @ playhead
            </Btn>
            <Btn
              small
              onClick={() => store.dispatch({ type: 'DUP_CLIP', copyId: uid('clip'), id: c.id }, 'Duplicate clip')}
              title="Ctrl/Cmd+D"
            >
              Duplicate
            </Btn>
            <Btn
              small
              tone="cyan"
              onClick={() => {
                const blob = exportClipToMidi(p, t, c);
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${p.name.replace(/[^\w.-]+/g, '_')}_${t.name.replace(/[^\w.-]+/g, '_')}_${c.label.replace(/[^\w.-]+/g, '_')}.mid`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              title="Export this clip as a .mid file"
            >
              Export MIDI
            </Btn>
            <Btn
              small
              tone="red"
              onClick={() => {
                store.dispatch({ type: 'DEL_CLIP', id: c.id }, 'Delete clip');
                store.select({ kind: 'track', id: t.id });
              }}
              title="Delete"
            >
              Delete
            </Btn>
          </div>
          <div className="mt-2 text-[10px] text-slate-500">
            {c.notes.length} notes · open the Piano Roll tab to edit notes, 303 accents and slides.
          </div>
        </Section>
      </div>
    );
  }

  const s = p.sections.length;
  return (
    <div className="space-y-2 p-3 text-[11px] text-slate-400">
      <div className="text-[12px] font-semibold text-slate-200">Inspect · Device &amp; Channel Rack</div>
      <p>Select any element on the timeline or jump directly to a bus below:</p>
      <div className="rounded border border-line bg-panel p-2 font-mono text-[10px] tabular-nums">
        {p.name}
        <br />
        {s} sections · {totalBars(p)} bars · {p.tracks.length} tracks · {p.auto.length} automation lanes
      </div>
      <div className="flex flex-wrap gap-1">
        {(['bass', 'harm', 'fx'] as ScGroup[]).map((g) => (
          <Btn key={g} small tone="cyan" onClick={() => store.select({ kind: 'device', id: g })}>
            SC {g.toUpperCase()}
          </Btn>
        ))}
        <Btn small tone="amber" onClick={() => store.select({ kind: 'device', id: 'master' })}>
          Master Suite
        </Btn>
      </div>
      <div className="pt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Quick Track Jump</div>
      <div className="flex flex-wrap gap-1">
        {p.tracks.map((trk) => (
          <button
            key={trk.id}
            type="button"
            onClick={() => store.select({ kind: 'track', id: trk.id })}
            className="flex items-center gap-1 rounded border border-line bg-elev px-2 py-1 text-[10px] text-slate-300 hover:border-amber hover:text-white"
          >
            <span className="h-2 w-2 rounded-full" style={{ background: trk.color }} />
            <span>{trk.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
