import { useEffect, useMemo, useRef, useState } from 'react';
import { engine, store, useApp } from '../store';
import type { Note } from '../engine/types';
import { SCALES, euclid, Rng, KEY_NAMES } from '../engine/theory';
import { mutate } from '../engine/composer';
import { newClipAt } from '../actions';
import { Btn } from '../ui';
import { cn } from '../utils/cn';
import { exportClipToMidi } from '../engine/midiExport';
import { computeAnalyticalClipWaveform, renderOfflineClipWaveform } from '../engine/clipWaveform';
import { blendHexWithDarkBase, hexToRgba, TrackColorPickerTrigger } from './TrackColorDialog';

const GUT = 38, RH = 14, VEL_H = 54;
const SINGLE = ['kick', 'hat', 'ohat', 'ride', 'shaker', 'clap', 'snare', 'clang', 'crackle', 'riser', 'impact', 'downlift', 'crash'];
type Tool = 'draw' | 'accent' | 'slide' | 'erase';
type WaveOverlayMode = 'both' | 'grid' | 'notes';

export function PianoRoll() {
  const app = useApp();
  const sel = app.selection;
  const p = app.project;
  const found = useMemo(() => {
    if (sel.kind !== 'clip') return null;
    const t = p.tracks.find((x) => x.id === sel.track);
    const c = t?.clips.find((x) => x.id === sel.id);
    return t && c ? { t, c } : null;
  }, [sel, p.tracks]);

  const [zoom, setZoom] = useState(1.2);
  const [tool, setTool] = useState<Tool>('draw');
  const [snap, setSnap] = useState(1);
  const [draft, setDraft] = useState<Note[] | null>(null);
  const [eu, setEu] = useState({ k: 5, n: 16, rot: 0, pitch: 60 });
  const [showWaveform, setShowWaveform] = useState(true);
  const [waveMode, setWaveMode] = useState<WaveOverlayMode>('both');
  const [offlineWave, setOfflineWave] = useState<{ min: Float32Array; max: Float32Array; rms: Float32Array } | null>(null);
  const [liveBar, setLiveBar] = useState(() => app.cursorBar);
  const cv = useRef<HTMLCanvasElement>(null);
  const lastD = useRef(1);

  const notes = draft ?? found?.c.notes ?? [];
  const single = found ? SINGLE.includes(found.t.synth) : false;
  const range = useMemo(() => {
    if (!found || single) return { lo: 0, hi: 0 };
    let lo = 127, hi = 0;
    for (const n of found.c.notes) {
      lo = Math.min(lo, n.p);
      hi = Math.max(hi, n.p);
    }
    if (hi < lo) {
      lo = 48;
      hi = 72;
    }
    lo -= 4;
    hi += 4;
    while (hi - lo < 23) {
      lo--;
      hi++;
    }
    return { lo: Math.max(0, lo), hi: Math.min(127, hi) };
  }, [found, single]);

  const rows = single ? 1 : range.hi - range.lo + 1;
  const loop = found?.c.loop ?? 16;
  const SW = 22 * zoom;
  const W = GUT + Math.max(loop * SW, 360);
  const noteH = single ? 36 : rows * RH;
  const H = noteH + VEL_H + 4;
  const scale = new Set(SCALES[p.params.scale].map((x) => (x + p.params.key) % 12));

  // Subscribe to playhead for live visual alignment between synth output and MIDI clip
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

  // Immediate analytical synth waveform aligned to the active MIDI clip's notes & track DSP parameters
  const analyticalWave = useMemo(() => {
    if (!found || !showWaveform) return null;
    return computeAnalyticalClipWaveform(
      found.t,
      {
        loop: found.c.loop,
        notes,
        gain: found.c.gain,
        transpose: found.c.transpose,
      },
      p.params.bpm,
      16
    );
  }, [found, notes, p.params.bpm, showWaveform]);

  // Asynchronous Web Audio OfflineAudioContext refinement using the real playVoice synth engine
  useEffect(() => {
    if (!found || !showWaveform) {
      setOfflineWave(null);
      return;
    }
    let cancelled = false;
    renderOfflineClipWaveform(
      found.t,
      {
        loop: found.c.loop,
        notes: found.c.notes,
        gain: found.c.gain,
        transpose: found.c.transpose,
      },
      p.params.bpm,
      p.params.dirt,
      16
    ).then((res) => {
      if (!cancelled) setOfflineWave(res);
    });
    return () => {
      cancelled = true;
    };
  }, [
    found?.t.synth,
    found?.t.cutoff,
    found?.t.res,
    found?.t.vol,
    found?.c.id,
    found?.c.loop,
    found?.c.notes,
    found?.c.gain,
    found?.c.transpose,
    p.params.bpm,
    p.params.dirt,
    showWaveform,
  ]);

  useEffect(() => {
    const c = cv.current;
    if (!c || !found) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = W * dpr;
    c.height = H * dpr;
    c.style.width = W + 'px';
    c.style.height = H + 'px';
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const baseBg = blendHexWithDarkBase(found.t.color, '#0e1216', 0.14);
    const darkRowBg = blendHexWithDarkBase(found.t.color, '#0b0e12', 0.12);
    const lightRowBg = blendHexWithDarkBase(found.t.color, '#11161b', 0.16);
    g.fillStyle = baseBg;
    g.fillRect(0, 0, W, H);
    for (let r = 0; r < rows; r++) {
      const pitch = range.hi - r;
      const y = r * RH;
      if (!single) {
        const pc = pitch % 12;
        g.fillStyle = [1, 3, 6, 8, 10].includes(pc) ? darkRowBg : lightRowBg;
        g.fillRect(GUT, y, W - GUT, RH);
        if (scale.has(pc)) {
          g.fillStyle = hexToRgba(found.t.color, 0.08);
          g.fillRect(GUT, y, W - GUT, RH);
        }
        g.fillStyle = [1, 3, 6, 8, 10].includes(pc) ? '#1a2027' : '#cfd6de';
        g.fillRect(0, y, GUT - 2, RH - 1);
        if (pc === 0) {
          g.fillStyle = '#111';
          g.font = '8px monospace';
          g.fillText(`C${Math.floor(pitch / 12) - 1}`, 3, y + 10);
        }
      }
    }
    if (single) {
      g.fillStyle = lightRowBg;
      g.fillRect(GUT, 0, W - GUT, noteH);
      g.fillStyle = '#7b8794';
      g.font = '9px Inter, sans-serif';
      g.fillText('HIT', 6, 20);
    }
    const total = Math.ceil((W - GUT) / SW);
    for (let s = 0; s <= total; s++) {
      const x = GUT + s * SW;
      g.strokeStyle = s % 16 === 0 ? hexToRgba(found.t.color, 0.35) : s % 4 === 0 ? '#27303b' : '#181e25';
      g.beginPath();
      g.moveTo(x + 0.5, 0);
      g.lineTo(x + 0.5, H);
      g.stroke();
    }

    // ─── Visual Synth Audio Engine Waveform Overlay (Grid Backdrop & Composite Bus) ───
    if (showWaveform && analyticalWave && (waveMode === 'both' || waveMode === 'grid')) {
      const binsPerStep = analyticalWave.binsPerStep;
      const activeMin = !draft && offlineWave && offlineWave.min.length === analyticalWave.min.length ? offlineWave.min : analyticalWave.min;
      const activeMax = !draft && offlineWave && offlineWave.max.length === analyticalWave.max.length ? offlineWave.max : analyticalWave.max;
      const activeRms = !draft && offlineWave && offlineWave.rms.length === analyticalWave.rms.length ? offlineWave.rms : analyticalWave.rms;
      const totalBins = activeMax.length;
      const midY = noteH * 0.5;
      const ampScale = Math.max(14, noteH * 0.44);

      // Center zero-crossing reference line
      g.strokeStyle = 'rgba(6, 182, 212, 0.14)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(GUT, midY);
      g.lineTo(GUT + loop * SW, midY);
      g.stroke();

      // Peak envelope fill (min..max)
      g.fillStyle = found.t.color + '22';
      g.beginPath();
      for (let b = 0; b < totalBins; b++) {
        const x = GUT + (b / binsPerStep) * SW;
        const y = midY - activeMax[b] * ampScale;
        if (b === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      for (let b = totalBins - 1; b >= 0; b--) {
        const x = GUT + (b / binsPerStep) * SW;
        const y = midY - activeMin[b] * ampScale;
        g.lineTo(x, y);
      }
      g.closePath();
      g.fill();

      // RMS core energy contour
      g.strokeStyle = '#06b6d4';
      g.globalAlpha = 0.52;
      g.lineWidth = 1.25;
      g.beginPath();
      for (let b = 0; b < totalBins; b++) {
        const x = GUT + (b / binsPerStep) * SW;
        const oscSign = b % 2 === 0 ? 1 : -1;
        const y = midY - activeRms[b] * ampScale * 0.85 * oscSign;
        if (b === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
      g.globalAlpha = 1;
    }

    if (loop * SW + GUT < W) {
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.fillRect(GUT + loop * SW, 0, W, H);
    }
    g.fillStyle = '#12161b';
    g.fillRect(GUT, noteH, W, 4);
    notes.forEach((n) => {
      const x = GUT + (n.t + (n.micro ?? 0)) * SW;
      const y = single ? 4 : (range.hi - n.p) * RH;
      const h = single ? noteH - 8 : RH - 1;
      const w = Math.max(4, n.d * SW - 1);
      g.globalAlpha = 0.35 + n.v * 0.65;
      g.fillStyle = found.t.color;
      g.beginPath();
      g.roundRect(x, y, w, h, 2);
      g.fill();
      g.globalAlpha = 1;
      if (n.acc) {
        g.fillStyle = '#f59e0b';
        g.fillRect(x, y, w, 2.5);
        g.fillRect(x, y + h - 2.5, w, 2.5);
      }
      if (n.slide) {
        g.fillStyle = '#06b6d4';
        g.beginPath();
        g.moveTo(x, y + h);
        g.lineTo(x - 7, y + h);
        g.lineTo(x, y + 1);
        g.fill();
      }
      g.fillStyle = found.t.color;
      g.fillRect(x, noteH + 4 + VEL_H * (1 - n.v), Math.max(2, 3), VEL_H * n.v);
      g.fillStyle = '#fff';
      g.fillRect(x - 1, noteH + 4 + VEL_H * (1 - n.v) - 1, 5, 3);
    });

    // ─── Per-Note Aligned Synth Audio Waveform Overlay (Attack, Filter Env & Release Tail) ───
    if (showWaveform && analyticalWave && (waveMode === 'both' || waveMode === 'notes')) {
      const binsPerStep = analyticalWave.binsPerStep;
      for (const slice of analyticalWave.noteSlices) {
        const rowY = single ? noteH * 0.5 : (range.hi - slice.pitch) * RH + (RH - 1) * 0.5;
        const ampH = single ? (noteH - 10) * 0.46 : (RH - 1) * 0.72;
        g.strokeStyle = '#ffffff';
        g.globalAlpha = 0.78;
        g.lineWidth = 1.1;
        g.beginPath();
        for (let b = 0; b < slice.samples.length; b++) {
          const stepPos = slice.startStep + b / binsPerStep;
          if (stepPos > loop) break;
          const sx = GUT + stepPos * SW;
          const sy = rowY - slice.samples[b] * ampH;
          if (b === 0) g.moveTo(sx, sy);
          else g.lineTo(sx, sy);
        }
        g.stroke();
      }
      g.globalAlpha = 1;
    }

    // ─── Live Playhead Alignment Marker ───
    if (engine.playing || liveBar > 0) {
      const clipEnd = found.c.start + found.c.len;
      const inClip = liveBar >= found.c.start && liveBar <= clipEnd;
      const relSteps = ((liveBar - found.c.start) * 16 + found.c.off) % Math.max(1, loop);
      const normSteps = ((relSteps % loop) + loop) % loop;
      const px = GUT + normSteps * SW;
      g.strokeStyle = inClip ? '#f59e0b' : 'rgba(245, 158, 11, 0.35)';
      g.lineWidth = inClip ? 1.8 : 1;
      g.beginPath();
      g.moveTo(px, 0);
      g.lineTo(px, H);
      g.stroke();
    }

    g.fillStyle = '#7b8794';
    g.font = '8px monospace';
    g.fillText('VEL', 6, noteH + 16);
  }, [found, notes, W, H, rows, range, SW, single, loop, noteH, scale, showWaveform, waveMode, analyticalWave, offlineWave, draft, liveBar]);

  // Interactive Clip Selector when no clip is currently selected
  if (!found) {
    const tracksWithClips = p.tracks.filter((t) => t.clips.length > 0);
    return (
      <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-[#0e1216] p-3">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <div className="text-[12px] font-semibold text-slate-200">Piano Roll · Select or Create a MIDI Clip</div>
            <div className="text-[10px] text-slate-500">
              Tap any clip below or on the arrangement timeline to edit notes, velocities, 303 accents, slides, and Euclidean patterns.
            </div>
          </div>
          {tracksWithClips[0]?.clips[0] && (
            <Btn
              small
              tone="amber"
              onClick={() =>
                store.select({ kind: 'clip', id: tracksWithClips[0].clips[0].id, track: tracksWithClips[0].id })
              }
            >
              Open First Clip ›
            </Btn>
          )}
        </div>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 md:grid-cols-3">
          {p.tracks.map((trk) => (
            <div key={trk.id} className="flex items-center justify-between gap-2 rounded border border-line bg-panel px-2.5 py-1.5">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="h-3 w-1.5 shrink-0 rounded-sm" style={{ background: trk.color }} />
                <span className="truncate text-[11px] font-medium text-slate-200">{trk.name}</span>
                <span className="font-mono text-[9px] text-slate-400">
                  {trk.clips.length} {trk.clips.length === 1 ? 'clip' : 'clips'}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <TrackColorPickerTrigger track={trk} label="Color" compact />
                {trk.clips[0] && (
                  <Btn
                    small
                    tone="cyan"
                    title={`Open ${trk.clips[0].label} in Piano Roll (${trk.clips[0].notes.length} MIDI notes)`}
                    onClick={() => store.select({ kind: 'clip', id: trk.clips[0].id, track: trk.id })}
                  >
                    Open Clip ({trk.clips[0].notes.length} notes)
                  </Btn>
                )}
                <Btn
                  small
                  disabled={trk.lock}
                  title="Create a new empty MIDI clip at the playhead bar"
                  onClick={() => newClipAt(trk.id, Math.floor(store.get().cursorBar))}
                >
                  + New Clip
                </Btn>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const { t, c } = found;

  const commit = (ns: Note[], label: string, key?: string) => {
    setDraft(null);
    store.dispatch({ type: 'SET_NOTES', clip: c.id, notes: [...ns].sort((a, b) => a.t - b.t) }, label, 'user', key);
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = cv.current!.getBoundingClientRect();
    const x = e.clientX - r.left - GUT;
    const y = e.clientY - r.top;
    if (x < 0) return;
    const step = x / SW;
    const ns = notes.map((n) => ({ ...n }));
    if (y > noteH + 4) {
      // velocity lane
      let best = -1, bd = 1e9;
      ns.forEach((n, i) => {
        const d = Math.abs(n.t * SW + 2 - x);
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      if (best < 0 || bd > 14) return;
      const set = (cy: number) => {
        ns[best].v = Math.min(1, Math.max(0.05, 1 - (cy - r.top - noteH - 4) / VEL_H));
        setDraft(ns.map((n) => ({ ...n })));
      };
      set(e.clientY);
      const mv = (ev: PointerEvent) => set(ev.clientY);
      const up = () => {
        window.removeEventListener('pointermove', mv);
        window.removeEventListener('pointerup', up);
        commit(ns, 'Edit velocity', `vel:${c.id}`);
      };
      window.addEventListener('pointermove', mv);
      window.addEventListener('pointerup', up);
      return;
    }
    const pitch = single ? 60 : range.hi - Math.floor(y / RH);
    const hit = ns.findIndex((n) => step >= n.t - 0.05 && step <= n.t + Math.max(n.d, 0.5) && (single || n.p === pitch));
    if (hit >= 0) {
      if (tool === 'erase' || e.altKey || e.button === 2) {
        ns.splice(hit, 1);
        commit(ns, 'Delete note');
        return;
      }
      if (tool === 'accent') {
        ns[hit].acc = !ns[hit].acc;
        if (ns[hit].acc) ns[hit].v = 1;
        commit(ns, 'Toggle accent');
        return;
      }
      if (tool === 'slide') {
        ns[hit].slide = !ns[hit].slide;
        commit(ns, 'Toggle slide');
        return;
      }
      const n = ns[hit];
      const edge = step >= n.t + n.d - Math.min(0.5, n.d / 2);
      const o = { t: n.t, d: n.d, p: n.p };
      const sx = e.clientX, sy = e.clientY;
      const mv = (ev: PointerEvent) => {
        const ds = Math.round((ev.clientX - sx) / SW / snap) * snap;
        const dp = single ? 0 : -Math.round((ev.clientY - sy) / RH);
        if (edge) n.d = Math.max(snap, o.d + ds);
        else {
          n.t = Math.min(loop - snap, Math.max(0, o.t + ds));
          n.p = Math.min(127, Math.max(0, o.p + dp));
        }
        setDraft(ns.map((q) => ({ ...q })));
      };
      const up = () => {
        window.removeEventListener('pointermove', mv);
        window.removeEventListener('pointerup', up);
        commit(ns, edge ? 'Resize note' : 'Move note', `note:${c.id}`);
      };
      window.addEventListener('pointermove', mv);
      window.addEventListener('pointerup', up);
      return;
    }
    if (tool !== 'draw') return;
    const ts = Math.min(loop - snap, Math.max(0, Math.floor(step / snap) * snap));
    ns.push({
      t: ts,
      d: lastD.current,
      p: single ? (t.synth === 'kick' ? 36 : t.synth === 'crash' ? 0 : 60) : pitch,
      v: 0.8,
    });
    commit(ns, 'Add note');
  };

  const applyEu = () => {
    const pat = euclid(eu.k, eu.n, eu.rot);
    const ns: Note[] = [];
    pat.forEach((h, i) => {
      if (h) ns.push({ t: i, d: 0.8, p: eu.pitch, v: 0.8 });
    });
    store.dispatch(
      {
        type: 'BATCH',
        cmds: [
          { type: 'SET_CLIP', id: c.id, patch: { loop: eu.n, off: 0 } },
          { type: 'SET_NOTES', clip: c.id, notes: ns },
        ],
      },
      `Euclidean E(${eu.k},${eu.n})`
    );
  };
  const num = (v: number, set: (n: number) => void, min: number, max: number, w = 'w-12') => (
    <input
      type="number"
      value={v}
      min={min}
      max={max}
      onChange={(e) => set(Math.min(max, Math.max(min, +e.target.value || 0)))}
      className={cn('h-6 rounded border border-line bg-elev px-1 text-center font-mono text-[11px] tabular-nums', w)}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line px-2 py-1">
        <span className="mr-0.5 flex items-center gap-1 text-[11px] font-semibold">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: t.color }} />
          {t.name}
        </span>
        {/* Track & Clip Color Picker Dialog Trigger */}
        <TrackColorPickerTrigger track={t} label="🎨 Track Color" compact />
        {/* Clip Switcher for current track */}
        <select
          aria-label="Select clip on track"
          value={c.id}
          onChange={(e) => store.select({ kind: 'clip', id: e.target.value, track: t.id })}
          className="h-6 max-w-[150px] text-[10px]"
        >
          {t.clips.map((cl) => (
            <option key={cl.id} value={cl.id}>
              {cl.label} (bar {cl.start + 1})
            </option>
          ))}
        </select>

        {(['draw', 'accent', 'slide', 'erase'] as Tool[]).map((k) => (
          <Btn key={k} small active={tool === k} onClick={() => setTool(k)} title={`${k} tool`}>
            {k === 'draw' ? '✏ Draw Note' : k === 'accent' ? '⚡ Accent (+dB)' : k === 'slide' ? '⌇ Slide (Glide)' : '⌫ Erase Note'}
          </Btn>
        ))}
        <select aria-label="Snap resolution" value={snap} onChange={(e) => setSnap(+e.target.value)} className="h-6 text-[10px]">
          <option value={1}>Snap: 1/16 Step</option>
          <option value={0.5}>Snap: 1/32 Step</option>
          <option value={0.25}>Snap: 1/64 Step</option>
          <option value={2}>Snap: 1/8 Step</option>
          <option value={4}>Snap: 1/4 Beat</option>
        </select>
        <select
          aria-label="Default Note Length"
          onChange={(e) => (lastD.current = +e.target.value)}
          defaultValue="1"
          className="h-6 text-[10px]"
        >
          <option value="0.5">Note Len: ½ Step</option>
          <option value="1">Note Len: 1 Step</option>
          <option value="2">Note Len: 2 Steps</option>
          <option value="4">Note Len: 1 Bar</option>
          <option value="8">Note Len: 2 Bars</option>
        </select>

        {/* Piano Roll Zoom with - / + buttons */}
        <div className="flex items-center gap-1 rounded border border-line bg-[#0e1216] px-1 py-0.5" title="Piano Roll horizontal zoom">
          <button
            type="button"
            aria-label="Zoom out piano roll"
            onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}
            className="flex h-4 w-4 items-center justify-center rounded bg-elev text-[11px] font-bold text-slate-300 hover:text-amber"
          >
            −
          </button>
          <input
            aria-label="Piano roll zoom"
            type="range"
            className="!w-14"
            min={0.5}
            max={3.5}
            step={0.1}
            value={zoom}
            onChange={(e) => setZoom(+e.target.value)}
          />
          <button
            type="button"
            aria-label="Zoom in piano roll"
            onClick={() => setZoom((z) => Math.min(3.5, +(z + 0.25).toFixed(2)))}
            className="flex h-4 w-4 items-center justify-center rounded bg-elev text-[11px] font-bold text-slate-300 hover:text-amber"
          >
            +
          </button>
        </div>

        <span
          className="flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[10px] text-slate-400"
          title="Independent loop length in 16th-steps (polymetric)"
        >
          Loop{' '}
          {num(
            c.loop,
            (n) => store.dispatch({ type: 'SET_CLIP', id: c.id, patch: { loop: n } }, 'Clip loop length', 'user', `loop:${c.id}`),
            1,
            128
          )}{' '}
          steps
        </span>
        <span className="flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[10px] text-slate-400" title="Euclidean rhythm generator: distribute Hits evenly across Steps with step Offset">
          Euclidean: Hits{num(eu.k, (k) => setEu({ ...eu, k }), 1, 32, 'w-10')} Steps{num(eu.n, (n) => setEu({ ...eu, n }), 2, 64, 'w-10')}{' '}
          Offset{num(eu.rot, (rot) => setEu({ ...eu, rot }), 0, 63, 'w-10')}{' '}
          {!single && <>Pitch{num(eu.pitch, (pitch) => setEu({ ...eu, pitch }), 0, 127, 'w-11')}</>}
          <Btn small tone="amber" onClick={applyEu} title="Generate Euclidean pattern into active clip">
            Generate
          </Btn>
        </span>
        <Btn small onClick={() => commit(notes.map((n) => ({ ...n, t: Math.round(n.t), micro: 0 })), 'Quantize')} title="Snap note start times to exact 16th-note grid">
          Quantize Grid
        </Btn>
        <Btn
          small
          title="Add subtle analog micro-timing and velocity variations"
          onClick={() => {
            const r = new Rng(Date.now());
            commit(
              notes.map((n) => ({
                ...n,
                micro: +r.range(-0.1, 0.1).toFixed(3),
                v: Math.min(1, Math.max(0.1, n.v + r.range(-0.12, 0.08))),
              })),
              'Humanize'
            );
          }}
        >
          Humanize Timing
        </Btn>
        <Btn
          small
          title="Generate algorithmic variations (octave shifts, rests, accents)"
          onClick={() =>
            commit(
              mutate(notes, c.loop, new Rng(Date.now()).pick(['oct', 'rot', 'acc', 'rest'] as const), new Rng(Date.now() + 1)),
              'Mutate clip'
            )
          }
        >
          Evolve Notes (Mutate)
        </Btn>
        <Btn
          small
          tone="cyan"
          title="Export this clip as a standard .mid file"
          onClick={() => {
            const blob = exportClipToMidi(p, t, c);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${p.name.replace(/[^\w.-]+/g, '_')}_${t.name.replace(/[^\w.-]+/g, '_')}_${c.label.replace(/[^\w.-]+/g, '_')}.mid`;
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Export Clip MIDI
        </Btn>
        <Btn small tone="ghost" onClick={() => commit([], 'Clear notes')} title="Delete all notes in active clip">
          Delete All Notes
        </Btn>
        {/* Visual Synth Audio Waveform Display Overlay Controls */}
        <Btn
          small
          tone="cyan"
          active={showWaveform}
          onClick={() => setShowWaveform((v) => !v)}
          title="Toggle visual synth audio engine waveform overlay aligned to active MIDI clip notes"
        >
          〰 Waveform Overlay
        </Btn>
        {showWaveform && (
          <select
            aria-label="Waveform overlay mode"
            value={waveMode}
            onChange={(e) => setWaveMode(e.target.value as WaveOverlayMode)}
            className="h-6 text-[10px]"
            title="Select how the synth audio engine waveform is overlaid on the Piano Roll"
          >
            <option value="both">Wave: Note + Bus Scope</option>
            <option value="notes">Wave: Pitch-Aligned Notes</option>
            <option value="grid">Wave: Composite Synth Bus</option>
          </select>
        )}
        <span className="ml-auto font-mono text-[10px] tabular-nums text-slate-500">
          {notes.length} notes · {KEY_NAMES[p.params.key]} {p.params.scale}
        </span>
      </div>
      <div
        className="min-h-0 flex-1 overflow-auto transition-colors"
        style={{ background: blendHexWithDarkBase(t.color, '#0e1216', 0.14) }}
      >
        <canvas
          ref={cv}
          onPointerDown={onDown}
          onContextMenu={(e) => e.preventDefault()}
          className="block"
          style={{ touchAction: 'pan-x pan-y' }}
        />
      </div>
      <div className="shrink-0 border-t border-line px-2 py-0.5 text-[10px] text-slate-500">
        Accent = amber caps (boosts filter env + level) · Slide = cyan wedge (glide <b>into</b> note) ·{' '}
        <span className="text-cyan-300">〰 Synth Waveform Overlay</span> shows real-time synth engine envelope & release tail alignment
      </div>
    </div>
  );
}
