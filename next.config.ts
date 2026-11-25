import type {NextConfig} from "next";

const config: NextConfig = {
  serverExternalPackages: ["@ffmpeg-installer/ffmpeg"],
  outputFileTracingIncludes: {
    "/api/cron/extra-os": ["./node_modules/@ffmpeg-installer/linux-x64/ffmpeg", "./lib/extra-os/fonts/NotoSans.ttf"],
    "/api/admin/extra-os": ["./node_modules/@ffmpeg-installer/linux-x64/ffmpeg", "./lib/extra-os/fonts/NotoSans.ttf"],
  },
};

export default config;
