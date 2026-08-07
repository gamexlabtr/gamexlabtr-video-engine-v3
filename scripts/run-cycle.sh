#!/usr/bin/env bash
set -uo pipefail
mkdir -p output

MAX_CANDIDATES="${MAX_CANDIDATES_PER_RUN:-3}"
if [[ -n "${INPUT_GAME_URL:-}" ]]; then MAX_CANDIDATES=1; fi
success=0
processed=0

for ((i=1; i<=MAX_CANDIDATES; i++)); do
  echo "===== Video candidate ${i}/${MAX_CANDIDATES} ====="
  rm -f output/selection.json output/gameplay.webm output/gameplay-vertical.mp4 \
        output/gamexlabtr-final.mp4 output/cover.png output/metadata.json \
        output/social.json output/capture-error.txt output/intro.mp4 output/outro.mp4 output/concat.txt

  if ! npm run select; then
    echo "Game selection failed."
    exit 1
  fi

  if node -e "const d=require('./output/selection.json'); process.exit(d.empty?0:1)"; then
    echo "Video queue is empty. Nothing to do."
    exit 0
  fi

  eval "$(node src/selection-shell.js)"
  export RECORD_SECONDS="${RECORD_SECONDS:-30}"
  processed=$((processed+1))

  error=""
  if ! npm run capture; then
    error="capture_failed"
  elif ! npm run render; then
    error="render_failed"
  elif ! npm run validate; then
    error="blank_or_invalid_video"
  elif ! npm run social; then
    error="social_package_failed"
  fi

  if [[ -z "$error" ]]; then
    echo "Candidate succeeded: ${GAME_TITLE:-unknown}"
    VIDEO_RESULT=complete npm run report || true
    success=1
    break
  fi

  echo "Candidate failed (${error}): ${GAME_TITLE:-unknown}"
  VIDEO_RESULT=fail VIDEO_ERROR="$error" npm run report || true

  if [[ -n "${INPUT_GAME_URL:-}" ]]; then
    break
  fi

done

if [[ "$success" -eq 1 ]]; then
  exit 0
fi
if [[ "$processed" -eq 0 ]]; then
  exit 0
fi

echo "No candidate produced a valid video in this run."
exit 1
