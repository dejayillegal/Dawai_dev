import type { AutoLane, AutoParam, Clip, ComposeParams, Note, Project, ScCfg, ScGroup, Section, SectionRole, Track } from './types';
import { Rng, clamp, degree, euclid, hash, uid } from './theory';
import { ATOM_LAYERS, FORMS, GROUP_ORDER, LAYERS, ROLE_NAMES, ROLE_RULES, STYLES, type LayerDef, type StyleDef } from './styles';

type PN = Note & { pri: number };
interface Ctx { rng: Rng; style: StyleDef; P: ComposeParams; R: number }

export function defaultSc(): Record<ScGroup, ScCfg> {
  return {
    bass: { thr: -26, ratio: 6, atk: 1, rel: 170, hpf: 60, mix: 1, knee: 6 },
    harm: { thr: -28, ratio: 4, atk: 2, rel: 230, hpf: 60, mix: 1, knee: 8 },
    fx: { thr: -26, ratio: 3, atk: 3, rel: 280, hpf: 60, mix: 0.9, knee: 10 },
  };
}

export function defaultParams(style = 'hypnotic', seed = 1337): ComposeParams {
  const s = STYLES[style];
  return {
    style, form: 'auto', bpm: Math.round((s.bpm[0] + s.bpm[1]) / 2), key: 9, scale: s.scales[0],
    bars: 176, seed, density: 0.6, complexity: 0.5, swing: s.swing, acid: 0.5, poly: 0.5,
    dirt: s.dirt, depth: 0.5, mode: 'hybrid',
  };
}

// ───────────────────────── clip helpers ─────────────────────────
export const mkId = (() => { let n = 0; return (p: string) => `${p}${(n++).toString(36)}${Math.floor(Math.random() * 46656).toString(36)}`; })();

export function mkClip(start: number, len: number, loop: number, notes: Note[], label: string, off = 0): Clip {
  return { id: mkId('c'), start, len, loop, off: ((off % loop) + loop) % loop, notes, gain: 1, mute: false, label, transpose: 0 };
}

/** remove the span [a,b) from a track's clips, splitting where needed (keeps loop phase) */
export function carve(track: Track, a: number, b: number) {
  const out: Clip[] = [];
  for (const c of track.clips) {
    const e = c.start + c.len;
    if (e <= a + 1e-6 || c.start >= b - 1e-6) { out.push(c); continue; }
    if (c.start < a - 1e-6) out.push({ ...c, len: a - c.start });
    if (e > b + 1e-6) {
      out.push({ ...c, id: c.start < a ? mkId('c') : c.id, start: b, len: e - b, off: (((c.off + (b - c.start) * 16) % c.loop) + c.loop) % c.loop });
    }
  }
  track.clips = out.filter((c) => c.len > 1e-6);
}

export const thin = (notes: PN[], level: number): Note[] => {
  let keep = notes.filter((n) => n.pri <= level + 1e-9);
  if (!keep.length && level > 0.05 && notes.length) keep = [notes.reduce((a, b) => (a.pri <= b.pri ? a : b))];
  return keep.map(({ pri, ...n }) => ({ ...n }));
};

export function mutate(notes: Note[], loop: number, kind: 'oct' | 'rot' | 'frag' | 'rest' | 'acc', rng: Rng): Note[] {
  const ns = notes.map((n) => ({ ...n }));
  switch (kind) {
    case 'oct': ns.forEach((n) => { if (rng.chance(0.25)) n.p += rng.chance(0.7) ? 12 : -12; }); return ns;
    case 'acc': ns.forEach((n) => { if (rng.chance(0.3)) { n.acc = true; n.v = 1; } }); return ns;
    case 'rot': { const r = rng.pick([2, 4, 3]); ns.forEach((n) => { n.t = (n.t + r) % loop; }); return ns.sort((a, b) => a.t - b.t); }
    case 'frag': return ns.filter((n) => n.t < loop / 2);
    case 'rest': return ns.length > 3 ? ns.filter(() => !rng.chance(0.2)) : ns;
  }
}

// ───────────────────────── peak patterns (densest version first) ─────────────────────────
function acidLine(c: Ctx, base: number, len: number, accP: number, slP: number, octP: number, restP: number): PN[] {
  const { rng, P } = c;
  const out: PN[] = [];
  // Musical 303 scale-degree motifs: root-anchored call & response (avoids random nasal semitone soup)
  const motifs = [
    [0, 0, 4, 0, 2, 3, 0, 6, 0, 0, 5, 4, 2, 0, 6, 3],
    [0, 0, 2, 4, 0, 0, 6, 4, 0, 2, 3, 0, 4, 6, 2, 0],
    [0, 4, 0, 2, 0, 6, 3, 0, 0, 4, 5, 2, 0, 3, 1, 0],
    [0, 0, 3, 2, 0, 4, 0, 6, 0, 3, 5, 4, 0, 2, 6, 1],
  ];
  const motif = rng.pick(motifs);
  const rot = rng.int(0, 7);
  let prev = -2;
  for (let s = 0; s < len; s++) {
    const barIdx = Math.floor(s / 16);
    const stepInBar = s % 16;
    const m = s % 4;
    // Strong 303 rhythmic groove weights: offbeats (m===2) and 16th pickups (m===3) drive the line
    const w = m === 2 ? 0.94 : m === 3 ? 0.8 : m === 0 ? 0.56 : 0.48;
    // Leave musical breathing space so the 303 filter decay can sing
    if (rng.next() > w * (1 - restP) + 0.04) {
      prev = -2;
      continue;
    }
    // Anchor root on step 0 or step 2 of bar 0 so the bassline has unmistakable tonal gravity
    let deg = motif[(stepInBar + rot + barIdx * 3) % motif.length];
    if (stepInBar === 0 || (barIdx === 0 && stepInBar === 2)) {
      deg = 0;
    } else if (barIdx % 2 === 1 && stepInBar >= 12) {
      // Bar 2 / Bar 4 turnaround variation
      deg = rng.pick([2, 3, 4, 5, 6]);
    }
    let p = degree(base, P.scale, deg);
    // Controlled octave jumps on offbeats or turnaround steps
    if ((m === 2 || stepInBar >= 11) && rng.chance(octP)) {
      p += 12;
    } else if (m === 0 && deg === 0 && rng.chance(0.18)) {
      p -= 12;
    }
    const acc = (m === 2 && stepInBar % 8 === 2) || rng.chance(accP * (m === 2 || m === 3 ? 1.25 : 0.7));
    const slide = prev === s - 1 && rng.chance(slP * (stepInBar >= 10 || m === 3 ? 1.35 : 0.9));
    out.push({
      t: s,
      d: slide ? 1.18 : acc ? 0.82 : 0.72,
      p,
      v: acc ? 0.98 : 0.72 + (m === 2 ? 0.08 : 0),
      acc,
      slide,
      pri: stepInBar === 2 || stepInBar === 6 ? 0.04 : (1 - w) * 0.58 + rng.next() * 0.38,
    });
    prev = s;
  }
  return out;
}

function chordPitches(c: Ctx, base: number, rootDeg: number, tones: number[]) {
  return tones.map((t) => degree(base, c.P.scale, rootDeg + t));
}

