// src/lib/openai.ts

import OpenAI from "openai";

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!, // Make sure this is set in Vercel and .env.local
});
