import { describe, it, expect } from 'vitest';
import { exportProjectToMidi, exportClipToMidi, TICKS_PER_BEAT } from '../src/engine/midiExport';
import { newProject, defaultParams } from '../src/engine/composer';

describe('MIDI Export Engine', () => {
  it('generates a valid standard Type 1 MIDI file with MThd header', async () => {
    const p = newProject(defaultParams('hypnotic', 12345));
    const blob = exportProjectToMidi(p);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('audio/midi');
    expect(blob.size).toBeGreaterThan(64);

    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);

    // Header tag 'MThd'
    const headerTag = String.fromCharCode(...bytes.slice(0, 4));
    expect(headerTag).toBe('MThd');

    // Header length 6
    const headerLen = (bytes[4] << 24) | (bytes[5] << 16) | (bytes[6] << 8) | bytes[7];
    expect(headerLen).toBe(6);

    // Format 1 (multi-track)
    const format = (bytes[8] << 8) | bytes[9];
    expect(format).toBe(1);

    // Track count >= 2 (1 conductor + at least 1 track)
    const numTracks = (bytes[10] << 8) | bytes[11];
    expect(numTracks).toBeGreaterThanOrEqual(2);

    // Division 480 PPQ
    const division = (bytes[12] << 8) | bytes[13];
    expect(division).toBe(TICKS_PER_BEAT);

    // Check for MTrk tag at byte 14
    const firstTrackTag = String.fromCharCode(...bytes.slice(14, 18));
    expect(firstTrackTag).toBe('MTrk');
  });

  it('exports an individual track with specific track targeting', async () => {
    const p = newProject(defaultParams('raw', 999));
    const targetTrack = p.tracks.find((t) => t.clips.length > 0);
    expect(targetTrack).toBeDefined();

    const blob = exportProjectToMidi(p, targetTrack!.id);
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);

    const numTracks = (bytes[10] << 8) | bytes[11];
    // 1 conductor + 1 targeted track = 2 tracks
    expect(numTracks).toBe(2);
  });

  it('exports a single clip as standard MIDI with notes', async () => {
    const p = newProject(defaultParams('acid', 777));
    const targetTrack = p.tracks.find((t) => t.clips.some((c) => c.notes.length > 0));
    expect(targetTrack).toBeDefined();
    const clip = targetTrack!.clips.find((c) => c.notes.length > 0)!;

    const blob = exportClipToMidi(p, targetTrack!, clip);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('audio/midi');

    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const headerTag = String.fromCharCode(...bytes.slice(0, 4));
    expect(headerTag).toBe('MThd');
    const numTracks = (bytes[10] << 8) | bytes[11];
    expect(numTracks).toBe(2);
  });

  it('exports SMF Type 1 MIDI via the q3 generator alias', async () => {
    const { q3 } = await import('../src/engine/midiExport');
    const p = newProject(defaultParams('hypnotic', 404));
    const blob = q3(p);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('audio/midi');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('MThd');
    expect((bytes[8] << 8) | bytes[9]).toBe(1);
  });
});

