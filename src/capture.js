const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { detectProviderProfile, gameplayPattern } = require('./provider-profiles');
const { appendAnalytics } = require('./analytics-log');

const GAME_URL = (process.env.GAME_URL || '').trim();
const GAME_EMBED_URL = (process.env.GAME_EMBED_URL || '').trim();
const GAME_TITLE = process.env.GAME_TITLE || 'New Game';
const GAME_CATEGORY = process.env.GAME_CATEGORY || 'Games';
const GAME_PROVIDER = (process.env.GAME_PROVIDER || 'other').toLowerCase();
const rawSeconds = Number(process.env.RECORD_SECONDS || 30);
const RECORD_SECONDS = Math.max(8, Math.min(60, Number.isFinite(rawSeconds) ? rawSeconds : 30));
const PROVIDER_PROFILE = detectProviderProfile(GAME_PROVIDER, GAME_EMBED_URL, GAME_URL);
const GAMEPLAY_PATTERN = gameplayPattern(GAME_CATEGORY);

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
const AD_HINTS = [
  'doubleclick', 'googlesyndication', 'googleadservices', 'adservice', 'adnxs',
  'prebid', 'taboola', 'outbrain', 'popads', 'propellerads', 'adsterra',
  '/ads/', '/ad/', 'advert', 'sponsor', 'rewarded'
];

const NON_GAME_HINTS = [
  'iubenda', 'consent', 'cookie', 'privacy', 'cmp.', '/cmp/', 'onetrust',
  'quantcast', 'trustarc', 'didomi', 'cookiebot', 'sourcepoint',
  'iframe_bridge', 'iframe-bridge', 'gdpr', 'ccpa'
];

const LOADING_SELECTORS = [
  '#unity-loading-bar', '#unity-progress-bar-empty', '#unity-progress-bar-full',
  '#unity-logo', '.unity-loading-bar', '.unity-progress-bar', '.unity-loader',
  '[id*="unity-loading" i]', '[class*="unity-loading" i]',
  '[id*="loading" i]', '[class*="loading" i]',
  '[id*="loader" i]', '[class*="loader" i]',
  'progress', '[role="progressbar"]',
  '#canvas-loader', '.game-loader', '.preloader', '[class*="preloader" i]'
];
const LOADING_TEXT = /(^|\b)(loading|loading game|please wait|initializing|preparing|downloading|connecting|starting|yükleniyor|yükleme|bekleyin|hazırlanıyor)(\b|\.{2,}|…)|unity webgl|powered by unity|godot|phaser loading|\b\d{1,3}%\b/i;

function isHttpUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:' || u.protocol === 'http:'; } catch { return false; }
}
function hostOf(value) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}
function baseDomain(host) {
  const parts = String(host || '').split('.').filter(Boolean);
  return parts.length >= 2 ? parts.slice(-2).join('.') : String(host || '');
}
function providerScore(url) {
  const value = String(url || '').toLowerCase();
  let score = 0;
  if (GAME_PROVIDER && value.includes(GAME_PROVIDER)) score += 100;
  for (const hint of PROVIDER_HINTS) if (value.includes(hint)) score += 10;
  if (/embed|game|play|index\.html/.test(value)) score += 4;
  for (const hint of AD_HINTS) if (value.includes(hint)) score -= 100;
  for (const hint of NON_GAME_HINTS) if (value.includes(hint)) score -= 1000;
  return score;
}
function isTrustedGameUrl(value) {
  if (!isHttpUrl(value)) return false;
  const host = hostOf(value);
  if (!host) return false;
  const lower = String(value).toLowerCase();
  if (AD_HINTS.some(h => lower.includes(h))) return false;
  if (NON_GAME_HINTS.some(h => lower.includes(h))) return false;

  const knownHosts = [hostOf(GAME_EMBED_URL), hostOf(GAME_URL)].filter(Boolean);
  for (const known of knownHosts) {
    if (host === known || host.endsWith(`.${known}`) || known.endsWith(`.${host}`)) return true;
    if (baseDomain(host) && baseDomain(host) === baseDomain(known)) return true;
  }
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
  console.warn(`Unexpected redirect recovered: ${current}`);
  try {
    await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded', timeout: 90000,
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
  'button:has-text("Skip Ad")', 'button:has-text("Skip")',
  'button:has-text("Close Ad")', 'button:has-text("Continue to game")',
  'button:has-text("Continue")', '[aria-label="Skip Ad"]',
  '[aria-label="Skip"]', '[aria-label="Close Ad"]',
  '[aria-label="Close advertisement"]'
];
const START_SELECTORS = [...new Set([
  ...(PROVIDER_PROFILE.startSelectors || []),
  'button:has-text("Play")', 'button:has-text("PLAY")', 'button:has-text("Oyna")',
  'button:has-text("Start")', 'button:has-text("START")', '[aria-label*="play" i]',
  '[class*="play-button" i]', '[id*="play-button" i]',
  '[class*="start-button" i]', '[id*="start-button" i]'
])];

async function clickFirstVisible(scope, selectors, timeout = 900) {
  for (const selector of selectors) {
    try {
      const el = scope.locator(selector).first();
      if (await el.isVisible({ timeout })) {
        await el.scrollIntoViewIfNeeded().catch(() => {});
        await el.hover().catch(() => {});
        await el.click({ force: true, timeout: 5000 });
        await sleep(900);
        return selector;
      }
    } catch (_) {}
  }
  return null;
}

async function dismissOverlays(page) {
  await clickFirstVisible(page, [
    '#onetrust-accept-btn-handler', 'button:has-text("Accept All")',
    'button:has-text("Accept")', 'button:has-text("Tümünü Kabul Et")',
    'button:has-text("Kabul Et")', 'button:has-text("I Agree")',
    '[aria-label="Close"]', '[aria-label="Kapat"]'
  ], 600);
}

async function dismissSafeAdControls(page) {
  const scopes = [page, ...page.frames().filter(f => f !== page.mainFrame())];
  for (const scope of scopes) {
    const hit = await clickFirstVisible(scope, SAFE_AD_DISMISS_SELECTORS, 350);
    if (hit) {
      console.log(`Using safe ad control: ${hit}`);
      return true;
    }
  }
  return false;
}

async function frameIsMeaningfullyVisible(frame, page) {
  if (frame === page.mainFrame()) return true;
  try {
    const el = await frame.frameElement();
    const visible = await el.isVisible({ timeout: 250 }).catch(() => false);
    if (!visible) return false;
    const box = await el.boundingBox().catch(() => null);
    return !!box && box.width >= 120 && box.height >= 80;
  } catch (_) {
    return false;
  }
}

async function visibleAdSignal(page) {
  for (const frame of page.frames()) {
    const url = String(frame.url() || '').toLowerCase();
    if (!url || !AD_HINTS.some(h => url.includes(h))) continue;
    if (await frameIsMeaningfullyVisible(frame, page)) return true;
  }

  const scopes = [page, ...page.frames().filter(f => f !== page.mainFrame())];
  for (const scope of scopes) {
    if (scope !== page && !(await frameIsMeaningfullyVisible(scope, page))) continue;

    for (const selector of SAFE_AD_DISMISS_SELECTORS) {
      try {
        if (await scope.locator(selector).first().isVisible({ timeout: 180 })) return true;
      } catch (_) {}
    }

    try {
      const bodyText = (await scope.locator('body').innerText({ timeout: 250 }))
        .slice(0, 1800)
        .replace(/\s+/g, ' ')
        .toLowerCase();

      if (/\b(skip ad|close ad|advertisement\s+\d|ad will (end|close)|your ad will end|rewarded ad|reklamı geç|reklam sona)\b/i.test(bodyText)) {
        return true;
      }
    } catch (_) {}
  }

  return false;
}

async function visibleLoadingSignal(page) {
  const scopes = [page, ...page.frames().filter(f => f !== page.mainFrame())];
  for (const scope of scopes) {
    for (const selector of LOADING_SELECTORS) {
      try {
        const el = scope.locator(selector).first();
        if (await el.isVisible({ timeout: 160 })) {
          const box = await el.boundingBox().catch(() => null);
          // Ignore tiny decorative spinners; accept meaningful loader UI.
          if (!box || (box.width >= 36 && box.height >= 18)) return true;
        }
      } catch (_) {}
    }
    try {
      const text = (await scope.locator('body').innerText({ timeout: 300 })).slice(0, 5000);
      if (LOADING_TEXT.test(text)) return true;
    } catch (_) {}
  }
  return false;
}

async function hasVisibleStartControl(page) {
  const scopes = [page, ...page.frames().filter(f => f !== page.mainFrame())];
  for (const scope of scopes) {
    for (const selector of START_SELECTORS) {
      try {
        if (await scope.locator(selector).first().isVisible({ timeout: 200 })) return true;
      } catch (_) {}
    }
  }
  return false;
}

async function discoverEmbedUrl(page) {
  const candidates = [];
  try {
    const srcs = await page.locator('iframe').evaluateAll(nodes => nodes
      .map(n => n.src || n.getAttribute('src') || '').filter(Boolean));
    candidates.push(...srcs);
  } catch (_) {}
  for (const frame of page.frames()) {
    const url = frame.url();
    if (url && url !== page.url() && isHttpUrl(url)) candidates.push(url);
  }
  const unique = [...new Set(candidates.filter(isHttpUrl))]
    .filter(u => {
      const lower = u.toLowerCase();
      if (AD_HINTS.some(h => lower.includes(h))) return false;
      if (NON_GAME_HINTS.some(h => lower.includes(h))) return false;
      return providerScore(u) > 0;
    });
  unique.sort((a, b) => providerScore(b) - providerScore(a));
  return unique[0] || '';
}

async function lockGameIframeToViewport(page, preferredSrc = '') {
  const iframes = page.locator('iframe');
  const count = Math.min(await iframes.count(), 20);
  const candidates = [];

  for (let i = 0; i < count; i++) {
    try {
      const el = iframes.nth(i);
      if (!(await el.isVisible({ timeout: 300 }).catch(() => false))) continue;
      const src = await el.getAttribute('src').catch(() => '') || '';
      const lower = src.toLowerCase();
      if (!src || AD_HINTS.some(h => lower.includes(h)) || NON_GAME_HINTS.some(h => lower.includes(h))) continue;
      const box = await el.boundingBox().catch(() => null);
      if (!box || box.width < 200 || box.height < 180) continue;

      let score = providerScore(src) * 100 + box.width * box.height / 1000;
      if (preferredSrc && (src === preferredSrc || src.includes(preferredSrc) || preferredSrc.includes(src))) score += 100000;
      candidates.push({ el, src, score });
    } catch (_) {}
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best) return null;

  await best.el.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(300);

  // Pin only the verified game iframe to the recording viewport. This prevents
  // page scroll, related-games sections and footer from entering the capture.
  await best.el.evaluate(el => {
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    document.body.style.margin = '0';

    el.dataset.gxlVideoLocked = '1';
    Object.assign(el.style, {
      position: 'fixed',
      inset: '0',
      top: '0',
      left: '0',
      width: '100vw',
      height: '100vh',
      minWidth: '100vw',
      minHeight: '100vh',
      maxWidth: 'none',
      maxHeight: 'none',
      margin: '0',
      padding: '0',
      border: '0',
      zIndex: '2147483647',
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      transform: 'none'
    });
  });

  await page.waitForTimeout(700);
  const box = await best.el.boundingBox().catch(() => null);
  if (!box || box.width < 600 || box.height < 900) {
    throw new Error('Verified game iframe could not be locked to the recording viewport.');
  }

  console.log(`Game iframe locked to viewport: ${best.src}`);
  return { src: best.src, box };
}

async function ensureLockedGameIframe(page) {
  const locked = page.locator('iframe[data-gxl-video-locked="1"]').first();
  if (!(await locked.isVisible({ timeout: 300 }).catch(() => false))) return null;
  const box = await locked.boundingBox().catch(() => null);
  if (!box || box.width < 600 || box.height < 900) return null;
  return { box, type: 'iframe', src: await locked.getAttribute('src').catch(() => '') || '' };
}

async function bestGameSurface(page) {
  const locked = await ensureLockedGameIframe(page);
  if (locked) return locked;
  const candidates = [];
  const scopes = [page, ...page.frames().filter(f => f !== page.mainFrame())];

  for (const scope of scopes) {
    try {
      const canvases = scope.locator('canvas');
      const count = Math.min(await canvases.count(), 6);
      for (let i = 0; i < count; i++) {
        const el = canvases.nth(i);
        if (!(await el.isVisible({ timeout: 220 }).catch(() => false))) continue;
        const box = await el.boundingBox().catch(() => null);
        if (!box || box.width < 140 || box.height < 140) continue;
        candidates.push({ box, score: 800 + box.width * box.height / 10000, type: 'canvas' });
      }
    } catch (_) {}
  }

  try {
    const iframes = page.locator('iframe');
    const count = Math.min(await iframes.count(), 16);
    for (let i = 0; i < count; i++) {
      const el = iframes.nth(i);
      if (!(await el.isVisible({ timeout: 220 }).catch(() => false))) continue;
      const box = await el.boundingBox().catch(() => null);
      if (!box || box.width < 200 || box.height < 200) continue;
      const src = await el.getAttribute('src').catch(() => '') || '';
      const lowerSrc = src.toLowerCase();
      if (AD_HINTS.some(h => lowerSrc.includes(h))) continue;
      if (NON_GAME_HINTS.some(h => lowerSrc.includes(h))) continue;
      if (src && providerScore(src) <= 0) continue;
      candidates.push({ box, score: providerScore(src) * 20 + box.width * box.height / 10000, type: 'iframe', src });
    }
  } catch (_) {}

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] || null;
}