function genPattern(l: LayerDef, c: Ctx): { loop: number; notes: PN[] } {
  const { rng, style, P, R } = c; const cx = P.complexity; const N: PN[] = [];
  const add = (t: number, d: number, p: number, v: number, pri: number, ex: Partial<Note> = {}) => N.push({ t, d, p, v, pri, ...ex });
  let loop = 16;
  const isAmbient = style.id === 'ambient';
  const isHypnoticFamily = style.id === 'hypnotic' || style.id === 'minimal_groover' || style.id === 'mental_tribal' || isAmbient;
  const isHorror = P.scale === 'locrian' || P.scale === 'octatonic';
  const isCinematic = P.scale === 'harmonicMinor' || P.scale === 'phrygianDominant' || isAmbient;
  const isDark = isHorror || isCinematic || P.scale === 'phrygian' || P.dirt >= 0.65 || P.mode === 'industrial';
  switch (l.id) {
    case 'KICK':
      for (const s of [0, 4, 8, 12]) add(s, 1, 36, 1, 0);
      if (style.kick === 'ghost' || isHorror) { add(7.5, 0.5, 36, 0.44, 0.65); add(15, 0.5, 36, 0.38, 0.8); }
      if (style.id === 'schranz' || (isDark && P.mode === 'industrial')) { add(3.5, 0.5, 36, 0.52, 0.45); add(11.5, 0.5, 36, 0.58, 0.35); add(14.5, 0.5, 36, 0.48, 0.6); }
      break;
    case 'SUB':
      if (isHorror) {
        // Ominous creeping sub-bass with tritone/minor-2nd tail
        for (const s of [1.5, 3, 5.5, 7, 9.5, 11, 13.5, 15]) {
          const strong = s % 4 === 1.5;
          const deg = s === 7 ? 1 : s === 15 ? 4 : 0;
          add(s, strong ? 1.35 : 0.8, degree(R, P.scale, deg), strong ? 0.94 : 0.74, strong ? 0.05 : 0.3, { micro: strong ? 0.015 : -0.02 });
        }
      } else if (isCinematic) {
        // Bowed sustained sub-bass pedal with dramatic 8-bar/16-step movement
        for (const [s, d, deg, v, pri] of [[0.5, 3.2, 0, 0.92, 0], [4.5, 3.2, 0, 0.88, 0.1], [8.5, 3.2, 5, 0.9, 0.15], [12.5, 3.0, 4, 0.92, 0.1]] as const) {
          add(s, d, degree(R, P.scale, deg), v, pri);
        }
      } else if (style.id === 'hypnotic' || style.id === 'minimal_groover') {
        for (const s of [1.5, 2.5, 5.5, 6.5, 9.5, 10.5, 13.5, 14.5]) {
          const strong = s % 4 === 2.5;
          add(s, strong ? 1.2 : 0.75, R, strong ? 0.92 : 0.72, strong ? 0.05 : 0.35, { micro: strong ? 0.02 : -0.02 });
        }
        if (rng.chance(0.4 + cx * 0.4)) add(15, 0.8, degree(R, P.scale, 1), 0.68, 0.55);
      } else if (style.id === 'detroit') {
        for (const [s, deg, v, pri] of [[0.5, 0, 0.85, 0.1], [2, 0, 0.92, 0], [3.5, 2, 0.78, 0.3], [6, 4, 0.88, 0.1], [9.5, 3, 0.82, 0.25], [11, 0, 0.9, 0.15], [14, 6, 0.8, 0.35]] as const) {
          add(s, 1.1, degree(R, P.scale, deg), v, pri);
        }
      } else {
        for (const s of [2, 6, 10, 14]) add(s, 1.7, R, 0.9, s === 2 ? 0 : s === 10 ? 0.1 : 0.2);
        if (rng.chance(0.3 + cx * 0.5)) add(11.5, 1, degree(R, P.scale, 4), 0.7, 0.6);
        if (rng.chance(cx)) add(15, 0.8, R + 12, 0.6, 0.8);
      }
      break;
    case 'RUMBLE':
      for (const s of [1, 5, 9, 13]) add(s, 2.8, R, 0.88, s === 1 ? 0 : 0.05);
      if (isHypnoticFamily || isDark) {
        for (const beat of [0, 4, 8, 12]) {
          add(beat + 1.5, 0.75, R, 0.58, 0.15, { micro: -0.015 });
          add(beat + 2.5, 0.85, isHorror && beat === 12 ? degree(R, P.scale, 1) : R, 0.8, 0.08, { micro: 0.015 });
          add(beat + 3.25, 0.65, R, 0.68, 0.22, { micro: 0.025 });
        }
      }
      break;
    case 'MIDBASS':
      for (let s = 0; s < 16; s++) {
        if (s % 4 === 0) continue;
        const off = s % 4 === 2;
        const choices = isHorror
          ? [R, degree(R, P.scale, 1), degree(R, P.scale, 4), R + 6]
          : isCinematic
            ? [R, degree(R, P.scale, 2), degree(R, P.scale, 5), R + 12]
            : [R, R, degree(R, P.scale, 2), degree(R, P.scale, 4), R + 12];
        add(s, 0.85, off ? R : rng.pick(choices), off ? 0.95 : 0.75, off ? 0.05 : rng.range(0.3, 1));
      }
      break;
    case 'HAT_C':
      for (let s = 0; s < 16; s++) {
        if (s % 4 === 2) continue;
        if (s % 2 === 0) add(s, 0.4, 42, 0.5, 0.1);
        else add(s, 0.3, 42, 0.28 + rng.next() * 0.15, 0.45 + rng.next() * 0.5, isHypnoticFamily ? { micro: (s % 4 === 3 ? 0.03 : -0.02) } : {});
      }
      break;
    case 'HAT_O': for (const s of [2, 6, 10, 14]) add(s, 1.5, 46, 0.8, s === 14 ? 0.3 : 0); break;
    case 'RIDE':
      for (let s = 0; s < 16; s += 2) add(s, 1, 51, s % 4 === 2 ? 0.68 : 0.36, s % 4 === 2 ? 0 : 0.5);
      if (style.id === 'schranz' || style.id === 'detroit') {
        for (const s of [3, 7, 11, 15]) add(s, 0.5, 51, 0.42, 0.35);
      }
      break;
    case 'SHAKER':
      for (let s = 0; s < 16; s++) add(s, 0.4, 70, s % 2 ? 0.32 : 0.54, s % 4 === 2 ? 0 : rng.range(0.2, 1), isHypnoticFamily && s % 2 === 1 ? { micro: 0.025 } : {});
      break;
    case 'CLAP':
      add(4, 1, 39, 0.9, 0); add(12, 1, 39, 0.95, 0);
      if (rng.chance(0.4 + cx * 0.5)) add(15, 0.5, 39, 0.4, 0.8);
      break;
    case 'SNARE':
      add(4, 1, 38, 0.85, 0.15); add(12, 1, 38, 0.9, 0.15);
      for (const s of [7, 9.5, 14, 11]) if (rng.chance(0.4 + cx * 0.5)) add(s, 0.5, 38, 0.3, 0.5 + rng.next() * 0.4);
      break;
    case 'PERC1': {
      if (isHypnoticFamily || isDark) {
        loop = 12;
        const pat = euclid(5, 12, rng.int(0, 11));
        const pool = isHorror
          ? [R + 12, degree(R + 12, P.scale, 1), R + 18, degree(R + 12, P.scale, 4)]
          : [R + 12, degree(R + 12, P.scale, 1), degree(R + 12, P.scale, 4), R + 19];
        pat.forEach((h, i) => {
          if (h) add(i, 0.75, pool[i % pool.length], 0.56 + (i % 3 === 0 ? 0.22 : 0.08), i % 3 === 0 ? 0.08 : 0.35, { micro: i % 2 === 1 ? 0.02 : -0.015 });
        });
      } else {
        const k = clamp(3 + Math.round(P.poly * 4), 3, 8); const pat = euclid(k, 16, rng.int(0, 15));
        const pool = [50, 53, 55, 57];
        pat.forEach((h, i) => { if (h) add(i, 0.8, rng.pick(pool), 0.5 + rng.next() * 0.4, i % 4 === 0 ? 0.15 : rng.next() * 0.9); });
      }
      break;
    }
    case 'PERC2': {
      loop = rng.pick(style.poly); const k = clamp(Math.round(loop * (0.33 + P.poly * 0.18)), 3, loop - 2);
      const pool = isHypnoticFamily || isDark ? [R + 12, degree(R + 12, P.scale, 2), degree(R + 12, P.scale, 4), R + 19] : [52, 55, 59, 62];
      euclid(k, loop, rng.int(0, loop - 1)).forEach((h, i) => {
        if (h) add(i, 0.75, pool[i % pool.length], 0.45 + rng.next() * 0.35, i % 4 === 0 ? 0.15 : rng.next() * 0.85, isHypnoticFamily ? { micro: i % 2 === 0 ? 0.018 : -0.018 } : {});
      });
      break;
    }
    case 'CONGA': {
      const pool = isHypnoticFamily || isDark ? [R + 12, degree(R + 12, P.scale, 3), degree(R + 12, P.scale, 4)] : [50, 53, 55];
      if (isHypnoticFamily) {
        loop = 12;
        euclid(7, 12, rng.int(0, 5)).forEach((h, i) => {
          if (h) add(i, 0.75, pool[i % 3], 0.52 + (i % 3 === 0 ? 0.32 : 0.12), i % 3 === 0 ? 0.08 : 0.4, { micro: i % 2 === 1 ? 0.022 : 0 });
        });
      } else {
        euclid(9, 16, rng.int(0, 7)).forEach((h, i) => { if (h) add(i, 0.7, pool[i % 3], 0.45 + rng.next() * 0.45, i % 4 === 2 ? 0.1 : rng.next() * 0.9); });
      }
      break;
    }
    case 'TOM':
      if (isHypnoticFamily || isDark) {
        const tomPitches = isHorror ? [R, R + 6, degree(R, P.scale, 1)] : [R, degree(R, P.scale, 4), R + 7];
        const steps = [2, 3, 6, 7.5, 10, 11, 14, 15];
        steps.forEach((s, idx) => {
          const strong = s === 2 || s === 6 || s === 10 || s === 14;
          add(s, strong ? 0.95 : 0.65, tomPitches[idx % tomPitches.length], strong ? 0.78 : 0.54, strong ? 0.08 : 0.38, { micro: strong ? 0.015 : 0.028 });
        });
      } else {
        euclid(3, 8, rng.int(0, 3)).forEach((h, i) => { if (h) { add(i, 1, rng.pick([41, 45, 48]), 0.7, 0.2); add(i + 8, 1, rng.pick([41, 45, 48]), 0.65, 0.5); } });
      }
      break;
    case 'CLANG':
      if (style.id === 'schranz' || isHorror) {
        loop = 16;
        const clangSteps = isHorror ? [1.5, 4.5, 7, 10.5, 13, 15.5] : [2, 6, 10, 14, 3, 11, 15];
        for (const s of clangSteps) add(s, 0.75, rng.int(46, 62), s % 4 === 2 ? 0.85 : 0.6, s % 4 === 2 ? 0.08 : 0.4);
      } else {
        loop = 32;
        for (let i = 0; i < 6; i++) add(rng.pick([3, 7, 11, 13, 19, 23, 27, 29, 31]), 1, rng.int(48, 64), 0.5 + rng.next() * 0.4, rng.next());
      }
      break;
    case 'ACID1': {
      // Multi-bar evolving TB-303 bassline register (1 octave above sub R, call-and-response across 32/64 steps)
      const base = R + 12;
      if (isHorror) {
        loop = 32;
        const horrorBars = [
          [0, 1, 0, 4, 1, 3, 0, 6],
          [0, 4, 1, 0, 6, 3, 1, 4],
        ];
        let prevStep = -2;
        for (let s = 0; s < loop; s++) {
          if (rng.next() > 0.74) { prevStep = -2; continue; }
          const barPool = horrorBars[Math.floor(s / 16) % horrorBars.length];
          const deg = s % 16 === 0 ? 0 : barPool[(s + rng.int(0, 2)) % barPool.length];
          let p = degree(base, P.scale, deg);
          if (s % 4 === 2 && rng.chance(0.38)) p += 12;
          else if (s % 8 === 0 && rng.chance(0.22)) p -= 12;
          const acc = s % 4 === 2 || rng.chance(0.32 + P.acid * 0.25);
          const slide = prevStep === s - 1 && rng.chance(0.38 + P.acid * 0.32);
          add(s, slide ? 1.2 : 0.76, p, acc ? 0.96 : 0.72, acc ? 0.05 : 0.28 + ((s % 16) / 16) * 0.35, { acc, slide });
          prevStep = s;
        }
      } else if (isAmbient || isCinematic) {
        loop = 32;
        // Liquid hypnotic 2-bar evolving 303 sequence with spacious filter decays
        const cinMotifA = [0, 0, 2, 4, 0, 5, 4, 2];
        const cinMotifB = [0, 2, 4, 6, 5, 4, 2, 1];
        let prevStep = -2;
        for (let s = 0; s < loop; s++) {
          const stepInBar = s % 16;
          if (stepInBar % 4 === 0 && stepInBar > 0 && rng.chance(0.42)) { prevStep = -2; continue; }
          if (isAmbient && stepInBar % 2 === 1 && rng.chance(0.45)) { prevStep = -2; continue; }
          const motif = s < 16 ? cinMotifA : cinMotifB;
          const deg = motif[stepInBar % motif.length];
          let p = degree(base, P.scale, deg);
          if (stepInBar === 6 || stepInBar === 14) p += 12;
          const acc = stepInBar % 4 === 2 || s === 30;
          const slide = prevStep === s - 1 && (stepInBar % 2 === 1 || rng.chance(0.4));
          add(s, slide ? 1.22 : 0.82, p, acc ? 0.94 : 0.72, acc ? 0.06 : 0.26 + (stepInBar / 16) * 0.3, { acc, slide });
          prevStep = s;
        }
      } else if (isHypnoticFamily) {
        // 32-step or 48-step multi-bar evolving 303 roller so consecutive bars never repeat identically
        loop = rng.pick([24, 32]);
        const degreePools = [
          [0, 0, 4, 0, 2, 4, 0, 6],
          [0, 2, 4, 0, 5, 4, 2, 0],
          [0, 4, 2, 0, 6, 3, 4, 0],
          [0, 0, 3, 4, 0, 6, 2, 4],
          [0, 3, 2, 6, 4, 0, 5, 2],
        ];
        const poolA = degreePools[rng.int(0, degreePools.length - 1)];
        const poolB = degreePools[(rng.int(1, degreePools.length - 1)) % degreePools.length];
        const rot = rng.int(0, poolA.length - 1);
        const gateHits = clamp(Math.round(loop * (0.54 + P.density * 0.24)), 8, loop - 2);
        const gateMask = euclid(gateHits, loop, rng.int(0, loop - 1));
        const octChance = 0.2 + P.acid * 0.34;
        let prevStep = -2;
        for (let s = 0; s < loop; s++) {
          if (!gateMask[s] && rng.next() > 0.22) { prevStep = -2; continue; }
          const offbeat = s % 2 === 1;
          const activePool = s < loop / 2 ? poolA : poolB;
          const rawDeg = s % 16 === 0 || s % 16 === 2 ? 0 : activePool[(s + rot) % activePool.length];
          let p = degree(base, P.scale, Math.max(0, rawDeg));
          if ((s % 4 === 2 || s % 8 === 7) && rng.chance(octChance)) p += 12;
          const acc = s % 4 === 2 || rng.chance(0.24 + P.acid * 0.26);
          const slide = prevStep === s - 1 && rng.chance(0.32 + P.acid * 0.34);
          add(s, slide ? 1.18 : 0.76, p, acc ? 0.96 : 0.72, acc ? 0.06 : 0.3 + ((s % 16) / 16) * 0.35, {
            acc,
            slide,
            micro: offbeat ? 0.016 : -0.01,
          });
          prevStep = s;
        }
      } else {
        loop = 32;
        const a = acidLine(c, base, 32, 0.24 + P.acid * 0.28, 0.2 + P.acid * 0.24, 0.2, 0.22 - P.acid * 0.08);
        N.push(...a);
      }
      break;
    }
    case 'ACID2': {
      loop = 32;
      const base = R + 12;
      // Counter-rhythmic upper-octave 303 screamer with distinct 2-bar call and response
      const a = acidLine(c, base, 16, 0.38 + P.acid * 0.3, 0.34, 0.32, 0.34 - P.acid * 0.08);
      const b = acidLine(c, base, 16, 0.46 + P.acid * 0.3, 0.4, 0.36, 0.28);
      N.push(
        ...a,
        ...b.map((n, idx) => ({
          ...n,
          t: n.t + 16,
          p: idx % 3 === 0 ? degree(base, P.scale, 4) + (n.p >= base + 12 ? 12 : 0) : n.p,
        }))
      );
      break;
    }
    case 'STAB': {
      // Sparse syncopated warehouse chord stabs (mid register R+12, short punchy hits on offbeats)
      if (isHorror) {
        loop = 32;
        const horrorHits = [2.5, 7, 13.5, 18.5, 25, 30];
        horrorHits.forEach((h, hi) => {
          const chord = chordPitches(c, R + 12, style.prog[hi % style.prog.length] ?? 0, [0, 1, 3, 6]);
          chord.forEach((p, k) => add(h, 1.15, p, 0.78 - k * 0.05, (hi % 3) * 0.18));
        });
      } else if (isCinematic) {
        loop = 32;
        const cinHits = [2, 6.5, 14, 18, 22.5, 30];
        cinHits.forEach((h, hi) => {
          const chord = chordPitches(c, R + 12, style.prog[Math.floor(h / 8) % style.prog.length] ?? 0, [0, 2, 4, 6]);
          chord.forEach((p, k) => add(h, 1.65, p, 0.76 - k * 0.04, (hi % 3) * 0.16));
        });
      } else if (isHypnoticFamily) {
        loop = rng.pick([16, 32]);
        const hitPatterns = [
          [2.5, 7, 11.5],
          [1.5, 6, 13.5],
          [3, 7.5, 14],
          [2, 9.5, 14.5],
          [3.5, 10, 15],
        ];
        const hits = rng.pick(hitPatterns);
        const voicings = [
          [0, 2, 4],       // Minor triad
          [0, 2, 4, 6],    // Minor 7th
          [0, 1, 4],       // Phrygian tension cluster
          [0, 3, 4, 6],    // Suspended 4th + 7th
        ];
        for (let half = 0; half < (loop / 16); half++) {
          const rootDeg = style.prog[(half + rng.int(0, style.prog.length - 1)) % style.prog.length] ?? 0;
          const voicing = voicings[(half + rng.int(0, voicings.length - 1)) % voicings.length];
          hits.forEach((h, hi) => {
            const chord = chordPitches(c, R + 12, rootDeg, voicing);
            chord.forEach((p, k) =>
              add(half * 16 + h, k === 0 ? 1.25 : 0.95, p, 0.72 + (hi % 2) * 0.14, hi * 0.14, { micro: hi % 2 === 1 ? 0.02 : 0 })
            );
          });
        }
      } else if (style.id === 'detroit') {
        loop = 32;
        const detroitHits = [0, 3, 6, 11, 14, 18, 22, 27, 30];
        detroitHits.forEach((h, hi) => {
          const chord = chordPitches(c, R + 12, style.prog[Math.floor(h / 8) % style.prog.length], [0, 2, 4, 6, 8]);
          chord.forEach((p) => add(h, 1.4, p, 0.72 + (hi % 3 === 0 ? 0.16 : 0), (hi % 4) * 0.2));
        });
      } else {
        loop = 32; const hitsPool = [3, 6, 10, 11, 14];
        for (let half = 0; half < 2; half++) {
          const chord = chordPitches(c, R + 12, style.prog[half % style.prog.length], rng.chance(0.5) ? [0, 2, 4] : [0, 2, 4, 6]);
          const hits = [...hitsPool].sort(() => rng.next() - 0.5).slice(0, rng.int(2, 3 + Math.round(cx * 2)));
          hits.forEach((h, hi) => chord.forEach((p) => add(half * 16 + h, 1.1, p, 0.7, hi * 0.25 + rng.next() * 0.1)));
        }
      }
      break;
    }
    case 'LEAD': {
      loop = 64; let deg = 0; const base = R + 24; const starts = [0, 3, 6, 8, 11, 14];
      const call: PN[] = [];
      starts.forEach((s, i) => {
        deg += isHorror ? rng.pick([-1, 1, 3, -2]) : rng.pick([-1, 0, 1, 2, -2]);
        call.push({ t: s, d: rng.pick([2, 3, 4]), p: degree(base, P.scale, clamp(deg, -3, 6)), v: 0.82, pri: i * 0.15 });
      });
      call.forEach((n) => add(n.t, n.d, n.p, n.v, n.pri));
      call.forEach((n, i) => add(n.t + 32, n.d, i > 3 ? n.p + (isHorror ? 1 : 2) : n.p, 0.76, n.pri + 0.05));
      break;
    }
    case 'ARP': {
      // Crystalline Buchla/FM pluck in upper register (R+24), brisk single-note broken arpeggio
      const base = R + 24;
      if (isHorror) {
        loop = 12;
        const horrorTones = [0, 1, 4, 6, 3, 1, 0, 4, 6, 1, 3, 0];
        for (let s = 0; s < loop; s++) {
          if (s % 4 === 3 && rng.chance(0.3)) continue;
          const acc = s % 3 === 0;
          add(s, 0.55, degree(base, P.scale, horrorTones[s % horrorTones.length]), acc ? 0.88 : 0.64, acc ? 0.05 : 0.22);
        }
      } else if (isCinematic) {
        loop = 16;
        const cinTones = [0, 2, 4, 6, 7, 6, 4, 2, 0, 2, 5, 7, 9, 7, 5, 2];
        for (let s = 0; s < loop; s++) {
          const acc = s % 4 === 0 || s % 4 === 2;
          add(s, 0.65, degree(base, P.scale, cinTones[s % cinTones.length]), acc ? 0.86 : 0.62, acc ? 0.05 : 0.2);
        }
      } else if (isHypnoticFamily) {
        loop = rng.pick([12, 16, 24]);
        const tonePools = [
          [0, 2, 4, 6, 4, 2],
          [0, 1, 4, 5, 4, 1],
          [0, 3, 4, 7, 4, 3],
          [0, 2, 5, 7, 5, 2],
        ];
        const tones = rng.pick(tonePools);
        const rot = rng.int(0, tones.length - 1);
        for (let s = 0; s < loop; s++) {
          if (s % 4 === 0 && rng.chance(0.2)) continue; // Leave breathing room on downbeats
          const acc = s % 3 === 2 || s % 4 === 2;
          add(
            s,
            acc ? 0.65 : 0.5,
            degree(base, P.scale, tones[(s + rot) % tones.length]),
            acc ? 0.88 : 0.64 + (s % 2) * 0.08,
            acc ? 0.04 : 0.14 + (s % 4) * 0.12,
            { acc, micro: s % 3 === 2 ? 0.022 : s % 3 === 1 ? -0.015 : 0 }
          );
        }
      } else {
        const tones = [0, 2, 4, 7, 9, 7, 4, 2];
        loop = 16;
        for (let s = 0; s < loop; s++) if (rng.chance(0.88)) add(s, 0.6, degree(base, P.scale, tones[s % tones.length]), 0.58 + (s % 3 === 0 ? 0.22 : 0), s % 3 === 0 ? 0.1 : rng.range(0.2, 0.95));
      }
      break;
    }
    case 'PAD': {
      loop = isAmbient ? 192 : 128;
      const stepSpan = isAmbient ? 48 : 32;
      const voicing = isHorror
        ? [0, 1, 4, 6]
        : isAmbient
          ? [0, 2, 4, 6, 8]
          : isCinematic
            ? [0, 2, 4, 5, 7]
            : [0, 2, 4, 6];
      for (let i = 0; i < 4; i++) {
        const rootDeg = style.prog[i % style.prog.length] ?? 0;
        const ps = chordPitches(c, R + 12, rootDeg, voicing);
        ps.forEach((p, k) =>
          add(i * stepSpan, stepSpan + (isAmbient ? 6 : 2), k === voicing.length - 1 && i % 2 === 1 ? p + 12 : p, isAmbient ? 0.68 : 0.58, k >= 3 ? 0.32 : 0)
        );
      }
      break;
    }
    case 'DUB': {
      loop = isAmbient ? 32 : 24;
      const voicing = isHorror ? [0, 1, 3, 6] : isCinematic ? [0, 2, 4, 6, 7] : [0, 2, 4, 6];
      if (isHypnoticFamily || isDark) {
        const hitPatterns = isAmbient
          ? [
              [2, 14, 26],
              [4, 18, 28],
              [3, 15, 25],
            ]
          : [
              [3, 11, 18],
              [2, 10, 17],
              [4, 12, 19],
              [1.5, 9.5, 16.5],
            ];
        const hits = rng.pick(hitPatterns);
        hits.forEach((h, hi) => {
          const rootDeg = style.prog[(hi + rng.int(0, style.prog.length - 1)) % style.prog.length] ?? 0;
          chordPitches(c, R + 12, rootDeg, voicing).forEach((p, k) =>
            add(h, isAmbient ? 5.2 : 3.8, p, 0.76 - k * 0.04, hi * 0.14 + (k >= 3 ? 0.1 : 0), { micro: 0.02 })
          );
        });
      } else {
        const hits = [2, 5, 9, 14, 18, 21].sort(() => rng.next() - 0.5).slice(0, 3).sort((a, b) => a - b);
        hits.forEach((h, hi) => chordPitches(c, R + 12, style.prog[hi % style.prog.length], [0, 2, 4, 6, 8]).forEach((p, k) => add(h, 3, p, 0.7, hi * 0.3 + (k === 4 ? 0.1 : 0))));
      }
      break;
    }
    case 'DRONE':
      if (isAmbient) {
        loop = 128;
        // Two 4-bar evolving harmonic drone beds with shifting fifth, seventh, and ninth overtones
        add(0, 66, R + 12, 0.76, 0);
        add(0, 66, degree(R + 12, P.scale, 4), 0.62, 0.02);
        add(0, 66, degree(R + 12, P.scale, 8), 0.48, 0.06);
        add(64, 66, R + 12, 0.76, 0);
        add(64, 66, degree(R + 12, P.scale, 3), 0.58, 0.02);
        add(64, 66, degree(R + 12, P.scale, 6), 0.52, 0.06);
      } else {
        loop = 64;
        add(0, 64, R + 12, 0.7, 0);
        add(0, 64, degree(R + 12, P.scale, isHorror ? 1 : 4), 0.54, 0.04);
        if (isHorror || isCinematic) {
          add(0, 64, degree(R + 12, P.scale, isHorror ? 3 : 5), 0.46, 0.08);
        }
      }
      break;
    case 'TEX': loop = 64; add(0, 64, isHorror ? 48 : 60, 0.55, 0); break;
    case 'CRACKLE': for (let i = 0; i < (isHorror ? 11 : 7); i++) add(rng.range(0, 16), 0.2, 80, 0.32 + rng.next() * 0.5, rng.next()); break;
  }
  N.sort((a, b) => a.t - b.t);
  return { loop, notes: N };
}

