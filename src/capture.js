const { chromium } = require('playwright');
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

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function safeVisible(locator, timeout = 1200) {
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

      if (await safeVisible(el, 1200)) {
        await el.click({
          force: true,
          timeout: 5000
        });

        console.log(`[start] clicked ${selector} in ${label}`);
        await sleep(1200);

        return {
          ok: true,
          selector,
          method: 'selector',
          label
        };
      }
    } catch (_) {}
  }

  return {
    ok: false,
    selector: null,
    method: null,
    label
  };
}

async function dismissOverlays(page) {
  const selectors = [
    '#onetrust-accept-btn-handler',
    'button:has-text("Accept All")',
    'button:has-text("Accept")',
    'button:has-text("Tümünü Kabul Et")',
    'button:has-text("Kabul Et")',
    'button:has-text("I Agree")',
    'button:has-text("Continue")',
    'button:has-text("CONTINUE")',
    '[aria-label="Close"]',
    '[aria-label="Kapat"]',
    '.close',
    '.modal-close',
    '.popup-close'
  ];

  await clickFirstVisible(page, selectors, 'main-page');
}

async function getCandidateFrames(page) {
  const frames = page.frames();

  return frames
    .filter((frame) => frame !== page.mainFrame())
    .filter((frame) => {
      const url = frame.url() || '';
      return url !== 'about:blank';
    });
}

async function tryPlaySelectorsInFrame(frame, index) {
  const selectors = [
    'button:has-text("Play")',
    'button:has-text("PLAY")',
    'button:has-text("Start")',
    'button:has-text("START")',
    'button:has-text("Oyna")',
    'button:has-text("OYNA")',
    'button:has-text("Continue")',
    'button:has-text("CONTINUE")',
    'button:has-text("Begin")',
    'button:has-text("Go")',
    '[role="button"]:has-text("Play")',
    '[role="button"]:has-text("Start")',
    '[aria-label*="play" i]',
    '[aria-label*="start" i]',
    '[title*="play" i]',
    '[title*="start" i]',
    '.play-button',
    '.playBtn',
    '.btn-play',
    '.start-button',
    '.startBtn',
    '#play',
    '#start',
    '[data-action="play"]',
    '[data-action="start"]'
  ];

  return clickFirstVisible(
    frame,
    selectors,
    `iframe-${index}:${frame.url()}`
  );
}

async function tryMainPageStart(page) {
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
    '.play-button',
    '.btn-play',
    '.start-button',
    '#play',
    '#start'
  ];

  return clickFirstVisible(page, selectors, 'main-page');
}

async function clickFrameCenter(page, frame, index) {
  try {
    const frameElement = await frame.frameElement();
    const box = await frameElement.boundingBox();

    if (!box || box.width < 20 || box.height < 20) {
      return null;
    }

    const cx = Math.round(box.x + box.width / 2);
    const cy = Math.round(box.y + box.height / 2);

    await page.mouse.move(cx, cy, { steps: 8 });
    await page.mouse.click(cx, cy);
    await sleep(900);

    console.log(
      `[start] clicked iframe center iframe-${index} at ${cx},${cy}`
    );

    return {
      ok: true,
      method: 'iframe-center',
      label: `iframe-${index}`,
      x: cx,
      y: cy
    };
  } catch (_) {
    return null;
  }
}

async function clickLikelyPoints(page, frame, index) {
  try {
    const frameElement = await frame.frameElement();
    const box = await frameElement.boundingBox();

    if (!box || box.width < 40 || box.height < 40) {
      return null;
    }

    const points = [
      [0.50, 0.50],
      [0.50, 0.62],
      [0.50, 0.42],
      [0.50, 0.75]
    ];

    for (const [rx, ry] of points) {
      const x = Math.round(box.x + box.width * rx);
      const y = Math.round(box.y + box.height * ry);

      await page.mouse.move(x, y, { steps: 6 });
      await page.mouse.click(x, y);
      await sleep(700);

      console.log(
        `[start] generic iframe click iframe-${index} at ${x},${y}`
      );
    }

    return {
      ok: true,
      method: 'iframe-multi-point',
      label: `iframe-${index}`
    };
  } catch (_) {
    return null;
  }
}

async function clickCanvasInFrame(frame, index) {
  try {
    const canvas = frame.locator('canvas').first();

    if (!(await safeVisible(canvas, 1200))) {
      return null;
    }

    const box = await canvas.boundingBox();

    if (!box || box.width < 20 || box.height < 20) {
      return null;
    }

    await canvas.click({
      position: {
        x: Math.round(box.width / 2),
        y: Math.round(box.height / 2)
      },
      force: true,
      timeout: 5000
    });

    await sleep(900);

    console.log(
      `[start] clicked canvas center in iframe-${index}`
    );

    return {
      ok: true,
      method: 'canvas-center',
      label: `iframe-${index}`
    };
  } catch (_) {
    return null;
  }
}

async function focusGameFrame(page, frame, index) {
  try {
    const frameElement = await frame.frameElement();
    const box = await frameElement.boundingBox();

    if (!box) {
      return null;
    }

    const x = Math.round(box.x + box.width / 2);
    const y = Math.round(box.y + box.height / 2);

    await page.mouse.click(x, y);
    await sleep(300);

    return {
      frame,
      index,
      box
    };
  } catch (_) {
    return null;
  }
}

