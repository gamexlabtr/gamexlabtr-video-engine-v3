'use strict';

const PROFILES = {
  gamemonetize: {
    key: 'gamemonetize',
    aliases: ['gamemonetize', 'html5.gamemonetize', 'gamesnacks'],
    initialWaitMs: 7500,
    postStartWaitMs: 4500,
    gameplayReadyTimeoutMs: 75000,
    safeStartPoints: [[0.5,0.52],[0.5,0.64],[0.5,0.73]],
    startSelectors: ['button:has-text("Play")','button:has-text("PLAY")','button:has-text("Start")','button:has-text("START")','[class*="play-button" i]','[id*="play-button" i]'],
    adText: /advertisement|skip ad|close ad|rewarded ad|your ad will end|reklam|sponsored/i,
    interaction: 'mixed'
  },
  gamepix: {
    key: 'gamepix',
    aliases: ['gamepix'],
    initialWaitMs: 6500,
    postStartWaitMs: 3500,
    gameplayReadyTimeoutMs: 70000,
    safeStartPoints: [[0.5,0.5],[0.5,0.62],[0.5,0.7]],
    startSelectors: ['button:has-text("Play")','button:has-text("PLAY")','[aria-label*="play" i]','[class*="play" i]'],
    adText: /advertisement|skip ad|close ad|sponsored/i,
    interaction: 'mixed'
  },
  playgama: {
    key: 'playgama',
    aliases: ['playgama'],
    initialWaitMs: 8500,
    postStartWaitMs: 5000,
    gameplayReadyTimeoutMs: 80000,
    safeStartPoints: [[0.5,0.55],[0.5,0.66],[0.5,0.76]],
    startSelectors: ['button:has-text("Play")','button:has-text("Start")','[class*="start" i]','[class*="play" i]'],
    adText: /advertisement|skip ad|close ad|rewarded|reklam/i,
    interaction: 'mixed'
  },
  gamedistribution: {
    key: 'gamedistribution',
    aliases: ['gamedistribution', 'gd.games'],
    initialWaitMs: 9000,
    postStartWaitMs: 6000,
    gameplayReadyTimeoutMs: 85000,
    safeStartPoints: [[0.5,0.5],[0.5,0.62]],
    startSelectors: ['button:has-text("Play")','button:has-text("Continue")','[class*="play" i]'],
    adText: /advertisement|skip ad|close ad|rewarded ad|sponsored/i,
    interaction: 'mixed'
  },
  crazygames: {
    key: 'crazygames',
    aliases: ['crazygames'],
    initialWaitMs: 7000,
    postStartWaitMs: 4500,
    gameplayReadyTimeoutMs: 75000,
    safeStartPoints: [[0.5,0.5],[0.5,0.6],[0.5,0.7]],
    startSelectors: ['button:has-text("Play")','button:has-text("PLAY")','[class*="play" i]'],
    adText: /advertisement|skip ad|close ad|sponsored/i,
    interaction: 'mixed'
  },
  default: {
    key: 'default',
    aliases: [],
    initialWaitMs: 7000,
    postStartWaitMs: 4500,
    gameplayReadyTimeoutMs: 75000,
    safeStartPoints: [[0.5,0.5],[0.5,0.62],[0.5,0.72]],
    startSelectors: ['button:has-text("Play")','button:has-text("PLAY")','button:has-text("Oyna")','button:has-text("Start")','button:has-text("START")','[aria-label*="play" i]','[class*="play-button" i]','[id*="play-button" i]'],
    adText: /advertisement|skip ad|close ad|rewarded ad|sponsored|reklam/i,
    interaction: 'mixed'
  }
};

function detectProviderProfile(provider, ...urls) {
  const haystack = [provider, ...urls].filter(Boolean).join(' ').toLowerCase();
  for (const [key, profile] of Object.entries(PROFILES)) {
    if (key === 'default') continue;
    if (profile.aliases.some(alias => haystack.includes(alias))) return profile;
  }
  return PROFILES.default;
}

function gameplayPattern(category = '') {
  const c = String(category).toLowerCase();
  if (/race|racing|car|drive|drift|araba|yar[iı]ş/.test(c)) return 'racing';
  if (/platform|runner|arcade|action|aksiyon|macera|adventure/.test(c)) return 'action';
  if (/puzzle|bulmaca|match|board|kart|card/.test(c)) return 'puzzle';
  if (/sport|football|soccer|basket|spor/.test(c)) return 'sports';
  return 'mixed';
}

module.exports = { PROFILES, detectProviderProfile, gameplayPattern };
