import type { NextConfig } from "next";

// Local workspace commands still use the checkout's existing credentials file.
try {
  process.loadEnvFile(new URL("../../.env.local", import.meta.url));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const nextConfig: NextConfig = {
  agentRules: false,
  env: { NEXT_PUBLIC_LIVE_UPDATES: process.env.VERCEL_ENV === "preview" ? "off" : "on" },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
