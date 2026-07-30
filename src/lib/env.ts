import { z } from "zod";

const envSchema = z.object({
  // Backblaze B2
  B2_KEY_ID: z.string().optional(),
  B2_APP_KEY: z.string().optional(),
  B2_BUCKET: z.string().optional(),
  B2_REGION: z.string().default("us-west-004"),
  B2_ENDPOINT: z.string().default("s3.us-west-004.backblazeb2.com"),

  // AI Providers
  OPENAI_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  NVIDIA_API_KEY: z.string().optional(),
  REPLICATE_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),

  // App
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  NEXT_PUBLIC_APP_URL: z.string().default("http://localhost:3000"),
});

function parseEnv() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    if (process.env.NODE_ENV === "production") {
      console.error("Invalid env vars:", parsed.error.flatten());
      process.exit(1);
    }
    return envSchema.parse({
      B2_KEY_ID: "demo",
      B2_APP_KEY: "demo",
      B2_BUCKET: "demo-bucket",
      ...process.env,
    });
  }
  return parsed.data;
}

export const env = parseEnv();
export const isDemo = !env.B2_KEY_ID || env.B2_KEY_ID === "demo";
