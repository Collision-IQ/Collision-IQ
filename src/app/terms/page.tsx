import Link from "next/link";

const LAST_UPDATED = "March 28, 2026";

export default function TermsPage() {
  return (
    <main className="min-h-screen text-white">
      <section className="border-b border-white/10 bg-black/40 backdrop-blur-xl">
        <div className="mx-auto max-w-4xl px-5 py-10 md:py-14">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-white/50">
                Collision Academy
              </p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight md:text-5xl">
                Terms of Service
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/70 md:text-base">
                These Terms of Service govern your access to and use of the Collision Academy
                website, Collision IQ, and related services.
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70">
              Last updated: {LAST_UPDATED}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-5 py-10 md:py-14">
        <div className="rounded-3xl border border-white/10 bg-black/30 p-6 shadow-[0_25px_80px_rgba(0,0,0,0.55)] backdrop-blur-xl md:p-8">
          <div className="space-y-10 text-sm leading-7 text-white/80 md:text-base">
            <section>
              <h2 className="text-xl font-semibold text-white">1. Acceptance of Terms</h2>
              <p className="mt-3">
                By accessing or using Collision Academy, Collision IQ, or any related website,
                chatbot, export, report, upload, or analysis feature, you agree to be bound by
                these Terms of Service and our Privacy Policy. If you do not agree, do not use the
                services.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white">2. Services</h2>
              <p className="mt-3">
                Collision Academy provides appraisal, documentation, educational, and software
                tools for collision-repair and insurance-related workflows. Features may include AI-
                assisted chat, document review, image analysis, export generation, report drafting,
                and related support tools. We may add, remove, suspend, or modify features at any
                time.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white">3. AI Chatbot Disclosure; Pennsylvania Notice</h2>
              <div className="mt-3 space-y-4">
                <p>
                  This website and certain features made available through it may use artificial
                  intelligence, automated systems, and chatbot technology to generate responses,
                  recommendations, or other content. By using these features, you understand and
                  agree that you may be interacting with an automated system and not a live human
                  representative.
                </p>

                <div>
                  <h3 className="font-semibold text-white">No Human Relationship or Emergency Services</h3>
                  <p className="mt-2">
                    Our chatbot is a software tool and is not a human, therapist, physician,
                    lawyer, crisis counselor, or other licensed professional. The chatbot is not
                    intended to create emotional dependency, provide mental health treatment, or
                    serve as a substitute for professional advice, diagnosis, treatment, or
                    emergency intervention. Do not rely on the chatbot for crisis or emergency
                    needs.
                  </p>
                  <p className="mt-2">
                    If you are experiencing an emergency, suicidal thoughts, self-harm thoughts,
                    or feel that you may be in danger, call 911 immediately. You may also contact
                    the Suicide &amp; Crisis Lifeline by calling or texting 988.
                  </p>
                </div>

                <div>
                  <h3 className="font-semibold text-white">Accuracy; No Professional Advice</h3>
                  <p className="mt-2">
                    Chatbot outputs may be incomplete, inaccurate, outdated, or inappropriate for
                    your circumstances. You are solely responsible for evaluating any output before
                    acting on it. Unless expressly stated otherwise, chatbot content is provided for
                    general informational purposes only and does not constitute medical, mental
                    health, legal, financial, or other professional advice.
                  </p>
                </div>

                <div>
                  <h3 className="font-semibold text-white">Minors</h3>
                  <p className="mt-2">
                    Our services are not directed to children under 13. If you are under 18, you
                    may use this chatbot only with parent or legal guardian permission and
                    supervision where required by applicable law. Artificial-intelligence chat
                    features may not be suitable for some minors. We reserve the right to limit,
                    suspend, or disable chatbot access for users we know, or reasonably believe,
                    are minors in order to comply with applicable law or to protect user safety.
                  </p>
                </div>

                <div>
                  <h3 className="font-semibold text-white">Content and Safety Restrictions</h3>
                  <p className="mt-2">
                    You may not use the chatbot to seek, generate, transmit, or encourage
                    unlawful, abusive, harassing, sexually explicit, violent, self-harm, or
                    otherwise harmful content. We may monitor, filter, block, escalate, or
                    terminate interactions that appear to present safety risks, including risks
                    involving suicide, self-harm, violence, or exploitation.
                  </p>
                </div>

                <div>
                  <h3 className="font-semibold text-white">Pennsylvania Compliance</h3>
                  <p className="mt-2">
                    If and to the extent our chatbot or platform is deemed an “AI companion” or
                    “AI companion platform” under Pennsylvania Senate Bill 1090, known as the
                    Safeguarding Adolescents from Exploitative Chatbots and Harmful AI Technology
                    Act, or any successor or similar law, we intend for this section to serve as a
                    clear and conspicuous disclosure that users are interacting with artificially
                    generated content and not a human being. We may provide additional in-product
                    notices, safety reminders, age-based restrictions, and crisis-resource
                    referrals as needed to comply with Pennsylvania law.
                  </p>
                </div>

                <div>
                  <h3 className="font-semibold text-white">Public Safety Protocols</h3>
                  <p className="mt-2">
                    We may maintain and publish safety protocols addressing suicide, self-harm,
                    violence, and other high-risk interactions, and we may update those protocols
                    from time to time without notice to the extent permitted by law.
                  </p>
                </div>

                <div>
                  <h3 className="font-semibold text-white">Changes</h3>
                  <p className="mt-2">
                    We may revise this section and related safety disclosures at any time to
                    reflect changes in our services, legal requirements, or risk controls.
                  </p>
                </div>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white">4. User Content and Uploads</h2>
              <p className="mt-3">
                You are responsible for all documents, images, estimates, chat prompts, notes,
                and other materials you upload or submit. You represent that you have the rights
                and permissions needed to submit that content and to allow us and our service
                providers to process it for purposes of operating the services.
              </p>
              <p className="mt-3">
                You must not upload content that is unlawful, infringing, confidential without
                authorization, malicious, or harmful to others. We may remove or restrict content
                that violates these Terms or creates legal, safety, or operational risk.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white">5. No Warranty; Review Required</h2>
              <p className="mt-3">
                Reports, exports, summaries, rebuttal drafts, comparison tools, valuations,
                analyses, and chatbot outputs are provided on an “as is” and “as available” basis.
                They are decision-support tools only. You are solely responsible for reviewing,
                verifying, editing, and approving any output before relying on it, sending it,
                filing it, or sharing it with a carrier, customer, court, shop, or other third
                party.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white">6. Prohibited Uses</h2>
              <ul className="mt-3 list-disc space-y-2 pl-6">
                <li>Use the services for unlawful, fraudulent, or deceptive purposes.</li>
                <li>Upload malware, malicious code, or harmful payloads.</li>
                <li>Attempt to interfere with, disrupt, reverse engineer, or abuse the services.</li>
                <li>Use the services to generate harmful, abusive, exploitative, or prohibited content.</li>
                <li>Misrepresent AI-generated output as independently verified professional advice.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white">7. Intellectual Property</h2>
              <p className="mt-3">
                We retain all rights in the services, software, site design, branding, and
                related materials, except for content you own and lawfully submit. Subject to
                these Terms, we grant you a limited, revocable, non-exclusive right to use the
                services for their intended business or informational purpose.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white">8. Suspension and Termination</h2>
              <p className="mt-3">
                We may suspend, restrict, or terminate access to the services at any time, with or
                without notice, if we believe your use violates these Terms, creates safety risk,
                creates legal exposure, harms other users, or threatens the integrity of the
                platform.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white">9. Limitation of Liability</h2>
              <p className="mt-3">
                To the maximum extent permitted by law, Collision Academy and its affiliates,
                owners, officers, employees, contractors, and service providers will not be liable
                for indirect, incidental, special, consequential, exemplary, or punitive damages,
                or for lost profits, lost data, business interruption, claim outcomes, repair
                decisions, or reliance on any chatbot or report output arising out of or related to
                your use of the services.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white">10. Indemnification</h2>
              <p className="mt-3">
                You agree to defend, indemnify, and hold harmless Collision Academy and its
                affiliates, owners, officers, employees, contractors, and service providers from
                claims, damages, liabilities, losses, and expenses arising from your use of the
                services, your content, your violation of these Terms, or your violation of any
                law or third-party right.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white">11. Governing Law</h2>
              <p className="mt-3">
                These Terms are governed by the laws of the Commonwealth of Pennsylvania, without
                regard to conflict-of-law rules, except to the extent superseded by applicable
                federal law.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white">12. Contact</h2>
              <p className="mt-3">
                Questions about these Terms may be directed through the contact information made
                available on the Collision Academy website.
              </p>
              <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-white/75">
                <p>Collision Academy</p>
                <p>991 Lancaster Ave Berwyn PA 19312</p>
                <p>help.desk@collision.academy</p>
                <p>+1 (267) 983-8615</p>
              </div>
            </section>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-4 text-sm text-white/60">
          <Link href="/" className="hover:text-white transition">
            ← Back to home
          </Link>
          <span className="opacity-30">•</span>
          <Link href="/privacy" className="hover:text-white transition">
            Privacy Policy
          </Link>
          <span className="opacity-30">•</span>
          <Link href="/chatbot" className="hover:text-white transition">
            Collision IQ
          </Link>
        </div>
      </section>
    </main>
  );
}
