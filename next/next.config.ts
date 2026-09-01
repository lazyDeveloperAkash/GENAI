import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse pulls in pdfjs-dist's legacy CJS build and reads fonts/workers off
  // disk at runtime. Bundling it breaks those lookups, so keep it on native require.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
};

export default nextConfig;
