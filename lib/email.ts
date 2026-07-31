const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.EMAIL_FROM || "Vestigia <noreply@vestigia.app>";

export async function sendShareInviteEmail(params: {
  to: string;
  folderName: string;
  shareLink: string;
  permission: string;
  sharedBy: string;
}): Promise<{ success: boolean; error?: string }> {
  if (!RESEND_API_KEY) {
    console.warn("[email] RESEND_API_KEY not set — skipping email send");
    return { success: false, error: "Email service not configured" };
  }

  const html = `
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

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: params.to,
        subject: `${params.sharedBy} shared "${params.folderName}" with you on Vestigia`,
        html,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[email] Resend API error:", err);
      return { success: false, error: `Failed to send email: ${err}` };
    }

    return { success: true };
  } catch (err) {
    console.error("[email] Failed to send email:", err);
    return { success: false, error: "Failed to send email" };
  }
}