/**
 * Deterministic phrase-level musical evolution across all layers (Foundation, Groove, Character, Harmony)
 * so that consecutive phrase chunks (ci) and sections (si) never repeat a static pattern identically.
 */
function evolvePhraseNotes(
  baseNotes: Note[],
  loop: number,
  l: LayerDef,
  sec: Section,
  si: number,
  ci: number,
  c: Ctx
): Note[] {
  const { rng, P, R, style } = c;
  let ns = baseNotes.map((n) => ({ ...n }));
  if (!ns.length) return ns;

  const phase = si * 3 + ci;

  if (l.id === 'ACID1' || l.id === 'ACID2') {
    const base = R + 12;
    const degShift = style.prog[(si + ci) % style.prog.length] ?? 0;
    ns = ns.map((n, idx) => {
      const copy = { ...n };
      // Shift turnaround notes and alternate accent/slide articulations on every phrase chunk
      if (ci > 0 && idx % 3 === (phase % 3)) {
        const stepInBar = Math.floor(copy.t) % 16;
        if (stepInBar >= 8) {
          const newDeg = (degShift + idx + phase) % 7;
          const oct = copy.p >= base + 12 ? 12 : 0;
          copy.p = degree(base, P.scale, newDeg) + oct;
        }
      }
      if ((idx + phase) % 5 === 0 && copy.t % 4 === 2) {
        copy.acc = !copy.acc;
        copy.v = copy.acc ? 0.96 : 0.74;
      }
      if (ci % 2 === 1 && idx === ns.length - 1 && copy.p < base + 18) {
        copy.p += 12;
        copy.slide = true;
      }
      return copy;
    });
    if (sec.role === 'VARIATION' || (ci > 0 && ci % 3 === 2)) {
      const rotSteps = ((phase % 3) + 1) * 2;
      ns.forEach((n) => {
        n.t = (n.t + rotSteps) % loop;
      });
      ns.sort((a, b) => a.t - b.t);
    }
    return ns;
  }

  if (l.group === 'Foundation') {
    if (l.id === 'SUB' || l.id === 'MIDBASS' || l.id === 'RUMBLE') {
      const tailDegrees = [1, 4, 3, 6, 2];
      const targetDeg = tailDegrees[phase % tailDegrees.length];
      ns = ns.map((n, idx) => {
        const copy = { ...n };
        if (l.id !== 'RUMBLE' && idx === ns.length - 1 && (ci > 0 || si > 0)) {
          copy.p = degree(R, P.scale, targetDeg);
        } else if (l.id === 'MIDBASS' && (idx + phase) % 4 === 0 && copy.t % 4 !== 2) {
          copy.p = degree(R, P.scale, (idx + phase) % 5);
        }
        return copy;
      });
    } else if (l.id === 'KICK' && (ci % 2 === 1 || sec.role === 'VARIATION' || sec.role === 'DROP_PEAK')) {
      const ghostStep = phase % 2 === 0 ? 15.5 : 14.5;
      if (!ns.some((n) => Math.abs(n.t - ghostStep) < 0.25)) {
        ns.push({ t: ghostStep, d: 0.5, p: 36, v: 0.42 });
        ns.sort((a, b) => a.t - b.t);
      }
    }
    return ns;
  }

  if (l.group === 'Groove') {
    if (ci > 0 || si > 0) {
      const rot = ((phase % 3) + 1) * 2;
      if (l.id === 'PERC1' || l.id === 'PERC2' || l.id === 'CONGA' || l.id === 'TOM' || l.id === 'CLANG') {
        ns.forEach((n, idx) => {
          if (ci > 0) n.t = (n.t + (ci % 2 === 1 ? 2 : rot)) % loop;
          if ((idx + phase) % 3 === 0) n.v = clamp(n.v + (phase % 2 === 0 ? 0.08 : -0.06), 0.28, 0.98);
        });
        ns.sort((a, b) => a.t - b.t);
      } else if (l.id === 'HAT_C' || l.id === 'SHAKER' || l.id === 'RIDE') {
        ns.forEach((n, idx) => {
          if ((idx + phase) % 4 === 0) n.v = clamp(n.v + (ci % 2 === 0 ? 0.09 : -0.07), 0.22, 0.92);
        });
      } else if ((l.id === 'SNARE' || l.id === 'CLAP') && ci % 2 === 1) {
        const fillStep = phase % 2 === 0 ? 15 : 13.5;
        if (!ns.some((n) => Math.abs(n.t - fillStep) < 0.25)) {
          ns.push({ t: fillStep, d: 0.5, p: l.id === 'CLAP' ? 39 : 38, v: 0.46 });
          ns.sort((a, b) => a.t - b.t);
        }
      }
    }
    return ns;
  }

  if (l.group === 'Character') {
    // STAB, ARP, LEAD phrase evolution
    if (l.id === 'ARP') {
      const base = R + 24;
      ns.forEach((n, idx) => {
        if ((idx + phase) % 4 === 0 && (ci > 0 || si > 0)) {
          n.p = degree(base, P.scale, (idx + phase * 2) % 8);
          n.acc = (idx + phase) % 3 === 0;
        }
      });
      if (ci % 2 === 1) {
        ns.forEach((n) => {
          n.t = (n.t + 2) % loop;
        });
        ns.sort((a, b) => a.t - b.t);
      }
    } else if (l.id === 'STAB' || l.id === 'LEAD') {
      const shift = ((ci + si) % 2 === 1) ? 2 : 0;
      if (shift > 0) {
        ns.forEach((n, idx) => {
          if (idx % 2 === 1) n.t = (n.t + shift) % loop;
        });
        ns.sort((a, b) => a.t - b.t);
      }
      if (sec.role === 'DROP_PEAK') ns = mutate(ns, loop, 'acc', rng);
      else if (sec.role === 'OUTRO') ns = mutate(ns, loop, 'frag', rng);
    }
    return ns;
  }

  if (l.group === 'Harmony') {
    // PAD, DUB, DRONE harmonic inversion & timing evolution across phrases
    if (l.id === 'DUB' && (ci > 0 || si > 0)) {
      const stepShift = (phase % 3) === 1 ? 1 : (phase % 3) === 2 ? 2 : 0;
      ns.forEach((n, idx) => {
        if (stepShift > 0) n.t = (n.t + stepShift) % loop;
        if (idx % 4 === (phase % 4) && n.p < R + 30) n.p += 12;
      });
      ns.sort((a, b) => a.t - b.t);
    } else if ((l.id === 'PAD' || l.id === 'DRONE') && (ci > 0 || si > 0)) {
      ns.forEach((n, idx) => {
        if (idx > 0 && (idx + phase) % 3 === 0) {
          n.v = clamp(n.v + (phase % 2 === 0 ? 0.06 : -0.05), 0.35, 0.85);
        }
      });
    }
  }

  return ns;
}

