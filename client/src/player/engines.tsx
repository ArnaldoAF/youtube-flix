// Two playback engines behind one interface, so the same Netflix-style controls drive both:
// a local MP4 (<video>) and the YouTube IFrame player with its own controls hidden.
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

export interface PlayerState {
  playing: boolean;
  currentTime: number;
  duration: number;
  /** Seconds buffered from the start. */
  buffered: number;
  volume: number;
  muted: boolean;
  rate: number;
  waiting: boolean;
  ended: boolean;
}

export const INITIAL_STATE: PlayerState = {
  playing: false,
  currentTime: 0,
  duration: 0,
  buffered: 0,
  volume: 1,
  muted: false,
  rate: 1,
  waiting: true,
  ended: false,
};

export interface PlayerHandle {
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  /** 0..1 */
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  setRate(rate: number): void;
}

interface EngineProps {
  start: number;
  initialVolume: number;
  initialMuted: boolean;
  onState: (state: PlayerState) => void;
  onEnded: () => void;
}

// --- Local MP4 ---

export const VideoEngine = forwardRef<PlayerHandle, EngineProps & { src: string; onError: () => void }>(
  function VideoEngine({ src, start, initialVolume, initialMuted, onState, onEnded, onError }, ref) {
    const video = useRef<HTMLVideoElement>(null);
    const waiting = useRef(true);

    useImperativeHandle(
      ref,
      () => ({
        play: () => void video.current?.play().catch(() => undefined),
        pause: () => video.current?.pause(),
        seek: (t) => {
          if (video.current) video.current.currentTime = t;
        },
        setVolume: (v) => {
          if (!video.current) return;
          video.current.volume = v;
          video.current.muted = v === 0;
        },
        setMuted: (m) => {
          if (video.current) video.current.muted = m;
        },
        setRate: (r) => {
          if (video.current) video.current.playbackRate = r;
        },
      }),
      [],
    );

    useEffect(() => {
      if (!video.current) return;
      video.current.volume = initialVolume;
      video.current.muted = initialMuted;
      // Initial preferences only; later changes go through the handle.
    }, []);

    const emit = () => {
      const v = video.current;
      if (!v) return;
      onState({
        playing: !v.paused && !v.ended,
        currentTime: v.currentTime,
        duration: Number.isFinite(v.duration) ? v.duration : 0,
        buffered: v.buffered.length ? v.buffered.end(v.buffered.length - 1) : 0,
        volume: v.volume,
        muted: v.muted,
        rate: v.playbackRate,
        waiting: waiting.current && !v.paused,
        ended: v.ended,
      });
    };
    const setWaiting = (value: boolean) => () => {
      waiting.current = value;
      emit();
    };

    return (
      <video
        ref={video}
        src={src}
        autoPlay
        playsInline
        className="h-full w-full bg-black object-contain"
        onLoadedMetadata={(e) => {
          if (start) e.currentTarget.currentTime = start;
          emit();
        }}
        onTimeUpdate={emit}
        onPlay={emit}
        onPause={emit}
        onProgress={emit}
        onVolumeChange={emit}
        onRateChange={emit}
        onDurationChange={emit}
        onWaiting={setWaiting(true)}
        onPlaying={setWaiting(false)}
        onCanPlay={setWaiting(false)}
        onEnded={() => {
          emit();
          onEnded();
        }}
        onError={onError}
      />
    );
  },
);

// --- YouTube IFrame ---

interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(volume: number): void;
  getVolume(): number;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  setPlaybackRate(rate: number): void;
  getPlaybackRate(): number;
  getCurrentTime(): number;
  getDuration(): number;
  getVideoLoadedFraction(): number;
  destroy(): void;
}
interface YTNamespace {
  Player: new (
    el: HTMLElement,
    opts: {
      host?: string;
      videoId: string;
      playerVars?: Record<string, number | string>;
      events?: {
        onReady?: (e: { target: YTPlayer }) => void;
        onStateChange?: (e: { data: number }) => void;
      };
    },
  ) => YTPlayer;
}
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const YT_ENDED = 0;
const YT_PLAYING = 1;
const YT_BUFFERING = 3;

