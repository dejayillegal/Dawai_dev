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

export function applyTheme(theme: ThemePreset) {
  if (typeof document === 'undefined') return;
  const color = THEME_COLORS[theme] || THEME_COLORS.amber;
  document.documentElement.style.setProperty('--color-amber', color);
  document.documentElement.setAttribute('data-theme', theme);
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

