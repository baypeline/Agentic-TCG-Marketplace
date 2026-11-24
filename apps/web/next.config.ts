import type { NextConfig } from 'next';
import { config } from 'dotenv';

config({ path: '../../.env', quiet: true });
const nextConfig: NextConfig = {
  transpilePackages: ['@tcg/contracts', '@tcg/config'],
};
export default nextConfig;
