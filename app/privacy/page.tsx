import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — MARGINALIA: Vestigia",
  description: "Privacy policy for MARGINALIA: Vestigia",
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-sm text-muted mb-8">Effective date: August 11, 2026</p>

        <div className="space-y-8 text-sm leading-6 text-foreground/90">
          <section>
            <h2 className="text-lg font-semibold mb-2">1. Who we are</h2>
            <p>
              MARGINALIA: Vestigia (“the Service”, “we”, “us”) is a YouTube video
              insights tool that extracts transcripts, identifies key moments, and
              lets you annotate videos and share folders. It is operated by Jonimar.
              If you have any questions about this policy, contact us at{" "}
              <a href="mailto:jonimar@gmail.com" className="text-accent hover:underline">
                jonimar@gmail.com
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">2. Information we collect</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Account information.</strong> When you sign in with Google, we
                receive your name and email address. We do not collect your Google
                password.
              </li>
              <li>
                <strong>Content you create.</strong> Videos you import (titles,
                thumbnails, URLs), transcripts and key moments we generate for them,
                annotations you write, folders you create, and the email addresses of
                people you invite to shared folders.
              </li>
              <li>
                <strong>Optional Gmail data.</strong> The “send invites from your own
                Gmail” feature is disabled by default. If you enable it, we store OAuth
                access and refresh tokens that allow the Service to send share invite
                emails from your account on your behalf. We do not read or store the
                content of your mailbox.
              </li>
              <li>
                <strong>Usage data.</strong> Authentication cookies and standard server
                logs needed to keep the Service secure and functional.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">3. How we use your information</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>To create and authenticate your account.</li>
              <li>To fetch video metadata and transcripts from YouTube on your behalf.</li>
              <li>To store and display the videos, annotations, and folders you create.</li>
              <li>To send share invite emails to people you choose to invite.</li>
              <li>To keep the Service secure and to troubleshoot issues.</li>
            </ul>
            <p className="mt-3">
              We do not sell, rent, or share your personal information with third
              parties for their own marketing purposes.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">4. Third-party services</h2>
            <p>
              The Service relies on trusted third parties to operate:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Google</strong> — authentication (Google Sign-In), the YouTube
                Data API used to fetch public video metadata and transcripts, and
                optionally Gmail (only if you enable the feature described in section 2).
              </li>
              <li>
                <strong>Vercel</strong> — hosting and deployment of the Service.
              </li>
              <li>
                <strong>Neon</strong> — PostgreSQL database where your account and
                content are stored.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">5. Data retention and deletion</h2>
            <p>
              We keep your account and content for as long as your account is active.
              You can delete videos, annotations, and folders from within the Service
              at any time. To delete your account and associated data, contact us at{" "}
              <a href="mailto:jonimar@gmail.com" className="text-accent hover:underline">
                jonimar@gmail.com
              </a>{" "}
              and we will remove your data within a reasonable timeframe.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">6. Security</h2>
            <p>
              We use industry-standard practices to protect your data, including
              encrypted database connections, signed session cookies, and access
              control on all API endpoints. No method of transmission over the
              Internet is completely secure, so we cannot guarantee absolute security.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">7. Children</h2>
            <p>
              The Service is not directed to children under 13, and we do not
              knowingly collect personal information from children.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">8. Changes to this policy</h2>
            <p>
              We may update this policy from time to time. Material changes will be
              reflected by updating the effective date above. Your continued use of
              the Service after changes constitutes acceptance of the updated policy.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">9. Contact</h2>
            <p>
              For privacy questions or requests, email{" "}
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
