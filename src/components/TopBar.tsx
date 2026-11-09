import { useEffect, useRef, useState } from 'react';
import { engine, store, useApp } from '../store';
import { KEY_NAMES, SCALE_NAMES } from '../engine/theory';
import { Btn, Badge } from '../ui';
import { ProjectFiles } from './ProjectFiles';
import { seek, toggleLoop } from '../actions';
import { cn } from '../utils/cn';
import { STYLES } from '../engine/styles';
import { InstallPrompt } from './InstallPrompt';
import { settingsStore, useSettings } from '../engine/settings';
import { SettingsModal } from './SettingsModal';

const SRC_COLOR = { user: '#94a3b8', ai: '#06b6d4', composer: '#f59e0b' } as const;

export function TopBar({ onExport, compact }: { onExport: () => void; compact: boolean }) {
  const app = useApp();
  const p = app.project;
  const settings = useSettings();
  const [hist, setHist] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const pos = useRef<HTMLSpanElement>(null);
  const stat = useRef<HTMLSpanElement>(null);
  const peak = useRef<HTMLDivElement>(null);
  const pk = useRef<HTMLSpanElement>(null);
  const buf = useRef(new Float32Array(1024));
  const hold = useRef(0);
  const tapTimes = useRef<number[]>([]);

  const handleTapTempo = () => {
    const now = Date.now();
    const taps = tapTimes.current.filter((t) => now - t < 3000);
    taps.push(now);
    tapTimes.current = taps;
    if (taps.length >= 2) {
      const intervals: number[] = [];
      for (let i = 1; i < taps.length; i++) {
        intervals.push(taps[i] - taps[i - 1]);
      }
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const bpm = Math.min(180, Math.max(80, Math.round(60000 / avg)));
      store.dispatch({ type: 'SET_PARAMS', patch: { bpm } }, 'Tempo (Tap)', 'user', 'bpm');
    }
  };

  useEffect(() => {
    let raf = 0;
    const f = () => {
      const st = engine.playing ? engine.getStep() : -1;
      const bar = st >= 0 ? st / 16 : store.get().cursorBar;
      if (pos.current) {
        pos.current.textContent = `${String(Math.floor(bar) + 1).padStart(3, '0')}.${Math.floor((bar % 1) * 4) + 1}.${Math.floor(((bar * 4) % 1) * 4) + 1}`;
      }
      const a = engine.graph?.analyser;
      let m = 0;
      if (a) {
        a.getFloatTimeDomainData(buf.current);
        for (let i = 0; i < 1024; i++) m = Math.max(m, Math.abs(buf.current[i]));
      }
      hold.current = Math.max(m, hold.current * 0.92);
      const db = 20 * Math.log10(hold.current + 1e-6);
      if (peak.current) peak.current.style.width = `${Math.max(0, Math.min(100, ((db + 48) / 48) * 100))}%`;
      if (pk.current) pk.current.textContent = hold.current > 0.001 ? db.toFixed(1) : '-∞';
      if (stat.current) {
        const sr = engine.ctx ? `${(engine.ctx.sampleRate / 1000).toFixed(1)}k` : '44.1k';
        const vText = engine.voices === 1 ? '1 Voice' : `${engine.voices} Voices`;
        const lat = `${(engine.latency * 1000).toFixed(0)}ms lat`;
        stat.current.textContent = `${engine.state === 'running' ? 'Active' : 'Ready'} · ${sr} · ${vText} · ${lat}`;
      }
      raf = requestAnimationFrame(f);
    };
    f();
    return () => cancelAnimationFrame(raf);
  }, []);

  const canUndo = app.cursor > 0;
  const canRedo = app.cursor < app.entries.length;

  const [aboutOpen, setAboutOpen] = useState(false);

  return (
    <>
      <header className="relative z-50 flex h-11 shrink-0 items-center gap-1.5 border-b border-line bg-panel px-2 select-none">
        <ProjectFiles compact={compact} onOpenSettings={() => setSettingsOpen(true)} />
        <div
          className={cn('items-center gap-2 pr-1 cursor-pointer group', compact ? 'hidden sm:flex' : 'flex')}
          onClick={() => setAboutOpen(true)}
          title="About AIDAW · Dark Minimalist Geometric Identity & Engine Specs"
        >
          <div className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#090b10] p-0.5 shadow-[0_0_12px_rgba(245,158,11,0.38)] ring-1 ring-amber/50 transition-all group-hover:scale-105 group-hover:shadow-[0_0_16px_rgba(6,182,212,0.55)]">
            <img
              src="/src/assets/images/aidaw_minimal_geometric_logo_1794230991499.jpg"
              alt="AIDAW Dark Minimalist Geometric Logo"
              referrerPolicy="no-referrer"
              className="h-full w-full rounded-[6px] object-cover"
            />
          </div>
          {!compact && (
            <div className="leading-tight">
              <div className="flex items-center gap-0.5 text-[11px] font-black tracking-widest text-slate-100 group-hover:text-amber transition-colors">
                <span>AI</span>
                <span className="text-amber">D</span>
                <span className="text-cyan">AW</span>
              </div>
              <div className="max-w-[120px] truncate text-[8.5px] font-medium text-slate-400" title={p.name}>
                {p.name}
              </div>
            </div>
          )}
        </div>

        {/* Transport controls */}
        <div className="flex items-center rounded border border-line bg-[#0e1216] p-0.5" title="Playback Transport">
          <Btn
            tone={app.playing ? 'amber' : 'default'}
            className="!h-7 px-2.5 text-[11px] font-bold"
            title="Play / Stop (Space)"
            onClick={() => store.toggle()}
          >
            {app.playing ? '■ STOP' : '▶ PLAY'}
          </Btn>
          <button
            type="button"
            aria-label="Return to start (Bar 1)"
            className="flex h-7 w-7 items-center justify-center rounded text-[11px] text-slate-400 hover:bg-elev hover:text-white transition-colors"
            title="Return to start (Bar 1)"
            onClick={() => seek(0)}
          >
            ⏮
          </button>
          <button
            type="button"
            aria-label="Toggle loop mode"
            aria-pressed={p.loop.on}
            className={cn(
              'flex h-7 px-1.5 items-center justify-center rounded text-[10px] font-semibold transition-colors gap-1',
              p.loop.on ? 'bg-amber/20 text-amber font-bold' : 'text-slate-400 hover:bg-elev hover:text-white'
            )}
            title={p.loop.on ? `Loop: Active (Bar ${p.loop.a + 1}–${p.loop.b})` : 'Loop: Off'}
            onClick={toggleLoop}
          >
            <span>⟳</span>
            <span className="hidden sm:inline">Loop</span>
          </button>
          <button
            type="button"
            aria-label="Metronome click toggle"
            aria-pressed={settings.metronome}
            onClick={() => settingsStore.set({ metronome: !settings.metronome })}
            className={cn(
              'flex h-7 px-1.5 items-center justify-center rounded text-[10px] font-semibold transition-colors gap-1',
              settings.metronome ? 'bg-amber/25 text-amber font-bold' : 'text-slate-400 hover:bg-elev hover:text-slate-200'
            )}
            title={settings.metronome ? 'Metronome beat click: Enabled' : 'Metronome beat click: Disabled'}
          >
            <span>🔔</span>
            <span className="hidden md:inline">Click</span>
          </button>
        </div>

        {/* Position Display */}
        <div
          className="flex flex-col justify-center rounded border border-line bg-[#0b0e12] px-2 py-0.5 leading-tight"
          title="Current Song Playhead Position (Bar.Beat.16th)"
        >
          <span className="text-[7.5px] font-semibold uppercase tracking-wider text-slate-400">Position</span>
          <span ref={pos} className="font-mono text-[13px] font-bold tabular-nums text-amber">
            001.1.1
          </span>
        </div>

        {/* Tempo (BPM) Control & Tap Tempo */}
        <div
          className="flex items-center gap-1 rounded border border-line bg-[#0b0e12] px-2 py-0.5 leading-tight"
          title="Project Tempo & Tap Tempo"
        >
          <div className="flex flex-col justify-center">
            <span className="text-[7.5px] font-semibold uppercase tracking-wider text-slate-400">Tempo</span>
            <div className="flex items-center gap-0.5">
              <input
                aria-label="BPM"
                type="number"
                min={80}
                max={180}
                value={p.params.bpm}
                onChange={(e) =>
                  store.dispatch(
                    { type: 'SET_PARAMS', patch: { bpm: Math.min(180, Math.max(80, +e.target.value || 120)) } },
                    'Tempo',
                    'user',
                    'bpm'
                  )
                }
                className="w-8 bg-transparent font-mono text-[13px] font-bold tabular-nums text-slate-100 outline-none"
              />
              <span className="font-mono text-[9px] font-medium text-slate-500">BPM</span>
            </div>
          </div>
          <button
            type="button"
            onClick={handleTapTempo}
            className="h-6 rounded bg-elev px-1.5 font-mono text-[9px] font-bold text-slate-300 hover:bg-[#232b35] hover:text-amber transition-colors"
            title="Tap repeatedly to set project tempo BPM"
          >
            Tap
          </button>
        </div>

        {!compact && (
          <>
            <div
              className="hidden flex-col justify-center rounded border border-line bg-[#0b0e12] px-2 py-0.5 leading-tight lg:flex"
              title="Musical Root Key and Scale"
            >
              <span className="text-[7.5px] font-semibold uppercase tracking-wider text-slate-400">Key &amp; Scale</span>
              <span className="text-[11px] font-semibold text-slate-200">
                {KEY_NAMES[p.params.key]} {SCALE_NAMES[p.params.scale]}
              </span>
            </div>
            <div
              className="hidden flex-col justify-center rounded border border-line bg-[#0b0e12] px-2 py-0.5 leading-tight xl:flex"
              title="Techno Subgenre Style Grammar"
            >
              <span className="text-[7.5px] font-semibold uppercase tracking-wider text-slate-400">Subgenre</span>
              <span className="text-[11px] font-semibold text-amber">{STYLES[p.params.style]?.name ?? p.params.style}</span>
            </div>
          </>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {!compact && (
            <div
              className="hidden min-w-[170px] flex-col justify-center rounded border border-line bg-[#0b0e12] px-2 py-0.5 leading-tight md:flex"
              title="Real-time Web Audio graph status, active voices, and output latency"
            >
              <div className="flex justify-between items-center text-[7.5px] font-semibold uppercase tracking-wider text-slate-400">
                <span>Audio Engine</span>
                <span className="font-mono text-cyan text-[8px] font-bold">
                  {engine.workletOk ? 'Sidechain Active' : engine.ctx ? 'Sidechain Ready' : 'Idle'}
                </span>
              </div>
              <span ref={stat} className="block whitespace-nowrap font-mono text-[9.5px] tabular-nums text-slate-300">
                Ready · 44.1k · 0 Voices · 0ms lat
              </span>
            </div>
          )}
          <div
            className="hidden w-24 flex-col justify-center rounded border border-line bg-[#0b0e12] px-2 py-0.5 leading-tight sm:flex"
            title="Master output level (dBFS)"
          >
            <div className="flex items-center justify-between text-[7.5px] font-semibold uppercase tracking-wider text-slate-400">
              <span>Master</span>
              <span ref={pk} className="font-mono text-[9px] tabular-nums text-slate-300">
                -∞ dB
              </span>
            </div>
            <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-[#161c24]">
              <div
                ref={peak}
                className="h-full rounded-full transition-all duration-75"
                style={{ width: 0, background: 'linear-gradient(to right,#22c55e 65%,#f59e0b 88%,#ef4444)' }}
              />
            </div>
          </div>
          <Btn
            disabled={!canUndo}
            className="!h-7 px-2"
            title="Undo last action (Ctrl+Z)"
            onClick={() => store.undo()}
          >
            <span className="text-[11px]">↶</span>
            <span className="hidden md:inline text-[10px]">Undo</span>
          </Btn>
          <Btn
            disabled={!canRedo}
            className="!h-7 px-2"
            title="Redo action (Ctrl+Shift+Z / Ctrl+Y)"
            onClick={() => store.redo()}
          >
            <span className="text-[11px]">↷</span>
            <span className="hidden md:inline text-[10px]">Redo</span>
          </Btn>
          {!compact && (
            <div className="relative">
              <Btn active={hist} className="!h-7 px-2 text-[10px]" title="Undo history" onClick={() => setHist(!hist)}>
                History{app.entries.length ? ` ${app.cursor}/${app.entries.length}` : ''}
              </Btn>
              {hist && (
                <div className="absolute right-0 top-9 z-50 max-h-80 w-72 overflow-y-auto rounded-md border border-line bg-panel p-1 shadow-2xl">
                  <button
                    onClick={() => {
                      store.jump(0);
                      setHist(false);
                    }}
                    className={cn(
                      'flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[11px] hover:bg-elev',
                      app.cursor === 0 && 'bg-elev'
                    )}
                    disabled={!app.entries.length}
                  >
                    <span className="text-slate-500">○</span> Initial state
                  </button>
                  {app.entries.map((e, i) => (
                    <button
                      key={e.id}
                      onClick={() => {
                        store.jump(i + 1);
                        setHist(false);
                      }}
                      className={cn(
                        'flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[11px] hover:bg-elev',
                        app.cursor === i + 1 && 'bg-elev ring-1 ring-amber',
                        i >= app.cursor && 'opacity-40'
                      )}
                    >
                      <Badge color={SRC_COLOR[e.source]}>
                        {e.source === 'ai' ? 'AI' : e.source === 'composer' ? 'COMP' : 'USER'}
                      </Badge>
                      <span className="min-w-0 flex-1 truncate">{e.label}</span>
                    </button>
                  ))}
                  {!app.entries.length && <div className="p-2 text-[11px] text-slate-500">No edits yet.</div>}
                </div>
              )}
            </div>
          )}
          <Btn
            className="!h-7 px-2 text-[10px]"
            title="Open AIDAW Settings &amp; Preferences (⚙)"
            onClick={() => setSettingsOpen(true)}
          >
            ⚙ Settings
          </Btn>
          <InstallPrompt />
          <Btn tone="amber" className="!h-7 px-3 text-[11px] font-bold shadow-[0_0_10px_rgba(245,158,11,0.25)]" title="Export WAV / MIDI / ALS" onClick={onExport}>
            Export
          </Btn>
        </div>
      </header>
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      {aboutOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-xl border border-line bg-panel p-5 shadow-2xl">
            <div className="flex items-start justify-between border-b border-line pb-3">
              <div className="flex items-center gap-3">
                <img
                  src="/src/assets/images/aidaw_minimal_geometric_logo_1794230991499.jpg"
                  alt="AIDAW Dark Minimalist Geometric App Icon"
                  referrerPolicy="no-referrer"
                  className="h-14 w-14 rounded-2xl object-cover shadow-[0_0_22px_rgba(245,158,11,0.45)] ring-2 ring-amber/60"
                />
                <div>
                  <h2 className="text-base font-black tracking-widest text-slate-100">
                    AI<span className="text-amber">D</span><span className="text-cyan">AW</span>
                  </h2>
                  <p className="text-[11px] font-medium text-amber">AI-Native Underground Techno DAW</p>
                  <p className="text-[9.5px] text-slate-400">Dark Minimalist Geometric Edition · PWA &amp; Android Ready</p>
                </div>
              </div>
              <button
                onClick={() => setAboutOpen(false)}
                className="rounded p-1 text-slate-400 hover:bg-elev hover:text-white transition-colors text-xs"
              >
                ✕
              </button>
            </div>
            <div className="mt-4 space-y-3 text-xs leading-relaxed text-slate-300">
              <div className="rounded-lg border border-line bg-elev/50 p-3">
                <div className="text-[10.5px] font-semibold uppercase tracking-wider text-cyan mb-1">
                  Sonic Monolith Identity &amp; Synthesis Architecture
                </div>
                <ul className="list-disc list-inside space-y-1 text-[11px] text-slate-400">
                  <li>Crystalline Sonic Monolith &amp; Acoustic Prism &ldquo;A&rdquo; Brand Emblem</li>
                  <li>Distinct TB-303 Acid, Warehouse Formant Chord Stab &amp; Buchla FM Pluck</li>
                  <li>Dark Underground, Horror Vault &amp; Cinematic Dark Modes for All Styles</li>
                  <li>Ableton Live Set (<code>.als</code>) GZIP/XML Project Import &amp; Export</li>
                </ul>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <div className="rounded border border-line bg-elev p-2">
                  <span className="block font-semibold text-slate-200">Transition FX Suite</span>
                  <span className="text-slate-400">Turbine Riser, Seismic Sub Impact, Metallic Crash, Brass Downlift</span>
                </div>
                <div className="rounded border border-line bg-elev p-2">
                  <span className="block font-semibold text-slate-200">Realtime Audio Engine</span>
                  <span className="text-slate-400">Click-Free ADSR, Zero-Oversample DSP &amp; Sidechain Worklet</span>
                </div>
              </div>
            </div>
            <div className="mt-5 flex justify-end">
              <Btn tone="amber" className="px-4" onClick={() => setAboutOpen(false)}>
                Close
              </Btn>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
