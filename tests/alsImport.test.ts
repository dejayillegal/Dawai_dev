import { describe, it, expect } from 'vitest';
import { exportProjectToAls, gzipString } from '../src/engine/alsExport';
import { importAlsFile } from '../src/engine/alsImport';
import { newProject, defaultParams } from '../src/engine/composer';
import { assertProject } from '../src/engine/validation';
import { store } from '../src/store';

describe('Ableton Live Set (.als) Import & Roundtrip Engine', () => {
  it('exports an AIDAW project to .als and imports it back passing assertProject and store.replaceProject', async () => {
    const original = newProject(defaultParams('hypnotic', 42));
    original.name = 'Test Ambient Horror Project';

    const blob = await exportProjectToAls(original);
    expect(blob.size).toBeGreaterThan(100);

    const imported = await importAlsFile(await blob.arrayBuffer(), 'Test Ambient Horror Project.als');

    expect(() => assertProject(imported)).not.toThrow();
    expect(() => store.replaceProject(imported)).not.toThrow();
    expect(imported.name).toBe('Test Ambient Horror Project');
    expect(imported.params.bpm).toBe(original.params.bpm);
    expect(imported.tracks.length).toBeGreaterThan(0);

    // Verify clips and notes parsed
    const kickTrack = imported.tracks.find((t) => t.synth === 'kick' || t.name.toLowerCase().includes('kick'));
    expect(kickTrack).toBeDefined();
    expect(kickTrack!.clips.length).toBeGreaterThan(0);
    expect(kickTrack!.clips[0].notes.length).toBeGreaterThan(0);
  });

  it('imports native Ableton Live 11/12 <MidiNoteEvent> and Session View clips cleanly', async () => {
    const live11Xml = `<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="5" MinorVersion="11.0_432" Creator="Ableton Live 11.3">
  <LiveSet>
    <Tracks>
      <MidiTrack Id="1">
        <Name><EffectiveName Value="303 Acid Line"/><UserName Value="Dark 303 Acid"/></Name>
        <DeviceChain>
          <MainSequencer>
            <ClipSlotList>
              <ClipSlot Id="0">
                <ClipSlot><Value>
                  <MidiClip Id="10" Time="0">
                    <Name Value="Acid Session Clip"/>
                    <Loop><LoopStart Value="0"/><LoopEnd Value="8"/></Loop>
                    <Notes>
                      <KeyTracks>
                        <KeyTrack Id="1">
                          <MidiKey Value="36"/>
                          <Notes>
                            <MidiNoteEvent Time="0.0" Duration="0.25" Velocity="118" IsEnabled="true"/>
                            <MidiNoteEvent Time="0.5" Duration="0.5" Velocity="96" IsEnabled="true"/>
                            <MidiNoteEvent Time="1.25" Duration="0.25" Velocity="124" IsEnabled="false"/>
                          </Notes>
                        </KeyTrack>
                      </KeyTracks>
                    </Notes>
                  </MidiClip>
                </Value></ClipSlot>
              </ClipSlot>
            </ClipSlotList>
          </MainSequencer>
        </DeviceChain>
      </MidiTrack>
    </Tracks>
    <Transport><Tempo><Manual Value="138"/></Tempo></Transport>
  </LiveSet>
</Ableton>`;
    const gz = await gzipString(live11Xml);
    const imported = await importAlsFile(gz.buffer as ArrayBuffer, 'Warehouse_Live11.als');
    expect(() => assertProject(imported)).not.toThrow();
    expect(imported.params.bpm).toBe(138);
    expect(imported.tracks[0].synth).toBe('acid');
    expect(imported.tracks[0].clips[0].loop).toBe(32); // 8 beats * 4 steps/beat
    expect(imported.tracks[0].clips[0].notes.length).toBe(2); // Disabled note skipped
  });
});

