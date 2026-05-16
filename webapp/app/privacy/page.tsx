import Link from "next/link";
import Logo from "@/components/Logo";

export const metadata = {
  title: "Privacy Policy — Email Finder",
  description: "How Email Finder collects, uses, and protects your data.",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-bold text-slate-900">{title}</h2>
      <div className="space-y-3 text-sm text-slate-600 leading-relaxed">{children}</div>
    </section>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-semibold text-slate-800 mt-4">{children}</h3>;
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-slate-100">
        <div className="max-w-3xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <Logo size={28} />
            <span className="font-semibold text-slate-900 text-sm">Email Finder</span>
          </Link>
          <Link href="/login" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
            Sign in
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10 space-y-10">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Privacy Policy</h1>
          <p className="text-sm text-slate-400">Last updated: 16 May 2026</p>
        </div>

        <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 text-sm text-slate-700 leading-relaxed">
          This policy explains what data Email Finder (&ldquo;we&rdquo;, &ldquo;us&rdquo;) collects when you
          use this service, why we collect it, how long we keep it, and the rights you
          have over it under the EU General Data Protection Regulation (GDPR), the UK
          GDPR, and the California Consumer Privacy Act (CCPA).
        </div>

        <Section title="1. Who we are">
          <p>
            Email Finder is operated by the service owner accessible via{" "}
            <a href="mailto:privacy@mailcheckhq.com" className="text-blue-600 hover:underline">
              privacy@mailcheckhq.com
            </a>
            . For the purposes of GDPR, we act as the <strong>data controller</strong> for
            account data and as a <strong>data processor</strong> when verifying email
            addresses on behalf of our users.
          </p>
        </Section>

        <Section title="2. What we collect">
          <SubHeading>Account data</SubHeading>
          <p>
            When you create an account, we collect: your email address, a hashed password
            (we never see your password in plain text), and an API key issued to you. This
            is stored in Supabase (see &ldquo;Sub-processors&rdquo; below).
          </p>

          <SubHeading>Service input</SubHeading>
          <p>
            When you submit a lookup, we receive and process: first name, last name,
            optional middle name, and target domain. We generate likely email permutations
            from this and verify them against the destination mail server.
          </p>

          <SubHeading>Service output</SubHeading>
          <p>
            We cache verification results (verified email addresses and catch-all domain
            status) on our servers to reduce duplicate work and to keep response times
            fast. See &ldquo;Retention&rdquo; for how long we keep this.
          </p>

          <SubHeading>Technical data</SubHeading>
          <p>
            Each request is logged with a timestamp, the calling API key, the target
            domain, and the verification outcome. We also log infrastructure-level data
            (IP address, response codes) for security and abuse prevention.
          </p>

          <SubHeading>Optional third-party keys</SubHeading>
          <p>
            If you choose to verify via ZeroBounce or Reoon, you provide that provider&apos;s
            API key. These keys are stored only in your browser&apos;s local storage and are
            sent to our server with each request so we can call the provider on your
            behalf. We do not persist them on our servers.
          </p>

          <SubHeading>Browser local storage</SubHeading>
          <p>
            We use your browser&apos;s <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">localStorage</code>{" "}
            to store: your API key, your provider preference, third-party verifier API
            keys (if any), and your lookup history. This data never leaves your browser
            unless you submit a lookup; you can clear it from Settings or from your
            browser&apos;s developer tools at any time.
          </p>
        </Section>

        <Section title="3. Why we process it (lawful basis under GDPR)">
          <p>We rely on the following lawful bases:</p>
          <ul className="list-disc pl-5 space-y-2">
            <li>
              <strong>Contractual necessity</strong> (Art. 6(1)(b)): to provide the
              account, API access, and the email verification service you have signed up
              for.
            </li>
            <li>
              <strong>Legitimate interest</strong> (Art. 6(1)(f)): to operate, secure, and
              debug the service, prevent abuse and fraud, enforce rate limits, and
              maintain logs for a short period.
            </li>
            <li>
              <strong>Consent</strong> (Art. 6(1)(a)): when you opt in to ZeroBounce or
              Reoon by entering their API keys in Settings, you consent to your lookup
              data being sent to that provider.
            </li>
          </ul>
        </Section>

        <Section title="4. Sub-processors">
          <p>
            We use the following sub-processors to operate the service. Each is bound by a
            Data Processing Agreement and/or Standard Contractual Clauses where required.
          </p>
          <div className="rounded-lg border border-slate-200 overflow-hidden text-sm">
            <table className="w-full">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Provider</th>
                  <th className="text-left px-4 py-2 font-medium">Purpose</th>
                  <th className="text-left px-4 py-2 font-medium">Location</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                <tr>
                  <td className="px-4 py-2">Vercel Inc.</td>
                  <td className="px-4 py-2">Frontend hosting</td>
                  <td className="px-4 py-2">USA (with EU edge)</td>
                </tr>
                <tr>
                  <td className="px-4 py-2">Supabase Inc.</td>
                  <td className="px-4 py-2">Authentication, user database</td>
                  <td className="px-4 py-2">EU / USA</td>
                </tr>
                <tr>
                  <td className="px-4 py-2">Hetzner Online GmbH</td>
                  <td className="px-4 py-2">Backend compute, cache database</td>
                  <td className="px-4 py-2">Germany (EU)</td>
                </tr>
                <tr>
                  <td className="px-4 py-2">ZeroBounce Inc. (optional)</td>
                  <td className="px-4 py-2">Third-party email verification</td>
                  <td className="px-4 py-2">USA</td>
                </tr>
                <tr>
                  <td className="px-4 py-2">Reoon Technologies (optional)</td>
                  <td className="px-4 py-2">Third-party email verification</td>
                  <td className="px-4 py-2">USA</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-400">
            We do not sell or share your data with any party for advertising or marketing
            purposes.
          </p>
        </Section>

        <Section title="5. Retention">
          <div className="rounded-lg border border-slate-200 overflow-hidden text-sm">
            <table className="w-full">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Data</th>
                  <th className="text-left px-4 py-2 font-medium">Retention</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                <tr>
                  <td className="px-4 py-2">Account data</td>
                  <td className="px-4 py-2">Until you delete your account</td>
                </tr>
                <tr>
                  <td className="px-4 py-2">Verified-email cache</td>
                  <td className="px-4 py-2">14 days from last verification</td>
                </tr>
                <tr>
                  <td className="px-4 py-2">Catch-all domain cache</td>
                  <td className="px-4 py-2">30 days</td>
                </tr>
                <tr>
                  <td className="px-4 py-2">Server logs</td>
                  <td className="px-4 py-2">14 days</td>
                </tr>
                <tr>
                  <td className="px-4 py-2">Lookup history</td>
                  <td className="px-4 py-2">In your browser only — cleared when you clear it</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            Expired cache rows are deleted automatically by a daily background task. Logs
            past the retention window are removed by the operating system journal.
          </p>
        </Section>

        <Section title="6. International data transfers">
          <p>
            Our primary processing happens in Germany (Hetzner). When data is processed by
            sub-processors in the United States (Vercel, Supabase US instance, optional
            providers), we rely on Standard Contractual Clauses (SCCs) and supplementary
            measures as required by Schrems II and EDPB guidance.
          </p>
        </Section>

        <Section title="7. Your rights">
          <p>
            Under GDPR, UK GDPR, and CCPA you have the following rights with respect to
            your personal data:
          </p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li><strong>Access</strong> — request a copy of the data we hold about you.</li>
            <li><strong>Rectification</strong> — ask us to correct inaccurate data.</li>
            <li><strong>Erasure</strong> (&ldquo;right to be forgotten&rdquo;) — ask us to delete your data.</li>
            <li><strong>Restriction</strong> — ask us to pause processing while a dispute is resolved.</li>
            <li><strong>Portability</strong> — receive your data in a machine-readable format.</li>
            <li><strong>Objection</strong> — object to processing based on legitimate interest.</li>
            <li><strong>Withdraw consent</strong> — remove your third-party verifier keys at any time in Settings.</li>
            <li><strong>Complaint</strong> — lodge a complaint with your local supervisory authority (e.g. the ICO in the UK, your national DPA in the EU).</li>
          </ul>
          <p>
            To exercise any of these rights, email{" "}
            <a href="mailto:privacy@mailcheckhq.com" className="text-blue-600 hover:underline">
              privacy@mailcheckhq.com
            </a>{" "}
            from the address linked to your account. We respond within 30 days, as
            required by Article 12(3) of the GDPR. We may ask for additional verification
            to confirm your identity before fulfilling the request.
          </p>
        </Section>

        <Section title="8. Security">
          <p>We apply the following safeguards:</p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>All traffic is encrypted with TLS 1.2+ in transit.</li>
            <li>API keys are required for every verification endpoint and rate-limited per key.</li>
            <li>Passwords are hashed by Supabase using bcrypt; we never see them.</li>
            <li>Database access is restricted to the application service account.</li>
            <li>Errors and exceptions are logged server-side; client responses do not leak internal details.</li>
            <li>Sub-processors in the EU/US are bound by DPAs and SCCs.</li>
          </ul>
          <p>
            No system is 100% secure. If we discover a breach affecting your data, we will
            notify you and the relevant supervisory authority within 72 hours where
            required by Article 33 of the GDPR.
          </p>
        </Section>

        <Section title="9. Cookies and tracking">
          <p>
            We use a small number of essential cookies set by Supabase to keep you signed
            in. We do <strong>not</strong> use analytics, advertising, fingerprinting, or
            cross-site tracking cookies. We do not embed third-party tracking pixels.
          </p>
          <p>
            Your browser&apos;s local storage holds your API key, settings, and lookup history,
            as described in section 2.
          </p>
        </Section>

        <Section title="10. Children">
          <p>
            The service is not directed to anyone under 16. We do not knowingly collect
            data from children. If you believe a child has provided us data, contact us
            and we will delete it.
          </p>
        </Section>

        <Section title="11. Use of email-verification results">
          <p>
            You are responsible for ensuring your own use of verified email addresses
            complies with applicable laws — including but not limited to GDPR, CAN-SPAM,
            CASL, and ePrivacy. Email Finder is a verification utility; it does not grant
            you a legal basis to email anyone.
          </p>
        </Section>

        <Section title="12. Changes to this policy">
          <p>
            We may update this policy from time to time. Material changes will be notified
            to registered users by email at least 14 days before they take effect. The
            &ldquo;Last updated&rdquo; date at the top of this page always reflects the
            current version.
          </p>
        </Section>

        <Section title="13. Contact">
          <p>
            Privacy questions, data-subject requests, or breach reports:{" "}
            <a href="mailto:privacy@mailcheckhq.com" className="text-blue-600 hover:underline">
              privacy@mailcheckhq.com
            </a>
          </p>
        </Section>

        <footer className="border-t border-slate-100 pt-6 text-xs text-slate-400">
          <Link href="/" className="hover:text-slate-600 transition-colors">← Back to Email Finder</Link>
        </footer>
      </main>
    </div>
  );
}
