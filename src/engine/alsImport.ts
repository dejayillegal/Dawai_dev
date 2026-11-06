import type { Note, Project, Track, Clip } from './types';
import { defaultParams, newProject } from './composer';
import { LAYERS } from './styles';
import { uid } from './theory';

export async function decompressGzipIfNeeded(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    if (typeof DecompressionStream !== 'undefined') {
      try {
        const ds = new DecompressionStream('gzip');
        const writer = ds.writable.getWriter();
        writer.write(bytes);
        writer.close();
        const response = new Response(ds.readable);
        return await response.text();
      } catch {
        // Fallback below
      }
    }
  }
  const decoder = new TextDecoder('utf-8');
  return decoder.decode(buffer);
}

function extractAttr(tagStr: string, attrName: string): string | null {
  const match = tagStr.match(new RegExp(`${attrName}="([^"]*)"`, 'i'));
  return match ? match[1] : null;
}

/** Map track names to matching AIDAW layer definitions */
function matchLayerByTrackName(trackName: string, index: number): string {
  const n = trackName.toLowerCase();
  if (n.includes('kick') || n.includes('bd')) return 'KICK';
  if (n.includes('sub')) return 'SUB';
  if (n.includes('rumble')) return 'RUMBLE';
  if (n.includes('midbass') || n.includes('bass')) return 'MIDBASS';
  if (n.includes('acid') || n.includes('303')) return 'ACID1';
  if (n.includes('stab')) return 'STAB';
  if (n.includes('lead')) return 'LEAD';
  if (n.includes('arp') || n.includes('pluck')) return 'ARP';
  if (n.includes('pad')) return 'PAD';
  if (n.includes('dub')) return 'DUB';
  if (n.includes('drone')) return 'DRONE';
  if (n.includes('conga') || n.includes('tribal')) return 'CONGA';
  if (n.includes('tom')) return 'TOM';
  if (n.includes('clang') || n.includes('metal')) return 'CLANG';
  if (n.includes('hat') || n.includes('hh')) return 'HAT_C';
  if (n.includes('ride') || n.includes('cymbal')) return 'RIDE';
  if (n.includes('snare') || n.includes('sd')) return 'SNARE';
  if (n.includes('clap')) return 'CLAP';
  if (n.includes('perc')) return 'PERC1';

  const defaultKeys = Object.keys(LAYERS);
  return defaultKeys[index % defaultKeys.length];
}

export async function importAlsFile(buffer: ArrayBuffer, fileName = 'Imported_Live_Set'): Promise<Project> {
  const xml = await decompressGzipIfNeeded(buffer);

  // Parse Master Tempo
  let bpm = 130;
  const tempoMatch = xml.match(/<Tempo>\s*<Manual\s+Value="([^"]+)"/i);
  if (tempoMatch) {
    const val = parseFloat(tempoMatch[1]);
    if (Number.isFinite(val) && val >= 60 && val <= 200) bpm = val;
  }

  const p = newProject({ ...defaultParams('hypnotic', 1337), bpm });
  p.name = fileName.replace(/\.als$/i, '').replace(/_/g, ' ');

  const midiTrackBlocks = xml.split(/<MidiTrack\s+/i).slice(1);
  if (!midiTrackBlocks.length) {
    return p;
  }

  const tracks: Track[] = [];

  midiTrackBlocks.forEach((block, idx) => {
    const fullBlock = `<MidiTrack ${block.split('</MidiTrack>')[0]}</MidiTrack>`;
    let name = `Track ${idx + 1}`;

    const nameMatch = fullBlock.match(/<Name>\s*<(?:UserName|EffectiveName)\s+Value="([^"]+)"/i);
    if (nameMatch) {
      name = nameMatch[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
    }

    const layerId = matchLayerByTrackName(name, idx);
    const lDef = LAYERS[layerId] || LAYERS.KICK;
    const trkId = uid('track');
    const clips: Clip[] = [];

    const clipBlocks = fullBlock.split(/<MidiClip\s+/i).slice(1);
    clipBlocks.forEach((cBlock) => {
      const cFull = `<MidiClip ${cBlock.split('</MidiClip>')[0]}</MidiClip>`;
      const timeAttr = extractAttr(cFull, 'Time') || '0';
      const startBeat = parseFloat(timeAttr);
      const startBar = Math.max(0, Math.floor(startBeat / 4));

      const endMatch = cFull.match(/<CurrentEnd\s+Value="([^"]+)"/i);
      const endBeat = endMatch ? parseFloat(endMatch[1]) : startBeat + 16;
      const lenBars = Math.max(1, Math.ceil((endBeat - startBeat) / 4));

      const clipNameMatch = cFull.match(/<Name\s+Value="([^"]+)"/i);
      const nameAttr = clipNameMatch ? clipNameMatch[1] : 'Imported Clip';

      const notes: Note[] = [];
      const keyTrackBlocks = cFull.split(/<KeyTrack\s+/i).slice(1);

      keyTrackBlocks.forEach((ktBlock) => {
        const ktFull = `<KeyTrack ${ktBlock.split('</KeyTrack>')[0]}</KeyTrack>`;
        const keyMatch = ktFull.match(/<MidiKey\s+Value="([^"]+)"/i);
        const keyVal = keyMatch ? parseInt(keyMatch[1], 10) : 60;

        const noteMatches = ktFull.matchAll(/<MidiNote\s+([^/>]+)\/>/gi);
        for (const nMatch of noteMatches) {
          const nAttrs = nMatch[1];
          const tBeat = parseFloat(extractAttr(nAttrs, 'Time') || '0');
          const dBeat = parseFloat(extractAttr(nAttrs, 'Duration') || '0.25');
          const velStr = extractAttr(nAttrs, 'Velocity') || extractAttr(nAttrs, 'Value') || '100';
          const vel = parseInt(velStr, 10);

          const stepStart = Math.max(0, Math.round(tBeat * 4));
          const stepDur = Math.max(0.5, Math.round(dBeat * 4 * 10) / 10);
          const velocity = Math.min(1, Math.max(0.05, vel / 127));

          notes.push({
            t: stepStart,
            d: stepDur,
            p: keyVal,
            v: velocity,
          });
        }
      });

      if (notes.length > 0 || clipBlocks.length === 1) {
        clips.push({
          id: uid('clip'),
          start: startBar,
          len: lenBars,
          loop: lenBars * 16,
          off: 0,
          notes,
          gain: 1,
          mute: false,
          label: nameAttr,
          transpose: 0,
        });
      }
    });

    tracks.push({
      id: trkId,
      layer: lDef.id,
      name,
      color: lDef.color,
      group: lDef.group,
      synth: lDef.synth,
      vol: lDef.vol,
      pan: lDef.pan,
      mute: false,
      solo: false,
      lock: false,
      sc: lDef.sc,
      rev: lDef.rev,
      del: lDef.del,
      cutoff: 0.5,
      res: 0.3,
      clips,
    });
  });

  if (tracks.length > 0) {
    p.tracks = tracks;
  }

  return p;
}