// ───────────────────────── sections ─────────────────────────
export function buildSections(P: ComposeParams, rng: Rng): { sections: Section[]; formId: string } {
  const style = STYLES[P.style];
  const form = FORMS[P.form === 'auto' || !FORMS[P.form] ? rng.pick(style.forms) : P.form];
  const specs = form.sections.filter((s) => s.p === undefined || rng.chance(s.p));
  const bars = specs.map((s) => rng.pick(s.bars));
  const total = () => bars.reduce((a, b) => a + b, 0);
  for (let g = 0; g < 40; g++) {
    const diff = P.bars - total();
    if (Math.abs(diff) < 8) break;
    const idx = specs.map((_, i) => i).filter((i) => {
      const s = specs[i];
      if (diff > 0) return bars[i] < 64 && (s.flex || bars[i] < 32);
      return bars[i] > 16 && (s.flex || bars[i] > 16);
    });
    if (!idx.length) break;
    const flex = idx.filter((i) => specs[i].flex); const pool = flex.length ? flex : idx;
    bars[rng.pick(pool)] += diff > 0 ? 8 : -8;
  }
  let remaining = P.bars - total();
  if (remaining > 0) bars[bars.length-2] += remaining;
  else if (remaining < 0) {
    for (let i=bars.length-1; i>=0 && remaining<0; i--) {
      const amount=Math.min(-remaining,Math.max(0,bars[i]-1));bars[i]-=amount;remaining+=amount;
    }
    if(remaining<0)throw new Error('Duration too short for selected form');
  }
  let start = 0;
  const sections: Section[] = specs.map((s, i) => {
    const sec: Section = {
      id: `s${i + 1}`, role: s.role, name: s.name ?? ROLE_NAMES[s.role], start, bars: bars[i],
      energy: clamp(s.energy + rng.range(-0.03, 0.03)), lock: false, levels: {},
    };
    start += bars[i];
    return sec;
  });
  return { sections, formId: form.id };
}

