import type { AutoLane, Project, ScGroup, SynthKind, Track } from './types';
import { STEPS_PER_BAR, totalBars } from './types';
import { clamp, lerp, Rng, hash } from './theory';
import { makeNoise, playVoice, type TrackCtl, type VEnv } from './voices';
import { inspectWavAsync } from './wavVerification';
import { encodeWavAsync } from './wavEncoding';
export { encodeWav } from './wavEncoding';
import { assertProject } from './validation';
import {expandTrackEvents,needsSidechainKey} from './musicalEvents';
import { SC_WORKLET_SRC } from './worklet';
import {renderOfflineWindows} from './offlineWindows';

const GROUPS: ScGroup[] = ['bass', 'harm', 'fx'];
export const stepDurOf = (bpm: number) => 60 / bpm / 4;
const cutCents = (v: number) => (v - 0.5) * 6000;
const hpHz = (v: number) => 20 * Math.pow(2, v * 6.5);

export interface Strip {
  id: string; input: GainNode; volA: GainNode; fader: GainNode; pan: StereoPannerNode; out: GainNode; analyser: AnalyserNode;
  revSend: GainNode; delSend: GainNode; cutoff: ConstantSourceNode; res: ConstantSourceNode; ctl: TrackCtl;
  keyConnected: boolean; target: AudioNode; sc: ScGroup | null; synth: SynthKind; last?: { hz: number; end: number };
}

function makeIR(ctx: BaseAudioContext, seconds = 2.8, seed = 2): AudioBuffer {
  const rng = new Rng(seed);
  const sr = ctx.sampleRate; const len = Math.floor(sr * seconds); const b = ctx.createBuffer(2, len, sr);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c); let lp1 = 0; let lp2 = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len; const a = Math.exp(-3.8 * t);
      const w = rng.next() * 2 - 1;
      // Progressive two-stage low-pass damping for a dark concrete vault acoustic space
      const coef = 0.28 - 0.21 * t;
      lp1 += (w - lp1) * coef;
      lp2 += (lp1 - lp2) * (coef * 0.85);
      d[i] = lp2 * a * (i < sr * 0.025 ? i / (sr * 0.025) : 1);
    }
  }
  return b;
}
const satCurve = (k: number) => {
  const c = new Float32Array(new ArrayBuffer(2048 * 4));
  const norm = Math.tanh(k);
  for (let i = 0; i < 2048; i++) {
    const x = (i / 2047) * 2 - 1;
    const biased = x + 0.055 * x * x - 0.055;
    c[i] = Math.tanh(biased * k) / norm;
  }
  return c;
};

const sharedBufferCache = new WeakMap<BaseAudioContext, Map<number, { noise: AudioBuffer; ir: AudioBuffer }>>();

export function getSharedBuffers(ctx: BaseAudioContext, seed: number): { noise: AudioBuffer; ir: AudioBuffer } {
  let bySeed = sharedBufferCache.get(ctx);
  if (!bySeed) {
    bySeed = new Map();
    sharedBufferCache.set(ctx, bySeed);
  }
  let pair = bySeed.get(seed);
  if (!pair) {
    pair = { noise: makeNoise(ctx, seed), ir: makeIR(ctx, 2.8, seed + 1) };
    bySeed.set(seed, pair);
  }
  return pair;
}

export class Graph {
  seed: number;
  ctx: BaseAudioContext; useWorklet: boolean;
  preMaster: GainNode; hp: BiquadFilterNode; sat: WaveShaperNode; limiter: DynamicsCompressorNode; master: GainNode; analyser: AnalyserNode;
  revIn: GainNode; delIn: GainNode; delay: DelayNode;
  groups = {} as Record<ScGroup, { input: AudioNode; node?: AudioWorkletNode; duck?: GainNode }>;
  strips = new Map<string, Strip>();
  hist: Record<ScGroup, { gr: number; key: number }[]> = { bass: [], harm: [], fx: [] };
  private owned: AudioNode[]=[];
  private disposed=false;
  failure?: string;
  env: VEnv; voices = 0; mode = '';

  /**
   * Pre-allocates and primes the sidechain AudioWorkletNodes through a silent zero-gain sink
   * so the audio rendering thread instantiates and warms up the worklet processors before playback starts.
   */
  static prewarmWorkletNodes(ctx: BaseAudioContext, record = true): Partial<Record<ScGroup, AudioWorkletNode>> {
    const nodes: Partial<Record<ScGroup, AudioWorkletNode>> = {};
    if (typeof AudioWorkletNode === 'undefined') return nodes;
    const silent = ctx.createGain();
    silent.gain.value = 0;
    silent.connect(ctx.destination);
    for (const g of GROUPS) {
      try {
        const node = new AudioWorkletNode(ctx, 'sc-comp', {
          numberOfInputs: 2,
          numberOfOutputs: 1,
          outputChannelCount: [2],
          processorOptions: { metering: record },
        });
        node.connect(silent);
        nodes[g] = node;
      } catch {
        // Fallback path will be used if AudioWorkletNode instantiation fails
      }
    }
    return nodes;
  }

