const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const {test} = require("node:test");
const ts = require("typescript");

function load(name) {
  const filename = path.join(__dirname, "..", "lib", name + ".ts");
  const instance = new Module(filename, module);
  instance.filename = filename;
  instance._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename, compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
  }).outputText, filename);
  return instance.exports;
}

const {parseShowIntake, prepareShow, driveFileId} = load("marketing-show-intake");
const {planMarketing, planStaffWork} = load("marketing-director");
const now = new Date("2030-01-03T00:00:00Z");
const intake = {
  artist: "Nghệ sĩ kiểm thử", venue: "Sân khấu kiểm thử", venueId: "ccc", startsAt: "2030-01-08T19:30",
  capacity: 100, bookingVnd: 5_000_000, productionVnd: 3_000_000, adsVnd: 2_000_000,
  printingVnd: 1_000_000, otherVnd: 500_000, startingPriceVnd: 200_000, targetProfitVnd: 3_000_000,
  setlist: "Bài hát kiểm thử", mediaDriveUrl: "https://drive.google.com/drive/folders/folder_test",
  artistConfirmed: true, mediaRightsConfirmed: true, permissions: ["website", "facebook", "ads"],
};

test("ONE CLICK counts each cost once and weights prices by actual sellable zones", () => {
  const show = parseShowIntake(intake);
  assert.equal(show.startsAt, "2030-01-08T19:30:00+07:00");
  const plan = prepareShow(show, now, {A: 10, B: 20, C: 30, D: 40});
  assert.equal(plan.fixedCostVnd, 9_500_000);
  assert.equal(plan.plannedCostVnd, 11_500_000);
  assert.equal(plan.targetRevenueVnd, 14_500_000);
  assert.equal(plan.breakEvenTicketsAtStartingPrice, 58);
  assert.equal(plan.maximumRevenueVnd, 25_100_000);
  assert.equal(plan.feasibility, "feasible");
  assert.equal(plan.layoutMatches, true);
});

test("viability loss creates a finance task and distinguishes venue capacity mismatch", () => {
  const show = parseShowIntake({...intake, startingPriceVnd: 80_000});
  const plan = prepareShow(show, now, {A: 10, B: 20, C: 30, D: 39});
  assert.equal(plan.layoutMatches, false);
  assert.equal(plan.maximumRevenueVnd, 8_000_000);
  assert.equal(plan.feasibility, "loss");
  const tasks = planStaffWork(show, plan, now);
  assert.equal(tasks.find(task => task.key === "viability").department, "finance");
  assert.equal(tasks.find(task => task.key === "venue").budget_vnd, intake.productionVnd);
  assert.equal(tasks.find(task => task.key === "print").budget_vnd, intake.printingVnd);
});

test("ungranted external actions cannot enter the plan and closure uses the show time", () => {
  const internal = parseShowIntake({...intake, permissions: []});
  const jobs = planMarketing(internal, now);
  assert(!jobs.some(job => ["website", "facebook", "ads", "ads_monitor", "close_sales"].includes(job.kind)));
  const allowed = planMarketing(parseShowIntake(intake), now);
  for (const job of allowed) for (const need of job.dependencies) assert(allowed.some(item => item.kind === need));
  assert.equal(allowed.find(job => job.kind === "close_sales").run_at, "2030-01-08T19:30:00+07:00");
  assert.throws(() => parseShowIntake({...intake, permissions: ["ads"]}));
});

test("TikTok handoff can start early and attaches both assets once their jobs finish", () => {
  const jobs = planMarketing(parseShowIntake(intake), now);
  assert.deepEqual(jobs.find(job => job.kind === "tiktok").dependencies, []);
  assert.deepEqual(jobs.find(job => job.kind === "tiktok_materials").dependencies, ["tiktok", "content", "video"]);
});

test("invalid dates, values, Drive links and missing rights fail before start", () => {
  for (const patch of [{startsAt:"2030-02-30T19:30"}, {capacity: "100"}, {otherVnd: -1}, {venueId:"unknown"}]) {
    assert.throws(() => parseShowIntake({...intake, ...patch}));
  }
  assert.throws(() => prepareShow(parseShowIntake({...intake, mediaRightsConfirmed: false}), now));
  assert.throws(() => prepareShow(parseShowIntake({...intake, startsAt:"2029-12-31T19:30"}), now));
  assert.equal(driveFileId("https://drive.google.com/file/d/file_test/view"), "file_test");
  for (const link of [
    "https://drive.google.com.evil.invalid/drive/folders/file",
    "https://someone@drive.google.com/drive/folders/file",
    "https://drive.google.com:8443/drive/folders/file",
    "http://drive.google.com/drive/folders/file",
  ]) assert.equal(driveFileId(link), null);
});

test("Preview rejects live Supabase, missing or mismatched service role keys and live marketing", () => {
  const filename = path.join(__dirname, "../lib/extra-os/db.ts");
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
  }).outputText;
  const exports = {};
  // Load only the configuration guard; no imports may touch a real database.
  require("node:vm").runInNewContext(compiled, {
    exports, require: () => ({}), Buffer, process: {env: {}},
  }, {filename});
  const allows = exports.deploymentAllowsExtraOs;
  const ref = "cucmanjakryycfxvplmt";
  const liveRef = "fokntdvgzfldxbaglrdc";
  const url = "https://" + ref + ".supabase.co";
  const liveUrl = "https://" + liveRef + ".supabase.co";
  const jwt = (project, role) => "fixture." +
    Buffer.from(JSON.stringify({ref: project, role})).toString("base64url") + ".fixture";
  const valid = {
    VERCEL_ENV: "preview",
    SUPABASE_URL: url,
    EXTRA_OS_PREVIEW_DATABASE_URL: url,
    EXTRA_OS_MARKETING_LIVE: "false",
    SUPABASE_SERVICE_ROLE_KEY: jwt(ref, "service_role"),
  };
  assert.equal(allows(valid), true);
  assert.equal(allows({...valid, SUPABASE_URL: url + "/"}), true);
  for (const patch of [
    {SUPABASE_SERVICE_ROLE_KEY: undefined},
    {SUPABASE_SERVICE_ROLE_KEY: "not-a-jwt"},
    {SUPABASE_SERVICE_ROLE_KEY: jwt(liveRef, "service_role")},
    {SUPABASE_SERVICE_ROLE_KEY: jwt(ref, "anon")},
    {SUPABASE_URL: liveUrl, EXTRA_OS_PREVIEW_DATABASE_URL: liveUrl},
    {SUPABASE_URL: liveUrl},
    {EXTRA_OS_PREVIEW_DATABASE_URL: undefined},
    {EXTRA_OS_MARKETING_LIVE: "true"},
    {EXTRA_OS_MARKETING_LIVE: undefined},
  ]) assert.equal(allows({...valid, ...patch}), false);
  assert.equal(allows({VERCEL_ENV: "production"}), true);
});
