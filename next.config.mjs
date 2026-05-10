import path from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: path.join(import.meta.dirname),
  outputFileTracingIncludes: {
    "/api/render": ["./.remotion/**/*"],
  },
  transpilePackages: ["remotion", "@remotion/player"],
};

export default nextConfig;
