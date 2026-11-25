import {
  ArrowLeft,
  Gauge,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { formatClock } from '../format';
import { INITIAL_STATE, VideoEngine, YouTubeEngine, type PlayerHandle, type PlayerState } from './engines';
import { ProgressBar } from './ProgressBar';

export type PlayerSource = { kind: 'local'; src: string } | { kind: 'youtube'; videoId: string };

const HIDE_AFTER_MS = 3000;
const SKIP_SECONDS = 10;
const NEXT_PROMPT_SECONDS = 30;
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];
const PREFS_KEY = 'ytf.player';

function loadPrefs(): { volume: number; muted: boolean } {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
    return {
      volume: typeof saved.volume === 'number' ? Math.min(1, Math.max(0, saved.volume)) : 1,
      muted: saved.muted === true,
    };
  } catch {
    return { volume: 1, muted: false };
  }
}

function savePrefs(volume: number, muted: boolean) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ volume, muted }));
  } catch {
    // storage unavailable (private window); preference just isn't remembered
  }
}

type Flash = { icon: ReactNode; key: number };

export function NetflixPlayer({
  source,
  start,
  title,
  subtitle,
  badge,
  next,
  nextLabel = 'Next episode',
  onBack,
  onProgress,
  onEnded,
  onMissing,
}: {
  source: PlayerSource;
  start: number;
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  next: (() => void) | null;
  /** "Next movie" when the next item is the following movie of a collection. */
  nextLabel?: string;
  onBack: () => void;
  onProgress: (seconds: number, duration: number | null, force?: boolean) => void;
  onEnded: (duration: number | null) => void;
  onMissing: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const handle = useRef<PlayerHandle>(null);
  const [prefs] = useState(loadPrefs);
  const [state, setState] = useState<PlayerState>({ ...INITIAL_STATE, volume: prefs.volume, muted: prefs.muted });
  const stateRef = useRef(state);
  const [idle, setIdle] = useState(false);
  const [menu, setMenu] = useState<'speed' | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const hideTimer = useRef<number>();

  const visible = !idle || !state.playing || menu !== null;

  const onState = (s: PlayerState) => {
    const wasPlaying = stateRef.current.playing;
    stateRef.current = s;
    setState(s);
    onProgress(s.currentTime, s.duration || null, wasPlaying && !s.playing);
  };

  const wake = useCallback(() => {
    setIdle(false);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setIdle(true), HIDE_AFTER_MS);
  }, []);

  const showFlash = (icon: ReactNode) => setFlash({ icon, key: Date.now() });

  const togglePlay = useCallback(() => {
    if (stateRef.current.playing) {
      handle.current?.pause();
      showFlash(<Pause size={56} fill="currentColor" />);
    } else {
      handle.current?.play();
      showFlash(<Play size={56} fill="currentColor" />);
    }
  }, []);

  const seekBy = useCallback((delta: number) => {
    const s = stateRef.current;
    handle.current?.seek(Math.min(Math.max(0, s.currentTime + delta), s.duration || Infinity));
    showFlash(<Skip10 forward={delta > 0} size={56} />);
    wake();
  }, [wake]);

  const setVolume = useCallback((volume: number) => {
    const v = Math.min(1, Math.max(0, Math.round(volume * 100) / 100));
    handle.current?.setVolume(v);
    savePrefs(v, v === 0);
  }, []);

  const toggleMute = useCallback(() => {
    const s = stateRef.current;
    const muted = !(s.muted || s.volume === 0);
    if (!muted && s.volume === 0) handle.current?.setVolume(0.5);
    handle.current?.setMuted(muted);
    savePrefs(s.volume || 0.5, muted);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void container.current?.requestFullscreen().catch(() => undefined);
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => {
    wake();
    return () => window.clearTimeout(hideTimer.current);
  }, [wake]);

  // Keyboard shortcuts (same keys as Netflix/YouTube).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const keys: Record<string, () => void> = {
        ' ': togglePlay,
        k: togglePlay,
        ArrowLeft: () => seekBy(-SKIP_SECONDS),
        j: () => seekBy(-SKIP_SECONDS),
        ArrowRight: () => seekBy(SKIP_SECONDS),
        l: () => seekBy(SKIP_SECONDS),
        // Muted with a remembered volume: ↑ restores it. At 0 (or unmuted): ↑ steps up.
        ArrowUp: () => {
          const s = stateRef.current;
          setVolume(s.muted && s.volume > 0 ? s.volume : s.volume + 0.1);
        },
        // Already silent: ↓ does nothing, so the remembered volume isn't overwritten with 0.
        ArrowDown: () => {
          const s = stateRef.current;
          if (!s.muted) setVolume(s.volume - 0.1);
        },
        m: toggleMute,
        f: toggleFullscreen,
        Escape: () => setMenu(null),
      };
      const action = keys[e.key.length === 1 ? e.key.toLowerCase() : e.key];
      if (!action) return;
      e.preventDefault();
      action();
      wake();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, seekBy, setVolume, toggleMute, toggleFullscreen, wake]);

  const engineProps = {
    ref: handle,
    start,
    initialVolume: prefs.volume,
    initialMuted: prefs.muted,
    onState,
    onEnded: () => onEnded(stateRef.current.duration || null),
  };
  const remaining = Math.max(0, state.duration - state.currentTime);
  const showNextPrompt = next && state.duration > 0 && (state.ended || remaining < NEXT_PROMPT_SECONDS);
  const fade = `transition-opacity duration-300 ${visible ? 'opacity-100' : 'pointer-events-none opacity-0'}`;

  return (
    <div
      ref={container}
      className={`fixed inset-0 select-none overflow-hidden bg-black text-white ${visible ? '' : 'cursor-none'}`}
      onMouseMove={wake}
      onMouseLeave={() => state.playing && setIdle(true)}
    >
      <div className="absolute inset-0">
        {source.kind === 'local' ? (
          <VideoEngine {...engineProps} src={source.src} onError={onMissing} />
        ) : (
          <YouTubeEngine {...engineProps} videoId={source.videoId} onError={setLoadError} />
        )}
      </div>

      {/* Click layer: captures clicks so YouTube's own UI never appears, and toggles play like Netflix. */}
      <div
        className="absolute inset-0"
        onClick={() => {
          setMenu(null);
          togglePlay();
        }}
        onDoubleClick={toggleFullscreen}
      />

      {loadError ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
          <p className="max-w-md rounded bg-black/80 px-6 py-4 text-center text-lg">{loadError}</p>
        </div>
      ) : (
        state.waiting && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <Loader2 size={72} className="animate-spin text-flix-red" />
          </div>
        )
      )}

      {flash && (
        <div key={flash.key} className="player-flash pointer-events-none absolute left-1/2 top-1/2 rounded-full bg-black/50 p-6">
          {flash.icon}
        </div>
      )}

      {/* Top bar */}
      {/* Like the bottom bar: empty gradient passes clicks through to the play/pause layer. */}
      <div className={`pointer-events-none absolute inset-x-0 top-0 flex items-center gap-4 bg-gradient-to-b from-black/70 to-transparent p-5 md:p-8 ${fade}`}>
        <div className={visible ? 'pointer-events-auto' : ''}>
          <CtrlButton label="Back" onClick={onBack}>
            <ArrowLeft size={44} />
          </CtrlButton>
        </div>
        <div className="ml-auto">{badge}</div>
      </div>

      {/* Bottom controls */}
      <div className={`pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-5 pb-5 pt-28 md:px-10 md:pb-7 ${fade}`}>
        <div className={`flex items-center gap-4 ${visible ? 'pointer-events-auto' : ''}`}>
          <ProgressBar
            current={state.currentTime}
            duration={state.duration}
            buffered={state.buffered}
            onSeek={(t) => handle.current?.seek(t)}
          />
          <span className="w-20 text-right text-base tabular-nums text-white/90">{formatClock(remaining)}</span>
        </div>

        <div className={`mt-2 flex items-center gap-1 md:gap-4 ${visible ? 'pointer-events-auto' : ''}`}>
          <CtrlButton label={state.playing ? 'Pause' : 'Play'} onClick={togglePlay}>
            {state.playing ? <Pause size={46} fill="currentColor" /> : <Play size={46} fill="currentColor" />}
          </CtrlButton>
          <CtrlButton label="Back 10 seconds" onClick={() => seekBy(-SKIP_SECONDS)}>
            <Skip10 size={42} />
          </CtrlButton>
          <CtrlButton label="Forward 10 seconds" onClick={() => seekBy(SKIP_SECONDS)}>
            <Skip10 forward size={42} />
          </CtrlButton>
          <VolumeControl volume={state.volume} muted={state.muted} onVolume={setVolume} onToggleMute={toggleMute} />

          <div className="mx-2 min-w-0 flex-1 truncate text-center text-lg md:text-xl">
            <span className="font-bold">{title}</span>
            {subtitle && <span className="ml-3 text-white/75">{subtitle}</span>}
          </div>

          {next && (
            <CtrlButton label={nextLabel} onClick={next}>
              <SkipForward size={42} fill="currentColor" />
            </CtrlButton>
          )}
          <div className="relative">
            {menu === 'speed' && (
              <SpeedMenu
                rate={state.rate}
                onPick={(r) => {
                  handle.current?.setRate(r);
                  setMenu(null);
                }}
              />
            )}
            <CtrlButton label="Playback speed" onClick={() => setMenu(menu === 'speed' ? null : 'speed')}>
              <Gauge size={40} />
            </CtrlButton>
          </div>
          <CtrlButton label={fullscreen ? 'Exit full screen' : 'Full screen'} onClick={toggleFullscreen}>
            {fullscreen ? <Minimize size={40} /> : <Maximize size={40} />}
          </CtrlButton>
        </div>
      </div>

      {showNextPrompt && (
        <button
          onClick={next}
          className="absolute bottom-36 right-6 flex items-center gap-2 rounded bg-white px-6 py-3 text-lg font-bold text-black shadow-2xl transition hover:bg-white/80 md:right-10"
        >
          <SkipForward size={22} fill="currentColor" /> {nextLabel}
        </button>
      )}
    </div>
  );
}

function CtrlButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        // Drop focus so Space keeps meaning play/pause instead of re-clicking this button.
        e.currentTarget.blur();
        onClick();
      }}
      className="flex shrink-0 items-center justify-center rounded p-1.5 text-white/90 transition-transform duration-150 hover:scale-125 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
    >
      {children}
    </button>
  );
}

function Skip10({ forward = false, size }: { forward?: boolean; size: number }) {
  const Icon = forward ? RotateCw : RotateCcw;
  return (
    <span className="relative inline-flex">
      <Icon size={size} strokeWidth={1.75} />
      <span className="absolute inset-0 flex items-center justify-center pt-0.5 font-bold" style={{ fontSize: size * 0.28 }}>
        10
      </span>
    </span>
  );
}

function VolumeControl({
  volume,
  muted,
  onVolume,
  onToggleMute,
}: {
  volume: number;
  muted: boolean;
  onVolume: (v: number) => void;
  onToggleMute: () => void;
}) {
  const level = muted ? 0 : volume;
  const Icon = level === 0 ? VolumeX : level < 0.5 ? Volume1 : Volume2;
  return (
    <div className="group/vol relative">
      {/* pb-3 bridges the gap so the slider stays open while the mouse moves up to it */}
      {/* Also stays open while dragging, even if the pointer leaves the control. */}
      <div className="absolute bottom-full left-1/2 hidden -translate-x-1/2 pb-3 group-hover/vol:block has-[[data-dragging=true]]:block">
        <div className="flex rounded bg-black/85 px-2 py-3 shadow-xl">
          <VolumeSlider level={level} onVolume={onVolume} />
        </div>
      </div>
      <CtrlButton label={level === 0 ? 'Unmute' : 'Mute'} onClick={onToggleMute}>
        <Icon size={42} />
      </CtrlButton>
    </div>
  );
}

