/**
 * Guards the course-video normalization profile.
 *
 * The argv is asserted as flag/value PAIRS rather than a whole-array equality so
 * a reordering does not fail the suite while a dropped or altered flag still
 * does — every flag here is load-bearing (the fixed GOP is what makes seeking
 * fast; the thread cap is what keeps ffmpeg from starving SSR in the shared
 * container).
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ENCODE_SETTINGS,
  VIDEO_ENCODING_VERSION,
  buildTranscodeArgs,
  resolveEncodeSettings,
} from './encoding';

const IN = '/tmp/in.mov';
const OUT = '/tmp/out.mp4';

/** The scale filter the default caps produce, on its own (no frame-rate cap). */
const SCALE_1280x720 =
  "scale=w='min(1280,iw)':h='min(720,ih)'" +
  ':force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos';

/** Returns the value ffmpeg would receive for `flag`, or undefined if absent. */
function valueOf(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}

describe('buildTranscodeArgs — defaults', () => {
  const args = buildTranscodeArgs(IN, OUT);

  it('fits the frame inside 1280x720 without upscaling, keeping both sides even', () => {
    expect(valueOf(args, '-vf')).toBe(SCALE_1280x720);
  });

  it('encodes H.264 High 3.1 / yuv420p at CRF 23 with the fast preset', () => {
    expect(valueOf(args, '-c:v')).toBe('libx264');
    expect(valueOf(args, '-profile:v')).toBe('high');
    // 3.1 is exactly 1280x720@30 — the caps above. Loosening either without the
    // other makes the declared level a lie to the decoder.
    expect(valueOf(args, '-level')).toBe('3.1');
    expect(valueOf(args, '-pix_fmt')).toBe('yuv420p');
    expect(valueOf(args, '-preset')).toBe('fast');
    expect(valueOf(args, '-crf')).toBe('23');
  });

  it('constrains VBR to 2500k with a 2s VBV buffer', () => {
    expect(valueOf(args, '-maxrate')).toBe('2500k');
    expect(valueOf(args, '-bufsize')).toBe('5000k');
  });

  it('forces a fixed ~2s GOP so seeks land near an IDR frame', () => {
    expect(valueOf(args, '-g')).toBe('48');
    expect(valueOf(args, '-keyint_min')).toBe('48');
    expect(valueOf(args, '-sc_threshold')).toBe('0');
  });

  it('normalizes audio to stereo AAC at 96k', () => {
    expect(valueOf(args, '-c:a')).toBe('aac');
    expect(valueOf(args, '-b:a')).toBe('96k');
    expect(valueOf(args, '-ac')).toBe('2');
  });

  it('hard-caps ffmpeg to one thread so it cannot starve SSR', () => {
    expect(valueOf(args, '-threads')).toBe('1');
  });

  it('keeps audio optional so silent videos still succeed', () => {
    expect(args.filter((a) => a === '-map')).toHaveLength(2);
    expect(args).toContain('0:v:0');
    expect(args).toContain('0:a:0?');
  });

  it('writes a faststart MP4 and overwrites the output path', () => {
    expect(valueOf(args, '-movflags')).toBe('+faststart');
    expect(valueOf(args, '-max_muxing_queue_size')).toBe('1024');
    expect(args[0]).toBe('-y');
    expect(valueOf(args, '-i')).toBe(IN);
    expect(args.at(-1)).toBe(OUT);
  });

  it('passes no argument as a shell-quoted string (execFile takes a bare argv)', () => {
    // Only the -vf filter carries quotes, and those are consumed by ffmpeg's own
    // filtergraph parser to protect the comma inside min().
    const quoted = args.filter((a) => a.includes("'"));
    expect(quoted).toEqual([SCALE_1280x720]);
  });
});

describe('buildTranscodeArgs — frame-rate cap', () => {
  it('caps a 60fps source to 30, dropping frames BEFORE the scale', () => {
    // Ordering matters: lanczos-scaling a frame that is about to be discarded
    // is wasted work on the single-thread budget.
    expect(valueOf(buildTranscodeArgs(IN, OUT, DEFAULT_ENCODE_SETTINGS, 60), '-vf')).toBe(
      `fps=30,${SCALE_1280x720}`,
    );
  });

  it.each([
    ['24fps film', 24],
    ['29.97 NTSC', 30000 / 1001],
    ['exactly at the cap', 30],
  ])('leaves a %s source alone rather than duplicating frames up to 30', (_label, sourceFps) => {
    expect(valueOf(buildTranscodeArgs(IN, OUT, DEFAULT_ENCODE_SETTINGS, sourceFps), '-vf')).toBe(
      SCALE_1280x720,
    );
  });

  it('applies no cap when the source rate could not be probed', () => {
    expect(valueOf(buildTranscodeArgs(IN, OUT, DEFAULT_ENCODE_SETTINGS, null), '-vf')).toBe(
      SCALE_1280x720,
    );
  });

  it('honors VIDEO_MAX_FPS', () => {
    const { settings } = resolveEncodeSettings({ VIDEO_MAX_FPS: '24' });
    expect(settings.maxFps).toBe(24);
    expect(valueOf(buildTranscodeArgs(IN, OUT, settings, 60), '-vf')).toContain('fps=24,');
  });
});

