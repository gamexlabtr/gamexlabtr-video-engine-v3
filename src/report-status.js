const fs = require('fs');
const path = require('path');

(async () => {
  const queueId = (process.env.GAME_QUEUE_ID || '').trim();
  const lockToken = (process.env.GAME_LOCK_TOKEN || '').trim();
  if (!queueId || !lockToken) {
    console.log('Manual run/no queue lock: WordPress status report skipped.');
    return;
  }

  const base = (process.env.GXL_SITE_URL || '').replace(/\/$/, '');
  const token = process.env.GXL_VIDEO_API_TOKEN || '';
  if (!base || !token) throw new Error('GXL_SITE_URL/GXL_VIDEO_API_TOKEN are required for status reporting.');

  const result = (process.env.VIDEO_RESULT || 'fail').toLowerCase() === 'complete' ? 'complete' : 'fail';
  let error = '';
  if (result === 'fail') {
    const errorPath = path.resolve('output/capture-error.txt');
    if (fs.existsSync(errorPath)) error = fs.readFileSync(errorPath, 'utf8').slice(0, 1500);
    if (!error) error = process.env.VIDEO_ERROR || 'GitHub Actions video job failed.';
  }

  const response = await fetch(`${base}/wp-json/gamexlabtr/v1/video/${result}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-GXL-Video-Token': token,
      'User-Agent': 'GamexlabTR-Video-Engine/3.0',
    },
    body: JSON.stringify({ queue_id: Number(queueId), lock_token: lockToken, error }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Status API ${response.status}: ${text.slice(0, 500)}`);
  console.log(`WordPress queue marked ${result}.`);
})();
