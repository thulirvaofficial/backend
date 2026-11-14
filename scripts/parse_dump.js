const fs = require('fs');
const xml = fs.readFileSync('C:/Users/lovew/.gemini/antigravity/brain/e4330973-4ce7-4eb4-a89f-cfa3e2af1789/window_dump.xml', 'utf8');
const texts = [];
const regex = /text="([^"]+)"/g;
let match;
while ((match = regex.exec(xml)) !== null) {
    if (match[1].trim()) texts.push(match[1]);
}
console.log('UI Texts:', texts);

