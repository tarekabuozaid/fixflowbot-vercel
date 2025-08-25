/** @type {import('next').NextConfig} */
const nextConfig = {
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
