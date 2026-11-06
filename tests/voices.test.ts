import { describe, it, expect, vi } from 'vitest';
import { playVoice, makeNoise, type SynthKind, type VEnv, type TrackCtl } from '../src/engine/voices';
import { Rng } from '../src/engine/theory';
import { Graph, getSharedBuffers } from '../src/engine/audio';

class MockParam {
  value = 0;
  setValueAtTime(v: number) { this.value = v; }
  setTargetAtTime(v: number) { this.value = v; }
  linearRampToValueAtTime(v: number) { this.value = v; }
  exponentialRampToValueAtTime(v: number) { this.value = v; }
  cancelScheduledValues() {}
}

class MockNode {
  edges: any[] = [];
  gain = new MockParam();
  frequency = new MockParam();
  Q = new MockParam();
  detune = new MockParam();
  offset = new MockParam();
  delayTime = new MockParam();
  pan = new MockParam();
  threshold = new MockParam();
  knee = new MockParam();
  ratio = new MockParam();
  attack = new MockParam();
  release = new MockParam();
  type = 'lowpass';
  curve: any = null;
  buffer: any = null;
  loop = false;
  oversample = 'none';
  parameters = new Map(['thr', 'ratio', 'atk', 'rel', 'hpf', 'knee', 'mix'].map((k) => [k, new MockParam()]));
  port = { postMessage() {}, close() {}, onmessage: null };
  onended: (() => void) | null = null;

  connect(n: any) {
    this.edges.push(n);
    return n;
  }
  disconnect() {
    this.edges = [];
  }
  start() {}
  stop() {}
}

function createMockAudioContext(sampleRate = 44100): BaseAudioContext {
  const destination = new MockNode();
  return {
    sampleRate,
    currentTime: 0,
    destination: destination as unknown as AudioDestinationNode,
    createGain: () => new MockNode() as unknown as GainNode,
    createOscillator: () => new MockNode() as unknown as OscillatorNode,
    createBiquadFilter: () => new MockNode() as unknown as BiquadFilterNode,
    createBufferSource: () => new MockNode() as unknown as AudioBufferSourceNode,
    createWaveShaper: () => new MockNode() as unknown as WaveShaperNode,
    createConstantSource: () => new MockNode() as unknown as ConstantSourceNode,
    createStereoPanner: () => new MockNode() as unknown as StereoPannerNode,
    createDelay: () => new MockNode() as unknown as DelayNode,
    createAnalyser: () => new MockNode() as unknown as AnalyserNode,
    createConvolver: () => new MockNode() as unknown as ConvolverNode,
    createDynamicsCompressor: () => new MockNode() as unknown as DynamicsCompressorNode,
    createBuffer: (channels: number, length: number) => {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return {
        numberOfChannels: channels,
        length,
        sampleRate,
        getChannelData: (c: number) => data[c],
      } as unknown as AudioBuffer;
    },
  } as unknown as BaseAudioContext;
}

const ALL_SYNTH_KINDS: SynthKind[] = [
  'kick',
  'sub',
  'rumble',
  'midbass',
  'hat',
  'ohat',
  'ride',
  'shaker',
  'clap',
  'snare',
  'perc',
  'conga',
  'tom',
  'clang',
  'acid',
  'stab',
  'lead',
  'arp',
  'pad',
  'dubchord',
  'drone',
  'noise',
  'crackle',
  'riser',
  'impact',
  'downlift',
  'crash',
];

describe('All 27 Synth & FX Voices Execution & Parameter Control', () => {
  const ctx = createMockAudioContext();
  const noise = makeNoise(ctx, 42);

  for (const kind of ALL_SYNTH_KINDS) {
    it(`plays voice "${kind}" without runtime exceptions (normal note & accented)`, () => {
      let started = 0;
      let ended = 0;
      const sources = new Set<AudioScheduledSourceNode>();
      const rng = new Rng(100);

      const env: VEnv = {
        ctx,
        noise,
        dirt: 0.35,
        stepDur: 0.125,
        random: () => rng.next(),
        sources,
        onStart: () => {
          started++;
        },
        onEnd: () => {
          ended++;
        },
      };

      const out = new MockNode() as unknown as AudioNode;
      const cutoff = new MockNode() as unknown as AudioNode;
      const res = new MockNode() as unknown as AudioNode;
      const ctl: TrackCtl = { cutoff, res };

      // Normal note
      expect(() => {
        playVoice(kind, env, out, 0.05, 0.5, { t: 0, d: 2, p: kind === 'kick' ? 36 : 60, v: 0.8 }, ctl);
      }).not.toThrow();

      // Accented note with slide
      expect(() => {
        playVoice(
          kind,
          env,
          out,
          0.3,
          0.5,
          { t: 4, d: 4, p: kind === 'kick' ? 38 : 62, v: 1.0, acc: true, slide: true },
          ctl
        );
      }).not.toThrow();

      // Verify sources were registered in the voice environment
      expect(started).toBeGreaterThan(0);
      expect(sources.size).toBeGreaterThan(0);
    });
  }

  it('prewarms AudioWorklet nodes and creates shared noise and impulse response buffers cleanly', () => {
    vi.stubGlobal('AudioWorkletNode', MockNode);
    const mockCtx = createMockAudioContext();

    // 1. Prewarm worklet nodes
    const prewarmed = Graph.prewarmWorkletNodes(mockCtx, true);
    expect(prewarmed).toBeDefined();
    expect(typeof prewarmed).toBe('object');

    // 2. Shared buffers caching
    const b1 = getSharedBuffers(mockCtx, 123);
    const b2 = getSharedBuffers(mockCtx, 123);
    expect(b1.noise).toBe(b2.noise);
    expect(b1.ir).toBe(b2.ir);

    // 3. Graph initialization with prewarmed nodes
    const graph = new Graph(mockCtx, true, b1, false, 123, prewarmed);
    expect(graph.groups.bass).toBeDefined();
    expect(graph.groups.harm).toBeDefined();
    expect(graph.groups.fx).toBeDefined();
    graph.kill();
    vi.unstubAllGlobals();
  });
});
