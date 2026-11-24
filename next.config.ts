import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  outputFileTracingIncludes: {
    "/api/community/donor-letter": [
      "./public/fonts/liberation-sans/LiberationSans-Regular.ttf",
      "./public/fonts/liberation-sans/LiberationSans-Bold.ttf",
    ],
    "/api/admin/operations/contracts/[contractId]/document": [
      "./public/templates/ghsmta-work-for-hire-contract.docx",
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
