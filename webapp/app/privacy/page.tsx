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

        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-slate-700 leading-relaxed">
          <strong className="text-amber-900">Early access notice.</strong> Email Finder is
          a B2B email verification utility currently in early access. We process business
          contact data on behalf of our customers, who are responsible for ensuring their
          own use of verified email addresses complies with applicable law. Our practices
          and this policy will continue to evolve; material changes will be communicated
          to registered users in advance.
        </div>

        <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 text-sm text-slate-700 leading-relaxed">
          This policy explains what data Email Finder (&ldquo;we&rdquo;, &ldquo;us&rdquo;) collects when you
          use this service, why we collect it, how long we keep it, and the rights you
          have over it under the EU General Data Protection Regulation (GDPR), the UK
          GDPR, the California Consumer Privacy Act / California Privacy Rights Act
          (CCPA/CPRA), and other applicable data-protection laws.
        </div>

        <Section title="1. Who we are">
          <p>
            Email Finder (&ldquo;the Service&rdquo;) is operated by{" "}
            <span className="bg-yellow-100 px-1 rounded">[Operator Legal Entity]</span>,
            registered at{" "}
            <span className="bg-yellow-100 px-1 rounded">[Registered Address]</span>{" "}
            (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;). You can contact us at{" "}
            <a href="mailto:privacy@mailcheckhq.com" className="text-blue-600 hover:underline">
              privacy@mailcheckhq.com
            </a>
            .
          </p>
          <p>
            For account data, we act as the <strong>data controller</strong>. For the
            email addresses you submit for verification, we generally act as a{" "}
            <strong>controller</strong> in the absence of a separate Data Processing
            Agreement (DPA) with you. If you require a DPA (e.g. for enterprise B2B use),
            contact us at the address above.
          </p>
          <p>
            <strong>Data Protection Officer.</strong> Given the current size and scope of
            our processing activities, we are not required under GDPR Art. 37 to designate
            a formal Data Protection Officer. Privacy matters are handled directly by our
            operator via the contact email above. If our processing scale or sensitivity
            changes such that a DPO is required, we will appoint one and update this
            policy.
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
            keys (if any), and your lookup history. These items remain in your browser
            and are only transmitted to our servers as part of the requests you
            explicitly submit. You can clear them from Settings or from your browser&apos;s
            developer tools at any time.
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
          <p>
            <strong>Sub-processor changes.</strong> Where we have a Data Processing
            Agreement in place with you, we will give you at least 30 days&apos; advance
            notice before adding or replacing a sub-processor. Other users will be
            notified via an update to this page. You may object to a new sub-processor by
            contacting us at the address above; if we cannot accommodate your objection,
            you may terminate your account.
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
                  <td className="px-4 py-2">Until you delete your account (see &ldquo;Deleting your account&rdquo; below)</td>
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
                  <td className="px-4 py-2">Encrypted database backups</td>
                  <td className="px-4 py-2">Up to 30 days, then rotated</td>
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
            Database backups are encrypted at rest and rotated on a 30-day cycle; deletion
            requests are honored on live systems immediately and propagate to backups
            within that rotation window.
          </p>
          <SubHeading>Deleting your account</SubHeading>
          <p>
            You can request account deletion at any time by emailing{" "}
            <a href="mailto:privacy@mailcheckhq.com" className="text-blue-600 hover:underline">
              privacy@mailcheckhq.com
            </a>{" "}
            from the address linked to your account. We delete your account record, API
            key, and any associated cache entries within 30 days of receiving a verified
            request, and confirm in writing once complete. Anonymized aggregate metrics
            (e.g. total request counts) may be retained.
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

        <Section title="7. Your rights (GDPR / UK GDPR)">
          <p>
            If you are in the European Economic Area or the United Kingdom, you have the
            following rights with respect to your personal data:
          </p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li><strong>Access</strong> — request a copy of the data we hold about you.</li>
            <li><strong>Rectification</strong> — ask us to correct inaccurate data.</li>
            <li><strong>Erasure</strong> (&ldquo;right to be forgotten&rdquo;) — ask us to delete your data.</li>
            <li><strong>Restriction</strong> — ask us to pause processing while a dispute is resolved.</li>
            <li><strong>Portability</strong> — receive your data in a machine-readable format (JSON).</li>
            <li><strong>Objection</strong> — object to processing based on legitimate interest.</li>
            <li><strong>Withdraw consent</strong> — remove your third-party verifier keys at any time in Settings.</li>
            <li><strong>Not be subject to automated decisions</strong> (Art. 22) — the Service performs automated email verification but does not produce decisions with legal or similarly significant effects on you; you may still object as above.</li>
            <li><strong>Compensation</strong> (Art. 82) — claim damages from any unlawful processing that caused you harm.</li>
            <li><strong>Complaint</strong> — lodge a complaint with your local supervisory authority (e.g. the ICO in the UK, your national DPA in the EU).</li>
          </ul>
          <p>
            To exercise any of these rights, email{" "}
            <a href="mailto:privacy@mailcheckhq.com" className="text-blue-600 hover:underline">
              privacy@mailcheckhq.com
            </a>{" "}
            from the address linked to your account. We respond within 30 days, as
            required by Article 12(3) of the GDPR. For complex requests we may extend
            this by up to a further 60 days, in which case we will tell you within the
            first 30 days and explain why. We may ask for additional verification to
            confirm your identity before fulfilling the request.
          </p>
        </Section>

        <Section title="8. California residents (CCPA / CPRA)">
          <p>
            If you are a California resident, the California Consumer Privacy Act, as
            amended by the California Privacy Rights Act, gives you additional rights and
            requires us to make the following disclosures.
          </p>

          <SubHeading>Categories of personal information we collect</SubHeading>
          <p>
            In the past twelve (12) months, we have collected the following categories of
            personal information, as defined by Cal. Civ. Code § 1798.140:
          </p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li><strong>Identifiers</strong> — account email, API key, IP address.</li>
            <li><strong>Customer records information</strong> (Cal. Civ. Code § 1798.80(e)) — name fragments (first/last/middle) and email addresses submitted for verification.</li>
            <li><strong>Commercial information</strong> — records of verification requests and their outcomes.</li>
            <li><strong>Internet or other electronic network activity</strong> — request logs, timestamps, response codes.</li>
            <li><strong>Inferences</strong> — verification status (verified / catch-all / not found) and detected mail provider.</li>
          </ul>
          <p>
            We do <strong>not</strong> collect categories of sensitive personal
            information (e.g. government IDs, precise geolocation, biometrics, contents of
            mail/email/SMS, race, religion, health, sexual orientation, union membership).
          </p>

          <SubHeading>Sources of personal information</SubHeading>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>Directly from you (account sign-up, lookups you submit).</li>
            <li>From your device (IP address, user agent).</li>
            <li>From destination mail servers (SMTP responses indicating whether a mailbox exists).</li>
            <li>From optional third-party verifiers if you opt in (ZeroBounce, Reoon).</li>
          </ul>

          <SubHeading>Business purposes for which we use it</SubHeading>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>Providing the Service and fulfilling your verification requests.</li>
            <li>Account management and authentication.</li>
            <li>Security, abuse prevention, and rate-limit enforcement.</li>
            <li>Debugging, maintenance, and improving the Service.</li>
            <li>Complying with legal obligations.</li>
          </ul>

          <SubHeading>Sale or sharing of personal information</SubHeading>
          <p>
            <strong>
              We do not sell your personal information, and we do not share it for
              cross-context behavioral advertising.
            </strong>{" "}
            We have not sold or shared personal information in the preceding 12 months.
            There is therefore no &ldquo;Do Not Sell or Share My Personal Information&rdquo;
            link required, but you may still exercise the rights below at any time.
          </p>

          <SubHeading>Your California rights</SubHeading>
          <ul className="list-disc pl-5 space-y-1.5">
            <li><strong>Right to know</strong> — request disclosure of the specific personal information we have collected about you in the past 12 months.</li>
            <li><strong>Right to delete</strong> — request deletion of personal information we collected from you, subject to permitted exceptions.</li>
            <li><strong>Right to correct</strong> — request that we correct inaccurate personal information.</li>
            <li><strong>Right to opt out of sale/sharing</strong> — not applicable, as we do not sell or share (see above).</li>
            <li><strong>Right to limit use of sensitive personal information</strong> — not applicable, as we do not collect such information.</li>
            <li><strong>Right to non-discrimination</strong> — we will not deny you service, charge you a different price, or provide a different level of quality for exercising any of these rights.</li>
            <li><strong>Authorized agent</strong> — you may use an authorized agent to make a request on your behalf, with written permission and verification.</li>
          </ul>
          <p>
            To exercise any California right, email{" "}
            <a href="mailto:privacy@mailcheckhq.com" className="text-blue-600 hover:underline">
              privacy@mailcheckhq.com
            </a>{" "}
            with subject line &ldquo;California Privacy Request&rdquo;. We respond within
            45 days, with a one-time 45-day extension where reasonably necessary.
          </p>
        </Section>

        <Section title="9. Security">
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

        <Section title="10. Cookies and tracking">
          <p>
            We use a small number of essential cookies set by Supabase to keep you signed
            in. We do <strong>not</strong> use analytics, advertising, fingerprinting, or
            cross-site tracking cookies. We do not embed third-party tracking pixels.
          </p>
          <p>
            Your browser&apos;s local storage holds your API key, settings, and lookup
            history, as described in &ldquo;What we collect&rdquo; above.
          </p>
        </Section>

        <Section title="11. Children">
          <p>
            The Service is not directed to children. We do not knowingly collect personal
            data from anyone under 16, or the lower minimum age permitted in your
            jurisdiction (13 in the United States and certain EU member states). If you
            believe a child has provided us data, contact us and we will delete it.
          </p>
        </Section>

        <Section title="12. Use of email-verification results">
          <p>
            You are responsible for ensuring your own use of verified email addresses
            complies with applicable laws — including but not limited to GDPR, CAN-SPAM,
            CASL, and ePrivacy. Email Finder is a verification utility; it does not grant
            you a legal basis to email anyone.
          </p>
        </Section>

        <Section title="13. Changes to this policy">
          <p>
            We may update this policy from time to time. Material changes will be notified
            to registered users by email at least 14 days before they take effect. The
            &ldquo;Last updated&rdquo; date at the top of this page always reflects the
            current version.
          </p>
        </Section>

        <Section title="14. Contact">
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
