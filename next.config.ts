import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required for Docker: produces a self-contained .next/standalone folder
  // with only the files needed to run the server. Eliminates the need to
  // copy the full node_modules into the final image.
  output: "standalone",
};

export default nextConfig;