  constructor(
    ctx: BaseAudioContext,
    useWorklet: boolean,
    shared?: { noise: AudioBuffer; ir: AudioBuffer },
    record = true,
    seed = 1,
    prewarmedNodes?: Partial<Record<ScGroup, AudioWorkletNode>>
  ) {
    this.seed=seed;
    this.ctx = ctx; this.useWorklet = useWorklet;
    const cached = shared ?? getSharedBuffers(ctx, seed);
    const noise = cached.noise; const ir = cached.ir;
    const voiceRandom=new Rng(seed+2);
    this.env = { ctx, noise, random: ()=>voiceRandom.next(), sources:new Set(), dirt: 0.3, stepDur: 0.11, onStart: () => { this.voices++; }, onEnd: () => { this.voices = Math.max(0, this.voices - 1); } };
    this.preMaster = ctx.createGain();
    this.hp = ctx.createBiquadFilter(); this.hp.type = 'highpass'; this.hp.frequency.value = 20; this.hp.Q.value = 0.5;
    this.sat = ctx.createWaveShaper(); this.sat.curve = satCurve(1.4); this.sat.oversample = '2x';
    this.limiter = ctx.createDynamicsCompressor(); this.limiter.threshold.value = -4; this.limiter.knee.value = 0; this.limiter.ratio.value = 20; this.limiter.attack.value = 0.002; this.limiter.release.value = 0.12;
    this.master = ctx.createGain(); this.master.gain.value = 0.85;
    this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 1024; this.analyser.smoothingTimeConstant = 0.7;
    this.preMaster.connect(this.hp); this.hp.connect(this.sat); this.sat.connect(this.limiter); this.limiter.connect(this.master); this.master.connect(this.analyser); this.analyser.connect(ctx.destination);

    for (const g of GROUPS) {
      if (useWorklet) {
        const pre = prewarmedNodes?.[g];
        if (pre) {
          try { pre.disconnect(); } catch { /* detach from silent prewarm sink */ }
        }
        const node =
          pre ??
          new AudioWorkletNode(ctx, 'sc-comp', {
            numberOfInputs: 2,
            numberOfOutputs: 1,
            outputChannelCount: [2],
            processorOptions: { metering: record },
          });
        node.onprocessorerror=()=>{this.failure='Sidechain processor failed; restart playback after checking audio support.';};
        node.connect(this.preMaster);
        if (record) node.port.onmessage = (e) => { const h = this.hist[g]; h.push(e.data); if (h.length > 400) h.shift(); };
        this.groups[g] = { input: node, node };
      } else {
        const duck = ctx.createGain(); duck.connect(this.preMaster); this.groups[g] = { input: duck, duck };
      }
    }
    // Dark concrete vault reverb + warm analog tape-saturated delay returns
    const conv = ctx.createConvolver(); conv.buffer = ir; const revOut = ctx.createGain(); revOut.gain.value = 0.56;
    this.revIn = ctx.createGain(); const pre = ctx.createDelay(0.2); pre.delayTime.value = 0.024;
    const revLp = ctx.createBiquadFilter(); revLp.type = 'lowpass'; revLp.frequency.value = 2350; revLp.Q.value = 0.65;
    const revHp = ctx.createBiquadFilter(); revHp.type = 'highpass'; revHp.frequency.value = 155; revHp.Q.value = 0.65;
    this.revIn.connect(pre); pre.connect(revHp); revHp.connect(conv); conv.connect(revLp); revLp.connect(revOut); revOut.connect(this.groups.fx.input);
    this.delIn = ctx.createGain(); this.delay = ctx.createDelay(2); this.delay.delayTime.value = 0.34;
    const fb = ctx.createGain(); fb.gain.value = 0.48;
    const fbHp = ctx.createBiquadFilter(); fbHp.type = 'highpass'; fbHp.frequency.value = 185; fbHp.Q.value = 0.65;
    const fbLp = ctx.createBiquadFilter(); fbLp.type = 'lowpass'; fbLp.frequency.value = 2050; fbLp.Q.value = 0.7;
    const fbSat = ctx.createWaveShaper(); fbSat.curve = satCurve(1.35); fbSat.oversample = '2x';
    const delOut = ctx.createGain(); delOut.gain.value = 0.58;
    this.delIn.connect(this.delay); this.delay.connect(fbHp); fbHp.connect(fbLp); fbLp.connect(fbSat); fbSat.connect(fb); fb.connect(this.delay); fbLp.connect(delOut); delOut.connect(this.preMaster);
    const dToRev = ctx.createGain(); dToRev.gain.value = 0.28; delOut.connect(dToRev); dToRev.connect(this.revIn);
    this.owned.push(this.preMaster,this.hp,this.sat,this.limiter,this.master,this.analyser,this.revIn,this.delIn,this.delay,conv,revOut,pre,revLp,revHp,fb,fbHp,fbLp,fbSat,delOut,dToRev);
  }

