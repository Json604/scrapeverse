/** @type {import('next').NextConfig} */
export default {
  // The CLI is the ingestion runtime; this app is read-only over MongoDB (+ Phase B UI).
  serverExternalPackages: ["mongodb"],
  eslint: { ignoreDuringBuilds: true },
};
