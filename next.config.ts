import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required for Docker: produces a self-contained .next/standalone folder
  // with only the files needed to run the server. Eliminates the need to
  // copy the full node_modules into the final image.
  output: "standalone",
  outputFileTracingExcludes: {
    "/*": [
      "data/passage-windows.json",
      "data/verse-topics.json",
      "data/topic-verse-index.json",
      "data/tsk-clusters.json",
      "data/cluster-verse-index.json",
    ],
  },
};

export default nextConfig;
