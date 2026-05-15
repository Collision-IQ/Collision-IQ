import Link from "next/link";

const EFFECTIVE_DATE = "March 28, 2026";
const LAST_UPDATED = "March 28, 2026";

export default function PrivacyPage() {
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
                Privacy Policy
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/70 md:text-base">
                This Privacy Policy explains how Collision Academy collects, uses,
                discloses, retains, and safeguards information obtained through our
                website, Collision IQ, chatbot features, and related services.
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70">
              <div>Effective date: {EFFECTIVE_DATE}</div>
              <div>Last updated: {LAST_UPDATED}</div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-5 py-10 md:py-14">
        <div className="rounded-3xl border border-white/10 bg-black/30 p-6 shadow-[0_25px_80px_rgba(0,0,0,0.55)] backdrop-blur-xl md:p-8">
          <div className="space-y-10 text-sm leading-7 text-white/80 md:text-base">
            <section>
              <p>
                Collision Academy (&quot;Collision Academy,&quot; &quot;Company,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) is
                committed to protecting personal information. This Privacy Policy describes how we
                collect, use, disclose, retain, and safeguard information obtained through
                <span className="text-white"> https://www.collision.academy </span>
                and any chatbot, artificial-intelligence-enabled tool, document-analysis feature,
                export tool, application, communication, or related service that links to or
                references this Privacy Policy (collectively, the &quot;Services&quot;).
              </p>
              <p className="mt-3">
                By accessing or using the Services, you acknowledge that you have read and
                understood this Privacy Policy and consent to the collection, use, disclosure, and
                processing of information as described herein, to the extent permitted by applicable
                law.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white">1. Scope of This Privacy Policy</h2>
              <p className="mt-3">
                This Privacy Policy applies to information collected by or on behalf of Collision
                Academy in connection with your access to and use of the Services. It does not apply
                to information collected offline except where expressly stated, nor does it apply to
                third-party websites, platforms, services, or applications that may be linked from
                or integrated with the Services but are not owned or controlled by us.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white">2. Categories of Information We Collect</h2>
              <div className="mt-3 space-y-4">
                <p>
                  <span className="font-semibold text-white">Information you provide voluntarily.</span>{" "}
                  We may collect information that you provide directly to us, including your name,
                  email address, telephone number, mailing address, billing information, account
                  credentials, payment information, and other information you choose to submit
                  through forms, account registration, purchases, customer-service communications,
                  chatbot interactions, surveys, promotions, or other features of the Services.
                </p>
                <p>
                  <span className="font-semibold text-white">Chatbot and user-generated content.</span>{" "}
                  When you interact with Collision IQ or other AI-enabled features, we may collect
                  the contents of your prompts, messages, responses, uploaded files, estimates,
                  PDFs, images, attachments, feedback submissions, exports, and related
                  communications, together with information necessary to process and respond to such
                  interactions.
                </p>
                <p>
                  <span className="font-semibold text-white">Automatically collected information.</span>{" "}
                  When you access or use the Services, we and our service providers may
                  automatically collect certain technical and usage information, including Internet
                  Protocol address, browser type, browser settings, device type, device identifiers,
                  operating system, language preferences, access times, referring URLs, pages
                  viewed, links clicked, session activity, approximate geolocation inferred from IP
                  address, and similar diagnostic or analytics information.
                </p>
                <p>
                  <span className="font-semibold text-white">Cookies and similar technologies.</span>{" "}
                  We may collect information through cookies, pixels, tags, local storage objects,
                  software development kits, and similar technologies used for security,
                  authentication, analytics, functionality, personalization, and performance
                  measurement.
                </p>
                <p>
                  <span className="font-semibold text-white">Information from other sources.</span>{" "}
                  We may receive information about you from affiliates, service providers,
                  authentication providers, analytics vendors, payment processors, public databases,
                  social-media platforms, and other third parties, to the extent permitted by law.
                </p>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white">3. Purposes for Which We Use Information</h2>
              <ul className="mt-3 list-disc space-y-2 pl-6">
                <li>Provide, maintain, operate, support, troubleshoot, and improve the Services.</li>
                <li>Establish, administer, and secure user accounts.</li>
                <li>Process transactions and fulfill orders.</li>
                <li>Respond to inquiries, requests, and customer-service communications.</li>
                <li>Facilitate and maintain chatbot and AI-enabled interactions.</li>
                <li>Personalize content, functionality, and user experience.</li>
                <li>Monitor and analyze usage, trends, and performance of the Services.</li>
                <li>Develop, test, validate, improve, and maintain our systems, models, algorithms, and related technologies, unless otherwise restricted by law or contract.</li>
                <li>Detect, investigate, prevent, and remediate fraud, abuse, harassment, unlawful conduct, security incidents, and violations of our Terms or policies.</li>
                <li>Protect the rights, property, safety, and security of Collision Academy, our users, personnel, partners, and the public.</li>
                <li>Comply with legal, regulatory, contractual, and enforcement obligations.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white">4. Artificial Intelligence and Chatbot Disclosures</h2>
              <div className="mt-3 space-y-4">
                <p>
                  The Services may include chatbot, machine-learning, or other artificial-
                  intelligence-assisted features. When you interact with such features, you
                  acknowledge that you may be interacting with an automated system rather than a
                  live human representative.
                </p>
                <p>
                  Information submitted through chatbot or AI-enabled features may be recorded,
                  stored, reviewed, analyzed, and used by Collision Academy and its service
                  providers for purposes including response generation, service delivery, quality
                  assurance, debugging, safety monitoring, compliance, abuse prevention, and system
                  improvement.
                </p>
                <p>
                  Because chatbot interactions may be processed by automated systems and reviewed by
                  personnel as appropriate, users should refrain from submitting highly sensitive
                  information unless such submission is necessary for the requested service and the
                  user knowingly elects to provide such information.
                </p>
                <p>
                  We reserve the right, but not the obligation, to monitor, moderate, filter,
                  block, escalate, or terminate chatbot interactions that may present safety,
                  legal, regulatory, reputational, or operational risk.
                </p>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white">5. Legal Bases and Permitted Processing</h2>
              <p className="mt-3">
                To the extent applicable law requires a legal basis for processing, we process
                information on grounds including performance of a contract, compliance with legal
                obligations, legitimate business interests, protection of vital interests, and
                consent where required. Nothing in this Privacy Policy limits any other lawful basis
                upon which we may rely under applicable law.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white">6. Disclosure of Information</h2>
              <div className="mt-3 space-y-4">
                <p>
                  <span className="font-semibold text-white">Service providers and vendors.</span>{" "}
                  We may disclose information to third-party vendors, contractors, consultants,
                  payment processors, hosting providers, analytics providers, cloud-service
                  providers, customer-support providers, security providers, AI or automation
                  providers, and other service providers that perform services on our behalf and
                  are authorized to use such information only as necessary to provide services to us
                  or as otherwise permitted by law.
                </p>
                <p>
                  <span className="font-semibold text-white">Affiliates and corporate transactions.</span>{" "}
                  We may disclose information to our parent companies, subsidiaries, affiliates,
                  and related entities for lawful business purposes. We may also disclose or
                  transfer information in connection with an actual or proposed merger,
                  acquisition, financing, restructuring, sale of assets, bankruptcy, dissolution,
                  or other corporate transaction.
                </p>
                <p>
                  <span className="font-semibold text-white">Legal process and protection of rights.</span>{" "}
                  We may disclose information where we determine, in our sole discretion, that
                  such disclosure is necessary or appropriate to comply with applicable law,
                  regulation, legal process, subpoena, court order, governmental request, or
                  law-enforcement inquiry, or to protect the rights, property, safety, and
                  security of Collision Academy, our users, or others.
                </p>
                <p>
                  <span className="font-semibold text-white">With consent or direction.</span>{" "}
                  We may disclose information with your consent, at your direction, or as otherwise
                  disclosed at the time the information is collected.
                </p>
                <p>
                  Except as expressly disclosed elsewhere in this Privacy Policy or in a
                  supplemental notice, we do not represent that we &quot;sell&quot; personal information for
                  monetary consideration.
                </p>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white">7. Cookies, Analytics, and Similar Technologies</h2>
              <p className="mt-3">
                The Services may use cookies and similar technologies for authentication, session
                management, fraud prevention, performance monitoring, analytics, feature
                enablement, and user-preference retention. Users may be able to manage certain
                cookies through browser settings or device controls; however, disabling cookies or
                similar technologies may impair the functionality or availability of portions of
                the Services.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white">8. Data Retention</h2>
              <p className="mt-3">
                We retain personal information for as long as reasonably necessary to fulfill the
                purposes for which it was collected, including to provide the Services, maintain
                business records, resolve disputes, enforce agreements, satisfy legal or regulatory
                obligations, investigate incidents, and protect the security and integrity of the
                Services. Retention periods may vary depending on the nature of the information, the
                context in which it was collected, and applicable legal requirements.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white">9. Data Security</h2>
              <p className="mt-3">
                We implement reasonable administrative, technical, and physical safeguards designed
                to protect personal information against unauthorized access, acquisition,
                disclosure, alteration, misuse, and destruction. However, no transmission of data
                over the Internet or method of electronic storage can be guaranteed to be fully
                secure. Accordingly, we cannot and do not warrant or guarantee the absolute
                security of any information.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white">10. Children&apos;s Privacy</h2>
              <p className="mt-3">
                The Services are not directed to children under the age of thirteen (13) unless
                expressly stated otherwise. We do not knowingly collect personal information from
                children under 13 without any notice to and consent from a parent or guardian
                required by applicable law. If we become aware that we have collected personal
                information from a child in a manner inconsistent with applicable law, we will take
                commercially reasonable steps to investigate and, where appropriate, delete such
                information or otherwise bring our practices into compliance.
              </p>
              <p className="mt-3">
                If the Services are accessed by minors, parents and legal guardians are encouraged
                to supervise such use.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white">11. Pennsylvania and AI-Related Notice</h2>
              <p className="mt-3">
                Collision Academy may provide chatbot and AI-enabled functionality to users located
                in Pennsylvania. To the extent any Pennsylvania law, including any enacted
                successor to Senate Bill 1090 or similar legislation concerning AI companion
                technologies, applies to all or part of the Services, we may provide additional
                notices, operational safeguards, safety protocols, age-based restrictions,
                escalation procedures, or crisis-related disclosures as necessary or appropriate
                for legal compliance and user protection.
              </p>
              <p className="mt-3">
                Nothing in this Privacy Policy shall be construed as an admission that the Services
                constitute an &quot;AI companion&quot; or are otherwise subject to any specific Pennsylvania
                artificial-intelligence statute unless and until such applicability is established.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white">12. Third-Party Services and External Links</h2>
              <p className="mt-3">
                The Services may contain links to third-party websites, plug-ins, integrations, or
                services that are not owned or controlled by Collision Academy. We are not
                responsible for the privacy, security, or data-handling practices of such third
                parties. Users should review the applicable privacy policies and terms of any
                third-party service before providing information or interacting with those services.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white">13. Changes to This Privacy Policy</h2>
              <p className="mt-3">
                We may revise this Privacy Policy from time to time in our sole discretion. When we
                do, we may update the &quot;Last updated&quot; date above and take other steps as required by
                applicable law. Your continued use of the Services after an updated Privacy Policy
                becomes effective constitutes your acknowledgment of the revised policy, to the
                extent permitted by law.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white">14. Contact</h2>
              <p className="mt-3">
                Questions regarding this Privacy Policy or our privacy practices may be directed
                through the contact information made available on the Collision Academy website.
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
          <Link href="/" className="transition hover:text-white">
            {"<-"} Back to home
          </Link>
          <span className="opacity-30">/</span>
          <Link href="/terms" className="transition hover:text-white">
            Terms of Service
          </Link>
          <span className="opacity-30">/</span>
          <Link href="/" className="transition hover:text-white">
            Collision IQ
          </Link>
        </div>
      </section>
    </main>
  );
}
