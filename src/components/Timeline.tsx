import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { uid } from '../engine/theory';
import { engine, store, useApp } from '../store';
import { totalBars, type Clip, type Project, type Track } from '../engine/types';
import { curveFactor } from '../engine/validation';
import { LAYERS, ROLE_COLORS } from '../engine/styles';
import { acceptProposal, newClipAt, regenerateSectionNow, rejectProposal, seek, splitSelectedAtPlayhead } from '../actions';
import { Btn } from '../ui';
import { cn } from '../utils/cn';

export const HEAD_W = 176;
const FLAG_H = 20, CURVE_Y = 22, CURVE_H = 44, RULER_Y = 70, HDR_H = 90;

interface ClipDrag {
  clip: string;
  track: string;
  mode: 'move' | 'resize';
  x0: number;
  start: number;
  len: number;
  cur: { start: number; len: number };
  moved: boolean;
}

const meterBuf = new Float32Array(128);
function readPeak(a?: AnalyserNode) {
  if (!a) return 0;
  a.getFloatTimeDomainData(meterBuf);
  let m = 0;
  for (let i = 0; i < meterBuf.length; i++) {
    const v = Math.abs(meterBuf[i]);
    if (v > m) m = v;
  }
  return m;
}

function drawNotes(g: CanvasRenderingContext2D, c: Clip, x0: number, y0: number, h: number, ppb: number) {
  const ns = c.notes;
  if (!ns.length) return;
  let lo = 127, hi = 0;
  for (const n of ns) {
    if (n.p < lo) lo = n.p;
    if (n.p > hi) hi = n.p;
  }
  const span = Math.max(1, hi - lo);
  const sw = ppb / 16;
  const ce = c.len * 16;
  const reps = Math.ceil((ce + c.off) / c.loop);
  for (let r = 0; r <= reps; r++) {
    for (const n of ns) {
      const rel = r * c.loop + n.t - c.off;
      if (rel < 0 || rel >= ce) continue;
      const y = hi === lo ? y0 + h / 2 - 1 : y0 + h - 3 - ((n.p - lo) / span) * Math.max(2, h - 5);
      g.fillRect(x0 + rel * sw, y, Math.max(1.2, Math.min(n.d, c.loop) * sw), Math.max(1.8, Math.min(3, h * 0.16)));
    }
  }
}

function LAYER_REG(t: Track) {
  return LAYERS[t.layer]?.reg ?? t.synth;
}