  private createStrip(t: Track): Strip {
    const ctx = this.ctx;
    const input = ctx.createGain(); const volA = ctx.createGain(); const fader = ctx.createGain(); const pan = ctx.createStereoPanner(); const out = ctx.createGain();
    const analyser = ctx.createAnalyser(); analyser.fftSize = 256;
    const revSend = ctx.createGain(); const delSend = ctx.createGain();
    const cutoff = ctx.createConstantSource(); cutoff.offset.value = 0; cutoff.start();
    const res = ctx.createConstantSource(); res.offset.value = 0; res.start();
    input.connect(volA); volA.connect(fader); fader.connect(pan); pan.connect(out); out.connect(analyser);
    out.connect(revSend); revSend.connect(this.revIn); out.connect(delSend); delSend.connect(this.delIn);
    out.connect(this.preMaster);
    const s: Strip = { id: t.id, input, volA, fader, pan, out, analyser, revSend, delSend, cutoff, res, ctl: { cutoff, res }, keyConnected: false, target: this.preMaster, sc: null, synth: t.synth };
    this.strips.set(t.id, s);
    return s;
  }

  private destroyStrip(s: Strip) {
    s.revSend.disconnect();s.delSend.disconnect();s.analyser.disconnect();s.out.disconnect(); s.cutoff.stop(); s.res.stop(); s.cutoff.disconnect(); s.res.disconnect(); s.input.disconnect(); s.volA.disconnect(); s.fader.disconnect(); s.pan.disconnect();
    this.strips.delete(s.id);
  }

  sync(p: Project) {
    const now = this.ctx.currentTime; const anySolo = p.tracks.some((t) => t.solo);
    const laneOf = (id: string, param: string) => p.auto.some((a) => a.track === id && a.param === param);
    const live = new Set<string>();
    for (const t of p.tracks) {
      live.add(t.id);
      const isNew = !this.strips.has(t.id);
      const s = this.strips.get(t.id) ?? this.createStrip(t);
      const audible = !t.mute && (!anySolo || t.solo);
      if (isNew) {
        s.fader.gain.value = t.mute ? 0 : t.vol;
        s.out.gain.value = audible ? 1 : 0;
        s.pan.pan.value = t.pan;
      }
      s.fader.gain.setTargetAtTime(t.mute ? 0 : t.vol, now, 0.015);
      s.out.gain.setTargetAtTime(audible ? 1 : 0,now,0.015);
      const keyConnected=t.synth==='kick'&&this.useWorklet;
      if(keyConnected!==s.keyConnected){
        for(const group of GROUPS){const node=this.groups[group].node!;if(keyConnected)s.pan.connect(node,0,1);else s.pan.disconnect(node,0,1);}
        s.keyConnected=keyConnected;
      }
      s.pan.pan.setTargetAtTime(t.pan, now, 0.015);
      if (!laneOf(t.id, 'rev')) s.revSend.gain.setTargetAtTime(t.rev * 0.8, now, 0.02);
      s.delSend.gain.setTargetAtTime(t.del * 0.7, now, 0.02);
      if (!laneOf(t.id, 'cutoff')) s.cutoff.offset.setTargetAtTime(cutCents(t.cutoff), now, 0.02);
      if (!laneOf(t.id, 'res')) s.res.offset.setTargetAtTime(t.res * 14, now, 0.02);
      const want = t.sc ? this.groups[t.sc].input : this.preMaster;
      if (s.target !== want) {
        try { s.out.disconnect(s.target); } catch { /* not connected */ }
        s.out.connect(want); s.target = want;
      }
      s.sc = t.sc; s.synth = t.synth;
    }
    for (const [id, s] of this.strips) if (!live.has(id)) this.destroyStrip(s);
    for (const g of GROUPS) {
      const c = p.sc[g]; const n = this.groups[g].node;
      if (n) {
        const set = (k: string, v: number) => n.parameters.get(k)!.setTargetAtTime(v, now, 0.01);
        set('thr', c.thr); set('ratio', c.ratio); set('atk', c.atk); set('rel', c.rel); set('hpf', c.hpf); set('knee', c.knee); set('mix', p.scOn ? c.mix : 0);
      }
    }
    const bpm = p.params.bpm; this.env.stepDur = stepDurOf(bpm); this.delay.delayTime.setTargetAtTime(60 / bpm * 0.75, now, 0.05);
    this.env.dirt = clamp(p.params.dirt + (p.params.mode === 'industrial' ? 0.25 : p.params.mode === 'clean' ? -0.15 : 0));
    if (this.mode !== p.params.mode) { this.mode = p.params.mode; this.sat.curve = satCurve(p.params.mode === 'industrial' ? 2.4 : p.params.mode === 'clean' ? 0.8 : 1.4); }
  }

