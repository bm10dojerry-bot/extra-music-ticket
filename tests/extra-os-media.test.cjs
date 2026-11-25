// Real encoders with a fixture in place of the Google Drive transport.
const assert = require("node:assert/strict");
const {execFileSync} = require("node:child_process");
const fs = require("node:fs");
const Module = require("node:module");
const {tmpdir} = require("node:os");
const path = require("node:path");
const {test} = require("node:test");
const sharp = require("sharp");
const ffmpeg = require("@ffmpeg-installer/ffmpeg");
const ts = require("typescript");

test("Creative renders print JPEGs and mobile H.264 from authorized assets", async () => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), "extra-os-media-test-"));
  const filename = path.resolve(__dirname, "../lib/extra-os/creative.ts");
  const assets = new Map();
  const saved = new Map();
  const source = path.join(dir, "source.mp4");
  const loader = Module._load;
  try {
    execFileSync(ffmpeg.path, ["-loglevel","error","-f","lavfi","-i","color=c=blue:s=400x200:d=1","-c:v",
      "libx264","-pix_fmt","yuv420p",source]);
    const still = await sharp({create:{width:600,height:550,channels:3,background:"#535c7c"}}).png().toBuffer();
    Module._load = function(request, parent, isMain) {
      if (parent?.filename === filename) {
        if (request === "server-only") return {};
        if (request === "./db") return {
          osDb: async query => query.startsWith("extra_os_assets?") ? [assets.get("poster")] : [],
          rpc: async () => true,
          WorkBlocked: Error,
        };
        if (request === "./drive") return {
          downloadArtistFile: async (_file, kind) => kind === "clip" ? fs.readFileSync(source) : still,
          readDriveMedia: async id => new Response(new Uint8Array(saved.get(id))),
          showDriveFolder: async (_id, _artist, section) => ({drive_id: section}),
          saveDriveAsset: async (_show, key, _name, type, section, _departments, bytes) => {
            const asset = {id:key, drive_id:key, version:"1", type, section};
            assets.set(key,asset);
            saved.set(key,bytes);
            return asset;
          },
        };
      }
      return loader.apply(this, arguments);
    };
    const compiled = new Module(filename,module);
    compiled.filename = filename;
    compiled.paths = Module._nodeModulePaths(path.dirname(filename));
    compiled._compile(ts.transpileModule(fs.readFileSync(filename,"utf8"), {
      fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},
    }).outputText,filename);
    Module._load = loader;

    const show = {id:"media-fixture",artist:"Buổi diễn kiểm thử",starts_at:"2030-04-04T14:00:00Z",
      venue:"Không gian Văn hóa Sa Pa",intake:{startingPriceVnd:250000}};
    const photo = {id:"photo-fixture",version:"1"};
    const clip = {id:"clip-fixture",version:"1"};
    for (const media of [{image:photo,clip:null},{image:null,clip}]) {
      await compiled.exports.createPosters(show,media);
      const poster = await sharp(saved.get("poster")).metadata();
      const banner = await sharp(saved.get("banner")).metadata();
      assert.deepEqual([poster.width,poster.height,poster.density],[1600,2400,300]);
      assert.deepEqual([banner.width,banner.height],[1600,900]);
      assert.equal(assets.get("poster").section,"05");
      const video = await compiled.exports.produceVideo(show,media.clip);
      assert.equal(video.section,"06");
      const target = path.join(dir,"video.mp4");
      fs.writeFileSync(target,saved.get("video"));
      const stderr = require("node:child_process").spawnSync(ffmpeg.path, ["-hide_banner","-i",target,
        "-map","0:v:0","-c:v","copy","-f","null","-"], {encoding:"utf8"}).stderr;
      assert.match(stderr,/Duration: 00:00:08\.00/);
      assert.match(stderr,/Video: h264[^\n]*720x1280/);
    }
  } finally {
    Module._load = loader;
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
