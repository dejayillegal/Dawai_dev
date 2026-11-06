import { describe, it, expect } from 'vitest';
import { defaultParams, newProject } from '../src/engine/composer';
import { STYLES } from '../src/engine/styles';
import { totalBars } from '../src/engine/types';
import { UNDERGROUND_ELEMENT_PRESETS, actAddUndergroundLayer, buildProposal, interpret } from '../src/engine/assist';
import { evalLane } from '../src/engine/audio';
import { assertLocks, assertProject } from '../src/engine/validation';
import { Rng, euclid } from '../src/engine/theory';

describe('restored composition core', () => {
  for (const style of Object.keys(STYLES)) it(`creates editable ${style} arrangement`, () => {
    const p = newProject(defaultParams(style, 1337));
    assertProject(p);
    expect(totalBars(p)).toBeGreaterThanOrEqual(96);
    expect(p.tracks.length).toBeGreaterThan(8);
    expect(p.tracks.filter(t => t.clips.some(c => c.notes.length)).length).toBeGreaterThan(8);
    expect(p.auto.length).toBeGreaterThan(0);
    expect(new Set(p.tracks.flatMap(t => t.clips.map(c => c.id))).size).toBe(p.tracks.flatMap(t => t.clips).length);
    expect(p.tracks.some(t => t.group === 'Transition' && t.clips.length)).toBe(true);
  });
  it('keeps proposals separate from committed notes', () => {
    const p = newProject(defaultParams()); const before = JSON.stringify(p);
    const proposal = buildProposal(p, 'Mute', 'test', { tracks: p.tracks.map(t => ({...t, mute:true})) });
    expect(proposal.preview.tracks.every(t=>t.mute)).toBe(true);
    expect(JSON.stringify(p)).toBe(before);
    expect(typeof interpret).toBe('function');
  });
  it('retains reproducible music theory utilities', () => {
    expect(new Rng(21).next()).toBe(new Rng(21).next());
    expect(euclid(5,16).filter(Boolean)).toHaveLength(5);
  });
  it('evaluates linear and Bezier-curved automation segments accurately', () => {
    const linear = { id: 'a1', track: 't1', param: 'cutoff' as const, pts: [{ bar: 0, v: 0.2 }, { bar: 16, v: 0.8 }] };
    const concave = { id: 'a2', track: 't1', param: 'cutoff' as const, pts: [{ bar: 0, v: 0.2 }, { bar: 16, v: 0.8, curve: 0.6 }] };
    const convex = { id: 'a3', track: 't1', param: 'cutoff' as const, pts: [{ bar: 0, v: 0.2 }, { bar: 16, v: 0.8, curve: -0.6 }] };
    expect(evalLane(linear, 8)).toBeCloseTo(0.5, 4);
    expect(evalLane(concave, 8)).toBeLessThan(0.5);
    expect(evalLane(convex, 8)).toBeGreaterThan(0.5);
    expect(evalLane(concave, 0)).toBeCloseTo(0.2, 4);
    expect(evalLane(concave, 16)).toBeCloseTo(0.8, 4);
  });
  it('synthesizes underground AI layers while respecting track and section locks', () => {
    const p = newProject(defaultParams('hypnotic', 2026));
    p.tracks[0].lock = true;
    p.sections[1].lock = true;
    for (const preset of UNDERGROUND_ELEMENT_PRESETS) {
      const prop = actAddUndergroundLayer(p, preset.id);
      assertProject(prop.preview);
      assertLocks(p, prop.preview);
      expect(prop.preview.tracks.length).toBe(p.tracks.length + 1);
    }
    const nl = interpret('Add a hypnotic FM sequence layer', p, { kind: 'none' }, 0);
    expect('proposal' in nl && nl.proposal.preview.tracks.length).toBe(p.tracks.length + 1);
  });
});
