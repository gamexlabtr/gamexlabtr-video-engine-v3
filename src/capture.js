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

async function safeVisible(locator, timeout = 700) {
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
      if (await safeVisible(el, 700)) {
        await el.click({ force: true, timeout: 3000 });
        console.log(`[click] ${selector} in ${label}`);
        await sleep(500);
        return true;
      }
    } catch (_) {}
  }
  return false;
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

function providerScore(url) {
  const u = (url || '').toLowerCase();
  if (u.includes('gamemonetize')) return 100;
  if (u.includes('gamepix')) return 95;
  if (u.includes('gamedistribution')) return 90;
  if (u.includes('html5games')) return 85;
  return 10;
}

async function chooseGameFrame(page) {
  const all = page.frames()
    .filter(f => f !== page.mainFrame())
    .filter(f => (f.url() || '') !== 'about:blank')
    .map((frame, index) => ({
      frame,
      index,
      url: frame.url(),
      score: providerScore(frame.url())
    }))
    .sort((a, b) => b.score - a.score);

  console.log(`[start] candidate iframes: ${all.length}`);
  for (const item of all) {
    console.log(`[start] iframe-${item.index} score=${item.score}: ${item.url}`);
  }

  return all[0] || null;
}

async function frameBox(frame) {
  try {
    const el = await frame.frameElement();
    return await el.boundingBox();
  } catch (_) {
    return null;
  }
}

async function clickFrameCenter(page, item) {
  const box = await frameBox(item.frame);
  if (!box) return false;
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  await page.mouse.click(x, y);
  await sleep(700);
  return true;
}

async function startGame(page, item) {
  if (!item) {
    return { ok: false, method: 'none', frame: null, index: null, box: null };
  }

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

  if (await clickFirstVisible(item.frame, selectors, `game-iframe-${item.index}`)) {
    return {
      ok: true,
      method: 'selector',
      frame: item.frame,
      index: item.index,
      box: await frameBox(item.frame)
    };
  }

  try {
    const canvas = item.frame.locator('canvas').first();
    if (await safeVisible(canvas, 900)) {
      const box = await canvas.boundingBox();
      if (box && box.width > 20 && box.height > 20) {
        await canvas.click({
          position: {
            x: Math.round(box.width / 2),
            y: Math.round(box.height / 2)
          },
          force: true,
          timeout: 3000
        });
        console.log(`[start] clicked canvas center in iframe-${item.index}`);
        await sleep(700);
        return {
          ok: true,
          method: 'canvas-center',
          frame: item.frame,
          index: item.index,
          box: await frameBox(item.frame)
        };
      }
    }
  } catch (_) {}

  if (await clickFrameCenter(page, item)) {
    console.log(`[start] clicked iframe center iframe-${item.index}`);
    return {
      ok: true,
      method: 'iframe-center',
      frame: item.frame,
      index: item.index,
      box: await frameBox(item.frame)
    };
  }

  return {
    ok: false,
    method: 'none',
    frame: item.frame,
    index: item.index,
    box: null
  };
}

const skipSelectors = [
  'button:has-text("Skip")',
  'button:has-text("SKIP")',
  'button:has-text("Skip Ad")',
  'button:has-text("SKIP AD")',
  '[role="button"]:has-text("Skip")',
  '[aria-label*="skip" i]',
  '[title*="skip" i]',
  '.skip',
  '.skip-button',
  '.skipButton',
  '#skip',
  '#skip-ad'
];

async function trySkipAcrossAllFrames(page) {
  const frames = page.frames();
  for (let i = 0; i < frames.length; i += 1) {
    if (await clickFirstVisible(frames[i], skipSelectors, `skip-frame-${i}`)) {
      console.log(`[ad] skip clicked in frame-${i}`);
      return true;
    }
  }
  return false;
}

async function trySkipCoordinate(page, gameTarget) {
  if (!gameTarget?.frame) return false;
  const box = await frameBox(gameTarget.frame);
  if (!box || box.width < 100 || box.height < 100) return false;

  const points = [
    [0.90, 0.88],
    [0.92, 0.82],
    [0.86, 0.90],
    [0.88, 0.78]
  ];

  for (const [rx, ry] of points) {
    const x = Math.round(box.x + box.width * rx);
    const y = Math.round(box.y + box.height * ry);
    try {
      await page.mouse.move(x, y, { steps: 4 });
      await page.mouse.click(x, y);
      console.log(`[ad] fallback click at game-frame ${rx},${ry} => ${x},${y}`);
      await sleep(450);
    } catch (_) {}
  }

  return true;
}

