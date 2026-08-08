/**
 * Normalization profile for course videos (scripts/transcode-worker.ts).
 *
 * The encoder previously passed source resolution and frame rate through
 * verbatim with scene-cut keyframes, so a 4K upload stayed 4K at 20–40 Mbps and
 * a seek could land many seconds away from the nearest IDR frame. This profile
 * caps the delivered resolution, ceilings the bitrate, and forces a fixed ~2s
 * GOP so seeking resolves quickly.
 *
 * Every knob is env-tunable and STRICTLY validated: the values are interpolated
 * into an ffmpeg argv, so a malformed value must fall back to its default rather
 * than reach ffmpeg and break the encode. (`execFile` is used, not a shell, so
 * there is no injection vector — this guards correctness, not privilege.)
 */

/**
 * Generation stamp written to `Lesson.videoEncodingVersion` /
 * `Course.previewVideoEncodingVersion` so assets encoded before this profile
 * existed stay identifiable for a possible later backfill.
 */
export const VIDEO_ENCODING_VERSION = 2;

/**
 * Delivered width cap. The learn page renders the player inside `max-w-[760px]`
 * on the article path (`CourseArticle`) and `max-w-[860px]` on the slides path,
 * so even at 2x DPR the useful width is ~1720px; the only regression is
 * fullscreen playback on a 4K monitor.
 */
const DEFAULT_MAX_WIDTH = 1280;
/**
 * Delivered height cap. Exists so the declared H.264 level is honest in EVERY
 * orientation: a width cap alone leaves a portrait 1080x1920 upload at 2.07 M
 * luma samples, far past what level 3.1 permits, and x264 would emit the
 * requested level in the SPS anyway — a stream strict hardware decoders may
 * refuse. Trade: portrait sources are now delivered at 720 tall rather than
 * 1920, which is the same "720p in the long dimension" budget landscape gets.
 */
const DEFAULT_MAX_HEIGHT = 720;
/**
 * Delivered frame-rate cap. 60fps sources doubled the decode work on exactly the
 * low-end devices this profile targets, for no compliance-training benefit. It is
 * also what makes level 3.1 exact: 3.1 allows 108000 MB/s, which is 30fps at
 * 1280x720.
 */
const DEFAULT_MAX_FPS = 30;
const DEFAULT_CRF = 23;
const DEFAULT_MAXRATE_KBPS = 2500;
const DEFAULT_PRESET: Libx264Preset = 'fast';

/**
 * H.264 level written into the SPS. 3.1 is the exact fit for what this profile
 * produces (1280x720, 30fps, 2500 kbps) — 4.0 advertised 1080p30/20Mbps
 * headroom no decoder needed to reserve. Only ever tighten this in step with
 * {@link DEFAULT_MAX_WIDTH}/{@link DEFAULT_MAX_HEIGHT}/{@link DEFAULT_MAX_FPS};
 * declaring a level the stream exceeds is worse than declaring one too high.
 */
const H264_LEVEL = '3.1';

/** Fixed GOP length in frames (~2s at 24fps, 1.6s at 30fps). */
const KEYFRAME_INTERVAL_FRAMES = 48;

/**
 * Poster width. A catalog card renders the thumbnail at 200px CSS and the
 * preview player at ~860px, so 640 covers both at 2x DPR on the card and is a
 * reasonable blur-free placeholder behind the player — at ~40 KB instead of the
 * hundreds of KB of MP4 header the old `<video preload="metadata">` pulled.
 */
const POSTER_WIDTH = 640;

/** libjpeg quality scale, 2 (best) – 31 (worst). 4 is visually clean. */
const POSTER_QUALITY = 4;

/**
 * Seek offset for the poster frame. The very first frame of a video is often
 * black or a fade-in, so the still is taken a second in.
 */
const POSTER_SEEK_SECONDS = 1;

/**
 * Below this duration there may be no frame at {@link POSTER_SEEK_SECONDS}, so
 * the poster is taken from the start instead.
 */
const POSTER_MIN_DURATION_SECONDS = 2;

const MIN_WIDTH = 160;
const MAX_WIDTH = 3840;
const MIN_HEIGHT = 90;
const MAX_HEIGHT = 2160;
/** libx264's CRF domain; 0 is lossless, 51 is worst. */
const MIN_CRF = 0;
const MAX_CRF = 51;
const MIN_MAXRATE_KBPS = 100;
const MAX_MAXRATE_KBPS = 20000;
const MIN_FPS = 10;
const MAX_FPS = 120;

const LIBX264_PRESETS = [
  'ultrafast',
  'superfast',
  'veryfast',
  'faster',
  'fast',
  'medium',
  'slow',
  'slower',
  'veryslow',
  'placebo',
] as const;

export type Libx264Preset = (typeof LIBX264_PRESETS)[number];

export interface EncodeSettings {
  /** Output width cap in pixels. Sources narrower than this are never upscaled. */
  maxWidth: number;
  /** Output height cap in pixels. Sources shorter than this are never upscaled. */
  maxHeight: number;
  /** Output frame-rate cap. Sources slower than this are never interpolated up. */
  maxFps: number;
  crf: number;
  maxrateKbps: number;
  preset: Libx264Preset;
}

