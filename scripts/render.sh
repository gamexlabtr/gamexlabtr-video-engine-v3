#!/usr/bin/env bash
set -euo pipefail
mkdir -p output output/segments
TITLE="${GAME_TITLE:-New Game}"
DURATION="${RECORD_SECONDS:-30}"
FONT_BOLD="/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_REGULAR="/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
[[ -f output/gameplay.webm ]] || { echo "output/gameplay.webm bulunamadi."; exit 1; }
[[ -s output/metadata.json ]] || { echo "output/metadata.json bulunamadi."; exit 1; }
rm -f output/segments/*.mp4 output/segments.txt output/gameplay-clean.mp4 output/gameplay-vertical.mp4

SAFE_TITLE="${TITLE//\\/\\\\}"
SAFE_TITLE="${SAFE_TITLE//:/\\:}"
SAFE_TITLE="${SAFE_TITLE//\'/\\\'}"

# Extract only verified-clean gameplay segments. Any provider ad/redirect period
# that capture.js marked dirty is excluded from the final gameplay file.
node - <<'NODE' > output/segments.tsv
const fs=require('fs');
const d=JSON.parse(fs.readFileSync('output/metadata.json','utf8'));
const segs=Array.isArray(d.cleanSegments)?d.cleanSegments:[];
for (const s of segs) {
  const start=Number(s.start), duration=Number(s.duration);
  if (Number.isFinite(start)&&Number.isFinite(duration)&&duration>=0.6) console.log(`${start}\t${duration}`);
}
NODE

idx=0
while IFS=$'\t' read -r start dur; do
  [[ -z "${start:-}" || -z "${dur:-}" ]] && continue
  idx=$((idx+1))
  out="output/segments/seg-$(printf '%03d' "$idx").mp4"
  echo "Extracting clean segment #$idx: +${start}s for ${dur}s"
  ffmpeg -y -ss "$start" -i output/gameplay.webm -t "$dur" \
    -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920" \
    -an -r 30 -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p "$out"
  printf "file '%s'\n" "$(pwd)/$out" >> output/segments.txt
done < output/segments.tsv

[[ "$idx" -gt 0 ]] || { echo "No verified clean gameplay segments."; exit 1; }
ffmpeg -y -f concat -safe 0 -i output/segments.txt -t "$DURATION" \
  -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -an output/gameplay-clean.mp4

CLEAN_DURATION="$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 output/gameplay-clean.mp4 | head -n1)"
echo "Clean gameplay duration: ${CLEAN_DURATION}s"
node -e "const d=Number(process.argv[1]); const need=Number(process.argv[2]); if(!Number.isFinite(d)||d<Math.max(6,need*0.65)) process.exit(1)" "$CLEAN_DURATION" "$DURATION" || {
  echo "Clean gameplay is too short."; exit 1;
}

ffmpeg -y -i output/gameplay-clean.mp4 -t "$DURATION" \
  -vf "drawbox=x=0:y=0:w=iw:h=170:color=black@0.50:t=fill,\
drawtext=fontfile=${FONT_BOLD}:text='${SAFE_TITLE}':fontcolor=white:fontsize=48:x=50:y=55,\
drawtext=fontfile=${FONT_BOLD}:text='GamexlabTR':fontcolor=white@0.72:fontsize=34:x=w-text_w-45:y=h-text_h-45" \
  -an -r 30 -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p output/gameplay-vertical.mp4

ffmpeg -y -f lavfi -i color=c=0x071426:s=1080x1920:d=1.3:r=30 \
  -vf "drawtext=fontfile=${FONT_BOLD}:text='GamexlabTR':fontcolor=white:fontsize=92:x=(w-text_w)/2:y=735,\
drawtext=fontfile=${FONT_REGULAR}:text='YENİ OYUN / NEW GAME':fontcolor=0x6EA8FF:fontsize=44:x=(w-text_w)/2:y=875" \
  -an -c:v libx264 -pix_fmt yuv420p -r 30 output/intro.mp4

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
ffmpeg -y -ss 2 -i output/gameplay-clean.mp4 -frames:v 1 output/cover.png
