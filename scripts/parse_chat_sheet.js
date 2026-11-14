const fs = require('fs');
const xml = fs.readFileSync('C:/Users/lovew/.gemini/antigravity/brain/e4330973-4ce7-4eb4-a89f-cfa3e2af1789/chat_sheet.xml', 'utf-8');

const re = /(?:text|content-desc)="([^"]+)"[^>]+bounds="([^"]+)"/g;
let m;
console.log('--- IN-APP CHAT SHEET ELEMENTS ---');
while ((m = re.exec(xml)) !== null) {
    if (m[1].trim()) {
        console.log(`${m[1].replace(/\n/g, ' ')} ===> ${m[2]}`);
    }
}

