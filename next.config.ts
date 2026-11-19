import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Keep the dev badge clear of the sidebar's bottom bar.
  devIndicators: { position: "bottom-right" },
  experimental: {
    // Build workers. Next defaults to one per CPU, and build machines (Render) report many CPUs:
    // the first Render build ran out of its 8 GB. Locally, 11 workers peaked at 3.7 GB. This app
    // has only a few static pages, so 2 workers cost no noticeable build time.
    cpus: 2,
  },
  // Mastra and its runtimes (LibSQL, QuickJS, agent-browser) use Node-only
  // features, so they load with plain Node `require` instead of being bundled.
  serverExternalPackages: [
    "@mastra/core",
    "@mastra/memory",
    "@mastra/libsql",
    "@mastra/quickjs",
    "@mastra/agent-browser",
    "@libsql/client",
    "@tavily/core",
    "agent-browser",
    "quickjs-emscripten",
  ],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