let apiPromise: Promise<YTNamespace> | null = null;

const API_TIMEOUT_MS = 15_000;

function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  apiPromise ??= new Promise<YTNamespace>((resolve, reject) => {
    const script = document.createElement('script');
    const fail = () => {
      script.remove();
      reject(new Error('Could not load the YouTube player. Check your internet connection.'));
    };
    const timer = window.setTimeout(fail, API_TIMEOUT_MS);
    window.onYouTubeIframeAPIReady = () => {
      window.clearTimeout(timer);
      resolve(window.YT as YTNamespace);
    };
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => {
      window.clearTimeout(timer);
      fail();
    };
    document.head.appendChild(script);
  }).catch((err) => {
    apiPromise = null; // allow a retry on the next play
    throw err;
  });
  return apiPromise;
}

export const YouTubeEngine = forwardRef<
  PlayerHandle,
  EngineProps & { videoId: string; onError: (message: string) => void }
>(function YouTubeEngine({ videoId, start, initialVolume, initialMuted, onState, onEnded, onError }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const callbacks = useRef({ onState, onEnded, onError });
  callbacks.current = { onState, onEnded, onError };
  const prefs = useRef({ initialVolume, initialMuted });

  useImperativeHandle(
    ref,
    () => ({
      play: () => player.current?.playVideo(),
      pause: () => player.current?.pauseVideo(),
      seek: (t) => player.current?.seekTo(t, true),
      setVolume: (v) => {
        const p = player.current;
        if (!p) return;
        p.setVolume(Math.round(v * 100));
        if (v === 0) p.mute();
        else p.unMute();
      },
      setMuted: (m) => (m ? player.current?.mute() : player.current?.unMute()),
      setRate: (r) => player.current?.setPlaybackRate(r),
    }),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let ytState = -1;

    const poll = () => {
      const p = player.current;
      if (!p) return;
      const duration = p.getDuration() || 0;
      callbacks.current.onState({
        // A buffering stall is still "playing": Space should pause it, and it isn't a user pause.
        playing: ytState === YT_PLAYING || ytState === YT_BUFFERING,
        currentTime: p.getCurrentTime() || 0,
        duration,
        buffered: (p.getVideoLoadedFraction() || 0) * duration,
        volume: p.getVolume() / 100,
        muted: p.isMuted(),
        rate: p.getPlaybackRate(),
        waiting: ytState === YT_BUFFERING,
        ended: ytState === YT_ENDED,
      });
    };

    loadYouTubeApi()
      .catch((err: Error) => {
        if (!cancelled) callbacks.current.onError(err.message);
        return null;
      })
      .then((YT) => {
      if (!YT || cancelled || !host.current) return;
      const mount = document.createElement('div');
      host.current.appendChild(mount);
      new YT.Player(mount, {
        host: 'https://www.youtube-nocookie.com',
        videoId,
        // controls: 0 hides YouTube's UI; ours is drawn on top.
        playerVars: { autoplay: 1, start, controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3, rel: 0, playsinline: 1 },
        events: {
          onReady: ({ target }) => {
            if (cancelled) return target.destroy();
            target.setVolume(Math.round(prefs.current.initialVolume * 100));
            if (prefs.current.initialMuted) target.mute();
            else target.unMute();
            player.current = target;
            timer = window.setInterval(poll, 250);
            poll();
          },
          onStateChange: ({ data }) => {
            ytState = data;
            poll();
            if (data === YT_ENDED) callbacks.current.onEnded();
          },
        },
      });
    });

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      player.current?.destroy();
      player.current = null;
    };
  }, [videoId, start]);

  return <div ref={host} className="h-full w-full [&>iframe]:h-full [&>iframe]:w-full" />;
});