  kill() {
    if(this.disposed)return;this.disposed=true;
    for(const source of this.env.sources){try{source.stop();source.disconnect();}catch{/* Source already ended. */}}
    this.env.sources.clear();
    for(const strip of [...this.strips.values()])this.destroyStrip(strip);
    for(const group of Object.values(this.groups)){
      if(group.node){group.node.port.postMessage('dispose');group.node.port.onmessage=null;group.node.port.close();group.node.disconnect();}
      group.duck?.disconnect();
    }
    for(const node of this.owned)node.disconnect();this.owned=[];
  }
}

// ───────────── automation helpers ─────────────
export function evalLane(lane: AutoLane, bar: number): number {
  const pts = lane.pts; if (!pts.length) return 0.5;
  if (bar <= pts[0].bar) return pts[0].v;
  for (let i = 1; i < pts.length; i++) {
    if (bar < pts[i].bar) {
      const a = pts[i - 1], b = pts[i];
      if (b.bar - a.bar < 0.02) return a.v;
      const t = Math.max(0, Math.min(1, (bar - a.bar) / (b.bar - a.bar)));
      const c = b.curve ?? 0;
      const k = Math.abs(c) < 1e-4 ? t : c > 0 ? Math.pow(t, 1 + c * 2.6) : 1 - Math.pow(1 - t, 1 - c * 2.6);
      return lerp(a.v, b.v, k);
    }
  }
  return pts[pts.length - 1].v;
}

export class Scheduler {
  private scheduled = new Map<string,{lane:AutoLane,param:AudioParam}>();
  constructor(public g: Graph) {}

  private laneTarget(lane: AutoLane): { param: AudioParam; map: (v: number) => number; exp: boolean } | null {
    if (lane.param === 'hp') return { param: this.g.hp.frequency, map: hpHz, exp: true };
    const s = this.g.strips.get(lane.track); if (!s) return null;
    switch (lane.param) {
      case 'cutoff': return { param: s.cutoff.offset, map: cutCents, exp: false };
      case 'res': return { param: s.res.offset, map: (v) => v * 14, exp: false };
      case 'rev': return { param: s.revSend.gain, map: (v) => v * 0.8, exp: false };
      case 'vol': return { param: s.volA.gain, map: (v) => v, exp: false };
    }
  }

  /** sample-accurate: lane events are placed on AudioParam timelines (with Bezier curve sub-stepping when curved) */
  scheduleAutomation(p: Project, fromBar: number, t0: number, future: boolean) {
    const sd = stepDurOf(p.params.bpm);
    const active=new Set(p.auto.map(l=>l.id));
    for(const [id,old] of this.scheduled)if(!active.has(id)||p.auto.some(l=>l.id===id&&(l.track!==old.lane.track||l.param!==old.lane.param))){
      old.param.cancelScheduledValues(t0);
      const track=p.tracks.find(t=>t.id===old.lane.track);
      const base=old.lane.param==='vol'?1:old.lane.param==='hp'?20:old.lane.param==='rev'?(track?.rev??0)*0.8:old.lane.param==='cutoff'?cutCents(track?.cutoff??0.5):(track?.res??0)*14;
      old.param.setValueAtTime(base,t0);this.scheduled.delete(id);
    }
    for (const lane of p.auto) {
      const tg = this.laneTarget(lane); if (!tg || !lane.pts.length) continue;
      const { param, map, exp } = tg;
      this.scheduled.set(lane.id,{lane,param});
      param.cancelScheduledValues(t0);
      param.setValueAtTime(map(evalLane(lane, fromBar)), t0);
      if (!future) continue;
      let prev = lane.pts.filter((q) => q.bar <= fromBar).pop();
      for (const q of lane.pts) {
        if (q.bar <= fromBar) continue;
        const time = t0 + (q.bar - fromBar) * STEPS_PER_BAR * sd; const val = map(q.v);
        const gap = prev ? q.bar - prev.bar : 1;
        if (gap < 0.02) {
          param.setValueAtTime(val, time);
        } else if (prev && q.curve && Math.abs(q.curve) >= 0.01) {
          const segStart = Math.max(fromBar, prev.bar);
          const steps = Math.min(20, Math.max(6, Math.ceil((q.bar - segStart) * 2)));
          for (let s = 1; s <= steps; s++) {
            const sb = segStart + ((q.bar - segStart) * s) / steps;
            const st = t0 + (sb - fromBar) * STEPS_PER_BAR * sd;
            const sv = map(evalLane(lane, sb));
            if (exp) param.exponentialRampToValueAtTime(Math.max(0.001, sv), st);
            else param.linearRampToValueAtTime(sv, st);
          }
        } else if (exp) {
          param.exponentialRampToValueAtTime(Math.max(0.001, val), time);
        } else {
          param.linearRampToValueAtTime(val, time);
        }
        prev = q;
      }
    }
  }

