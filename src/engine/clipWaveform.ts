import type { Clip, Note, SynthKind, Track } from './types';
import { clamp, midiHz, Rng } from './theory';
import { makeNoise, playVoice, type TrackCtl, type VEnv } from './voices';

const stepDurOf = (bpm: number) => 60 / Math.max(40, bpm) / 4;

export interface NoteWaveformSlice {
  noteIndex: number;
  pitch: number;
  startStep: number;
  endStep: number;
  samples: Float32Array;
}

export interface ClipWaveformData {
  binsPerStep: number;
  totalSteps: number;
  min: Float32Array;
  max: Float32Array;
  rms: Float32Array;
  noteSlices: NoteWaveformSlice[];
}

function synthTailSteps(synth: SynthKind, cutoff: number): number {
  switch (synth) {
    case 'kick':
    case 'tom':
    case 'conga':
      return 1.8;
    case 'sub':
    case 'rumble':
    case 'midbass':
      return 1.4;
    case 'acid':
      return 0.9 + cutoff * 0.8;
    case 'pad':
    case 'drone':
      return 4.5;
    case 'dubchord':
    case 'stab':
      return 3.2;
    case 'crash':
    case 'ohat':
    case 'ride':
      return 3.6;
    case 'impact':
    case 'downlift':
      return 4.0;
    case 'riser':
      return 1.2;
    default:
      return 1.2;
  }
}

/**
 * Computes a deterministic, step-aligned synth waveform representation for a MIDI clip
 * reflecting the track's synth engine archetype, filter cutoff/resonance, 303 accents/slides,
 * micro-timing offsets, and release tails.
 */