export function layerLevel(sec: Section, l: LayerDef, style: StyleDef, P: ComposeParams, overrides: Record<string, number>): number {
  if (l.group === 'Transition') return 0;
  const [en, fu] = style.thr?.[l.id] ?? [l.enter, l.full];
  const E = sec.energy * (0.85 + 0.3 * P.density);
  let lv = clamp((E - en) / (fu - en));
  if (lv > 0) lv = 0.3 + 0.7 * lv;
  const rules = ROLE_RULES[sec.role];
  if (rules.kill.includes(l.id)) lv = 0;
  if (rules.boost[l.id] !== undefined) lv = Math.max(lv, rules.boost[l.id]);
  const ov = overrides[`${sec.id}:${l.id}`];
  if (ov !== undefined) lv = ov;
  return clamp(lv);
}

// ───────────────────────── transitions / atoms ─────────────────────────
const FOUNDATION = ['KICK', 'SUB', 'RUMBLE', 'MIDBASS'];

function atomClip(track: Track | undefined, start: number, len: number, p: number, v: number, label: string, dSteps?: number) {
  if (!track || start < 0) return;
  carve(track, start, start + len);
  track.clips.push(mkClip(start, len, len * 16, [{ t: 0, d: dSteps ?? len * 16, p, v }], label));
}

export function fillNotes(bars: number, rng: Rng, base: number, rise: boolean): Note[] {
  const S = bars * 16; const notes: Note[] = [];
  for (let t = 0; t < S;) {
    const f = t / S; const step = f < 0.4 ? 2 : f < 0.75 ? 1 : 0.5;
    notes.push({ t, d: step * 0.8, p: base + (rise ? Math.floor(f * 12) : 0), v: clamp(0.35 + 0.65 * f + rng.range(-0.05, 0.05)) });
    t += step;
  }
  return notes;
}

function fillOn(tracks: Track[], ids: string[], a: number, bars: number, rng: Rng, label: string, used: Set<string>) {
  const tr = ids.map((id) => tracks.find((t) => t.layer === id)).find((t) => t && !used.has(t.id));
  if (!tr) return;
  used.add(tr.id);
  carve(tr, a, a + bars);
  const base = tr.synth === 'snare' || tr.synth === 'clap' ? (tr.synth === 'clap' ? 39 : 38) : tr.synth === 'tom' ? 45 : tr.synth === 'hat' ? 42 : 60;
  tr.clips.push(mkClip(a, bars, bars * 16, fillNotes(bars, rng, base, tr.synth === 'tom' || tr.synth === 'perc' || tr.synth === 'conga'), label));
}

