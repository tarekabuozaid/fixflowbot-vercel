/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    appDir: true,
  },
  async rewrites() {
    return [
      {
        source: '/api/telegram',
        destination: '/api/telegram/index.js',
      },
    ];
  },
}

module.exports = nextConfig
