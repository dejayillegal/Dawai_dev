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

  it('saves, loads, applies, and deletes Device Rack presets including EQ, filter, and sends', async () => {
    const {
      loadDevicePresets,
      saveDevicePreset,
      deleteDevicePreset,
      applyDevicePresetToTrackPatch,
    } = await import('../src/engine/presets');

    const initial = loadDevicePresets();
    expect(initial.length).toBeGreaterThanOrEqual(10);

    const saved = saveDevicePreset(
      'Hypnotic Acid Vault',
      {
        synth: 'acid',
        vol: 0.62,
        pan: -0.12,
        cutoff: 0.58,
        res: 0.76,
        rev: 0.34,
        del: 0.42,
        sc: 'harm',
      },
      { eqLow: 1.5, eqMid: 2.5, eqHigh: -0.5 },
      'Custom'
    );

    expect(saved.name).toBe('Hypnotic Acid Vault');
    expect(saved.track.cutoff).toBe(0.58);
    expect(saved.track.res).toBe(0.76);
    expect(saved.track.rev).toBe(0.34);
    expect(saved.track.del).toBe(0.42);
    expect(saved.eq.eqMid).toBe(2.5);

    const patch = applyDevicePresetToTrackPatch(saved);
    expect(patch).toEqual({
      synth: 'acid',
      vol: 0.62,
      pan: -0.12,
      cutoff: 0.58,
      res: 0.76,
      rev: 0.34,
      del: 0.42,
      sc: 'harm',
    });

    const afterDelete = deleteDevicePreset(saved.id);
    expect(afterDelete.some((p) => p.id === saved.id)).toBe(false);
  });

  it('computes step-aligned Piano Roll synth waveform slices and envelopes for active MIDI clips', async () => {
    const { computeAnalyticalClipWaveform } = await import('../src/engine/clipWaveform');
    const wave = computeAnalyticalClipWaveform(
      { synth: 'acid', cutoff: 0.55, res: 0.75, vol: 0.8 },
      {
        loop: 16,
        gain: 1.0,
        transpose: 0,
        notes: [
          { t: 0, d: 2, p: 45, v: 0.9, acc: true },
          { t: 4, d: 2, p: 57, v: 0.8, slide: true },
        ],
      },
      132,
      16
    );
    expect(wave.totalSteps).toBe(16);
    expect(wave.binsPerStep).toBe(16);
    expect(wave.min.length).toBe(256);
    expect(wave.max.length).toBe(256);
    expect(wave.rms.length).toBe(256);
    expect(wave.noteSlices.length).toBe(2);
    // Verify active waveform energy exists at step 0 (bins 0..31) and step 4 (bins 64..95)
    const energyAtStep0 = wave.rms.slice(0, 16).reduce((a, b) => a + b, 0);
    const energyAtStep4 = wave.rms.slice(64, 80).reduce((a, b) => a + b, 0);
    expect(energyAtStep0).toBeGreaterThan(0.1);
    expect(energyAtStep4).toBeGreaterThan(0.1);
  });
});

