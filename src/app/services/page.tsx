import Link from "next/link";

export default function ServicesPage() {
  return (
    <main className="max-w-6xl mx-auto px-6 py-16 text-black dark:text-white">
      {/* Hero */}
      <section className="mb-16">
        <h1 className="text-4xl md:text-5xl font-bold mb-6">
          Collision Academy Services
        </h1>
        <p className="text-lg max-w-3xl text-black/70 dark:text-white/70">
          Professional-grade vehicle valuation, appraisal support, and OEM-aligned
          documentation designed to help policyholders and repair centers navigate
          complex insurance claims with confidence.
        </p>
      </section>

      {/* Services */}
      <section className="grid md:grid-cols-3 gap-8 mb-20">
        {/* Diminished Value */}
        <div className="rounded-2xl border border-black/10 dark:border-white/10 p-6 bg-black/5 dark:bg-white/5">
          <h2 className="text-xl font-semibold mb-3">Diminished Value</h2>
          <p className="mb-4 text-sm text-black/70 dark:text-white/70">
            Market-based diminished value documentation used to support post-repair
            loss claims when a vehicle’s value is impacted by an accident.
          </p>
          <ul className="text-sm space-y-2 mb-6">
            <li>• Independent market analysis</li>
            <li>• Insurer-ready documentation</li>
            <li>• Support for negotiation and review</li>
          </ul>
          <p className="text-sm font-medium mb-4">
            Typical pricing varies by vehicle and complexity.
          </p>
          <Link
            href="/upload"
            className="inline-block text-sm font-semibold text-orange-600 hover:underline"
          >
            Start intake →
          </Link>
        </div>

        {/* Total Loss Value Dispute */}
        <div className="rounded-2xl border border-black/10 dark:border-white/10 p-6 bg-black/5 dark:bg-white/5">
          <h2 className="text-xl font-semibold mb-3">
            Total Loss Value Dispute
          </h2>
          <p className="mb-4 text-sm text-black/70 dark:text-white/70">
            Comprehensive valuation review and rebuttal support when a total loss
            settlement does not accurately reflect market value.
          </p>
          <ul className="text-sm space-y-2 mb-6">
            <li>• Comparable vehicle research</li>
            <li>• Adjuster-facing valuation review</li>
            <li>• Clear documentation for dispute</li>
          </ul>
          <p className="text-sm font-medium mb-4">
            Pricing depends on valuation scope and market complexity.
          </p>
          <Link
            href="/upload"
            className="inline-block text-sm font-semibold text-orange-600 hover:underline"
          >
            Start intake →
          </Link>
        </div>
// This page is the source of truth for all Collision Academy services.
// Chatbot and intake flows should reference this content.
        {/* Right to Appraisal */}
        <div className="rounded-2xl border border-black/10 dark:border-white/10 p-6 bg-black/5 dark:bg-white/5">
          <h2 className="text-xl font-semibold mb-3">Right to Appraisal</h2>
          <p className="mb-4 text-sm text-black/70 dark:text-white/70">
            Process guidance and documentation support for policyholders invoking
            the appraisal clause within their insurance policy.
          </p>
          <ul className="text-sm space-y-2 mb-6">
            <li>• Appraisal process guidance</li>
            <li>• Documentation packet preparation</li>
            <li>• Support through the appraisal timeline</li>
          </ul>
          <p className="text-sm font-medium mb-4">
            Fees vary depending on claim scope and documentation needs.
          </p>
          <Link
            href="/upload"
            className="inline-block text-sm font-semibold text-orange-600 hover:underline"
          >
            Start intake →
          </Link>
        </div>
      </section>

      {/* Who This Is For */}
      <section className="mb-20">
        <h2 className="text-2xl font-semibold mb-6">Who We Support</h2>
        <div className="grid md:grid-cols-2 gap-8">
          <div>
            <h3 className="font-semibold mb-2">Policyholders</h3>
            <p className="text-sm text-black/70 dark:text-white/70">
              Vehicle owners seeking accurate valuations, fair settlements, and
              documentation that supports their claim when insurer practices fall short.
            </p>
          </div>
          <div>
            <h3 className="font-semibold mb-2">Repair Centers</h3>
            <p className="text-sm text-black/70 dark:text-white/70">
              Collision repair facilities requiring OEM-aligned documentation and
              valuation support to ensure proper repairs and informed negotiations.
            </p>
          </div>
        </div>
      </section>

      {/* Process */}
      <section className="mb-20">
        <h2 className="text-2xl font-semibold mb-6">How It Works</h2>
        <ol className="grid md:grid-cols-4 gap-6 text-sm">
          <li className="rounded-xl border border-black/10 dark:border-white/10 p-4">
            <strong>1. Choose a service</strong>
            <p className="mt-2 text-black/70 dark:text-white/70">
              Select the service that fits your claim or repair scenario.
            </p>
          </li>
          <li className="rounded-xl border border-black/10 dark:border-white/10 p-4">
            <strong>2. Upload documentation</strong>
            <p className="mt-2 text-black/70 dark:text-white/70">
              Provide photos, estimates, reports, and related documents.
            </p>
          </li>
          <li className="rounded-xl border border-black/10 dark:border-white/10 p-4">
            <strong>3. Review & analysis</strong>
            <p className="mt-2 text-black/70 dark:text-white/70">
              We evaluate the claim using market data and OEM guidance.
            </p>
          </li>
          <li className="rounded-xl border border-black/10 dark:border-white/10 p-4">
            <strong>4. Deliverables</strong>
            <p className="mt-2 text-black/70 dark:text-white/70">
              Receive clear documentation and next-step guidance.
            </p>
          </li>
        </ol>
      </section>

      {/* CTA */}
      <section className="text-center">
        <h2 className="text-2xl font-semibold mb-4">
          Not sure which service you need?
        </h2>
        <p className="text-sm text-black/70 dark:text-white/70 mb-6">
          Collision IQ can help guide you to the right next step.
        </p>
        <Link
          href="/"
          className="inline-block px-6 py-3 rounded-xl bg-orange-500 text-black font-semibold hover:bg-orange-600"
        >
          Talk to Collision IQ
        </Link>
      </section>
    </main>
  );
}
