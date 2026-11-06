import type { Project } from './types';
import { totalBars, STEPS_PER_BAR } from './types';
import { expandTrackEvents } from './musicalEvents';
import { clamp } from './theory';

export const TICKS_PER_BEAT = 480;
export const TICKS_PER_STEP = TICKS_PER_BEAT / 4; // 120 ticks per 16th step

function writeVarLen(val: number): number[] {
  let buffer = val & 0x7f;
  const bytes: number[] = [];
  while ((val >>= 7)) {
    buffer <<= 8;
    buffer |= (val & 0x7f) | 0x80;
  }
  while (true) {
    bytes.push(buffer & 0xff);
    if (buffer & 0x80) buffer >>= 8;
    else break;
  }
  return bytes;
}

function writeString(str: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    bytes.push(str.charCodeAt(i) & 0xff);
  }
  return bytes;
}

function writeInt32(n: number): number[] {
  return [(n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function writeInt16(n: number): number[] {
  return [(n >> 8) & 0xff, n & 0xff];
}

interface MidiTimelineEvent {
  tick: number;
  type: 'on' | 'off';
  note: number;
  velocity: number;
  channel: number;
}

function buildMidiTrack(name: string, events: MidiTimelineEvent[]): Uint8Array {
  // Sort timeline events chronologically. For identical ticks, note-off goes before note-on.
  events.sort((a, b) => a.tick - b.tick || (a.type === 'off' ? -1 : 1));

  const data: number[] = [];

  // Track name event (delta 0, 0xFF 0x03, len, bytes)
  const nameBytes = writeString(name);
  data.push(0x00, 0xff, 0x03, ...writeVarLen(nameBytes.length), ...nameBytes);

  let lastTick = 0;
  for (const ev of events) {
    const delta = Math.max(0, Math.round(ev.tick - lastTick));
    data.push(...writeVarLen(delta));
    lastTick = ev.tick;

    const ch = ev.channel & 0x0f;
    const pitch = clamp(Math.round(ev.note), 0, 127);
    if (ev.type === 'on') {
      const vel = clamp(Math.round(ev.velocity), 1, 127);
      data.push(0x90 | ch, pitch, vel);
    } else {
      data.push(0x80 | ch, pitch, 0x00);
    }
  }

  // End of track meta event (delta 0, 0xFF 0x2F 0x00)
  data.push(0x00, 0xff, 0x2f, 0x00);

  const out: number[] = [];
  // 'MTrk' header
  out.push(0x4d, 0x54, 0x72, 0x6b);
  out.push(...writeInt32(data.length));
  out.push(...data);
  return new Uint8Array(out);
}

function buildConductorTrack(project: Project): Uint8Array {
  const data: number[] = [];
  const nameBytes = writeString(project.name || 'Conductor');
  data.push(0x00, 0xff, 0x03, ...writeVarLen(nameBytes.length), ...nameBytes);

  // Time signature: 4/4 (numerator 4, denominator 2^2=4, 24 MIDI clocks/click, 8 32nd notes/quarter)
  data.push(0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08);

  // Tempo: microseconds per beat
  const usPerBeat = Math.round(60000000 / project.params.bpm);
  data.push(
    0x00,
    0xff,
    0x51,
    0x03,
    (usPerBeat >> 16) & 0xff,
    (usPerBeat >> 8) & 0xff,
    usPerBeat & 0xff
  );

  // End of track
  data.push(0x00, 0xff, 0x2f, 0x00);

  const out: number[] = [];
  out.push(0x4d, 0x54, 0x72, 0x6b);
  out.push(...writeInt32(data.length));
  out.push(...data);
  return new Uint8Array(out);
}

export function exportProjectToMidi(project: Project, targetTrackId?: string): Blob {
  const tracksToExport = targetTrackId
    ? project.tracks.filter((t) => t.id === targetTrackId)
    : project.tracks.filter((t) => t.clips.length > 0);

  const totalSteps = totalBars(project) * STEPS_PER_BAR;
  const trackBuffers: Uint8Array[] = [];

  // Track 0 is the conductor track (tempo & meter)
  trackBuffers.push(buildConductorTrack(project));

  // Determine drum instruments for General MIDI channel 10 (ch 9 in 0-indexed)
  const drumSynths = new Set(['kick', 'hat', 'ohat', 'ride', 'shaker', 'clap', 'snare', 'perc', 'conga', 'tom']);

  let melodicChannel = 0;
  for (let idx = 0; idx < tracksToExport.length; idx++) {
    const track = tracksToExport[idx];
    const isDrum = drumSynths.has(track.synth);
    let ch = isDrum ? 9 : melodicChannel;
    if (!isDrum) {
      melodicChannel = (melodicChannel + 1) % 16;
      if (melodicChannel === 9) melodicChannel = 10;
    }

    const events = expandTrackEvents(track, project.params, 0, totalSteps, false);
    const timelineEvents: MidiTimelineEvent[] = [];

    for (const ev of events) {
      const onTick = Math.round(ev.startStep * TICKS_PER_STEP);
      const offTick = Math.max(onTick + 1, Math.round((ev.startStep + ev.durationSteps) * TICKS_PER_STEP));
      const vel = clamp(Math.round(ev.note.v * 127), 1, 127);

      timelineEvents.push({
        tick: onTick,
        type: 'on',
        note: ev.note.p,
        velocity: vel,
        channel: ch,
      });

      timelineEvents.push({
        tick: offTick,
        type: 'off',
        note: ev.note.p,
        velocity: 0,
        channel: ch,
      });
    }

    trackBuffers.push(buildMidiTrack(track.name || `Track ${idx + 1}`, timelineEvents));
  }

  // Header chunk 'MThd'
  const header: number[] = [];
  header.push(0x4d, 0x54, 0x68, 0x64); // 'MThd'
  header.push(...writeInt32(6));       // header length = 6
  header.push(...writeInt16(1));       // format 1 (multiple tracks)
  header.push(...writeInt16(trackBuffers.length)); // number of tracks
  header.push(...writeInt16(TICKS_PER_BEAT));      // division = 480 ppq

  const totalLength = header.length + trackBuffers.reduce((acc, b) => acc + b.length, 0);
  const out = new Uint8Array(totalLength);
  out.set(new Uint8Array(header), 0);

  let offset = header.length;
  for (const tb of trackBuffers) {
    out.set(tb, offset);
    offset += tb.length;
  }

  return new Blob([out], { type: 'audio/midi' });
}
