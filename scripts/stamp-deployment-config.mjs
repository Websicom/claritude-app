import { readFile, writeFile } from "node:fs/promises";

const commitSha = String(process.env.DEPLOY_COMMIT_SHA || "").trim();
if (!/^[0-9a-f]{40}$/.test(commitSha)) {
  throw new Error("DEPLOY_COMMIT_SHA must be the full 40-character Git commit SHA.");
}

const configPath = new URL("../dist/claritude_app/wrangler.json", import.meta.url);
const config = JSON.parse(await readFile(configPath, "utf8"));
config.vars = { ...(config.vars || {}), DEPLOY_COMMIT_SHA: commitSha };
await writeFile(configPath, `${JSON.stringify(config)}\n`, "utf8");

console.log(`Stamped deployment metadata for commit ${commitSha}.`);
