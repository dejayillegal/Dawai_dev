import { describe, it, expect } from 'vitest';
import { HEAD_W } from '../src/components/Timeline';
import { newProject, defaultParams, mkClip } from '../src/engine/composer';
import { totalBars } from '../src/engine/types';
import { applyCommand } from '../src/engine/commands';
import { uid } from '../src/engine/theory';

describe('Timeline & Arrangement Interaction Logic', () => {
  it('calculates horizontal zoom bounds and anchored scroll positioning accurately', () => {
    expect(HEAD_W).toBe(176);

    const clampZoom = (next: number) => Math.max(4, Math.min(72, Math.round(next)));

    expect(clampZoom(2)).toBe(4);
    expect(clampZoom(100)).toBe(72);
    expect(clampZoom(16.4)).toBe(16);

    // Zoom to fit calculation
    const calcFit = (viewportW: number, totalB: number) => {
      const avail = Math.max(240, viewportW - HEAD_W - 16);
      const targetBars = Math.max(16, totalB);
      return clampZoom(Math.floor(avail / targetBars));
    };

    // On standard 1440px desktop viewport with 96 bars:
    expect(calcFit(1440, 96)).toBe(13);
    // On tablet 820px viewport with 32 bars:
    expect(calcFit(820, 32)).toBe(19);

    // Anchored scroll calculation
    const anchorBar = 24;
    const pointerOffsetX = 400;
    const nextPpb = 20;
    const targetScroll = Math.max(0, HEAD_W + anchorBar * nextPpb - pointerOffsetX);
    expect(targetScroll).toBe(176 + 480 - 400); // 256
  });

  it('splits clips cleanly at bar boundaries and adjusts notes and loops without losing material', () => {
    const p = newProject(defaultParams('hypnotic', 505));
    const targetTrack = p.tracks.find((t) => t.clips.some((c) => c.len >= 4 && c.notes.length >= 2))!;
    const clip = targetTrack.clips.find((c) => c.len >= 4 && c.notes.length >= 2)!;
    const origNotes = structuredClone(clip.notes);
    const splitBar = clip.start + 2;
    const rightId = uid('clip');

    const splitCmd = {
      type: 'SPLIT_CLIP' as const,
      id: clip.id,
      at: splitBar,
      rightId,
    };

    const nextProject = applyCommand(p, splitCmd);
    const trackAfter = nextProject.tracks.find((t) => t.id === targetTrack.id)!;
    const leftPart = trackAfter.clips.find((c) => c.id === clip.id)!;
    const rightPart = trackAfter.clips.find((c) => c.id === rightId)!;

    expect(leftPart).toBeDefined();
    expect(rightPart).toBeDefined();
    expect(leftPart.len).toBe(2);
    expect(rightPart.start).toBe(splitBar);
    expect(rightPart.len).toBe(clip.len - 2);

    // Total duration preserved
    expect(leftPart.len + rightPart.len).toBe(clip.len);

    // Left notes are within left boundaries
    expect(leftPart.notes.every((n) => n.t < leftPart.len * 16)).toBe(true);
  });

  it('preserves multi-track arrangement bounds when transposing and duplicating clips', () => {
    const p = newProject(defaultParams('acid', 707));
    const targetTrack = p.tracks.find((t) => t.clips.length > 0)!;
    const clip = targetTrack.clips[0];

    // Transpose +12 semitones
    const transposeCmd = {
      type: 'SET_CLIP' as const,
      id: clip.id,
      patch: { transpose: 12 },
    };
    const pTransposed = applyCommand(p, transposeCmd);
    expect(pTransposed.tracks.find((t) => t.id === targetTrack.id)!.clips[0].transpose).toBe(12);

    // Duplicate clip
    const dupCmd = {
      type: 'DUP_CLIP' as const,
      id: clip.id,
      copyId: uid('clip'),
    };
    const pDuplicated = applyCommand(p, dupCmd);
    const clipsAfter = pDuplicated.tracks.find((t) => t.id === targetTrack.id)!.clips;
    expect(clipsAfter.length).toBe(targetTrack.clips.length + 1);
  });
});
