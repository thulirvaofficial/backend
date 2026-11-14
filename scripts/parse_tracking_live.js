const fs = require('fs');
const xml = fs.readFileSync('C:/Users/lovew/.gemini/antigravity/brain/e4330973-4ce7-4eb4-a89f-cfa3e2af1789/tracking_live.xml', 'utf-8');

const re = /content-desc="([^"]+)"[^>]+bounds="([^"]+)"/g;
let m;
while ((m = re.exec(xml)) !== null) {
    console.log(`${m[1].replace(/\n/g, ' ')} ===> ${m[2]}`);
}