export function addTransition(tracks: Track[], style: StyleDef, B: number, delta: number, room: number, rng: Rng, force?: 'up' | 'down' | 'mid', keyRoot = 36) {
  const T = (id: string) => tracks.find((t) => t.layer === id);
  const kind = force ?? (delta > 0.25 ? 'up' : delta < -0.2 ? 'down' : 'mid');
  const used = new Set<string>();
  const isHypnotic = style.id === 'hypnotic' || style.id === 'minimal_groover' || style.id === 'mental_tribal';
  const isAmbientOrDub = style.id === 'ambient' || style.id === 'dub' || style.id === 'melodic_deep';
  const isDarkVault = style.id === 'industrial' || style.id === 'horror_vault' || style.id === 'cinematic_dark';
  const rootSub = Math.max(30, Math.min(45, keyRoot <= 35 ? keyRoot + 12 : keyRoot));
  const rootMid = rootSub + 12;
  const rootHigh = rootSub + 24;

  if (kind === 'up') {
    const rb = isAmbientOrDub ? Math.min(8, Math.max(4, Math.floor(room))) : isHypnotic ? Math.min(4, Math.floor(room)) : Math.max(2, Math.min(8, Math.floor(room)));
    const riserVel = isAmbientOrDub ? 0.56 : isHypnotic ? 0.64 : isDarkVault ? 0.84 : 0.78;
    // 1. Key-locked Analog Filter Sweep & Dark Swarm Riser before the drop [B - rb, B)
    atomClip(T('RISER'), B - rb, rb, rootHigh, riserVel, isAmbientOrDub ? 'Atmospheric Filter Swell' : isDarkVault ? 'Vault Tension Riser' : 'Analog Sweep Riser');
    const fb = Math.max(1, Math.min(2, Math.floor(room)));
    if (isAmbientOrDub) {
      fillOn(tracks, ['PERC1', 'PERC2', 'TOM', 'SHAKER'], B - fb, fb, rng, 'Dub Perc Swell', used);
    } else if (isHypnotic) {
      fillOn(tracks, ['TOM', 'CONGA', 'PERC1', 'PERC2'], B - fb, fb, rng, 'Tribal Roll', used);
    } else {
      fillOn(tracks, ['SNARE', 'CLAP', 'PERC1', 'HAT_C'], B - fb, fb, rng, 'Snare Roll', used);
      fillOn(tracks, ['TOM', 'PERC1', 'CONGA', 'PERC2'], B - fb, fb, rng, 'Perc Roll', used);
    }
    const vb = Math.min(style.void, Math.max(1, Math.floor(room)));
    if (!isAmbientOrDub) {
      for (const id of FOUNDATION) { const t = T(id); if (t) carve(t, B - vb, B); }
    } else {
      const k = T('KICK'); if (k) carve(k, B - 1, B);
    }
    // 2. Key-locked Sub-Drop Impact hits at bar B in the exact root key of the track
    const impVel = isAmbientOrDub ? 0.68 : isHypnotic ? 0.82 : 0.94;
    atomClip(T('IMPACT'), B, 2, rootSub, impVel, isDarkVault ? 'Vault Seismic Impact' : 'Key-Locked Sub Impact', 24);
    // 3. Bronze Shimmer Crash or Reverse Cymbal Swell
    const cr = T('CRASH');
    if (cr) {
      if (isHypnotic || isAmbientOrDub) {
        atomClip(cr, B - 1, 1, 1, isAmbientOrDub ? 0.48 : 0.56, 'Reverse Bronze Swell', 16);
      } else {
        carve(cr, B, B + 2);
        cr.clips.push(mkClip(B, 2, 32, [{ t: 0, d: 24, p: rootHigh, v: isDarkVault ? 0.78 : 0.72 }], 'Dark Bronze Crash'));
      }
    }
  } else if (kind === 'down') {
    // Key-locked Sub-Brass & Air Downlifter pitches down over 4 bars on breakdown entry
    const dlVel = isAmbientOrDub ? 0.62 : isHypnotic ? 0.68 : 0.82;
    atomClip(T('DOWNLIFT'), B, 4, rootMid, dlVel, 'Analog Sub-Brass Downlifter', 64);
  } else {
    // Mid-energy section boundary: subtle reverse bronze swell or key-locked sub pulse
    if (rng.chance(0.5)) {
      if (isAmbientOrDub || isHypnotic) {
        atomClip(T('CRASH'), B - 1, 1, 1, 0.42, 'Reverse Phrase Swell', 16);
      } else {
        atomClip(T('CRASH'), B, 1, rootHigh, 0.54, 'Bronze Boundary Shimmer', 16);
      }
    } else {
      atomClip(T('IMPACT'), B, 1, rootSub, isAmbientOrDub ? 0.44 : 0.56, 'Sub-Root Boundary Thud', 14);
    }
    if (rng.chance(0.6)) {
      if (isHypnotic || isAmbientOrDub) fillOn(tracks, ['TOM', 'CONGA', 'PERC1', 'HAT_C'], B - 1, 1, rng, 'Phrase Fill', used);
      else fillOn(tracks, ['PERC1', 'SNARE', 'CLAP', 'HAT_C'], B - 1, 1, rng, 'Phrase Fill', used);
    }
  }
}

// ───────────────────────── automation ─────────────────────────
const FILTER_LAYERS = ['ACID1', 'ACID2', 'MIDBASS', 'STAB', 'LEAD', 'ARP', 'PAD', 'DUB', 'DRONE'];
const THROW_LAYERS = ['STAB', 'DUB', 'LEAD', 'ACID1', 'ACID2', 'ARP'];

function sweepFor(role: SectionRole, layer: string): [number, number] {
  const pad = layer === 'PAD' || layer === 'DRONE' || layer === 'DUB';
  switch (role) {
    case 'INTRO': return [0.2, 0.42];
    case 'GROOVE_BUILD': return [0.25, 0.5];
    case 'BASS_ENTRANCE': case 'PLATEAU': return pad ? [0.4, 0.6] : [0.3, 0.66];
    case 'REDUCTION': return pad ? [0.3, 0.92] : [0.35, 0.74];
    case 'BUILD_UP': return [0.4, 1];
    case 'DROP_PRIMARY': return pad ? [0.4, 0.5] : [0.45, 0.76];
    case 'VARIATION': return [0.4, 0.62];
    case 'DROP_PEAK': return pad ? [0.4, 0.45] : [0.45, 0.62];
    case 'OUTRO': return [0.6, 0.18];
  }
}

function cleanPts(pts: { bar: number; v: number; curve?: number }[]) {
  pts.sort((a, b) => a.bar - b.bar);
  const out: { bar: number; v: number; curve?: number }[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    const c = p.curve !== undefined && Math.abs(p.curve) >= 0.005 ? +clamp(p.curve, -1, 1).toFixed(3) : undefined;
    if (last && p.bar - last.bar < 0.004) {
      last.v = +clamp(p.v).toFixed(3);
      if (c !== undefined) last.curve = c;
      else delete last.curve;
      continue;
    }
    const nextPt: { bar: number; v: number; curve?: number } = { bar: Math.max(0, +p.bar.toFixed(3)), v: +clamp(p.v).toFixed(3) };
    if (c !== undefined) nextPt.curve = c;
    out.push(nextPt);
  }
  return out;
}

function genAuto(tracks: Track[], sections: Section[], P: ComposeParams, levels: Record<string, number[]>): AutoLane[] {
  const lanes: AutoLane[] = [];
  const amp = 0.7 + P.acid * 0.6;
  const shape = (layer: string, v: number) => (layer.startsWith('ACID') ? clamp(0.55 + (v - 0.55) * amp) : v);
  const upAt = (i: number) => i < sections.length - 1 && sections[i + 1].energy - sections[i].energy > 0.25;
  for (const t of tracks) {
    const lv = levels[t.layer]; if (!lv) continue;
    if (FILTER_LAYERS.includes(t.layer)) {
      const pts: { bar: number; v: number; curve?: number }[] = [];
      const res: { bar: number; v: number; curve?: number }[] = [];
      const isHyp = P.style === 'hypnotic' || P.style === 'minimal_groover' || P.style === 'mental_tribal';
      sections.forEach((s, i) => {
        if (lv[i] < 0.02) return;
        const [a, b] = sweepFor(s.role, t.layer); const end = s.start + s.bars;
        const startV = isHyp && (t.layer === 'ARP' || t.layer === 'ACID1') ? Math.max(0.36, shape(t.layer, a)) : shape(t.layer, a);
        pts.push({ bar: s.start, v: startV });
        if (s.role === 'DROP_PEAK' || s.role === 'PLATEAU' || s.role === 'DROP_PRIMARY' || (isHyp && (s.role === 'INTRO' || s.role === 'GROOVE_BUILD'))) {
          const stepBars = isHyp ? 8 : 16;
          for (let k = stepBars; k < s.bars - 2; k += stepBars) {
            const hi = k % (stepBars * 2) === stepBars;
            pts.push({ bar: s.start + k - stepBars / 2, v: shape(t.layer, hi ? 0.84 : 0.46), curve: hi ? 0.38 : -0.38 });
            pts.push({ bar: s.start + k, v: shape(t.layer, hi ? 0.52 : 0.78), curve: hi ? -0.35 : 0.35 });
          }
        }
        if (upAt(i)) {
          const rl = Math.min(s.bars, 16);
          pts.push({ bar: end - rl, v: shape(t.layer, (a + b) / 2), curve: 0.45 });
          pts.push({ bar: end - 0.01, v: 0.98, curve: 0.52 });
        } else {
          pts.push({ bar: end - 0.01, v: shape(t.layer, b), curve: 0.28 });
        }
        if (t.layer.startsWith('ACID') || t.layer === 'ARP' || t.layer === 'STAB' || t.layer === 'DUB') {
          const peak = s.role === 'DROP_PEAK' || s.role === 'PLATEAU';
          const baseRes = t.layer === 'ARP' ? 0.44 : t.layer.startsWith('ACID') ? 0.35 + P.acid * 0.15 : 0.32;
          res.push(
            { bar: s.start, v: peak ? baseRes + 0.14 : baseRes },
            { bar: s.start + s.bars * 0.5, v: clamp(baseRes + (peak ? 0.28 : 0.18)), curve: 0.36 },
            { bar: end - 0.01, v: upAt(i) ? 0.88 : peak ? clamp(baseRes + 0.22 + P.acid * 0.2) : clamp(baseRes + 0.08), curve: -0.32 }
          );
        }
      });
      if (pts.length) lanes.push({ id: `a_${t.id}_cutoff`, track: t.id, param: 'cutoff', pts: cleanPts(pts) });
      if (res.length) lanes.push({ id: `a_${t.id}_res`, track: t.id, param: 'res', pts: cleanPts(res) });
    }
    if (THROW_LAYERS.includes(t.layer)) {
      const pts: { bar: number; v: number }[] = [{ bar: 0, v: t.rev }];
      sections.forEach((s, i) => {
        if (i === sections.length - 1) return;
        const B = s.start + s.bars; const d = sections[i + 1].energy - s.energy;
        if (d < -0.2) pts.push({ bar: B - 2, v: t.rev }, { bar: B - 0.25, v: 0.9 }, { bar: B + 3, v: t.rev });
        else if (d > 0.25) pts.push({ bar: B - 1, v: t.rev }, { bar: B - 0.12, v: 0.85 }, { bar: B, v: t.rev });
      });
      if (pts.length > 1) lanes.push({ id: `a_${t.id}_rev`, track: t.id, param: 'rev', pts: cleanPts(pts) });
    }
  }
  const hp: { bar: number; v: number }[] = [{ bar: 0, v: 0 }];
  sections.forEach((s, i) => {
    if (!upAt(i)) return;
    const B = s.start + s.bars; const room = Math.min(8, s.bars);
    hp.push({ bar: B - room, v: 0 }, { bar: B - 0.01, v: 0.78 }, { bar: B, v: 0 });
  });
  if (hp.length > 1) lanes.push({ id: 'a_master_hp', track: 'master', param: 'hp', pts: cleanPts(hp) });
  return lanes;
}

// ───────────────────────── main generator ─────────────────────────
export interface GenOpts { layers?:string[]; sections?: Section[]; secSeed?: Record<string, number>; overrides?: Record<string, number>; rig?: boolean }
export interface GenResult { sections: Section[]; tracks: Track[]; auto: AutoLane[]; formId: string }

