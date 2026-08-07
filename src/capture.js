const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const GAME_URL = (process.env.GAME_URL || '').trim();
const GAME_EMBED_URL = (process.env.GAME_EMBED_URL || '').trim();
const GAME_TITLE = process.env.GAME_TITLE || 'New Game';
const GAME_CATEGORY = process.env.GAME_CATEGORY || 'Games';
const GAME_PROVIDER = (process.env.GAME_PROVIDER || 'other').toLowerCase();
const rawSeconds = Number(process.env.RECORD_SECONDS || 30);
const RECORD_SECONDS = Math.max(8, Math.min(60, Number.isFinite(rawSeconds) ? rawSeconds : 30));

if (!GAME_URL && !GAME_EMBED_URL) {
  console.error('GAME_URL or GAME_EMBED_URL is required.');
  process.exit(1);
}

const outputDir = path.resolve('output');
const rawDir = path.join(outputDir, 'raw');
fs.mkdirSync(rawDir, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const PROVIDER_HINTS = [
  'gamemonetize', 'gamepix', 'playgama', 'gamedistribution', 'html5games',
  'crazygames', 'y8', 'construct', 'itch.io', 'cloudfront', 'cdn'
];

function isHttpUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:' || u.protocol === 'http:'; } catch { return false; }
}

function providerScore(url) {
  const value = String(url || '').toLowerCase();
  let score = 0;
  if (GAME_PROVIDER && value.includes(GAME_PROVIDER)) score += 100;
  for (const hint of PROVIDER_HINTS) if (value.includes(hint)) score += 10;
  if (/embed|game|play|html5|index\.html/.test(value)) score += 4;
  return score;
}

async function clickFirstVisible(scope, selectors) {
  for (const selector of selectors) {
    try {
      const el = scope.locator(selector).first();
      if (await el.isVisible({ timeout: 1200 })) {
        await el.click({ force: true, timeout: 5000 });
        await sleep(900);
        return selector;
      }
    } catch (_) {}
  }
  return null;
}

const START_SELECTORS = [
  'button:has-text("Play")', 'button:has-text("PLAY")', 'button:has-text("Oyna")',
  'button:has-text("Start")', 'button:has-text("START")', '[aria-label*="play" i]',
  '[class*="play" i]', '[id*="play" i]', 'canvas'
];

async function dismissOverlays(page) {
  await clickFirstVisible(page, [
    '#onetrust-accept-btn-handler', 'button:has-text("Accept All")', 'button:has-text("Accept")',
    'button:has-text("Tümünü Kabul Et")', 'button:has-text("Kabul Et")', 'button:has-text("I Agree")',
    '[aria-label="Close"]', '[aria-label="Kapat"]', '[class*="close" i]'
  ]);
}

async function discoverEmbedUrl(page) {
  const candidates = [];
  try {
    const srcs = await page.locator('iframe').evaluateAll(nodes => nodes.map(n => n.src || n.getAttribute('src') || '').filter(Boolean));
    candidates.push(...srcs);
  } catch (_) {}
  for (const frame of page.frames()) {
    const url = frame.url();
    if (url && url !== page.url() && isHttpUrl(url)) candidates.push(url);
  }
  const unique = [...new Set(candidates.filter(isHttpUrl))];
  unique.sort((a, b) => providerScore(b) - providerScore(a));
  return unique[0] || '';
}

async function looksPlayable(page) {
  try {
    const state = await page.evaluate(() => {
      const canvas = [...document.querySelectorAll('canvas')].some(el => el.offsetWidth > 120 && el.offsetHeight > 120);
      const video = [...document.querySelectorAll('video')].some(el => el.offsetWidth > 120 && el.offsetHeight > 120);
      const iframe = [...document.querySelectorAll('iframe')].some(el => el.offsetWidth > 200 && el.offsetHeight > 200);
      const body = document.body;
      return { canvas, video, iframe, text: (body?.innerText || '').trim().slice(0, 300), children: body?.children.length || 0 };
    });
    return state.canvas || state.video || state.iframe || state.children > 2;
  } catch { return true; }
}

async function startAcrossFrames(page) {
  const scopes = [page, ...page.frames().filter(f => f !== page.mainFrame())];
  for (const scope of scopes) {
    const hit = await clickFirstVisible(scope, START_SELECTORS);
    if (hit) return hit;
  }
  return null;
}

async function focusGameSurface(page) {
  try {
    const canvas = page.locator('canvas').first();
    if (await canvas.isVisible({ timeout: 1000 })) {
      await canvas.scrollIntoViewIfNeeded();
      const box = await canvas.boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        return box;
      }
    }
  } catch (_) {}
  try {
    const iframe = page.locator('iframe').first();
    if (await iframe.isVisible({ timeout: 1000 })) {
      await iframe.scrollIntoViewIfNeeded();
      const box = await iframe.boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        return box;
      }
    }
  } catch (_) {}
  return { x: 0, y: 0, width: 720, height: 1280 };
}