async function adGate(page, gameTarget, waitSeconds = 50) {
  console.log(`[ad] gate started; waiting ${waitSeconds}s before gameplay recording`);

  for (let second = 0; second < waitSeconds; second += 1) {
    const skipped = await trySkipAcrossAllFrames(page);

    // Some ad SDKs render SKIP inside canvas/opaque ad iframe.
    // Only try coordinate fallback during the early ad window.
    if (!skipped && second >= 4 && second <= 22 && second % 4 === 0) {
      await trySkipCoordinate(page, gameTarget);
    }

    if (second > 0 && second % 10 === 0) {
      await dismissOverlays(page);
    }

    await sleep(1000);
  }

  console.log('[ad] gate finished; pre-roll should now be over');

  // Refresh frame box after ad transition.
  if (gameTarget?.frame) {
    gameTarget.box = await frameBox(gameTarget.frame);

    // Refocus actual game.
    if (gameTarget.box) {
      const x = Math.round(gameTarget.box.x + gameTarget.box.width / 2);
      const y = Math.round(gameTarget.box.y + gameTarget.box.height / 2);
      await page.mouse.click(x, y);
      await sleep(800);
    }

    // Some games show a second play/start after ad.
    await clickFirstVisible(gameTarget.frame, [
      'button:has-text("Play")',
      'button:has-text("PLAY")',
      'button:has-text("Start")',
      'button:has-text("START")',
      'button:has-text("Continue")',
      'button:has-text("CONTINUE")',
      '[aria-label*="play" i]',
      '[aria-label*="start" i]'
    ], `post-ad-game-${gameTarget.index}`);
  }

  await sleep(2500);
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
        const x = box.x + Math.max(
          15,
          Math.min(box.width - 15, box.width * (0.28 + Math.random() * 0.44))
        );
        const y = box.y + Math.max(
          15,
          Math.min(box.height - 15, box.height * (0.28 + Math.random() * 0.44))
        );

        await page.mouse.move(x, y, { steps: 5 });

        if (i % 2 === 0) {
          await page.mouse.click(x, y);
        }
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
    console.warn('Cover screenshot failed:', error.message);
  }
}

function trimGameplay(rawVideoPath, gameplayPath, startSeconds, durationSeconds) {
  console.log(
    `[trim] start=${startSeconds.toFixed(2)}s duration=${durationSeconds}s`
  );

  const result = spawnSync('ffmpeg', [
    '-y',
    '-ss', startSeconds.toFixed(3),
    '-i', rawVideoPath,
    '-t', String(durationSeconds),
    '-an',
    '-c:v', 'libvpx-vp9',
    '-deadline', 'realtime',
    '-cpu-used', '6',
    '-b:v', '1800k',
    gameplayPath
  ], { stdio: 'inherit' });

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
    await sleep(800);

    const selected = await chooseGameFrame(page);
    if (!selected) {
      throw new Error('No game iframe found.');
    }

    console.log(
      `[start] selected game iframe-${selected.index}: ${selected.url}`
    );

    const gameTarget = await startGame(page, selected);

    console.log(`Game start result: ${JSON.stringify({
      ok: gameTarget.ok,
      method: gameTarget.method,
      frameIndex: gameTarget.index,
      frameUrl: gameTarget.frame?.url?.() || null
    })}`);

    await sleep(1000);

    await adGate(page, gameTarget, 50);

    await dismissOverlays(page);
    await sleep(700);

    gameTarget.box = gameTarget.frame
      ? await frameBox(gameTarget.frame)
      : gameTarget.box;

    const gameplayStartSeconds = (Date.now() - captureStartedAt) / 1000;

    console.log(
      `[gameplay] gameplay trim start at ${gameplayStartSeconds.toFixed(2)}s`
    );

    console.log(
      `Recording gameplay for ${RECORD_SECONDS} seconds...`
    );

    await genericGameplay(
      page,
      RECORD_SECONDS * 1000,
      gameTarget
    );

    await saveCover(page);

    const video = page.video();
    await context.close();

    if (!video) {
      throw new Error('Playwright did not create a video object.');
    }

    const rawVideoPath = await video.path();
    if (!fs.existsSync(rawVideoPath)) {
      throw new Error(`Recorded video not found: ${rawVideoPath}`);
    }

    const gameplayPath = path.join(outputDir, 'gameplay.webm');

    trimGameplay(
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
        adGateSeconds: 50,
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
