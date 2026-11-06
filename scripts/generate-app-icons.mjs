import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const srcImage = path.resolve('/app/applet/src/assets/images/aidaw_app_icon_1793985043836.jpg');
const publicDir = path.resolve('/app/applet/public');

if (!fs.existsSync(srcImage)) {
  console.error('Source image not found:', srcImage);
  process.exit(1);
}

async function buildIcons() {
  console.log('Generating high-resolution PWA & app icons...');

  // 1. 512x512 standard PWA icon
  await sharp(srcImage)
    .resize(512, 512, { fit: 'cover' })
    .toFormat('png')
    .toFile(path.join(publicDir, 'pwa-512x512.png'));
  console.log('✓ Created public/pwa-512x512.png');

  // 2. 192x192 standard PWA icon
  await sharp(srcImage)
    .resize(192, 192, { fit: 'cover' })
    .toFormat('png')
    .toFile(path.join(publicDir, 'pwa-192x192.png'));
  console.log('✓ Created public/pwa-192x192.png');

  // 3. 512x512 maskable PWA icon with 12% safe zone padding
  const paddedSize = Math.round(512 * 0.78); // ~400px inner size
  const innerBuffer = await sharp(srcImage)
    .resize(paddedSize, paddedSize, { fit: 'cover' })
    .toBuffer();

  await sharp({
    create: {
      width: 512,
      height: 512,
      channels: 4,
      background: { r: 11, g: 13, b: 16, alpha: 1 }, // #0b0d10 dark background
    },
  })
    .composite([{ input: innerBuffer, top: Math.round((512 - paddedSize) / 2), left: Math.round((512 - paddedSize) / 2) }])
    .toFormat('png')
    .toFile(path.join(publicDir, 'pwa-maskable-512x512.png'));
  console.log('✓ Created public/pwa-maskable-512x512.png');

  // 4. 180x180 Apple Touch Icon
  await sharp(srcImage)
    .resize(180, 180, { fit: 'cover' })
    .toFormat('png')
    .toFile(path.join(publicDir, 'apple-touch-icon.png'));
  console.log('✓ Created public/apple-touch-icon.png');

  // 5. 32x32 Favicon PNG
  await sharp(srcImage)
    .resize(32, 32, { fit: 'cover' })
    .toFormat('png')
    .toFile(path.join(publicDir, 'favicon-32x32.png'));
  console.log('✓ Created public/favicon-32x32.png');

  // 6. 16x16 Favicon PNG
  await sharp(srcImage)
    .resize(16, 16, { fit: 'cover' })
    .toFormat('png')
    .toFile(path.join(publicDir, 'favicon-16x16.png'));
  console.log('✓ Created public/favicon-16x16.png');

  console.log('All app icons generated successfully!');
}

buildIcons().catch((err) => {
  console.error('Error generating app icons:', err);
  process.exit(1);
});
