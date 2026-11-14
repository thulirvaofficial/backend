const fs = require('fs');
const xml = fs.readFileSync('C:/Users/lovew/.gemini/antigravity/brain/e4330973-4ce7-4eb4-a89f-cfa3e2af1789/delivery_orders.xml', 'utf-8');

const re = /(?:text|content-desc)="([^"]+)"[^>]+bounds="([^"]+)"/g;
let m;
console.log('--- DELIVERY ORDERS LIST ---');
while ((m = re.exec(xml)) !== null) {
    if (m[1].trim()) {
        console.log(`${m[1].replace(/\n/g, ' ')} ===> ${m[2]}`);
    }
}

