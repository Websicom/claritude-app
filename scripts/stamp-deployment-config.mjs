import { readFile, writeFile } from "node:fs/promises";

const commitSha = String(process.env.DEPLOY_COMMIT_SHA || "").trim();
if (!/^[0-9a-f]{40}$/.test(commitSha)) {
  throw new Error("DEPLOY_COMMIT_SHA must be the full 40-character Git commit SHA.");
}

const configPaths = [
  new URL("../dist/claritude_app/wrangler.json", import.meta.url),
  new URL("../wrangler.jsonc", import.meta.url),
];

for (const configPath of configPaths) {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  config.vars = { ...(config.vars || {}), DEPLOY_COMMIT_SHA: commitSha };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

console.log(`Stamped generated and source deployment metadata for commit ${commitSha}.`);
