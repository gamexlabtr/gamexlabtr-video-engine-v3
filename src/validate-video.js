const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const file = path.resolve('output/gameplay.webm');
if (!fs.existsSync(file)) {
  console.error('Video validation failed: gameplay.webm not found.');
  process.exit(1);
}

let trimStart = 0;
try {
  const metadata = JSON.parse(fs.readFileSync(path.resolve('output/metadata.json'), 'utf8'));
  const n = Number(metadata.gameplayStartOffsetSeconds || 0);
  if (Number.isFinite(n) && n > 0) trimStart = n;
} catch (_) {}

// Validate the CLEAN gameplay window, not the provider-ad/loading section.
const args = [
  '-v', 'error',
  '-ss', String(trimStart),
  '-i', file,
  '-vf', 'fps=1/4,scale=64:64',
  '-frames:v', '12', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'
];
const out = spawnSync('ffmpeg', args, { encoding: null, maxBuffer: 16 * 1024 * 1024 });
if (out.status !== 0 || !out.stdout || out.stdout.length < 64 * 64 * 3) {
  console.error('Video validation failed: FFmpeg could not decode clean gameplay sample frames.');
  if (out.stderr) console.error(out.stderr.toString().slice(0, 1000));
  process.exit(1);
}

const frameBytes = 64 * 64 * 3;
const frames = Math.floor(out.stdout.length / frameBytes);
let blankFrames = 0;
let dynamicFrames = 0;
let previousMean = null;
let meanMovement = 0;

for (let f = 0; f < frames; f++) {
  const start = f * frameBytes;
  let sum = 0, sum2 = 0;
  for (let i = start; i < start + frameBytes; i += 3) {
    const r = out.stdout[i], g = out.stdout[i + 1], b = out.stdout[i + 2];
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sum += y; sum2 += y * y;
  }
  const n = 64 * 64;
  const mean = sum / n;
  const variance = Math.max(0, sum2 / n - mean * mean);
  const sd = Math.sqrt(variance);
  const blank = (mean > 244 && sd < 9) || (mean < 11 && sd < 6);
  if (blank) blankFrames++;
  else dynamicFrames++;
  if (previousMean !== null) meanMovement += Math.abs(mean - previousMean);
  previousMean = mean;
}

const blankRatio = blankFrames / frames;
console.log(`Clean gameplay validation: start=${trimStart.toFixed(2)}s frames=${frames}, blank=${blankFrames}, blankRatio=${blankRatio.toFixed(2)}, movement=${meanMovement.toFixed(1)}`);
if (frames >= 3 && blankRatio >= 0.75) {
  console.error('Video rejected: clean gameplay window is mostly blank/white/black.');
  process.exit(1);
}
if (dynamicFrames === 0) {
  console.error('Video rejected: no usable visual frame detected after ad trim.');
  process.exit(1);
}
console.log('Clean gameplay validation passed.');
