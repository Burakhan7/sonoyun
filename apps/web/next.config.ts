import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Self-contained server for the Docker image; traced from the monorepo root.
  output: 'standalone',
  outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
  // The floating indicator covers the bottom answer button on phone-sized screens.
  devIndicators: false,
};

export default nextConfig;
