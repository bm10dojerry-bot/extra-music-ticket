import type {NextConfig} from "next";

const config: NextConfig = {
  serverExternalPackages: ["@ffmpeg-installer/ffmpeg"],
  outputFileTracingIncludes: {
    "/api/cron/extra-os": ["./node_modules/@ffmpeg-installer/linux-x64/ffmpeg"],
    "/api/admin/extra-os": ["./node_modules/@ffmpeg-installer/linux-x64/ffmpeg"],
  },
};

export default config;