describe('resolveEncodeSettings — valid overrides', () => {
  it('returns the defaults for an empty environment', () => {
    const { settings, invalidEnvVars } = resolveEncodeSettings({});
    expect(settings).toEqual(DEFAULT_ENCODE_SETTINGS);
    expect(invalidEnvVars).toEqual([]);
  });

  it('applies VIDEO_MAX_WIDTH to the scale filter', () => {
    const { settings, invalidEnvVars } = resolveEncodeSettings({ VIDEO_MAX_WIDTH: '1920' });
    expect(settings.maxWidth).toBe(1920);
    expect(invalidEnvVars).toEqual([]);
    expect(valueOf(buildTranscodeArgs(IN, OUT, settings), '-vf')).toContain("'min(1920,iw)'");
  });

  it('applies VIDEO_MAX_HEIGHT to the scale filter', () => {
    const { settings, invalidEnvVars } = resolveEncodeSettings({ VIDEO_MAX_HEIGHT: '1080' });
    expect(settings.maxHeight).toBe(1080);
    expect(invalidEnvVars).toEqual([]);
    expect(valueOf(buildTranscodeArgs(IN, OUT, settings), '-vf')).toContain("'min(1080,ih)'");
  });

  it('applies VIDEO_CRF', () => {
    const { settings, invalidEnvVars } = resolveEncodeSettings({ VIDEO_CRF: '28' });
    expect(settings.crf).toBe(28);
    expect(invalidEnvVars).toEqual([]);
    expect(valueOf(buildTranscodeArgs(IN, OUT, settings), '-crf')).toBe('28');
  });

  it('applies VIDEO_MAXRATE and keeps bufsize at 2x', () => {
    const { settings, invalidEnvVars } = resolveEncodeSettings({ VIDEO_MAXRATE: '4000k' });
    expect(settings.maxrateKbps).toBe(4000);
    expect(invalidEnvVars).toEqual([]);
    const args = buildTranscodeArgs(IN, OUT, settings);
    expect(valueOf(args, '-maxrate')).toBe('4000k');
    expect(valueOf(args, '-bufsize')).toBe('8000k');
  });

  it('applies VIDEO_PRESET', () => {
    const { settings, invalidEnvVars } = resolveEncodeSettings({ VIDEO_PRESET: 'veryslow' });
    expect(settings.preset).toBe('veryslow');
    expect(invalidEnvVars).toEqual([]);
    expect(valueOf(buildTranscodeArgs(IN, OUT, settings), '-preset')).toBe('veryslow');
  });

  it('accepts the boundary values of every numeric range', () => {
    const { settings, invalidEnvVars } = resolveEncodeSettings({
      VIDEO_MAX_WIDTH: '160',
      VIDEO_MAX_HEIGHT: '90',
      VIDEO_MAX_FPS: '10',
      VIDEO_CRF: '0',
      VIDEO_MAXRATE: '100k',
    });
    expect(settings).toMatchObject({
      maxWidth: 160,
      maxHeight: 90,
      maxFps: 10,
      crf: 0,
      maxrateKbps: 100,
    });
    expect(invalidEnvVars).toEqual([]);

    const upper = resolveEncodeSettings({
      VIDEO_MAX_WIDTH: '3840',
      VIDEO_MAX_HEIGHT: '2160',
      VIDEO_MAX_FPS: '120',
      VIDEO_CRF: '51',
      VIDEO_MAXRATE: '20000k',
    });
    expect(upper.settings).toMatchObject({
      maxWidth: 3840,
      maxHeight: 2160,
      maxFps: 120,
      crf: 51,
      maxrateKbps: 20000,
    });
    expect(upper.invalidEnvVars).toEqual([]);
  });
});

