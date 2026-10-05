import { appendFile, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function validateMigrationState(payload, mode) {
  if (!["--allow-pending", "--require-synced"].includes(mode)) {
    throw new Error("Unknown migration validation mode.");
  }

  if (!payload || !Array.isArray(payload.migrations)) {
    throw new Error("Supabase migration output did not contain a migrations array.");
  }

  const versionPattern = /^\d{14}$/;
  for (const entry of payload.migrations) {
    if (!entry || typeof entry !== "object") {
      throw new Error("Supabase migration output contained an invalid entry.");
    }
    for (const version of [entry.local, entry.remote]) {
      // Supabase CLI 2.119 serializes an unapplied side as an empty string.
      // Treat that documented absence the same as null without weakening the
      // strict validation applied to actual migration versions.
      if (version != null && version !== "" && !versionPattern.test(String(version))) {
        throw new Error("Supabase migration output contained an invalid migration version.");
      }
    }
  }

  const conflicts = payload.migrations.filter((entry) =>
    (!entry.local && entry.remote) ||
    (entry.local && entry.remote && entry.local !== entry.remote));
  const pending = payload.migrations
    .filter((entry) => entry.local && !entry.remote)
    .map((entry) => entry.local);

  if (conflicts.length) {
    throw new Error(`Migration history conflict: ${conflicts.map((entry) => entry.remote || entry.local).join(", ")}. Refusing to repair history automatically.`);
  }
  if (mode === "--require-synced" && pending.length) {
    throw new Error(`Production migrations remain unapplied: ${pending.join(", ")}`);
  }

  return pending;
}

async function main() {
  const [path, mode] = process.argv.slice(2);
  if (!path || !["--allow-pending", "--require-synced"].includes(mode)) {
    throw new Error("Usage: validate-migration-state.mjs <migration-list.json> <--allow-pending|--require-synced>");
  }

  const payload = JSON.parse(await readFile(path, "utf8"));
  const pending = validateMigrationState(payload, mode);

  if (process.env.GITHUB_OUTPUT && mode === "--allow-pending") {
    await appendFile(process.env.GITHUB_OUTPUT, `pending=${pending.join(",") || "none"}\n`, "utf8");
  }
  console.log(pending.length
    ? `Migration history is valid. Pending migrations: ${pending.join(", ")}`
    : "Migration history is valid and synchronized.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