  scheduleWindow(p: Project, a: number, b: number, mapT: (step: number) => number, chase=false, endStep=Infinity) {
    const sd=stepDurOf(p.params.bpm),anySolo=p.tracks.some(t=>t.solo),keyNeeded=needsSidechainKey(p);
    const kickTimes:number[]=[];
    for(const track of p.tracks){
      if(track.mute||(anySolo&&!track.solo&&!(track.synth==='kick'&&keyNeeded)))continue;
      const strip=this.g.strips.get(track.id);if(!strip)continue;
      for(const event of expandTrackEvents(track,p.params,a,Math.min(b,endStep),chase)){
        const time=mapT(event.startStep),duration=Math.max(0.001,Math.min(event.durationSteps,endStep-event.startStep)*sd);
        let slideFrom:number|undefined;
        if(track.synth==='acid'){
          if(!event.chased&&event.note.slide&&strip.last&&time-strip.last.end<=sd*0.6&&time>=strip.last.end-0.2)slideFrom=strip.last.hz;
          strip.last={hz:440*Math.pow(2,(event.note.p-69)/12),end:time+duration};
        }
        if(track.synth==='kick')kickTimes.push(time);
        const noiseRandom=new Rng(hash(this.g.seed,track.id,event.clipId,event.cycle,event.note.t,event.note.p,'noise'));
        this.g.env.random=()=>noiseRandom.next();
        playVoice(track.synth,this.g.env,strip.input,time,duration,event.note,strip.ctl,slideFrom);
      }
    }
    if(!this.g.useWorklet&&p.scOn){
      kickTimes.sort((a,b)=>a-b);
      for(const group of GROUPS){
        const duck=this.g.groups[group].duck;if(!duck)continue;const cfg=p.sc[group];
        const depth=Math.min(0.92,(1-1/cfg.ratio)*1.05)*cfg.mix;
        for(const time of kickTimes){duck.gain.setValueAtTime(1-depth,time);duck.gain.setTargetAtTime(1,time+0.004,cfg.rel/1000/3);}
      }
    }
  }

}

// ───────────── realtime engine ─────────────
export function playbackRange(p:Project,fromBar:number){
  if(!Number.isFinite(fromBar))throw new Error('Invalid playback position');
  const end=totalBars(p),loopStart=Math.min(end,p.loop.a),loopEnd=Math.min(end,p.loop.b);
  const loop=p.loop.on&&loopEnd>loopStart;
  const start=loop&&(fromBar<loopStart||fromBar>=loopEnd)?loopStart:Math.max(0,Math.min(end,fromBar));
  return {start,end,loopStart,loopEnd:loop?loopEnd:Infinity};
}
export class Engine {
  ctx?: AudioContext; graph: Graph | null = null; sched?: Scheduler; workletOk = false; workletTried = false;
  prewarmed = false;
  playing = false; timer?: number; getProject: () => Project = () => { throw new Error('no project'); };
  private segs: { refStep: number; refTime: number; dur: number }[] = [];
  private nextStep = 0; private lastProject?: Project; private lastAuto?: unknown;
  private shared?: { noise: AudioBuffer; ir: AudioBuffer };
  private prewarmedNodes?: Partial<Record<ScGroup, AudioWorkletNode>>;
  private generation=0;
  private chaseNextWindow=false;
  private initializing?: Promise<void>;
  schedMs = 0; onStop?: () => void; onError?: (error:Error)=>void;

