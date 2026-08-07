'use strict';
const fs = require('fs');
const path = require('path');

function appendAnalytics(event) {
  const dir = path.resolve('output/analytics');
  fs.mkdirSync(dir, { recursive: true });
  const payload = { ts: new Date().toISOString(), ...event };
  fs.appendFileSync(path.join(dir, 'video-engine.jsonl'), JSON.stringify(payload) + '\n');
  fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify(payload, null, 2));
}

module.exports = { appendAnalytics };
