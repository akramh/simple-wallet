// Simplified icon creator using pre-encoded PNG data
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const iconsDir = path.join(__dirname, '../extension/assets/icons');

// Ensure directory exists
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// Simple purple square PNGs (base64 encoded)
// These are minimal valid PNG files with purple (#6366f1) color

const icons = {
  // 16x16 purple square
  icon16: 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAFklEQVR42mNk+M9QzzCKRgMNAzQMAABTvQH1p4F1WQAAAABJRU5ErkJggg==',

  // 32x32 purple square
  icon32: 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAGklEQVR42u3BAQEAAACCIP+vbkhAAQAAAH8GEUwAAYP7TIMAAAAASUVORK5CYII=',

  // 48x48 purple square
  icon48: 'iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAHklEQVR42u3BAQ0AAADCoPdPbQ8HFAAAAAAAAAAAfgZMlgAB8nZBGQAAAABJRU5ErkJggg==',

  // 128x128 purple square
  icon128: 'iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAAPElEQVR42u3BAQEAAACCIP+vbkhAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAO8GTwAB8P1nBQAAAABJRU5ErkJggg=='
};

Object.entries(icons).forEach(([name, data]) => {
  const buffer = Buffer.from(data, 'base64');
  const filename = path.join(iconsDir, `${name}.png`);
  fs.writeFileSync(filename, buffer);
  console.log(`✓ Created ${filename}`);
});

console.log('\n✓ All placeholder icons created successfully!');
console.log('\nNext steps:');
console.log('1. Run: npm run build:extension');
console.log('2. Load the extension in Chrome from the dist-extension folder');
console.log('\nNote: These are simple placeholder icons. For better icons, use scripts/generate-icons.html');
