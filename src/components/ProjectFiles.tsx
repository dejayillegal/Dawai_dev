import { useEffect, useRef, useState } from 'react';
import type { DurableLoad } from '../engine/durablePersistence';
import type { Project } from '../engine/types';
import { decodeSnapshot, encodeSnapshot } from '../engine/persistence';
import { downloadProjectMidi } from '../engine/midiExport';
import { store, useApp } from '../store';
import { seek, toggleLoop } from '../actions';
import { Btn } from '../ui';

/** Explicit file ownership complements autosave; import never overwrites on file selection. */
export function ProjectFiles({ compact }: { compact: boolean }) {
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
          className="flex h-9 cursor-pointer items-center rounded-md border border-line bg-elev px-2.5 text-[11px] font-medium text-slate-200 hover:bg-[#232b35]"
        >
          Project ▾
        </button>
        {open && (
          <div className="absolute left-0 top-full z-[90] mt-1 flex w-64 flex-col gap-1.5 rounded-md border border-line bg-panel p-3 shadow-2xl">
            <div className="mb-1 flex items-center justify-between">
              <span role="status" className="text-[10px] text-slate-400">
                {app.saveStatus} · project v1
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
            <Btn onClick={save}>Download project backup</Btn>
            <Btn tone="cyan" onClick={exportMidiNow}>Export MIDI File (SMF Type 1)</Btn>
            <Btn
              onClick={() => {
                setOpen(false);
                input.current?.click();
              }}
            >
              Open project…
            </Btn>
            <Btn
              onClick={() => {
                store.flushSave();
                setOpen(false);
              }}
            >
              Save autosave now
            </Btn>
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
            >
              Review database recovery…
            </Btn>
            {app.databaseRecovery && (
              <Btn
                tone="amber"
                onClick={() => {
                  setOpen(false);
                  void store.keepCurrentRecovery();
                }}
              >
                Keep current local edits
              </Btn>
            )}
            {compact && (
              <>
                <div className="my-0.5 border-t border-line" />
                <Btn
                  disabled={app.cursor === 0}
                  onClick={() => {
                    store.undo();
                    setOpen(false);
                  }}
                >
                  Undo
                </Btn>
                <Btn
                  disabled={app.cursor === app.entries.length}
                  onClick={() => {
                    store.redo();
                    setOpen(false);
                  }}
                >
                  Redo
                </Btn>
                <Btn
                  onClick={() => {
                    seek(0);
                    setOpen(false);
                  }}
                >
                  Return to start
                </Btn>
                <Btn
                  active={app.project.loop.on}
                  onClick={() => {
                    toggleLoop();
                    setOpen(false);
                  }}
                >
                  Loop selected section
                </Btn>
              </>
            )}
          </div>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept=".json,.aidaw.json,application/json"
        className="hidden"
        aria-label="Open AIDAW project"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          try {
            if (file.size > 32 * 1024 * 1024) throw new Error('Project exceeds 32 MiB import limit');
            setPending({ project: decodeSnapshot(await file.text()) });
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
