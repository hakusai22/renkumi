import path from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: path.join(import.meta.dirname),
  outputFileTracingIncludes: {
    "/api/render": [
      "./remotion/**/*",
      "./lib/**/*",
      "./public/assets/**/*",
      "./node_modules/.pnpm/@remotion+compositor-linux-*/node_modules/@remotion/compositor-linux-*/*",
      "./node_modules/.pnpm/@remotion+compositor-linux-*/node_modules/@remotion/compositor-linux-*/**/*",
    ],
  },
  serverExternalPackages: ["@remotion/bundler", "@remotion/renderer", "@rspack/core", "@rspack/binding", "esbuild"],
  transpilePackages: ["remotion", "@remotion/player"],
};

export default nextConfig;
