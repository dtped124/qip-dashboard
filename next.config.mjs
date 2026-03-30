/** @type {import('next').NextConfig} */
const isGHPages = process.env.GITHUB_PAGES === 'true';

const nextConfig = {
  output: isGHPages ? 'export' : 'standalone',
  basePath: isGHPages ? '/qip-dashboard' : '',
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
