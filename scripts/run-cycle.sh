#!/usr/bin/env bash
set -uo pipefail
mkdir -p output

MAX_CANDIDATES="${MAX_CANDIDATES_PER_RUN:-10}"
MAX_ATTEMPTS="${MAX_ATTEMPTS_PER_GAME:-2}"
if [[ -n "${INPUT_GAME_URL:-}" ]]; then MAX_CANDIDATES=1; fi
success=0
processed=0

cleanup_attempt() {
  rm -f output/gameplay.webm output/gameplay-vertical.mp4 \
        output/gamexlabtr-final.mp4 output/cover.png output/metadata.json \
        output/social.json output/quality.json output/capture-error.txt \
        output/intro.mp4 output/outro.mp4 output/concat.txt
}

for ((i=1; i<=MAX_CANDIDATES; i++)); do
  echo "===== Video candidate ${i}/${MAX_CANDIDATES} ====="
  rm -f output/selection.json
  cleanup_attempt

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
  candidate_success=0
  last_error="capture_failed"
  used_attempts=0

  for ((attempt=1; attempt<=MAX_ATTEMPTS; attempt++)); do
    used_attempts=$attempt
    echo "----- ${GAME_TITLE:-unknown}: attempt ${attempt}/${MAX_ATTEMPTS} -----"
    cleanup_attempt

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
      echo "Candidate succeeded on attempt ${attempt}/${MAX_ATTEMPTS}: ${GAME_TITLE:-unknown}"
      VIDEO_RESULT=complete LOCAL_ATTEMPTS="$used_attempts" npm run report || true
      candidate_success=1
      success=1
      break
    fi

    last_error="$error"
    echo "Attempt ${attempt}/${MAX_ATTEMPTS} failed (${error}): ${GAME_TITLE:-unknown}"

    if [[ "$attempt" -lt "$MAX_ATTEMPTS" ]]; then
      echo "Resetting capture state before retry..."
      sleep 3
    fi
  done

  if [[ "$candidate_success" -eq 1 ]]; then
    break
  fi

  echo "Candidate exhausted ${used_attempts}/${MAX_ATTEMPTS} attempts (${last_error}): ${GAME_TITLE:-unknown}"
  VIDEO_RESULT=fail VIDEO_ERROR="$last_error" LOCAL_ATTEMPTS="$used_attempts" npm run report || true

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

echo "No candidate produced a valid video after ${processed} candidate(s), up to ${MAX_ATTEMPTS} attempt(s) each."
exit 1
