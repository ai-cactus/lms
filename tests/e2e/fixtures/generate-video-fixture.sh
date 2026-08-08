#!/usr/bin/env bash
# Generates tests/e2e/fixtures/sample-lesson.mp4 — the tiny, real, decodable
# H.264 clip video-playback.spec.ts uploads to MinIO and points a seeded
# lesson's videoStorageUri at.
#
# Run this ONCE, locally, with ffmpeg installed (the same binary
# scripts/transcode-worker.ts requires in every environment that runs it —
# see its ffprobe/ffmpeg execFile calls). Commit the resulting .mp4. The spec
# itself never invokes ffmpeg or touches the network for content — it only
# uploads this already-generated file to the local MinIO instance, so the
# actual test run stays hermetic.
#
# Re-run and re-commit only if you deliberately change FIXTURE_DURATION_SECONDS
# in video-playback.spec.ts — the two must stay in sync.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg not found on PATH — install it (apt install ffmpeg / brew install ffmpeg) and re-run." >&2
  exit 1
fi

# 320x240, 15fps, 6s, no audio, baseline H.264, 1s (15-frame) GOP so seeking
# resolves quickly, +faststart so the moov atom is at the front (metadata
# loads without pulling the whole file).
ffmpeg -y \
  -f lavfi -i "testsrc=size=320x240:rate=15:duration=6" \
  -c:v libx264 -profile:v baseline -pix_fmt yuv420p \
  -g 15 -keyint_min 15 \
  -movflags +faststart \
  -an \
  sample-lesson.mp4

echo "Wrote $(pwd)/sample-lesson.mp4 — commit this file."
