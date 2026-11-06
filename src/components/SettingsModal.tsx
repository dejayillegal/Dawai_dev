import { useState } from 'react';
import { useSettings, settingsStore, type ThemePreset, type LatencyTarget } from '../engine/settings';
import { engine, store, useApp } from '../store';
import { KEY_NAMES, SCALE_NAMES } from '../engine/theory';
import { STYLES } from '../engine/styles';
import { Btn, Slider } from '../ui';
import { cn } from '../utils/cn';
import { newProject, defaultParams } from '../engine/composer';

type SettingsTab = 'audio' | 'ui' | 'project' | 'shortcuts';

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const settings = useSettings();
  const [tab, setTab] = useState<SettingsTab>('audio');
  const [newSubgenre, setNewSubgenre] = useState<string>(app.project.params.style);

  const resetAll = () => {
    if (confirm('Reset all application preferences to defaults?')) {
      settingsStore.reset();
    }
  };

  const startNewSubgenreProject = () => {
    store.replaceProject(newProject(defaultParams(newSubgenre as any, Math.floor(Math.random() * 999999))));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="AIDAW Settings & Preferences"
        className="flex h-[88vh] max-h-[640px] w-full max-w-2xl flex-col rounded-lg border border-line bg-panel shadow-2xl overflow-hidden"
      >
        {/* Modal Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-line bg-[#161c24] px-4 py-2.5">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-amber font-black text-black text-[11px]">
              ⚙
            </div>
            <div>
              <h2 className="text-[13px] font-bold text-slate-100 leading-none">AIDAW Settings &amp; Preferences</h2>
              <p className="text-[9.5px] text-slate-400 mt-0.5">
                Pro-Audio DSP Engine · UI Preferences · Project Defaults · Keyboard Shortcuts
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close settings"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-elev hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Tab Navigation Bar */}
        <div className="flex shrink-0 border-b border-line bg-[#0e1216] px-2 py-1 gap-1 overflow-x-auto">
          {(
            [
              ['audio', '🔊 Audio Engine & DSP'],
              ['ui', '🎨 UI & Viewport'],
              ['project', '🎵 Project & Styles'],
              ['shortcuts', '⌨ Keyboard Shortcuts'],
            ] as [SettingsTab, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={cn(
                'px-3 py-1.5 rounded text-[11px] font-semibold transition-colors whitespace-nowrap',
                tab === k ? 'bg-amber text-black' : 'text-slate-400 hover:bg-elev hover:text-slate-200'
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Tab Content Body */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4 text-[11px] text-slate-300">
          {tab === 'audio' && (
            <div className="space-y-4">
              {/* Realtime Engine Telemetry Box */}
              <div className="rounded-md border border-line bg-[#0b0e12] p-3">
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber">
                  Live Web Audio Context Telemetry
                </div>
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <div>
                    <span className="text-slate-500">AudioContext State: </span>
                    <span className="font-mono font-bold text-cyan">{engine.state}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Sample Rate: </span>
                    <span className="font-mono font-bold text-slate-200">
                      {engine.ctx ? `${(engine.ctx.sampleRate / 1000).toFixed(1)} kHz` : '44.1 kHz'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500">Sidechain DSP Topology: </span>
                    <span className="font-mono font-bold text-amber">
                      {engine.workletOk ? 'AudioWorklet 2-Channel Key' : 'Gain Fallback'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500">Output Latency: </span>
                    <span className="font-mono font-bold text-slate-200">
                      {(engine.latency * 1000).toFixed(1)} ms
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500">Active Synthesizer Voices: </span>
                    <span className="font-mono font-bold text-slate-200">{engine.voices}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Worklet Status: </span>
                    <span className="font-mono font-bold text-emerald-400">
                      {engine.workletOk ? 'Active & Hardware Accelerated' : 'Initialized'}
                    </span>
                  </div>
                </div>
              </div>

              {/* DSP Latency Target */}
              <div className="rounded-md border border-line bg-panel p-3">
                <label className="mb-1 block font-semibold text-slate-200">DSP Buffer &amp; Latency Target</label>
                <p className="mb-2.5 text-[10px] text-slate-400 leading-snug">
                  Adjust scheduling lookahead budget. Low latency provides tight touch/key response; stable prevents XRuns on low-power mobile devices.
                </p>
                <div className="flex gap-2">
                  {(
                    [
                      ['low', 'Low Latency (~12ms)', 'Optimized for live touch & playhead response'],
                      ['balanced', 'Balanced (~25ms)', 'Recommended for mobile/tablet multitasking'],
                      ['stable', 'High Stability (~50ms)', 'Maximum buffer protection against audio dropouts'],
                    ] as [LatencyTarget, string, string][]
                  ).map(([val, label, desc]) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => settingsStore.set({ latencyTarget: val })}
                      className={cn(
                        'flex-1 rounded border p-2 text-left transition-colors',
                        settings.latencyTarget === val
                          ? 'border-amber bg-amber/15 text-amber'
                          : 'border-line bg-[#0e1216] text-slate-400 hover:text-slate-200'
                      )}
                    >
                      <div className="font-bold text-[10.5px]">{label}</div>
                      <div className="text-[9px] opacity-80 mt-0.5">{desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Master Limiter & Analog Saturation */}
              <div className="rounded-md border border-line bg-panel p-3 space-y-3">
                <div>
                  <label className="font-semibold text-slate-200">Master Dynamics Limiter Ceiling</label>
                  <p className="text-[10px] text-slate-400 mb-2">
                    Sets peak threshold on master bus brickwall compressor before digital clipping occurs.
                  </p>
                  <Slider
                    label="Limiter Ceiling (dBFS)"
                    min={-6.0}
                    max={0.0}
                    step={0.5}
                    value={settings.limiterCeiling}
                    onChange={(v) => settingsStore.set({ limiterCeiling: v })}
                    fmt={(v) => `${v.toFixed(1)} dBFS`}
                  />
                </div>

                <div className="border-t border-line pt-3">
                  <label className="font-semibold text-slate-200">Analog Tape &amp; Tube Saturation Warmth</label>
                  <p className="text-[10px] text-slate-400 mb-2">
                    Controls asymmetrical even-harmonic waveshaper drive across drum, synth, and FX voices.
                  </p>
                  <Slider
                    label="Saturation Intensity"
                    min={0.0}
                    max={1.0}
                    step={0.05}
                    value={settings.analogWarmth}
                    onChange={(v) => settingsStore.set({ analogWarmth: v })}
                    fmt={(v) => `${Math.round(v * 100)}%`}
                  />
                </div>

                <div className="border-t border-line pt-3 flex items-center justify-between">
                  <div>
                    <span className="font-semibold text-slate-200">Analog Pitch Micro-Drift</span>
                    <p className="text-[10px] text-slate-400">
                      Simulates slight VCO pitch drift across voices for authentic underground analog warmth.
                    </p>
                  </div>
                  <Btn
                    small
                    active={settings.microDrift}
                    onClick={() => settingsStore.set({ microDrift: !settings.microDrift })}
                  >
                    {settings.microDrift ? 'Enabled' : 'Disabled'}
                  </Btn>
                </div>
              </div>
            </div>
          )}

          {tab === 'ui' && (
            <div className="space-y-4">
              {/* Color Theme Selector */}
              <div className="rounded-md border border-line bg-panel p-3">
                <label className="mb-1 block font-semibold text-slate-200">Accent Theme Palette</label>
                <p className="mb-2.5 text-[10px] text-slate-400">
                  Select primary accent color for active buttons, arrangement highlights, and playhead indicators.
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {(
                    [
                      ['amber', 'Amber Techno', '#f59e0b'],
                      ['cyan', 'Cyan Electric', '#06b6d4'],
                      ['emerald', 'Emerald Warehouse', '#10b981'],
                      ['violet', 'Violet Deep', '#8b5cf6'],
                      ['crimson', 'Crimson Horror', '#ef4444'],
                      ['obsidian', 'Obsidian Cinematic', '#6366f1'],
                    ] as [ThemePreset, string, string][]
                  ).map(([tKey, label, hex]) => (
                    <button
                      key={tKey}
                      type="button"
                      onClick={() => settingsStore.set({ theme: tKey })}
                      className={cn(
                        'flex items-center gap-2 rounded border p-2 text-left transition-colors',
                        settings.theme === tKey
                          ? 'border-amber bg-amber/15 text-slate-100'
                          : 'border-line bg-[#0e1216] text-slate-400 hover:text-slate-200'
                      )}
                    >
                      <span className="h-3 w-3 rounded-full" style={{ backgroundColor: hex }} />
                      <span className="font-medium text-[10px]">{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Track Row Height Preference */}
              <div className="rounded-md border border-line bg-panel p-3">
                <label className="mb-1 block font-semibold text-slate-200">Default Track Row Height</label>
                <p className="mb-2.5 text-[10px] text-slate-400">
                  Default vertical lane size when opening or resetting arrangement timeline views.
                </p>
                <div className="flex gap-2">
                  {(
                    [
                      [24, 'Small (24px)', 'Maximum track lane density for large projects'],
                      [32, 'Medium (32px)', 'Standard balanced view for clip waveforms & notes'],
                      [44, 'Large (44px)', 'High visibility for touch editing on phones/tablets'],
                    ] as [24 | 32 | 44, string, string][]
                  ).map(([h, label, desc]) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => settingsStore.set({ defaultRowH: h })}
                      className={cn(
                        'flex-1 rounded border p-2 text-left transition-colors',
                        settings.defaultRowH === h
                          ? 'border-amber bg-amber/15 text-amber'
                          : 'border-line bg-[#0e1216] text-slate-400 hover:text-slate-200'
                      )}
                    >
                      <div className="font-bold text-[10.5px]">{label}</div>
                      <div className="text-[9px] opacity-80 mt-0.5">{desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Metronome Settings */}
              <div className="rounded-md border border-line bg-panel p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-semibold text-slate-200">Metronome Audio Click</span>
                    <p className="text-[10px] text-slate-400">
                      Plays sample-accurate beat click during arrangement playback.
                    </p>
                  </div>
                  <Btn
                    small
                    tone={settings.metronome ? 'amber' : 'default'}
                    onClick={() => settingsStore.set({ metronome: !settings.metronome })}
                  >
                    {settings.metronome ? '🔔 Click: ON' : '🔔 Click: OFF'}
                  </Btn>
                </div>

                {settings.metronome && (
                  <div className="border-t border-line pt-3">
                    <Slider
                      label="Metronome Click Volume"
                      min={0.1}
                      max={1.0}
                      step={0.05}
                      value={settings.metronomeVol}
                      onChange={(v) => settingsStore.set({ metronomeVol: v })}
                      fmt={(v) => `${Math.round(v * 100)}%`}
                    />
                  </div>
                )}
              </div>

              {/* Auto Follow & Grid Snap */}
              <div className="rounded-md border border-line bg-panel p-3 grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-200 block mb-1">Timeline Auto-Follow</label>
                  <p className="text-[10px] text-slate-400 mb-2">Auto-scroll timeline with playhead.</p>
                  <Btn
                    small
                    active={settings.autoFollow}
                    onClick={() => settingsStore.set({ autoFollow: !settings.autoFollow })}
                  >
                    {settings.autoFollow ? 'Follow Enabled' : 'Follow Disabled'}
                  </Btn>
                </div>

                <div>
                  <label className="font-semibold text-slate-200 block mb-1">Default Piano Roll Snap</label>
                  <p className="text-[10px] text-slate-400 mb-2">Note draw/move quantization.</p>
                  <select
                    aria-label="Grid snap"
                    value={settings.snapResolution}
                    onChange={(e) => settingsStore.set({ snapResolution: +e.target.value })}
                    className="h-7 rounded border border-line bg-elev px-2 text-[10px] font-semibold text-slate-200 outline-none"
                  >
                    <option value={1}>1/16 Note Grid</option>
                    <option value={0.5}>1/32 Note Grid</option>
                    <option value={0.25}>1/64 Note Grid</option>
                    <option value={0}>Free (Off)</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {tab === 'project' && (
            <div className="space-y-4">
              {/* Generator Subgenre Preset */}
              <div className="rounded-md border border-line bg-panel p-3">
                <label className="mb-1 block font-semibold text-slate-200">Underground Techno Subgenre Generator</label>
                <p className="mb-2.5 text-[10px] text-slate-400">
                  Select subgenre style grammar for new projects and section regenerations.
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {Object.entries(STYLES).map(([id, cfg]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setNewSubgenre(id)}
                      className={cn(
                        'flex flex-col rounded border p-2 text-left transition-colors',
                        newSubgenre === id
                          ? 'border-amber bg-amber/15 text-slate-100'
                          : 'border-line bg-[#0e1216] text-slate-400 hover:text-slate-200'
                      )}
                    >
                      <span className="font-bold text-[10.5px] text-amber">{cfg.name}</span>
                      <span className="text-[9px] text-slate-400 opacity-80 mt-0.5">
                        {cfg.bpm[0]}–{cfg.bpm[1]} BPM
                      </span>
                    </button>
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-line pt-2.5">
                  <span className="text-[10px] text-slate-400">
                    Selected Subgenre: <strong className="text-amber">{STYLES[newSubgenre]?.name}</strong>
                  </span>
                  <Btn tone="amber" onClick={startNewSubgenreProject} title="Generate a fresh arrangement project in this style">
                    + Generate New {STYLES[newSubgenre]?.name} Project
                  </Btn>
                </div>
              </div>

              {/* Current Project Info */}
              <div className="rounded-md border border-line bg-panel p-3 space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber">Active Project Properties</div>
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <div>
                    <span className="text-slate-500">Project Name: </span>
                    <span className="font-bold text-slate-200">{app.project.name}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Project Revision: </span>
                    <span className="font-mono text-slate-200">v{app.project.revision}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Key &amp; Scale: </span>
                    <span className="font-bold text-slate-200">
                      {KEY_NAMES[app.project.params.key]} {SCALE_NAMES[app.project.params.scale]}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500">Track Count: </span>
                    <span className="font-bold text-slate-200">{app.project.tracks.length} tracks</span>
                  </div>
                </div>
              </div>

              {/* Reset Defaults */}
              <div className="rounded-md border border-line bg-panel p-3 flex items-center justify-between">
                <div>
                  <span className="font-semibold text-slate-200">Reset Application Preferences</span>
                  <p className="text-[10px] text-slate-400">Restores all UI, audio, and view defaults to original settings.</p>
                </div>
                <Btn tone="ghost" className="hover:text-red-400" onClick={resetAll}>
                  Reset Defaults
                </Btn>
              </div>
            </div>
          )}

          {tab === 'shortcuts' && (
            <div className="space-y-3">
              <div className="text-[10px] text-slate-400 mb-2">
                Industry-standard Ableton Live DAW keyboard shortcuts supported in AIDAW:
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Transport & Navigation */}
                <div className="rounded border border-line bg-[#0e1216] p-2.5 space-y-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-amber border-b border-line pb-1">
                    Transport &amp; Navigation
                  </div>
                  <div className="space-y-1 text-[10px]">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Play / Stop</span>
                      <kbd className="font-mono bg-elev px-1.5 py-0.5 rounded text-slate-200">Space</kbd>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Flip Piano Roll / Device View</span>
                      <kbd className="font-mono bg-elev px-1.5 py-0.5 rounded text-slate-200">Shift + Tab</kbd>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Toggle Bottom Dock</span>
                      <kbd className="font-mono bg-elev px-1.5 py-0.5 rounded text-slate-200">Ctrl + Alt + M</kbd>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Deselect / Cancel Preview</span>
                      <kbd className="font-mono bg-elev px-1.5 py-0.5 rounded text-slate-200">Escape</kbd>
                    </div>
                  </div>
                </div>

                {/* Clip & Editing */}
                <div className="rounded border border-line bg-[#0e1216] p-2.5 space-y-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-amber border-b border-line pb-1">
                    Clip &amp; Note Editing
                  </div>
                  <div className="space-y-1 text-[10px]">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Split Clip at Playhead</span>
                      <kbd className="font-mono bg-elev px-1.5 py-0.5 rounded text-slate-200">Ctrl + E</kbd>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Duplicate Selected Clip</span>
                      <kbd className="font-mono bg-elev px-1.5 py-0.5 rounded text-slate-200">Ctrl + D</kbd>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Delete Selected Clip</span>
                      <kbd className="font-mono bg-elev px-1.5 py-0.5 rounded text-slate-200">Delete / Backspace</kbd>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Undo Action</span>
                      <kbd className="font-mono bg-elev px-1.5 py-0.5 rounded text-slate-200">Ctrl + Z</kbd>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Redo Action</span>
                      <kbd className="font-mono bg-elev px-1.5 py-0.5 rounded text-slate-200">Ctrl + Shift + Z / Ctrl + Y</kbd>
                    </div>
                  </div>
                </div>

                {/* Timeline Controls */}
                <div className="rounded border border-line bg-[#0e1216] p-2.5 space-y-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-amber border-b border-line pb-1">
                    Timeline Zoom &amp; Navigation
                  </div>
                  <div className="space-y-1 text-[10px]">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Zoom In / Out</span>
                      <kbd className="font-mono bg-elev px-1.5 py-0.5 rounded text-slate-200">Ctrl + Mouse Wheel</kbd>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Zoom to Fit Song</span>
                      <kbd className="font-mono bg-elev px-1.5 py-0.5 rounded text-slate-200">Fit Button</kbd>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Track Height Presets</span>
                      <kbd className="font-mono bg-elev px-1.5 py-0.5 rounded text-slate-200">S / M / L</kbd>
                    </div>
                  </div>
                </div>

                {/* Piano Roll Tools */}
                <div className="rounded border border-line bg-[#0e1216] p-2.5 space-y-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-amber border-b border-line pb-1">
                    Piano Roll Expressive Tools
                  </div>
                  <div className="space-y-1 text-[10px]">
                    <div className="flex justify-between">
                      <span className="text-slate-400">303 Filter Accent</span>
                      <span className="font-medium text-amber">Accent Tool (Caps gain &amp; res)</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Glide Portamento</span>
                      <span className="font-medium text-cyan">Slide Tool (Constant-time pitch glide)</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Euclidean Pattern</span>
                      <span className="font-medium text-slate-200">Euclidean E(k, n) Generator</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-line bg-[#161c24] px-4 py-2">
          <span className="text-[10px] text-slate-400">
            AIDAW Techno DAW · Web Audio &amp; Worklet Engine
          </span>
          <Btn tone="amber" onClick={onClose}>
            Done &amp; Close
          </Btn>
        </div>
      </div>
    </div>
  );
}
