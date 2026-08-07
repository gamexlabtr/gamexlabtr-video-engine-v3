'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { appendAnalytics } = require('./analytics-log');

const file = path.resolve('output/gameplay-clean.mp4');
const metricsPath = path.resolve('output/quality.json');

function fail(reason, metrics = {}) {
  const payload = { engineVersion: '5.0.0', pass: false, reason, ...metrics };
  fs.writeFileSync(metricsPath, JSON.stringify(payload, null, 2));
  appendAnalytics({ event: 'quality_check', result: 'FAIL', reason, ...metrics });
  console.error(`Video rejected: ${reason}`);
  process.exit(1);
}

if (!fs.existsSync(file)) fail('gameplay-clean.mp4 not found');

const probe = spawnSync('ffprobe', ['-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',file], { encoding:'utf8' });
const duration = Number((probe.stdout || '').trim());
if (!Number.isFinite(duration) || duration < 6) fail('clean gameplay duration is too short', { duration });

// 2 frames/sec gives enough temporal samples while keeping CI lightweight.
const args = ['-v','error','-i',file,'-vf','fps=2,scale=80:80','-frames:v','80','-f','rawvideo','-pix_fmt','rgb24','pipe:1'];
const out = spawnSync('ffmpeg', args, { encoding:null, maxBuffer:80*80*3*100 });
if (out.status !== 0 || !out.stdout || out.stdout.length < 80*80*3*3) {
  fail('FFmpeg could not decode enough clean gameplay frames', { duration, stderr: out.stderr ? out.stderr.toString().slice(0,500) : '' });
}

const W=80,H=80,frameBytes=W*H*3;
const frames=Math.floor(out.stdout.length/frameBytes);
let blank=0, nonBlank=0, colorful=0;
let temporalDiffSum=0, temporalPairs=0, highMotionPairs=0;
let prev=null;
let luminanceMeans=[];

for(let f=0;f<frames;f++){
  const start=f*frameBytes;
  let lumSum=0, lum2=0, satSum=0;
  const gray = new Uint8Array(W*H);
  let px=0;
  for(let i=start;i<start+frameBytes;i+=3){
    const r=out.stdout[i], g=out.stdout[i+1], b=out.stdout[i+2];
    const y=.2126*r+.7152*g+.0722*b;
    gray[px++]=Math.round(y);
    lumSum+=y; lum2+=y*y;
    const max=Math.max(r,g,b), min=Math.min(r,g,b);
    satSum += max===0 ? 0 : (max-min)/max;
  }
  const n=W*H, mean=lumSum/n, sd=Math.sqrt(Math.max(0,lum2/n-mean*mean)), sat=satSum/n;
  luminanceMeans.push(mean);
  const isBlank=(mean>246&&sd<7)||(mean<9&&sd<5);
  if(isBlank) blank++; else nonBlank++;
  if(sat>0.08) colorful++;

  if(prev){
    let diff=0;
    for(let i=0;i<gray.length;i++) diff += Math.abs(gray[i]-prev[i]);
    diff/=gray.length;
    temporalDiffSum += diff; temporalPairs++;
    if(diff>3.0) highMotionPairs++;
  }
  prev=gray;
}

const blankRatio=blank/frames;
const avgTemporalDiff=temporalPairs?temporalDiffSum/temporalPairs:0;
const motionPairRatio=temporalPairs?highMotionPairs/temporalPairs:0;
const colorfulRatio=colorful/frames;
const lumMin=Math.min(...luminanceMeans), lumMax=Math.max(...luminanceMeans);
const lumRange=lumMax-lumMin;

const metrics={ duration, frames, blankRatio, avgTemporalDiff, motionPairRatio, colorfulRatio, lumRange };
console.log(`v5 quality: duration=${duration.toFixed(1)}s frames=${frames} blank=${blankRatio.toFixed(2)} avgDiff=${avgTemporalDiff.toFixed(2)} motion=${motionPairRatio.toFixed(2)} color=${colorfulRatio.toFixed(2)} lumRange=${lumRange.toFixed(1)}`);

if(frames < 6) fail('too few sampled frames', metrics);
if(blankRatio >= 0.45) fail('too much blank/black/white content', metrics);
if(nonBlank === 0) fail('no non-blank gameplay frames', metrics);
// Static START/loading pages typically have almost no temporal change.
if(avgTemporalDiff < 0.8 && motionPairRatio < 0.10) fail('gameplay appears static or stuck on a start/loading screen', metrics);
// Very low color + low movement is commonly a loader/error page.
if(colorfulRatio < 0.08 && avgTemporalDiff < 1.5 && lumRange < 16) fail('gameplay resembles a static loader/error surface', metrics);

const payload={ engineVersion:'5.0.0', pass:true, reason:'quality checks passed', ...metrics };
fs.writeFileSync(metricsPath, JSON.stringify(payload, null, 2));
appendAnalytics({ event:'quality_check', result:'PASS', ...metrics });
console.log('v5 quality validation passed.');
