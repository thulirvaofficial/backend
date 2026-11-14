const fs = require('fs');

function inspectFile(filePath) {
    console.log('=== ' + filePath + ' ===');
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    lines.forEach((line, idx) => {
        if (/router\.(get|post|put|patch|delete)\(/.test(line)) {
            console.log(`${idx + 1}: ${line.trim()}`);
        }
    });
}

inspectFile('backend/routes/delivery.js');
inspectFile('backend/routes/orders.js');

