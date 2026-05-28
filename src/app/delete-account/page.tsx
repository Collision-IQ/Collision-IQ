import Link from "next/link";
import type { Metadata } from "next";

const CONTACT_EMAIL = "help.desk@collision.academy";
const REQUIRED_SUBJECT = "Delete My Collision IQ Account";

export const metadata: Metadata = {
  title: "Collision IQ Account & Data Deletion",
  description:
    "Request deletion of your Collision IQ account and associated data.",
  alternates: {
    canonical: "/delete-account",
  },
};

export default function DeleteAccountPage() {
  return (
    <main className="min-h-screen text-white">
      <section className="border-b border-white/10 bg-black/40 backdrop-blur-xl">
        <div className="mx-auto max-w-4xl px-5 py-10 md:py-14">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-white/50">
                Collision IQ
              </p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight md:text-5xl">
                Collision IQ Account &amp; Data Deletion
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/70 md:text-base">
                Collision IQ users may request deletion of their account and
                associated data by contacting our support team.
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70">
              Public deletion request page
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-5 py-10 md:py-14">
        <div className="rounded-3xl border border-white/10 bg-black/30 p-6 shadow-[0_25px_80px_rgba(0,0,0,0.55)] backdrop-blur-xl md:p-8">
          <div className="space-y-10 text-sm leading-7 text-white/80 md:text-base">
            <section>
              <h2 className="text-xl font-semibold text-white">
                How to Request Deletion
              </h2>
              <p className="mt-3">
                To request deletion of your Collision IQ account and associated
                data, email{" "}
                <a
                  href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
                    REQUIRED_SUBJECT
                  )}`}
                  className="font-semibold text-white underline decoration-white/30 underline-offset-4 transition hover:decoration-white"
                >
                  {CONTACT_EMAIL}
                </a>
                .
              </p>
              <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4 text-white/75">
                <p>
                  <span className="font-semibold text-white">
                    Required subject line:
                  </span>{" "}
                  {REQUIRED_SUBJECT}
                </p>
                <p className="mt-2">
                  Please include the email address associated with your
                  Collision IQ account so we can locate and process the request.
                </p>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white">
                Processing Timeline
              </h2>
              <p className="mt-3">
                Deletion requests are typically processed within 30 days. We may
                contact you if additional information is needed to verify the
                account or complete the request.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white">
                Data That May Be Deleted
              </h2>
              <p className="mt-3">
                Depending on your account activity and applicable requirements,
                account deletion may include deletion of:
              </p>
              <ul className="mt-3 list-disc space-y-2 pl-6">
                <li>account profile information</li>
                <li>uploaded case files</li>
                <li>generated reports</li>
                <li>chat history</li>
                <li>voice/input history where applicable</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white">
                Limited Retention Exceptions
              </h2>
              <p className="mt-3">
                Some records may be retained temporarily where required for
                security, fraud prevention, legal compliance,
                billing/accounting, abuse prevention, dispute resolution, or
                backup recovery.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white">Contact</h2>
              <p className="mt-3">
                For account and data deletion requests, contact us at:
              </p>
              <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-white/75">
                <p>Collision Academy</p>
                <p>{CONTACT_EMAIL}</p>
              </div>
            </section>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-4 text-sm text-white/60">
          <Link href="/" className="transition hover:text-white">
            {"<-"} Back to home
          </Link>
          <span className="opacity-30">/</span>
          <Link href="/privacy" className="transition hover:text-white">
            Privacy Policy
          </Link>
          <span className="opacity-30">/</span>
          <Link href="/terms" className="transition hover:text-white">
            Terms of Service
          </Link>
        </div>
      </section>
    </main>
  );
}
