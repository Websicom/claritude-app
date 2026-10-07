import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";

const migration = process.argv[2];
if (!migration) throw new Error("Usage: node scripts/dry-run-migration.mjs <migration.sql>");
const source = readFileSync(migration, "utf8");
if (!/^\s*begin;/i.test(source) || !/commit;\s*$/i.test(source))
  throw new Error("Migration must be wrapped in BEGIN/COMMIT for rollback validation");
const validationSql = source.replace(/commit;\s*$/i, "rollback;\n");
const temporary = join(tmpdir(), `claritude-dry-run-${process.pid}-${basename(migration)}`);
writeFileSync(temporary, validationSql);
try {
  const result = spawnSync(process.execPath, ["node_modules/supabase/dist/supabase.js", "db", "query", "--linked", "--file", temporary], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
} finally {
  rmSync(temporary, { force: true });
}
