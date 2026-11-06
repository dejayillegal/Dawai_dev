import { describe, it, expect } from 'vitest';
import { generateAlsXml, exportProjectToAls, gzipString } from '../src/engine/alsExport';
import { newProject, defaultParams } from '../src/engine/composer';

describe('Ableton Live Set (.als) Export Engine', () => {
  it('generates valid Ableton Live XML with tracks, clips, and notes', () => {
    const p = newProject(defaultParams('hypnotic', 4321));
    const xml = generateAlsXml(p);

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<Ableton MajorVersion="5"');
    expect(xml).toContain('<LiveSet>');
    expect(xml).toContain(`<Manual Value="${p.params.bpm.toFixed(2)}"/>`);
    expect(xml).toContain('<Tracks>');
    expect(xml).toContain('<MidiTrack');
    expect(xml).toContain('<MidiClip');
    expect(xml).toContain('<MidiNote');
  });

  it('compresses the XML into a valid gzip blob for .als files', async () => {
    const p = newProject(defaultParams('acid', 888));
    const blob = await exportProjectToAls(p);

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/x-gzip');
    expect(blob.size).toBeGreaterThan(100);

    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    // Gzip magic numbers: 0x1F, 0x8B
    expect(bytes[0]).toBe(0x1f);
    expect(bytes[1]).toBe(0x8b);
  });

  it('handles gzip compression helper directly', async () => {
    const text = 'AIDAW Techno Digital Audio Workstation';
    const gzipped = await gzipString(text);
    expect(gzipped.length).toBeGreaterThan(10);
    expect(gzipped[0]).toBe(0x1f);
    expect(gzipped[1]).toBe(0x8b);
  });
});
