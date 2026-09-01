import nodemailer, { type Transporter } from "nodemailer";

const GMAIL_SMTP_USER = process.env.GMAIL_SMTP_USER || process.env.GMAIL_USER;
const GMAIL_SMTP_PASS =
  process.env.GMAIL_SMTP_APP_PASSWORD || process.env.GMAIL_APP_PASSWORD;
const GMAIL_SEND_VIA_USER = process.env.GMAIL_SEND_VIA_USER === "true";
const GOOGLE_CLIENT_ID = process.env.AUTH_GOOGLE_ID;
const GOOGLE_CLIENT_SECRET = process.env.AUTH_GOOGLE_SECRET;
const GMAIL_API_SEND = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const GMAIL_TOKEN_URL = "https://oauth2.googleapis.com/token";
const FROM_EMAIL =
  process.env.EMAIL_FROM ||
  (GMAIL_SMTP_USER ? `Vestigia <${GMAIL_SMTP_USER}>` : "");

function buildInviteHtml(params: {
  sharedBy: string;
  folderName: string;
  shareLink: string;
  permission: string;
}) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background: #f5f5f5; }
    .container { max-width: 480px; margin: 40px auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .header { padding: 32px 32px 0; text-align: center; }
    .logo { width: 48px; height: 48px; background: #f0f0f0; border-radius: 12px; margin: 0 auto 16px; display: flex; align-items: center; justify-content: center; font-size: 24px; }
    h1 { font-size: 20px; font-weight: 600; margin: 0 0 8px; color: #111; }
    p { font-size: 14px; line-height: 1.5; color: #666; margin: 0 0 24px; text-align: center; }
    .badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 500; margin-bottom: 24px; }
    .badge-edit { background: #e8f5e9; color: #2e7d32; }
    .badge-view { background: #e3f2fd; color: #1565c0; }
    .link-box { background: #f9f9f9; border: 1px solid #eee; border-radius: 8px; padding: 12px 16px; margin: 0 32px 24px; font-size: 12px; color: #333; word-break: break-all; }
    .btn { display: block; width: calc(100% - 64px); margin: 0 32px 32px; padding: 12px; background: #000; color: #fff; text-align: center; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 500; }
    .footer { padding: 24px 32px; text-align: center; border-top: 1px solid #eee; font-size: 12px; color: #999; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">📁</div>
      <h1>You've been invited to a folder</h1>
      <p><strong>${params.sharedBy}</strong> shared the folder <strong>"${params.folderName}"</strong> with you on Vestigia.</p>
      <div class="badge ${params.permission === "edit" ? "badge-edit" : "badge-view"}">
        ${params.permission === "edit" ? "✏️ You can edit" : "👁️ You can view"}
      </div>
      <div class="link-box">${params.shareLink}</div>
      <a href="${params.shareLink}" class="btn" target="_blank">Open Folder</a>
    </div>
    <div class="footer">
      <p>Vestigia — Extract and annotate YouTube video insights</p>
    </div>
  </div>
</body>
</html>`;
}

export interface GmailOAuth {
  user: string; // sender's Gmail address (the signed-in Google user)
  accessToken?: string | null;
  refreshToken?: string | null;
  expiresAt?: string | number | null; // unix seconds (Google account.expires_at)
}

function rfc2047(text: string): string {
  return /[^\x20-\x7E]/.test(text)
    ? `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`
    : text;
}

function buildRawMessage(params: {
  from: string;
  to: string;
  subject: string;
  html: string;
}): string {
  return [
    `From: ${params.from}`,
    `To: ${params.to}`,
    `Subject: ${rfc2047(params.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(params.html, "utf8").toString("base64"),
  ].join("\r\n");
}

async function refreshAccessToken(gmail: GmailOAuth): Promise<string> {
  if (!gmail.refreshToken && gmail.accessToken) {
    return gmail.accessToken;
  }

  if (!gmail.refreshToken) {
    throw new Error("No refresh token available for Gmail OAuth");
  }

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID!,
    client_secret: GOOGLE_CLIENT_SECRET!,
    refresh_token: gmail.refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch(GMAIL_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) {
    throw new Error(`Token refresh failed: ${res.status}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) {
    throw new Error("Token refresh returned no access token");
  }
  return json.access_token;
}

async function sendViaGmailApi(gmail: GmailOAuth, raw: string): Promise<void> {
  // Always refresh so the access token is guaranteed fresh (valid ~1h).
  const accessToken = await refreshAccessToken(gmail);
  const res = await fetch(GMAIL_API_SEND, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      raw: Buffer.from(raw, "utf8").toString("base64url"),
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Gmail API send failed (${res.status}): ${detail.slice(0, 200)}`);
  }
}

export async function sendShareInviteEmail(
  params: {
    to: string;
    folderName: string;
    shareLink: string;
    permission: string;
    sharedBy: string;
  },
  transport?: Transporter,
  gmail?: GmailOAuth
): Promise<{ success: boolean; error?: string }> {
  const html = buildInviteHtml({
    sharedBy: params.sharedBy,
    folderName: params.folderName,
    shareLink: params.shareLink,
    permission: params.permission,
  });

  // Prefer the signed-in user's own Gmail via the Gmail API when the app has
  // a valid stored token. The feature flag only controls whether we requested
  // the sensitive scope during Google sign-in; it should not block sending when
  // the account already has a stored refresh token and the app can use it.
  const viaOAuth =
    !!gmail?.user &&
    (!!gmail?.refreshToken || !!gmail?.accessToken) &&
    !!GOOGLE_CLIENT_ID &&
    !!GOOGLE_CLIENT_SECRET;
  if (viaOAuth) {
    try {
      const from = `${rfc2047(params.sharedBy)} <${gmail.user}>`;
      const raw = buildRawMessage({
        from,
        to: params.to,
        subject: `${params.sharedBy} shared "${params.folderName}" with you on Vestigia`,
        html,
      });
      await sendViaGmailApi(gmail, raw);
      return { success: true };
    } catch (err) {
      console.error("[email] Failed to send via Gmail API:", err);
      return { success: false, error: "Failed to send email" };
    }
  }

  // Fallback: app-level SMTP account.
  if (!GMAIL_SMTP_USER || !GMAIL_SMTP_PASS) {
    console.warn("[email] No email transport configured (Gmail OAuth or SMTP) — skipping email send");
    return { success: false, error: "Email service not configured" };
  }

  const transporter =
    transport ??
    nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: GMAIL_SMTP_USER, pass: GMAIL_SMTP_PASS },
    });

  try {
    await transporter.sendMail({
      from: FROM_EMAIL,
      to: params.to,
      subject: `${params.sharedBy} shared "${params.folderName}" with you on Vestigia`,
      html,
    });
    return { success: true };
  } catch (err) {
    console.error("[email] Failed to send email:", err);
    return { success: false, error: "Failed to send email" };
  }
}
