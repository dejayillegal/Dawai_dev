import { describe, it, expect, vi } from 'vitest';
import { settingsStore, playMetronomeClick, applyTheme, DEFAULT_SETTINGS } from '../src/engine/settings';

describe('Settings & Metronome Engine', () => {
  it('initializes with default settings and updates preferences reactively', () => {
    expect(settingsStore.get().metronome).toBe(false);
    expect(settingsStore.get().theme).toBe('amber');

    let notifications = 0;
    const unsubscribe = settingsStore.subscribe(() => {
      notifications++;
    });

    settingsStore.set({ metronome: true, theme: 'cyan' });
    expect(settingsStore.get().metronome).toBe(true);
    expect(settingsStore.get().theme).toBe('cyan');
    expect(notifications).toBe(1);

    settingsStore.reset();
    expect(settingsStore.get().metronome).toBe(DEFAULT_SETTINGS.metronome);
    expect(settingsStore.get().theme).toBe(DEFAULT_SETTINGS.theme);
    expect(notifications).toBe(2);

    unsubscribe();
  });

  it('triggers sample-accurate metronome click without throwing audio errors', () => {
    const oscNode = {
      type: 'sine',
      frequency: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };

    const gainNode = {
      gain: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
    };

    const mockCtx = {
      currentTime: 10,
      destination: {},
      createOscillator: () => oscNode,
      createGain: () => gainNode,
    } as unknown as BaseAudioContext;

    // Normal beat click (800 Hz)
    playMetronomeClick(mockCtx, 10.5, false, 0.8);
    expect(oscNode.frequency.setValueAtTime).toHaveBeenCalledWith(800, 10.5);
    expect(oscNode.start).toHaveBeenCalledWith(10.5);

    // Accent beat click (1200 Hz)
    playMetronomeClick(mockCtx, 11.0, true, 0.8);
    expect(oscNode.frequency.setValueAtTime).toHaveBeenCalledWith(1200, 11.0);
    expect(oscNode.start).toHaveBeenCalledWith(11.0);
  });

  it('updates DOM attributes and CSS variables when theme is changed', () => {
    const properties = new Map<string, string>();
    const attributes = new Map<string, string>();
    const mockDoc = {
      documentElement: {
        style: {
          setProperty: (k: string, v: string) => properties.set(k, v),
          getPropertyValue: (k: string) => properties.get(k),
        },
        setAttribute: (k: string, v: string) => attributes.set(k, v),
        getAttribute: (k: string) => attributes.get(k),
      },
    };

    const origDoc = globalThis.document;
    try {
      (globalThis as unknown as { document: typeof mockDoc }).document = mockDoc;
      applyTheme('emerald');
      expect(attributes.get('data-theme')).toBe('emerald');
      expect(properties.get('--color-amber')).toBe('#10b981');

      applyTheme('violet');
      expect(attributes.get('data-theme')).toBe('violet');
      expect(properties.get('--color-amber')).toBe('#8b5cf6');
    } finally {
      (globalThis as unknown as { document: typeof origDoc }).document = origDoc;
    }
  });
});