export function generate(P: ComposeParams, o: GenOpts = {}): GenResult {
  const style = STYLES[P.style];
  const overrides = o.overrides ?? {}; const secSeed = o.secSeed ?? {};
  const rootRng = new Rng(hash(P.seed, P.style, 'form'));
  let formId = P.form;
  let sections: Section[];
  if (o.sections) { sections = o.sections.map((s) => ({ ...s, levels: {} })); formId = 'custom'; }
  else { const r = buildSections(P, rootRng); sections = r.sections; formId = r.formId; }
  const R = 24 + P.key;

  const isDarkFlavor = P.scale === 'locrian' || P.scale === 'octatonic' || P.scale === 'harmonicMinor' || P.scale === 'phrygianDominant' || P.dirt >= 0.65;
  const isAmbientStyle = P.style === 'ambient';
  const coreAlways = isAmbientStyle
    ? ['PAD', 'DRONE', 'DUB', 'ARP', 'TEX', 'CRACKLE', 'SUB', 'RUMBLE', 'KICK', 'HAT_C', 'PERC1', ...ATOM_LAYERS]
    : P.style === 'hypnotic'
      ? ['KICK', 'SUB', 'RUMBLE', 'TOM', 'CONGA', 'HAT_C', 'SHAKER', 'PERC1', 'PERC2', 'ARP', 'STAB', 'DUB', 'ACID1', 'DRONE', ...ATOM_LAYERS]
      : isDarkFlavor
        ? ['KICK', 'SUB', 'RUMBLE', 'HAT_C', 'PERC1', 'DRONE', 'PAD', ...ATOM_LAYERS]
        : ['KICK', 'SUB', 'HAT_C', 'PERC1', ...ATOM_LAYERS];
  const basePool = o.layers ?? (isDarkFlavor ? Array.from(new Set([...style.layers, 'DRONE', 'PAD', 'RUMBLE', 'CLANG'])) : style.layers);
  const selected = basePool.filter(
    (id) => coreAlways.includes(id) || new Rng(hash(P.seed, P.style, id, 'allocation')).next() < 0.65 + 0.35 * P.density
  );
  const defs = selected.map((id, i) => ({ l: LAYERS[id], i })).sort((a, b) => GROUP_ORDER.indexOf(a.l.group) - GROUP_ORDER.indexOf(b.l.group) || a.i - b.i).map((x) => x.l);
  const tracks: Track[] = defs.map((l) => ({
    id: `t_${l.id}`, layer: l.id, name: l.name, color: l.color, group: l.group, synth: l.synth, vol: l.vol, pan: l.pan,
    mute: false, solo: false, lock: false, sc: l.sc, rev: l.rev, del: l.del,
    cutoff: l.id === 'ARP' || l.id === 'ACID1' || l.id === 'STAB' ? 0.48 : 0.45,
    res: l.id === 'ARP' || l.id === 'ACID1' || l.id === 'STAB' ? 0.42 : 0.28,
    clips: [],
  }));

  const levels: Record<string, number[]> = {};
  for (const l of defs) {
    levels[l.id] = sections.map((s) => layerLevel(s, l, style, P, {...overrides,...(overrides[`${s.id}:t_${l.id}`]!==undefined?{[`${s.id}:${l.id}`]:overrides[`${s.id}:t_${l.id}`]}:{})}));
    sections.forEach((s, i) => { s.levels[l.id] = +levels[l.id][i].toFixed(2); s.levels[`t_${l.id}`]=s.levels[l.id]; });
  }
  if (o.rig) return { sections, tracks, auto: [], formId };

  // 1) peak-first: densest loop per layer, 2) subtractive clips per section with independent lifecycles
  const hypImmediate = new Set(['KICK', 'RUMBLE', 'SUB', 'TOM', 'CONGA', 'ARP', 'STAB', 'DUB', 'DRONE', 'HAT_C', 'SHAKER', 'PERC1']);
  const ambImmediate = new Set(['PAD', 'DRONE', 'DUB', 'TEX', 'CRACKLE', 'ARP', 'SUB', 'RUMBLE']);
  for (const tr of tracks) {
    const l = LAYERS[tr.layer];
    if (l.group === 'Transition') continue;
    const pat = genPattern(l, { rng: new Rng(hash(P.seed, P.style, P.scale, l.id, 'pat')), style, P, R });
    const lv = levels[l.id];
    sections.forEach((sec, si) => {
      if (lv[si] < 0.02) return;
      const rng = new Rng(hash(P.seed, l.id, si, secSeed[sec.id] ?? 0));
      const prev = si > 0 ? lv[si - 1] : 0; const next = si < sections.length - 1 ? lv[si + 1] : 0;
      let start = sec.start; let end = sec.start + sec.bars;
      const isImm = (P.style === 'hypnotic' && hypImmediate.has(l.id)) || (isAmbientStyle && ambImmediate.has(l.id));
      // staggered entrance
      if (si === 0 && l.id !== 'KICK' && !isImm) {
        const d = l.group === 'Texture' || l.group === 'Harmony' ? rng.pick([0, 0, 4]) : rng.pick([4, 8, 8, 12]);
        if (d < sec.bars * 0.6) start += d;
      } else if (prev < 0.02 && sec.bars >= 16 && l.group !== 'Foundation' && !isImm) {
        const d = rng.pick([0, 0, 4, 8]); if (d < sec.bars / 2) start += d;
      }
      // staggered exit
      if (sec.role === 'OUTRO') {
        const frac =
          isAmbientStyle && (l.id === 'PAD' || l.id === 'DRONE' || l.id === 'TEX')
            ? 1
            : l.id === 'KICK'
              ? 1
              : l.group === 'Character'
                ? rng.range(0.25, 0.45)
                : l.group === 'Harmony'
                  ? rng.range(0.6, 0.85)
                  : l.group === 'Foundation'
                    ? rng.range(0.7, 0.85)
                    : rng.range(0.5, 0.85);
        end = sec.start + Math.max(4, Math.round((sec.bars * frac) / 2) * 2);
      } else if (next < 0.02 && sec.bars >= 16 && l.group !== 'Harmony' && l.group !== 'Texture') {
        const d = rng.pick([0, 0, 2, 4]); if (d < sec.bars / 2) end -= d;
      }
      if (end - start < 1) return;
      // Ambient Techno uses longer loop phrases for deep evolving harmonic & rhythmic arcs
      const targetPhrase = isAmbientStyle ? Math.max(l.phrase * 2, l.group === 'Harmony' ? 32 : 16) : l.phrase;
      const ph = Math.min(targetPhrase, sec.bars);
      let cur = start; let ci = 0;
      while (cur < end - 1e-6) {
        const gridEnd = sec.start + (Math.floor((cur - sec.start) / ph + 1e-9) + 1) * ph;
        const ce = Math.min(end, gridEnd);
        const prog = (ce - sec.start) / sec.bars;
        const lvc = clamp(lv[si] * (0.78 + 0.22 * prog));
        let notes = thin(pat.notes as PN[], lvc);
        notes = evolvePhraseNotes(notes, pat.loop, l, sec, si, ci, { rng, style, P, R });
        tr.clips.push(mkClip(cur, ce - cur, pat.loop, notes, `${l.name} · ${sec.name}`, cur * 16));
        cur = ce; ci++;
      }
    });
  }

  // 3) phrase-end micro-cuts + fills (1/2-bar kick dropouts at 16 / 32-bar phrase ends)
  const T = (id: string) => tracks.find((t) => t.layer === id);
  sections.forEach((sec, si) => {
    if (sec.energy < 0.5 || sec.role === 'REDUCTION' || sec.role === 'INTRO') return;
    const frng = new Rng(hash(P.seed, 'fill', si, secSeed[sec.id] ?? 0));
    for (let p = 16; p <= sec.bars; p += 16) {
      const e = sec.start + p; const cut = p % 32 === 0 ? style.cut32 : style.cut16;
      const isBoundary = p === sec.bars && si < sections.length - 1 && sections[si + 1].energy - sec.energy > 0.25;
      if (isBoundary) continue; // handled by the transition engine
      for (const id of FOUNDATION) { const t = T(id); if (t) carve(t, e - cut, e); }
      const used = new Set<string>();
      fillOn(tracks, ['SNARE', 'CLAP', 'PERC1', 'HAT_C'], e - (p % 32 === 0 ? 2 : 1), p % 32 === 0 ? 2 : 1, frng, 'Phrase Fill', used);
      const rootSub = Math.max(30, Math.min(45, R <= 35 ? R + 12 : R));
      if (p % 32 === 0 && p < sec.bars) atomClip(T('IMPACT'), e, 1, rootSub, 0.45, '32-bar Sub Hit', 16);
    }
  });

  // 4) procedural transition atoms at every macro boundary
  sections.forEach((sec, si) => {
    if (si === sections.length - 1) return;
    const B = sec.start + sec.bars; const d = sections[si + 1].energy - sec.energy;
    addTransition(tracks, style, B, d, sec.bars, new Rng(hash(P.seed, 'tr', si, secSeed[sec.id] ?? 0)), undefined, R);
  });

  const scoreEnd=sections.reduce((end,s)=>Math.max(end,s.start+s.bars),0);
  for(const t of tracks){
    t.clips=t.clips.filter(c=>c.start<scoreEnd).map((c,i)=>({...c,len:Math.min(c.len,scoreEnd-c.start),id:`generated_${P.seed}_${t.id}_${c.start}_${c.len}_${i}`}));
  }
  // 5) automation
  const auto = genAuto(tracks, sections, P, levels);
  return { sections, tracks, auto, formId };
}

