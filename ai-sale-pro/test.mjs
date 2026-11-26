import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";

const here = fileURLToPath(new URL(".", import.meta.url));
const [pro, rollback, ...rest] = process.argv.slice(2);
if (!pro || !rollback || rest.length ||
  !existsSync(join(pro, "app/api/staff/ai-sale-pro/route.ts")) ||
  !existsSync(join(rollback, "app/api/staff/ai-sale-pro/route.ts"))) {
  throw Error("Usage: node ai-sale-pro/test.mjs /prepared/pro /prepared/rollback");
}
const repo = resolve(here, "..");
const image = "postgres@sha256:f9cf3e1f0066f0eb0c48707d864f0ac5941e9ff454a072077d97a4d278d07d73";
const name = "extra-sale-pro-test-" + randomUUID().slice(0, 12);
const user = "extra_sale_test";
const database = "extra_sale_pro_test";
const migration = "20261126195256_ai_sale_pro_handoffs_and_reports.sql";
const docker = args => execFileSync("docker", args, { encoding: "utf8" }).trim();
const id = docker(["run", "--rm", "--detach", "--network", "none", "--name", name,
  "--label", "purpose=ai-sale-pro-synthetic-test", "--env", "POSTGRES_USER=" + user,
  "--env", "POSTGRES_DB=" + database, "--env", "POSTGRES_HOST_AUTH_METHOD=trust", image]);
if (!/^[a-f0-9]{64}$/.test(id)) throw Error("Isolated test container was not created");
function loadSql(file) {
  const result = spawnSync("docker", ["exec", "-i", id, "psql", "-Xq", "-v", "ON_ERROR_STOP=1",
    "-U", user, "-d", database], { input: readFileSync(file), stdio: ["pipe","inherit","inherit"] });
  if (result.status !== 0) throw Error("Local test SQL could not be loaded: " + file);
}
try {
  const mode = docker(["inspect", "--format", "{{.HostConfig.NetworkMode}} {{index .Config.Labels \"purpose\"}}", id]);
  if (mode !== "none ai-sale-pro-synthetic-test") throw Error("Container isolation check failed");
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    // Use TCP loopback inside the container to skip the entry point's temporary initialization server.
    ready = spawnSync("docker", ["exec", id, "pg_isready", "-h", "127.0.0.1", "-U", user, "-d", database],
      { stdio: "ignore" }).status === 0;
    if (ready) break;
    await setTimeout(250);
  }
  if (!ready) throw Error("Local PostgreSQL did not become ready");
  loadSql(join(here, "tests/legacy-schema.sql"));
  loadSql(join(repo, "supabase/migrations", migration));
  const result = spawnSync(process.execPath, ["--test", join(here, "tests/integration.test.cjs")], {
    cwd: repo,
    stdio: "inherit",
    env: {
      PATH: process.env.PATH,
      NODE_OPTIONS: "--require=" + JSON.stringify(join(here, "deny-external.cjs")),
      XDG_CACHE_HOME: "/tmp",
      EXTRA_SALE_PRO_SOURCE: resolve(pro),
      EXTRA_SALE_ROLLBACK_SOURCE: resolve(rollback),
      EXTRA_SALE_TEST_CONTAINER: name,
      ...(process.env.EXTRA_SALE_TEST_PNG ? { EXTRA_SALE_TEST_PNG: process.env.EXTRA_SALE_TEST_PNG } : {}),
    },
  });
  process.exitCode = result.status ?? 1;
} finally {
  docker(["stop", "--time", "2", id]);
}
