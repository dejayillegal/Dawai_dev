import type { Note, SynthKind } from './types';
import { midiHz, Rng } from './theory';

export interface TrackCtl { cutoff: AudioNode; res: AudioNode }
export interface VEnv { ctx: BaseAudioContext; noise: AudioBuffer; dirt: number; stepDur: number; random: () => number; sources: Set<AudioScheduledSourceNode>; onStart(): void; onEnd(): void }

const curves = new Map<number, Float32Array<ArrayBuffer>>();
function curve(k: number): Float32Array<ArrayBuffer> {
  const key = Math.max(1, Math.round(k * 4));
  let c = curves.get(key);
  if (!c) {
    c = new Float32Array(new ArrayBuffer(1024 * 4));
    const drive = key / 4;
    const norm = Math.tanh(drive);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      // Subtle asymmetrical even-harmonic tube/tape warmth
      const biased = x + 0.065 * x * x - 0.065;
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
  // Warm pink-tinted analog noise (blends white noise with 1-pole low-pass integration to remove harsh digital white-noise hiss)
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
  srcs.forEach((s) => {env.sources.add(s);s.stop(endT);});
  env.onStart();
  srcs[0].onended = () => { srcs.forEach(s=>{env.sources.delete(s);s.disconnect();});tail.disconnect(); cleanup.forEach((f) => {try{f();}catch{/* Graph already disposed. */}}); env.onEnd(); };
}
function bindCutoff(ctl: TrackCtl, f: BiquadFilterNode, cl: (() => void)[], res = false) {
  ctl.cutoff.connect(f.detune); cl.push(() => ctl.cutoff.disconnect(f.detune));
  if (res) { ctl.res.connect(f.Q); cl.push(() => ctl.res.disconnect(f.Q)); }
}
function adsr(p: AudioParam, t: number, a: number, peak: number, d: number, s: number, dur: number, r: number): number {
  const sus = Math.max(0.0001, s);
  p.setValueAtTime(0.0001, t);
  p.linearRampToValueAtTime(peak, t + a);
  const dEnd = Math.min(t + a + d, t + Math.max(dur, a + 0.002));
  const lvl = Math.max(0.0001, peak * Math.pow(sus, d > 0 ? Math.min(1, (dEnd - t - a) / d) : 1));
  if (d > 0 && dEnd > t + a) p.exponentialRampToValueAtTime(lvl, dEnd);
  const rs = Math.max(dEnd, t + dur);
  p.setValueAtTime(lvl, rs);
  p.exponentialRampToValueAtTime(0.0001, rs + r);
  return rs + r + 0.02;
}
function osc(ctx: BaseAudioContext, type: OscillatorType, hz: number, t: number, detune = 0) {
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(hz, t); o.detune.value = detune; o.start(t); return o;
}
function noiseSrc(env: VEnv, t: number, loop = false) {
  const n = env.ctx.createBufferSource(); n.buffer = env.noise; n.loop = loop; n.start(t, env.random() * 1.5); return n;
}
function filt(ctx: BaseAudioContext, type: BiquadFilterType, f: number, q = 0.7) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
const gain = (ctx: BaseAudioContext, v = 1) => { const g = ctx.createGain(); g.gain.value = v; return g; };
/** gain that is silent and explicitly anchored at time t (a ramp with no prior event would otherwise start at scheduling time) */
const gz = (ctx: BaseAudioContext, t: number) => { const g = ctx.createGain(); g.gain.value = 0; g.gain.setValueAtTime(0, t); return g; };
function shaper(ctx: BaseAudioContext, k: number) { const s = ctx.createWaveShaper(); s.curve = curve(k); s.oversample = '2x'; return s; }
const drift = (env: VEnv, cents = 4.5) => (env.random() * 2 - 1) * cents;

export function playVoice(kind: SynthKind, env: VEnv, dest: AudioNode, t: number, durSec: number, n: Note, ctl: TrackCtl, slideFrom?: number): number | undefined {
  if(n.v<=0)return undefined;
  const ctx = env.ctx; const v = Math.max(0, n.v); const hz = midiHz(n.p); const cl: (() => void)[] = [];
  const out = gain(ctx); out.connect(dest);
  switch (kind) {
    case 'kick': {
      // Warm 909 / analog warehouse kick: punchy chest transient (138Hz -> 62Hz -> 41Hz) + warm post-saturation lowpass
      const o = osc(ctx, 'sine', 138, t);
      o.frequency.exponentialRampToValueAtTime(62, t + 0.024);
      o.frequency.exponentialRampToValueAtTime(43, t + 0.12);
      o.frequency.exponentialRampToValueAtTime(38, t + 0.42);
      const oBody = osc(ctx, 'triangle', 92, t);
      oBody.frequency.exponentialRampToValueAtTime(41, t + 0.09);
      const gBody = gz(ctx, t);
      gBody.gain.linearRampToValueAtTime(v * 0.24, t + 0.002);
      gBody.gain.exponentialRampToValueAtTime(0.0005, t + 0.14);
      oBody.connect(gBody);
      const g = gz(ctx, t);
      g.gain.linearRampToValueAtTime(v, t + 0.0025);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.46);
      const ws = shaper(ctx, 1.35 + env.dirt * 3.2);
      const toneLp = filt(ctx, 'lowpass', 1850, 0.65);
      o.connect(g); gBody.connect(g); g.connect(ws); ws.connect(toneLp); toneLp.connect(out);
      // Warm analog felt/skin beater click (band-limited around 780Hz, no harsh high-frequency snap)
      const c = noiseSrc(env, t);
      const bp = filt(ctx, 'bandpass', 780, 1.2);
      const lpClick = filt(ctx, 'lowpass', 1900, 0.7);
      const cg = gz(ctx, t);
      cg.gain.setValueAtTime(v * 0.28, t);
      cg.gain.exponentialRampToValueAtTime(0.0005, t + 0.012);
      c.connect(bp); bp.connect(lpClick); lpClick.connect(cg); cg.connect(out);
      done(env, [o, oBody, c], t + 0.5, out); break;
    }
    case 'sub': {
      // Deep round analog sub-bass with post-saturation low-pass filter to remove any digital harmonic buzz
      const o = osc(ctx, 'sine', hz, t, drift(env, 2));
      const o2 = osc(ctx, 'triangle', hz, t, drift(env, 3));
      const g2 = gain(ctx, 0.26); o2.connect(g2);
      const g = gz(ctx, t);
      const e = adsr(g.gain, t, 0.008, v * 0.88, 0.07, 0.88, durSec, 0.085);
      const ws = shaper(ctx, 1.45);
      const subLp = filt(ctx, 'lowpass', Math.min(210, hz * 3.2), 0.75);
      o.connect(g); g2.connect(g); g.connect(ws); ws.connect(subLp); subLp.connect(out);
      done(env, [o, o2], e, out); break;
    }
    case 'rumble': {
      // Subterranean Tresor/Berghain concrete-vault rumble: sub-octave + fundamental + dark filtered noise + dual-stage lowpass
      const subHz = Math.max(28, hz <= 48 ? hz : hz * 0.5);
      const oSub = osc(ctx, 'sine', subHz, t, drift(env, 2.5));
      const oBody = osc(ctx, 'triangle', subHz, t, -4 + drift(env, 3));
      const gBody = gain(ctx, 0.55); oBody.connect(gBody);
      const nRumble = noiseSrc(env, t, true);
      const nBp = filt(ctx, 'bandpass', subHz * 1.6, 1.4);
      const gNoise = gain(ctx, 0.22);
      nRumble.connect(nBp); nBp.connect(gNoise);
      const lp1 = filt(ctx, 'lowpass', 88, 1.15); bindCutoff(ctl, lp1, cl, true);
      const ws = shaper(ctx, 2.1 + env.dirt * 1.1);
      const lp2 = filt(ctx, 'lowpass', 128, 0.75); // Post-shaper lowpass eliminates all digital upper-harmonic buzz
      const g = gz(ctx, t);
      const e = adsr(g.gain, t, 0.028, v * 0.94, 0.36, 0.28, durSec, 0.26);
      oSub.connect(lp1); gBody.connect(lp1); gNoise.connect(lp1);
      lp1.connect(ws); ws.connect(lp2); lp2.connect(g); g.connect(out);
      done(env, [oSub, oBody, nRumble], e, out, cl); break;
    }
    case 'midbass': {
      // Warm analog rolling bass: dual VCO + sub-octave triangle + 24dB cascaded ladder filter
      const f = hz <= 55 ? hz * 2 : hz;
      const o = osc(ctx, 'sawtooth', f, t, drift(env, 4));
      const o2 = osc(ctx, 'triangle', f * 0.5, t, 4 + drift(env, 3));
      const mix = gain(ctx, 0.65); o2.connect(mix);
      const lp1 = filt(ctx, 'lowpass', 250, 2.4);
      lp1.frequency.setValueAtTime(250 * Math.pow(2, 1.35 * v), t);
      lp1.frequency.exponentialRampToValueAtTime(240, t + 0.15);
      bindCutoff(ctl, lp1, cl, true);
      const ws = shaper(ctx, 1.3 + env.dirt * 1.8);
      const lp2 = filt(ctx, 'lowpass', 1350, 0.7);
      const g = gz(ctx, t); const e = adsr(g.gain, t, 0.005, v * 0.64, 0.11, 0.55, durSec, 0.045);
      o.connect(lp1); mix.connect(lp1); lp1.connect(ws); ws.connect(lp2); lp2.connect(g); g.connect(out);
      done(env, [o, o2], e, out, cl); break;
    }
    case 'acid': {
      // Warm analog TB-303 diode-ladder voice with organic drift and post-saturation speaker rolloff
      const o = osc(ctx, 'sawtooth', hz, t, drift(env, 3.5));
      const oSub = osc(ctx, 'triangle', hz, t, -3);
      const gSub = gain(ctx, 0.35); oSub.connect(gSub);
      if (slideFrom) {
        o.frequency.setValueAtTime(slideFrom, t); o.frequency.exponentialRampToValueAtTime(hz, t + 0.065);
        oSub.frequency.setValueAtTime(slideFrom, t); oSub.frequency.exponentialRampToValueAtTime(hz, t + 0.065);
      }
      const lp = filt(ctx, 'lowpass', 260, 2.8); const acc = !!n.acc;
      if (slideFrom) lp.frequency.setValueAtTime(260 * 1.9, t);
      else {
        lp.frequency.setValueAtTime(260 * Math.pow(2, acc ? 2.65 : 1.75), t);
        lp.frequency.exponentialRampToValueAtTime(250, t + (acc ? 0.13 : 0.21));
      }
      bindCutoff(ctl, lp, cl, true);
      const ws = shaper(ctx, 1.9 + env.dirt * 1.5);
      const postLp = filt(ctx, 'lowpass', 2900, 0.65);
      const g = gz(ctx, t);
      const e = adsr(g.gain, t, 0.004, v * (acc ? 0.58 : 0.44), 0.09, 0.72, durSec + (slideFrom ? 0.025 : 0), 0.035);
      o.connect(lp); gSub.connect(lp); lp.connect(ws); ws.connect(postLp); postLp.connect(g); g.connect(out);
      done(env, [o, oSub], e, out, cl); break;
    }
    case 'stab': {
      // Dark, warm analog warehouse chord stab (detuned VCOs + triangle body + cascaded 24dB ladder filter)
      const o = osc(ctx, 'sawtooth', hz, t, -8 + drift(env, 4));
      const o2 = osc(ctx, 'sawtooth', hz, t, 8 + drift(env, 4));
      const o3 = osc(ctx, 'triangle', hz, t, drift(env, 2));
      const g3 = gain(ctx, 0.55); o3.connect(g3);
      const lp1 = filt(ctx, 'lowpass', 410, 2.1);
      lp1.frequency.setValueAtTime(410 * Math.pow(2, 1.85), t);
      lp1.frequency.exponentialRampToValueAtTime(380, t + 0.18);
      bindCutoff(ctl, lp1, cl, true);
      const ws = shaper(ctx, 1.45 + env.dirt * 1.1);
      const lp2 = filt(ctx, 'lowpass', 2200, 0.75);
      const g = gz(ctx, t);
      const e = adsr(g.gain, t, 0.005, v * 0.25, 0.18, 0.16, Math.min(durSec, 0.28), 0.12);
      o.connect(lp1); o2.connect(lp1); g3.connect(lp1);
      lp1.connect(ws); ws.connect(lp2); lp2.connect(g); g.connect(out);
      done(env, [o, o2, o3], e, out, cl); break;
    }
    case 'lead': {
      const o = osc(ctx, 'sawtooth', hz, t, -6 + drift(env, 4));
      const o2 = osc(ctx, 'triangle', hz, t, 6 + drift(env, 4));
      const g2 = gain(ctx, 0.65); o2.connect(g2);
      const lfo = osc(ctx, 'sine', 4.6, t); const ld = gain(ctx, 9); lfo.connect(ld); ld.connect(o.detune); ld.connect(o2.detune);
      const lp = filt(ctx, 'lowpass', 1450, 1.4); bindCutoff(ctl, lp, cl, true);
      const ws = shaper(ctx, 1.35);
      const postLp = filt(ctx, 'lowpass', 3200, 0.7);
      const g = gz(ctx, t); const e = adsr(g.gain, t, 0.012, v * 0.26, 0.22, 0.68, durSec, 0.22);
      o.connect(lp); g2.connect(lp); lp.connect(ws); ws.connect(postLp); postLp.connect(g); g.connect(out);
      done(env, [o, o2, lfo], e, out, cl); break;
    }
    case 'arp': {
      // Warm analog modular VCO sequence pluck (SH-101 / Buchla low-pass gate style, zero glassy sine-FM bell artifacts)
      const acc = !!n.acc;
      const vco1 = osc(ctx, 'sawtooth', hz, t, -5 + drift(env, 4.5));
      const vco2 = osc(ctx, 'triangle', hz, t, 5 + drift(env, 4.5));
      const subOsc = osc(ctx, 'sine', hz * 0.5, t, drift(env, 2));
      const gVco1 = gain(ctx, 0.58); vco1.connect(gVco1);
      const gSub = gain(ctx, 0.42); subOsc.connect(gSub);
      // Subtle analog cross-modulation transient for woody modular pluck
      const xmod = osc(ctx, 'triangle', hz * 1.5, t);
      const xmodGain = gz(ctx, t);
      xmodGain.gain.setValueAtTime(hz * (acc ? 0.55 : 0.32), t);
      xmodGain.gain.exponentialRampToValueAtTime(1, t + 0.042);
      xmod.connect(xmodGain); xmodGain.connect(vco2.frequency);
      // Cascaded 24dB/oct warm analog low-pass ladder with tape saturation
      const baseCut = 340;
      const lp1 = filt(ctx, 'lowpass', baseCut, 2.35);
      lp1.frequency.setValueAtTime(baseCut * Math.pow(2, acc ? 2.15 : 1.55), t);
      lp1.frequency.exponentialRampToValueAtTime(baseCut, t + (acc ? 0.14 : 0.11));
      bindCutoff(ctl, lp1, cl, true);
      const ws = shaper(ctx, 1.55 + env.dirt * 1.1);
      const lp2 = filt(ctx, 'lowpass', 1950, 0.8); bindCutoff(ctl, lp2, cl, false);
      const g = gz(ctx, t);
      const e = adsr(g.gain, t, 0.0035, v * (acc ? 0.38 : 0.3), 0.13, 0.12, Math.min(durSec, 0.22), 0.09);
      gVco1.connect(lp1); vco2.connect(lp1); gSub.connect(lp1);
      lp1.connect(ws); ws.connect(lp2); lp2.connect(g); g.connect(out);
      done(env, [vco1, vco2, subOsc, xmod], e, out, cl); break;
    }
    case 'pad': {
      const os = [-11, 0, 11].map((d) => osc(ctx, 'sawtooth', hz, t, d + drift(env, 3.5)));
      const sub = osc(ctx, 'triangle', hz * 0.5, t, drift(env, 2));
      const gSub = gain(ctx, 0.32); sub.connect(gSub);
      const lp = filt(ctx, 'lowpass', 520, 1.05); bindCutoff(ctl, lp, cl, true);
      const ws = shaper(ctx, 1.25);
      const postLp = filt(ctx, 'lowpass', 1800, 0.7);
      const g = gz(ctx, t); const e = adsr(g.gain, t, Math.min(1.4, durSec * 0.35), v * 0.12, 0.01, 1, durSec, 1.2);
      os.forEach((o) => o.connect(lp)); gSub.connect(lp); lp.connect(ws); ws.connect(postLp); postLp.connect(g); g.connect(out);
      done(env, [...os, sub], e, out, cl); break;
    }
    case 'dubchord': {
      // Warm analog dub techno chord tank: detuned saws + warm triangle + liquid 24dB tape-filtered envelope
      const o = osc(ctx, 'sawtooth', hz, t, -7 + drift(env, 4));
      const o2 = osc(ctx, 'sawtooth', hz, t, 7 + drift(env, 4));
      const o3 = osc(ctx, 'triangle', hz, t, drift(env, 2.5));
      const lp1 = filt(ctx, 'lowpass', 360, 2.4);
      lp1.frequency.setValueAtTime(360 * Math.pow(2, 1.95), t);
      lp1.frequency.exponentialRampToValueAtTime(320, t + 0.46);
      bindCutoff(ctl, lp1, cl, true);
      const ws = shaper(ctx, 1.4 + env.dirt * 0.8);
      const lp2 = filt(ctx, 'lowpass', 1750, 0.75);
      const g = gz(ctx, t); const e = adsr(g.gain, t, 0.008, v * 0.22, 0.44, 0.06, durSec, 0.32);
      o.connect(lp1); o2.connect(lp1); o3.connect(lp1);
      lp1.connect(ws); ws.connect(lp2); lp2.connect(g); g.connect(out);
      done(env, [o, o2, o3], e, out, cl); break;
    }
    case 'drone': {
      // Deep dark warehouse analog drone with slow organic filter breath
      const o = osc(ctx, 'sawtooth', hz, t, -7 + drift(env, 4));
      const o2 = osc(ctx, 'triangle', hz, t, 7 + drift(env, 4));
      const oSub = osc(ctx, 'sine', hz * 0.5, t, drift(env, 2));
      const gSub = gain(ctx, 0.45); oSub.connect(gSub);
      const lfo = osc(ctx, 'sine', 0.11, t); const ld = gain(ctx, 48); lfo.connect(ld);
      const lp = filt(ctx, 'lowpass', 195, 1.35); ld.connect(lp.frequency); bindCutoff(ctl, lp, cl, true);
      const ws = shaper(ctx, 1.4);
      const postLp = filt(ctx, 'lowpass', 880, 0.7);
      const g = gz(ctx, t); const e = adsr(g.gain, t, Math.min(2, durSec * 0.3), v * 0.22, 0.01, 1, durSec, 1.5);
      o.connect(lp); o2.connect(lp); gSub.connect(lp); lp.connect(ws); ws.connect(postLp); postLp.connect(g); g.connect(out);
      done(env, [o, o2, oSub, lfo], e, out, cl); break;
    }
    case 'noise': {
      const s = noiseSrc(env, t, true); const bp = filt(ctx, 'bandpass', 680, 0.85); const lp = filt(ctx, 'lowpass', 2200, 0.7);
      const lfo = osc(ctx, 'sine', 0.07, t); const ld = gain(ctx, 320); lfo.connect(ld); ld.connect(bp.frequency); bindCutoff(ctl, bp, cl, true);
      const g = gz(ctx, t); const e = adsr(g.gain, t, Math.min(2, durSec * 0.3), v * 0.11, 0.01, 1, durSec, 1.5);
      s.connect(bp); bp.connect(lp); lp.connect(g); g.connect(out); done(env, [s, lfo], e, out, cl); break;
    }
    case 'crackle': {
      const s = noiseSrc(env, t); const bp = filt(ctx, 'bandpass', 2400, 1.2); const g = gain(ctx, 0.0001);
      g.gain.setValueAtTime(v * 0.38, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.006);
      s.connect(bp); bp.connect(g); g.connect(out); done(env, [s], t + 0.02, out); break;
    }
    case 'hat': case 'ohat': {
      // Warm 909-style metallic hat: blended inharmonic metallic ratio oscillators + warm band-limited noise + analog tape rolloff
      const open = kind === 'ohat';
      const s = noiseSrc(env, t);
      const m1 = osc(ctx, 'square', 304.4, t, drift(env, 3));
      const m2 = osc(ctx, 'square', 522.7, t, drift(env, 3));
      const m3 = osc(ctx, 'square', 800.0, t, drift(env, 3));
      const mMix = gain(ctx, 0.14);
      m1.connect(mMix); m2.connect(mMix); m3.connect(mMix);
      const hp = filt(ctx, 'highpass', open ? 5200 : 5800, 0.7);
      const tapeLp = filt(ctx, 'lowpass', 10200, 0.65);
      const g = gz(ctx, t);
      const dur = open ? 0.24 : 0.048;
      g.gain.linearRampToValueAtTime(v * 0.32, t + 0.0015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(hp); mMix.connect(hp); hp.connect(tapeLp); tapeLp.connect(g); g.connect(out);
      done(env, [s, m1, m2, m3], t + dur + 0.025, out); break;
    }
    case 'ride': {
      // Warm 909 cymbal/ride with metallic shimmer + warm analog noise wash + 9.5kHz tape rolloff
      const fs = [342, 518, 695, 1042];
      const os = fs.map((f) => osc(ctx, 'triangle', f, t, drift(env, 4)));
      const s = noiseSrc(env, t);
      const nGain = gain(ctx, 0.35); s.connect(nGain);
      const bp = filt(ctx, 'bandpass', 6400, 0.65);
      const tapeLp = filt(ctx, 'lowpass', 9400, 0.7);
      const g = gz(ctx, t);
      g.gain.linearRampToValueAtTime(v * 0.14, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.56);
      os.forEach((o) => o.connect(bp)); nGain.connect(bp); bp.connect(tapeLp); tapeLp.connect(g); g.connect(out);
      done(env, [...os, s], t + 0.58, out); break;
    }
    case 'shaker': {
      const s = noiseSrc(env, t);
      const bp = filt(ctx, 'bandpass', 5200, 1.15);
      const tapeLp = filt(ctx, 'lowpass', 8800, 0.7);
      const g = gz(ctx, t);
      g.gain.linearRampToValueAtTime(v * 0.28, t + 0.011);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.068);
      s.connect(bp); bp.connect(tapeLp); tapeLp.connect(g); g.connect(out);
      done(env, [s], t + 0.085, out); break;
    }
    case 'clap': {
      const s = noiseSrc(env, t);
      const bp = filt(ctx, 'bandpass', 1080, 1.15);
      const tapeLp = filt(ctx, 'lowpass', 4600, 0.7);
      const g = gz(ctx, t); const p = g.gain; const a = v * 0.65;
      p.setValueAtTime(0, t);
      for (let i = 0; i < 3; i++) { const ti = t + i * 0.011; p.setValueAtTime(a, ti); p.exponentialRampToValueAtTime(a * 0.14, ti + 0.009); }
      p.setValueAtTime(a, t + 0.033); p.exponentialRampToValueAtTime(0.0001, t + 0.21);
      const ws = shaper(ctx, 1.35);
      s.connect(bp); bp.connect(ws); ws.connect(tapeLp); tapeLp.connect(g); g.connect(out);
      done(env, [s], t + 0.23, out); break;
    }
    case 'snare': {
      const o = osc(ctx, 'triangle', 175, t); o.frequency.exponentialRampToValueAtTime(108, t + 0.085);
      const g = gz(ctx, t); g.gain.linearRampToValueAtTime(v * 0.46, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
      const s = noiseSrc(env, t);
      const bp = filt(ctx, 'bandpass', 1850, 0.9);
      const lp = filt(ctx, 'lowpass', 4800, 0.7);
      const g2 = gz(ctx, t); g2.gain.linearRampToValueAtTime(v * 0.38, t + 0.002); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
      o.connect(g); g.connect(out); s.connect(bp); bp.connect(lp); lp.connect(g2); g2.connect(out);
      done(env, [o, s], t + 0.19, out); break;
    }
    case 'perc': case 'conga': case 'tom': {
      // Warm analog drum-machine / modular skin & low-mid tom synthesis (no high digital click)
      const k = kind === 'tom' ? 1.85 : kind === 'conga' ? 1.38 : 1.48;
      const dec = kind === 'tom' ? 0.32 : kind === 'conga' ? 0.23 : 0.16;
      const f = kind === 'tom' ? Math.min(135, Math.max(52, hz)) : kind === 'conga' ? Math.min(240, Math.max(95, hz * 0.82)) : Math.min(280, Math.max(110, hz * 0.78));
      const o = osc(ctx, 'sine', f * k, t, drift(env, 3));
      o.frequency.exponentialRampToValueAtTime(f, t + (kind === 'tom' ? 0.075 : 0.032));
      const oHarm = osc(ctx, 'triangle', f * 1.5, t, drift(env, 4));
      const gHarm = gz(ctx, t);
      gHarm.gain.linearRampToValueAtTime(v * 0.18, t + 0.002);
      gHarm.gain.exponentialRampToValueAtTime(0.0001, t + dec * 0.45);
      oHarm.connect(gHarm);
      const g = gz(ctx, t);
      g.gain.linearRampToValueAtTime(v * 0.56, t + 0.0025);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
      const s = noiseSrc(env, t);
      const bp = filt(ctx, 'bandpass', f * 1.75, 2.1);
      const sg = gz(ctx, t);
      sg.gain.setValueAtTime(v * 0.14, t);
      sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.014);
      const ws = shaper(ctx, 1.4 + env.dirt * 0.9);
      const toneLp = filt(ctx, 'lowpass', Math.min(1650, f * 5.5), 0.75);
      o.connect(g); gHarm.connect(g); g.connect(ws);
      s.connect(bp); bp.connect(sg); sg.connect(ws);
      ws.connect(toneLp); toneLp.connect(out);
      done(env, [o, oHarm, s], t + dec + 0.03, out); break;
    }
    case 'clang': {
      const car = osc(ctx, 'triangle', hz * 2.2, t);
      const mod = osc(ctx, 'sine', hz * 2.2 * 1.414, t);
      const md = gain(ctx, hz * 4.5); mod.connect(md); md.connect(car.frequency);
      const bp = filt(ctx, 'bandpass', 1450, 1.1);
      const lp = filt(ctx, 'lowpass', 3800, 0.7);
      const g = gz(ctx, t);
      g.gain.linearRampToValueAtTime(v * 0.22, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      const ws = shaper(ctx, 1.6 + env.dirt * 2.2);
      car.connect(bp); bp.connect(ws); ws.connect(lp); lp.connect(g); g.connect(out);
      done(env, [car, mod], t + 0.32, out); break;
    }
    case 'riser': {
      // Warm tape-swept analog riser / modular tension swell: dark filtered noise + warm triangle sub/mid sweep with tape saturation
      const dur = n.d * env.stepDur;
      const s = noiseSrc(env, t, true);
      const bp = filt(ctx, 'bandpass', 240, 1.8);
      bp.frequency.setValueAtTime(240, t);
      bp.frequency.exponentialRampToValueAtTime(3200, t + dur);
      const g = gz(ctx, t);
      g.gain.setValueAtTime(0.005, t);
      g.gain.exponentialRampToValueAtTime(v * 0.42, t + dur * 0.98);
      g.gain.linearRampToValueAtTime(0, t + dur + 0.04);

      // Warm analog VCO swell (triangle/sine rising into warm saturation, no piercing high sawtooth whine)
      const o = osc(ctx, 'triangle', 75, t, drift(env, 3));
      o.frequency.exponentialRampToValueAtTime(580, t + dur);
      const lp = filt(ctx, 'lowpass', 1100, 1.1);
      const og = gz(ctx, t);
      og.gain.setValueAtTime(0.001, t);
      og.gain.exponentialRampToValueAtTime(v * 0.18, t + dur * 0.98);
      og.gain.linearRampToValueAtTime(0, t + dur + 0.04);

      const ws = shaper(ctx, 1.45 + env.dirt * 0.8);
      const postLp = filt(ctx, 'lowpass', 3600, 0.7);

      s.connect(bp); bp.connect(g); g.connect(ws);
      o.connect(lp); lp.connect(og); og.connect(ws);
      ws.connect(postLp); postLp.connect(out);
      done(env, [s, o], t + dur + 0.06, out); break;
    }
    case 'impact': {
      // Subterranean concrete warehouse impact: deep 909-style sub-thud + tape-damped acoustic boom (no cheesy white-noise explosion)
      const o = osc(ctx, 'sine', 95, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.08);
      o.frequency.exponentialRampToValueAtTime(28, t + 0.75);
      const g = gz(ctx, t);
      g.gain.linearRampToValueAtTime(v * 0.9, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0004, t + 1.4);

      // Warm acoustic room/vault pressure burst
      const s = noiseSrc(env, t);
      const lpNoise = filt(ctx, 'lowpass', 420, 1.2);
      const ng = gz(ctx, t);
      ng.gain.setValueAtTime(v * 0.28, t);
      ng.gain.exponentialRampToValueAtTime(0.0004, t + 0.38);

      const ws = shaper(ctx, 1.5);
      const postLp = filt(ctx, 'lowpass', 650, 0.7);
      o.connect(g); g.connect(ws);
      s.connect(lpNoise); lpNoise.connect(ng); ng.connect(ws);
      ws.connect(postLp); postLp.connect(out);
      done(env, [o, s], t + 1.45, out); break;
    }
    case 'downlift': {
      // Dark tape wash / low-frequency resonant exhale: filtered organic noise descending into subterranean sub
      const dur = n.d * env.stepDur;
      const s = noiseSrc(env, t, true);
      const bp = filt(ctx, 'bandpass', 2400, 1.4);
      bp.frequency.setValueAtTime(2400, t);
      bp.frequency.exponentialRampToValueAtTime(140, t + dur);
      const g = gz(ctx, t);
      g.gain.linearRampToValueAtTime(v * 0.35, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0008, t + dur);

      // Low-frequency sub exhale
      const o = osc(ctx, 'sine', 110, t);
      o.frequency.exponentialRampToValueAtTime(30, t + dur * 0.7);
      const og = gz(ctx, t);
      og.gain.linearRampToValueAtTime(v * 0.28, t + 0.02);
      og.gain.exponentialRampToValueAtTime(0.0008, t + dur * 0.85);

      const postLp = filt(ctx, 'lowpass', 2800, 0.7);
      s.connect(bp); bp.connect(g); g.connect(postLp);
      o.connect(og); og.connect(postLp); postLp.connect(out);
      done(env, [s, o], t + dur + 0.05, out); break;
    }
    case 'crash': {
      // Warm analog reverse swell / tape splash (dark 909-style metallic wash, no brittle digital sizzle)
      const s = noiseSrc(env, t, true);
      if (n.p === 1) {
        // Reverse swell into drop
        const dur = n.d * env.stepDur;
        const bp = filt(ctx, 'bandpass', 1200, 1.2);
        bp.frequency.setValueAtTime(350, t);
        bp.frequency.exponentialRampToValueAtTime(2600, t + dur);
        const tapeLp = filt(ctx, 'lowpass', 4500, 0.7);
        const g = gz(ctx, t);
        g.gain.setValueAtTime(0.001, t);
        g.gain.exponentialRampToValueAtTime(v * 0.42, t + dur * 0.98);
        g.gain.linearRampToValueAtTime(0, t + dur + 0.02);
        s.connect(bp); bp.connect(tapeLp); tapeLp.connect(g); g.connect(out);
        done(env, [s], t + dur + 0.04, out);
      } else {
        // Dark metallic crash splash with warm tape rolloff
        const bp = filt(ctx, 'bandpass', 3800, 0.8);
        const tapeLp = filt(ctx, 'lowpass', 5800, 0.7);
        const g = gz(ctx, t);
        g.gain.linearRampToValueAtTime(v * 0.32, t + 0.002);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
        s.connect(bp); bp.connect(tapeLp); tapeLp.connect(g); g.connect(out);
        done(env, [s], t + 1.45, out);
      }
      break;
    }
  }
  return hz;
}
