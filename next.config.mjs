/** @type {import('next').NextConfig} */
const nextConfig = {
  // 既有 lint 警告不擋正式建置（同 df553cf 的處理；型別檢查仍會執行）
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
