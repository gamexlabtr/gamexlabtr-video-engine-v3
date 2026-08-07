const fs = require('fs');
const path = require('path');

const outputDir = path.resolve('output');
fs.mkdirSync(outputDir, { recursive: true });

function writeEnv(name, value) {
  const file = process.env.GITHUB_ENV;
  if (!file) return;
  const delimiter = `GXL_${name}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  fs.appendFileSync(file, `${name}<<${delimiter}\n${String(value ?? '')}\n${delimiter}\n`);
}

function exportSelection(data) {
  const env = {
    GAME_URL: data.page_url || data.game_url || '',
    GAME_EMBED_URL: data.embed_url || '',
    GAME_TITLE: data.title || data.game_title || 'New Game',
    GAME_CATEGORY: data.category || 'Games',
    GAME_PROVIDER: data.provider || 'other',
    GAME_POST_ID: data.post_id || '',
    GAME_QUEUE_ID: data.queue_id || '',
    GAME_LOCK_TOKEN: data.lock_token || '',
    GAME_IMAGE_URL: data.image_url || '',
  };
  for (const [k, v] of Object.entries(env)) writeEnv(k, v);
  fs.writeFileSync(path.join(outputDir, 'selection.json'), JSON.stringify({ ...data, resolvedEnv: env }, null, 2));
}

(async () => {
  const manualUrl = (process.env.INPUT_GAME_URL || '').trim();
  if (manualUrl) {
    exportSelection({
      page_url: manualUrl,
      embed_url: (process.env.INPUT_GAME_EMBED_URL || '').trim(),
      title: (process.env.INPUT_GAME_TITLE || '').trim() || 'New Game',
      category: (process.env.INPUT_GAME_CATEGORY || '').trim() || 'Games',
      provider: (process.env.INPUT_GAME_PROVIDER || '').trim() || 'other',
      manual: true,
    });
    writeEnv('GXL_NO_GAME', '0');
    console.log(`Manual game selected: ${manualUrl}`);
    return;
  }

  const base = (process.env.GXL_SITE_URL || '').replace(/\/$/, '');
  const token = process.env.GXL_VIDEO_API_TOKEN || '';
  if (!base || !token) {
    throw new Error('Auto mode requires repository secrets GXL_SITE_URL and GXL_VIDEO_API_TOKEN.');
  }

  const endpoint = `${base}/wp-json/gamexlabtr/v1/video/next`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-GXL-Video-Token': token,
      'User-Agent': 'GamexlabTR-Video-Engine/3.0',
    },
    body: JSON.stringify({ mode: process.env.AUTO_SELECTION_MODE || 'newest' }),
  });

  if (response.status === 204) {
    writeEnv('GXL_NO_GAME', '1');
    fs.writeFileSync(path.join(outputDir, 'selection.json'), JSON.stringify({ empty: true }, null, 2));
    console.log('Video queue is empty. Nothing to process.');
    return;
  }

  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`Video API returned invalid JSON (${response.status}): ${text.slice(0, 500)}`); }
  if (!response.ok) throw new Error(`Video API ${response.status}: ${data.message || text}`);
  if (!data.page_url && !data.embed_url) throw new Error('Video API did not return a playable URL.');

  exportSelection(data);
  writeEnv('GXL_NO_GAME', '0');
  console.log(`Auto-selected #${data.post_id}: ${data.title} (${data.provider})`);
})();
