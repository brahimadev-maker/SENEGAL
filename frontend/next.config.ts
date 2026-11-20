import type { NextConfig } from 'next';

/**
 * L'app est entièrement côté client (état dans localStorage / IndexedDB) ;
 * le backend Python est joint via la route /api/[...path] (variable BACKEND_URL).
 */
const nextConfig: NextConfig = {};

export default nextConfig;