/**
 * Vertical volume slider with a wide hit area: the visible track is thin, but the whole 40px-wide
 * column responds to clicks and drags (the native range input was too thin to hit).
 */
function VolumeSlider({ level, onVolume }: { level: number; onVolume: (v: number) => void }) {
  const column = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const levelAt = (clientY: number) => {
    const rect = column.current?.getBoundingClientRect();
    if (!rect || rect.height === 0) return level;
    return Math.min(1, Math.max(0, (rect.bottom - clientY) / rect.height));
  };
  const pct = `${level * 100}%`;

  return (
    <div
      ref={column}
      role="slider"
      aria-label="Volume"
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(level * 100)}
      tabIndex={0}
      className="relative flex h-36 w-10 cursor-pointer touch-none justify-center outline-none"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => {
        if (e.button !== 0) return; // left button / touch only
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
        onVolume(levelAt(e.clientY));
      }}
      onPointerMove={(e) => dragging && onVolume(levelAt(e.clientY))}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
      data-dragging={dragging}
    >
      <div className="relative h-full w-1.5 rounded-full bg-white/30">
        <div className="absolute inset-x-0 bottom-0 rounded-full bg-flix-red" style={{ height: pct }} />
        <div
          className={`absolute left-1/2 h-4 w-4 -translate-x-1/2 translate-y-1/2 rounded-full bg-flix-red shadow transition-transform ${
            dragging ? 'scale-125' : ''
          }`}
          style={{ bottom: pct }}
        />
      </div>
    </div>
  );
}

function SpeedMenu({ rate, onPick }: { rate: number; onPick: (r: number) => void }) {
  return (
    <div className="absolute bottom-full right-0 mb-3 rounded bg-black/90 p-2 shadow-xl" onClick={(e) => e.stopPropagation()}>
      <p className="px-3 pb-2 pt-1 text-sm font-semibold text-white/70">Playback speed</p>
      <div className="flex gap-1">
        {RATES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => onPick(r)}
            className={`rounded px-3 py-2 text-sm tabular-nums ${r === rate ? 'bg-white font-bold text-black' : 'hover:bg-white/15'}`}
          >
            {r === 1 ? '1x (Normal)' : `${r}x`}
          </button>
        ))}
      </div>
    </div>
  );
}