describe('resolveEncodeSettings — invalid values fall back to defaults', () => {
  it.each([
    ['non-numeric', 'abc'],
    ['negative', '-1280'],
    ['below range', '128'],
    ['above range', '4096'],
    ['odd (would break yuv420p)', '1281'],
    ['float', '1280.5'],
    ['empty', ''],
    ['expression injected into the filter', '1280);drop'],
  ])('VIDEO_MAX_WIDTH %s', (_label, value) => {
    const { settings, invalidEnvVars } = resolveEncodeSettings({ VIDEO_MAX_WIDTH: value });
    expect(settings.maxWidth).toBe(DEFAULT_ENCODE_SETTINGS.maxWidth);
    expect(invalidEnvVars).toEqual(['VIDEO_MAX_WIDTH']);
    expect(valueOf(buildTranscodeArgs(IN, OUT, settings), '-vf')).toBe(SCALE_1280x720);
  });

  it.each([
    ['non-numeric', 'tall'],
    ['negative', '-720'],
    ['below range', '88'],
    ['above range', '2162'],
    ['odd (would break yuv420p)', '721'],
    ['float', '720.5'],
    ['empty', ''],
    ['expression injected into the filter', '720);drop'],
  ])('VIDEO_MAX_HEIGHT %s', (_label, value) => {
    const { settings, invalidEnvVars } = resolveEncodeSettings({ VIDEO_MAX_HEIGHT: value });
    expect(settings.maxHeight).toBe(DEFAULT_ENCODE_SETTINGS.maxHeight);
    expect(invalidEnvVars).toEqual(['VIDEO_MAX_HEIGHT']);
  });

  it.each([
    ['non-numeric', 'thirty'],
    ['negative', '-30'],
    ['below range', '5'],
    ['above range', '121'],
    ['float', '29.97'],
    ['empty', ''],
  ])('VIDEO_MAX_FPS %s', (_label, value) => {
    const { settings, invalidEnvVars } = resolveEncodeSettings({ VIDEO_MAX_FPS: value });
    expect(settings.maxFps).toBe(DEFAULT_ENCODE_SETTINGS.maxFps);
    expect(invalidEnvVars).toEqual(['VIDEO_MAX_FPS']);
  });

  it.each([
    ['non-numeric', 'high'],
    ['negative', '-1'],
    ['above range', '52'],
    ['float', '23.5'],
    ['empty', ''],
  ])('VIDEO_CRF %s', (_label, value) => {
    const { settings, invalidEnvVars } = resolveEncodeSettings({ VIDEO_CRF: value });
    expect(settings.crf).toBe(DEFAULT_ENCODE_SETTINGS.crf);
    expect(invalidEnvVars).toEqual(['VIDEO_CRF']);
  });

  it.each([
    ['missing the k suffix', '2500'],
    ['megabit suffix', '2M'],
    ['non-numeric', 'fast'],
    ['negative', '-2500k'],
    ['below range', '50k'],
    ['above range', '20001k'],
    ['empty', ''],
  ])('VIDEO_MAXRATE %s', (_label, value) => {
    const { settings, invalidEnvVars } = resolveEncodeSettings({ VIDEO_MAXRATE: value });
    expect(settings.maxrateKbps).toBe(DEFAULT_ENCODE_SETTINGS.maxrateKbps);
    expect(invalidEnvVars).toEqual(['VIDEO_MAXRATE']);
    const args = buildTranscodeArgs(IN, OUT, settings);
    expect(valueOf(args, '-maxrate')).toBe('2500k');
    expect(valueOf(args, '-bufsize')).toBe('5000k');
  });

  it.each([
    ['unknown preset name', 'turbo'],
    ['wrong case', 'Fast'],
    ['numeric', '5'],
    ['empty', ''],
  ])('VIDEO_PRESET %s', (_label, value) => {
    const { settings, invalidEnvVars } = resolveEncodeSettings({ VIDEO_PRESET: value });
    expect(settings.preset).toBe(DEFAULT_ENCODE_SETTINGS.preset);
    expect(invalidEnvVars).toEqual(['VIDEO_PRESET']);
  });

  it('reports every rejected var at once and still returns a usable profile', () => {
    const { settings, invalidEnvVars } = resolveEncodeSettings({
      VIDEO_MAX_WIDTH: 'x',
      VIDEO_MAX_HEIGHT: 'v',
      VIDEO_MAX_FPS: 'u',
      VIDEO_CRF: 'y',
      VIDEO_MAXRATE: 'z',
      VIDEO_PRESET: 'w',
    });
    expect(settings).toEqual(DEFAULT_ENCODE_SETTINGS);
    expect(invalidEnvVars).toEqual([
      'VIDEO_MAX_WIDTH',
      'VIDEO_MAX_HEIGHT',
      'VIDEO_MAX_FPS',
      'VIDEO_CRF',
      'VIDEO_MAXRATE',
      'VIDEO_PRESET',
    ]);
  });

  it('tolerates surrounding whitespace on otherwise valid values', () => {
    const { settings, invalidEnvVars } = resolveEncodeSettings({
      VIDEO_MAX_WIDTH: ' 1920 ',
      VIDEO_MAX_HEIGHT: ' 1080 ',
      VIDEO_MAX_FPS: ' 24 ',
      VIDEO_CRF: ' 20 ',
      VIDEO_MAXRATE: ' 3000k ',
      VIDEO_PRESET: ' medium ',
    });
    expect(settings).toEqual({
      maxWidth: 1920,
      maxHeight: 1080,
      maxFps: 24,
      crf: 20,
      maxrateKbps: 3000,
      preset: 'medium',
    });
    expect(invalidEnvVars).toEqual([]);
  });
});

describe('VIDEO_ENCODING_VERSION', () => {
  it('is 2 — the generation this profile writes', () => {
    expect(VIDEO_ENCODING_VERSION).toBe(2);
  });
});
