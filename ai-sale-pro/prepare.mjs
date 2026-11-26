import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const profiles = {
  pro: { sha: "5310411797e97fc890ad1973d3b6e21057a6dfba", patch: "pro.patch" },
  rollback: { sha: "8bba56af6b3dd401250c1d150579c4c5433d5606", patch: "rollback-2.3.patch" },
};
const [profileName, parentPath, option, ...rest] = process.argv.slice(2);
const profile = profiles[profileName];
if (!profile || !parentPath || (option && option !== "--build") || rest.length) {
  throw Error("Usage: node ai-sale-pro/prepare.mjs pro|rollback /path/to/work [--build]");
}
const here = fileURLToPath(new URL(".", import.meta.url));
const repo = resolve(here, "..");
const tempRoot = resolve(parentPath);
mkdirSync(tempRoot, { recursive: true });
const checkout = mkdtempSync(join(tempRoot, "sale-" + profileName + "-"));
const cache = join(tempRoot, "npm-cache");
const localEnv = {
  PATH: process.env.PATH,
  NEXT_TELEMETRY_DISABLED: "1",
  npm_config_cache: cache,
  NODE_OPTIONS: "--require=" + JSON.stringify(join(here, "deny-external.cjs")),
};

function run(program, args, { cwd = checkout, env = localEnv } = {}) {
  const result = spawnSync(program, args, { cwd, env, stdio: "inherit" });
  if (result.status !== 0) throw Error("Failed to run " + program + " " + args[0], { cause: result.error });
}

try {
  const snapshot = execFileSync("git", ["archive", profile.sha], { cwd: repo, maxBuffer: 64 * 1024 * 1024 });
  const tar = spawnSync("tar", ["-xf", "-", "-C", checkout], { input: snapshot, stdio: ["pipe", "inherit", "inherit"] });
  if (tar.status !== 0) throw Error("Cannot unpack pinned production source");

  // Installation uses only the pinned public package lock and no service environment.
  const installEnv = { ...localEnv };
  delete installEnv.NODE_OPTIONS;
  for (const key of ["HTTPS_PROXY","HTTP_PROXY","NO_PROXY","https_proxy","http_proxy","no_proxy",
    "NODE_EXTRA_CA_CERTS","SSL_CERT_FILE","npm_config_registry"]) {
    if (process.env[key]) installEnv[key] = process.env[key];
  }
  run("npm", ["ci", "--no-audit", "--no-fund"], { env: installEnv });
  const pkgPath = join(checkout, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const steps = pkg.scripts.build.split(" && ");
  if (steps.pop() !== "next build") throw Error("Unexpected baseline build entry point");
  for (const step of steps) {
    if (!/^node (?:--test )?scripts\/(?:apply-|fix-|test-)[\w.-]+\.cjs$/.test(step)) {
      throw Error("Unexpected baseline build step");
    }
    run(process.execPath, step.split(" ").slice(1));
  }
  pkg.scripts.build = "next build";
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

  cpSync(join(repo, "lib/ai-sale-pro"), join(checkout, "lib/ai-sale-pro"), { recursive: true });
  const migration = "20261126195256_ai_sale_pro_handoffs_and_reports.sql";
  cpSync(join(repo, "supabase/migrations", migration), join(checkout, "supabase/migrations", migration));
  const patches = ["shared.patch", profile.patch].map(file => join(here, "integration", file));
  run("git", ["apply", "--check", ...patches]);
  run("git", ["apply", ...patches]);
  if (option === "--build") {
    run("npm", ["run", "build"]);
    run(process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit", "--incremental", "false"]);
  }
  console.log("AI_SALE_CHECKOUT=" + checkout);
  console.log("AI_SALE_BASELINE=" + profile.sha);
} catch (error) {
  console.error("AI Sale preparation failed in " + basename(checkout));
  throw error;
}
