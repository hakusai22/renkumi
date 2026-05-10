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
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.ignoreWarnings = [
        ...(config.ignoreWarnings ?? []),
        {
          module: /lib\/render-renkumi-video\.ts/,
          message: /require function is used in a way in which dependencies cannot be statically extracted/,
        },
      ];
    }

    return config;
  },
};

export default nextConfig;
