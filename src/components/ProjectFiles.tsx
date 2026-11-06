import { useEffect, useRef, useState } from 'react';
import type { DurableLoad } from '../engine/durablePersistence';
import type { Project } from '../engine/types';
import { decodeSnapshot, encodeSnapshot } from '../engine/persistence';
import { importAlsFile } from '../engine/alsImport';
import { downloadProjectMidi } from '../engine/midiExport';
import { store, useApp } from '../store';
import { seek, toggleLoop } from '../actions';
import { Btn } from '../ui';

/** Explicit file ownership complements autosave; import never overwrites on file selection. */
export function ProjectFiles({ compact, onOpenSettings }: { compact: boolean; onOpenSettings?: () => void }) {
  const app = useApp();
  const input = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const urls = useRef(new Set<string>());
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<{ project: Project; recovery?: DurableLoad } | null>(null);

  useEffect(() => () => {
    for (const url of urls.current) URL.revokeObjectURL(url);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const save = () => {
    try {
      const blob = new Blob([encodeSnapshot(store.get().project)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      urls.current.add(url);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${store.get().project.name.replace(/[^\w.-]+/g, '_')}.aidaw.json`;
      anchor.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        urls.current.delete(url);
      }, 1000);
      setOpen(false);
    } catch (error) {
      store.reportError(error);
    }
  };

  const exportMidiNow = () => {
    try {
      const out = downloadProjectMidi(store.get().project);
      urls.current.add(out.url);
      setTimeout(() => {
        URL.revokeObjectURL(out.url);
        urls.current.delete(out.url);
      }, 2000);
      setOpen(false);
    } catch (error) {
      store.reportError(error);
    }
  };

  return (
    <>
      <div ref={menuRef} className="relative shrink-0">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label="Project files and editing commands"
          className="flex h-7 cursor-pointer items-center rounded border border-line bg-elev px-2 text-[11px] font-semibold text-slate-200 hover:bg-[#232b35] transition-colors"
        >
          Project ▾
        </button>
        {open && (
          <>
            <div
              className="fixed inset-0 z-[80]"
              onClick={() => setOpen(false)}
              aria-hidden="true"
            />
            <div className="absolute left-0 top-full z-[90] mt-1 flex w-68 flex-col gap-2 rounded-md border border-line bg-panel p-2.5 shadow-2xl">
              <div className="flex items-center justify-between border-b border-line pb-1.5">
                <span role="status" className="text-[10px] font-medium text-slate-400">
                  Status: <span className="text-amber">{app.saveStatus}</span> · v1
                </span>
                <button
                  type="button"
                  aria-label="Close project menu"
                  onClick={() => setOpen(false)}
                  className="rounded px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-elev hover:text-white"
                >
                  ✕
                </button>
              </div>

              {/* File Storage */}
              <div className="flex flex-col gap-1">
                <span className="text-[8px] font-semibold uppercase tracking-wider text-slate-400">Project Storage</span>
                <Btn onClick={save} title="Download a JSON backup file to your device">Save Backup (.aidaw.json)</Btn>
                <Btn
                  onClick={() => {
                    setOpen(false);
                    input.current?.click();
                  }}
                  title="Open an existing project JSON file"
                >
                  Open Project File…
                </Btn>
                <Btn
                  onClick={() => {
                    store.flushSave();
                    setOpen(false);
                  }}
                  title="Immediately write active project to IndexedDB autosave"
                >
                  Save Autosave Now
                </Btn>
                {onOpenSettings && (
                  <Btn
                    onClick={() => {
                      setOpen(false);
                      onOpenSettings();
                    }}
                    title="Configure audio engine, DSP latency, UI themes, and shortcuts"
                  >
                    ⚙ Settings &amp; Audio Preferences…
                  </Btn>
                )}
              </div>

              {/* Export Options */}
              <div className="flex flex-col gap-1 border-t border-line pt-1.5">
                <span className="text-[8px] font-semibold uppercase tracking-wider text-slate-400">Export File</span>
                <Btn tone="cyan" onClick={exportMidiNow} title="Download full arrangement as standard MIDI file">
                  Export MIDI File (SMF Type 1)
                </Btn>
              </div>

              {/* Recovery */}
              <div className="flex flex-col gap-1 border-t border-line pt-1.5">
                <span className="text-[8px] font-semibold uppercase tracking-wider text-slate-400">Database &amp; Recovery</span>
                <Btn
                  onClick={() => {
                    setOpen(false);
                    void store
                      .getDurableRecovery()
                      .then((recovery) => {
                        if (recovery) setPending({ project: recovery.project, recovery });
                        else store.reportError('No database recovery snapshot is available.');
                      })
                      .catch((error) => store.reportError(error));
                  }}
                  title="Review database snapshots in case of interruption"
                >
                  Review Database Recovery…
                </Btn>
                {app.databaseRecovery && (
                  <Btn
                    tone="amber"
                    onClick={() => {
                      setOpen(false);
                      void store.keepCurrentRecovery();
                    }}
                  >
                    Keep Current Local Edits
                  </Btn>
                )}
              </div>

              {compact && (
                <div className="flex flex-col gap-1 border-t border-line pt-1.5">
                  <span className="text-[8px] font-semibold uppercase tracking-wider text-slate-400">Quick Actions</span>
                  <Btn
                    disabled={app.cursor === 0}
                    onClick={() => {
                      store.undo();
                      setOpen(false);
                    }}
                  >
                    ↶ Undo
                  </Btn>
                  <Btn
                    disabled={app.cursor === app.entries.length}
                    onClick={() => {
                      store.redo();
                      setOpen(false);
                    }}
                  >
                    ↷ Redo
                  </Btn>
                  <Btn
                    onClick={() => {
                      seek(0);
                      setOpen(false);
                    }}
                  >
                    ⏮ Return to Start (Bar 1)
                  </Btn>
                  <Btn
                    active={app.project.loop.on}
                    onClick={() => {
                      toggleLoop();
                      setOpen(false);
                    }}
                  >
                    ⟳ Loop Selected Section
                  </Btn>
                </div>
              )}
            </div>
          </>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept=".json,.aidaw.json,.als,application/json,application/x-gzip"
        className="hidden"
        aria-label="Open AIDAW or Ableton Live ALS project"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          try {
            if (file.size > 32 * 1024 * 1024) throw new Error('Project exceeds 32 MiB import limit');
            if (file.name.toLowerCase().endsWith('.als')) {
              const imported = await importAlsFile(await file.arrayBuffer(), file.name);
              setPending({ project: imported });
            } else {
              setPending({ project: decodeSnapshot(await file.text()) });
            }
          } catch (error) {
            store.reportError(error);
          }
        }}
      />
      {pending && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Open project confirmation"
            className="w-full max-w-md rounded-md border border-line bg-panel p-4"
          >
            <h2 className="mb-2 font-semibold">Open {pending.project.name}?</h2>
            <p className="mb-3 text-slate-400">
              This replaces the active workspace and its undo history. Download a backup of your current work before opening.
            </p>
            <div className="flex flex-wrap gap-2">
              <Btn onClick={save}>Back up current project</Btn>
              <Btn onClick={() => setPending(null)}>Cancel</Btn>
              <Btn
                tone="amber"
                onClick={() => {
                  if (pending.recovery) void store.restoreDurable(pending.recovery);
                  else store.replaceProject(pending.project);
                  setPending(null);
                }}
              >
                Open project
              </Btn>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
