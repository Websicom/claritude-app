import { readFile, writeFile } from 'node:fs/promises';

const configUrl = new URL('../dist/claritude_app/wrangler.json', import.meta.url);
const config = JSON.parse(await readFile(configUrl, 'utf8'));

// The current Cloudflare Vite plugin omits this supported Wrangler field from
// its generated deploy config. Keep version previews enabled for review builds.
config.preview_urls = true;

await writeFile(configUrl, `${JSON.stringify(config)}\n`, 'utf8');
