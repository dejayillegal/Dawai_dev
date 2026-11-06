import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from './utils/cn';

export function Slider({ label, value, min, max, step = 0.01, onChange, fmt, disabled, cy, hint }: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; fmt?: (v: number) => string; disabled?: boolean; cy?: boolean; hint?: string;
}) {
  return (
    <label className={cn('block', disabled && 'opacity-40')} title={hint}>
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-400">
        <span className="truncate">{label}</span><span className="font-mono tabular-nums text-slate-200 normal-case tracking-normal">{fmt ? fmt(value) : value.toFixed(2)}</span>
      </div>
      <input aria-label={label} type="range" className={cn(cy && 'cy')} min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(parseFloat(e.target.value))} />
    </label>
  );
}

/**
 * Ableton Live / Hardware-style interactive SVG Rotary Knob.
 * Supports touch & mouse vertical drag (with pointer capture), double-click/tap reset,
 * bipolar center-detent rendering, automation indicator, and accessible range input.
 */
export function RotaryKnob({
  label,
  value,
  liveValue,
  min,
  max,
  step = 0.01,
  defaultValue,
  onChange,
  fmt,
  disabled,
  color = '#f59e0b',
  size = 46,
  bipolar = false,
  automated = false,
  hint,
}: {
  label: string;
  value: number;
  liveValue?: number;
  min: number;
  max: number;
  step?: number;
  defaultValue?: number;
  onChange: (v: number) => void;
  fmt?: (v: number) => string;
  disabled?: boolean;
  color?: string;
  size?: number;
  bipolar?: boolean;
  automated?: boolean;
  hint?: string;
}) {
  const dragRef = useRef<{ startY: number; startVal: number } | null>(null);
  const lastTapRef = useRef<number>(0);
  const span = Math.max(1e-9, max - min);
  const displayVal = liveValue !== undefined ? liveValue : value;
  const norm = Math.max(0, Math.min(1, (displayVal - min) / span));

  // Angles: 135 deg (bottom-left) to 405 deg (bottom-right) -> 270 deg sweep
  const startAngle = 135;
  const sweep = 270;
  const valAngle = startAngle + norm * sweep;
  const r = size * 0.37;
  const cx = size / 2;
  const cy = size / 2;

  const polar = (deg: number, rad = r) => {
    const a = (deg * Math.PI) / 180;
    return { x: cx + rad * Math.cos(a), y: cy + rad * Math.sin(a) };
  };

  const arcPath = (fromDeg: number, toDeg: number, rad = r) => {
    const diff = Math.abs(toDeg - fromDeg);
    if (diff < 0.5) return '';
    const s = polar(Math.min(fromDeg, toDeg), rad);
    const e = polar(Math.max(fromDeg, toDeg), rad);
    const large = diff > 180 ? 1 : 0;
    return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${rad.toFixed(2)} ${rad.toFixed(2)} 0 ${large} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
  };

  const clampStep = (raw: number) => {
    const clamped = Math.max(min, Math.min(max, raw));
    const stepped = Math.round((clamped - min) / step) * step + min;
    const decimals = step < 0.01 ? 3 : step < 0.1 ? 2 : step < 1 ? 1 : 0;
    return Number(Math.max(min, Math.min(max, stepped)).toFixed(decimals));
  };

  const resetVal = defaultValue ?? (bipolar ? (min + max) / 2 : min);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    const now = Date.now();
    if (now - lastTapRef.current < 280) {
      onChange(clampStep(resetVal));
      lastTapRef.current = 0;
      return;
    }
    lastTapRef.current = now;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startY: e.clientY, startVal: value };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || disabled) return;
    const dy = dragRef.current.startY - e.clientY;
    const sensitivity = e.shiftKey ? 360 : 130;
    const delta = (dy / sensitivity) * span;
    onChange(clampStep(dragRef.current.startVal + delta));
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore if already released
    }
  };

  const needleInner = polar(valAngle, r * 0.28);
  const needleOuter = polar(valAngle, r * 0.86);
  const activeColor = automated ? '#06b6d4' : color;
  const formatted = fmt ? fmt(displayVal) : step >= 1 ? String(Math.round(displayVal)) : displayVal.toFixed(2);

  return (
    <div
      className={cn(
        'group relative flex flex-col items-center select-none',
        disabled ? 'opacity-45 pointer-events-none' : 'cursor-ns-resize'
      )}
      title={hint ?? `${label}: ${formatted} (drag vertically, Shift for fine tune, double-tap to reset)`}
    >
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ width: size, height: size, touchAction: 'none' }}
        className="relative flex items-center justify-center"
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="overflow-visible">
          {/* Background track arc */}
          <path
            d={arcPath(startAngle, startAngle + sweep)}
            fill="none"
            stroke="#222a34"
            strokeWidth={3.2}
            strokeLinecap="round"
          />
          {/* Value arc */}
          {bipolar ? (
            <path
              d={arcPath(startAngle + sweep * 0.5, valAngle)}
              fill="none"
              stroke={activeColor}
              strokeWidth={3.2}
              strokeLinecap="round"
            />
          ) : (
            norm > 0.005 && (
              <path
                d={arcPath(startAngle, valAngle)}
                fill="none"
                stroke={activeColor}
                strokeWidth={3.2}
                strokeLinecap="round"
              />
            )
          )}
          {/* Inner metallic dial body */}
          <circle
            cx={cx}
            cy={cy}
            r={r * 0.78}
            fill="#141920"
            stroke="#2c3644"
            strokeWidth={1.2}
            className="transition-colors group-hover:stroke-slate-500"
          />
          {/* Indicator line */}
          <line
            x1={needleInner.x}
            y1={needleInner.y}
            x2={needleOuter.x}
            y2={needleOuter.y}
            stroke={activeColor}
            strokeWidth={2}
            strokeLinecap="round"
          />
          {/* Center cap */}
          <circle cx={cx} cy={cy} r={2} fill="#475569" />
        </svg>
        {automated && (
          <span
            className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-cyan shadow-[0_0_6px_#06b6d4]"
            title="Automated parameter (live playback follower)"
          />
        )}
      </div>
      <div className="mt-0.5 max-w-[74px] truncate text-center text-[9px] font-medium uppercase tracking-wider text-slate-400">
        {label}
      </div>
      <div className="font-mono text-[10px] font-semibold tabular-nums text-slate-200">
        {formatted}
      </div>
      <input
        aria-label={label}
        type="range"
        className="sr-only"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </div>
  );
}

