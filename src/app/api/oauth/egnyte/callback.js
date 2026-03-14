export default async function handler(req, res) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");

  const tokenResponse = await fetch(
    "https://collisionacademy.egnyte.com/puboauth/token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization:
          "Basic " +
          Buffer.from(
            "ZnTGb342noIw3DRNBKMZLXAfD6PSway59DlnIEyoeQHSWJPo:q8mVd3fvZ2Q3NC2w9CHEhfFSIApGXZWwEH2G97O7wFLnGKCrRebGDXGBZXvXRT1J"
          ).toString("base64"),
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code,
        redirect_uri:
          "https://collision-academy-new-git-cha-bfa414-collision-academy-82dbb1d7.vercel.app/oauth/egnyte/callback",
      }),
    }
  );

  const data = await tokenResponse.json();

  console.log("Egnyte token:", data);

  res.json(data);
}