async function surfaceHashes(page, box, samples = 4, delayMs = 650) {
  const hashes = [];
  if (!box) return hashes;
  const clip = {
    x: Math.max(0, box.x), y: Math.max(0, box.y),
    width: Math.max(1, Math.min(720 - Math.max(0, box.x), box.width)),
    height: Math.max(1, Math.min(1280 - Math.max(0, box.y), box.height))
  };
  if (clip.width < 10 || clip.height < 10) return hashes;

  for (let i = 0; i < samples; i++) {
    try {
      const buf = await page.screenshot({ type: 'jpeg', quality: 35, clip, timeout: 10000 });
      hashes.push(crypto.createHash('sha1').update(buf).digest('hex'));
    } catch (_) {}
    if (i < samples - 1) await sleep(delayMs);
  }
  return hashes;
}

async function visualActivity(page, surface) {
  const hashes = await surfaceHashes(page, surface?.box, 4, 600);
  const unique = new Set(hashes).size;
  return { samples: hashes.length, unique, active: hashes.length >= 3 && unique >= 2 };
}

async function startAcrossFrames(page) {
  const scopes = [page, ...page.frames().filter(f => f !== page.mainFrame())];
  for (const scope of scopes) {
    const hit = await clickFirstVisible(scope, START_SELECTORS, 900);
    if (hit) {
      console.log(`Start interaction: ${hit}`);
      await page.keyboard.press('Enter').catch(() => {});
      await page.keyboard.press('Space').catch(() => {});
      return { type: 'button', selector: hit };
    }
  }

  // Canvas-only games often draw START inside the canvas. Only click a few
  // central points; never click outside the detected game surface.
  const surface = await bestGameSurface(page);
  if (surface?.box) {
    const b = surface.box;
    console.log(`No DOM start button; trying safe central ${surface.type} gestures.`);
    for (const [rx, ry] of (PROVIDER_PROFILE.safeStartPoints || [[0.5,0.5],[0.5,0.62],[0.5,0.72]])) {
      const x = b.x + b.width * rx, y = b.y + b.height * ry;
      await page.mouse.move(x, y, { steps: 4 }).catch(() => {});
      await page.mouse.click(x, y).catch(() => {});
      await sleep(1000);
    }
    await page.keyboard.press('Enter').catch(() => {});
    await page.keyboard.press('Space').catch(() => {});
    return { type: surface.type, selector: surface.type, box: b };
  }
  return null;
}

