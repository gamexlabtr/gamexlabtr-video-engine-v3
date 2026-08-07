const fs = require('fs');
const path = require('path');
const file = path.resolve('output/selection.json');
if (!fs.existsSync(file)) process.exit(2);
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
if (data.empty) process.exit(3);
const env = data.resolvedEnv || {};
function q(v) { return `'${String(v ?? '').replace(/'/g, `'"'"'`)}'`; }
for (const [k, v] of Object.entries(env)) console.log(`export ${k}=${q(v)}`);
