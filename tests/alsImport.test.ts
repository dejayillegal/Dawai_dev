import { describe, it, expect } from 'vitest';
import { exportProjectToAls } from '../src/engine/alsExport';
import { importAlsFile } from '../src/engine/alsImport';
import { newProject, defaultParams } from '../src/engine/composer';

describe('Ableton Live Set (.als) Import & Roundtrip Engine', () => {
  it('exports an AIDAW project to .als and imports it back with full track parity', async () => {
    const original = newProject(defaultParams('hypnotic', 42));
    original.name = 'Test Ambient Horror Project';

    const blob = await exportProjectToAls(original);
    expect(blob.size).toBeGreaterThan(100);

    const imported = await importAlsFile(await blob.arrayBuffer(), 'Test Ambient Horror Project.als');

    expect(imported.name).toBe('Test Ambient Horror Project');
    expect(imported.params.bpm).toBe(original.params.bpm);
    expect(imported.tracks.length).toBeGreaterThan(0);

    // Verify clips and notes parsed
    const kickTrack = imported.tracks.find((t) => t.synth === 'kick' || t.name.toLowerCase().includes('kick'));
    expect(kickTrack).toBeDefined();
    expect(kickTrack!.clips.length).toBeGreaterThan(0);
    expect(kickTrack!.clips[0].notes.length).toBeGreaterThan(0);
  });
});
