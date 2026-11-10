import type { Note, SynthKind } from './types';
import { midiHz, Rng } from './theory';

export interface TrackCtl { cutoff: AudioNode; res: AudioNode }
export interface VEnv { ctx: BaseAudioContext; noise: AudioBuffer; dirt: number; stepDur: number; random: () => number; sources: Set<AudioScheduledSourceNode>; onStart(): void; onEnd(): void }

const curves = new Map<number, Float32Array<ArrayBuffer>>();
function curve(k: number): Float32Array<ArrayBuffer> {
  const key = Math.max(1, Math.round(k * 4));
  let c = curves.get(key);
  if (!c) {
    c = new Float32Array(new ArrayBuffer(512 * 4));
    const drive = key / 4;
    const norm = Math.tanh(drive);
    for (let i = 0; i < 512; i++) {
      const x = (i / 511) * 2 - 1;
      const biased = x + 0.055 * x * x - 0.055;
      c[i] = Math.tanh(biased * drive) / norm;
    }
    curves.set(key, c);
  }
  return c;
}

export const makeNoise = (ctx: BaseAudioContext, seed = 1) => {
  const rng = new Rng(seed);
  const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = b.getChannelData(0);
  // Warm pink-tinted analog noise
  let b0 = 0;
  let b1 = 0;
  for (let i = 0; i < d.length; i++) {
    const w = rng.next() * 2 - 1;
    b0 = 0.96 * b0 + w * 0.04;
    b1 = 0.82 * b1 + w * 0.18;
    d[i] = w * 0.52 + b1 * 0.34 + b0 * 0.14;
  }
  return b;
};

type Src = AudioScheduledSourceNode;
function done(env: VEnv, srcs: Src[], endT: number, tail: AudioNode, cleanup: (() => void)[] = []) {
  const safeEnd = Math.max(env.ctx.currentTime + 0.01, endT);
  srcs.forEach((s) => {
    env.sources.add(s);
    s.stop(safeEnd);
  });
  env.onStart();
  srcs[0].onended = () => {
    srcs.forEach((s) => {
      env.sources.delete(s);
      try { s.disconnect(); } catch {}
    });
    try { tail.disconnect(); } catch {}
    cleanup.forEach((f) => {
      try { f(); } catch {}
    });
    env.onEnd();
  };
}

function bindCutoff(ctl: TrackCtl, f: BiquadFilterNode, cl: (() => void)[], res = false) {
  ctl.cutoff.connect(f.detune);
  cl.push(() => {
    try { ctl.cutoff.disconnect(f.detune); } catch {}
  });
  if (res) {
    ctl.res.connect(f.Q);
    cl.push(() => {
      try { ctl.res.disconnect(f.Q); } catch {}
    });
  }
}

/**
 * Click-free ADSR envelope generator.
 * Avoids mixing setTargetAtTime with scheduled ramps to prevent Web Audio timeline discontinuities.
 */
function adsr(p: AudioParam, t: number, a: number, peak: number, d: number, s: number, dur: number, r: number): number {
  const sus = Math.max(0.0005, s);
  const safePeak = Math.max(0.0005, peak);
  const atk = Math.max(0.0025, a);
  const rel = Math.max(0.01, r);
  p.setValueAtTime(0.0001, t);
  p.linearRampToValueAtTime(safePeak, t + atk);
  const dEnd = Math.min(t + atk + d, t + Math.max(dur, atk + 0.004));
  const lvl = Math.max(0.0002, safePeak * Math.pow(sus, d > 0 ? Math.min(1, (dEnd - t - atk) / d) : 1));
  if (d > 0 && dEnd > t + atk + 0.001) {
    p.exponentialRampToValueAtTime(lvl, dEnd);
  }
  const rs = Math.max(dEnd, t + dur);
  p.setValueAtTime(lvl, rs);
  p.exponentialRampToValueAtTime(0.0001, rs + rel);
  p.linearRampToValueAtTime(0, rs + rel + 0.004);
  return rs + rel + 0.02;
}

function osc(ctx: BaseAudioContext, type: OscillatorType, hz: number, t: number, detune = 0) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(Math.max(16, Math.min(18000, hz)), t);
  if (detune !== 0) o.detune.value = detune;
  o.start(t);
  return o;
}

function noiseSrc(env: VEnv, t: number, loop = false) {
  const n = env.ctx.createBufferSource();
  n.buffer = env.noise;
  n.loop = loop;
  n.start(t, env.random() * 1.5);
  return n;
}

function filt(ctx: BaseAudioContext, type: BiquadFilterType, f: number, q = 0.7) {
  const b = ctx.createBiquadFilter();
  b.type = type;
  b.frequency.value = Math.max(20, Math.min(18000, f));
  b.Q.value = q;
  return b;
}

const gain = (ctx: BaseAudioContext, v = 1) => {
  const g = ctx.createGain();
  g.gain.value = v;
  return g;
};

/** Silent gain node anchored at time t to prevent onset clicks */
const gz = (ctx: BaseAudioContext, t: number) => {
  const g = ctx.createGain();
  g.gain.value = 0.0001;
  g.gain.setValueAtTime(0.0001, t);
  return g;
};