async function waitForRealGameplay(context, page, captureTarget) {
  const deadline = Date.now() + (PROVIDER_PROFILE.gameplayReadyTimeoutMs || 90000);
  let attempts = 0;
  let lastSurface = null;
  let cleanVotes = 0;
  let activityVotes = 0;

  while (Date.now() < deadline) {
    await closeUnexpectedPages(context, page);
    await recoverTrustedTarget(page, captureTarget);
    await dismissOverlays(page);

    if (await visibleAdSignal(page)) {
      cleanVotes = 0;
      activityVotes = 0;
      console.log('Advertisement signal detected; waiting for clean game state...');
      await dismissSafeAdControls(page);
      await sleep(1800);
      continue;
    }

    if (await visibleLoadingSignal(page)) {
      cleanVotes = 0;
      activityVotes = 0;
      console.log('Game loader/progress UI is still visible; waiting...');
      await sleep(1800);
      continue;
    }

    const startVisible = await hasVisibleStartControl(page);
    if (startVisible || attempts === 0 || attempts % 4 === 0) {
      await startAcrossFrames(page);
      attempts++;
      cleanVotes = 0;
      await sleep(Math.max(1800, PROVIDER_PROFILE.postStartWaitMs || 5000));
    }

    const surface = await bestGameSurface(page);
    if (!surface) {
      cleanVotes = 0;
      activityVotes = 0;
      await sleep(1400);
      continue;
    }
    lastSurface = surface;

    if (await hasVisibleStartControl(page)) {
      cleanVotes = 0;
      console.log('START/PLAY is still visible; not accepting as gameplay yet.');
      await sleep(1400);
      continue;
    }
    if (await visibleLoadingSignal(page)) {
      cleanVotes = 0;
      activityVotes = 0;
      console.log('Loading state returned after START; waiting...');
      await sleep(1600);
      continue;
    }

    // Give the game a harmless input and require repeated visual activity.
    try { await performGameplayAction(page, surface.box, attempts); } catch (_) {}
    await sleep(700);
    const activity = await visualActivity(page, surface);
    console.log(`Gameplay readiness: surface=${surface.type} visual=${activity.unique}/${activity.samples} cleanVotes=${cleanVotes} activityVotes=${activityVotes}`);

    if (activity.active) activityVotes++; else activityVotes = 0;
    cleanVotes++;

    // Require several consecutive clean observations. A small Unity spinner can
    // change hashes, but it should still be caught by loader UI/text and will
    // not pass repeated post-input readiness checks as easily.
    if (cleanVotes >= 3 && activityVotes >= 2 &&
        !(await visibleAdSignal(page)) &&
        !(await visibleLoadingSignal(page)) &&
        !(await hasVisibleStartControl(page))) {
      console.log('Real gameplay accepted after stable readiness checks.');
      return surface.box;
    }
    await sleep(1200);
  }

  throw new Error(`Real gameplay could not be confirmed within timeout${lastSurface ? ' (surface existed but loading/start/activity checks failed)' : ''}.`);
}

