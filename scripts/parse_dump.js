const fs = require('fs');
const content = fs.readFileSync('C:/Users/lovew/.gemini/antigravity/brain/e4330973-4ce7-4eb4-a89f-cfa3e2af1789/window_dump.xml', 'utf8');

const matches = content.match(/<node[^>]+>/g) || [];
for (const node of matches) {
  if (node.includes('Track') || node.includes('track') || node.includes('Details') || node.includes('test') || node.includes('999') || node.includes('180') || node.includes('Farm Fresh')) {
    console.log(node);
  }
}
