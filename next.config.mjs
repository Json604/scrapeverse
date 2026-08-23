/** @type {import('next').NextConfig} */
export default {
  // The CLI is the ingestion runtime; this app is read-only over MongoDB (+ Phase B UI).
  serverExternalPackages: ["mongodb"],
  async headers() {
    return [{
      source: "/",
      headers: [{
        key: "Link",
        value: "</driftwatch-eye-hero-v1.webp>; rel=preload; as=image; type=image/webp; fetchpriority=high",
      }],
    }];
  },
};
