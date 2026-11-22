import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The floating indicator covers the bottom answer button on phone-sized screens.
  devIndicators: false,
};

export default nextConfig;
