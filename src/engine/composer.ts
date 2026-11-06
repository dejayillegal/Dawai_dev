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
  const { rng, P } = c; const out: PN[] = []; const pool = [0, 0, 0, 2, 3, 4, 0, 6, 1, 4];
  let prev = -2;
  for (let s = 0; s < len; s++) {
    const m = s % 4; const w = m === 2 ? 0.92 : m === 3 ? 0.78 : m === 1 ? 0.55 : 0.42;
    if (rng.next() > w * (1 - restP) + 0.05) { prev = -2; continue; }
    let p = degree(base, P.scale, rng.pick(pool));
    if (rng.chance(octP)) p += 12;
    const acc = rng.chance(accP * (m === 3 || m === 1 ? 1.3 : 0.8));
    const slide = prev === s - 1 && rng.chance(slP);
    out.push({ t: s, d: slide ? 1.15 : 0.85, p, v: acc ? 1 : 0.72, acc, slide, pri: (1 - w) * 0.6 + rng.next() * 0.4 });
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
  const isHypnoticFamily = style.id === 'hypnotic' || style.id === 'minimal_groover' || style.id === 'mental_tribal';
  switch (l.id) {
    case 'KICK':
      for (const s of [0, 4, 8, 12]) add(s, 1, 36, 1, 0);
      if (style.kick === 'ghost') { add(7.5, 0.5, 36, 0.4, 0.7); add(15, 0.5, 36, 0.35, 0.85); }
      if (style.id === 'schranz') { add(3.5, 0.5, 36, 0.52, 0.45); add(11.5, 0.5, 36, 0.58, 0.35); add(14.5, 0.5, 36, 0.48, 0.6); }
      break;
    case 'SUB':
      if (style.id === 'hypnotic' || style.id === 'minimal_groover') {
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
      if (isHypnoticFamily) {
        for (const beat of [0, 4, 8, 12]) {
          add(beat + 1.5, 0.75, R, 0.56, 0.15, { micro: -0.015 });
          add(beat + 2.5, 0.85, R, 0.78, 0.08, { micro: 0.015 });
          add(beat + 3.25, 0.65, R, 0.68, 0.22, { micro: 0.025 });
        }
      }
      break;
    case 'MIDBASS':
      for (let s = 0; s < 16; s++) {
        if (s % 4 === 0) continue;
        const off = s % 4 === 2;
        add(s, 0.85, off ? R : rng.pick([R, R, degree(R, P.scale, 2), degree(R, P.scale, 4), R + 12]), off ? 0.95 : 0.75, off ? 0.05 : rng.range(0.3, 1));
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
      if (isHypnoticFamily) {
        loop = 12;
        const pat = euclid(5, 12, rng.int(0, 11));
        // Key-locked low-mid woody/skin analog register (no high digital bleep pitches)
        const pool = [R + 12, degree(R + 12, P.scale, 1), degree(R + 12, P.scale, 4), R + 19];
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
      const pool = isHypnoticFamily ? [R + 12, degree(R + 12, P.scale, 2), degree(R + 12, P.scale, 4), R + 19] : [52, 55, 59, 62];
      euclid(k, loop, rng.int(0, loop - 1)).forEach((h, i) => {
        if (h) add(i, 0.75, pool[i % pool.length], 0.45 + rng.next() * 0.35, i % 4 === 0 ? 0.15 : rng.next() * 0.85, isHypnoticFamily ? { micro: i % 2 === 0 ? 0.018 : -0.018 } : {});
      });
      break;
    }
    case 'CONGA': {
      const pool = isHypnoticFamily ? [R + 12, degree(R + 12, P.scale, 3), degree(R + 12, P.scale, 4)] : [50, 53, 55];
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
      if (isHypnoticFamily) {
        // Driving syncopated low-tom warehouse pulse interlocking with kick and offbeat sub
        const tomPitches = [R, degree(R, P.scale, 4), R + 7];
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
      if (style.id === 'schranz') {
        loop = 16;
        for (const s of [2, 6, 10, 14, 3, 11, 15]) add(s, 0.75, rng.int(52, 64), s % 4 === 2 ? 0.85 : 0.55, s % 4 === 2 ? 0.1 : 0.45);
      } else {
        loop = 32;
        for (let i = 0; i < 5; i++) add(rng.pick([3, 7, 11, 13, 19, 23, 27, 29, 31]), 1, rng.int(50, 66), 0.5 + rng.next() * 0.4, rng.next());
      }
      break;
    case 'ACID1': {
      const base = R + 12;
      if (style.id === 'hypnotic' || style.id === 'mental_tribal') {
        loop = 12; // 12-step polymetric analog 303 bass cycle against 16-step kick
        const tones = [0, 0, 1, 0, 4, 1, 0, 3];
        for (let s = 0; s < loop; s++) {
          if (s % 4 === 0 && rng.chance(0.22)) continue;
          const acc = s === 2 || s === 7 || s === 10;
          const slide = s === 3 || s === 8;
          add(s, slide ? 1.15 : 0.82, degree(base, P.scale, tones[s % tones.length]), acc ? 0.92 : 0.68, acc ? 0.08 : 0.32 + (s / loop) * 0.35, { acc, slide });
        }
      } else {
        const a = acidLine(c, base, 16, 0.22 + P.acid * 0.28, 0.16 + P.acid * 0.22, 0.12, 0.2 - P.acid * 0.1);
        if (style.id === 'acid') { loop = 32; const b = mutate(a, 16, 'oct', rng) as PN[]; N.push(...a, ...b.map((n, i) => ({ ...n, t: n.t + 16, pri: a[i].pri }))); }
        else N.push(...a);
      }
      break;
    }
    case 'ACID2': {
      loop = 32; const base = R + 12; const a = acidLine(c, base, 16, 0.4 + P.acid * 0.3, 0.3, 0.25, 0.35 - P.acid * 0.1);
      const b = acidLine(c, base, 16, 0.5 + P.acid * 0.3, 0.35, 0.25, 0.3);
      N.push(...a, ...b.map((n) => ({ ...n, t: n.t + 16 })));
      break;
    }
    case 'STAB': {
      if (style.id === 'hypnotic') {
        loop = 16; // Relentless warm analog warehouse chord stab groove (low-mid chest register R+12)
        const hits = [2, 5.5, 10, 13.5];
        hits.forEach((h, hi) => {
          const chord = chordPitches(c, R + 12, 0, [0, 2, 4]);
          chord.forEach((p, k) => add(h, k === 0 ? 1.35 : 1.05, p, 0.68 + (hi % 2) * 0.16, hi * 0.12, { micro: hi % 2 === 1 ? 0.02 : 0 }));
        });
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
      starts.forEach((s, i) => { deg += rng.pick([-1, 0, 1, 2, -2]); call.push({ t: s, d: rng.pick([2, 3, 4]), p: degree(base, P.scale, clamp(deg, -3, 5)), v: 0.8, pri: i * 0.15 }); });
      call.forEach((n) => add(n.t, n.d, n.p, n.v, n.pri));
      call.forEach((n, i) => add(n.t + 32, n.d, i > 3 ? n.p + 2 : n.p, 0.75, n.pri + 0.05));
      break;
    }
    case 'ARP': {
      if (isHypnoticFamily) {
        loop = 12; // 12-step polymetric warm analog VCO sequence in dark low-mid register (R+12, zero high digital jumps)
        const tones = [0, 0, 1, 4, 0, 1, 3, 4, 0, 1, 4, 1];
        const base = R + 12;
        for (let s = 0; s < loop; s++) {
          const acc = s === 2 || s === 6 || s === 9;
          add(
            s,
            acc ? 0.9 : 0.7,
            degree(base, P.scale, tones[s % tones.length]),
            acc ? 0.9 : 0.68 + (s % 2) * 0.08,
            acc ? 0.04 : 0.14 + (s % 4) * 0.12,
            { acc, micro: s % 3 === 2 ? 0.022 : s % 3 === 1 ? -0.015 : 0 }
          );
        }
      } else {
        const tones = [0, 2, 4, 6, 7, 4, 2, 0];
        const base = R + 12;
        loop = 16;
        for (let s = 0; s < loop; s++) if (rng.chance(0.88)) add(s, 0.8, degree(base, P.scale, tones[s % tones.length]), 0.55 + (s % 3 === 0 ? 0.22 : 0), s % 3 === 0 ? 0.1 : rng.range(0.2, 0.95));
      }
      break;
    }
    case 'PAD': {
      loop = 128;
      for (let i = 0; i < 4; i++) {
        const ps = chordPitches(c, R + 12, style.prog[i % style.prog.length], [0, 2, 4, 6]);
        ps.forEach((p, k) => add(i * 32, 34, p, 0.55, k === 3 ? 0.5 : 0));
      }
      break;
    }
    case 'DUB': {
      loop = 24;
      if (isHypnoticFamily) {
        const hits = [3, 11, 18];
        hits.forEach((h, hi) =>
          chordPitches(c, R + 12, 0, [0, 2, 4, 6]).forEach((p, k) =>
            add(h, 3.8, p, 0.76 - k * 0.04, hi * 0.14 + (k === 3 ? 0.1 : 0), { micro: 0.02 })
          )
        );
      } else {
        const hits = [2, 5, 9, 14, 18, 21].sort(() => rng.next() - 0.5).slice(0, 3).sort((a, b) => a - b);
        hits.forEach((h, hi) => chordPitches(c, R + 12, style.prog[hi % style.prog.length], [0, 2, 4, 6, 8]).forEach((p, k) => add(h, 3, p, 0.7, hi * 0.3 + (k === 4 ? 0.1 : 0))));
      }
      break;
    }
    case 'DRONE': loop = 64; add(0, 64, R + 12, 0.66, 0); add(0, 64, degree(R + 12, P.scale, 4), 0.48, 0.05); break;
    case 'TEX': loop = 64; add(0, 64, 60, 0.5, 0); break;
    case 'CRACKLE': for (let i = 0; i < 7; i++) add(rng.range(0, 16), 0.2, 80, 0.3 + rng.next() * 0.5, rng.next()); break;
  }
  N.sort((a, b) => a.t - b.t);
  return { loop, notes: N };
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

export function addTransition(tracks: Track[], style: StyleDef, B: number, delta: number, room: number, rng: Rng, force?: 'up' | 'down' | 'mid') {
  const T = (id: string) => tracks.find((t) => t.layer === id);
  const kind = force ?? (delta > 0.25 ? 'up' : delta < -0.2 ? 'down' : 'mid');
  const used = new Set<string>();
  const isHypnotic = style.id === 'hypnotic' || style.id === 'minimal_groover' || style.id === 'mental_tribal';

  if (kind === 'up') {
    const rb = isHypnotic ? Math.min(4, Math.floor(room)) : Math.max(2, Math.min(8, Math.floor(room)));
    atomClip(T('RISER'), B - rb, rb, 60, isHypnotic ? 0.55 : 0.85, 'Riser Atom');
    const fb = Math.max(1, Math.min(2, Math.floor(room)));
    if (isHypnotic) {
      // In hypnotic techno, use dark tom/conga rolls instead of aggressive snare rolls
      fillOn(tracks, ['TOM', 'CONGA', 'PERC1', 'PERC2'], B - fb, fb, rng, 'Tribal Roll', used);
    } else {
      fillOn(tracks, ['SNARE', 'CLAP', 'PERC1', 'HAT_C'], B - fb, fb, rng, 'Snare Roll', used);
      fillOn(tracks, ['TOM', 'PERC1', 'CONGA', 'PERC2'], B - fb, fb, rng, 'Perc Roll', used);
    }
    const vb = Math.min(style.void, Math.max(1, Math.floor(room)));
    for (const id of FOUNDATION) { const t = T(id); if (t) carve(t, B - vb, B); }
    atomClip(T('CRASH'), B - 1, 1, 1, isHypnotic ? 0.48 : 0.8, 'Reverse Swell', 16);
    atomClip(T('IMPACT'), B, 2, 60, isHypnotic ? 0.75 : 1, 'Sub Impact', 16);
    const cr = T('CRASH');
    if (cr && !isHypnotic) {
      carve(cr, B, B + 2);
      cr.clips.push(mkClip(B, 2, 32, [{ t: 0, d: 16, p: 0, v: 0.85 }], 'Crash'));
    }
  } else if (kind === 'down') {
    atomClip(T('DOWNLIFT'), B, 4, 60, isHypnotic ? 0.52 : 0.8, 'Downlifter + Noise Wash', 64);
    const im = T('IMPACT'); if (im) atomClip(im, B, 1, 60, isHypnotic ? 0.42 : 0.55, 'Soft Impact', 16);
  } else {
    atomClip(T('IMPACT'), B, 1, 60, isHypnotic ? 0.38 : 0.5, 'Phrase Hit', 16);
    if (rng.chance(0.6)) {
      if (isHypnotic) fillOn(tracks, ['TOM', 'CONGA', 'PERC1', 'HAT_C'], B - 1, 1, rng, 'Phrase Fill', used);
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

  const coreAlways = P.style === 'hypnotic'
    ? ['KICK', 'SUB', 'RUMBLE', 'TOM', 'CONGA', 'HAT_C', 'SHAKER', 'PERC1', 'PERC2', 'ARP', 'STAB', 'DUB', 'ACID1', 'DRONE', ...ATOM_LAYERS]
    : ['KICK', 'SUB', 'HAT_C', 'PERC1', ...ATOM_LAYERS];
  const selected = (o.layers ?? style.layers).filter(
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
  for (const tr of tracks) {
    const l = LAYERS[tr.layer];
    if (l.group === 'Transition') continue;
    const pat = genPattern(l, { rng: new Rng(hash(P.seed, l.id, 'pat')), style, P, R });
    const lv = levels[l.id];
    sections.forEach((sec, si) => {
      if (lv[si] < 0.02) return;
      const rng = new Rng(hash(P.seed, l.id, si, secSeed[sec.id] ?? 0));
      const prev = si > 0 ? lv[si - 1] : 0; const next = si < sections.length - 1 ? lv[si + 1] : 0;
      let start = sec.start; let end = sec.start + sec.bars;
      // staggered entrance
      if (si === 0 && l.id !== 'KICK' && !(P.style === 'hypnotic' && hypImmediate.has(l.id))) {
        const d = l.group === 'Texture' || l.group === 'Harmony' ? rng.pick([0, 0, 4]) : rng.pick([4, 8, 8, 12]);
        if (d < sec.bars * 0.6) start += d;
      } else if (prev < 0.02 && sec.bars >= 16 && l.group !== 'Foundation' && !(P.style === 'hypnotic' && hypImmediate.has(l.id))) {
        const d = rng.pick([0, 0, 4, 8]); if (d < sec.bars / 2) start += d;
      }
      // staggered exit
      if (sec.role === 'OUTRO') {
        const frac = l.id === 'KICK' ? 1 : l.group === 'Character' ? rng.range(0.25, 0.45) : l.group === 'Harmony' ? rng.range(0.6, 0.8) : l.group === 'Foundation' ? rng.range(0.7, 0.85) : rng.range(0.5, 0.85);
        end = sec.start + Math.max(4, Math.round((sec.bars * frac) / 2) * 2);
      } else if (next < 0.02 && sec.bars >= 16 && l.group !== 'Harmony' && l.group !== 'Texture') {
        const d = rng.pick([0, 0, 2, 4]); if (d < sec.bars / 2) end -= d;
      }
      if (end - start < 1) return;
      const ph = Math.min(l.phrase, sec.bars);
      let cur = start; let ci = 0;
      while (cur < end - 1e-6) {
        const gridEnd = sec.start + (Math.floor((cur - sec.start) / ph + 1e-9) + 1) * ph;
        const ce = Math.min(end, gridEnd);
        const prog = (ce - sec.start) / sec.bars;
        const lvc = clamp(lv[si] * (0.78 + 0.22 * prog));
        let notes = thin(pat.notes as PN[], lvc);
        if (l.melodic && l.group === 'Character') {
          if (sec.role === 'DROP_PEAK') { notes = mutate(notes, pat.loop, 'acc', rng); if (ci % 2 === 1) notes = mutate(notes, pat.loop, 'oct', rng); }
          else if (sec.role === 'VARIATION') notes = mutate(notes, pat.loop, 'rot', rng);
          else if (sec.role === 'OUTRO') notes = mutate(notes, pat.loop, 'frag', rng);
        } else if (sec.role === 'VARIATION' && l.group === 'Groove') notes = mutate(notes, pat.loop, 'rot', rng);
        if (ci > 0 && rng.chance(0.4 + P.complexity * 0.35)) {
          const k = l.melodic && l.group !== 'Harmony' ? rng.pick(['rest', 'oct', 'rot'] as const) : l.group === 'Groove' ? rng.pick(['rest', 'rot'] as const) : 'rest';
          notes = mutate(notes, pat.loop, k, rng);
        }
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
      if (p % 32 === 0 && p < sec.bars) atomClip(T('IMPACT'), e, 1, 60, 0.45, '32-bar Hit', 16);
    }
  });

  // 4) procedural transition atoms at every macro boundary
  sections.forEach((sec, si) => {
    if (si === sections.length - 1) return;
    const B = sec.start + sec.bars; const d = sections[si + 1].energy - sec.energy;
    addTransition(tracks, style, B, d, sec.bars, new Rng(hash(P.seed, 'tr', si, secSeed[sec.id] ?? 0)));
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
  for (const ot of old.tracks) if (!gen.tracks.some((t) => t.id === ot.id)) tracks.push(ot);
  const lockedIds = new Set(tracks.filter((t) => t.lock).map((t) => t.id));
  const auto = lockedSecs.length
    ? old.auto.map((oldLane) => {
        if (lockedIds.has(oldLane.track)) return oldLane;
        const genLane = gen.auto.find((a) => a.id === oldLane.id || (a.track === oldLane.track && a.param === oldLane.param));
        if (!genLane) return oldLane;
        return spliceLaneWithLocks(oldLane, genLane.pts, lockedSecs);
      })
    : [
        ...gen.auto.filter((a) => !lockedIds.has(a.track)),
        ...old.auto.filter((a) => lockedIds.has(a.track) || (a.track !== 'master' && !gen.tracks.some((t) => t.id === a.track))),
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
