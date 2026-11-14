/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@flowgate/shared-types', 'three'],
  async rewrites() {
    const rawApiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
    const apiUrl = rawApiUrl.replace(/\/api\/?$/, '').replace(/\/$/, '');
    return [
      {
        source: '/api/v1/:path*',
        destination: `${apiUrl}/api/v1/:path*`,
      },
      {
        source: '/health',
        destination: `${apiUrl}/health`,
      },
    ];
  },
};

export default nextConfig;