export function Timeline({ onOpenClip }: { onOpenClip?: () => void }) {
  const app = useApp();
  const view: Project = store.viewProject();
  const prev = store.preview();
  const [ppb, setPpb] = useState(16);
  const [rowH, setRowH] = useState<24 | 32 | 44>(32);
  const [showAuto, setShowAuto] = useState(true);
  const [follow, setFollow] = useState(true);
  const [macroCollapsed, setMacroCollapsed] = useState(false);
  const [drag, setDrag] = useState<ClipDrag | null>(null);
  const [eDrag, setEDrag] = useState<{ id: string; e: number } | null>(null);

  const hdrRef = useRef<HTMLCanvasElement>(null);
  const bodyRef = useRef<HTMLCanvasElement>(null);
  const scRef = useRef<HTMLDivElement>(null);
  const phRef = useRef<HTMLDivElement>(null);
  const meterRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const meterHold = useRef<Record<string, number>>({});
  const lastClipTap = useRef<{ id: string; t: number }>({ id: '', t: 0 });
  const pinchRef = useRef<{ dist: number; ppb0: number; anchorBar: number; midX: number } | null>(null);
  const zoomRafRef = useRef<number>(0);

  const bars = Math.max(32, totalBars(view) + 4);
  const W = bars * ppb;
  const rows = view.tracks.length + 1;
  const H = rows * rowH;
  const sel = app.selection;
  const locked = !!prev;

  const trackOf = useMemo(() => new Map(view.tracks.map((t, i) => [t.id, i])), [view.tracks]);

  const applyZoomAnchored = useCallback((nextPpb: number, anchorBar?: number, pointerOffsetX?: number) => {
    const clamped = Math.max(4, Math.min(72, Math.round(nextPpb)));
    if (zoomRafRef.current) cancelAnimationFrame(zoomRafRef.current);
    zoomRafRef.current = requestAnimationFrame(() => {
      setPpb(clamped);
      const sc = scRef.current;
      if (sc && anchorBar !== undefined && pointerOffsetX !== undefined) {
        sc.scrollLeft = Math.max(0, HEAD_W + anchorBar * clamped - pointerOffsetX);
      }
    });
  }, []);

  const zoomBy = useCallback((delta: number) => {
    setPpb((cur) => Math.max(4, Math.min(72, Math.round(cur + delta))));
  }, []);

  const zoomToFit = useCallback(() => {
    const sc = scRef.current;
    const avail = sc ? Math.max(240, sc.clientWidth - HEAD_W - 16) : 640;
    const targetBars = Math.max(16, totalBars(view));
    const next = Math.max(4, Math.min(72, Math.floor(avail / targetBars)));
    setPpb(next);
    if (sc) sc.scrollLeft = 0;
  }, [view]);

  // ───── header (macro sections, energy curve, ruler)
  useEffect(() => {
    const cv = hdrRef.current;
    if (!cv) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 16000 / W);
    cv.width = W * dpr;
    cv.height = HDR_H * dpr;
    cv.style.width = W + 'px';
    cv.style.height = HDR_H + 'px';
    const g = cv.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, HDR_H);
    g.fillStyle = '#0f1318';
    g.fillRect(0, 0, W, HDR_H);

    // curve area
    const Y = (e: number) => CURVE_Y + CURVE_H - e * (CURVE_H - 4) - 2;
    g.strokeStyle = '#1b222a';
    g.lineWidth = 1;
    for (const lv of [0.25, 0.5, 0.75]) {
      g.beginPath();
      g.moveTo(0, Y(lv) + 0.5);
      g.lineTo(W, Y(lv) + 0.5);
      g.stroke();
    }
    const secs = view.sections;
    g.beginPath();
    secs.forEach((s, i) => {
      const e = eDrag?.id === s.id ? eDrag.e : s.energy;
      const x0 = s.start * ppb, x1 = (s.start + s.bars) * ppb;
      if (i === 0) g.moveTo(x0, CURVE_Y + CURVE_H);
      g.lineTo(x0, Y(e));
      g.lineTo(x1, Y(e));
    });
    if (secs.length) {
      const l = secs[secs.length - 1];
      g.lineTo((l.start + l.bars) * ppb, CURVE_Y + CURVE_H);
    }
    g.closePath();
    const grad = g.createLinearGradient(0, CURVE_Y, 0, CURVE_Y + CURVE_H);
    grad.addColorStop(0, 'rgba(245,158,11,0.40)');
    grad.addColorStop(1, 'rgba(245,158,11,0.03)');
    g.fillStyle = grad;
    g.fill();

    g.beginPath();
    secs.forEach((s, i) => {
      const e = eDrag?.id === s.id ? eDrag.e : s.energy;
      const x0 = s.start * ppb, x1 = (s.start + s.bars) * ppb;
      if (i === 0) g.moveTo(x0, Y(e));
      else g.lineTo(x0, Y(e));
      g.lineTo(x1, Y(e));
    });
    g.strokeStyle = '#f59e0b';
    g.lineWidth = 1.6;
    g.stroke();

    // flags
    g.font = '600 10px Inter, system-ui, sans-serif';
    g.textBaseline = 'middle';
    for (const s of secs) {
      const x = s.start * ppb, w = s.bars * ppb;
      const col = ROLE_COLORS[s.role];
      const isSel = sel.kind === 'section' && sel.id === s.id;
      g.fillStyle = col + (isSel ? 'ee' : '99');
      g.fillRect(x + 1, 2, w - 2, FLAG_H - 3);
      if (isSel) {
        g.strokeStyle = '#fff';
        g.lineWidth = 1.2;
        g.strokeRect(x + 1.5, 2.5, w - 3, FLAG_H - 4);
      }
      g.fillStyle = '#fff';
      g.save();
      g.beginPath();
      g.rect(x + 3, 0, Math.max(0, w - 6), FLAG_H);
      g.clip();
      g.fillText(`${s.lock ? '🔒 ' : ''}${s.name}  ${s.bars}b`, x + 6, FLAG_H / 2 + 0.5);
      g.restore();
      g.fillStyle = '#e5e7eb';
      g.font = '9px ui-monospace, monospace';
      g.fillText(s.energy.toFixed(2), x + 6, CURVE_Y + 8);
      g.font = '600 10px Inter, system-ui, sans-serif';
    }

    // ruler
    const step = ppb < 8 ? 16 : ppb < 14 ? 8 : ppb < 24 ? 4 : ppb < 44 ? 2 : 1;
    g.fillStyle = '#151a20';
    g.fillRect(0, RULER_Y, W, HDR_H - RULER_Y);
    g.font = '9px ui-monospace, monospace';
    g.fillStyle = '#7b8794';
    g.strokeStyle = '#2a3441';
    for (let b = 0; b <= bars; b += step) {
      const x = Math.round(b * ppb) + 0.5;
      g.beginPath();
      g.moveTo(x, RULER_Y + 8);
      g.lineTo(x, HDR_H);
      g.stroke();
      g.fillText(String(b + 1), x + 3, RULER_Y + 8);
    }
    if (view.loop.on) {
      g.fillStyle = 'rgba(6,182,212,0.35)';
      g.fillRect(view.loop.a * ppb, RULER_Y, (view.loop.b - view.loop.a) * ppb, HDR_H - RULER_Y);
    }
    // atoms markers on ruler: transitions
    const atoms = view.tracks.filter((t) => t.group === 'Transition');
    g.fillStyle = '#ec4899';
    for (const t of atoms) {
      for (const c of t.clips) {
        if (t.synth === 'impact' || (t.synth === 'crash' && c.label === 'Crash')) {
          g.fillRect(c.start * ppb - 1, RULER_Y + 1, 2, 7);
        }
      }
    }
  }, [view, ppb, sel, eDrag, bars, W]);

  // ───── body (tracks + clips + automation + ghost diff)
  useEffect(() => {
    const cv = bodyRef.current;
    if (!cv) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 16000 / W);
    cv.width = W * dpr;
    cv.height = H * dpr;
    cv.style.width = W + 'px';
    cv.style.height = H + 'px';
    const g = cv.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);

    for (let i = 0; i < rows; i++) {
      g.fillStyle = i % 2 ? '#0e1216' : '#10151a';
      g.fillRect(0, i * rowH, W, rowH);
    }
    for (const s of view.sections) {
      const isSel = sel.kind === 'section' && sel.id === s.id;
      g.fillStyle = ROLE_COLORS[s.role] + (isSel ? '26' : '0d');
      g.fillRect(s.start * ppb, 0, s.bars * ppb, H);
    }
    for (let b = 0; b <= bars; b++) {
      const strong = b % 16 === 0, mid = b % 4 === 0;
      if (!strong && !mid && ppb < 10) continue;
      g.strokeStyle = strong ? '#2f3a48' : mid ? '#1e2630' : '#171d24';
      g.lineWidth = 1;
      const x = Math.round(b * ppb) + 0.5;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, H);
      g.stroke();
    }
    for (const s of view.sections) {
      g.strokeStyle = ROLE_COLORS[s.role];
      g.globalAlpha = 0.6;
      g.beginPath();
      g.moveTo(Math.round(s.start * ppb) + 0.5, 0);
      g.lineTo(Math.round(s.start * ppb) + 0.5, H);
      g.stroke();
      g.globalAlpha = 1;
    }

    g.font = '600 9px Inter, system-ui, sans-serif';
    g.textBaseline = 'middle';
    view.tracks.forEach((t, i) => {
      const y = i * rowH;
      for (const c0 of t.clips) {
        const c = drag && drag.clip === c0.id ? { ...c0, start: drag.cur.start, len: drag.cur.len } : c0;
        const x = c.start * ppb, w = Math.max(3, c.len * ppb);
        const isSel = sel.kind === 'clip' && sel.id === c.id;
        const df = prev?.diff[c.id];
        g.globalAlpha = c.mute ? 0.25 : 1;

        // Ableton-style clip body + header bar
        g.fillStyle = t.color + (df ? '58' : '44');
        g.beginPath();
        g.roundRect(x + 0.5, y + 2, w - 1, rowH - 4, 3);
        g.fill();

        // Top color header strip inside clip
        g.fillStyle = t.color + (isSel ? 'ee' : 'aa');
        g.fillRect(x + 1, y + 2, Math.max(1, w - 2), Math.min(10, rowH * 0.32));

        g.strokeStyle = isSel ? '#ffffff' : t.color;
        g.lineWidth = isSel ? 1.8 : 1;
        g.strokeRect(x + 0.5, y + 2, w - 1, rowH - 4);

        // Loop boundary ticks inside clip
        const loopBars = c.loop / 16;
        if (loopBars > 0 && c.len > loopBars && ppb * loopBars >= 12) {
          g.strokeStyle = 'rgba(255,255,255,0.22)';
          g.lineWidth = 1;
          for (let lb = loopBars; lb < c.len; lb += loopBars) {
            const lx = x + lb * ppb;
            g.beginPath();
            g.moveTo(lx, y + 3);
            g.lineTo(lx, y + rowH - 3);
            g.stroke();
          }
        }

        if (ppb >= 6) {
          g.fillStyle = '#ffffffdd';
          drawNotes(g, c, x, y + Math.min(11, rowH * 0.34), rowH - Math.min(14, rowH * 0.42), ppb);
        }
        if (w > 36 && ppb >= 8) {
          g.fillStyle = '#ffffff';
          g.save();
          g.beginPath();
          g.rect(x + 2, y + 1, w - 8, 12);
          g.clip();
          g.fillText(c.label, x + 4, y + 7);
          g.restore();
        }
        // Right-edge resize handle affordance on selected clip
        if (isSel && w > 14) {
          g.fillStyle = '#ffffff';
          g.fillRect(x + w - 4, y + 5, 2.5, rowH - 10);
        }
        if (df) {
          g.setLineDash([4, 3]);
          g.lineWidth = 1.6;
          g.strokeStyle = df === 'added' ? '#06b6d4' : '#f59e0b';
          g.strokeRect(x + 0.5, y + 1.5, w - 1, rowH - 3);
          g.setLineDash([]);
          g.fillStyle = df === 'added' ? '#06b6d440' : '#f59e0b30';
          g.fillRect(x, y + 2, w, rowH - 4);
        }
        g.globalAlpha = 1;
      }

      if (showAuto) {
        for (const lane of view.auto) {
          if (lane.track !== t.id || lane.param === 'vol' || !lane.pts.length) continue;
          g.beginPath();
          g.strokeStyle = lane.param === 'cutoff' ? '#06b6d4' : lane.param === 'res' ? '#f472b6' : '#a3e635';
          g.globalAlpha = 0.88;
          g.lineWidth = 1.3;
          lane.pts.forEach((p, k) => {
            const px = p.bar * ppb, py = y + rowH - 3 - p.v * (rowH - 6);
            if (k === 0) g.moveTo(px, py);
            else {
              const prevPt = lane.pts[k - 1];
              const segW = (p.bar - prevPt.bar) * ppb;
              if (p.curve && Math.abs(p.curve) > 0.01 && segW > 6) {
                const steps = Math.min(16, Math.max(4, Math.ceil(segW / 8)));
                for (let s = 1; s <= steps; s++) {
                  const frac = s / steps;
                  const v = prevPt.v + (p.v - prevPt.v) * curveFactor(frac, p.curve);
                  g.lineTo(prevPt.bar * ppb + segW * frac, y + rowH - 3 - v * (rowH - 6));
                }
              } else {
                g.lineTo(px, py);
              }
            }
          });
          g.stroke();
          g.globalAlpha = 1;
        }
      }
    });

    if (prev) {
      for (const r of prev.removed) {
        const i = trackOf.get(r.track);
        if (i === undefined) continue;
        g.setLineDash([3, 3]);
        g.strokeStyle = '#ef4444';
        g.lineWidth = 1.4;
        g.strokeRect(r.start * ppb + 0.5, i * rowH + 2.5, r.len * ppb - 1, rowH - 5);
        g.beginPath();
        g.moveTo(r.start * ppb, i * rowH + 2);
        g.lineTo((r.start + r.len) * ppb, i * rowH + rowH - 2);
        g.stroke();
        g.setLineDash([]);
      }
    }

    // master row
    const my = view.tracks.length * rowH;
    g.fillStyle = '#7b8794';
    g.fillText('MASTER · DJ high-pass sweep & limiter', 6, my + rowH / 2);
    const hp = view.auto.find((a) => a.track === 'master' && a.param === 'hp');
    if (hp) {
      g.beginPath();
      g.strokeStyle = '#06b6d4';
      g.lineWidth = 1.4;
      hp.pts.forEach((p, k) => {
        const px = p.bar * ppb, py = my + rowH - 3 - p.v * (rowH - 6);
        if (k === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      });
      g.stroke();
    }
    if (view.loop.on) {
      g.strokeStyle = '#06b6d4';
      g.lineWidth = 1;
      g.strokeRect(view.loop.a * ppb + 0.5, 0.5, (view.loop.b - view.loop.a) * ppb, H - 1);
    }
  }, [view, ppb, rowH, sel, showAuto, drag, prev, bars, rows, W, H, trackOf]);

  // ───── playhead overlay + live track header mini meters (rAF, no React re-render)
  useEffect(() => {
    let raf = 0;
    const f = () => {
      const st = engine.playing ? engine.getStep() : -1;
      const bar = st >= 0 ? st / 16 : store.get().cursorBar;
      const x = HEAD_W + bar * ppb;
      if (phRef.current) phRef.current.style.transform = `translateX(${x}px)`;
      const sc = scRef.current;
      if (sc && follow && st >= 0 && (x > sc.scrollLeft + sc.clientWidth - 60 || x < sc.scrollLeft + HEAD_W)) {
        sc.scrollLeft = Math.max(0, x - HEAD_W - 80);
      }
      const gr = engine.graph;
      for (const t of view.tracks) {
        const el = meterRefs.current[t.id];
        if (!el) continue;
        const pk = gr ? readPeak(gr.strips.get(t.id)?.analyser) : 0;
        const cur = Math.max(pk, (meterHold.current[t.id] ?? 0) * 0.86);
        meterHold.current[t.id] = cur;
        const pct = Math.max(0, Math.min(100, ((20 * Math.log10(cur + 1e-6) + 48) / 48) * 100));
        el.style.height = `${pct}%`;
      }
      raf = requestAnimationFrame(f);
    };
    f();
    return () => cancelAnimationFrame(raf);
  }, [ppb, follow, view.tracks]);

  const snap = ppb >= 36 ? 0.25 : ppb >= 20 ? 0.5 : 1;
  const posOf = (e: { clientX: number; clientY: number }, cv: HTMLCanvasElement) => {
    const r = cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  // Support DAW scroll-to-zoom (Ctrl/Cmd/Alt + Wheel anywhere, or Wheel over the top ruler/header) anchored around pointer bar
  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      const sc = scRef.current;
      if (!sc) return;
      const rect = sc.getBoundingClientRect();
      const overHeader = e.clientY - rect.top <= HDR_H;
      if (e.ctrlKey || e.metaKey || e.altKey || (overHeader && Math.abs(e.deltaY) > Math.abs(e.deltaX))) {
        e.preventDefault();
        const pointerOffsetX = Math.max(HEAD_W, e.clientX - rect.left);
        const anchorBar = Math.max(0, (sc.scrollLeft + pointerOffsetX - HEAD_W) / ppb);
        const factor = e.deltaY < 0 ? 1.15 : 0.87;
        const next = Math.round(ppb * factor) === ppb ? ppb + (e.deltaY < 0 ? 2 : -2) : ppb * factor;
        applyZoomAnchored(next, anchorBar, pointerOffsetX);
      }
    },
    [ppb, applyZoomAnchored]
  );

  // Support 2-finger pinch-to-zoom on Android / touch devices with RAF throttling & midpoint anchoring
  const onTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2 && scRef.current) {
      const rect = scRef.current.getBoundingClientRect();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const midX = Math.max(HEAD_W, (e.touches[0].clientX + e.touches[1].clientX) * 0.5 - rect.left);
      const anchorBar = Math.max(0, (scRef.current.scrollLeft + midX - HEAD_W) / ppb);
      pinchRef.current = { dist: Math.hypot(dx, dy), ppb0: ppb, anchorBar, midX };
    }
  };
  const onTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2 && pinchRef.current) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      if (pinchRef.current.dist > 10) {
        const scale = dist / pinchRef.current.dist;
        applyZoomAnchored(pinchRef.current.ppb0 * scale, pinchRef.current.anchorBar, pinchRef.current.midX);
      }
    }
  };
  const onTouchEnd = () => {
    pinchRef.current = null;
  };

  const onBodyDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const cv = bodyRef.current!;
      const { x, y } = posOf(e, cv);
      const row = Math.floor(y / rowH);
      const t = view.tracks[row];
      if (!t) {
        if (row === view.tracks.length) store.select({ kind: 'device', id: 'master' });
        return;
      }
      const bar = x / ppb;
      const hit = [...t.clips].reverse().find((c) => bar >= c.start && bar <= c.start + c.len);
      if (!hit) {
        store.select({ kind: 'track', id: t.id });
        seek(Math.max(0, Math.floor(bar)));
        return;
      }

      const now = Date.now();
      const isDoubleTap = lastClipTap.current.id === hit.id && now - lastClipTap.current.t < 320;
      lastClipTap.current = { id: hit.id, t: now };

      store.select({ kind: 'clip', id: hit.id, track: t.id });
      if (isDoubleTap || window.matchMedia('(min-width: 1024px)').matches) {
        onOpenClip?.();
      }
      if (locked || t.lock) return;

      const edgeTolerance = e.pointerType === 'touch' ? 14 : 8;
      const edge = x >= (hit.start + hit.len) * ppb - edgeTolerance;
      const d: ClipDrag = {
        clip: hit.id,
        track: t.id,
        mode: edge ? 'resize' : 'move',
        x0: e.clientX,
        start: hit.start,
        len: hit.len,
        cur: { start: hit.start, len: hit.len },
        moved: false,
      };
      setDrag(d);

      const mv = (ev: PointerEvent) => {
        if (Math.abs(ev.clientX - d.x0) < 4 && !d.moved) return;
        const db = Math.round((ev.clientX - d.x0) / ppb / snap) * snap;
        d.cur =
          d.mode === 'move'
            ? { start: Math.max(0, d.start + db), len: d.len }
            : { start: d.start, len: Math.max(snap, d.len + db) };
        d.moved = d.cur.start !== d.start || d.cur.len !== d.len;
        setDrag({ ...d });
      };
      const up = () => {
        window.removeEventListener('pointermove', mv);
        window.removeEventListener('pointerup', up);
        setDrag(null);
        if (d.moved) {
          store.dispatch({ type: 'SET_CLIP', id: d.clip, patch: d.cur }, d.mode === 'move' ? 'Move clip' : 'Resize clip');
        }
      };
      window.addEventListener('pointermove', mv);
      window.addEventListener('pointerup', up);
    },
    [view.tracks, ppb, rowH, snap, locked, onOpenClip]
  );

  const onBodyDbl = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (locked) return;
    const { x, y } = posOf(e, bodyRef.current!);
    const t = view.tracks[Math.floor(y / rowH)];
    if (!t) return;
    if (t.clips.some((c) => x / ppb >= c.start && x / ppb <= c.start + c.len)) {
      onOpenClip?.();
      return;
    }
    newClipAt(t.id, x / ppb);
  };

  const onHdrDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = posOf(e, hdrRef.current!);
    const bar = x / ppb;
    const sec = view.sections.find((s) => bar >= s.start && bar < s.start + s.bars);
    if (y < FLAG_H) {
      if (sec) store.select({ kind: 'section', id: sec.id });
      return;
    }
    if (y < RULER_Y) {
      if (!sec) return;
      store.select({ kind: 'section', id: sec.id });
      if (sec.lock || locked) return;
      const ed = { id: sec.id, e: sec.energy };
      const upd = (cy: number) => {
        const r = hdrRef.current!.getBoundingClientRect();
        const yy = cy - r.top;
        ed.e = Math.min(1, Math.max(0.05, 1 - (yy - CURVE_Y - 2) / (CURVE_H - 4)));
        setEDrag({ ...ed });
      };
      upd(e.clientY);
      const mv = (ev: PointerEvent) => upd(ev.clientY);
      const up = () => {
        window.removeEventListener('pointermove', mv);
        window.removeEventListener('pointerup', up);
        setEDrag(null);
        store.dispatch(
          { type: 'SET_SECTION', id: ed.id, patch: { energy: +ed.e.toFixed(2) } },
          `Energy · ${sec.name}`,
          'user',
          `energy:${ed.id}`
        );
      };
      window.addEventListener('pointermove', mv);
      window.addEventListener('pointerup', up);
      return;
    }
    seek(bar);
  };

  const selSec = sel.kind === 'section' ? view.sections.find((s) => s.id === sel.id) : undefined;
  const selTrack =
    sel.kind === 'track'
      ? view.tracks.find((t) => t.id === sel.id)
      : sel.kind === 'clip'
        ? view.tracks.find((t) => t.id === sel.track)
        : undefined;
  const selClip = sel.kind === 'clip' && selTrack ? selTrack.clips.find((c) => c.id === sel.id) : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      {/* Arrangement Zoom & Contextual Clip/Section Toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line bg-panel px-2 py-1 select-none">
        <span className="hidden text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 sm:inline">
          Arrangement
        </span>

        {/* Horizontal Zoom Controls */}
        <div className="flex items-center gap-1 rounded border border-line bg-[#0e1216] px-1.5 py-0.5" title="Arrangement Bar Zoom (Pixels Per Bar)">
          <span className="hidden text-[8px] font-semibold uppercase tracking-wider text-slate-400 lg:inline">Zoom</span>
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => zoomBy(-4)}
            className="flex h-5 w-5 items-center justify-center rounded bg-elev text-[12px] font-bold text-slate-300 hover:bg-[#26303d] hover:text-amber"
            title="Zoom out (−)"
          >
            −
          </button>
          <input
            aria-label="Timeline zoom"
            type="range"
            className="!w-16"
            min={4}
            max={72}
            value={ppb}
            onChange={(e) => setPpb(+e.target.value)}
          />
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => zoomBy(4)}
            className="flex h-5 w-5 items-center justify-center rounded bg-elev text-[12px] font-bold text-slate-300 hover:bg-[#26303d] hover:text-amber"
            title="Zoom in (+)"
          >
            +
          </button>
          <button
            type="button"
            aria-label="Zoom to fit arrangement"
            onClick={zoomToFit}
            className="rounded bg-elev px-1.5 py-0.5 font-mono text-[9px] font-semibold text-slate-300 hover:bg-[#26303d] hover:text-amber"
            title="Zoom to fit entire song in view"
          >
            Fit
          </button>
        </div>

        {/* Vertical Track Height Selector */}
        <div className="flex items-center gap-1 rounded border border-line bg-[#0e1216] px-1.5 py-0.5" title="Track lane row height: Small (24px), Medium (32px), Large (44px)">
          <span className="hidden text-[8px] font-semibold uppercase tracking-wider text-slate-400 lg:inline">Row Height</span>
          <div className="flex items-center gap-0.5">
            {([
              [24, 'S', 'Small row height (24px)'],
              [32, 'M', 'Medium row height (32px)'],
              [44, 'L', 'Large row height (44px)'],
            ] as const).map(([h, label, title]) => (
              <button
                key={h}
                type="button"
                aria-label={`Row height ${label}`}
                title={title}
                onClick={() => setRowH(h)}
                className={cn(
                  'h-5 px-1.5 rounded text-[9px] font-semibold transition-colors',
                  rowH === h ? 'bg-amber text-black' : 'text-slate-400 hover:text-slate-200'
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <Btn small active={showAuto} onClick={() => setShowAuto(!showAuto)} title="Show or hide automation curves overlaid on track lanes">
          Automation
        </Btn>
        <Btn small active={follow} onClick={() => setFollow(!follow)} title="Automatically scroll timeline with playback cursor">
          {follow ? 'Follow: ON' : 'Follow: OFF'}
        </Btn>
        <Btn
          small
          active={view.loop.on}
          disabled={!selSec && !view.loop.on}
          title={selSec ? `Loop section: ${selSec.name} (Bars ${selSec.start + 1}–${selSec.start + selSec.bars})` : 'Select a section header to loop'}
          onClick={() => {
            if (view.loop.on) store.dispatch({ type: 'SET_LOOP', loop: { ...view.loop, on: false } }, 'Loop off');
            else if (selSec) {
              store.dispatch(
                { type: 'SET_LOOP', loop: { on: true, a: selSec.start, b: selSec.start + selSec.bars } },
                'Loop section'
              );
            }
          }}
        >
          {view.loop.on ? '⟳ Loop: Active' : selSec ? `⟳ Loop ${selSec.name}` : '⟳ Loop Section'}
        </Btn>

        {/* Contextual Clip Editing Action Bar */}
        {selTrack && !locked && (
          <div className="flex items-center gap-1 border-l border-line pl-1.5">
            <Btn
              small
              tone="amber"
              title={`Create a new clip on ${selTrack.name} at bar ${Math.floor(store.get().cursorBar) + 1}`}
              onClick={() => newClipAt(selTrack.id, Math.floor(store.get().cursorBar))}
            >
              + New Clip
            </Btn>
            {selClip && (
              <>
                <Btn small tone="cyan" onClick={() => onOpenClip?.()} title="Open clip in Piano Roll editor">
                  Edit Notes ›
                </Btn>
                <Btn small onClick={splitSelectedAtPlayhead} title="Split clip at playhead position (Ctrl+E)">
                  Split
                </Btn>
                <Btn
                  small
                  onClick={() => store.dispatch({ type: 'DUP_CLIP', copyId: uid('clip'), id: selClip.id }, 'Duplicate clip')}
                  title="Duplicate clip (Ctrl+D)"
                >
                  Duplicate
                </Btn>
                <Btn
                  small
                  active={selClip.mute}
                  onClick={() =>
                    store.dispatch({ type: 'SET_CLIP', id: selClip.id, patch: { mute: !selClip.mute } }, 'Mute clip')
                  }
                  title="Mute or unmute this clip"
                >
                  {selClip.mute ? 'Unmute' : 'Mute'}
                </Btn>
                <Btn
                  small
                  onClick={() =>
                    store.dispatch(
                      { type: 'SET_CLIP', id: selClip.id, patch: { transpose: Math.max(-24, selClip.transpose - 12) } },
                      'Transpose -12st'
                    )
                  }
                  title="Transpose clip down 1 octave (−12 semitones)"
                >
                  −1 Oct
                </Btn>
                <Btn
                  small
                  onClick={() =>
                    store.dispatch(
                      { type: 'SET_CLIP', id: selClip.id, patch: { transpose: Math.min(24, selClip.transpose + 12) } },
                      'Transpose +12st'
                    )
                  }
                  title="Transpose clip up 1 octave (+12 semitones)"
                >
                  +1 Oct
                </Btn>
                <Btn
                  small
                  tone="red"
                  onClick={() => {
                    store.dispatch({ type: 'DEL_CLIP', id: selClip.id }, 'Delete clip');
                    store.select({ kind: 'track', id: selTrack.id });
                  }}
                  title="Delete this clip (Delete / Backspace)"
                >
                  Delete
                </Btn>
              </>
            )}
          </div>
        )}

        {/* Contextual Section Action Bar */}
        {selSec && !locked && (
          <div className="flex items-center gap-1 border-l border-line pl-1.5">
            <span className="text-[10px] font-semibold text-slate-300">
              Section: <span className="text-amber">{selSec.name}</span> ({selSec.bars}b)
            </span>
            <Btn
              small
              active={selSec.lock}
              onClick={() => store.dispatch({ type: 'SET_SECTION', id: selSec.id, patch: { lock: !selSec.lock } }, 'Lock section')}
              title="Lock section to protect notes and automation during generation"
            >
              {selSec.lock ? '🔒 Locked' : '🔓 Lock'}
            </Btn>
            <Btn
              small
              disabled={selSec.lock}
              onClick={() => regenerateSectionNow(selSec.id)}
              title="Regenerate musical patterns in this section"
            >
              ↻ Regenerate
            </Btn>
          </div>
        )}

        {prev && (
          <div className="ml-auto flex items-center gap-1.5 rounded-md border border-cyan/60 bg-cyan/10 px-2 py-0.5">
            <span className="pulse h-1.5 w-1.5 rounded-full bg-cyan" />
            <span className="max-w-[240px] truncate text-[11px] text-cyan">Ghost diff · {prev.title}</span>
            <span className="font-mono text-[10px] tabular-nums text-slate-300">
              +{prev.stats.added} −{prev.stats.removed} ~{prev.stats.changed}
            </span>
            <Btn small tone="cyan" onClick={() => acceptProposal(prev.id)}>
              Accept
            </Btn>
            <Btn small onClick={() => rejectProposal(prev.id)}>
              Revert
            </Btn>
          </div>
        )}
      </div>

      {/* Scrollable Arrangement Viewport */}
      <div
        ref={scRef}
        onWheel={onWheel}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        className="relative min-h-0 flex-1 overflow-auto"
      >
        <div className="relative" style={{ width: HEAD_W + W, height: HDR_H + H }}>
          {/* Sticky Top Macro / Energy / Ruler Header */}
          <div className="sticky top-0 z-20 flex" style={{ height: HDR_H }}>
            <div
              className="sticky left-0 z-30 flex shrink-0 flex-col justify-between border-b border-r border-line bg-panel p-2 text-[10px] text-slate-400"
              style={{ width: HEAD_W }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setMacroCollapsed((c) => !c)}
                    title={macroCollapsed ? 'Expand Macro Energy lane' : 'Collapse Macro Energy lane'}
                    className="rounded px-1 text-[10px] text-slate-400 hover:bg-elev hover:text-white transition-colors"
                  >
                    {macroCollapsed ? '▸' : '▾'}
                  </button>
                  <span className="font-semibold uppercase tracking-wider text-slate-300">Macro · Energy</span>
                </div>
                <span className="font-mono text-[9px] text-slate-500">{view.tracks.length} trk</span>
              </div>
              <span className="text-[9px] text-slate-500">click flag · drag curve · seek ruler</span>
            </div>
            <canvas
              ref={hdrRef}
              onPointerDown={onHdrDown}
              className="block cursor-pointer border-b border-line"
              style={{ touchAction: 'pan-x' }}
            />
          </div>

          {/* Track Headers + Arrangement Canvas */}
          <div className="flex" style={{ height: H }}>
            <div className="sticky left-0 z-10 shrink-0 border-r border-line bg-panel" style={{ width: HEAD_W }}>
              {view.tracks.map((t: Track, idx: number) => {
                const isSel = (sel.kind === 'track' && sel.id === t.id) || (sel.kind === 'clip' && sel.track === t.id);
                const dbText = t.vol > 0.001 ? `${(20 * Math.log10(t.vol)).toFixed(0)}dB` : '-∞';
                return (
                  <div
                    key={t.id}
                    onClick={() => store.select({ kind: 'track', id: t.id })}
                    style={{ height: rowH }}
                    className={cn(
                      'flex cursor-pointer items-center gap-1 border-b border-[#171d24] pr-1.5 text-[10px] transition-colors',
                      isSel ? 'bg-[#1d252e]' : 'hover:bg-[#161c23]'
                    )}
                  >
                    <span className="h-full w-1.5 shrink-0" style={{ background: t.color }} />
                    {/* Live mini peak level meter */}
                    <div className="relative my-1 h-[calc(100%-8px)] w-1 shrink-0 overflow-hidden rounded-full bg-[#0b0e12]">
                      <div
                        ref={(el) => {
                          meterRefs.current[t.id] = el;
                        }}
                        className="absolute bottom-0 w-full rounded-full"
                        style={{
                          height: 0,
                          background: 'linear-gradient(to top,#22c55e 65%,#f59e0b 88%,#ef4444)',
                        }}
                      />
                    </div>
                    <div className="min-w-0 flex-1 leading-tight">
                      <div className="flex items-center gap-1">
                        <span className="font-mono text-[8px] text-slate-500">{String(idx + 1).padStart(2, '0')}</span>
                        <span
                          className={cn('truncate font-medium text-slate-200', t.mute && 'text-slate-600 line-through')}
                          title={`${t.name} · ${LAYER_REG(t)}`}
                        >
                          {t.name}
                        </span>
                      </div>
                      {rowH >= 32 && (
                        <div className="flex items-center justify-between text-[8px] text-slate-500">
                          <span className="truncate">{t.synth}{t.sc ? ` · sc:${t.sc}` : ''}</span>
                          <span className="font-mono tabular-nums text-slate-400">{dbText}</span>
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      aria-label={`Add clip on ${t.name}`}
                      title="Create clip at playhead"
                      disabled={locked || t.lock}
                      onClick={(e) => {
                        e.stopPropagation();
                        newClipAt(t.id, Math.floor(store.get().cursorBar));
                      }}
                      className="flex h-4 w-4 items-center justify-center rounded-sm bg-[#232b35] text-[10px] font-bold text-slate-400 hover:bg-amber hover:text-black disabled:opacity-30"
                    >
                      +
                    </button>
                    {(['mute', 'solo', 'lock'] as const).map((k) => (
                      <button
                        key={k}
                        type="button"
                        aria-label={`${k} ${t.name}`}
                        title={k}
                        onClick={(e) => {
                          e.stopPropagation();
                          store.dispatch({ type: 'SET_TRACK', id: t.id, patch: { [k]: !t[k] } }, `${k} ${t.name}`);
                        }}
                        className={cn(
                          'h-4 w-4 rounded-sm text-[8px] font-bold leading-none',
                          t[k]
                            ? k === 'mute'
                              ? 'bg-red-500 text-white'
                              : k === 'solo'
                                ? 'bg-amber text-black'
                                : 'bg-cyan text-black'
                            : 'bg-[#232b35] text-slate-500 hover:text-slate-200'
                        )}
                      >
                        {k === 'mute' ? 'M' : k === 'solo' ? 'S' : 'L'}
                      </button>
                    ))}
                  </div>
                );
              })}
              <div
                style={{ height: rowH }}
                onClick={() => store.select({ kind: 'device', id: 'master' })}
                className={cn(
                  'flex cursor-pointer items-center justify-between px-2 text-[10px] font-semibold transition-colors',
                  sel.kind === 'device' && sel.id === 'master' ? 'bg-[#1d252e] text-amber' : 'text-slate-400 hover:bg-[#161c23]'
                )}
              >
                <span>Master Bus</span>
                <span className="font-mono text-[8px] text-amber">EQ · SAT · LIM</span>
              </div>
            </div>
            <canvas
              ref={bodyRef}
              onPointerDown={onBodyDown}
              onDoubleClick={onBodyDbl}
              onContextMenu={(e) => e.preventDefault()}
              className="block"
              style={{ cursor: locked ? 'default' : 'pointer', touchAction: 'pan-x pan-y' }}
            />
          </div>
          <div
            ref={phRef}
            className="pointer-events-none absolute left-0 top-0 z-40 h-full w-px bg-amber shadow-[0_0_6px_#f59e0b]"
          />
        </div>
      </div>
    </div>
  );
}
