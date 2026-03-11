import { NextResponse } from "next/server"

export async function GET() {
  const redirectUri =
    "https://collision-academy-new-git-cha-bfa414-collision-academy-82dbb1d7.vercel.app/oauth/egnyte/callback"

  const url = `https://collisionacademy.egnyte.com/puboauth/authorize?response_type=code&client_id=${process.env.EGNYTE_CLIENT_ID}&redirect_uri=${encodeURIComponent(
    redirectUri
  )}`

  return NextResponse.redirect(new URL(url))
}