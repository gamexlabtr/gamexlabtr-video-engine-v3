const fs = require('fs');
const path = require('path');

(async () => {
  const webhook = (process.env.MAKE_WEBHOOK || '').trim();
  if (!webhook) {
    console.log('MAKE_WEBHOOK is empty; notification skipped.');
    return;
  }
  const socialPath = path.resolve('output/social.json');
  const social = fs.existsSync(socialPath) ? JSON.parse(fs.readFileSync(socialPath, 'utf8')) : {};
  const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : '';
  const artifactName = `gamexlabtr-video-${process.env.GAME_POST_ID || process.env.GITHUB_RUN_NUMBER || 'result'}`;
  const payload = {
    event: 'gamexlabtr_video_ready',
    ...social,
    artifactName,
    githubRunUrl: runUrl,
    repository: process.env.GITHUB_REPOSITORY || '',
    runId: process.env.GITHUB_RUN_ID || '',
    runNumber: process.env.GITHUB_RUN_NUMBER || ''
  };
  const response = await fetch(webhook, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'GamexlabTR-Video-Engine/3.1' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(`Make webhook ${response.status}: ${(await response.text()).slice(0, 500)}`);
  console.log(`Make webhook notified: ${response.status}`);
})();
