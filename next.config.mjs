/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  experimental: { serverComponentsExternalPackages: ["@prisma/client", "bcryptjs", "@vercel/blob", "undici"] },
};
export default nextConfig;
