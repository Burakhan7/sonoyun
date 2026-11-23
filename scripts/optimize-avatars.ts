// Converts avatars/raw/{id}.png into {id}.webp (256 px) and {id}@2x.webp (512 px). See SPEC §18.
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { AVATAR_IDS } from '../packages/shared/avatars.ts';

const QUALITY = 85;
const SIZES = [
  { width: 256, suffix: '' },
  { width: 512, suffix: '@2x' },
];

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = resolve(process.argv[2] ?? join(root, 'apps/web/public/avatars'));
const rawDir = join(outputDir, 'raw');

mkdirSync(outputDir, { recursive: true });

const missing: string[] = [];
let converted = 0;

for (const id of AVATAR_IDS) {
  const source = join(rawDir, `${id}.png`);
  if (!existsSync(source)) {
    missing.push(id);
    continue;
  }
  for (const { width, suffix } of SIZES) {
    await sharp(source)
      .resize(width, width, { fit: 'cover' })
      .webp({ quality: QUALITY })
      .toFile(join(outputDir, `${id}${suffix}.webp`));
  }
  converted += 1;
}

console.log(`${converted}/${AVATAR_IDS.length} avatar dönüştürüldü.`);
if (missing.length > 0) {
  console.log(`Ham görseli olmayanlar (yedek emoji gösterilir): ${missing.join(', ')}`);
}
