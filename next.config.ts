import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ffmpeg.wasm needs these headers for SharedArrayBuffer (multi-threaded core)
  // Single-threaded core works without them, but we set them for safety
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin",
          },
          {
            key: "Cross-Origin-Embedder-Policy",
            value: "require-corp",
          },
        ],
      },
    ];
  },
  // ffmpeg.wasm packages need to be transpiled for the client
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
    };
    return config;
  },
};

export default nextConfig;
