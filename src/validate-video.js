const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const file = path.resolve('output/gameplay-clean.mp4');
if (!fs.existsSync(file)) {
  console.error('Video validation failed: gameplay-clean.mp4 not found.');
  process.exit(1);
}
const args = ['-v','error','-i',file,'-vf','fps=1/3,scale=64:64','-frames:v','14','-f','rawvideo','-pix_fmt','rgb24','pipe:1'];
const out = spawnSync('ffmpeg', args, { encoding:null, maxBuffer:20*1024*1024 });
if (out.status !== 0 || !out.stdout || out.stdout.length < 64*64*3) {
  console.error('Validation failed: FFmpeg could not decode clean gameplay.');
  if (out.stderr) console.error(out.stderr.toString().slice(0,1200));
  process.exit(1);
}
const frameBytes=64*64*3;
const frames=Math.floor(out.stdout.length/frameBytes);
let blank=0, nonBlank=0, movement=0, prev=null;
for(let f=0;f<frames;f++){
  const start=f*frameBytes; let sum=0,sum2=0;
  for(let i=start;i<start+frameBytes;i+=3){
    const r=out.stdout[i],g=out.stdout[i+1],b=out.stdout[i+2];
    const y=.2126*r+.7152*g+.0722*b; sum+=y; sum2+=y*y;
  }
  const n=64*64, mean=sum/n, sd=Math.sqrt(Math.max(0,sum2/n-mean*mean));
  const isBlank=(mean>244&&sd<9)||(mean<11&&sd<6);
  if(isBlank) blank++; else nonBlank++;
  if(prev!==null) movement+=Math.abs(mean-prev);
  prev=mean;
}
const ratio=blank/frames;
console.log(`v4 clean validation: frames=${frames} blankRatio=${ratio.toFixed(2)} movement=${movement.toFixed(1)}`);
if(frames<3 || ratio>=0.70 || nonBlank===0){ console.error('Video rejected: clean gameplay is blank/static.'); process.exit(1); }
console.log('v4 clean gameplay validation passed.');
