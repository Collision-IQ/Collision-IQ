import { NextResponse } from "next/server";
import { getUserServiceCases } from "@/lib/academy/serviceCases";
import { getOrCreateAppUser } from "@/lib/auth/get-or-create-app-user";
import { UnauthorizedError } from "@/lib/auth/require-current-user";

export async function GET() {
  try {
    const user = await getOrCreateAppUser();
    const cases = await getUserServiceCases(user.id);

    return NextResponse.json({ cases });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Authentication is required." }, { status: 401 });
    }
    throw error;
  }
}