function shaper(ctx: BaseAudioContext, k: number) {
  const s = ctx.createWaveShaper();
  s.curve = curve(k);
  return s;
}

const drift = (env: VEnv, cents = 4.0) => (env.random() * 2 - 1) * cents;

export function playVoice(kind: SynthKind, env: VEnv, dest: AudioNode, t: number, durSec: number, n: Note, ctl: TrackCtl, slideFrom?: number): number | undefined {
  if (n.v <= 0) return undefined;
  const ctx = env.ctx;
  const v = Math.max(0, Math.min(1, n.v));
  const hz = midiHz(n.p);
  const cl: (() => void)[] = [];
  const out = gain(ctx);
  out.connect(dest);

  switch (kind) {
    case 'kick': {
      // Punchy analog 909 / warehouse kick: chest transient (142Hz -> 58Hz -> 40Hz) + warm click
      const o = osc(ctx, 'sine', 142, t);
      o.frequency.exponentialRampToValueAtTime(58, t + 0.025);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.13);
      o.frequency.exponentialRampToValueAtTime(36, t + 0.42);

      const oBody = osc(ctx, 'triangle', 95, t);
      oBody.frequency.exponentialRampToValueAtTime(40, t + 0.085);
      const gBody = gz(ctx, t);
      gBody.gain.linearRampToValueAtTime(v * 0.18, t + 0.003);
      gBody.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      gBody.gain.linearRampToValueAtTime(0, t + 0.145);
      oBody.connect(gBody);

      const g = gz(ctx, t);
      g.gain.linearRampToValueAtTime(v * 0.72, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0002, t + 0.45);
      g.gain.linearRampToValueAtTime(0, t + 0.46);

      const ws = shaper(ctx, 1.3 + env.dirt * 2.4);
      const toneLp = filt(ctx, 'lowpass', 1650, 0.65);
      o.connect(g);
      gBody.connect(g);
      g.connect(ws);
      ws.connect(toneLp);
      toneLp.connect(out);
      done(env, [o, oBody], t + 0.48, out);
      break;
    }

    case 'sub': {
      // Deep round analog sub-bass with clean fundamental + warm 2nd harmonic
      const o = osc(ctx, 'sine', hz, t, drift(env, 1.5));
      const o2 = osc(ctx, 'triangle', hz, t, drift(env, 2.5));
      const g2 = gain(ctx, 0.24);
      o2.connect(g2);
      const subLp = filt(ctx, 'lowpass', Math.min(220, hz * 3.2), 0.75);
      bindCutoff(ctl, subLp, cl, true);
      const g = gz(ctx, t);
      const e = adsr(g.gain, t, 0.008, v * 0.58, 0.08, 0.85, durSec, 0.08);
      o.connect(subLp);
      g2.connect(subLp);
      subLp.connect(g);
      g.connect(out);
      done(env, [o, o2], e, out, cl);
      break;
    }

    case 'rumble': {
      // Subterranean Berghain/Tresor vault rumble: sub-octave sine + dark filtered cavern noise
      const subHz = Math.max(28, hz <= 48 ? hz : hz * 0.5);
      const oSub = osc(ctx, 'sine', subHz, t, drift(env, 2));
      const oBody = osc(ctx, 'triangle', subHz * 1.5, t, -4 + drift(env, 3));
      const gBody = gain(ctx, 0.28);
      oBody.connect(gBody);
      const lp = filt(ctx, 'lowpass', 95, 1.25);
      bindCutoff(ctl, lp, cl, true);
      const g = gz(ctx, t);
      const e = adsr(g.gain, t, 0.025, v * 0.52, 0.32, 0.3, durSec, 0.22);
      oSub.connect(lp);
      gBody.connect(lp);
      lp.connect(g);
      g.connect(out);
      done(env, [oSub, oBody], e, out, cl);
      break;
    }

    case 'midbass': {
      // Rolling offbeat bass: sawtooth + sub-octave triangle through punchy ladder filter
      const f = hz <= 55 ? hz * 2 : hz;
      const o = osc(ctx, 'sawtooth', f, t, drift(env, 3.5));
      const o2 = osc(ctx, 'triangle', f * 0.5, t, 3 + drift(env, 2.5));
      const mix = gain(ctx, 0.55);
      o2.connect(mix);
      const lp = filt(ctx, 'lowpass', 240, 2.2);
      lp.frequency.setValueAtTime(240 * Math.pow(2, 1.45 * v), t);
      lp.frequency.exponentialRampToValueAtTime(220, t + 0.14);
      bindCutoff(ctl, lp, cl, true);
      const g = gz(ctx, t);
      const e = adsr(g.gain, t, 0.005, v * 0.44, 0.11, 0.5, durSec, 0.05);
      o.connect(lp);
      mix.connect(lp);
      lp.connect(g);
      g.connect(out);
      done(env, [o, o2], e, out, cl);
      break;
    }

    case 'acid': {
      // Advanced Roland TB-303 Cascaded Diode-Ladder Synthesizer:
      // Consistent transistor sawtooth + warm pulse harmonic core (no per-note waveform flipping),
      // dual-stage 18dB/24dB cascaded resonant lowpass ladder (lp1 + lp2), accent capacitor shortening,
      // key-tracked filter envelope, and post-ladder low-shelf body compensation.
      const acc = !!n.acc;
      const keyTrack = Math.min(1.65, Math.max(0.75, hz / 130.81));
      const oSaw = osc(ctx, 'sawtooth', hz, t, drift(env, 1.8));
      const oPulse = osc(ctx, 'square', hz, t, 2.5 + drift(env, 1.8));
      const gPulse = gain(ctx, acc ? 0.22 : 0.28);
      oPulse.connect(gPulse);

      if (slideFrom) {
        oSaw.frequency.setValueAtTime(slideFrom, t);
        oSaw.frequency.exponentialRampToValueAtTime(hz, t + 0.062);
        oPulse.frequency.setValueAtTime(slideFrom, t);
        oPulse.frequency.exponentialRampToValueAtTime(hz, t + 0.062);
      }

      const baseCut = (acc ? 340 : 210) * keyTrack;
      const peakCut = (acc ? 3150 : 1420) * keyTrack;
      const envDecay = acc ? 0.118 : 0.195;

      // Stage 1: Primary resonant diode-ladder pole pair
      const lp1 = filt(ctx, 'lowpass', baseCut, acc ? 4.35 : 2.75);
      // Stage 2: Secondary ladder roll-off pole pair for liquid 303 squelch without harsh whistle
      const lp2 = filt(ctx, 'lowpass', baseCut * 1.35, acc ? 1.75 : 1.15);

      if (slideFrom) {
        lp1.frequency.setValueAtTime(peakCut * 0.72, t);
        lp1.frequency.exponentialRampToValueAtTime(baseCut, t + 0.14);
        lp2.frequency.setValueAtTime(peakCut * 0.95, t);
        lp2.frequency.exponentialRampToValueAtTime(baseCut * 1.35, t + 0.14);
      } else {
        lp1.frequency.setValueAtTime(baseCut * 0.9, t);
        lp1.frequency.exponentialRampToValueAtTime(peakCut, t + 0.008);
        lp1.frequency.exponentialRampToValueAtTime(baseCut, t + envDecay);

        lp2.frequency.setValueAtTime(baseCut * 1.2, t);
        lp2.frequency.exponentialRampToValueAtTime(peakCut * 1.28, t + 0.008);
        lp2.frequency.exponentialRampToValueAtTime(baseCut * 1.35, t + envDecay);
      }
      bindCutoff(ctl, lp1, cl, true);
      bindCutoff(ctl, lp2, cl, false);

      // Warm transistor clipper + low-end body retention shelf
      const ws = shaper(ctx, (acc ? 1.85 : 1.25) + env.dirt * 0.95);
      const bodyShelf = filt(ctx, 'lowshelf', 140, 0.7);
      bodyShelf.gain.value = 3.2;

      const g = gz(ctx, t);
      const e = adsr(
        g.gain,
        t,
        0.003,
        v * (acc ? 0.42 : 0.32),
        acc ? 0.085 : 0.11,
        acc ? 0.48 : 0.58,
        durSec + (slideFrom ? 0.03 : 0),
        0.042
      );
      oSaw.connect(lp1);
      gPulse.connect(lp1);
      lp1.connect(lp2);
      lp2.connect(ws);
      ws.connect(bodyShelf);
      bodyShelf.connect(g);
      g.connect(out);
      done(env, [oSaw, oPulse], e, out, cl);
      break;
    }

    case 'stab': {
      // Classic Detroit / Warehouse Minor-Chord Organ-Brass Stab:
      // Stacked minor-third & fifth intervals through warm resonant bandpass/formant filter (distinct from 303 & pluck)
      const oRoot = osc(ctx, 'sawtooth', hz, t, -8 + drift(env, 3.5));
      const oMin3 = osc(ctx, 'square', hz * 1.1892, t, 6 + drift(env, 3.5)); // Minor 3rd interval
      const oFifth = osc(ctx, 'triangle', hz * 1.4983, t, drift(env, 2.5));  // Perfect 5th interval
      const gMin3 = gain(ctx, 0.52);
      const gFifth = gain(ctx, 0.48);
      oMin3.connect(gMin3);
      oFifth.connect(gFifth);

      const bp = filt(ctx, 'bandpass', 1350, 1.35);
      bp.frequency.setValueAtTime(2900, t);
      bp.frequency.exponentialRampToValueAtTime(920, t + 0.18);
      bindCutoff(ctl, bp, cl, true);

      const g = gz(ctx, t);
      const e = adsr(g.gain, t, 0.004, v * 0.38, 0.16, 0.24, Math.min(durSec, 0.34), 0.11);
      oRoot.connect(bp);
      gMin3.connect(bp);
      gFifth.connect(bp);
      bp.connect(g);
      g.connect(out);
      done(env, [oRoot, oMin3, oFifth], e, out, cl);
      break;
    }

    case 'lead': {
      // Soaring analog lead with pitch vibrato LFO & dual sync-style oscillators
      const o = osc(ctx, 'sawtooth', hz, t, -10 + drift(env, 4));
      const o2 = osc(ctx, 'square', hz * 2, t, 10 + drift(env, 4));
      const g2 = gain(ctx, 0.32);
      o2.connect(g2);
      const lfo = osc(ctx, 'sine', 5.4, t);
      const ld = gain(ctx, 13);
      lfo.connect(ld);
      ld.connect(o.detune);
      ld.connect(o2.detune);
      const lp = filt(ctx, 'lowpass', 1400, 2.1);
      lp.frequency.setValueAtTime(6200, t);
      lp.frequency.exponentialRampToValueAtTime(1500, t + 0.24);
      bindCutoff(ctl, lp, cl, true);
      const g = gz(ctx, t);
      const e = adsr(g.gain, t, 0.008, v * 0.32, 0.22, 0.7, durSec, 0.16);
      o.connect(lp);
      g2.connect(lp);
      lp.connect(g);
      g.connect(out);
      done(env, [o, o2, lfo], e, out, cl);
      break;
    }

    case 'arp': {
      // Buchla / DX Crystalline 2-Operator FM Wooden-Glass Pluck:
      // Pure sine carrier + harmonic/inharmonic sine FM modulator with ultra-snappy vactrol decay (zero sawtooth buzz)
      const acc = !!n.acc;
      const car = osc(ctx, 'sine', hz, t, drift(env, 2));
      const body = osc(ctx, 'triangle', hz * 0.5, t, drift(env, 2));
      const gBody = gain(ctx, 0.32);
      body.connect(gBody);

      const modRatio = acc ? 3.0 : 2.0;
      const mod = osc(ctx, 'sine', hz * modRatio, t);
      const modGain = gz(ctx, t);
      modGain.gain.linearRampToValueAtTime(hz * (acc ? 2.6 : 1.45), t + 0.002);
      modGain.gain.exponentialRampToValueAtTime(0.5, t + (acc ? 0.055 : 0.038));
      mod.connect(modGain);
      modGain.connect(car.frequency);

      const lp = filt(ctx, 'lowpass', acc ? 4800 : 3200, 1.4);
      lp.frequency.setValueAtTime(acc ? 6400 : 4200, t);
      lp.frequency.exponentialRampToValueAtTime(620, t + 0.095);
      bindCutoff(ctl, lp, cl, true);

      const g = gz(ctx, t);
      const e = adsr(g.gain, t, 0.0025, v * (acc ? 0.46 : 0.36), 0.075, 0.06, Math.min(durSec, 0.16), 0.065);
      car.connect(lp);
      gBody.connect(lp);
      lp.connect(g);
      g.connect(out);
      done(env, [car, body, mod], e, out, cl);
      break;
    }

    case 'pad': {
      // Warm evolving Ambient / Cinema-String Pad with slow organic LFO filter breathing
      const o1 = osc(ctx, 'sawtooth', hz, t, -14 + drift(env, 3.5));
      const o2 = osc(ctx, 'sawtooth', hz, t, 14 + drift(env, 3.5));
      const oFifth = osc(ctx, 'triangle', hz * 1.4983, t, 4 + drift(env, 2.5));
      const sub = osc(ctx, 'sine', hz * 0.5, t, drift(env, 2));
      const gFifth = gain(ctx, 0.24);
      const gSub = gain(ctx, 0.42);
      oFifth.connect(gFifth);
      sub.connect(gSub);

      const lfo = osc(ctx, 'sine', 0.11, t);
      const lfoDepth = gain(ctx, 180);
      lfo.connect(lfoDepth);

      const lp = filt(ctx, 'lowpass', 920, 1.1);
      lfoDepth.connect(lp.frequency);
      bindCutoff(ctl, lp, cl, true);

      const g = gz(ctx, t);
      const e = adsr(g.gain, t, Math.min(1.4, durSec * 0.32), v * 0.19, 0.15, 0.92, durSec, 1.15);
      o1.connect(lp);
      o2.connect(lp);
      gFifth.connect(lp);
      gSub.connect(lp);
      lp.connect(g);
      g.connect(out);
      done(env, [o1, o2, oFifth, sub, lfo], e, out, cl);
      break;
    }

    case 'dubchord': {
      // Cavernous Basic Channel dub techno chord tank with deep slow resonant filter sweep
      const o = osc(ctx, 'sawtooth', hz, t, -9 + drift(env, 4));
      const o2 = osc(ctx, 'triangle', hz * 1.5, t, 9 + drift(env, 4));
      const lp = filt(ctx, 'lowpass', 420, 2.6);
      lp.frequency.setValueAtTime(2800, t);
      lp.frequency.exponentialRampToValueAtTime(380, t + 0.42);
      bindCutoff(ctl, lp, cl, true);
      const g = gz(ctx, t);
      const e = adsr(g.gain, t, 0.008, v * 0.28, 0.38, 0.1, durSec, 0.32);
      o.connect(lp);
      o2.connect(lp);
      lp.connect(g);
      g.connect(out);
      done(env, [o, o2], e, out, cl);
      break;
    }

    case 'drone': {
      // Subterranean bowed Ambient / Dark harmonic drone with organic dual-LFO filter & harmonic movement
      const o = osc(ctx, 'sawtooth', hz, t, -8 + drift(env, 4));
      const o2 = osc(ctx, 'triangle', hz * 1.003, t, 8 + drift(env, 4));
      const oFifth = osc(ctx, 'sine', hz * 1.4983, t, drift(env, 2.5));
      const oSub = osc(ctx, 'sine', hz * 0.5, t, drift(env, 2));
      const gFifth = gain(ctx, 0.28);
      const gSub = gain(ctx, 0.52);
      oFifth.connect(gFifth);
      oSub.connect(gSub);
      const lfo = osc(ctx, 'sine', 0.12, t);
      const ld = gain(ctx, 85);
      lfo.connect(ld);
      const lp = filt(ctx, 'lowpass', 280, 1.45);
      ld.connect(lp.frequency);
      bindCutoff(ctl, lp, cl, true);
      const g = gz(ctx, t);
      const e = adsr(g.gain, t, Math.min(1.8, durSec * 0.28), v * 0.25, 0.12, 0.95, durSec, 1.3);
      o.connect(lp);
      o2.connect(lp);
      gFifth.connect(lp);
      gSub.connect(lp);
      lp.connect(g);
      g.connect(out);
      done(env, [o, o2, oFifth, oSub, lfo], e, out, cl);
      break;
    }

    case 'noise': {
      const s = noiseSrc(env, t, true);
      const bp = filt(ctx, 'bandpass', 640, 0.9);
      const lfo = osc(ctx, 'sine', 0.08, t);
      const ld = gain(ctx, 280);
      lfo.connect(ld);
      ld.connect(bp.frequency);
      bindCutoff(ctl, bp, cl, true);
      const g = gz(ctx, t);
      const e = adsr(g.gain, t, Math.min(1.6, durSec * 0.28), v * 0.12, 0.1, 0.9, durSec, 1.1);
      s.connect(bp);
      bp.connect(g);
      g.connect(out);
      done(env, [s, lfo], e, out, cl);
      break;
    }

    case 'crackle': {
      const s = noiseSrc(env, t);
      const bp = filt(ctx, 'bandpass', 2200, 1.4);
      const g = gz(ctx, t);
      g.gain.linearRampToValueAtTime(v * 0.32, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);
      g.gain.linearRampToValueAtTime(0, t + 0.015);
      s.connect(bp);
      bp.connect(g);
      g.connect(out);
      done(env, [s], t + 0.025, out);
      break;
    }

    case 'hat':
    case 'ohat': {
      // Analog 909 / 808 cross-modulated metallic matrix + shaped pink noise through bronze resonator
      const open = kind === 'ohat';
      const s = noiseSrc(env, t);
      const car = osc(ctx, 'square', 418, t, drift(env, 3));
      const mod = osc(ctx, 'square', 418 * 1.414, t, drift(env, 3));
      const fm = gain(ctx, 520);
      mod.connect(fm);
      fm.connect(car.frequency);
      const mMix = gain(ctx, open ? 0.11 : 0.09);
      car.connect(mMix);

      const bp = filt(ctx, 'bandpass', open ? 6800 : 7600, 0.85);
      bindCutoff(ctl, bp, cl, true);
      const hp = filt(ctx, 'highpass', open ? 4800 : 5600, 0.65);
      const silkLp = filt(ctx, 'lowpass', 13200, 0.6);
      const g = gz(ctx, t);
      const dur = open ? Math.min(0.32, Math.max(0.18, durSec * 1.1)) : 0.048;
      g.gain.linearRampToValueAtTime(v * (open ? 0.28 : 0.26), t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      g.gain.linearRampToValueAtTime(0, t + dur + 0.004);
      s.connect(bp);
      mMix.connect(bp);
      bp.connect(hp);
      hp.connect(silkLp);
      silkLp.connect(g);
      g.connect(out);
      done(env, [s, car, mod], t + dur + 0.02, out, cl);
      break;
    }

    case 'ride': {
      // Warm 909 bronze ride cymbal: FM bell ping + airy brushed shimmer
      const car = osc(ctx, 'triangle', 528, t, drift(env, 3));
      const mod = osc(ctx, 'sine', 528 * 2.13, t, drift(env, 3));
      const fm = gz(ctx, t);
      fm.gain.linearRampToValueAtTime(680, t + 0.002);
      fm.gain.exponentialRampToValueAtTime(85, t + 0.18);
      mod.connect(fm);
      fm.connect(car.frequency);
      const bellGain = gain(ctx, 0.22);
      car.connect(bellGain);

      const s = noiseSrc(env, t);
      const nGain = gain(ctx, 0.26);
      s.connect(nGain);

      const bp = filt(ctx, 'bandpass', 5400, 0.7);
      bindCutoff(ctl, bp, cl, true);
      const silkLp = filt(ctx, 'lowpass', 12400, 0.65);
      const g = gz(ctx, t);
      g.gain.linearRampToValueAtTime(v * 0.18, t + 0.0025);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.54);
      g.gain.linearRampToValueAtTime(0, t + 0.55);
      bellGain.connect(bp);
      nGain.connect(bp);
      bp.connect(silkLp);
      silkLp.connect(g);
      g.connect(out);
      done(env, [car, mod, s], t + 0.58, out, cl);
      break;
    }

    case 'shaker': {
      const s = noiseSrc(env, t);
      const bp = filt(ctx, 'bandpass', 5200, 1.15);
      bindCutoff(ctl, bp, cl, true);
      const silkLp = filt(ctx, 'lowpass', 11800, 0.65);
      const g = gz(ctx, t);
      g.gain.linearRampToValueAtTime(v * 0.25, t + 0.011);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.068);
      g.gain.linearRampToValueAtTime(0, t + 0.072);
      s.connect(bp);
      bp.connect(silkLp);
      silkLp.connect(g);
      g.connect(out);
      done(env, [s], t + 0.085, out, cl);
      break;
    }

    case 'clap': {
      // Analog 909 multi-burst handclap with warm 1.05kHz resonant body + diffuse room tail
      const s = noiseSrc(env, t);
      const bp = filt(ctx, 'bandpass', 1080, 1.1);
      const lp = filt(ctx, 'lowpass', 5800, 0.7);
      bindCutoff(ctl, lp, cl, true);
      const g = gz(ctx, t);
      const p = g.gain;
      const a = v * 0.56;
      p.setValueAtTime(0.0001, t);
      p.linearRampToValueAtTime(a, t + 0.0025);
      p.exponentialRampToValueAtTime(a * 0.22, t + 0.01);
      p.linearRampToValueAtTime(a * 0.9, t + 0.0125);
      p.exponentialRampToValueAtTime(a * 0.22, t + 0.021);
      p.linearRampToValueAtTime(a, t + 0.024);
      p.exponentialRampToValueAtTime(0.0001, t + 0.21);
      p.linearRampToValueAtTime(0, t + 0.215);
      s.connect(bp);
      bp.connect(lp);
      lp.connect(g);
      g.connect(out);
      done(env, [s], t + 0.23, out, cl);
      break;
    }

    case 'snare': {
      // Punchy analog 909 snare with dual-shell fundamental + snappy wire rattle
      const o = osc(ctx, 'triangle', 192, t);
      o.frequency.exponentialRampToValueAtTime(104, t + 0.075);
      const g = gz(ctx, t);
      g.gain.linearRampToValueAtTime(v * 0.46, t + 0.0025);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      g.gain.linearRampToValueAtTime(0, t + 0.145);
      const s = noiseSrc(env, t);
      const bp = filt(ctx, 'bandpass', 1850, 0.85);
      const lp = filt(ctx, 'lowpass', 7200, 0.7);
      bindCutoff(ctl, lp, cl, true);
      const g2 = gz(ctx, t);
      g2.gain.linearRampToValueAtTime(v * 0.34, t + 0.0025);
      g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      g2.gain.linearRampToValueAtTime(0, t + 0.185);
      o.connect(g);
      g.connect(out);
      s.connect(bp);
      bp.connect(lp);
      lp.connect(g2);
      g2.connect(out);
      done(env, [o, s], t + 0.2, out, cl);
      break;
    }

    case 'perc':
    case 'conga':
    case 'tom': {
      const k = kind === 'tom' ? 1.85 : kind === 'conga' ? 1.38 : 1.5;
      const dec = kind === 'tom' ? 0.3 : kind === 'conga' ? 0.22 : 0.15;
      const f =
        kind === 'tom'
          ? Math.min(135, Math.max(52, hz))
          : kind === 'conga'
            ? Math.min(240, Math.max(95, hz * 0.82))
            : Math.min(290, Math.max(115, hz * 0.78));
      const o = osc(ctx, 'sine', f * k, t, drift(env, 3));
      o.frequency.exponentialRampToValueAtTime(f, t + (kind === 'tom' ? 0.07 : 0.03));
      const oHarm = osc(ctx, 'triangle', f * 1.5, t, drift(env, 4));
      const gHarm = gz(ctx, t);
      gHarm.gain.linearRampToValueAtTime(v * 0.16, t + 0.0025);
      gHarm.gain.exponentialRampToValueAtTime(0.0001, t + dec * 0.45);
      oHarm.connect(gHarm);
      const lp = filt(ctx, 'lowpass', 2600, 0.85);
      bindCutoff(ctl, lp, cl, true);
      const g = gz(ctx, t);
      g.gain.linearRampToValueAtTime(v * 0.54, t + 0.0025);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
      g.gain.linearRampToValueAtTime(0, t + dec + 0.004);
      o.connect(lp);
      gHarm.connect(lp);
      lp.connect(g);
      g.connect(out);
      done(env, [o, oHarm], t + dec + 0.02, out, cl);
      break;
    }

    case 'clang': {
      // Struck industrial iron plate in a concrete vault: decaying FM index + dual resonant plate modes
      const baseF = Math.min(440, Math.max(110, hz));
      const car = osc(ctx, 'triangle', baseF * 1.62, t, drift(env, 4));
      const mod = osc(ctx, 'sine', baseF * 1.62 * 1.414, t, drift(env, 4));
      const md = gz(ctx, t);
      md.gain.linearRampToValueAtTime(baseF * 3.2, t + 0.002);
      md.gain.exponentialRampToValueAtTime(baseF * 0.18, t + 0.24);
      mod.connect(md);
      md.connect(car.frequency);

      const bp = filt(ctx, 'bandpass', 1180, 1.35);
      const lp = filt(ctx, 'lowpass', 3800, 0.8);
      bindCutoff(ctl, lp, cl, true);
      const ws = shaper(ctx, 1.25 + env.dirt * 0.9);
      const g = gz(ctx, t);
      g.gain.linearRampToValueAtTime(v * 0.28, t + 0.0025);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
      g.gain.linearRampToValueAtTime(0, t + 0.385);
      car.connect(ws);
      ws.connect(bp);
      bp.connect(lp);
      lp.connect(g);
      g.connect(out);
      done(env, [car, mod], t + 0.4, out, cl);
      break;
    }

    case 'riser': {
      // Authentic Underground Techno / Dark Atmospheric Tension Riser:
      // Combines a resonant analog pink-noise filter sweep (180Hz -> 3400Hz) with a key-locked
      // dark sub-harmonic swarm gliding smoothly up 1 octave (no fake 5-octave cartoon siren).
      const dur = Math.max(0.5, durSec > 0.05 ? durSec : n.d * env.stepDur);
      const rootHz = Math.min(260, Math.max(55, hz <= 110 ? hz * 2 : hz));

      // Layer 1: Analog pink-noise resonant air sweep
      const sNoise = noiseSrc(env, t, true);
      const bpNoise = filt(ctx, 'bandpass', 220, 2.2);
      bpNoise.frequency.setValueAtTime(220, t);
      bpNoise.frequency.exponentialRampToValueAtTime(3400, t + dur);
      const gNoise = gain(ctx, 0.58);
      sNoise.connect(bpNoise);
      bpNoise.connect(gNoise);

      // Layer 2: Key-locked dark harmonic swarm (glides 1 octave in key with subtle tremolo pulse)
      const oRoot = osc(ctx, 'sawtooth', rootHz * 0.5, t, -9 + drift(env, 4));
      oRoot.frequency.exponentialRampToValueAtTime(rootHz, t + dur);
      const oFifth = osc(ctx, 'triangle', rootHz * 0.749, t, 9 + drift(env, 4));
      oFifth.frequency.exponentialRampToValueAtTime(rootHz * 1.498, t + dur);
      const gSwarm = gain(ctx, 0.32);
      oRoot.connect(gSwarm);
      oFifth.connect(gSwarm);

      const lp = filt(ctx, 'lowpass', 240, 1.8);
      lp.frequency.setValueAtTime(240, t);
      lp.frequency.exponentialRampToValueAtTime(2600, t + dur);
      bindCutoff(ctl, lp, cl, true);

      const lfo = osc(ctx, 'sine', 1.8, t);
      lfo.frequency.exponentialRampToValueAtTime(7.5, t + dur);
      const lfoDepth = gain(ctx, 180);
      lfo.connect(lfoDepth);
      lfoDepth.connect(lp.frequency);

      const ws = shaper(ctx, 1.2 + env.dirt * 0.7);
      const g = gz(ctx, t);
      g.gain.setValueAtTime(0.0005, t);
      g.gain.exponentialRampToValueAtTime(v * 0.34, t + dur * 0.94);
      g.gain.linearRampToValueAtTime(0, t + dur + 0.04);

      gNoise.connect(lp);
      gSwarm.connect(lp);
      lp.connect(ws);
      ws.connect(g);
      g.connect(out);
      done(env, [sNoise, oRoot, oFifth, lfo], t + dur + 0.06, out, cl);
      break;
    }

    case 'impact': {
      // Warehouse Subterranean Seismic Impact:
      // Saturated sub-drop (112Hz -> 32Hz) + acoustic concrete-vault noise thud + dark fifth body
      const rootSub = Math.min(65, Math.max(28, hz <= 65 ? hz : hz * 0.5));
      const oSub = osc(ctx, 'sine', 118, t);
      oSub.frequency.exponentialRampToValueAtTime(rootSub * 1.25, t + 0.065);
      oSub.frequency.exponentialRampToValueAtTime(rootSub * 0.85, t + 1.35);

      const oBody = osc(ctx, 'triangle', rootSub * 1.5, t, drift(env, 3));
      oBody.frequency.exponentialRampToValueAtTime(rootSub, t + 0.45);
      const gBody = gz(ctx, t);
      gBody.gain.linearRampToValueAtTime(v * 0.38, t + 0.005);
      gBody.gain.exponentialRampToValueAtTime(0.0001, t + 0.65);
      oBody.connect(gBody);

      // Concrete warehouse transient thud (filtered pink noise burst)
      const sThud = noiseSrc(env, t);
      const thudLp = filt(ctx, 'lowpass', 620, 1.3);
      thudLp.frequency.setValueAtTime(680, t);
      thudLp.frequency.exponentialRampToValueAtTime(85, t + 0.38);
      const gThud = gz(ctx, t);
      gThud.gain.linearRampToValueAtTime(v * 0.34, t + 0.004);
      gThud.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
      sThud.connect(thudLp);
      thudLp.connect(gThud);

      const g = gz(ctx, t);
      g.gain.linearRampToValueAtTime(v * 0.78, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0002, t + 1.45);
      g.gain.linearRampToValueAtTime(0, t + 1.48);

      const ws = shaper(ctx, 1.45 + env.dirt * 1.1);
      const lp = filt(ctx, 'lowpass', 320, 0.85);
      bindCutoff(ctl, lp, cl, true);
      oSub.connect(ws);
      gBody.connect(ws);
      gThud.connect(ws);
      ws.connect(lp);
      lp.connect(g);
      g.connect(out);
      done(env, [oSub, oBody, sThud], t + 1.52, out, cl);
      break;
    }

    case 'downlift': {
      // Dark Analog Sub-Brass & Filtered Air Downlifter (key-locked, warm closing filter sweep)
      const dur = Math.max(0.5, durSec > 0.05 ? durSec : n.d * env.stepDur);
      const baseHz = Math.min(220, Math.max(55, hz));
      const o1 = osc(ctx, 'sawtooth', baseHz * 2, t, -7 + drift(env, 3));
      o1.frequency.exponentialRampToValueAtTime(baseHz * 0.5, t + dur * 0.9);
      const o2 = osc(ctx, 'triangle', baseHz * 1.498, t, 7 + drift(env, 3));
      o2.frequency.exponentialRampToValueAtTime(baseHz * 0.375, t + dur * 0.9);

      const sAir = noiseSrc(env, t, true);
      const gAir = gain(ctx, 0.35);
      sAir.connect(gAir);

      const lp = filt(ctx, 'lowpass', 2200, 1.65);
      lp.frequency.setValueAtTime(2200, t);
      lp.frequency.exponentialRampToValueAtTime(75, t + dur * 0.94);
      bindCutoff(ctl, lp, cl, true);

      const ws = shaper(ctx, 1.2 + env.dirt * 0.6);
      const g = gz(ctx, t);
      g.gain.linearRampToValueAtTime(v * 0.36, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0002, t + dur);
      g.gain.linearRampToValueAtTime(0, t + dur + 0.025);

      o1.connect(lp);
      o2.connect(lp);
      gAir.connect(lp);
      lp.connect(ws);
      ws.connect(g);
      g.connect(out);
      done(env, [o1, o2, sAir], t + dur + 0.05, out, cl);
      break;
    }

    case 'crash': {
      // Warm 909 Bronze Cymbal Crash & Reverse Air Swell:
      // Cross-modulated metallic FM shimmer + pink noise air shaped through bronze body + silk rolloff
      const s = noiseSrc(env, t, true);
      const c1 = osc(ctx, 'triangle', 485, t, drift(env, 4));
      const m1 = osc(ctx, 'square', 485 * 1.414, t, drift(env, 4));
      const c2 = osc(ctx, 'triangle', 792, t, drift(env, 4));
      const m2 = osc(ctx, 'sine', 792 * 2.17, t, drift(env, 4));
      const fm1 = gain(ctx, 640);
      const fm2 = gain(ctx, 820);
      m1.connect(fm1);
      fm1.connect(c1.frequency);
      m2.connect(fm2);
      fm2.connect(c2.frequency);

      const mMix = gain(ctx, 0.14);
      c1.connect(mMix);
      c2.connect(mMix);

      const hp = filt(ctx, 'highpass', 3600, 0.7);
      const silkLp = filt(ctx, 'lowpass', 11200, 0.65);
      bindCutoff(ctl, silkLp, cl, true);
      const dur = Math.max(0.45, durSec > 0.05 ? durSec : n.d * env.stepDur);
      const g = gz(ctx, t);

      if (n.p === 1) {
        // Smooth reverse bronze cymbal swell into drop
        silkLp.frequency.setValueAtTime(1400, t);
        silkLp.frequency.exponentialRampToValueAtTime(11200, t + dur * 0.96);
        g.gain.setValueAtTime(0.0005, t);
        g.gain.exponentialRampToValueAtTime(v * 0.36, t + dur * 0.96);
        g.gain.linearRampToValueAtTime(0, t + dur + 0.02);
        s.connect(hp);
        mMix.connect(hp);
        hp.connect(silkLp);
        silkLp.connect(g);
        g.connect(out);
        done(env, [s, c1, m1, c2, m2], t + dur + 0.04, out, cl);
      } else {
        // Natural bronze crash splash with warm decay
        silkLp.frequency.setValueAtTime(11500, t);
        silkLp.frequency.exponentialRampToValueAtTime(4200, t + 1.45);
        g.gain.linearRampToValueAtTime(v * 0.34, t + 0.003);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.55);
        g.gain.linearRampToValueAtTime(0, t + 1.58);
        s.connect(hp);
        mMix.connect(hp);
        hp.connect(silkLp);
        silkLp.connect(g);
        g.connect(out);
        done(env, [s, c1, m1, c2, m2], t + 1.62, out, cl);
      }
      break;
    }
  }
  return hz;
}
