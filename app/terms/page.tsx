import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service — MARGINALIA: Vestigia",
  description: "Terms of service for MARGINALIA: Vestigia",
};

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-3xl font-bold mb-2">Terms of Service</h1>
        <p className="text-sm text-muted mb-8">Effective date: August 11, 2026</p>

        <div className="space-y-8 text-sm leading-6 text-foreground/90">
          <section>
            <h2 className="text-lg font-semibold mb-2">1. Acceptance of terms</h2>
            <p>
              By accessing or using MARGINALIA: Vestigia (the “Service”), operated by
              Jonimar, you agree to these Terms of Service. If you do not agree, do not
              use the Service.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">2. Description of the Service</h2>
            <p>
              The Service extracts transcripts from YouTube videos, identifies key
              moments, allows you to annotate videos at specific timestamps, and lets
              you organize videos into folders and share them with other people.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">3. Accounts and Google Sign-In</h2>
            <p>
              You may sign in using Google Sign-In. You are responsible for
              maintaining the confidentiality of your account and for all activity
              that occurs under it. You must provide accurate information and notify
              us of any unauthorized use of your account.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">4. Your content</h2>
            <p>
              You retain ownership of the content you create in the Service, including
              annotations, folders, and video collections. You grant us a limited
              license to store, process, and display that content solely to provide
              the Service to you and to the people you share it with.
            </p>
            <p className="mt-3">
              You must have the right to share any content you add. You may not
              upload content that is unlawful, infringing, or that violates the rights
              of others.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">5. Acceptable use</h2>
            <p>
              You agree not to misuse the Service, including attempting to gain
              unauthorized access, interfering with the Service or its infrastructure,
              or using the Service to collect data about other users without their
              consent.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">6. Third-party services</h2>
            <p>
              The Service depends on third-party services such as Google (authentication,
              YouTube data), Vercel (hosting), and Neon (database). Your use of these
              services is subject to their respective terms and policies.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">7. Disclaimer of warranties</h2>
            <p>
              The Service is provided “as is” and “as available”, without warranties of
              any kind, whether express or implied, including fitness for a particular
              purpose and non-infringement. We do not warrant that the Service will be
              uninterrupted or error-free.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">8. Limitation of liability</h2>
            <p>
              To the maximum extent permitted by law, we will not be liable for any
              indirect, incidental, special, consequential, or punitive damages, or for
              loss of data or profits, arising out of or related to your use of the
              Service.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">9. Termination</h2>
            <p>
              We may suspend or terminate your access to the Service at any time for
              conduct that violates these Terms or that harms the Service or other
              users. You may stop using the Service at any time and delete your
              content.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">10. Changes to these Terms</h2>
            <p>
              We may revise these Terms from time to time. The updated version will be
              posted with a new effective date. Continued use of the Service after a
              change means you accept the revised Terms.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">11. Contact</h2>
            <p>
              Questions about these Terms can be sent to{" "}
              <a href="mailto:jonimar@gmail.com" className="text-accent hover:underline">
                jonimar@gmail.com
              </a>
              .
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
