export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");

  if (!code) {
    return new Response("Missing OAuth code", { status: 400 });
  }

  const tokenRes = await fetch(
    "https://collisionacademy.egnyte.com/puboauth/token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization:
          "Basic " +
          Buffer.from(
            process.env.EGNYTE_CLIENT_ID +
              ":" +
              process.env.EGNYTE_CLIENT_SECRET
          ).toString("base64"),
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri:
          "https://collision-academy-new-git-cha-bfa414-collision-academy-82dbb1d7.vercel.app/oauth/egnyte/callback",
      }),
    }
  );

  const data = await tokenRes.json();

  return Response.json(data);
}