/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Keep pdfkit as an external Node package (its dynamic .afm font loading
    // breaks if webpack tries to bundle it) ...
    serverComponentsExternalPackages: ["pdfkit"],
    // ... and make sure its font-metric data files ship with the serverless
    // function on Vercel, or PDF generation fails at runtime.
    outputFileTracingIncludes: {
      "/api/**": ["./node_modules/pdfkit/js/data/**/*"],
    },
  },
};

export default nextConfig;
