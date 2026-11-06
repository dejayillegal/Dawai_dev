import { useEffect, useRef, useState } from 'react';
import { store } from '../store';
import { renderWav, type ExportResult, type ExportState } from '../engine/audio';
import { exportProjectToMidi } from '../engine/midiExport';
import { exportProjectToAls } from '../engine/alsExport';
import { Btn } from '../ui';
import { cn } from '../utils/cn';
import type { Project } from '../engine/types';

const STEPS: ExportState[] = ['VALIDATING', 'PREPARING', 'RENDERING', 'PROCESSING', 'ENCODING', 'SAVING', 'VERIFYING', 'COMPLETED'];

type ExportTab = 'wav' | 'midi' | 'als';

export function ExportModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<ExportTab>('wav');
  const [sr, setSr] = useState(44100);
  const [bits, setBits] = useState<16 | 24 | 32>(24);
  const [targetTrack, setTargetTrack] = useState<string>('all');
  const [state, setState] = useState<ExportState>('IDLE');
  const [prog, setProg] = useState(0);
  const [err, setErr] = useState('');
  const [res, setRes] = useState<ExportResult | null>(null);
  const [name, setName] = useState('');
  const [midiUrl, setMidiUrl] = useState<string>('');
  const [midiName, setMidiName] = useState<string>('');
  const [alsUrl, setAlsUrl] = useState<string>('');
  const [alsName, setAlsName] = useState<string>('');
  const [alsLoading, setAlsLoading] = useState(false);

  const cancel = useRef(false);
  const url = useRef('');
  const active = useRef(false);
  const mounted = useRef(true);

  const currentProject = store.get().project;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancel.current = true;
      if (url.current) URL.revokeObjectURL(url.current);
      if (midiUrl) URL.revokeObjectURL(midiUrl);
      if (alsUrl) URL.revokeObjectURL(alsUrl);
    };
  }, [midiUrl, alsUrl]);

  const busy = state !== 'IDLE' && state !== 'COMPLETED' && state !== 'FAILED' && state !== 'CANCELLED';

  const startWav = async () => {
    if (active.current) return;
    active.current = true;
    cancel.current = false;
    setErr('');
    setRes(null);
    store.stop();

    if (url.current) {
      URL.revokeObjectURL(url.current);
      url.current = '';
    }

    const rawProject = store.get().project;
    let projectToRender: Project = rawProject;

    // Stem isolation if a single track is selected
    if (targetTrack !== 'all') {
      const selected = rawProject.tracks.find((t) => t.id === targetTrack);
      if (selected) {
        projectToRender = {
          ...rawProject,
          tracks: rawProject.tracks.map((t) => ({
            ...t,
            mute: t.id !== targetTrack,
            solo: t.id === targetTrack,
          })),
        };
      }
    }

    const rate = sr;
    const depth = bits;
    const trackSuffix = targetTrack !== 'all' ? `_stem_${projectToRender.tracks.find((t) => t.id === targetTrack)?.name.replace(/[^\w.-]+/g, '_')}` : '';
    const fileName = `${projectToRender.name.replace(/[^\w.-]+/g, '_')}${trackSuffix}_${rate / 1000}k_${depth}${depth === 32 ? 'f' : ''}.wav`;

    try {
      const r = await renderWav(projectToRender, {
        sampleRate: rate,
        bits: depth,
        cancelled: () => cancel.current,
        onState: (s, p) => {
          if (mounted.current) {
            setState(s);
            setProg(p);
          }
        },
      });
      if (!mounted.current || cancel.current) return;
      url.current = URL.createObjectURL(r.blob);
      setName(fileName);
      setRes(r);
      setState('COMPLETED');
      setProg(1);
    } catch (e) {
      if (!mounted.current) return;
      const m = e instanceof Error ? e.message : String(e);
      if (m === 'CANCELLED') setState('CANCELLED');
      else {
        setState('FAILED');
        setErr(m);
      }
    } finally {
      active.current = false;
    }
  };

  const handleExportMidi = () => {
    if (midiUrl) URL.revokeObjectURL(midiUrl);
    const p = store.get().project;
    const isSingle = targetTrack !== 'all';
    const trackObj = isSingle ? p.tracks.find((t) => t.id === targetTrack) : null;
    const blob = exportProjectToMidi(p, isSingle ? targetTrack : undefined);
    const downloadUrl = URL.createObjectURL(blob);
    const filename = isSingle && trackObj
      ? `${p.name.replace(/[^\w.-]+/g, '_')}_${trackObj.name.replace(/[^\w.-]+/g, '_')}.mid`
      : `${p.name.replace(/[^\w.-]+/g, '_')}_full.mid`;

    setMidiUrl(downloadUrl);
    setMidiName(filename);
  };

  const handleExportAls = async () => {
    if (alsUrl) URL.revokeObjectURL(alsUrl);
    setAlsLoading(true);
    try {
      const p = store.get().project;
      const blob = await exportProjectToAls(p);
      const downloadUrl = URL.createObjectURL(blob);
      const filename = `${p.name.replace(/[^\w.-]+/g, '_')}.als`;
      setAlsUrl(downloadUrl);
      setAlsName(filename);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAlsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-3" onClick={() => !busy && onClose()}>
      <div className="w-full max-w-md rounded-xl border border-line bg-panel p-4 shadow-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Export WAV, MIDI and Ableton Live">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[14px] font-bold">Export · WAV, MIDI & Ableton Live</h2>
          <Btn small tone="ghost" onClick={() => !busy && onClose()}>✕</Btn>
        </div>

        {/* Tab switch */}
        <div className="mb-3 flex gap-1 border-b border-line pb-2">
          <Btn small active={tab === 'wav'} onClick={() => !busy && setTab('wav')}>WAV Render</Btn>
          <Btn small active={tab === 'midi'} onClick={() => !busy && setTab('midi')}>MIDI (.mid)</Btn>
          <Btn small active={tab === 'als'} onClick={() => !busy && setTab('als')}>Ableton Live (.als)</Btn>
        </div>

        {tab === 'wav' ? (
          <>
            <p className="mb-3 text-[11px] leading-snug text-slate-400">
              Renders the arrangement through the <b>same scheduler, synths, automation and sidechain graph</b> as live playback with full float headroom and verified PCM frames.
            </p>

            <div className="mb-3 grid grid-cols-3 gap-2">
              <label className="text-[10px] uppercase tracking-wider text-slate-400">
                Scope
                <select disabled={busy} value={targetTrack} onChange={(e) => setTargetTrack(e.target.value)} className="mt-0.5 w-full text-[12px]">
                  <option value="all">Full Mix</option>
                  {currentProject.tracks.map((t) => (
                    <option key={t.id} value={t.id}>Stem: {t.name}</option>
                  ))}
                </select>
              </label>
              <label className="text-[10px] uppercase tracking-wider text-slate-400">
                Sample rate
                <select disabled={busy} value={sr} onChange={(e) => setSr(+e.target.value)} className="mt-0.5 w-full text-[12px]">
                  <option value={44100}>44.1 kHz</option>
                  <option value={48000}>48 kHz</option>
                  <option value={96000}>96 kHz</option>
                </select>
              </label>
              <label className="text-[10px] uppercase tracking-wider text-slate-400">
                Bit depth
                <select disabled={busy} value={bits} onChange={(e) => setBits(+e.target.value as 16 | 24 | 32)} className="mt-0.5 w-full text-[12px]">
                  <option value={16}>16-bit PCM</option>
                  <option value={24}>24-bit PCM</option>
                  <option value={32}>32-bit float</option>
                </select>
              </label>
            </div>

            <ol className="mb-3 grid grid-cols-4 gap-1 text-[9px]">
              {STEPS.map((s) => {
                const i = STEPS.indexOf(s);
                const c = STEPS.indexOf(state === 'FAILED' || state === 'CANCELLED' || state === 'IDLE' ? 'VALIDATING' : state);
                const done = state === 'COMPLETED' || (state !== 'IDLE' && i < c);
                const cur = s === state;
                return (
                  <li key={s} className={cn('rounded px-1 py-0.5 text-center', done ? 'bg-emerald-500/20 text-emerald-300' : cur ? 'bg-amber/20 text-amber pulse' : 'bg-elev text-slate-500')}>
                    {s}
                  </li>
                );
              })}
            </ol>

            <div className="mb-3 h-2 overflow-hidden rounded-full bg-[#0b0e12]">
              <div className="h-full bg-amber transition-[width]" style={{ width: `${prog * 100}%` }} />
            </div>

            {state === 'FAILED' && <div className="mb-3 rounded border border-red-500/50 bg-red-500/10 p-2 text-[11px] text-red-300">FAILED: {err}</div>}
            {state === 'CANCELLED' && <div className="mb-3 text-[11px] text-slate-400">Cancelled.</div>}

            {res && (
              <div className="mb-3 space-y-0.5 rounded border border-emerald-500/40 bg-emerald-500/10 p-2 font-mono text-[10px] text-emerald-200">
                <div>✓ WAV bytes verified · {res.seconds.toFixed(1)} s · {res.frames.toLocaleString()} frames {res.frames === res.expectedFrames ? '(exact)' : `(expected ${res.expectedFrames})`}</div>
                <div>peak {res.peakDb.toFixed(2)} dBFS · RMS {res.rmsDb.toFixed(1)} dBFS · {(res.blob.size / 1048576).toFixed(1)} MB</div>
                <div>sidechain: {res.sc === 'worklet' ? 'AudioWorklet (true key input)' : 'scheduled-envelope fallback'}</div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              {busy ? (
                <Btn onClick={() => (cancel.current = true)}>Cancel</Btn>
              ) : (
                <Btn tone="amber" onClick={startWav}>
                  {state === 'COMPLETED' ? 'Render again' : targetTrack === 'all' ? 'Render Full Mix' : 'Render Track Stem'}
                </Btn>
              )}
              {res && (
                <a href={url.current} download={name} className="inline-flex h-8 items-center rounded-md border border-cyan bg-cyan/90 px-3 text-[11px] font-semibold text-black">
                  Download WAV
                </a>
              )}
            </div>
          </>
        ) : tab === 'midi' ? (
          <>
            <p className="mb-3 text-[11px] leading-snug text-slate-400">
              Exports the project or individual instrument tracks as standard <b>Type 1 MIDI files (.mid)</b> at 480 PPQ, preserving note pitches, lengths, polymetric step timing, and velocities for external DAWs (Ableton Live, FL Studio, Bitwig, Logic).
            </p>

            <div className="mb-4">
              <label className="text-[10px] uppercase tracking-wider text-slate-400">
                Track Selection
                <select value={targetTrack} onChange={(e) => { setTargetTrack(e.target.value); setMidiUrl(''); }} className="mt-1 w-full text-[12px]">
                  <option value="all">Complete Arrangement (All Tracks)</option>
                  {currentProject.tracks.filter((t) => t.clips.length > 0).map((t) => (
                    <option key={t.id} value={t.id}>Single Track: {t.name} ({t.synth})</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mb-4 rounded border border-line bg-elev/60 p-3 text-[11px] text-slate-300">
              <div className="font-semibold text-cyan">MIDI Export Specifications:</div>
              <ul className="mt-1 list-inside list-disc space-y-0.5 text-[10px] text-slate-400">
                <li>SMF Type 1 multi-track format with Conductor track (BPM: {currentProject.params.bpm}, 4/4 meter)</li>
                <li>Division: 480 PPQ (120 ticks per 16th-note step)</li>
                <li>Velocity and polymetric clip boundaries preserved</li>
              </ul>
            </div>

            <div className="flex justify-end gap-2">
              <Btn tone="amber" onClick={handleExportMidi}>
                Generate MIDI File
              </Btn>
              {midiUrl && (
                <a href={midiUrl} download={midiName} className="inline-flex h-8 items-center rounded-md border border-cyan bg-cyan/90 px-3 text-[11px] font-semibold text-black">
                  Download {midiName}
                </a>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="mb-3 text-[11px] leading-snug text-slate-400">
              Exports the full arrangement directly as an <b>Ableton Live Set (.als)</b> project file with all sequenced MIDI tracks, clips, tempo, microtiming, and velocity curves.
            </p>

            <div className="mb-4 rounded border border-line bg-elev/60 p-3 text-[11px] text-slate-300">
              <div className="font-semibold text-emerald-400">Ableton Live Project Specifications:</div>
              <ul className="mt-1 list-inside list-disc space-y-0.5 text-[10px] text-slate-400">
                <li>Ableton Live 11+ compatible Gzip-compressed XML (.als)</li>
                <li>{currentProject.tracks.length} arrangement tracks with {currentProject.tracks.reduce((acc, t) => acc + t.clips.length, 0)} clips</li>
                <li>Master tempo: {currentProject.params.bpm} BPM (4/4 time signature)</li>
                <li>Directly double-click or drag into Ableton Live</li>
              </ul>
            </div>

            <div className="flex justify-end gap-2">
              <Btn tone="amber" disabled={alsLoading} onClick={handleExportAls}>
                {alsLoading ? 'Compressing Live Set...' : 'Generate Ableton Live Set (.als)'}
              </Btn>
              {alsUrl && (
                <a href={alsUrl} download={alsName} className="inline-flex h-8 items-center rounded-md border border-cyan bg-cyan/90 px-3 text-[11px] font-semibold text-black">
                  Download {alsName}
                </a>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
