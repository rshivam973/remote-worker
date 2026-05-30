/** @type {import('next').NextConfig} */
const nextConfig = {
  // The Daytona SDK is server-only; keep it out of the client bundle.
  serverExternalPackages: ["@daytonaio/sdk"],
};

export default nextConfig;
