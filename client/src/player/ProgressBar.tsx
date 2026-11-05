import { useRef, useState, type PointerEvent } from 'react';
import { formatClock } from '../format';

const pct = (ratio: number) => `${Math.min(100, Math.max(0, ratio * 100))}%`;

/** Netflix-style scrubber: thin bar that thickens on hover, red knob, time preview while hovering. */
export function ProgressBar({
  current,
  duration,
  buffered,
  onSeek,
}: {
  current: number;
  duration: number;
  buffered: number;
  onSeek: (seconds: number) => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<number | null>(null);

  const ratioAt = (clientX: number) => {
    const rect = bar.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };
  const shown = drag ?? (duration ? current / duration : 0);
  const preview = drag ?? hover;

  const onPointerUp = (e: PointerEvent) => {
    if (drag === null) return;
    if (duration) onSeek(ratioAt(e.clientX) * duration);
    setDrag(null);
  };

  return (
    <div
      ref={bar}
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(current)}
      className="group/bar relative flex h-6 flex-1 cursor-pointer touch-none items-center"
      onPointerMove={(e) => {
        const x = ratioAt(e.clientX);
        setHover(x);
        if (drag !== null) setDrag(x);
      }}
      onPointerLeave={() => setHover(null)}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag(ratioAt(e.clientX));
      }}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag(null)}
    >
      <div
        className={`relative w-full bg-white/30 transition-[height] duration-150 ${
          drag !== null ? 'h-2' : 'h-1 group-hover/bar:h-2'
        }`}
      >
        <div className="absolute inset-y-0 left-0 bg-white/40" style={{ width: pct(duration ? buffered / duration : 0) }} />
        <div className="absolute inset-y-0 left-0 bg-flix-red" style={{ width: pct(shown) }} />
        <div
          className={`absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-flix-red shadow transition-transform duration-150 ${
            drag !== null ? 'scale-125' : 'scale-0 group-hover/bar:scale-100'
          }`}
          style={{ left: pct(shown) }}
        />
      </div>
      {preview !== null && duration > 0 && (
        <div
          className="pointer-events-none absolute bottom-full mb-2 -translate-x-1/2 rounded bg-black/90 px-2 py-1 text-sm tabular-nums"
          style={{ left: pct(preview) }}
        >
          {formatClock(preview * duration)}
        </div>
      )}
    </div>
  );
}