export function newProject(P: ComposeParams, o: GenOpts = {}, name?: string): Project {
  const g = generate(P, o);
  return {
    v: 1, id: uid('project'), revision: 1, name: name ?? `${STYLES[P.style].name} · ${P.seed}`, params: P, formId: g.formId, sections: g.sections, tracks: g.tracks, auto: g.auto,
    sc: defaultSc(), scOn: true, overrides: o.overrides ?? {}, secSeed: o.secSeed ?? {}, loop: { on: false, a: 0, b: 0 },
  };
}

/**
 * Creates a complete 'Ambient Techno' project template with extended loop phrases (192 bars, 'ambient' form),
 * deep spatial dub/reverb depth, and prioritized PAD & DRONE atmospheric layers.
 */
export function createAmbientTechnoTemplate(seed = 2049): Project {
  const base = defaultParams('ambient', seed);
  const P: ComposeParams = {
    ...base,
    style: 'ambient',
    form: 'ambient',
    bpm: 120,
    key: 2, // D Dorian / Minor
    scale: 'dorian',
    bars: 192,
    seed,
    density: 0.62,
    complexity: 0.56,
    swing: 0.56,
    acid: 0.42,
    poly: 0.64,
    dirt: 0.14,
    depth: 0.85,
    mode: 'hybrid',
  };
  return newProject(P, {}, `Ambient Techno · Horizon ${seed}`);
}

const overlaps = (c:Clip,s:Section)=>c.start<s.start+s.bars&&c.start+c.len>s.start;
const inRange = (bar: number, s: Section) => bar >= s.start - 1e-6 && bar < s.start + s.bars - 1e-6;

function evalLaneExact(lane: AutoLane, bar: number): number {
  const ps = lane.pts;
  if (!ps.length) return 0.5;
  if (bar <= ps[0].bar) return ps[0].v;
  for (let i = 1; i < ps.length; i++) {
    if (bar < ps[i].bar) {
      const a = ps[i - 1], b = ps[i];
      if (b.bar - a.bar < 0.02) return a.v;
      const t = Math.max(0, Math.min(1, (bar - a.bar) / (b.bar - a.bar)));
      const c = b.curve ?? 0;
      const k = Math.abs(c) < 1e-4 ? t : c > 0 ? Math.pow(t, 1 + c * 2.6) : 1 - Math.pow(1 - t, 1 - c * 2.6);
      return a.v + (b.v - a.v) * k;
    }
  }
  return ps[ps.length - 1].v;
}

function spliceLaneWithLocks(oldLane: AutoLane, newPts: { bar: number; v: number; curve?: number }[], lockedSecs: Section[]): AutoLane {
  if (!lockedSecs.length) return { ...oldLane, pts: cleanPts(newPts) };
  const cleanedNew = cleanPts(newPts).filter(
    (p) => !lockedSecs.some((s) => p.bar >= s.start - 1e-6 && p.bar <= s.start + s.bars + 1e-6)
  );
  const lockedPts: { bar: number; v: number; curve?: number }[] = [];
  for (const s of lockedSecs) {
    const a = s.start;
    const b = s.start + s.bars;
    lockedPts.push({ bar: a, v: evalLaneExact(oldLane, a) });
    for (const q of oldLane.pts) {
      if (q.bar > a && q.bar < b) lockedPts.push({ ...q });
    }
    lockedPts.push({ bar: b, v: evalLaneExact(oldLane, b) });
  }
  const combined = [...cleanedNew, ...lockedPts].sort((x, y) => x.bar - y.bar);
  const dedup: { bar: number; v: number; curve?: number }[] = [];
  for (const pt of combined) {
    const prev = dedup[dedup.length - 1];
    if (prev && Math.abs(pt.bar - prev.bar) < 1e-9) {
      prev.v = pt.v;
      if (pt.curve !== undefined) prev.curve = pt.curve;
    } else {
      dedup.push(pt);
    }
  }
  return { ...oldLane, pts: dedup };
}

/** Merge a freshly generated result into an existing project, protecting locks, mixer state and manual tracks. */
export function mergeGenerated(old: Project, gen: GenResult, keepStructure: boolean): Pick<Project, 'tracks' | 'auto' | 'sections' | 'formId'> {
  const lockedSecs = keepStructure ? old.sections.filter((s) => s.lock) : [];
  const tracks: Track[] = gen.tracks.map((nt) => {
    const ot = old.tracks.find((t) => t.id === nt.id);
    if (!ot) return nt;
    if (ot.lock) return ot;
    let clips = nt.clips;
    if (lockedSecs.length) clips = [...nt.clips.filter((c) => !lockedSecs.some((s) => overlaps(c, s))), ...ot.clips.filter((c) => lockedSecs.some((s) => overlaps(c, s)))];
    return { ...ot, clips };
  });
  for (const ot of old.tracks) {
    if (!gen.tracks.some((t) => t.id === ot.id) && (!ot.id.startsWith('t_') || ot.lock)) {
      tracks.push(ot);
    }
  }
  const finalTrackIds = new Set(tracks.map((t) => t.id));
  const lockedIds = new Set(tracks.filter((t) => t.lock).map((t) => t.id));
  const auto = lockedSecs.length
    ? old.auto
        .filter((oldLane) => oldLane.track === 'master' || finalTrackIds.has(oldLane.track))
        .map((oldLane) => {
          if (lockedIds.has(oldLane.track)) return oldLane;
          const genLane = gen.auto.find((a) => a.id === oldLane.id || (a.track === oldLane.track && a.param === oldLane.param));
          if (!genLane) return oldLane;
          return spliceLaneWithLocks(oldLane, genLane.pts, lockedSecs);
        })
    : [
        ...gen.auto.filter((a) => !lockedIds.has(a.track) && (a.track === 'master' || finalTrackIds.has(a.track))),
        ...old.auto.filter((a) => finalTrackIds.has(a.track) && (lockedIds.has(a.track) || !gen.tracks.some((t) => t.id === a.track))),
      ];
  const sections = keepStructure ? gen.sections.map((s) => { const o = old.sections.find((x) => x.id === s.id); return o?.lock ? o : o ? { ...s, lock: o.lock } : s; }) : gen.sections;
  return { tracks, auto, sections, formId: gen.formId };
}

/** Re-roll one section (or a single layer inside it) without touching anything else. */
export function regenSection(old: Project, secId: string, layerOnly?: string): Pick<Project, 'tracks' | 'auto' | 'secSeed'> {
  const sec = old.sections.find((s) => s.id === secId);
  if(!sec)throw new Error('Missing section');
  if(sec.lock)throw new Error('Section locked');
  const protectedSecs=old.sections.filter(s=>s.lock);
  const secSeed = { ...old.secSeed, [secId]: (old.secSeed[secId] ?? 0) + 1 };
  const gen = generate(old.params, { sections: old.sections, secSeed, overrides: old.overrides });
  const tracks = old.tracks.map((ot) => {
    if (ot.lock) return ot;
    if (layerOnly && ot.id !== layerOnly && ot.layer !== layerOnly) return ot;
    let nt = gen.tracks.find((t) => t.id === ot.id);
    if(!nt && layerOnly===ot.id && Object.prototype.hasOwnProperty.call(LAYERS,ot.layer)) {
      const instanceOverrides={...old.overrides};
      if(instanceOverrides[`${secId}:${ot.id}`]!==undefined)instanceOverrides[`${secId}:${ot.layer}`]=instanceOverrides[`${secId}:${ot.id}`];
      const candidate=generate({...old.params,seed:hash(old.params.seed,ot.id),density:1},{layers:[ot.layer],sections:old.sections,secSeed,overrides:instanceOverrides}).tracks.find(t=>t.layer===ot.layer);
      if(candidate)nt={...candidate,id:ot.id,clips:candidate.clips.map(c=>({...c,id:`${ot.id}_${c.id}`}))};
    }
    if (!nt) return ot;
    const keepTrack={...ot,clips:structuredClone(ot.clips.filter(c=>!protectedSecs.some(s=>overlaps(c,s))))};
    carve(keepTrack,sec.start,sec.start+sec.bars);
    const lockedClips=ot.clips.filter(c=>protectedSecs.some(s=>overlaps(c,s)));
    const add = nt.clips.filter(c=>overlaps(c,sec)&&!protectedSecs.some(s=>overlaps(c,s))).map(c=>{
      const start=Math.max(sec.start,c.start),end=Math.min(sec.start+sec.bars,c.start+c.len);
      return {...c,id:`regen_${secSeed[secId]}_${c.id}`,start,len:end-start,off:(c.off+(start-c.start)*16)%c.loop};
    });
    const unlockedClips=[...keepTrack.clips,...add].sort((a,b)=>a.start-b.start);
    return { ...ot, clips: [...unlockedClips, ...lockedClips] };
  });
  const auto: AutoLane[] = old.auto.map((lane) => {
    const g = gen.auto.find((a) => a.id === lane.id);
    if (!g || old.tracks.find((t) => t.id === lane.track)?.lock) return lane;
    if (layerOnly && lane.track !== layerOnly && old.tracks.find((t) => t.id === lane.track)?.layer !== layerOnly) return lane;
    const pts = [...lane.pts.filter((p) => !inRange(p.bar, sec)), ...g.pts.filter((p) => inRange(p.bar, sec))];
    return spliceLaneWithLocks(lane, pts, protectedSecs);
  });
  if (!protectedSecs.length) {
    for (const g of gen.auto) if (!auto.some((a) => a.id === g.id)) auto.push(g);
  }
  return { tracks, auto, secSeed };
}

export function sectionLayers(style: string) { return STYLES[style].layers.filter((l) => !ATOM_LAYERS.includes(l)); }
export const paramList: AutoParam[] = ['cutoff', 'res', 'rev', 'vol', 'hp'];