  constructor() {
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      const warmOnce = () => {
        window.removeEventListener('pointerdown', warmOnce, true);
        window.removeEventListener('keydown', warmOnce, true);
        window.removeEventListener('touchstart', warmOnce, true);
        void this.prewarm().catch(() => {
          /* Defer any context errors until explicit play() */
        });
      };
      window.addEventListener('pointerdown', warmOnce, { capture: true, passive: true });
      window.addEventListener('keydown', warmOnce, { capture: true, passive: true });
      window.addEventListener('touchstart', warmOnce, { capture: true, passive: true });
    }
  }

  get state() { return this.ctx?.state ?? 'idle'; }
  get voices() { return this.graph?.voices ?? 0; }
  get latency() { return this.ctx ? (this.ctx.baseLatency || 0) + ((this.ctx as AudioContext & { outputLatency?: number }).outputLatency || 0) : 0; }

  private safeSeed(): number {
    try {
      return this.getProject().params.seed;
    } catch {
      return 1337;
    }
  }

  private async initialize() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'interactive' });
    }
    const resume=this.ctx.state!=='running'?this.ctx.resume():Promise.resolve();
    await resume;
    if (!this.workletTried) {
      this.workletTried = true;
      try {
        const url = URL.createObjectURL(new Blob([SC_WORKLET_SRC], { type: 'application/javascript' }));
        try{await this.ctx.audioWorklet.addModule(url); this.workletOk = true;}finally{URL.revokeObjectURL(url);}
      } catch (e) { console.warn('AudioWorklet unavailable — using scheduled-envelope sidechain fallback', e); this.workletOk = false; }
    }
    if (this.ctx) {
      this.shared = getSharedBuffers(this.ctx, this.safeSeed());
      if (this.workletOk && !this.prewarmedNodes) {
        this.prewarmedNodes = Graph.prewarmWorkletNodes(this.ctx, true);
      }
      this.prewarmed = true;
    }
  }

  /** Pre-warms AudioContext, AudioWorklet processor module, shared impulse/noise buffers, and standby AudioWorkletNodes. */
  async prewarm(seed?: number): Promise<boolean> {
    if (!this.initializing) {
      this.initializing = this.initialize().finally(() => {
        this.initializing = undefined;
      });
    }
    await this.initializing;
    if (this.ctx) {
      this.shared = getSharedBuffers(this.ctx, seed ?? this.safeSeed());
      if (this.workletOk && !this.prewarmedNodes) {
        this.prewarmedNodes = Graph.prewarmWorkletNodes(this.ctx, true);
      }
      this.prewarmed = true;
    }
    return this.prewarmed;
  }

  /** Immediately syncs track parameters and reschedules automation on the live graph (used by undo/redo). */
  syncImmediate(p: Project) {
    if (!this.ctx || !this.graph || !this.sched) return;
    this.graph.sync(p);
    this.lastProject = p;
    this.lastAuto = p.auto;
    if (this.segs.length) {
      const sg = this.segs[this.segs.length - 1];
      const nowStep = sg.refStep + Math.max(0, this.ctx.currentTime + 0.015 - sg.refTime) / sg.dur;
      this.sched.scheduleAutomation(p, nowStep / STEPS_PER_BAR, this.ctx.currentTime + 0.015, true);
    }
  }

  /** call from a user gesture (also unlocks iOS/Android autoplay policies) */
  async play(fromBar: number) {
    if(!Number.isFinite(fromBar))throw new Error('Invalid playback position');
    const generation=++this.generation;
    this.halt();
    const wasWarm = this.prewarmed && !!this.prewarmedNodes;
    if(!this.initializing)this.initializing=this.initialize().finally(()=>{this.initializing=undefined;});
    await this.initializing;
    if(generation!==this.generation)return;
    const ctx = this.ctx!; const p = this.getProject();assertProject(p);
    this.shared = getSharedBuffers(ctx, p.params.seed);
    const warmNodes = this.prewarmedNodes;
    this.prewarmedNodes = undefined;
    this.graph=new Graph(ctx,this.workletOk,this.shared,true,p.params.seed,warmNodes);this.sched=new Scheduler(this.graph);
    this.graph!.sync(p); this.lastProject = p; this.lastAuto = p.auto;
    const range=playbackRange(p,fromBar);
    const dur = stepDurOf(p.params.bpm); const t0 = ctx.currentTime + (wasWarm ? 0.025 : 0.045); const step = range.start * STEPS_PER_BAR;
    this.segs = [{ refStep: step, refTime: t0, dur }]; this.nextStep = step; this.chaseNextWindow=true; this.playing = true;
    try{
      this.sched!.scheduleAutomation(p, range.start, t0, true);
      this.timer = window.setInterval(() => {try{this.tick();}catch(error){this.stop();this.onError?.(error instanceof Error?error:new Error(String(error)));}}, 25); this.tick();
    }catch(error){this.stop();throw error;}
  }

  private halt() {
    if (this.timer) clearInterval(this.timer); this.timer = undefined; this.playing = false;
    if (this.graph) { this.graph.kill(); this.graph = null; this.sched = undefined; }
    if (this.ctx && this.workletOk && !this.prewarmedNodes) {
      this.prewarmedNodes = Graph.prewarmWorkletNodes(this.ctx, true);
    }
  }
  stop() { ++this.generation; const was = this.playing; this.halt(); if (was) this.onStop?.(); }

  getStep(): number {
    if (!this.ctx || !this.segs.length) return -1;
    const t = this.ctx.currentTime - this.latency;
    let seg = this.segs[0];
    for (const s of this.segs) if (s.refTime <= t) seg = s;
    if (this.segs.length > 4) this.segs = this.segs.filter((s) => s === seg || s.refTime > t);
    return seg.refStep + Math.max(0, t - seg.refTime) / seg.dur;
  }

  private tick() {
    const ctx = this.ctx!; const g = this.graph; if (!g || !this.sched) return;
    if(g.failure)throw new Error(g.failure);
    const t0 = performance.now(); const p = this.getProject();
    if (p !== this.lastProject) {
      if(p.params.seed!==g.seed){void this.play(Math.max(0,this.getStep()/16)).catch(e=>{this.stop();this.onError?.(e instanceof Error?e:new Error(String(e)));});return;}
      g.sync(p); this.lastProject = p;
      const seg0 = this.segs[this.segs.length - 1]; const dur = stepDurOf(p.params.bpm);
      if (Math.abs(seg0.dur - dur) > 1e-9) { // tempo change: new segment from here
        const tn = seg0.refTime + (this.nextStep - seg0.refStep) * seg0.dur;
        this.segs.push({ refStep: this.nextStep, refTime: Math.max(tn, ctx.currentTime), dur });
      }
      if (p.auto !== this.lastAuto || Math.abs(seg0.dur-dur)>1e-9) {
        this.lastAuto = p.auto; const sg = this.segs[this.segs.length - 1];
        const nowStep = sg.refStep + Math.max(0, ctx.currentTime + 0.02 - sg.refTime) / sg.dur;
        this.sched.scheduleAutomation(p, nowStep / STEPS_PER_BAR, ctx.currentTime + 0.02, true);
      }
    }
    const seg = this.segs[this.segs.length - 1]; const end = totalBars(p) * STEPS_PER_BAR;
    const clockStep=seg.refStep+(ctx.currentTime-seg.refTime)/seg.dur;
    if(this.nextStep<clockStep-0.5){this.nextStep=Math.max(0,clockStep);this.chaseNextWindow=true;this.sched.scheduleAutomation(p,this.nextStep/16,ctx.currentTime,true);}
    const horizon = ctx.currentTime + 0.3; const limit = seg.refStep + (horizon - seg.refTime) / seg.dur;
    const range=playbackRange(p,this.nextStep/STEPS_PER_BAR);
    const loopEnd = range.loopEnd * STEPS_PER_BAR;
    const stop = Math.min(limit, loopEnd, end);
    if (stop > this.nextStep) { this.sched.scheduleWindow(p, this.nextStep, stop, (s) => seg.refTime + (s - seg.refStep) * seg.dur,this.chaseNextWindow,Math.min(end,loopEnd)); this.chaseNextWindow=false; this.nextStep = stop; }
    if (loopEnd !== Infinity && this.nextStep >= loopEnd - 1e-9) {
      const tw = Math.max(ctx.currentTime,seg.refTime + (loopEnd - seg.refStep) * seg.dur); const ls = range.loopStart * STEPS_PER_BAR;
      this.segs.push({ refStep: ls, refTime: tw, dur: seg.dur }); this.nextStep = ls;this.chaseNextWindow=true;
      this.sched.scheduleAutomation(p, range.loopStart, tw, true);
    } else if (this.nextStep >= end - 1e-9 && ctx.currentTime > seg.refTime + (end - seg.refStep) * seg.dur + 3.5) this.stop();
    this.schedMs = this.schedMs * 0.9 + (performance.now() - t0) * 0.1;
  }
}