async function navigateDirectGame(page) {
  const preferIframeInPlace = PROVIDER_PROFILE.key === 'gamemonetize';

  if (!preferIframeInPlace && GAME_EMBED_URL && isHttpUrl(GAME_EMBED_URL)) {
    console.log(`Opening direct game/embed target: ${GAME_EMBED_URL}`);
    try {
      await page.goto(GAME_EMBED_URL, {
        waitUntil: 'domcontentloaded', timeout: 90000,
        referer: GAME_URL || 'https://gamexlabtr.com/'
      });
      await sleep(PROVIDER_PROFILE.initialWaitMs || 7000);
      await dismissOverlays(page);
      if (isTrustedGameUrl(page.url())) return page.url();
    } catch (error) {
      console.warn(`Direct embed failed: ${error.message}`);
    }
  }

  if (!GAME_URL) {
    if (GAME_EMBED_URL && isHttpUrl(GAME_EMBED_URL)) {
      console.log('No GamexlabTR page available; using embed as last resort.');
      await page.goto(GAME_EMBED_URL, {
        waitUntil: 'domcontentloaded', timeout: 90000,
        referer: 'https://gamexlabtr.com/'
      });
      await sleep(PROVIDER_PROFILE.initialWaitMs || 7000);
      return page.url();
    }
    throw new Error('No usable game page for embed discovery.');
  }

  console.log(`Opening GamexlabTR page in iframe-in-place mode: ${GAME_URL}`);
  await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(Math.max(4500, (PROVIDER_PROFILE.initialWaitMs || 7000) - 1500));
  await dismissOverlays(page);

  const discovered = await discoverEmbedUrl(page);
  if (!discovered) {
    throw new Error('No verified external game iframe passed filtering.');
  }

  console.log(`Verified live game iframe candidate: ${discovered}`);
  const locked = await lockGameIframeToViewport(page, discovered);
  if (!locked) throw new Error('Verified game iframe could not be locked to viewport.');

  const surface = await bestGameSurface(page);
  if (!surface || surface.type !== 'iframe') {
    throw new Error('Locked game iframe is not available as the recording surface.');
  }

  return page.url();
}