/**
 * Ableton Live-style Device Module container for Instrument, Audio Effects, Sidechain & Mastering racks.
 */
export function DeviceModule({
  title,
  category,
  active = true,
  onToggle,
  color = '#f59e0b',
  right,
  children,
  className,
}: {
  title: string;
  category?: string;
  active?: boolean;
  onToggle?: () => void;
  color?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col rounded-md border border-line bg-[#11151b] shadow-inner transition-opacity',
        !active && 'opacity-55',
        className
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-line bg-[#171c24] px-2.5 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <button
            type="button"
            aria-label={`Toggle ${title}`}
            onClick={onToggle}
            disabled={!onToggle}
            className={cn(
              'h-2.5 w-2.5 shrink-0 rounded-full border transition-colors',
              active ? 'border-transparent' : 'border-slate-600 bg-transparent',
              onToggle ? 'cursor-pointer' : 'cursor-default'
            )}
            style={active ? { backgroundColor: color, boxShadow: `0 0 6px ${color}` } : undefined}
          />
          <span className="truncate text-[11px] font-semibold tracking-wide text-slate-100">{title}</span>
          {category && (
            <span className="hidden text-[9px] uppercase tracking-wider text-slate-500 sm:inline">· {category}</span>
          )}
        </div>
        {right && <div className="flex shrink-0 items-center gap-1">{right}</div>}
      </div>
      <div className="p-2.5">{children}</div>
    </div>
  );
}

export function Btn({ children, onClick, active, tone = 'default', className, title, disabled, small }: {
  children: ReactNode; onClick?: () => void; active?: boolean; tone?: 'default' | 'amber' | 'cyan' | 'red' | 'ghost'; className?: string; title?: string; disabled?: boolean; small?: boolean;
}) {
  const tones = {
    default: 'bg-elev border-line hover:bg-[#232b35] text-slate-200',
    amber: 'bg-amber/90 border-amber text-black hover:bg-amber font-semibold',
    cyan: 'bg-cyan/90 border-cyan text-black hover:bg-cyan font-semibold',
    red: 'bg-red-500/90 border-red-400 text-white hover:bg-red-500',
    ghost: 'bg-transparent border-transparent hover:bg-elev text-slate-300',
  };
  return (
    <button title={title} aria-label={title} aria-pressed={active} disabled={disabled} onClick={onClick}
      className={cn('inline-flex items-center justify-center gap-1 rounded-md border px-2 whitespace-nowrap shrink-0 transition-colors disabled:opacity-40 disabled:pointer-events-none select-none', small ? 'h-6 text-[10px]' : 'h-8 text-[11px]', tones[tone], active && 'ring-1 ring-amber !border-amber text-amber', className)}>
      {children}
    </button>
  );
}

export function Section({ title, children, right, className }: { title: string; children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <section className={cn('border-b border-line px-3 py-2.5', className)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{title}</h3>{right}
      </div>
      {children}
    </section>
  );
}

export const Badge = ({ children, color = '#64748b' }: { children: ReactNode; color?: string }) => (
  <span className="rounded px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider whitespace-nowrap shrink-0" style={{ background: color + '33', color }}>{children}</span>
);

export function useMedia(q: string) {
  const [m, setM] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(q).matches : true));
  useEffect(() => { const mq = window.matchMedia(q); const f = () => setM(mq.matches); mq.addEventListener('change', f); f(); return () => mq.removeEventListener('change', f); }, [q]);
  return m;
}

export const fmtDb = (v: number) => `${v.toFixed(1)} dB`;
export const barText = (bar: number) => `${Math.floor(bar) + 1}.${Math.floor((bar % 1) * 4) + 1}`;
