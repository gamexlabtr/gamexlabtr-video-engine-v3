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


function hostOf(value) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}

function baseDomain(host) {
  const parts = String(host || '').split('.').filter(Boolean);
  return parts.length >= 2 ? parts.slice(-2).join('.') : String(host || '');
}

function isTrustedGameUrl(value) {
  if (!isHttpUrl(value)) return false;
  const host = hostOf(value);
  if (!host) return false;

  const knownHosts = [hostOf(GAME_EMBED_URL), hostOf(GAME_URL)].filter(Boolean);
  for (const known of knownHosts) {
    if (host === known || host.endsWith(`.${known}`) || known.endsWith(`.${host}`)) return true;
    const a = baseDomain(host), b = baseDomain(known);
    if (a && b && a === b) return true;
  }

  const lower = String(value).toLowerCase();
  return PROVIDER_HINTS.some(hint => lower.includes(hint));
}

async function closeUnexpectedPages(context, keepPage) {
  for (const p of context.pages()) {
    if (p === keepPage) continue;
    try {
      console.log(`Closing popup/new tab: ${p.url() || 'about:blank'}`);
      await p.close({ runBeforeUnload: false });
    } catch (_) {}
  }
}

async function recoverTrustedTarget(page, targetUrl) {
  const current = page.url();
  if (current === 'about:blank' || isTrustedGameUrl(current)) return true;

  console.warn(`Unexpected redirect blocked/recovered: ${current}`);
  try {
    await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 90000,
      referer: GAME_URL || 'https://gamexlabtr.com/'
    });
    await sleep(4500);
    return true;
  } catch (error) {
    console.warn(`Could not recover game target: ${error.message}`);
    return false;
  }
}

const SAFE_AD_DISMISS_SELECTORS = [
  'button:has-text("Skip Ad")',
  'button:has-text("Skip")',
  'button:has-text("Close Ad")',
  'button:has-text("Continue to game")',
  'button:has-text("Continue")',
  '[aria-label="Skip Ad"]',
  '[aria-label="Skip"]',
  '[aria-label="Close Ad"]',
  '[aria-label="Close advertisement"]'
];

async function dismissSafeAdControls(page) {
  const scopes = [page, ...page.frames().filter(f => f !== page.mainFrame())];
  for (const scope of scopes) {
    for (const selector of SAFE_AD_DISMISS_SELECTORS) {
      try {
        const el = scope.locator(selector).first();
        if (await el.isVisible({ timeout: 350 })) {
          console.log(`Using safe ad control: ${selector}`);
          await el.click({ force: true, timeout: 2500 });
          await sleep(1200);
          return true;
        }
      } catch (_) {}
    }
  }
  return false;
}

async function visibleAdSignal(page) {
  const scopes = [page, ...page.frames().filter(f => f !== page.mainFrame())];
  for (const scope of scopes) {
    try {
      const text = (await scope.locator('body').innerText({ timeout: 500 })).slice(0, 2500).toLowerCase();
      if (/advertisement|skip ad|ad will close|sponsored|rewarded ad|your ad will end|reklam/.test(text)) return true;
    } catch (_) {}
  }
  return false;
}

async function bestGameSurface(page) {
  const candidates = [];
  const scopes = [page, ...page.frames().filter(f => f !== page.mainFrame())];

  for (const scope of scopes) {
    try {
      const canvases = scope.locator('canvas');
      const count = Math.min(await canvases.count(), 4);
      for (let i = 0; i < count; i++) {
        const el = canvases.nth(i);
        if (!(await el.isVisible({ timeout: 250 }).catch(() => false))) continue;
        const box = await el.boundingBox().catch(() => null);
        if (!box || box.width < 120 || box.height < 120) continue;
        candidates.push({ box, score: 500 + box.width * box.height / 10000, type: 'canvas' });
      }
    } catch (_) {}
  }

  try {
    const iframes = page.locator('iframe');
    const count = Math.min(await iframes.count(), 12);
    for (let i = 0; i < count; i++) {
      const el = iframes.nth(i);
      if (!(await el.isVisible({ timeout: 250 }).catch(() => false))) continue;
      const box = await el.boundingBox().catch(() => null);
      if (!box || box.width < 180 || box.height < 180) continue;
      const src = await el.getAttribute('src').catch(() => '') || '';
      const score = providerScore(src) * 20 + box.width * box.height / 10000;
      candidates.push({ box, score, type: 'iframe', src });
    }
  } catch (_) {}

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] || null;
}

