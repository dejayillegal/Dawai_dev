import { uid } from './engine/theory';
import { useEffect, useState } from 'react';
import { store, useApp } from './store';
import { TopBar } from './components/TopBar';
import { Timeline } from './components/Timeline';
import { Compose } from './components/Compose';
import { DeviceRack, Inspect } from './components/Inspect';
import { Assist } from './components/Assist';
import { PianoRoll } from './components/PianoRoll';
import { AutomationEditor } from './components/Automation';
import { Mixer } from './components/Mixer';
import { ExportModal } from './components/ExportModal';
import { Btn, useMedia } from './ui';
import { cn } from './utils/cn';
import { GROUP_ORDER, LAYERS, STYLES } from './engine/styles';
import { newClipAt, splitSelectedAtPlayhead } from './actions';
import { newProject, defaultParams } from './engine/composer';
import type { LayerGroup, Track } from './engine/types';

type Dock = 'roll' | 'devices' | 'auto' | 'mixer';
type Left = 'compose' | 'library';
type Sheet = 'library' | 'compose' | 'inspect' | 'assist' | 'edit' | null;

function Library() {
  const app = useApp();
  const p = app.project;
  const style = STYLES[p.params.style];
  const [groupFilter, setGroupFilter] = useState<'ALL' | LayerGroup>('ALL');

  const selTrackId =
    app.selection.kind === 'track'
      ? app.selection.id
      : app.selection.kind === 'clip'
        ? app.selection.track
        : null;
  const selTrack = selTrackId ? p.tracks.find((t) => t.id === selTrackId) : undefined;

  const add = (id: string, withClip = false) => {
    const l = LAYERS[id];
    const instance = uid('layer');
    const count = p.tracks.filter((t) => t.layer === id).length;
    const t: Track = {
      id: instance,
      layer: id,
      name: count ? `${l.name} ${count + 1}` : l.name,
      color: l.color,
      group: l.group,
      synth: l.synth,
      vol: l.vol,
      pan: l.pan,
      mute: false,
      solo: false,
      lock: false,
      sc: l.sc,
      rev: l.rev,
      del: l.del,
      cutoff: 0.5,
      res: 0.3,
      clips: [],
    };
    store.dispatch({ type: 'ADD_TRACK', track: t }, `Add track · ${l.name}`);
    store.select({ kind: 'track', id: instance });
    if (withClip) {
      newClipAt(instance, Math.floor(store.get().cursorBar));
    }
  };

  const swapSelectedTrack = (id: string) => {
    if (!selTrack || selTrack.lock) return;
    const l = LAYERS[id];
    store.dispatch(
      {
        type: 'SET_TRACK',
        id: selTrack.id,
        patch: {
          layer: l.id,
          name: l.name,
          color: l.color,
          group: l.group,
          synth: l.synth,
          sc: l.sc,
          rev: l.rev,
          del: l.del,
        },
      },
      `Swap track to ${l.name}`
    );
  };

  const visibleGroups = groupFilter === 'ALL' ? GROUP_ORDER : [groupFilter];

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
      <div className="mb-2 flex flex-wrap gap-1">
        <button
          type="button"
          onClick={() => setGroupFilter('ALL')}
          className={cn(
            'rounded px-2 py-0.5 text-[10px] font-medium transition-colors',
            groupFilter === 'ALL' ? 'bg-amber text-black' : 'bg-elev text-slate-400 hover:text-white'
          )}
        >
          All ({Object.keys(LAYERS).length})
        </button>
        {GROUP_ORDER.map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => setGroupFilter(g)}
            className={cn(
              'rounded px-2 py-0.5 text-[10px] font-medium transition-colors',
              groupFilter === g ? 'bg-amber text-black' : 'bg-elev text-slate-400 hover:text-white'
            )}
          >
            {g}
          </button>
        ))}
      </div>
      <p className="mb-2 text-[10px] leading-snug text-slate-500">
        Ableton-style Instrument &amp; Layer Catalog. Add any layer as a track, add with an initial clip, or hot-swap the
        selected track{selTrack ? ` (${selTrack.name})` : ''}.
      </p>
      {visibleGroups.map((g) => (
        <div key={g} className="mb-2.5">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{g}</div>
          <div className="space-y-1">
            {Object.values(LAYERS)
              .filter((l) => l.group === g)
              .map((l) => {
                const inStyle = style.layers.includes(l.id);
                const has = p.tracks.some((t) => t.layer === l.id);
                return (
                  <div
                    key={l.id}
                    className={cn(
                      'flex items-center gap-1.5 rounded border px-2 py-1',
                      inStyle ? 'border-line bg-panel' : 'border-transparent bg-[#0f1318] opacity-80'
                    )}
                  >
                    <span className="h-6 w-1.5 shrink-0 rounded-sm" style={{ background: l.color }} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[11px] font-medium text-slate-200">{l.name}</div>
                      <div className="truncate text-[9px] text-slate-500">
                        {l.synth} · {l.reg}
                        {l.sc ? ` · sc:${l.sc}` : ''}
                      </div>
                    </div>
                    {selTrack && !selTrack.lock && (
                      <Btn small tone="ghost" title={`Swap ${selTrack.name} to ${l.name}`} onClick={() => swapSelectedTrack(l.id)}>
                        Swap
                      </Btn>
                    )}
                    <Btn small tone="cyan" title="Add track with a pattern clip at playhead" onClick={() => add(l.id, true)}>
                      +clip
                    </Btn>
                    <Btn small tone={has ? 'ghost' : 'default'} onClick={() => add(l.id, false)}>
                      + add
                    </Btn>
                  </div>
                );
              })}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const app = useApp();
  const desktop = useMedia('(min-width: 1024px)');
  const [dock, setDock] = useState<Dock>('roll');
  const [dockOpen, setDockOpen] = useState(true);
  const [leftOpen, setLeftOpen] = useState(true);
  const [left, setLeft] = useState<Left>('compose');
  const [sheet, setSheet] = useState<Sheet>(null);
  const [sheetTall, setSheetTall] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const save = () => store.flushSave();
    window.addEventListener('pagehide', save);
    return () => window.removeEventListener('pagehide', save);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing =
        (el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'range') ||
        el.tagName === 'TEXTAREA' ||
        el.tagName === 'SELECT';
      const mod = e.ctrlKey || e.metaKey;
      const s = store.get();
      if (typing || el.closest('[role="dialog"]')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (el.tagName === 'BUTTON') el.blur();
        store.toggle();
      } else if (e.key === 'Tab' && e.shiftKey) {
        e.preventDefault();
        setDockOpen(true);
        setDock((d) => (d === 'roll' ? 'devices' : 'roll'));
      } else if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        store.redo();
      } else if (mod && e.key.toLowerCase() === 'd' && s.selection.kind === 'clip') {
        e.preventDefault();
        store.dispatch({ type: 'DUP_CLIP', copyId: uid('clip'), id: s.selection.id }, 'Duplicate clip');
      } else if (mod && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        splitSelectedAtPlayhead();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && s.selection.kind === 'clip' && !s.previewId) {
        e.preventDefault();
        store.dispatch({ type: 'DEL_CLIP', id: s.selection.id }, 'Delete clip');
        store.select({ kind: 'track', id: s.selection.track });
      } else if (mod && e.altKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        setDockOpen((o) => !o);
        setDock((d) => (dockOpen ? d : 'mixer'));
      } else if (e.key === 'Escape') {
        store.setPreview(null);
        store.select({ kind: 'none' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dockOpen]);

  const openClip = () => {
    setDock('roll');
    setDockOpen(true);
    if (!desktop) setSheet('edit');
  };

  const dockTabs = (
    <div className="flex shrink-0 items-center gap-1 border-b border-line bg-panel px-2 py-1">
      {(
        [
          ['roll', 'Piano Roll'],
          ['devices', 'Device Rack'],
          ['auto', 'Automation'],
          ['mixer', 'Mixer'],
        ] as [Dock, string][]
      ).map(([k, n]) => (
        <Btn
          key={k}
          small
          active={dock === k}
          onClick={() => {
            setDock(k);
            setDockOpen(true);
          }}
        >
          {n}
        </Btn>
      ))}
      <span className="ml-1 hidden text-[10px] text-slate-500 xl:inline">
        Shift+Tab = Clip / Device View · Ctrl+Alt+M = toggle dock
      </span>
      {desktop && (
        <Btn small tone="ghost" className="ml-auto" onClick={() => setDockOpen(false)}>
          ▾ hide
        </Btn>
      )}
    </div>
  );

  const dockBody = (
    <div className="min-h-0 flex-1 overflow-hidden">
      {dock === 'roll' ? (
        <PianoRoll />
      ) : dock === 'devices' ? (
        <DeviceRack onOpenAuto={() => setDock('auto')} />
      ) : dock === 'auto' ? (
        <AutomationEditor />
      ) : (
        <Mixer />
      )}
    </div>
  );

  const errorBanner = app.error && (
    <div role="alert" className="flex shrink-0 items-center gap-2 border-b border-red-500 bg-panel p-2 text-red-300">
      <span className="min-w-0 flex-1">{app.error}</span>
      <Btn onClick={() => store.clearError()}>Dismiss</Btn>
    </div>
  );
  const banner = app.restored && (
    <div className="flex shrink-0 items-center gap-2 border-b border-cyan/40 bg-cyan/10 px-3 py-1 text-[11px] text-cyan">
      Restored your last session from autosave.
      <Btn
        small
        className="ml-auto"
        onClick={() => {
          store.replaceProject(newProject(defaultParams('hypnotic', Math.floor(Math.random() * 99999))));
          store.dismissRestore();
        }}
      >
        New project
      </Btn>
      <Btn small tone="ghost" onClick={() => store.dismissRestore()}>
        Dismiss
      </Btn>
    </div>
  );

  if (desktop) {
    return (
      <div className="flex h-full flex-col bg-bg">
        <TopBar compact={false} onExport={() => setExporting(true)} />
        {errorBanner}
        {banner}
        <div className="flex min-h-0 flex-1">
          {leftOpen ? (
            <aside className="flex w-[304px] shrink-0 flex-col border-r border-line bg-panel">
              <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1">
                <Btn small active={left === 'compose'} onClick={() => setLeft('compose')}>
                  Compose
                </Btn>
                <Btn small active={left === 'library'} onClick={() => setLeft('library')}>
                  Library
                </Btn>
                <Btn small tone="ghost" className="ml-auto" title="Hide left dock" onClick={() => setLeftOpen(false)}>
                  ◂
                </Btn>
              </div>
              {left === 'compose' ? <Compose /> : <Library />}
            </aside>
          ) : (
            <button
              aria-label="Show compose dock"
              onClick={() => setLeftOpen(true)}
              className="w-5 shrink-0 border-r border-line bg-panel text-[10px] text-slate-400 hover:text-amber [writing-mode:vertical-rl]"
            >
              ▸ COMPOSE
            </button>
          )}
          <main className="flex min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1">
              <Timeline onOpenClip={openClip} />
            </div>
            {dockOpen ? (
              <div className="flex h-[288px] shrink-0 flex-col border-t border-line bg-panel">
                {dockTabs}
                {dockBody}
              </div>
            ) : (
              <button
                onClick={() => setDockOpen(true)}
                className="h-6 shrink-0 border-t border-line bg-panel text-[10px] text-slate-400 hover:text-amber"
              >
                ▴ Piano Roll · Device Rack · Automation · Mixer (Ctrl+Alt+M)
              </button>
            )}
          </main>
          <aside className="flex w-[344px] shrink-0 flex-col border-l border-line bg-panel">
            <div className="flex min-h-0 flex-1 flex-col border-b border-line">
              <div className="shrink-0 border-b border-line px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                Inspect <span className="font-normal normal-case tracking-normal text-slate-600">· follows selection</span>
              </div>
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                <Inspect />
              </div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="shrink-0 border-b border-line px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan">
                Assist{' '}
                <span className="font-normal normal-case tracking-normal text-slate-600">
                  · copilot · ghost diffs · diagnostics
                </span>
              </div>
              <Assist />
            </div>
          </aside>
        </div>
        {exporting && <ExportModal onClose={() => setExporting(false)} />}
      </div>
    );
  }

  // phone / tablet: persistent timeline + resizable/closable bottom sheets
  const nav: [Exclude<Sheet, null>, string][] = [
    ['compose', 'Compose'],
    ['library', 'Layers'],
    ['inspect', 'Inspect'],
    ['assist', 'Assist'],
    ['edit', 'Roll · Rack · Mix'],
  ];

  return (
    <div className="flex h-full flex-col bg-bg">
      <TopBar compact onExport={() => setExporting(true)} />
      {errorBanner}
      {banner}
      <div className="min-h-0 flex-1">
        <Timeline onOpenClip={openClip} />
      </div>
      {sheet && (
        <div
          className={cn(
            'flex shrink-0 flex-col border-t-2 border-amber/60 bg-panel transition-all',
            sheetTall ? 'h-[76%]' : 'h-[48%]'
          )}
        >
          {sheet === 'edit' ? (
            <div className="flex shrink-0 items-center gap-1 border-b border-line bg-panel px-2 py-1">
              {(
                [
                  ['roll', 'Piano Roll'],
                  ['devices', 'Device Rack'],
                  ['auto', 'Automation'],
                  ['mixer', 'Mixer'],
                ] as [Dock, string][]
              ).map(([k, n]) => (
                <Btn key={k} small active={dock === k} onClick={() => setDock(k)}>
                  {n}
                </Btn>
              ))}
              <div className="ml-auto flex items-center gap-1">
                <Btn small tone="ghost" onClick={() => setSheetTall((t) => !t)} title="Toggle sheet height">
                  {sheetTall ? '▾ Split' : '▴ Expand'}
                </Btn>
                <Btn small tone="ghost" onClick={() => setSheet(null)} title="Close panel">
                  ✕
                </Btn>
              </div>
            </div>
          ) : (
            <div className="flex shrink-0 items-center justify-between border-b border-line bg-[#161b22] px-3 py-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-amber">{sheet}</span>
              <div className="flex items-center gap-1">
                <Btn small tone="ghost" onClick={() => setSheetTall((t) => !t)} title="Toggle sheet height">
                  {sheetTall ? '▾ Split' : '▴ Expand'}
                </Btn>
                <Btn small tone="ghost" onClick={() => setSheet(null)} title="Close panel">
                  ✕
                </Btn>
              </div>
            </div>
          )}
          {sheet === 'compose' && <Compose />}
          {sheet === 'library' && <Library />}
          {sheet === 'inspect' && (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              <Inspect />
            </div>
          )}
          {sheet === 'assist' && <Assist />}
          {sheet === 'edit' && dockBody}
        </div>
      )}
      <nav className="flex h-12 shrink-0 border-t border-line bg-panel" aria-label="Workspace panels">
        {nav.map(([k, n]) => (
          <button
            key={k}
            onClick={() => setSheet(sheet === k ? null : k)}
            className={cn(
              'flex min-h-[44px] flex-1 items-center justify-center text-[11px] font-semibold transition-colors',
              sheet === k ? 'bg-amber/15 text-amber' : 'text-slate-400 hover:text-slate-200'
            )}
          >
            {n}
          </button>
        ))}
      </nav>
      {exporting && <ExportModal onClose={() => setExporting(false)} />}
    </div>
  );
}
