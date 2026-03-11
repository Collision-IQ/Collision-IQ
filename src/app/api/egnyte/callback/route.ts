import { NextResponse } from "next/server"

export async function GET(req: Request) {
  const redirectUri =
    "https://collision-academy-new-git-cha-bfa414-collision-academy-82dbb1d7.vercel.app/oauth/egnyte/callback"

  const { searchParams } = new URL(req.url)
  const code = searchParams.get("code")

  const res = await fetch(
    `https://${process.env.EGNYTE_DOMAIN}/puboauth/token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code || "",
        client_id: process.env.EGNYTE_CLIENT_ID!,
        client_secret: process.env.EGNYTE_CLIENT_SECRET!,
        redirect_uri: redirectUri,
      }),
    }
  )

  const data = await res.json()

  return NextResponse.json(data)
}