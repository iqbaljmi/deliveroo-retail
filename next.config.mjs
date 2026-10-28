import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js';

// Prevent production builds from overwriting files served by the development server.
export default function nextConfig(phase) {
  return { distDir: phase === PHASE_DEVELOPMENT_SERVER ? '.next-dev' : '.next' };
}
