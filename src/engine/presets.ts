import type { ScGroup, SynthKind, Track } from './types';
import { clamp } from './theory';

export interface DevicePreset {
  id: string;
  name: string;
  category: 'Foundation' | '303 Acid' | 'Harmony / Dub' | 'Groove / Perc' | 'Transition / FX' | 'Custom';
  builtIn?: boolean;
  track: {
    synth: SynthKind;
    vol: number;
    pan: number;
    cutoff: number;
    res: number;
    rev: number;
    del: number;
    sc: ScGroup | null;
  };
  eq: {
    eqLow: number;
    eqMid: number;
    eqHigh: number;
  };
}

const STORAGE_KEY = 'aidaw.device.presets.v1';

export const FACTORY_DEVICE_PRESETS: DevicePreset[] = [
  {
    id: 'preset_sub_warehouse',
    name: 'Subterranean Vault Sub',
    category: 'Foundation',
    builtIn: true,
    track: { synth: 'sub', vol: 0.84, pan: 0, cutoff: 0.34, res: 0.22, rev: 0.04, del: 0, sc: 'bass' },
    eq: { eqLow: 2.5, eqMid: -1.5, eqHigh: -1.0 },
  },
  {
    id: 'preset_rumble_berghain',
    name: 'Concrete Hall Rumble',
    category: 'Foundation',
    builtIn: true,
    track: { synth: 'rumble', vol: 0.62, pan: 0, cutoff: 0.28, res: 0.36, rev: 0.38, del: 0.08, sc: 'bass' },
    eq: { eqLow: 3.0, eqMid: -2.0, eqHigh: -2.5 },
  },
  {
    id: 'preset_303_liquid',
    name: 'TB-303 Liquid Diode Roller',
    category: '303 Acid',
    builtIn: true,
    track: { synth: 'acid', vol: 0.54, pan: -0.08, cutoff: 0.42, res: 0.68, rev: 0.18, del: 0.28, sc: 'harm' },
    eq: { eqLow: 0.5, eqMid: 2.0, eqHigh: 1.5 },
  },
  {
    id: 'preset_303_screamer',
    name: 'TB-303 Warehouse Screamer',
    category: '303 Acid',
    builtIn: true,
    track: { synth: 'acid', vol: 0.48, pan: 0.12, cutoff: 0.64, res: 0.84, rev: 0.26, del: 0.36, sc: 'harm' },
    eq: { eqLow: -1.0, eqMid: 3.0, eqHigh: 2.5 },
  },
  {
    id: 'preset_dub_chord_tape',
    name: 'Basic Channel Tape Dub Chord',
    category: 'Harmony / Dub',
    builtIn: true,
    track: { synth: 'dubchord', vol: 0.44, pan: 0.1, cutoff: 0.38, res: 0.46, rev: 0.58, del: 0.68, sc: 'harm' },
    eq: { eqLow: 1.0, eqMid: -1.0, eqHigh: -1.5 },
  },
  {
    id: 'preset_ambient_horizon_pad',
    name: 'Ambient Horizon Silk Pad',
    category: 'Harmony / Dub',
    builtIn: true,
    track: { synth: 'pad', vol: 0.46, pan: 0, cutoff: 0.52, res: 0.28, rev: 0.65, del: 0.32, sc: 'harm' },
    eq: { eqLow: 1.5, eqMid: -0.5, eqHigh: 2.0 },
  },
  {
    id: 'preset_dark_fifth_drone',
    name: 'Cathedral Fifth Drone',
    category: 'Harmony / Dub',
    builtIn: true,
    track: { synth: 'drone', vol: 0.4, pan: 0, cutoff: 0.36, res: 0.34, rev: 0.62, del: 0.24, sc: 'harm' },
    eq: { eqLow: 2.0, eqMid: -1.5, eqHigh: -2.0 },
  },
  {
    id: 'preset_bronze_hat',
    name: 'Analog Bronze Hi-Hat',
    category: 'Groove / Perc',
    builtIn: true,
    track: { synth: 'hat', vol: 0.42, pan: 0.14, cutoff: 0.58, res: 0.32, rev: 0.14, del: 0.08, sc: null },
    eq: { eqLow: -2.0, eqMid: 0.0, eqHigh: 2.0 },
  },
  {
    id: 'preset_tribal_conga',
    name: 'Hypnotic Polyrhythm Conga',
    category: 'Groove / Perc',
    builtIn: true,
    track: { synth: 'conga', vol: 0.48, pan: -0.18, cutoff: 0.5, res: 0.35, rev: 0.22, del: 0.18, sc: null },
    eq: { eqLow: 1.0, eqMid: 1.5, eqHigh: 0.0 },
  },
  {
    id: 'preset_analog_riser_swell',
    name: 'Analog Filter Swell Riser',
    category: 'Transition / FX',
    builtIn: true,
    track: { synth: 'riser', vol: 0.44, pan: 0, cutoff: 0.52, res: 0.48, rev: 0.54, del: 0.24, sc: 'fx' },
    eq: { eqLow: 0.5, eqMid: 1.0, eqHigh: 1.5 },
  },
];