async function startGame(page) {
  console.log('[start] trying main page selectors...');
  let result = await tryMainPageStart(page);

  if (result.ok) {
    return {
      ...result,
      frame: null,
      index: null
    };
  }

  const frames = await getCandidateFrames(page);

  console.log(`[start] candidate iframes: ${frames.length}`);

  for (let i = 0; i < frames.length; i += 1) {
    const frame = frames[i];

    console.log(`[start] inspecting iframe-${i}: ${frame.url()}`);

    result = await tryPlaySelectorsInFrame(frame, i);

    if (result.ok) {
      const focus = await focusGameFrame(page, frame, i);

      return {
        ...result,
        frame,
        index: i,
        box: focus?.box || null
      };
    }

    const canvasResult = await clickCanvasInFrame(frame, i);

    if (canvasResult?.ok) {
      const focus = await focusGameFrame(page, frame, i);

      return {
        ...canvasResult,
        frame,
        index: i,
        box: focus?.box || null
      };
    }

    const centerResult = await clickFrameCenter(page, frame, i);

    if (centerResult?.ok) {
      const focus = await focusGameFrame(page, frame, i);

      return {
        ...centerResult,
        frame,
        index: i,
        box: focus?.box || null
      };
    }
  }

  for (let i = 0; i < frames.length; i += 1) {
    const frame = frames[i];

    const multi = await clickLikelyPoints(page, frame, i);

    if (multi?.ok) {
      const focus = await focusGameFrame(page, frame, i);

      return {
        ...multi,
        frame,
        index: i,
        box: focus?.box || null
      };
    }
  }

  console.log('[start] no game-specific start interaction found.');

  return {
    ok: false,
    method: 'none',
    frame: null,
    index: null,
    box: null
  };
}

async function genericGameplay(page, durationMs, gameTarget = null) {
  const end = Date.now() + durationMs;

  const keys = [
    'ArrowRight',
    'ArrowUp',
    'Space',
    'ArrowLeft',
    'ArrowDown',
    'KeyD',
    'KeyW',
    'KeyA',
    'KeyS'
  ];

  let i = 0;

  while (Date.now() < end) {
    const key = keys[i % keys.length];

    try {
      await page.keyboard.down(key);
      await sleep(260);
      await page.keyboard.up(key);

      if (gameTarget?.box) {
        const box = gameTarget.box;

        const x =
          box.x +
          Math.max(
            15,
            Math.min(
              box.width - 15,
              box.width * (0.25 + Math.random() * 0.5)
            )
          );

        const y =
          box.y +
          Math.max(
            15,
            Math.min(
              box.height - 15,
              box.height * (0.25 + Math.random() * 0.5)
            )
          );

        await page.mouse.move(x, y, {
          steps: 6
        });

        if (i % 2 === 0) {
          await page.mouse.click(x, y);
        }
      } else {
        const viewport = page.viewportSize() || {
          width: 720,
          height: 1280
        };

        const x =
          80 +
          Math.floor(
            Math.random() *
              Math.max(100, viewport.width - 160)
          );

        const y =
          180 +
          Math.floor(
            Math.random() *
              Math.max(100, viewport.height - 300)
          );

        await page.mouse.move(x, y, {
          steps: 6
        });

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
  const coverPath = path.join(
    outputDir,
    'cover.png'
  );

  try {
    console.log('Creating cover screenshot...');

    await page.screenshot({
      path: coverPath,
      fullPage: false,
      animations: 'disabled',
      timeout: 30000
    });

    console.log('Cover screenshot created.');
  } catch (error) {
    console.warn(
      'Cover screenshot failed, continuing without cover:',
      error.message
    );
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
      viewport: {
        width: 720,
        height: 1280
      },

      recordVideo: {
        dir: rawDir,

        size: {
          width: 720,
          height: 1280
        }
      }
    });

    const page = await context.newPage();

    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(90000);

    console.log(`Opening game: ${GAME_URL}`);

    await page.goto(GAME_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 90000
    });

    await sleep(8000);

    console.log('Dismissing overlays...');
    await dismissOverlays(page);

    await sleep(1200);

    console.log('Trying to start game...');
    const gameTarget = await startGame(page);

    console.log(
      `Game start result: ${JSON.stringify({
        ok: gameTarget.ok,
        method: gameTarget.method,
        frameIndex: gameTarget.index,
        frameUrl: gameTarget.frame?.url?.() || null
      })}`
    );

    await sleep(3500);

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
      throw new Error(
        'Playwright did not create a video object.'
      );
    }

    const rawVideoPath = await video.path();

    if (!fs.existsSync(rawVideoPath)) {
      throw new Error(
        `Recorded video not found: ${rawVideoPath}`
      );
    }

    const gameplayPath = path.join(
      outputDir,
      'gameplay.webm'
    );

    fs.copyFileSync(
      rawVideoPath,
      gameplayPath
    );

    console.log(
      `Gameplay video saved: ${gameplayPath}`
    );

    fs.writeFileSync(
      path.join(outputDir, 'metadata.json'),

      JSON.stringify(
        {
          gameUrl: GAME_URL,
          gameTitle: GAME_TITLE,
          category: GAME_CATEGORY,
          recordSeconds: RECORD_SECONDS,
          startInteraction: {
            ok: gameTarget.ok,
            method: gameTarget.method,
            frameIndex: gameTarget.index,
            frameUrl: gameTarget.frame?.url?.() || null
          },
          createdAt: new Date().toISOString()
        },
        null,
        2
      )
    );

    console.log('Capture completed successfully.');

  } catch (error) {
    console.error(
      'Capture failed:',
      error
    );

    process.exitCode = 1;

  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
})();