async function waitForGameplayReady(context, page, captureTarget) {
  const deadline = Date.now() + 45000;
  let stableSince = 0;
  let lastSurface = null;

  while (Date.now() < deadline) {
    await closeUnexpectedPages(context, page);
    await recoverTrustedTarget(page, captureTarget);
    await dismissSafeAdControls(page);

    const adVisible = await visibleAdSignal(page);
    const surface = await bestGameSurface(page);

    if (!adVisible && surface && isTrustedGameUrl(page.url())) {
      if (!stableSince) stableSince = Date.now();
      lastSurface = surface;
      if (Date.now() - stableSince >= 3500) {
        console.log(`Gameplay surface ready (${surface.type}); starting clean capture window.`);
        return surface.box;
      }
    } else {
      stableSince = 0;
    }

    await sleep(1500);
  }

  console.warn('Gameplay readiness timeout reached; using best available game surface.');
  return lastSurface?.box || (await bestGameSurface(page))?.box || null;
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

  const buttonSelectors = [
    'button:has-text("Play")',
    'button:has-text("PLAY")',
    'button:has-text("Oyna")',
    'button:has-text("Start")',
    'button:has-text("START")',
    '[aria-label*="play" i]',
    '[class*="play-button" i]',
    '[id*="play-button" i]',
    '[class*="start" i]',
    '[id*="start" i]'
  ];

  for (const scope of scopes) {
    for (const selector of buttonSelectors) {
      try {
        const el = scope.locator(selector).first();

        if (await el.isVisible({ timeout: 1200 })) {
          console.log(`Trying start control: ${selector}`);

          await el.scrollIntoViewIfNeeded().catch(() => {});
          await el.hover().catch(() => {});
          await el.click({ force: true, timeout: 5000 });

          await sleep(1800);

          // Some games require a second real user gesture.
          await page.keyboard.press('Enter').catch(() => {});
          await page.keyboard.press('Space').catch(() => {});

          await sleep(1200);

          return {
            type: 'button',
            selector,
            scope
          };
        }
      } catch (_) {}
    }

    // Some HTML/canvas games draw the START button inside the canvas.
    try {
      const canvas = scope.locator('canvas').first();

      if (await canvas.isVisible({ timeout: 1200 })) {
        await canvas.scrollIntoViewIfNeeded().catch(() => {});
        const box = await canvas.boundingBox();

        if (box && box.width > 120 && box.height > 120) {
          console.log('Canvas game detected; trying multiple start positions.');

          const points = [
            [0.50, 0.50],
            [0.50, 0.60],
            [0.50, 0.70],
            [0.50, 0.40],
            [0.50, 0.80]
          ];

          for (const [rx, ry] of points) {
            const x = box.x + box.width * rx;
            const y = box.y + box.height * ry;

            await page.mouse.move(x, y, { steps: 4 }).catch(() => {});
            await page.mouse.down().catch(() => {});
            await sleep(120);
            await page.mouse.up().catch(() => {});
            await sleep(900);
          }

          await page.keyboard.press('Enter').catch(() => {});
          await page.keyboard.press('Space').catch(() => {});

          return {
            type: 'canvas',
            selector: 'canvas',
            scope,
            box
          };
        }
      }
    } catch (_) {}
  }

  return null;
}

async function focusGameSurface(page) {
  const surface = await bestGameSurface(page);
  if (surface?.box) {
    const box = surface.box;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2).catch(() => {});
    return box;
  }
  return { x: 0, y: 0, width: 720, height: 1280 };
}

