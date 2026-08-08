import { NextResponse } from "next/server"

import { getEgnyteRedirectUri } from "@/lib/integrations/egnyteRedirect"

export async function GET() {
  const redirectUri = getEgnyteRedirectUri()

  const url = `https://collisionacademy.egnyte.com/puboauth/authorize?response_type=code&client_id=${process.env.EGNYTE_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}`
        

  return NextResponse.redirect(new URL(url))
}