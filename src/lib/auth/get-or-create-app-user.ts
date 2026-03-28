import { requireCurrentUser } from "@/lib/auth/require-current-user";

export async function getOrCreateAppUser() {
  const { user } = await requireCurrentUser();
  return user;
}
