import { SignIn } from "@clerk/nextjs";
import { hasClerkConfig } from "@/lib/auth/config";

export default function SignInPage() {
  if (!hasClerkConfig()) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-2xl items-center justify-center px-6 py-16 text-center">
        <div className="rounded-3xl border border-white/10 bg-black/70 p-8 text-white shadow-[0_24px_70px_rgba(0,0,0,0.45)]">
          <h1 className="text-2xl font-semibold">Authentication is not configured yet.</h1>
          <p className="mt-3 text-sm text-white/65">
            Add the Clerk environment variables to enable sign-in.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl items-center justify-center px-6 py-16">
      <SignIn />
    </main>
  );
}
