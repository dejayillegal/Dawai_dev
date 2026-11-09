import { useEffect, useState } from 'react';

export type ThemePreset = 'amber' | 'cyan' | 'emerald' | 'violet' | 'crimson' | 'obsidian';
export type LatencyTarget = 'low' | 'balanced' | 'stable';

export interface AppSettings {
  metronome: boolean;
  metronomeVol: number;
  theme: ThemePreset;
  latencyTarget: LatencyTarget;
  limiterCeiling: number; // dBFS (-6.0 to 0.0)
  analogWarmth: number; // 0.0 to 1.0
  eqLow: number; // dB (-12 to +12) at 110 Hz lowshelf
  eqMid: number; // dB (-12 to +12) at 1.0 kHz peaking
  eqHigh: number; // dB (-12 to +12) at 6.5 kHz highshelf
  microDrift: boolean;
  defaultRowH: 24 | 32 | 44;
  defaultBpm: number;
  autoFollow: boolean;
  snapResolution: number; // 1 (1/16), 0.5 (1/32), 0.25 (1/64), 0 (Off)
}

export const DEFAULT_SETTINGS: AppSettings = {
  metronome: false,
  metronomeVol: 0.7,
  theme: 'amber',
  latencyTarget: 'low',
  limiterCeiling: -4.0,
  analogWarmth: 0.35,
  eqLow: 0,
  eqMid: 0,
  eqHigh: 0,
  microDrift: true,
  defaultRowH: 32,
  defaultBpm: 130,
  autoFollow: true,
  snapResolution: 1,
};

const STORAGE_KEY = 'aidaw_settings_v1';

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch {
    // Ignore storage errors
  }
  return DEFAULT_SETTINGS;
}

function saveSettings(s: AppSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Ignore storage errors
  }
}

export const THEME_COLORS: Record<ThemePreset, string> = {
  amber: '#f59e0b',
  cyan: '#06b6d4',
  emerald: '#10b981',
  violet: '#8b5cf6',
  crimson: '#ef4444',
  obsidian: '#6366f1',
};

export interface ThemePalette {
  accent: string;
  secondary: string;
  onAccent: string;
  textBright: string;
  textMain: string;
  textMuted: string;
  bg: string;
  panel: string;
  elev: string;
  line: string;
}

export const THEME_PALETTES: Record<ThemePreset, ThemePalette> = {
  amber: {
    accent: '#f59e0b',
    secondary: '#06b6d4',
    onAccent: '#090b0e',
    textBright: '#fef3c7',
    textMain: '#e2e8f0',
    textMuted: '#94a3b8',
    bg: '#0b0d10',
    panel: '#12161b',
    elev: '#1b2128',
    line: '#262e38',
  },
  cyan: {
    accent: '#06b6d4',
    secondary: '#f59e0b',
    onAccent: '#041318',
    textBright: '#cffafe',
    textMain: '#dbeafe',
    textMuted: '#7dd3fc',
    bg: '#080e13',
    panel: '#0f171e',
    elev: '#16222c',
    line: '#213342',
  },
  emerald: {
    accent: '#10b981',
    secondary: '#06b6d4',
    onAccent: '#03140e',
    textBright: '#d1fae5',
    textMain: '#dcfce7',
    textMuted: '#6ee7b7',
    bg: '#08100d',
    panel: '#0e1915',
    elev: '#15251f',
    line: '#20382f',
  },
  violet: {
    accent: '#8b5cf6',
    secondary: '#22d3ee',
    onAccent: '#ffffff',
    textBright: '#f3e8ff',
    textMain: '#e9d5ff',
    textMuted: '#c084fc',
    bg: '#0c0914',
    panel: '#141020',
    elev: '#1e1830',
    line: '#2e2546',
  },
  crimson: {
    accent: '#ef4444',
    secondary: '#fb923c',
    onAccent: '#ffffff',
    textBright: '#ffe4e6',
    textMain: '#fecdd3',
    textMuted: '#fda4af',
    bg: '#11090c',
    panel: '#1a1014',
    elev: '#25171d',
    line: '#38222b',
  },
  obsidian: {
    accent: '#6366f1',
    secondary: '#38bdf8',
    onAccent: '#ffffff',
    textBright: '#e0e7ff',
    textMain: '#c7d2fe',
    textMuted: '#94a3b8',
    bg: '#07090e',
    panel: '#0d111a',
    elev: '#151b28',
    line: '#222b3d',
  },
};

export function applyTheme(theme: ThemePreset) {
  if (typeof document === 'undefined') return;
  const pal = THEME_PALETTES[theme] || THEME_PALETTES.amber;
  const root = document.documentElement;
  root.style.setProperty('--color-amber', pal.accent);
  root.style.setProperty('--color-cyan', pal.secondary);
  root.style.setProperty('--color-on-amber', pal.onAccent);
  root.style.setProperty('--color-text-bright', pal.textBright);
  root.style.setProperty('--color-text-main', pal.textMain);
  root.style.setProperty('--color-text-muted', pal.textMuted);
  root.style.setProperty('--color-bg', pal.bg);
  root.style.setProperty('--color-panel', pal.panel);
  root.style.setProperty('--color-elev', pal.elev);
  root.style.setProperty('--color-line', pal.line);
  root.setAttribute('data-theme', theme);
}

class SettingsManager {
  private s: AppSettings = loadSettings();
  private subs = new Set<() => void>();

  constructor() {
    applyTheme(this.s.theme);
  }

  get = (): AppSettings => this.s;

  set = (patch: Partial<AppSettings>) => {
    this.s = { ...this.s, ...patch };
    saveSettings(this.s);
    if (patch.theme) {
      applyTheme(patch.theme);
    }
    this.subs.forEach((fn) => fn());
  };

  subscribe = (fn: () => void) => {
    this.subs.add(fn);
    return () => {
      this.subs.delete(fn);
    };
  };

  reset = () => {
    this.s = { ...DEFAULT_SETTINGS };
    saveSettings(this.s);
    applyTheme(this.s.theme);
    this.subs.forEach((fn) => fn());
  };
}

export const settingsStore = new SettingsManager();

export function useSettings(): AppSettings {
  const [s, setS] = useState(settingsStore.get());
  useEffect(() => settingsStore.subscribe(() => setS(settingsStore.get())), []);
  return s;
}

/** Sample-accurate metronome click generator */
export function playMetronomeClick(ctx: BaseAudioContext, time: number, isAccent: boolean, vol = 0.7) {
  try {
    if (time < ctx.currentTime - 0.05) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    const freq = isAccent ? 1200 : 800;
    osc.frequency.setValueAtTime(freq, time);
    osc.frequency.exponentialRampToValueAtTime(isAccent ? 300 : 200, time + 0.025);
    const gainVal = Math.max(0.01, Math.min(1.0, vol)) * (isAccent ? 0.35 : 0.2);
    gain.gain.setValueAtTime(gainVal, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.03);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.035);
  } catch {
    // Ignore audio context exceptions
  }
}

