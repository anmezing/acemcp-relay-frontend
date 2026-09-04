import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("request-log rollup installation contract", () => {
  it("repairs disabled triggers instead of accepting their names as healthy", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "lib", "db.ts"), "utf8");
    const triggerHealthCheck = source.match(
      /FROM pg_trigger[\s\S]*?request_logs_rollup_truncate_v3[\s\S]*?\) <> 4 THEN/,
    )?.[0];

    expect(triggerHealthCheck).toBeDefined();
    expect(triggerHealthCheck).toContain("AND NOT tgisinternal");
    expect(triggerHealthCheck).toContain("AND tgenabled IN ('O', 'A')");
    expect(source).toMatch(
      /CREATE TRIGGER request_logs_rollup_truncate_v3[\s\S]*?DELETE FROM frontend_schema_migrations[\s\S]*?request-log-stats-v3/,
    );
  });
});
