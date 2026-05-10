import path from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: path.join(import.meta.dirname),
  transpilePackages: ["remotion", "@remotion/player"],
};

export default nextConfig;
