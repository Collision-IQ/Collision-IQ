This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Collision IQ Drive Policy References

The chat retrieval layer treats `Collision IQ > PA Law > Insurance Policies` as a policy-reference source for Pennsylvania insurance policy questions, including appraisal clauses, exclusions, limits, duties after loss, supplement procedures, and policy terms.

Configure or verify:

```bash
GOOGLE_PA_INSURANCE_POLICIES_FOLDER_ID=1fxDcmu_anJLGRJ8qLvORWAq8kNR1vzkf
```

The folder must be accessible to the configured Google Drive service account or impersonated subject, and Drive ingestion must be run so policy language is indexed before the bot can cite matched excerpts. If the connector/index is unavailable, the bot should say the policy folder/index needs to be checked instead of making policy-specific conclusions.

## ElevenLabs TTS

Voiceover is proxied through `/api/tts`; the browser never calls ElevenLabs directly and the API key must remain server-only.

Required environment variables:

```bash
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID_1=
ELEVENLABS_VOICE_ID_2=
ELEVENLABS_MODEL_ID=eleven_turbo_v2_5
ELEVENLABS_OUTPUT_FORMAT=mp3_44100_128
```

The client sends symbolic voice values only: `voice_1` for Voice 1 and `voice_2` for Voice 2. The server resolves those symbols to `ELEVENLABS_VOICE_ID_1` and `ELEVENLABS_VOICE_ID_2`. Browser SpeechSynthesis fallback is disabled unless `NEXT_PUBLIC_TTS_ALLOW_BROWSER_FALLBACK=true`, and any fallback is visibly labeled as a browser voice.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