function sanitizePreset(raw: unknown): DevicePreset | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.name !== 'string' || !r.track || typeof r.track !== 'object') return null;
  const tr = r.track as Record<string, unknown>;
  const eq = (r.eq && typeof r.eq === 'object' ? r.eq : {}) as Record<string, unknown>;
  const synth = typeof tr.synth === 'string' ? (tr.synth as SynthKind) : 'acid';
  const scVal = tr.sc === 'bass' || tr.sc === 'harm' || tr.sc === 'fx' ? tr.sc : null;
  return {
    id: r.id,
    name: r.name.trim() || 'Untitled Preset',
    category:
      r.category === 'Foundation' ||
      r.category === '303 Acid' ||
      r.category === 'Harmony / Dub' ||
      r.category === 'Groove / Perc' ||
      r.category === 'Transition / FX' ||
      r.category === 'Custom'
        ? r.category
        : 'Custom',
    builtIn: Boolean(r.builtIn),
    track: {
      synth,
      vol: +clamp(Number(tr.vol ?? 0.5), 0, 1).toFixed(2),
      pan: +clamp(Number(tr.pan ?? 0), -1, 1).toFixed(2),
      cutoff: +clamp(Number(tr.cutoff ?? 0.5), 0, 1).toFixed(2),
      res: +clamp(Number(tr.res ?? 0.3), 0, 0.95).toFixed(2),
      rev: +clamp(Number(tr.rev ?? 0.2), 0, 1).toFixed(2),
      del: +clamp(Number(tr.del ?? 0.1), 0, 1).toFixed(2),
      sc: scVal,
    },
    eq: {
      eqLow: +clamp(Number(eq.eqLow ?? 0), -12, 12).toFixed(1),
      eqMid: +clamp(Number(eq.eqMid ?? 0), -12, 12).toFixed(1),
      eqHigh: +clamp(Number(eq.eqHigh ?? 0), -12, 12).toFixed(1),
    },
  };
}

export function loadUserDevicePresets(): DevicePreset[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(sanitizePreset).filter((p): p is DevicePreset => p !== null && !p.builtIn);
  } catch {
    return [];
  }
}

export function loadDevicePresets(): DevicePreset[] {
  return [...FACTORY_DEVICE_PRESETS, ...loadUserDevicePresets()];
}

export function saveDevicePreset(
  name: string,
  track: Pick<Track, 'synth' | 'vol' | 'pan' | 'cutoff' | 'res' | 'rev' | 'del' | 'sc'>,
  eq: { eqLow: number; eqMid: number; eqHigh: number },
  category: DevicePreset['category'] = 'Custom'
): DevicePreset {
  const cleanName = name.trim() || `${track.synth.toUpperCase()} Preset`;
  const userPresets = loadUserDevicePresets();
  const existingIdx = userPresets.findIndex((p) => p.name.toLowerCase() === cleanName.toLowerCase());
  const preset: DevicePreset = {
    id: existingIdx >= 0 ? userPresets[existingIdx].id : `user_preset_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: cleanName,
    category,
    builtIn: false,
    track: {
      synth: track.synth,
      vol: +clamp(track.vol, 0, 1).toFixed(2),
      pan: +clamp(track.pan, -1, 1).toFixed(2),
      cutoff: +clamp(track.cutoff, 0, 1).toFixed(2),
      res: +clamp(track.res, 0, 0.95).toFixed(2),
      rev: +clamp(track.rev, 0, 1).toFixed(2),
      del: +clamp(track.del, 0, 1).toFixed(2),
      sc: track.sc,
    },
    eq: {
      eqLow: +clamp(eq.eqLow, -12, 12).toFixed(1),
      eqMid: +clamp(eq.eqMid, -12, 12).toFixed(1),
      eqHigh: +clamp(eq.eqHigh, -12, 12).toFixed(1),
    },
  };
  if (existingIdx >= 0) {
    userPresets[existingIdx] = preset;
  } else {
    userPresets.push(preset);
  }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(userPresets));
    }
  } catch {
    /* ignore storage quota errors */
  }
  return preset;
}

export function deleteDevicePreset(id: string): DevicePreset[] {
  const next = loadUserDevicePresets().filter((p) => p.id !== id);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    }
  } catch {
    /* ignore */
  }
  return [...FACTORY_DEVICE_PRESETS, ...next];
}

export function applyDevicePresetToTrackPatch(preset: DevicePreset): Partial<Omit<Track, 'clips' | 'id'>> {
  return {
    synth: preset.track.synth,
    vol: preset.track.vol,
    pan: preset.track.pan,
    cutoff: preset.track.cutoff,
    res: preset.track.res,
    rev: preset.track.rev,
    del: preset.track.del,
    sc: preset.track.sc,
  };
}
