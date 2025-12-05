// Simple script to create placeholder PNG icons for the extension
// Run with: node scripts/create-icons.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const iconsDir = path.join(__dirname, '../extension/assets/icons');

// Ensure directory exists
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// Minimal PNG header and data for a solid color square
function createPNG(size, r, g, b) {
  // This is a minimal valid PNG file with a solid color
  const header = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
  ]);

  // IHDR chunk
  const ihdr = Buffer.alloc(25);
  ihdr.write('IHDR', 8, 4, 'ascii');
  ihdr.writeUInt32BE(13, 0); // chunk length
  ihdr.writeUInt32BE(size, 12); // width
  ihdr.writeUInt32BE(size, 16); // height
  ihdr[20] = 8; // bit depth
  ihdr[21] = 2; // color type (RGB)
  ihdr[22] = 0; // compression
  ihdr[23] = 0; // filter
  ihdr[24] = 0; // interlace

  // Calculate CRC for IHDR
  const crc32 = require('zlib').crc32;
  const ihdrCrc = crc32(ihdr.subarray(4, 21));
  ihdr.writeUInt32BE(ihdrCrc, 21);

  // IDAT chunk (compressed image data)
  const pixelData = Buffer.alloc(size * size * 3);
  for (let i = 0; i < size * size; i++) {
    pixelData[i * 3] = r;
    pixelData[i * 3 + 1] = g;
    pixelData[i * 3 + 2] = b;
  }

  // Add filter byte for each scanline
  const scanlines = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    scanlines[y * (size * 3 + 1)] = 0; // filter type: none
    pixelData.copy(scanlines, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  }

  const compressed = require('zlib').deflateSync(scanlines);
  const idat = Buffer.alloc(12 + compressed.length);
  idat.writeUInt32BE(compressed.length, 0);
  idat.write('IDAT', 4, 4, 'ascii');
  compressed.copy(idat, 8);
  const idatCrc = crc32(idat.subarray(4, 8 + compressed.length));
  idat.writeUInt32BE(idatCrc, 8 + compressed.length);

  // IEND chunk
  const iend = Buffer.from([
    0x00, 0x00, 0x00, 0x00, // length
    0x49, 0x45, 0x4E, 0x44, // IEND
    0xAE, 0x42, 0x60, 0x82, // CRC
  ]);

  return Buffer.concat([header, ihdr, idat, iend]);
}

// Create icons with purple color (matching theme)
const purple = { r: 99, g: 102, b: 241 }; // #6366f1

const sizes = [16, 32, 48, 128];

sizes.forEach(size => {
  const png = createPNG(size, purple.r, purple.g, purple.b);
  const filename = path.join(iconsDir, `icon${size}.png`);
  fs.writeFileSync(filename, png);
  console.log(`Created ${filename}`);
});

console.log('\n✓ All icons created successfully!');
console.log('You can now rebuild the extension with: npm run build:extension');