export interface ResolvedEncodeSettings {
  settings: EncodeSettings;
  /** Env var names whose values were rejected; the caller logs these at WARN. */
  invalidEnvVars: string[];
}

/**
 * The environment shape this module reads. Deliberately NOT `NodeJS.ProcessEnv`
 * — Next augments that type with required keys, which would force every test to
 * fabricate an entire environment just to set one knob.
 */
export type EncodeEnv = Record<string, string | undefined>;

export const DEFAULT_ENCODE_SETTINGS: EncodeSettings = {
  maxWidth: DEFAULT_MAX_WIDTH,
  maxHeight: DEFAULT_MAX_HEIGHT,
  maxFps: DEFAULT_MAX_FPS,
  crf: DEFAULT_CRF,
  maxrateKbps: DEFAULT_MAXRATE_KBPS,
  preset: DEFAULT_PRESET,
};

function parseBoundedInt(raw: string | undefined, min: number, max: number): number | null {
  if (raw === undefined || raw.trim() === '') return null;
  if (!/^-?\d+$/.test(raw.trim())) return null;
  const value = Number(raw.trim());
  return value >= min && value <= max ? value : null;
}

/**
 * Reads VIDEO_MAX_WIDTH / VIDEO_MAX_HEIGHT. Rejects odd values: yuv420p needs
 * even dimensions, and the scale filter's `force_divisible_by=2` can only
 * enforce that when the box it fits into is itself even.
 */
function parseEvenDimension(raw: string | undefined, min: number, max: number): number | null {
  const value = parseBoundedInt(raw, min, max);
  return value !== null && value % 2 === 0 ? value : null;
}

/** Reads VIDEO_MAXRATE. Accepts only the kilobit form ffmpeg uses, e.g. `2500k`. */
function parseMaxrateKbps(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const match = /^(\d+)k$/.exec(raw.trim());
  if (!match) return null;
  const kbps = Number(match[1]);
  return kbps >= MIN_MAXRATE_KBPS && kbps <= MAX_MAXRATE_KBPS ? kbps : null;
}

function parsePreset(raw: string | undefined): Libx264Preset | null {
  if (raw === undefined) return null;
  const candidate = raw.trim();
  return (LIBX264_PRESETS as readonly string[]).includes(candidate)
    ? (candidate as Libx264Preset)
    : null;
}

/**
 * Resolves the encode profile from the environment, substituting the default for
 * any value that fails validation and reporting which vars were rejected.
 */
export function resolveEncodeSettings(env: EncodeEnv = process.env): ResolvedEncodeSettings {
  const invalidEnvVars: string[] = [];

  const maxWidth = parseEvenDimension(env.VIDEO_MAX_WIDTH, MIN_WIDTH, MAX_WIDTH);
  if (maxWidth === null && env.VIDEO_MAX_WIDTH !== undefined) {
    invalidEnvVars.push('VIDEO_MAX_WIDTH');
  }

  const maxHeight = parseEvenDimension(env.VIDEO_MAX_HEIGHT, MIN_HEIGHT, MAX_HEIGHT);
  if (maxHeight === null && env.VIDEO_MAX_HEIGHT !== undefined) {
    invalidEnvVars.push('VIDEO_MAX_HEIGHT');
  }

  const maxFps = parseBoundedInt(env.VIDEO_MAX_FPS, MIN_FPS, MAX_FPS);
  if (maxFps === null && env.VIDEO_MAX_FPS !== undefined) {
    invalidEnvVars.push('VIDEO_MAX_FPS');
  }

  const crf = parseBoundedInt(env.VIDEO_CRF, MIN_CRF, MAX_CRF);
  if (crf === null && env.VIDEO_CRF !== undefined) {
    invalidEnvVars.push('VIDEO_CRF');
  }

  const maxrateKbps = parseMaxrateKbps(env.VIDEO_MAXRATE);
  if (maxrateKbps === null && env.VIDEO_MAXRATE !== undefined) {
    invalidEnvVars.push('VIDEO_MAXRATE');
  }

  const preset = parsePreset(env.VIDEO_PRESET);
  if (preset === null && env.VIDEO_PRESET !== undefined) {
    invalidEnvVars.push('VIDEO_PRESET');
  }

  return {
    settings: {
      maxWidth: maxWidth ?? DEFAULT_ENCODE_SETTINGS.maxWidth,
      maxHeight: maxHeight ?? DEFAULT_ENCODE_SETTINGS.maxHeight,
      maxFps: maxFps ?? DEFAULT_ENCODE_SETTINGS.maxFps,
      crf: crf ?? DEFAULT_ENCODE_SETTINGS.crf,
      maxrateKbps: maxrateKbps ?? DEFAULT_ENCODE_SETTINGS.maxrateKbps,
      preset: preset ?? DEFAULT_ENCODE_SETTINGS.preset,
    },
    invalidEnvVars,
  };
}

