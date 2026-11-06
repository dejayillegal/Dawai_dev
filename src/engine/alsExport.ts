import type { Project, Note } from './types';
import { clamp } from './theory';

export async function gzipString(text: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const bytes = enc.encode(text);
  if (typeof CompressionStream !== 'undefined') {
    const cs = new CompressionStream('gzip');
    const writer = cs.writable.getWriter();
    writer.write(bytes);
    writer.close();
    const reader = cs.readable.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    const total = chunks.reduce((acc, c) => acc + c.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  }
  // Fallback: return raw bytes if CompressionStream is absent
  return bytes;
}

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

export function generateAlsXml(project: Project): string {
  const bpm = project.params.bpm || 120;

  let trackXml = '';
  let trackIdCounter = 10;
  let clipIdCounter = 100;

  for (const track of project.tracks) {
    const trackId = trackIdCounter++;
    const trackName = escapeXml(track.name || `Track ${trackId}`);
    const colorInt = 13; // default Ableton color index

    let clipsXml = '';
    for (const clip of track.clips) {
      const clipId = clipIdCounter++;
      const clipName = escapeXml(clip.label || 'Clip');
      const startBeat = clip.start * 4;
      const endBeat = (clip.start + clip.len) * 4;
      const loopLenBeats = (clip.loop / 4);

      // Group notes by pitch
      const pitchMap = new Map<number, Note[]>();
      for (const note of clip.notes) {
        if (note.v <= 0) continue;
        const p = clamp(Math.round(note.p + clip.transpose), 0, 127);
        const list = pitchMap.get(p) ?? [];
        list.push(note);
        pitchMap.set(p, list);
      }

      let keyTracksXml = '';
      let keyTrackId = 1;
      for (const [pitch, notes] of pitchMap.entries()) {
        let notesXml = '';
        for (const n of notes) {
          const noteStart = n.t / 4;
          const noteDur = Math.max(0.05, (n.d * 0.98) / 4);
          const vel = clamp(Math.round(n.v * clip.gain * 127), 1, 127);
          notesXml += `
                  <MidiNote Time="${noteStart.toFixed(4)}" Duration="${noteDur.toFixed(4)}" Velocity="${vel}" OffVelocity="64" Probability="${n.prob !== undefined ? n.prob : 1.0}"/>`;
        }

        keyTracksXml += `
              <KeyTrack Id="${keyTrackId++}">
                <MidiKey Value="${pitch}"/>
                <Notes>${notesXml}
                </Notes>
              </KeyTrack>`;
      }

      clipsXml += `
            <MidiClip Id="${clipId}" Time="${startBeat.toFixed(4)}">
              <LomId Value="0"/>
              <CurrentStart Value="${startBeat.toFixed(4)}"/>
              <CurrentEnd Value="${endBeat.toFixed(4)}"/>
              <Loop>
                <LoopStart Value="0"/>
                <LoopEnd Value="${loopLenBeats.toFixed(4)}"/>
                <StartRelative Value="0"/>
                <LoopOn Value="true"/>
                <HiddenLoopStart Value="0"/>
                <HiddenLoopEnd Value="${loopLenBeats.toFixed(4)}"/>
              </Loop>
              <Name Value="${clipName}"/>
              <Notes>
                <KeyTracks>${keyTracksXml}
                </KeyTracks>
              </Notes>
            </MidiClip>`;
    }

    trackXml += `
        <MidiTrack Id="${trackId}">
          <LomId Value="0"/>
          <Name>
            <EffectiveName Value="${trackName}"/>
            <UserName Value="${trackName}"/>
          </Name>
          <Color Value="${colorInt}"/>
          <DeviceChain>
            <MainSequencer>
              <LomId Value="0"/>
              <ClipTimeable>
                <ArrangerAutomation>
                  <Events>${clipsXml}
                  </Events>
                </ArrangerAutomation>
              </ClipTimeable>
            </MainSequencer>
          </DeviceChain>
        </MidiTrack>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="5" MinorVersion="11.0_432" SchemaChangeCount="3" Creator="Ableton Live 11.2" Revision="a33c025000">
  <LiveSet>
    <NextPatcherId Value="1"/>
    <MasterTrack>
      <LomId Value="0"/>
      <Name>
        <EffectiveName Value="Master"/>
      </Name>
    </MasterTrack>
    <Tracks>${trackXml}
    </Tracks>
    <Transport>
      <Tempo>
        <Manual Value="${bpm.toFixed(2)}"/>
      </Tempo>
    </Transport>
  </LiveSet>
</Ableton>`;
}

export async function exportProjectToAls(project: Project): Promise<Blob> {
  const xml = generateAlsXml(project);
  const gzipped = await gzipString(xml);
  return new Blob([new Uint8Array(gzipped).buffer as ArrayBuffer], { type: 'application/x-gzip' });
}