export function computeAnalyticalClipWaveform(
  track: Pick<Track, 'synth' | 'cutoff' | 'res' | 'vol'>,
  clip: Pick<Clip, 'loop' | 'notes' | 'gain' | 'transpose'>,
  bpm = 132,
  binsPerStep = 16
): ClipWaveformData {
  const totalSteps = Math.max(1, clip.loop);
  const totalBins = totalSteps * binsPerStep;
  const min = new Float32Array(totalBins);
  const max = new Float32Array(totalBins);
  const rms = new Float32Array(totalBins);
  const noteSlices: NoteWaveformSlice[] = [];

  const sorted = [...clip.notes]
    .map((n, idx) => ({ n, idx }))
    .sort((a, b) => a.n.t + (a.n.micro ?? 0) - (b.n.t + (b.n.micro ?? 0)));

  const tailSteps = synthTailSteps(track.synth, track.cutoff);
  const trackGain = clamp(track.vol * (clip.gain ?? 1), 0.05, 1.5);
  const cutNorm = clamp(track.cutoff, 0, 1);
  const resNorm = clamp(track.res, 0, 1);
  const stepSec = stepDurOf(bpm);

  for (let sIdx = 0; sIdx < sorted.length; sIdx++) {
    const { n, idx } = sorted[sIdx];
    if (n.v <= 0) continue;
    const prev = sIdx > 0 ? sorted[sIdx - 1].n : undefined;
    const startStep = clamp(n.t + (n.micro ?? 0), 0, totalSteps);
    const gateSteps = Math.max(0.25, n.d);
    const totalDurSteps = gateSteps + (n.slide ? 0.35 : tailSteps);
    const endStep = Math.min(totalSteps, startStep + totalDurSteps);
    const sliceBins = Math.max(4, Math.ceil((endStep - startStep) * binsPerStep));
    const samples = new Float32Array(sliceBins);

    const pitch = clamp(n.p + (clip.transpose ?? 0), 12, 108);
    const hz = midiHz(pitch);
    const prevHz = prev && n.slide ? midiHz(clamp(prev.p + (clip.transpose ?? 0), 12, 108)) : hz;
    const vel = clamp(n.v * (n.acc ? 1.28 : 1.0) * trackGain, 0.05, 1.35);

    let phase = (idx * 1.17) % (Math.PI * 2);
    for (let b = 0; b < sliceBins; b++) {
      const stepOffset = b / binsPerStep;
      const normGate = stepOffset / gateSteps;
      const normTotal = stepOffset / Math.max(0.25, totalDurSteps);
      const tSec = stepOffset * stepSec;

      // Amplitude envelope modeled per synth archetype
      let env = 0;
      if (track.synth === 'riser') {
        env = Math.pow(clamp(normGate, 0, 1), 1.65) * (normGate <= 1.05 ? 1 : Math.exp(-(normGate - 1.05) * 4));
      } else if (track.synth === 'pad' || track.synth === 'drone') {
        const atk = Math.min(1, stepOffset / Math.max(0.8, gateSteps * 0.32));
        const rel = normGate <= 1 ? 1 : Math.exp(-(stepOffset - gateSteps) / Math.max(1.2, tailSteps * 0.45));
        env = atk * rel;
      } else if (track.synth === 'kick' || track.synth === 'impact' || track.synth === 'tom' || track.synth === 'conga') {
        const atk = Math.min(1, stepOffset / 0.08);
        env = atk * Math.exp(-stepOffset * (track.synth === 'impact' ? 0.65 : 1.55));
      } else if (track.synth === 'hat' || track.synth === 'ohat' || track.synth === 'crash' || track.synth === 'clap' || track.synth === 'snare') {
        const atk = Math.min(1, stepOffset / 0.05);
        const decayRate = track.synth === 'crash' ? 0.85 : track.synth === 'ohat' ? 1.6 : 3.2;
        env = atk * Math.exp(-stepOffset * decayRate);
      } else if (track.synth === 'acid') {
        const atk = Math.min(1, stepOffset / 0.06);
        const dec = Math.exp(-stepOffset * (n.acc ? 1.35 : 2.1) * (1.25 - cutNorm * 0.5));
        const gateTail = normGate <= 1 ? 1 : Math.exp(-(stepOffset - gateSteps) * (n.slide ? 1.8 : 4.2));
        env = atk * (0.28 + 0.72 * dec) * gateTail;
      } else {
        const atk = Math.min(1, stepOffset / 0.1);
        const dec = normGate <= 1 ? 0.55 + 0.45 * Math.exp(-stepOffset * 1.4) : Math.exp(-(stepOffset - gateSteps) * 2.4);
        env = atk * dec;
      }

      // Instantaneous frequency (handling kick drops, riser sweeps, 303 slides)
      let instHz = hz;
      if (track.synth === 'kick' || track.synth === 'impact') {
        instHz = 42 + 110 * Math.exp(-tSec * 22);
      } else if (track.synth === 'riser') {
        instHz = hz * Math.pow(2, clamp(normGate, 0, 1));
      } else if (track.synth === 'downlift') {
        instHz = hz * Math.pow(0.35, clamp(normTotal, 0, 1));
      } else if (n.slide && prev) {
        const glide = clamp(stepOffset / 0.65, 0, 1);
        instHz = prevHz + (hz - prevHz) * glide;
      }

      // Visual carrier cycles scaled so waveforms are crisp and legible at Piano Roll zoom levels
      const visualCyclesPerStep = clamp(instHz / 55, 1.2, 6.5);
      phase += (visualCyclesPerStep * Math.PI * 2) / binsPerStep;

      let wave = Math.sin(phase);
      if (track.synth === 'acid' || track.synth === 'midbass' || track.synth === 'lead' || track.synth === 'stab') {
        // Resonant diode-ladder harmonic overtone + sawtooth character
        const resHarm = Math.sin(phase * (2 + Math.round(resNorm * 3))) * (0.25 + resNorm * 0.55) * Math.exp(-stepOffset * 1.8);
        wave = Math.tanh((wave * 0.75 + Math.sin(phase * 2) * 0.35 + resHarm) * (1.2 + (n.acc ? 0.8 : 0.2)));
      } else if (track.synth === 'hat' || track.synth === 'ohat' || track.synth === 'crash' || track.synth === 'ride' || track.synth === 'noise' || track.synth === 'shaker') {
        // High-frequency metallic shimmer + filtered noise texture
        const m1 = Math.sin(phase * 3.17) * Math.cos(phase * 4.71);
        const m2 = Math.sin(phase * 6.13 + b * 1.7);
        wave = (m1 * 0.6 + m2 * 0.4) * (n.p === 1 && track.synth === 'crash' ? Math.pow(clamp(normGate, 0, 1), 1.8) : 1);
      } else if (track.synth === 'pad' || track.synth === 'dubchord' || track.synth === 'drone') {
        wave = (Math.sin(phase) * 0.55 + Math.sin(phase * 1.5 + 0.4) * 0.3 + Math.sin(phase * 2.01) * 0.15);
      } else if (track.synth === 'kick' || track.synth === 'sub' || track.synth === 'rumble' || track.synth === 'impact') {
        wave = Math.tanh(Math.sin(phase) * 1.45);
      }

      const sampleVal = clamp(wave * env * vel, -1, 1);
      samples[b] = sampleVal;

      const globalBin = (Math.floor(startStep * binsPerStep) + b) % totalBins;
      if (globalBin >= 0 && globalBin < totalBins) {
        if (sampleVal < min[globalBin]) min[globalBin] = sampleVal;
        if (sampleVal > max[globalBin]) max[globalBin] = sampleVal;
        rms[globalBin] = Math.min(1, Math.hypot(rms[globalBin], sampleVal * 0.78));
      }
    }

    noteSlices.push({
      noteIndex: idx,
      pitch: n.p,
      startStep,
      endStep,
      samples,
    });
  }

  return {
    binsPerStep,
    totalSteps,
    min,
    max,
    rms,
    noteSlices,
  };
}

