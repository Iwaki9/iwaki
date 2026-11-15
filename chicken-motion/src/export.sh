#!/usr/bin/env bash
# Экспорт анимации: PNG-серии → MP4 (H.264) + GIF + постер.
#   bash src/export.sh
# Требуется ffmpeg в PATH (или python-пакет imageio-ffmpeg).
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
FRAMES="${FRAMES:-/tmp/chicken-frames}"
OUT="$ROOT/out"
mkdir -p "$OUT"

FFMPEG="${FFMPEG:-$(command -v ffmpeg || true)}"
if [ -z "$FFMPEG" ]; then
  FFMPEG="$(python3 -c 'import imageio_ffmpeg,sys; sys.stdout.write(imageio_ffmpeg.get_ffmpeg_exe())' 2>/dev/null || true)"
fi
if [ -z "$FFMPEG" ] || [ ! -x "$FFMPEG" ]; then
  echo "ffmpeg не найден. Установите его или: pip install imageio-ffmpeg" >&2
  exit 1
fi

echo "→ рендер кадров"
node src/render.mjs --fps 30 --w 1280 --h 720 --out "$FRAMES"

echo "→ mp4"
"$FFMPEG" -y -loglevel error -framerate 30 -i "$FRAMES/frame_%04d.png" \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -movflags +faststart \
  "$OUT/chicken-pecking-grains.mp4"

echo "→ постер"
cp "$FRAMES/frame_0000.png" "$OUT/poster.png"

echo "→ gif (палитра, 560 px / 15 fps)"
"$FFMPEG" -y -loglevel error -framerate 30 -i "$FRAMES/frame_%04d.png" \
  -vf "fps=15,scale=560:-1:flags=lanczos,palettegen=max_colors=192:stats_mode=diff" "$FRAMES/palette.png"
"$FFMPEG" -y -loglevel error -framerate 30 -i "$FRAMES/frame_%04d.png" \
  -i "$FRAMES/palette.png" \
  -lavfi "fps=15,scale=560:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" \
  -loop 0 "$OUT/chicken-pecking-grains.gif"

ls -lh "$OUT"