export { Graph as Aw, Engine as RE };

// ───────────── offline WAV export (same scheduler + graph) ─────────────
export type ExportState = 'IDLE' | 'VALIDATING' | 'PREPARING' | 'RENDERING' | 'PROCESSING' | 'ENCODING' | 'SAVING' | 'VERIFYING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export interface ExportResult { blob: Blob; peakDb: number; rmsDb: number; frames: number; seconds: number; sc: 'worklet' | 'fallback'; expectedFrames: number }
export interface ExportOpts {
  sampleRate: number;
  bits: 16 | 24 | 32;
  startBar?: number;
  endBar?: number;
  tailSec?: number;
  onState: (s: ExportState, progress: number, msg?: string) => void;
  cancelled: () => boolean;
  allowDegradedSidechain?: boolean;
}

/** Isolate a single track for stem export while keeping kick sidechain keys active pre-solo. */
export function isolateStemProject(p: Project, trackId: string): Project {
  const target = p.tracks.find((t) => t.id === trackId);
  if (!target) throw new Error(`Missing stem track: ${trackId}`);
  return {
    ...p,
    tracks: p.tracks.map((t) => ({
      ...t,
      mute: t.id === trackId ? false : t.synth === 'kick' ? t.mute : true,
      solo: t.id === trackId,
    })),
  };
}