/**
 * Renders the clip's notes through the actual Web Audio `playVoice` engine on an OfflineAudioContext
 * and updates the step-aligned min/max/rms waveform bins for exact DSP visual alignment.
 */
export async function renderOfflineClipWaveform(
  track: Pick<Track, 'synth' | 'cutoff' | 'res' | 'vol'>,
  clip: Pick<Clip, 'loop' | 'notes' | 'gain' | 'transpose'>,
  bpm = 132,
  dirt = 0.25,
  binsPerStep = 16
): Promise<Pick<ClipWaveformData, 'min' | 'max' | 'rms'> | null> {
  if (typeof window === 'undefined') return null;
  const OfflineCtx =
    window.OfflineAudioContext ||
    (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!OfflineCtx) return null;

  try {
    const totalSteps = Math.max(1, Math.min(128, clip.loop));
    const stepDur = stepDurOf(bpm);
    const totalSec = Math.max(0.25, Math.min(16, totalSteps * stepDur));
    const sampleRate = 12000;
    const totalFrames = Math.max(256, Math.floor(totalSec * sampleRate));
    const ctx = new OfflineCtx(1, totalFrames, sampleRate);

    const cutNode = ctx.createGain();
    cutNode.gain.value = (track.cutoff - 0.5) * 2800;
    const resNode = ctx.createGain();
    resNode.gain.value = (track.res - 0.3) * 8;
    const ctl: TrackCtl = { cutoff: cutNode, res: resNode };

    const masterGain = ctx.createGain();
    masterGain.gain.value = clamp(track.vol * (clip.gain ?? 1), 0.05, 1.4);
    masterGain.connect(ctx.destination);

    const rng = new Rng(101);
    const vEnv: VEnv = {
      ctx,
      noise: makeNoise(ctx, 77),
      dirt,
      stepDur,
      random: () => rng.next(),
      sources: new Set(),
      onStart: () => {},
      onEnd: () => {},
    };

    const sorted = [...clip.notes].sort((a, b) => a.t - b.t);
    let lastHz: number | undefined;
    for (const n of sorted) {
      const startStep = n.t + (n.micro ?? 0);
      if (startStep < 0 || startStep >= totalSteps) continue;
      const t0 = Math.max(0, startStep * stepDur);
      if (t0 >= totalSec - 0.01) continue;
      const durSec = Math.max(0.03, n.d * stepDur);
      const pitchedNote: Note = {
        ...n,
        p: clamp(n.p + (clip.transpose ?? 0), 0, 127),
      };
      lastHz = playVoice(track.synth, vEnv, masterGain, t0, durSec, pitchedNote, ctl, n.slide ? lastHz : undefined);
    }

    const rendered = await ctx.startRendering();
    const pcm = rendered.getChannelData(0);
    const totalBins = totalSteps * binsPerStep;
    const min = new Float32Array(totalBins);
    const max = new Float32Array(totalBins);
    const rms = new Float32Array(totalBins);
    const samplesPerBin = pcm.length / totalBins;

    let peakAbs = 0.001;
    for (let i = 0; i < pcm.length; i++) {
      const a = Math.abs(pcm[i]);
      if (a > peakAbs) peakAbs = a;
    }
    const normScale = peakAbs > 0.01 ? Math.min(2.2, 0.92 / peakAbs) : 1;

    for (let b = 0; b < totalBins; b++) {
      const i0 = Math.floor(b * samplesPerBin);
      const i1 = Math.min(pcm.length, Math.max(i0 + 1, Math.floor((b + 1) * samplesPerBin)));
      let lo = 0;
      let hi = 0;
      let sumSq = 0;
      for (let i = i0; i < i1; i++) {
        const s = clamp(pcm[i] * normScale, -1, 1);
        if (s < lo) lo = s;
        if (s > hi) hi = s;
        sumSq += s * s;
      }
      min[b] = lo;
      max[b] = hi;
      rms[b] = Math.sqrt(sumSq / Math.max(1, i1 - i0));
    }

    return { min, max, rms };
  } catch {
    return null;
  }
}
