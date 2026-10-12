// Where Next's server-side proxy forwards /api/* to (the Django backend).
// Read at *build* time: rewrites() is evaluated by `next build` and baked into
// the routes manifest, so changing API_INTERNAL_URL later needs a rebuild.
// `||` on purpose: an empty value is never a valid upstream.
const API_INTERNAL_URL = process.env.API_INTERNAL_URL || 'http://localhost:8001';

// Strict-Transport-Security max-age (seconds) that Next adds to every response it sends; 0 (the default)
// sends no header. Like API_INTERNAL_URL it is read by `next build` and baked into the routes manifest, so
// changing it needs a rebuild (Dockerfile.web takes it as a build argument). Browsers remember the value:
// keep it 0 until https works end to end, then raise it in steps. The platform edge may set HSTS instead;
// Django's SECURE_HSTS_SECONDS only covers the responses Django itself produces (API, admin).
const hstsSeconds = Number(process.env.NEXT_HSTS_SECONDS);
const NEXT_HSTS_SECONDS = Number.isFinite(hstsSeconds) && hstsSeconds > 0 ? Math.floor(hstsSeconds) : 0;

// NEXT_OUTPUT=export builds a pure static site (`out/`: HTML/JS/CSS only, no Node server) for the portable
// edition, where Django serves the files itself and `/api` is same-origin. Static export supports neither
// rewrites() nor headers(), so those are left out in that mode. Every other mode (`next build` / `next start`,
// NEXT_OUTPUT=standalone for Docker) is unchanged. Use `npm run build:export` rather than setting this by hand.
const isExport = process.env.NEXT_OUTPUT === 'export';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // 既有 lint 警告不擋正式建置（同 df553cf 的處理；型別檢查仍會執行）
  eslint: { ignoreDuringBuilds: true },
  output: isExport ? 'export' : process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  // Export only: "/x/index.html" layout so any static file server (Django, python -m http.server) resolves "/x/";
  // next/image has no optimizer without a server.
  ...(isExport ? { trailingSlash: true, images: { unoptimized: true } } : {}),
  // Most Django routes end with "/". By default Next 308-redirects "/x/" to "/x"
  // before any rewrite runs, which would strip the slash Django expects. Turn
  // that redirect off and keep BOTH rewrite rules below.
  skipTrailingSlashRedirect: true,
  experimental: {
    // Next's proxy gives up after 30s by default; imports/exports can take longer.
    // Keep in sync with DOWNLOAD_TIMEOUT_MS in lib/http.ts.
    proxyTimeout: Number(process.env.API_PROXY_TIMEOUT_MS) || 120000,
  },
  // Not registered at all in export mode (unsupported there; see isExport above).
  ...(isExport
    ? {}
    : {
      async headers() {
        if (NEXT_HSTS_SECONDS === 0) return [];
        return [
          {
            source: '/:path*',
            headers: [{ key: 'Strict-Transport-Security', value: `max-age=${NEXT_HSTS_SECONDS}` }],
          },
        ];
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
    }),
};

export default nextConfig;
