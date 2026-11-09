import { useState } from 'react';
import { store } from '../store';
import { LAYERS } from '../engine/styles';
import type { Track } from '../engine/types';
import { Btn } from '../ui';

export interface ColorSwatch {
  hex: string;
  name: string;
  group: string;
}

export const TRACK_COLOR_PALETTE: ColorSwatch[] = [
  { hex: '#ef4444', name: '909 Crimson', group: 'Foundation' },
  { hex: '#f97316', name: 'Sub Bass Orange', group: 'Foundation' },
  { hex: '#fb7185', name: 'Rumble Rose', group: 'Foundation' },
  { hex: '#fb923c', name: 'Rolling Amber', group: 'Foundation' },
  { hex: '#f59e0b', name: '303 Acid Gold', group: 'Character' },
  { hex: '#fbbf24', name: 'Screamer Yellow', group: 'Character' },
  { hex: '#eab308', name: 'Pluck Citrine', group: 'Character' },
  { hex: '#84cc16', name: 'Modular Lime', group: 'Groove' },
  { hex: '#22c55e', name: 'Plateau Emerald', group: 'Groove' },
  { hex: '#10b981', name: 'Tom Jade', group: 'Groove' },
  { hex: '#34d399', name: 'Tribal Mint', group: 'Groove' },
  { hex: '#14b8a6', name: 'Euclid Teal', group: 'Groove' },
  { hex: '#2dd4bf', name: 'Polyrhythm Aqua', group: 'Groove' },
  { hex: '#06b6d4', name: 'Turbine Cyan', group: 'Transition' },
  { hex: '#22d3ee', name: 'Open Hat Sky', group: 'Groove' },
  { hex: '#38bdf8', name: 'Metallic Azure', group: 'Groove' },
  { hex: '#60a5fa', name: 'Analog Clap Blue', group: 'Groove' },
  { hex: '#3b82f6', name: 'Rimshot Cobalt', group: 'Groove' },
  { hex: '#6366f1', name: 'Deep Indigo', group: 'Harmony' },
  { hex: '#8b5cf6', name: 'Fifth Drone Violet', group: 'Harmony' },
  { hex: '#a78bfa', name: 'Horizon Pad Lavender', group: 'Harmony' },
  { hex: '#c084fc', name: 'Dub Chord Orchid', group: 'Harmony' },
  { hex: '#d946ef', name: 'Downlift Fuchsia', group: 'Transition' },
  { hex: '#ec4899', name: 'Seismic Magenta', group: 'Transition' },
  { hex: '#f472b6', name: 'Bronze Crash Pink', group: 'Transition' },
  { hex: '#94a3b8', name: 'Vault Slate', group: 'Texture' },
  { hex: '#a3a3a3', name: 'Anvil Chrome', group: 'Texture' },
  { hex: '#cbd5e1', name: 'Vinyl Dust Silver', group: 'Texture' },
];

/**
 * Ensures any user-supplied color string is normalized to a 7-character `#rrggbb` hex string
 * so canvas 8-digit hex alpha suffixes (`t.color + '44'`) remain valid across Timeline and PianoRoll.
 */
export function normalizeHexColor(input: string, fallback = '#06b6d4'): string {
  const clean = input.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(clean)) return clean;
  if (/^[0-9a-f]{6}$/.test(clean)) return `#${clean}`;
  if (/^#[0-9a-f]{3}$/.test(clean)) {
    const r = clean[1], g = clean[2], b = clean[3];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return fallback;
}

/**
 * Converts `#rrggbb` to `rgba(r, g, b, alpha)` for Piano Roll background and row tinting.
 */
