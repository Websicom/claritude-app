import { mkdir, copyFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { faLinkedin, faYahoo } from "@fortawesome/free-brands-svg-icons";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "public", "assets", "source-icons");
await mkdir(output, { recursive: true });

const icons = {
  duckduckgo: "duckduckgo",
  ecosia: "ecosia", brave: "brave", baidu: "baidu",
  facebook: "facebook", instagram: "instagram", youtube: "youtube",
  tiktok: "tiktok", x: "x", pinterest: "pinterest", reddit: "reddit", threads: "threads",
  snapchat: "snapchat", bluesky: "bluesky", quora: "quora", whatsapp: "whatsapp",
  telegram: "telegram", discord: "discord", perplexity: "perplexity",
  gemini: "googlegemini", claude: "claude",
};
const manifest = {};
for (const [name, slug] of Object.entries(icons)) {
  const source = join(root, "node_modules", "simple-icons", "icons", `${slug}.svg`);
  if (!existsSync(source)) throw new Error(`Missing Simple Icons asset: ${slug}`);
  await copyFile(source, join(output, `${name}.svg`));
  manifest[name] = {
    file: `/assets/source-icons/${name}.svg`,
    source: `https://github.com/simple-icons/simple-icons/blob/16.33.0/icons/${slug}.svg`,
    license: "CC0-1.0",
  };
}
for (const [name, icon] of Object.entries({ yahoo: faYahoo, linkedin: faLinkedin })) {
  const [width, height, , , path] = icon.icon;
  const paths = Array.isArray(path) ? path.map((value) => `<path d="${value}"/>`).join("") : `<path d="${path}"/>`;
  await writeFile(join(output, `${name}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${paths}</svg>\n`);
  manifest[name] = { file: `/assets/source-icons/${name}.svg`, source: `https://github.com/FortAwesome/Font-Awesome/blob/7.x/js-packages/@fortawesome/free-brands-svg-icons/${icon.iconName}.js`, license: "CC-BY-4.0" };
}
const lobe = { google: "google-color", bing: "bing-color", yandex: "yandex", chatgpt: "openai", copilot: "copilot-color" };
for (const [name, slug] of Object.entries(lobe)) {
  const source = join(root, "node_modules", "@lobehub", "icons-static-svg", "icons", `${slug}.svg`);
  if (!existsSync(source)) throw new Error(`Missing Lobe Icons asset: ${slug}`);
  await copyFile(source, join(output, `${name}.svg`));
  manifest[name] = { file: `/assets/source-icons/${name}.svg`, source: `https://github.com/lobehub/lobe-icons/blob/v1.95.1/packages/static-svg/icons/${slug}.svg`, license: "MIT" };
}
manifest.email = { file: "/assets/source-icons/email.svg", source: "Lucide mail", license: "ISC" };
manifest.direct = { file: "/assets/globe.svg", source: "Claritude neutral globe", license: "project asset" };
await writeFile(join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
