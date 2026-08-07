#!/usr/bin/env bash
set -euo pipefail

mkdir -p output
TITLE="${GAME_TITLE:-New Game}"
DURATION="${RECORD_SECONDS:-30}"
FONT_BOLD="/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_REGULAR="/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

[[ -f output/gameplay.webm ]] || { echo "output/gameplay.webm bulunamadi."; exit 1; }

# capture.js records from browser startup because Playwright's recordVideo API
# cannot be started later. Read the clean gameplay timestamp and trim all
# provider ads/loaders before it.
TRIM_START="0"
if [[ -s output/metadata.json ]]; then
  TRIM_START="$(node -e "try{const d=require('./output/metadata.json'); const n=Number(d.gameplayStartOffsetSeconds||0); process.stdout.write(Number.isFinite(n)?String(Math.max(0,n)):'0')}catch(e){process.stdout.write('0')}")"
fi

echo "Rendering clean gameplay from raw +${TRIM_START}s for ${DURATION}s"

SAFE_TITLE="${TITLE//\\/\\\\}"
SAFE_TITLE="${SAFE_TITLE//:/\\:}"
SAFE_TITLE="${SAFE_TITLE//\'/\\\'}"

ffmpeg -y -f lavfi -i color=c=0x071426:s=1080x1920:d=1.3:r=30 \
  -vf "drawtext=fontfile=${FONT_BOLD}:text='GamexlabTR':fontcolor=white:fontsize=92:x=(w-text_w)/2:y=735,\
drawtext=fontfile=${FONT_REGULAR}:text='YENİ OYUN / NEW GAME':fontcolor=0x6EA8FF:fontsize=44:x=(w-text_w)/2:y=875" \
  -an -c:v libx264 -pix_fmt yuv420p -r 30 output/intro.mp4

# -ss before -i performs an efficient seek. The precise timestamp comes from
# capture.js after ad/popup handling and gameplay readiness checks.
ffmpeg -y -ss "${TRIM_START}" -i output/gameplay.webm -t "${DURATION}" \
  -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,\
drawbox=x=0:y=0:w=iw:h=170:color=black@0.50:t=fill,\
drawtext=fontfile=${FONT_BOLD}:text='${SAFE_TITLE}':fontcolor=white:fontsize=48:x=50:y=55,\
drawtext=fontfile=${FONT_BOLD}:text='GamexlabTR':fontcolor=white@0.72:fontsize=34:x=w-text_w-45:y=h-text_h-45" \
  -an -r 30 -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p output/gameplay-vertical.mp4

ffmpeg -y -f lavfi -i color=c=0x071426:s=1080x1920:d=3.4:r=30 \
  -vf "drawtext=fontfile=${FONT_BOLD}:text='GamexlabTR':fontcolor=white:fontsize=88:x=(w-text_w)/2:y=455,\
drawtext=fontfile=${FONT_BOLD}:text='gamexlabtr.com':fontcolor=0x6EA8FF:fontsize=54:x=(w-text_w)/2:y=625,\
drawtext=fontfile=${FONT_REGULAR}:text='Beğenmeyi ve takip etmeyi unutmayın!':fontcolor=white:fontsize=35:x=(w-text_w)/2:y=820,\
drawtext=fontfile=${FONT_REGULAR}:text='Do not forget to like and follow!':fontcolor=white:fontsize=35:x=(w-text_w)/2:y=900" \
  -an -c:v libx264 -pix_fmt yuv420p -r 30 output/outro.mp4

printf "file '%s'\nfile '%s'\nfile '%s'\n" \
  "$(pwd)/output/intro.mp4" "$(pwd)/output/gameplay-vertical.mp4" "$(pwd)/output/outro.mp4" > output/concat.txt

ffmpeg -y -f concat -safe 0 -i output/concat.txt \
  -c:v libx264 -preset veryfast -crf 22 -pix_fmt yuv420p -movflags +faststart output/gamexlabtr-final.mp4

# Derive the cover from CLEAN gameplay rather than from an ad screen.
ffmpeg -y -ss 2 -i output/gameplay-vertical.mp4 -frames:v 1 output/cover.png
