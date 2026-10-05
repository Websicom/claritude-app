import { describe, expect, it } from "vitest";

import { validateMigrationState } from "./validate-migration-state.mjs";

describe("production migration guard", () => {
  it("accepts synchronized migration history", () => {
    expect(validateMigrationState({
      migrations: [{ local: "20261005155152", remote: "20261005155152" }],
    }, "--require-synced")).toEqual([]);
  });

  it("allows local-only pending migrations before a push", () => {
    expect(validateMigrationState({
      migrations: [
        { local: "20261005155152", remote: "20261005155152" },
        { local: "20261006090000", remote: null },
      ],
    }, "--allow-pending")).toEqual(["20261006090000"]);
  });

  it("rejects unapplied migrations after a push", () => {
    expect(() => validateMigrationState({
      migrations: [{ local: "20261006090000", remote: null }],
    }, "--require-synced")).toThrow("remain unapplied");
  });

  it("rejects remote-only history instead of repairing it", () => {
    expect(() => validateMigrationState({
      migrations: [{ local: null, remote: "20261006090000" }],
    }, "--allow-pending")).toThrow("Refusing to repair history automatically");
  });

  it("rejects malformed CLI output", () => {
    expect(() => validateMigrationState({}, "--allow-pending"))
      .toThrow("did not contain a migrations array");
  });

  it("rejects unsafe migration versions before writing job outputs", () => {
    expect(() => validateMigrationState({
      migrations: [{ local: "20261006090000%0Aunsafe=true", remote: null }],
    }, "--allow-pending")).toThrow("invalid migration version");
  });
});
