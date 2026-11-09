import type { Note, Project, Track, Clip, AutoLane } from './types';
import { totalBars } from './types';
import { defaultParams, newProject } from './composer';
import { LAYERS } from './styles';
import { clamp, uid } from './theory';
import { assertProject } from './validation';

export async function decompressGzipIfNeeded(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    if (typeof DecompressionStream !== 'undefined') {
      try {
        const ds = new DecompressionStream('gzip');
        const blob = new Blob([bytes]);
        const stream = blob.stream().pipeThrough(ds);
        return await new Response(stream).text();
      } catch {
        // Fallback to manual writer if blob.stream() fails in environment
        try {
          const ds = new DecompressionStream('gzip');
          const writer = ds.writable.getWriter();
          void writer.write(bytes);
          void writer.close();
          return await new Response(ds.readable).text();
        } catch {
          // Fallback below
        }
      }
    }
  }
  const decoder = new TextDecoder('utf-8');
  return decoder.decode(buffer);
}

function extractAttr(tagStr: string, attrName: string): string | null {
  const match = tagStr.match(new RegExp(`\\b${attrName}="([^"]*)"`, 'i'));
  return match ? match[1] : null;
}

function unescapeXml(str: string): string {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/** Map track names to matching AIDAW layer definitions */
function matchLayerByTrackName(trackName: string, index: number): string {
  const n = trackName.toLowerCase();
  if (n.includes('kick') || n.includes('bd')) return 'KICK';
  if (n.includes('sub')) return 'SUB';
  if (n.includes('rumble')) return 'RUMBLE';
  if (n.includes('midbass') || n.includes('bass')) return 'MIDBASS';
  if (n.includes('acid') || n.includes('303')) return 'ACID1';
  if (n.includes('stab') || n.includes('chord')) return 'STAB';
  if (n.includes('lead') || n.includes('synth')) return 'LEAD';
  if (n.includes('arp') || n.includes('pluck') || n.includes('seq')) return 'ARP';
  if (n.includes('pad') || n.includes('strings') || n.includes('choir')) return 'PAD';
  if (n.includes('dub')) return 'DUB';
  if (n.includes('drone') || n.includes('atmos')) return 'DRONE';
  if (n.includes('conga') || n.includes('tribal') || n.includes('bongo')) return 'CONGA';
  if (n.includes('tom')) return 'TOM';
  if (n.includes('clang') || n.includes('metal') || n.includes('anvil')) return 'CLANG';
  if (n.includes('open hat') || n.includes('ohat') || n.includes('oh')) return 'HAT_O';
  if (n.includes('hat') || n.includes('hh') || n.includes('ch')) return 'HAT_C';
  if (n.includes('ride') || n.includes('cymbal')) return 'RIDE';
  if (n.includes('shaker') || n.includes('maraca')) return 'SHAKER';
  if (n.includes('snare') || n.includes('sd')) return 'SNARE';
  if (n.includes('clap') || n.includes('cp')) return 'CLAP';
  if (n.includes('riser') || n.includes('uplift')) return 'RISER';
  if (n.includes('impact') || n.includes('boom')) return 'IMPACT';
  if (n.includes('downlift') || n.includes('fall')) return 'DOWNLIFT';
  if (n.includes('crash')) return 'CRASH';
  if (n.includes('perc') || n.includes('drum')) return 'PERC1';

  const defaultOrder = ['KICK', 'SUB', 'HAT_C', 'ACID1', 'ARP', 'STAB', 'PERC1', 'PAD', 'SNARE', 'CLAP', 'TOM', 'CONGA', 'DRONE', 'LEAD'];
  return defaultOrder[index % defaultOrder.length];
}

export async function importAlsFile(buffer: ArrayBuffer, fileName = 'Imported_Live_Set'): Promise<Project> {
  const xml = await decompressGzipIfNeeded(buffer);
  if (!xml || (!xml.includes('<Ableton') && !xml.includes('<LiveSet') && !xml.includes('<MidiTrack'))) {
    throw new Error('File is not a valid Ableton Live Set (.als) XML or GZIP archive.');
  }

  // Parse Master Tempo (supports Live 9/10/11/12 <Tempo><Manual Value="..."/> and <FloatEvent Value="..."/>)
  let bpm = 130;
  const tempoMatch =
    xml.match(/<Tempo>\s*<Manual\s+Value="([^"]+)"/i) ||
    xml.match(/<Tempo>\s*<LomId[^>]*>\s*<Manual\s+Value="([^"]+)"/i) ||
    xml.match(/<Tempo[^>]*Value="([^"]+)"/i);
  if (tempoMatch) {
    const val = parseFloat(tempoMatch[1]);
    if (Number.isFinite(val) && val >= 40 && val <= 240) bpm = Math.round(val * 100) / 100;
  }

  const p = newProject({ ...defaultParams('hypnotic', 1337), bpm: clamp(Math.round(bpm), 60, 200) });
  p.name = (fileName.replace(/\.als$/i, '').replace(/_/g, ' ').trim() || 'Imported Live Set').slice(0, 120);

  const midiTrackBlocks = xml.split(/<MidiTrack\b/i).slice(1);
  if (!midiTrackBlocks.length) {
    return p;
  }

  const tracks: Track[] = [];
  let maxBarSeen = 16;

  midiTrackBlocks.slice(0, 64).forEach((block, idx) => {
    const fullBlock = `<MidiTrack ${block.split('</MidiTrack>')[0]}</MidiTrack>`;
    let name = `Track ${idx + 1}`;

    const userNameMatch = fullBlock.match(/<Name>[\s\S]*?<UserName\s+Value="([^"]+)"/i);
    const effNameMatch = fullBlock.match(/<Name>[\s\S]*?<EffectiveName\s+Value="([^"]+)"/i);
    if (userNameMatch && userNameMatch[1].trim()) {
      name = unescapeXml(userNameMatch[1].trim());
    } else if (effNameMatch && effNameMatch[1].trim()) {
      name = unescapeXml(effNameMatch[1].trim());
    }

    const layerId = matchLayerByTrackName(name, idx);
    const lDef = LAYERS[layerId] || LAYERS.KICK;
    const trkId = uid('track');
    const clips: Clip[] = [];

    const clipBlocks = fullBlock.split(/<MidiClip\b/i).slice(1);
    let sessionSlotOffsetBar = 0;

    clipBlocks.forEach((cBlock, clipIdx) => {
      const cFull = `<MidiClip ${cBlock.split('</MidiClip>')[0]}</MidiClip>`;
      const timeAttr = extractAttr(cFull, 'Time');
      const currentStartMatch = cFull.match(/<CurrentStart\s+Value="([^"]+)"/i);
      const rawStartBeat =
        timeAttr !== null && Number.isFinite(parseFloat(timeAttr)) && parseFloat(timeAttr) >= 0
          ? parseFloat(timeAttr)
          : currentStartMatch && Number.isFinite(parseFloat(currentStartMatch[1])) && parseFloat(currentStartMatch[1]) >= 0
            ? parseFloat(currentStartMatch[1])
            : -1;

      const endMatch = cFull.match(/<CurrentEnd\s+Value="([^"]+)"/i);
      const loopStartMatch = cFull.match(/<LoopStart\s+Value="([^"]+)"/i);
      const loopEndMatch = cFull.match(/<LoopEnd\s+Value="([^"]+)"/i);

      const loopStartBeat = loopStartMatch ? Math.max(0, parseFloat(loopStartMatch[1]) || 0) : 0;
      const loopEndBeat = loopEndMatch ? Math.max(loopStartBeat + 1, parseFloat(loopEndMatch[1]) || 16) : 16;
      const loopBeats = Math.max(1, loopEndBeat - loopStartBeat);

      let startBar: number;
      let lenBars: number;
      if (rawStartBeat >= 0) {
        startBar = Math.min(2048, Math.max(0, Math.floor(rawStartBeat / 4)));
        const endBeat = endMatch ? parseFloat(endMatch[1]) : rawStartBeat + loopBeats;
        lenBars = clamp(Math.ceil(Math.max(1, endBeat - rawStartBeat) / 4), 1, 512);
        // If multiple Session View clips all have Time="0", place subsequent clips sequentially
        if (rawStartBeat === 0 && clipIdx > 0 && clips.some((c) => c.start === 0)) {
          startBar = sessionSlotOffsetBar;
        }
      } else {
        startBar = sessionSlotOffsetBar;
        lenBars = clamp(Math.ceil(loopBeats / 4), 1, 64);
      }
      sessionSlotOffsetBar = Math.max(sessionSlotOffsetBar, startBar + lenBars);

      const clipNameMatch = cFull.match(/<Name\s+Value="([^"]+)"/i);
      const nameAttr = clipNameMatch && clipNameMatch[1].trim() ? unescapeXml(clipNameMatch[1].trim()) : `${name} Clip ${clipIdx + 1}`;

      const notes: Note[] = [];
      const keyTrackBlocks = cFull.split(/<KeyTrack\b/i).slice(1);

      keyTrackBlocks.forEach((ktBlock) => {
        const ktFull = `<KeyTrack ${ktBlock.split('</KeyTrack>')[0]}</KeyTrack>`;
        const keyMatch = ktFull.match(/<MidiKey\s+Value="([^"]+)"/i);
        const keyVal = clamp(keyMatch ? parseInt(keyMatch[1], 10) : 60, 0, 127);

        // Support both <MidiNote .../> and <MidiNoteEvent .../> (Ableton Live 9/10/11/12)
        const noteMatches = ktFull.matchAll(/<MidiNote(?:Event)?\s+([^>]+?)\/?>/gi);
        for (const nMatch of noteMatches) {
          const nAttrs = nMatch[1];
          const isEnabled = extractAttr(nAttrs, 'IsEnabled');
          if (isEnabled && isEnabled.toLowerCase() === 'false') continue;

          const tBeat = parseFloat(extractAttr(nAttrs, 'Time') || '0');
          const dBeat = parseFloat(extractAttr(nAttrs, 'Duration') || '0.25');
          const velStr = extractAttr(nAttrs, 'Velocity') || extractAttr(nAttrs, 'Value') || '100';
          const vel = parseFloat(velStr);

          if (!Number.isFinite(tBeat) || tBeat < 0) continue;
          const stepStart = clamp(Math.round(tBeat * 4 * 100) / 100, 0, 8192);
          const stepDur = clamp(Math.round(Math.max(0.1, dBeat) * 4 * 100) / 100, 0.25, 1024);
          const velocity = clamp((Number.isFinite(vel) ? vel : 100) / 127, 0.05, 1);

          notes.push({
            t: stepStart,
            d: stepDur,
            p: keyVal,
            v: +velocity.toFixed(3),
            ...(velocity >= 0.92 ? { acc: true } : {}),
          });
        }
      });

      notes.sort((a, b) => a.t - b.t);
      const maxNoteStep = notes.reduce((m, n) => Math.max(m, Math.ceil(n.t + n.d)), 0);
      const loopSteps = clamp(
        loopEndMatch ? Math.round(loopBeats * 4) : Math.max(lenBars * 16, Math.ceil(maxNoteStep / 4) * 4),
        4,
        4096
      );

      if (notes.length > 0 || clipBlocks.length === 1) {
        maxBarSeen = Math.max(maxBarSeen, startBar + lenBars);
        clips.push({
          id: uid('clip'),
          start: startBar,
          len: lenBars,
          loop: loopSteps,
          off: 0,
          notes: notes.slice(0, 8192),
          gain: 1,
          mute: false,
          label: nameAttr.slice(0, 120),
          transpose: 0,
        });
      }
    });

    // Keep tracks that have clips or if the file has a reasonable track count
    if (clips.length > 0 || midiTrackBlocks.length <= 24) {
      tracks.push({
        id: trkId,
        layer: lDef.id,
        name: name.slice(0, 80),
        color: lDef.color,
        group: lDef.group,
        synth: lDef.synth,
        vol: clamp(lDef.vol, 0, 2),
        pan: clamp(lDef.pan, -1, 1),
        mute: false,
        solo: false,
        lock: false,
        sc: lDef.sc,
        rev: clamp(lDef.rev, 0, 1),
        del: clamp(lDef.del, 0, 1),
        cutoff: lDef.id === 'ARP' || lDef.id === 'ACID1' || lDef.id === 'STAB' ? 0.52 : 0.48,
        res: lDef.id === 'ARP' || lDef.id === 'ACID1' || lDef.id === 'STAB' ? 0.42 : 0.3,
        clips,
      });
    }
  });

  if (tracks.length > 0) {
    p.tracks = tracks;

    // Ensure sections cover the entire imported arrangement span without overlap
    const targetBars = clamp(Math.ceil(maxBarSeen / 8) * 8, 16, 2048);
    const curTotal = totalBars(p);
    if (targetBars > curTotal && p.sections.length > 0) {
      p.sections[p.sections.length - 1].bars += targetBars - curTotal;
    }
    p.params.bars = Math.max(p.params.bars, totalBars(p));

    // Populate section activity levels for all imported tracks so matrix & inspector stay in sync
    for (const sec of p.sections) {
      const nextLevels: Record<string, number> = {};
      for (const trk of tracks) {
        const hasClipInSec = trk.clips.some((c) => c.start < sec.start + sec.bars && c.start + c.len > sec.start);
        const lv = hasClipInSec ? 0.85 : 0;
        nextLevels[trk.id] = lv;
        nextLevels[trk.layer] = Math.max(nextLevels[trk.layer] ?? 0, lv);
      }
      sec.levels = nextLevels;
    }

    // Rebuild automation lanes referencing ONLY valid imported track IDs (fixes "Invalid automation target" error)
    const total = totalBars(p);
    const auto: AutoLane[] = [];
    for (const trk of tracks) {
      if (['ACID1', 'ACID2', 'ARP', 'STAB', 'PAD', 'DUB', 'LEAD', 'MIDBASS'].includes(trk.layer) && trk.clips.length > 0) {
        auto.push({
          id: `a_${trk.id}_cutoff`,
          track: trk.id,
          param: 'cutoff',
          pts: [
            { bar: 0, v: 0.42 },
            { bar: Math.max(1, Math.round(total * 0.5)), v: 0.74, curve: 0.3 },
            { bar: Math.max(2, total - 1), v: 0.48, curve: -0.25 },
          ],
        });
      }
    }
    p.auto = auto;
    p.overrides = {};
    p.secSeed = {};
  }

  assertProject(p);
  return p;
}