/**
 * Builds the video filtergraph.
 *
 * `fps` comes BEFORE `scale` deliberately: frames that are about to be dropped
 * should not be paid for in lanczos first — that ordering matters on the
 * single-thread budget below. It is also why the cap is an `fps` filter rather
 * than an output-side `-r`, which applies after the whole graph.
 *
 * The cap is applied only when `sourceFps` is known to exceed it. A plain
 * `fps=30` would DUPLICATE frames on a 24fps source, adding judder and encode
 * work to normalise upwards — the opposite of the intent. An unknown source rate
 * therefore leaves the frame rate untouched rather than guessing.
 *
 * `w='min(W,iw)':h='min(H,ih)'` never upscales (the box shrinks to the source),
 * and `force_original_aspect_ratio=decrease` fits the source inside that box in
 * whatever orientation it arrives, which is what keeps {@link H264_LEVEL}
 * honest. `force_divisible_by=2` keeps both dimensions even for yuv420p. The
 * single quotes are consumed by ffmpeg's own filtergraph parser — they protect
 * the comma inside `min()`, which would otherwise read as a filter separator.
 */
function buildVideoFilters(settings: EncodeSettings, sourceFps: number | null): string {
  const scale =
    `scale=w='min(${settings.maxWidth},iw)':h='min(${settings.maxHeight},ih)'` +
    `:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos`;

  return sourceFps !== null && sourceFps > settings.maxFps
    ? `fps=${settings.maxFps},${scale}`
    : scale;
}

/**
 * Builds the ffmpeg argv for the normalization encode.
 *
 * `sourceFps` is the probed frame rate of the INPUT, or null when it could not
 * be determined; see {@link buildVideoFilters} for how it is used.
 *
 * Notable choices:
 * - `-profile:v high -level 3.1` — see {@link H264_LEVEL}. High profile is the
 *   right compression/compatibility point; the level is sized to what the caps
 *   above actually produce.
 * - `-maxrate`/`-bufsize` — constrained VBR with a 2s VBV so a high-motion
 *   passage cannot spike past what a modest connection can stream.
 * - `-g`/`-keyint_min`/`-sc_threshold 0` — a fixed ~2s GOP. This is what makes
 *   seeking fast; scene-cut keyframes left multi-second gaps between IDR frames.
 * - `-threads 1` — the encode shares a 2-vCPU / 1 GB container with SSR, so
 *   ffmpeg is hard-capped rather than allowed to take every core.
 * - `-map 0:a:0?` — audio stays optional so silent videos still succeed.
 */
export function buildTranscodeArgs(
  inputPath: string,
  outputPath: string,
  settings: EncodeSettings = DEFAULT_ENCODE_SETTINGS,
  sourceFps: number | null = null,
): string[] {
  return [
    '-y',
    '-i',
    inputPath,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-vf',
    buildVideoFilters(settings, sourceFps),
    '-c:v',
    'libx264',
    '-profile:v',
    'high',
    '-level',
    H264_LEVEL,
    '-pix_fmt',
    'yuv420p',
    '-preset',
    settings.preset,
    '-crf',
    String(settings.crf),
    '-maxrate',
    `${settings.maxrateKbps}k`,
    '-bufsize',
    `${settings.maxrateKbps * 2}k`,
    '-g',
    String(KEYFRAME_INTERVAL_FRAMES),
    '-keyint_min',
    String(KEYFRAME_INTERVAL_FRAMES),
    '-sc_threshold',
    '0',
    '-c:a',
    'aac',
    '-b:a',
    '96k',
    '-ac',
    '2',
    '-threads',
    '1',
    '-max_muxing_queue_size',
    '1024',
    '-movflags',
    '+faststart',
    outputPath,
  ];
}

/**
 * Builds the ffmpeg argv that extracts a single still frame as a JPEG poster.
 *
 * `-ss` is placed BEFORE `-i` deliberately: that is an *input* seek, which jumps
 * the demuxer straight to the nearest keyframe and decodes one frame. The same
 * flag after `-i` is an output seek, which decodes everything up to the offset
 * and would turn a millisecond operation into a full decode. This is also what
 * makes the backfill viable against a signed HTTPS URL — ffmpeg issues its own
 * Range requests and never downloads the whole object.
 *
 * `durationSeconds` is the probed duration of the SOURCE being framed; a video
 * shorter than {@link POSTER_MIN_DURATION_SECONDS} is seeked from 0 instead, as
 * there may be no frame at the normal offset. An unknown (null) duration keeps
 * the normal offset — the poster step is non-fatal, so a failed extraction just
 * leaves the asset posterless.
 */
export function buildPosterArgs(
  inputPath: string,
  outputPath: string,
  durationSeconds: number | null,
): string[] {
  const seekSeconds =
    durationSeconds !== null && durationSeconds < POSTER_MIN_DURATION_SECONDS
      ? 0
      : POSTER_SEEK_SECONDS;

  return [
    '-y',
    '-ss',
    String(seekSeconds),
    '-i',
    inputPath,
    '-frames:v',
    '1',
    '-vf',
    `scale=${POSTER_WIDTH}:-2`,
    '-q:v',
    String(POSTER_QUALITY),
    outputPath,
  ];
}
