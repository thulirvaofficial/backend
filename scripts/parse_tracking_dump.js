const fs = require('fs');
const xml = fs.readFileSync('C:/Users/lovew/.gemini/antigravity/brain/e4330973-4ce7-4eb4-a89f-cfa3e2af1789/tracking_dump.xml', 'utf-8');

const descs = [];
const re = /content-desc="([^"]+)"/g;
let m;
while ((m = re.exec(xml)) !== null) {
    descs.push(m[1]);
}

console.log('CONTENT DESCS ON TRACKING SCREEN:\n');
descs.forEach((d, i) => console.log(`[${i}] ${d}\n`));

