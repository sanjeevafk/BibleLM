import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: process.env.VERCEL ? undefined : "standalone",
  turbopack: {
    root: process.cwd(),
  },
  outputFileTracingExcludes: {
    "/*": [
      "datasets/**",
      "scratch/**",
      "docs/**",
      "data/translations/*.json",
      "data/translations/*.gz",
      "data/passage-windows.json",
      "data/verse-topics.json",
      "data/topic-verse-index.json",
      "data/tsk-clusters.json",
      "data/cluster-verse-index.json",
    ],
  },
};

export default nextConfig;
