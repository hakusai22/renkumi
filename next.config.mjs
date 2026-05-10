import path from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: path.join(import.meta.dirname),
  outputFileTracingIncludes: {
    "/api/render": ["./remotion/**/*", "./lib/**/*", "./public/assets/**/*"],
  },
  serverExternalPackages: ["@remotion/bundler", "@remotion/renderer", "@rspack/core", "@rspack/binding", "esbuild"],
  transpilePackages: ["remotion", "@remotion/player"],
};

export default nextConfig;
