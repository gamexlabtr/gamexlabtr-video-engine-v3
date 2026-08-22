const { chromium } = require('playwright');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const GAME_URL = process.env.GAME_URL;
const GAME_TITLE = process.env.GAME_TITLE || 'New Game';
const GAME_CATEGORY = process.env.GAME_CATEGORY || 'Games';

const rawSeconds = Number(process.env.RECORD_SECONDS || 30);
const RECORD_SECONDS = Math.max(
  8,
  Math.min(60, Number.isFinite(rawSeconds) ? rawSeconds : 30)
);

if (!GAME_URL) {
  console.error('GAME_URL is required.');
  process.exit(1);
}

const outputDir = path.resolve('output');
const rawDir = path.join(outputDir, 'raw');
fs.mkdirSync(rawDir, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function safeVisible(locator, timeout = 1000) {
  try {
    return await locator.isVisible({ timeout });
  } catch (_) {
    return false;
  }
}

async function clickFirstVisible(scope, selectors, label = 'scope') {
  for (const selector of selectors) {
    try {
      const el = scope.locator(selector).first();
      if (await safeVisible(el, 1000)) {
        await el.click({ force: true, timeout: 4000 });
        console.log(`[click] ${selector} in ${label}`);
        await sleep(700);
        return { ok: true, selector, label };
      }
    } catch (_) {}
  }
  return { ok: false, selector: null, label };
}

async function dismissOverlays(page) {
  await clickFirstVisible(page, [
    '#onetrust-accept-btn-handler',
    'button:has-text("Accept All")',
    'button:has-text("Accept")',
    'button:has-text("Tümünü Kabul Et")',
    'button:has-text("Kabul Et")',
    'button:has-text("I Agree")',
    '[aria-label="Close"]',
    '[aria-label="Kapat"]'
  ], 'main-page');
}

async function getCandidateFrames(page) {
  return page.frames()
    .filter((frame) => frame !== page.mainFrame())
    .filter((frame) => (frame.url() || '') !== 'about:blank');
}

function providerScore(url) {
  const u = (url || '').toLowerCase();
  if (u.includes('gamemonetize')) return 100;
  if (u.includes('gamepix')) return 95;
  if (u.includes('html5games')) return 90;
  if (u.includes('gamedistribution')) return 90;
  if (u.includes('crazygames')) return 85;
  return 10;
}

async function chooseGameFrame(page) {
  const frames = await getCandidateFrames(page);
  const ranked = frames
    .map((frame, index) => ({ frame, index, url: frame.url(), score: providerScore(frame.url()) }))
    .sort((a, b) => b.score - a.score);

  console.log(`[start] candidate iframes: ${ranked.length}`);
  for (const item of ranked) {
    console.log(`[start] iframe-${item.index} score=${item.score}: ${item.url}`);
  }

  return ranked[0] || null;
}

async function tryStartInFrame(page, item) {
  if (!item) return { ok: false, method: 'none', frame: null, index: null, box: null };

  const { frame, index } = item;
  const selectors = [
    'button:has-text("Play")',
    'button:has-text("PLAY")',
    'button:has-text("Start")',
    'button:has-text("START")',
    'button:has-text("Oyna")',
    'button:has-text("OYNA")',
    'button:has-text("Continue")',
    'button:has-text("CONTINUE")',
    '[role="button"]:has-text("Play")',
    '[role="button"]:has-text("Start")',
    '[aria-label*="play" i]',
    '[aria-label*="start" i]',
    '[title*="play" i]',
    '[title*="start" i]',
    '.play-button',
    '.btn-play',
    '.start-button',
    '#play',
    '#start'
  ];

  const direct = await clickFirstVisible(frame, selectors, `iframe-${index}`);
  if (direct.ok) {
    const frameElement = await frame.frameElement();
    const box = await frameElement.boundingBox().catch(() => null);
    return { ok: true, method: 'selector', frame, index, box };
  }

  try {
    const canvas = frame.locator('canvas').first();
    if (await safeVisible(canvas, 1200)) {
      const box = await canvas.boundingBox();
      if (box && box.width > 20 && box.height > 20) {
        await canvas.click({
          position: { x: Math.round(box.width / 2), y: Math.round(box.height / 2) },
          force: true,
          timeout: 5000
        });
        console.log(`[start] clicked canvas center in iframe-${index}`);
        const frameElement = await frame.frameElement();
        const frameBox = await frameElement.boundingBox().catch(() => null);
        return { ok: true, method: 'canvas-center', frame, index, box: frameBox };
      }
    }
  } catch (_) {}

  try {
    const frameElement = await frame.frameElement();
    const box = await frameElement.boundingBox();
    if (box && box.width > 20 && box.height > 20) {
      const x = Math.round(box.x + box.width / 2);
      const y = Math.round(box.y + box.height / 2);
      await page.mouse.click(x, y);
      console.log(`[start] clicked iframe center iframe-${index} at ${x},${y}`);
      return { ok: true, method: 'iframe-center', frame, index, box };
    }
  } catch (_) {}

  return { ok: false, method: 'none', frame, index, box: null };
}

async function waitThroughAd(page, gameTarget, maxWaitSeconds = 55) {
  if (!gameTarget?.frame) {
    console.log('[ad] no game frame, skipping ad wait.');
    return 0;
  }

  const frame = gameTarget.frame;
  const started = Date.now();

  const skipSelectors = [
    'button:has-text("Skip")',
    'button:has-text("SKIP")',
    '[role="button"]:has-text("Skip")',
    'button:has-text("Skip Ad")',
    'button:has-text("SKIP AD")',
    'button:has-text("Continue")',
    'button:has-text("CONTINUE")',
    '[aria-label*="skip" i]',
    '[title*="skip" i]',
    '.skip',
    '.skip-button',
    '.skipButton',
    '#skip',
    '#skip-ad'
  ];

  console.log(`[ad] waiting up to ${maxWaitSeconds}s for pre-game ad/skip...`);

  for (let second = 0; second < maxWaitSeconds; second += 1) {
    const clicked = await clickFirstVisible(frame, skipSelectors, `ad-iframe-${gameTarget.index}`);
    if (clicked.ok) {
      console.log(`[ad] skip/continue clicked at ~${second}s`);
      await sleep(4000);
      break;
    }

    if (second > 0 && second % 8 === 0) {
      await dismissOverlays(page);
    }

    await sleep(1000);
  }

  const waited = Math.round((Date.now() - started) / 1000);
  console.log(`[ad] pre-game wait finished after ${waited}s`);

  // Refocus the actual game after ad/overlay transitions.
  try {
    const frameElement = await frame.frameElement();
    const box = await frameElement.boundingBox();
    if (box) {
      await page.mouse.click(
        Math.round(box.x + box.width / 2),
        Math.round(box.y + box.height / 2)
      );
      await sleep(1200);
    }
  } catch (_) {}

  // Some games need one more start/continue interaction after the ad.
  await clickFirstVisible(frame, [
    'button:has-text("Play")',
    'button:has-text("PLAY")',
    'button:has-text("Start")',
    'button:has-text("START")',
    'button:has-text("Continue")',
    'button:has-text("CONTINUE")',
    '[aria-label*="play" i]',
    '[aria-label*="start" i]'
  ], `post-ad-iframe-${gameTarget.index}`);

  await sleep(2500);
  return waited;
}

async function genericGameplay(page, durationMs, gameTarget) {
  const end = Date.now() + durationMs;
  const keys = [
    'ArrowRight', 'ArrowUp', 'Space', 'ArrowLeft', 'ArrowDown',
    'KeyD', 'KeyW', 'KeyA', 'KeyS', 'Enter'
  ];

  let i = 0;

  while (Date.now() < end) {
    try {
      const key = keys[i % keys.length];
      await page.keyboard.down(key);
      await sleep(220);
      await page.keyboard.up(key);

      if (gameTarget?.box) {
        const box = gameTarget.box;
        const x = box.x + Math.max(15, Math.min(box.width - 15, box.width * (0.25 + Math.random() * 0.5)));
        const y = box.y + Math.max(15, Math.min(box.height - 15, box.height * (0.25 + Math.random() * 0.5)));

        await page.mouse.move(x, y, { steps: 6 });
        if (i % 2 === 0) await page.mouse.click(x, y);
      }
    } catch (_) {}

    i += 1;
    await sleep(420);
  }
}

async function saveCover(page) {
  try {
    await page.screenshot({
      path: path.join(outputDir, 'cover.png'),
      fullPage: false,
      animations: 'disabled',
      timeout: 30000
    });
    console.log('Cover screenshot created.');
  } catch (error) {
    console.warn('Cover screenshot failed, continuing:', error.message);
  }
}

function trimGameplayVideo(rawVideoPath, gameplayPath, trimStartSeconds, durationSeconds) {
  console.log(`[trim] keeping gameplay only: start=${trimStartSeconds.toFixed(2)}s duration=${durationSeconds}s`);

  const result = spawnSync('ffmpeg', [
    '-y',
    '-ss', trimStartSeconds.toFixed(3),
    '-i', rawVideoPath,
    '-t', String(durationSeconds),
    '-an',
    '-c:v', 'libvpx-vp9',
    '-deadline', 'realtime',
    '-cpu-used', '6',
    '-b:v', '1800k',
    gameplayPath
  ], {
    stdio: 'inherit'
  });

  if (result.status !== 0 || !fs.existsSync(gameplayPath)) {
    throw new Error('FFmpeg gameplay trim failed.');
  }
}

(async () => {
  let browser;

  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--autoplay-policy=no-user-gesture-required'
      ]
    });

    const context = await browser.newContext({
      viewport: { width: 720, height: 1280 },
      recordVideo: {
        dir: rawDir,
        size: { width: 720, height: 1280 }
      }
    });

    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(90000);

    const captureStartedAt = Date.now();

    console.log(`Opening game: ${GAME_URL}`);
    await page.goto(GAME_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 90000
    });

    await sleep(8000);

    console.log('Dismissing overlays...');
    await dismissOverlays(page);
    await sleep(1000);

    const gameFrame = await chooseGameFrame(page);

    if (!gameFrame) {
      throw new Error('No game iframe found.');
    }

    console.log(`[start] selected game iframe-${gameFrame.index}: ${gameFrame.url}`);

    const gameTarget = await tryStartInFrame(page, gameFrame);

    console.log(`Game start result: ${JSON.stringify({
      ok: gameTarget.ok,
      method: gameTarget.method,
      frameIndex: gameTarget.index,
      frameUrl: gameTarget.frame?.url?.() || null
    })}`);

    await sleep(1500);

    const adWaitSeconds = await waitThroughAd(page, gameTarget, 55);

    await dismissOverlays(page);
    await sleep(1000);

    // Refresh target box in case layout moved during ad/consent.
    try {
      const frameElement = await gameTarget.frame.frameElement();
      gameTarget.box = await frameElement.boundingBox();
    } catch (_) {}

    const gameplayStartSeconds = (Date.now() - captureStartedAt) / 1000;

    console.log(`[gameplay] real gameplay section starts at ${gameplayStartSeconds.toFixed(2)}s`);
    console.log(`Recording gameplay for ${RECORD_SECONDS} seconds...`);

    await genericGameplay(page, RECORD_SECONDS * 1000, gameTarget);

    await saveCover(page);

    const video = page.video();
    await context.close();

    if (!video) throw new Error('Playwright did not create a video object.');

    const rawVideoPath = await video.path();
    if (!fs.existsSync(rawVideoPath)) {
      throw new Error(`Recorded video not found: ${rawVideoPath}`);
    }

    const gameplayPath = path.join(outputDir, 'gameplay.webm');

    // Critical fix: remove loading/ad section from the file consumed by render step.
    trimGameplayVideo(
      rawVideoPath,
      gameplayPath,
      gameplayStartSeconds,
      RECORD_SECONDS
    );

    fs.writeFileSync(
      path.join(outputDir, 'metadata.json'),
      JSON.stringify({
        gameUrl: GAME_URL,
        gameTitle: GAME_TITLE,
        category: GAME_CATEGORY,
        recordSeconds: RECORD_SECONDS,
        adWaitSeconds,
        gameplayTrimStartSeconds: Number(gameplayStartSeconds.toFixed(2)),
        startInteraction: {
          ok: gameTarget.ok,
          method: gameTarget.method,
          frameIndex: gameTarget.index,
          frameUrl: gameTarget.frame?.url?.() || null
        },
        createdAt: new Date().toISOString()
      }, null, 2)
    );

    console.log(`Gameplay video saved: ${gameplayPath}`);
    console.log('Capture completed successfully.');

  } catch (error) {
    console.error('Capture failed:', error);
    process.exitCode = 1;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
})();