export function hexToRgba(hex: string, alpha: number): string {
  const norm = normalizeHexColor(hex);
  const r = parseInt(norm.slice(1, 3), 16);
  const g = parseInt(norm.slice(3, 5), 16);
  const b = parseInt(norm.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}

/**
 * Blends a track `#rrggbb` hex color into a dark studio base `#rrggbb` at a given ratio (0..1).
 */
export function blendHexWithDarkBase(hex: string, baseHex = '#0e1216', weight = 0.14): string {
  const fg = normalizeHexColor(hex);
  const bg = normalizeHexColor(baseHex, '#0e1216');
  const w = Math.max(0, Math.min(1, weight));
  const r = Math.round(parseInt(bg.slice(1, 3), 16) * (1 - w) + parseInt(fg.slice(1, 3), 16) * w);
  const g = Math.round(parseInt(bg.slice(3, 5), 16) * (1 - w) + parseInt(fg.slice(3, 5), 16) * w);
  const b = Math.round(parseInt(bg.slice(5, 7), 16) * (1 - w) + parseInt(fg.slice(5, 7), 16) * w);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

export function TrackColorPickerTrigger({
  track,
  label = '🎨 Track Color',
  compact = false,
}: {
  track: Track;
  label?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [hexDraft, setHexDraft] = useState(track.color);

  const defaultColor = LAYERS[track.layer]?.color ?? '#06b6d4';

  const applyColor = (nextHex: string) => {
    if (track.lock) return;
    const validHex = normalizeHexColor(nextHex, track.color);
    setHexDraft(validHex);
    store.dispatch(
      {
        type: 'SET_TRACK',
        id: track.id,
        patch: { color: validHex },
      },
      `Track Color · ${track.name}`,
      'user',
      `color:${track.id}`
    );
  };

  return (
    <>
      <button
        type="button"
        disabled={track.lock}
        aria-label={`Change track color for ${track.name} and all ${track.clips.length} clips`}
        title={
          track.lock
            ? `${track.name} is locked`
            : `Open Color Picker Dialog for ${track.name} (updates all ${track.clips.length} associated clips, Timeline & Piano Roll background)`
        }
        onClick={() => {
          setHexDraft(track.color);
          setOpen(true);
        }}
        className={`inline-flex items-center gap-1.5 rounded border border-line bg-elev font-medium text-slate-200 transition-colors hover:border-amber hover:text-white disabled:opacity-40 ${
          compact ? 'h-6 px-1.5 text-[10px]' : 'h-7 px-2 text-[11px]'
        }`}
      >
        <span
          className="h-3 w-3 shrink-0 rounded-sm border border-white/30 shadow-sm"
          style={{ background: track.color }}
        />
        <span>{label}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Track & Clip Color Picker — ${track.name}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-lg border border-line bg-[#0d1117] p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Dialog Header */}
            <div className="mb-3 flex items-center justify-between border-b border-line pb-2.5">
              <div className="flex items-center gap-2">
                <span
                  className="h-4 w-4 rounded border border-white/30 shadow-sm"
                  style={{ background: track.color }}
                />
                <div>
                  <div className="text-[13px] font-semibold text-slate-100">
                    Track &amp; Clip Color · {track.name}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    Updates all {track.clips.length} associated {track.clips.length === 1 ? 'clip' : 'clips'} on the Timeline &amp; Piano Roll background
                  </div>
                </div>
              </div>
              <Btn small tone="ghost" onClick={() => setOpen(false)} aria-label="Close color picker dialog">
                ✕
              </Btn>
            </div>

            {/* Live Timeline Clip + Piano Roll Background Preview */}
            <div
              className="mb-3 rounded-md border p-2.5 transition-colors"
              style={{
                borderColor: hexToRgba(track.color, 0.45),
                background: blendHexWithDarkBase(track.color, '#0b0e12', 0.18),
              }}
            >
              <div className="mb-1.5 flex items-center justify-between text-[9px] font-semibold uppercase tracking-wider text-slate-300">
                <span>Live Timeline &amp; Piano Roll Preview</span>
                <span className="font-mono text-slate-400">{track.color.toUpperCase()}</span>
              </div>
              <div className="flex items-center gap-2">
                {/* Simulated Timeline Clip */}
                <div
                  className="flex-1 overflow-hidden rounded border text-[10px] font-medium text-white shadow-xs"
                  style={{
                    borderColor: track.color,
                    background: hexToRgba(track.color, 0.28),
                  }}
                >
                  <div
                    className="px-2 py-0.5 text-[9px] font-semibold text-white"
                    style={{ background: hexToRgba(track.color, 0.78) }}
                  >
                    {track.clips[0]?.label ?? `${track.name} · Clip`} ({track.clips.length} clips)
                  </div>
                  <div className="flex items-center gap-1 px-2 py-1.5">
                    <span className="h-1.5 w-5 rounded-xs" style={{ background: track.color }} />
                    <span className="h-1.5 w-3 rounded-xs" style={{ background: track.color }} />
                    <span className="h-1.5 w-7 rounded-xs" style={{ background: track.color }} />
                    <span className="h-1.5 w-4 rounded-xs" style={{ background: track.color }} />
                  </div>
                </div>
                {/* Simulated Piano Roll Note Grid */}
                <div
                  className="flex flex-1 flex-col gap-1 rounded border p-1.5"
                  style={{
                    borderColor: hexToRgba(track.color, 0.35),
                    background: blendHexWithDarkBase(track.color, '#0e1216', 0.22),
                  }}
                >
                  <div className="text-[8px] font-mono uppercase text-slate-300">Piano Roll Surface</div>
                  <div className="flex items-center gap-1">
                    <span className="h-2.5 w-8 rounded-xs" style={{ background: track.color }} />
                    <span className="h-2.5 w-5 rounded-xs opacity-80" style={{ background: track.color }} />
                    <span className="h-2.5 w-10 rounded-xs" style={{ background: track.color }} />
                  </div>
                </div>
              </div>
            </div>

            {/* Studio Swatch Grid */}
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Studio Color Swatches (28 Underground Palette Colors)
            </div>
            <div className="mb-3 grid grid-cols-7 gap-1.5 rounded border border-line bg-[#090c10] p-2">
              {TRACK_COLOR_PALETTE.map((sw) => {
                const active = track.color.toLowerCase() === sw.hex.toLowerCase();
                return (
                  <button
                    key={sw.hex}
                    type="button"
                    title={`${sw.name} (${sw.hex})`}
                    aria-label={`Select color ${sw.name} ${sw.hex}`}
                    onClick={() => applyColor(sw.hex)}
                    className={`group relative flex h-7 w-full items-center justify-center rounded border transition-transform hover:scale-105 ${
                      active ? 'border-white ring-2 ring-white/60' : 'border-black/40 hover:border-white/70'
                    }`}
                    style={{ background: sw.hex }}
                  >
                    {active && (
                      <span className="rounded bg-black/60 px-1 font-mono text-[9px] font-bold text-white">
                        ✓
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Custom Color Input & Reset */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2.5">
              <div className="flex items-center gap-1.5">
                <label className="flex items-center gap-1.5 text-[10px] font-medium text-slate-300">
                  <span>Custom:</span>
                  <input
                    type="color"
                    aria-label="Custom track color wheel"
                    value={normalizeHexColor(track.color)}
                    onChange={(e) => applyColor(e.target.value)}
                    className="h-7 w-9 cursor-pointer rounded border border-line bg-elev p-0.5"
                  />
                </label>
                <input
                  type="text"
                  aria-label="Custom hex color code"
                  value={hexDraft}
                  onChange={(e) => {
                    const v = e.target.value;
                    setHexDraft(v);
                    if (/^#?[0-9a-fA-F]{6}$/.test(v.trim())) {
                      applyColor(v);
                    }
                  }}
                  onBlur={() => setHexDraft(track.color)}
                  placeholder="#06b6d4"
                  className="h-7 w-24 rounded border border-line bg-elev px-2 font-mono text-[11px] text-slate-100"
                />
              </div>

              <div className="flex items-center gap-1.5">
                <Btn
                  small
                  tone="ghost"
                  onClick={() => applyColor(defaultColor)}
                  title={`Reset ${track.name} to default layer color (${defaultColor})`}
                >
                  Reset Default
                </Btn>
                <Btn small tone="amber" onClick={() => setOpen(false)}>
                  Done
                </Btn>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