async function performGameplayAction(page, surface, step) {
  const b = surface;
  const keys = ['ArrowRight','ArrowUp','Space','ArrowLeft','ArrowDown','KeyD','KeyW','KeyA'];
  const marginX = Math.min(b.width * 0.20, 110);
  const marginY = Math.min(b.height * 0.20, 150);
  const randomPoint = () => ({
    x: b.x + marginX + Math.random() * Math.max(50, b.width - marginX * 2),
    y: b.y + marginY + Math.random() * Math.max(50, b.height - marginY * 2)
  });

  const pattern = GAMEPLAY_PATTERN;
  if (pattern === 'racing') {
    const key = ['ArrowUp','ArrowRight','ArrowUp','ArrowLeft'][step % 4];
    await page.keyboard.down(key); await sleep(360); await page.keyboard.up(key);
    if (step % 6 === 0) await page.keyboard.press('Space').catch(() => {});
    return;
  }
  if (pattern === 'action') {
    const key = ['ArrowRight','Space','ArrowUp','ArrowLeft','KeyD','KeyW'][step % 6];
    await page.keyboard.down(key); await sleep(260); await page.keyboard.up(key);
    const p = randomPoint(); await page.mouse.move(p.x,p.y,{steps:4});
    if (step % 3 === 0) await page.mouse.click(p.x,p.y);
    return;
  }
  if (pattern === 'puzzle') {
    const p1 = randomPoint(), p2 = randomPoint();
    await page.mouse.move(p1.x,p1.y,{steps:4}); await page.mouse.down();
    await page.mouse.move(p2.x,p2.y,{steps:8}); await page.mouse.up();
    return;
  }
  if (pattern === 'sports') {
    const p = randomPoint(); await page.mouse.move(p.x,p.y,{steps:5}); await page.mouse.click(p.x,p.y);
    if (step % 4 === 0) await page.keyboard.press('Space').catch(() => {});
    return;
  }

  const key = keys[step % keys.length];
  await page.keyboard.down(key); await sleep(220); await page.keyboard.up(key);
  const p = randomPoint();
  await page.mouse.move(p.x, p.y, { steps: 4 });
  if (step % 4 === 0) await page.mouse.click(p.x, p.y);
}

async function genericGameplay(context, page, durationMs, surface, captureTarget, rawStartMs) {
  const cleanSegments = [];
  let segmentStart = null;
  let cleanAccumulated = 0;
  let lastTick = Date.now();
  const hardDeadline = Date.now() + durationMs + 90000;
  let i = 0;

  const closeSegment = now => {
    if (segmentStart !== null) {
      const start = Math.max(0, (segmentStart - rawStartMs) / 1000);
      const duration = Math.max(0, (now - segmentStart) / 1000);
      if (duration >= 0.6) cleanSegments.push({ start, duration });
      segmentStart = null;
    }
  };

  while (cleanAccumulated < durationMs && Date.now() < hardDeadline) {
    const now = Date.now();
    const delta = Math.max(0, now - lastTick);
    lastTick = now;

    await closeUnexpectedPages(context, page);

    if (PROVIDER_PROFILE.key === 'gamemonetize') {
      const locked = await ensureLockedGameIframe(page);
      if (!locked) {
        closeSegment(Date.now());
        throw new Error('Locked game iframe disappeared during capture.');
      }
      surface = locked.box;
    }

    if (!isTrustedGameUrl(page.url())) {
      closeSegment(Date.now());
      await recoverTrustedTarget(page, captureTarget);
      surface = await waitForRealGameplay(context, page, captureTarget) || surface;
      continue;
    }

    const dirty = await visibleAdSignal(page) || await visibleLoadingSignal(page) || await hasVisibleStartControl(page);
    if (dirty) {
      closeSegment(Date.now());
      await dismissSafeAdControls(page);
      if (await hasVisibleStartControl(page)) await startAcrossFrames(page);
      if (await visibleLoadingSignal(page)) console.log('Loader appeared during capture; pausing clean segment.');
      await sleep(1400);
      continue;
    }

    if (segmentStart === null) segmentStart = Date.now();
    cleanAccumulated += delta;

    try {
      await performGameplayAction(page, surface, i);
    } catch (_) {}

    i++;
    await sleep(360);
  }

  closeSegment(Date.now());
  const totalClean = cleanSegments.reduce((s, x) => s + x.duration, 0);
  if (totalClean < Math.max(6, RECORD_SECONDS * 0.65)) {
    throw new Error(`Not enough verified clean gameplay (${totalClean.toFixed(1)}s).`);
  }
  return { cleanSegments, totalCleanSeconds: totalClean };
}

