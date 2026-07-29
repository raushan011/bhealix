import { z } from "zod";
const schema = z.object({
  MONGODB_URI: z.string().min(1), AUTH_SECRET: z.string().min(32),
  NEXT_PUBLIC_APP_URL: z.url(), NEXT_PUBLIC_COMPANY_NAME: z.string().default("BHEALIX")
});
export function env() { return schema.parse(process.env); }