async function genericGameplay(context, page, durationMs, surface, captureTarget) {
  const end = Date.now() + durationMs;
  const keys = ['ArrowRight', 'ArrowUp', 'Space', 'ArrowLeft', 'ArrowDown', 'KeyD', 'KeyW', 'KeyA'];
  let i = 0;

  while (Date.now() < end) {
    await closeUnexpectedPages(context, page);

    if (!isTrustedGameUrl(page.url())) {
      await recoverTrustedTarget(page, captureTarget);
      const recovered = await waitForGameplayReady(context, page, captureTarget);
      if (recovered) surface = recovered;
    }

    // If an ad appears mid-session, wait it out instead of clicking it.
    if (await visibleAdSignal(page)) {
      await dismissSafeAdControls(page);
      await sleep(1300);
      continue;
    }

    const key = keys[i % keys.length];
    try {
      await page.keyboard.down(key);
      await sleep(240);
      await page.keyboard.up(key);

      // Keep pointer activity inside the central 70% of the detected game
      // surface. This greatly reduces accidental ad/banner clicks.
      const marginX = Math.min(surface.width * 0.15, 100);
      const marginY = Math.min(surface.height * 0.15, 140);
      const usableW = Math.max(60, surface.width - marginX * 2);
      const usableH = Math.max(60, surface.height - marginY * 2);
      const x = surface.x + marginX + Math.random() * usableW;
      const y = surface.y + marginY + Math.random() * usableH;

      await page.mouse.move(x, y, { steps: 4 });

      // Do not click on every loop. Keyboard/mouse movement is enough for
      // many games and fewer clicks means fewer accidental ad activations.
      if (i % 3 === 0) await page.mouse.click(x, y);
    } catch (_) {}

    i += 1;
    await sleep(430);
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
    const rawVideoTimelineStart = Date.now();
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(90000);

    // Provider ads frequently open new tabs. Keep the recording page alive
    // and automatically close everything else.
    context.on('page', async popup => {
      if (popup === page) return;
      try {
        await popup.waitForLoadState('domcontentloaded', { timeout: 2500 }).catch(() => {});
        console.log(`Popup blocked: ${popup.url() || 'about:blank'}`);
        await popup.close({ runBeforeUnload: false });
      } catch (_) {}
    });

    const finalTarget = await navigateWithFallback(page);
    console.log(`Capture target ready: ${finalTarget}`);
    if (!(await looksPlayable(page))) console.warn('Playable surface was not confidently detected; continuing with interaction fallback.');

    const startResult = await startAcrossFrames(page);

    if (startResult) {
      console.log(`Start interaction completed: ${startResult.selector}`);
    } else {
      console.log('No explicit Start control detected; trying generic start gestures.');

      await page.keyboard.press('Enter').catch(() => {});
      await page.keyboard.press('Space').catch(() => {});
      await page.mouse.click(360, 560).catch(() => {});
      await page.mouse.click(360, 640).catch(() => {});
      await page.mouse.click(360, 760).catch(() => {});
    }

    // Ads/loaders are allowed to finish in the raw Playwright recording.
    // The exact clean-gameplay timestamp is saved below and render.sh trims
    // everything before it from the final social video.
    await sleep(2500);
    await closeUnexpectedPages(context, page);
    await recoverTrustedTarget(page, finalTarget);

    const readySurface = await waitForGameplayReady(context, page, finalTarget);
    const surface = readySurface || (startResult && startResult.box) || await focusGameSurface(page);

    // Keep a tiny safety lead-in so the rendered clip does not begin on a
    // hard transition frame.
    const gameplayStartOffsetSeconds = Math.max(0, (Date.now() - rawVideoTimelineStart) / 1000 - 0.75);
    console.log(`Clean gameplay starts at raw video +${gameplayStartOffsetSeconds.toFixed(2)}s`);

    console.log(`Recording ${RECORD_SECONDS}s gameplay...`);
    await genericGameplay(context, page, RECORD_SECONDS * 1000, surface, finalTarget);
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
      gameplayStartOffsetSeconds: Number(gameplayStartOffsetSeconds.toFixed(3)),
      adTrimApplied: true,
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