async function safeCover(page, surface) {
  try {
    const opts = { path: path.join(outputDir, 'cover.png'), type: 'png', animations: 'disabled', timeout: 30000 };
    if (surface) opts.clip = {
      x: Math.max(0, surface.x), y: Math.max(0, surface.y),
      width: Math.max(1, Math.min(720 - Math.max(0, surface.x), surface.width)),
      height: Math.max(1, Math.min(1280 - Math.max(0, surface.y), surface.height))
    };
    await page.screenshot(opts);
  } catch (error) {
    console.warn(`Cover screenshot failed; render will derive one from clean gameplay: ${error.message}`);
  }
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
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/136 Safari/537.36 GamexlabTRVideo/5.4'
    });
    const page = await context.newPage();
    const rawVideoTimelineStart = Date.now();
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(90000);

    context.on('page', async popup => {
      if (popup === page) return;
      try {
        await popup.waitForLoadState('domcontentloaded', { timeout: 1800 }).catch(() => {});
        console.log(`Popup blocked: ${popup.url() || 'about:blank'}`);
        await popup.close({ runBeforeUnload: false });
      } catch (_) {}
    });

    const captureTarget = await navigateDirectGame(page);
    console.log(`v5.4 capture target ready: ${captureTarget}`);
    console.log(`Provider profile: ${PROVIDER_PROFILE.key}; gameplay pattern: ${GAMEPLAY_PATTERN}`);

    const surface = await waitForRealGameplay(context, page, captureTarget);
    const gameplayStartOffsetSeconds = Math.max(0, (Date.now() - rawVideoTimelineStart) / 1000 - 0.35);
    console.log(`Verified gameplay starts around raw +${gameplayStartOffsetSeconds.toFixed(2)}s`);

    const gameplay = await genericGameplay(
      context, page, RECORD_SECONDS * 1000, surface, captureTarget, rawVideoTimelineStart
    );
    console.log(`Verified clean gameplay captured: ${gameplay.totalCleanSeconds.toFixed(1)}s across ${gameplay.cleanSegments.length} segment(s).`);

    await safeCover(page, surface);
    const video = page.video();
    await context.close();
    if (!video) throw new Error('Playwright did not create a video object.');
    const rawVideoPath = await video.path();
    if (!fs.existsSync(rawVideoPath)) throw new Error(`Recorded video not found: ${rawVideoPath}`);
    fs.copyFileSync(rawVideoPath, path.join(outputDir, 'gameplay.webm'));

    fs.writeFileSync(path.join(outputDir, 'metadata.json'), JSON.stringify({
      engineVersion: '5.4.0',
      providerProfile: PROVIDER_PROFILE.key,
      gameplayPattern: GAMEPLAY_PATTERN,
      postId: process.env.GAME_POST_ID || null,
      queueId: process.env.GAME_QUEUE_ID || null,
      gameUrl: GAME_URL,
      embedUrl: GAME_EMBED_URL,
      captureTarget,
      gameTitle: GAME_TITLE,
      category: GAME_CATEGORY,
      provider: GAME_PROVIDER,
      recordSeconds: RECORD_SECONDS,
      gameplayStartOffsetSeconds,
      cleanSegments: gameplay.cleanSegments,
      verifiedCleanGameplaySeconds: gameplay.totalCleanSeconds,
      createdAt: new Date().toISOString()
    }, null, 2));
    appendAnalytics({ event: 'capture_complete', provider: GAME_PROVIDER, profile: PROVIDER_PROFILE.key, category: GAME_CATEGORY, pattern: GAMEPLAY_PATTERN, gameTitle: GAME_TITLE, cleanSeconds: gameplay.totalCleanSeconds, segments: gameplay.cleanSegments.length, result: 'PASS' });
    console.log('v5.4 capture completed successfully.');
  } catch (error) {
    fs.writeFileSync(path.join(outputDir, 'capture-error.txt'), String(error?.stack || error));
    appendAnalytics({ event: 'capture_failed', provider: GAME_PROVIDER, profile: PROVIDER_PROFILE.key, category: GAME_CATEGORY, pattern: GAMEPLAY_PATTERN, gameTitle: GAME_TITLE, result: 'FAIL', error: String(error?.message || error).slice(0,500) });
    console.error('Capture failed:', error);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
})();