let exportActive=false;
export async function renderWav(p: Project, options: ExportOpts): Promise<ExportResult> {
  const o={...options};
  if(exportActive){o.onState('FAILED',0);throw new Error('An export is already running or draining. Wait for it to finish; reload the app if the browser cannot resume it.');}
  exportActive=true;let native:Promise<AudioBuffer>|undefined;
  try{
    const result=await renderWavSnapshot(p,o,rendering=>{native=rendering;});
    if(o.cancelled())throw new Error('CANCELLED');
    o.onState('COMPLETED',1);return result;
  }catch(error){
    o.onState(error instanceof Error&&error.message==='CANCELLED'?'CANCELLED':'FAILED',0);
    throw error;
  }finally{
    // Failed/cancelled native renders may still retain a large PCM allocation.
    const release=()=>{exportActive=false;};if(native)void native.then(release,release);else release();
  }
}
async function renderWavSnapshot(source:Project,o:ExportOpts,nativeStarted:(rendering:Promise<AudioBuffer>)=>void):Promise<ExportResult>{
  o.onState('VALIDATING', 0);
  assertProject(source);const p=structuredClone(source);
  if(o.cancelled())throw new Error('CANCELLED');
  if(![44100,48000,96000].includes(o.sampleRate)||![16,24,32].includes(o.bits))throw new Error('Unsupported export format');
  const maxBars = totalBars(p);
  if (!maxBars || !p.tracks.some((t) => t.clips.length)) throw new Error('Project has no clips to render.');
  const startBar = o.startBar ?? 0;
  const endBar = o.endBar ?? maxBars;
  const tailSec = o.tailSec ?? 4;
  if (!Number.isFinite(startBar) || !Number.isFinite(endBar) || startBar < 0 || endBar <= startBar || endBar > maxBars) {
    throw new Error('Invalid export bar range.');
  }
  if (!Number.isFinite(tailSec) || tailSec < 0 || tailSec > 30) {
    throw new Error('Invalid export tail duration.');
  }
  const bars = endBar - startBar;
  if (!window.OfflineAudioContext) throw new Error('OfflineAudioContext not supported in this browser.');
  o.onState('PREPARING', 0);
  const sd = stepDurOf(p.params.bpm); const songSec = bars * STEPS_PER_BAR * sd; const sr = o.sampleRate;
  const frames = Math.ceil((songSec + tailSec) * sr);
  if(frames*8>256*1024*1024)throw new Error('Export exceeds the 256 MiB PCM budget. Use a shorter range or lower sample rate.');
  const ctx = new OfflineAudioContext(2, frames, sr);
  let wk = false;
  try { const url = URL.createObjectURL(new Blob([SC_WORKLET_SRC], { type: 'application/javascript' })); try{await ctx.audioWorklet.addModule(url);wk=true;}finally{URL.revokeObjectURL(url);} } catch { wk = false; }
  if(o.cancelled())throw new Error('CANCELLED');
  if(!wk&&needsSidechainKey(p)&&!o.allowDegradedSidechain)throw new Error('Required sidechain AudioWorklet unavailable for export. Disable sidechain explicitly or use a supported browser.');
  const graph = new Graph(ctx, wk, undefined, false,p.params.seed); const sched = new Scheduler(graph);
  let buf:AudioBuffer;
  try{
    graph.sync(p);sched.scheduleAutomation(p,startBar,0,true);o.onState('RENDERING',0);
    const startStep=startBar*STEPS_PER_BAR;
    const endStep=endBar*STEPS_PER_BAR;
    const total=endStep-startStep;
    buf=await renderOfflineWindows(ctx,total,sd,(a,b)=>{
      if(graph.failure)throw new Error(graph.failure);
      if(startStep===0){
        sched.scheduleWindow(p,a,b,s=>s*sd,false,total);
      }else{
        sched.scheduleWindow(p,startStep+a,startStep+b,s=>(s-startStep)*sd,a===0,endStep);
      }
    },o.cancelled,progress=>o.onState('RENDERING',progress),()=>graph.kill(),nativeStarted);
    if(graph.failure)throw new Error(graph.failure);
  }finally{graph.kill();}
  if(o.cancelled())throw new Error('CANCELLED');
  o.onState('PROCESSING', 0);
  if(o.cancelled())throw new Error('CANCELLED');
  if(buf.length!==frames||buf.sampleRate!==sr||buf.numberOfChannels!==2)throw new Error('Rendered audio format or frame count mismatch');
  o.onState('PROCESSING',1);
  o.onState('ENCODING',0);
  const blob=await encodeWavAsync(buf,o.bits,{cancelled:o.cancelled,progress:f=>o.onState('ENCODING',f)});
  o.onState('SAVING',1);
  o.onState('VERIFYING',0);
  const decoded=await inspectWavAsync(await blob.arrayBuffer(),{cancelled:o.cancelled,progress:f=>o.onState('VERIFYING',f)});
  if(decoded.frames!==frames||decoded.sampleRate!==sr||decoded.channels!==2||decoded.bits!==o.bits)throw new Error('Encoded WAV verification failed');
  if(decoded.rms<1e-5)throw new Error('Verification failed: rendered audio is silent.');
  const peak=decoded.peak,encodedRms=decoded.rms;
  return { blob, peakDb: 20 * Math.log10(peak + 1e-9), rmsDb: 20 * Math.log10(encodedRms + 1e-9), frames: buf.length, seconds: buf.length / sr, sc: wk ? 'worklet' : 'fallback', expectedFrames: frames };
}
