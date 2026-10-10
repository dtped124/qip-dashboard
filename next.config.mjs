// Where Next's server-side proxy forwards /api/* to (the Django backend).
// Read at *build* time: rewrites() is evaluated by `next build` and baked into
// the routes manifest, so changing API_INTERNAL_URL later needs a rebuild.
// `||` on purpose: an empty value is never a valid upstream.
const API_INTERNAL_URL = process.env.API_INTERNAL_URL || 'http://localhost:8001';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // 既有 lint 警告不擋正式建置（同 df553cf 的處理；型別檢查仍會執行）
  eslint: { ignoreDuringBuilds: true },
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  // Most Django routes end with "/". By default Next 308-redirects "/x/" to "/x"
  // before any rewrite runs, which would strip the slash Django expects. Turn
  // that redirect off and keep BOTH rewrite rules below.
  skipTrailingSlashRedirect: true,
  experimental: {
    // Next's proxy gives up after 30s by default; imports/exports can take longer.
    // Keep in sync with DOWNLOAD_TIMEOUT_MS in lib/http.ts.
    proxyTimeout: Number(process.env.API_PROXY_TIMEOUT_MS) || 120000,
  },
  async rewrites() {
    // Two rules on purpose: sources are matched strictly, so "/api/:path*/" only
    // matches slash-terminated URLs (most Django routes) and "/api/:path*" only
    // the slash-less ones (e.g. /api/entry/*); each forwards its URL unchanged.
    // The two sources are mutually exclusive, so order is cosmetic — but both
    // must stay; dropping either breaks half of the API.
    return [
      { source: '/api/:path*/', destination: `${API_INTERNAL_URL}/api/:path*/` },
      { source: '/api/:path*', destination: `${API_INTERNAL_URL}/api/:path*` },
    ];
  },
};

export default nextConfig;