async function genericGameplay(page, durationMs, surface) {
  const end = Date.now() + durationMs;
  const keys = ['ArrowRight', 'ArrowUp', 'Space', 'ArrowLeft', 'ArrowDown', 'KeyD', 'KeyW', 'KeyA'];
  let i = 0;
  while (Date.now() < end) {
    const key = keys[i % keys.length];
    try {
      await page.keyboard.down(key); await sleep(260); await page.keyboard.up(key);
      const x = Math.max(10, surface.x + 40 + Math.random() * Math.max(80, surface.width - 80));
      const y = Math.max(10, surface.y + 40 + Math.random() * Math.max(80, surface.height - 80));
      await page.mouse.move(x, y, { steps: 4 });
      await page.mouse.click(x, y);
    } catch (_) {}
    i += 1;
    await sleep(420);
  }
}

async function safeCover(page) {
  try {
    await page.screenshot({ path: path.join(outputDir, 'cover.png'), fullPage: false, animations: 'disabled', timeout: 30000 });
  } catch (error) {
    console.warn(`Cover screenshot failed; video will continue: ${error.message}`);
  }
}

async function navigateWithFallback(page) {
  // Prefer the provider/embed URL returned by WordPress. If a provider blocks
  // top-level playback, automatically fall back to the GamexlabTR page and
  // rediscover its live iframe URL.
  if (GAME_EMBED_URL) {
    console.log(`Opening provider/embed target: ${GAME_EMBED_URL}`);
    try {
      await page.goto(GAME_EMBED_URL, {
        waitUntil: 'domcontentloaded', timeout: 90000,
        referer: GAME_URL || 'https://gamexlabtr.com/'
      });
      await sleep(8000);
      await dismissOverlays(page);
      if (await looksPlayable(page)) return page.url();
      console.warn('Direct embed did not expose a playable surface; trying the GamexlabTR page.');
    } catch (error) {
      console.warn(`Direct embed failed; trying the GamexlabTR page: ${error.message}`);
    }
  }

  if (!GAME_URL) return page.url();
  console.log(`Opening GamexlabTR page: ${GAME_URL}`);
  await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(7000);
  await dismissOverlays(page);

  const discovered = await discoverEmbedUrl(page);
  if (discovered && discovered !== page.url()) {
    console.log(`Discovered live iframe/provider URL: ${discovered}`);
    try {
      await page.goto(discovered, { waitUntil: 'domcontentloaded', timeout: 90000, referer: GAME_URL });
      await sleep(8000);
      await dismissOverlays(page);
      return page.url();
    } catch (error) {
      console.warn(`Live iframe navigation failed; recording the embedded GamexlabTR page instead: ${error.message}`);
      await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
      await sleep(6000);
      await dismissOverlays(page);
    }
  }
  return page.url();
}

(async () => {
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--autoplay-policy=no-user-gesture-required']
    });
    const context = await browser.newContext({
      viewport: { width: 720, height: 1280 },
      recordVideo: { dir: rawDir, size: { width: 720, height: 1280 } },
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/136 Safari/537.36 GamexlabTRVideo/3.0'
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(90000);

    const finalTarget = await navigateWithFallback(page);
    console.log(`Capture target ready: ${finalTarget}`);
    if (!(await looksPlayable(page))) console.warn('Playable surface was not confidently detected; continuing with interaction fallback.');

    const startSelector = await startAcrossFrames(page);
    console.log(startSelector ? `Start interaction: ${startSelector}` : 'No explicit Play/Start control found; continuing.');
    await sleep(2500);
    const surface = await focusGameSurface(page);
    console.log(`Recording ${RECORD_SECONDS}s gameplay...`);
    await genericGameplay(page, RECORD_SECONDS * 1000, surface);
    await safeCover(page);

    const video = page.video();
    await context.close();
    if (!video) throw new Error('Playwright did not create a video object.');
    const rawVideoPath = await video.path();
    if (!fs.existsSync(rawVideoPath)) throw new Error(`Recorded video not found: ${rawVideoPath}`);
    fs.copyFileSync(rawVideoPath, path.join(outputDir, 'gameplay.webm'));

    fs.writeFileSync(path.join(outputDir, 'metadata.json'), JSON.stringify({
      postId: process.env.GAME_POST_ID || null,
      queueId: process.env.GAME_QUEUE_ID || null,
      gameUrl: GAME_URL,
      embedUrl: GAME_EMBED_URL,
      captureTarget: finalTarget,
      gameTitle: GAME_TITLE,
      category: GAME_CATEGORY,
      provider: GAME_PROVIDER,
      recordSeconds: RECORD_SECONDS,
      createdAt: new Date().toISOString()
    }, null, 2));
    console.log('Capture completed successfully.');
  } catch (error) {
    fs.writeFileSync(path.join(outputDir, 'capture-error.txt'), String(error && error.stack ? error.stack : error));
    console.error('Capture failed:', error);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
})();
