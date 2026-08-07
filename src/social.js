const fs = require('fs');
const path = require('path');

const title = (process.env.GAME_TITLE || 'New Game').trim();
const category = (process.env.GAME_CATEGORY || 'Games').trim();
const url = (process.env.GAME_URL || 'https://gamexlabtr.com').trim();
const provider = (process.env.GAME_PROVIDER || 'other').trim();

function asciiTag(value, fallback = '') {
  const map = { ç:'c', Ç:'C', ğ:'g', Ğ:'G', ı:'i', İ:'I', ö:'o', Ö:'O', ş:'s', Ş:'S', ü:'u', Ü:'U' };
  const clean = String(value || '')
    .split('').map(c => map[c] || c).join('')
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .trim().split(/\s+/).filter(Boolean).slice(0, 4).join('');
  return clean || fallback;
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

const titleTag = asciiTag(title, 'Game');
const categoryTag = asciiTag(category, 'Games');
const providerTag = provider && provider !== 'other' ? asciiTag(provider) : '';

const baseTags = unique([
  '#GamexlabTR',
  `#${titleTag}`,
  `#${categoryTag}`,
  providerTag ? `#${providerTag}` : '',
  '#Oyun', '#UcretsizOyunlar', '#OnlineOyun',
  '#FreeGames', '#OnlineGames', '#Gaming', '#PlayNow'
]);

const tr = [
  `${title} şimdi GamexlabTR'de!`,
  `Oyunu ücretsiz keşfet ve indirme yapmadan hemen oynamaya başla.`,
  `Mobil, tablet ve bilgisayarda oynayabilirsin.`,
  `Oyna: ${url}`,
  `Videoyu beğenmeyi ve daha fazla oyun için bizi takip etmeyi unutmayın!`
].join('\n');

const en = [
  `${title} is now on GamexlabTR!`,
  `Discover the game for free and start playing instantly with no download required.`,
  `Play on mobile, tablet, and desktop.`,
  `Play now: ${url}`,
  `Don't forget to like this video and follow us for more games!`
].join('\n');

const bilingualBody = `TR\n${tr}\n\nEN\n${en}`;

function captionWithTags(tags) {
  return `${bilingualBody}\n\n${tags.join(' ')}`;
}

const platforms = {
  youtube: {
    title: `${title} | GamexlabTR`,
    description: captionWithTags(baseTags.slice(0, 6)),
    hashtags: baseTags.slice(0, 6)
  },
  instagram: {
    caption: captionWithTags(baseTags.slice(0, 11)),
    hashtags: baseTags.slice(0, 11)
  },
  facebook: {
    caption: captionWithTags(baseTags.slice(0, 7)),
    hashtags: baseTags.slice(0, 7)
  },
  tiktok: {
    caption: captionWithTags(baseTags.slice(0, 8)),
    hashtags: baseTags.slice(0, 8)
  }
};

const payload = {
  postId: process.env.GAME_POST_ID || null,
  queueId: process.env.GAME_QUEUE_ID || null,
  gameTitle: title,
  category,
  provider,
  gameUrl: url,
  language: 'tr+en',
  caption: captionWithTags(baseTags),
  descriptionTR: tr,
  descriptionEN: en,
  hashtags: baseTags,
  platforms,
  callToAction: {
    tr: 'Videoyu beğenmeyi ve daha fazla oyun için bizi takip etmeyi unutmayın!',
    en: "Don't forget to like this video and follow us for more games!"
  },
  videoFile: 'gamexlabtr-final.mp4',
  coverFile: fs.existsSync(path.resolve('output/cover.png')) ? 'cover.png' : null,
  createdAt: new Date().toISOString()
};

fs.writeFileSync(path.resolve('output/social.json'), JSON.stringify(payload, null, 2));
console.log('Bilingual TR+EN social package created.');
