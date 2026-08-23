<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Work State
### Completed
- Translation dictionary expanded from ~60 to ~130 keys per language across all visible UI sections
- All untranslated strings wrapped in `app/page.tsx` and `app/video/[id]/page.tsx`
- `npx tsc --noEmit` passes with 0 errors
- `shareToken` column added to `folders` table + migration `drizzle/0010_add_folder_share_token.sql`
- `POST/DELETE /api/folders/[id]/share` — share token generation/revocation
- `GET /api/shared/folder/[token]` + `GET|POST /api/shared/folder/[token]/annotations` — public endpoints
- `app/shared/folder/[token]/page.tsx` — public shared folder dashboard
- Share button (share icon + clipboard copy + "Copied!") added to folder sidebar in `app/page.tsx`
- Auto-generated `shareToken` on folder creation in `app/api/folders/route.ts`
- EN/PT translation keys `share.*` and `shared.*` added to `lib/translations.ts`
- `proxy.ts` — exempts `/shared/*`, `/api/shared/*`, `/signin`, `/api/auth/*` from auth redirect
- Invite emails replaced Resend with the **Gmail REST API**; `lib/email.ts` sends via the signed-in user's own Gmail OAuth (`gmail.send` scope), with app-level SMTP fallback (`GMAIL_SMTP_USER`/`GMAIL_SMTP_APP_PASSWORD`)
- `auth.ts` Google provider requests `gmail.send` scope + `access_type=offline&prompt=consent` ONLY when `GMAIL_SEND_VIA_USER=true`; otherwise it requests only non-sensitive `openid email profile` (no `youtube` scope — YouTube API calls use `YOUTUBE_API_KEY`, not the user token). The sensitive scope triggers Google's "unverified app" warning, so the flag stays off until Google OAuth verification is complete. Google OAuth tokens persisted to `users` (`gmail_access_token`, `gmail_refresh_token`, `gmail_token_expires_at`) via jwt-callback upsert only when the flag is on
- Migration `drizzle/0013_add_gmail_tokens.sql` applied to Neon (must apply via `sql.query()`, NOT `sql.unsafe()` — unsafe returns an unexecuted builder)
- `POST /api/folders/[id]/shares` loads sender's stored Gmail tokens and sends the invite from the sender's account (`Name <sender@gmail.com>`); falls back to app SMTP when no tokens
- Invite emails sent via **Gmail REST API** (`gmail/v1/users/me/messages/send`, base64url raw RFC822) with always-fresh refreshed access token — Gmail SMTP XOAUTH2 was rejected because it demands `https://mail.google.com/` scope, not `gmail.send`
- Requires **Gmail API enabled** in Google Cloud project `624312173927` and same OAuth client secret in `.env`/Vercel (local `.env` was stale → `invalid_client`)
- Prod session cookies are signed with salt `__Secure-authjs.session-token` (HTTPS); local dev uses `authjs.session-token` — forged-token tests must match
- `tests/real-invite-send.test.ts` — drives a real invite to `notasdevideo@gmail.com` from `jonimar@gmail.com` (use `TEST_BASE=https://vestigia-vercel.vercel.app` for prod)
- Fixed shared folder video layout in `app/shared/folder/[token]/page.tsx`: (1) the page now injects `<script src="https://www.youtube.com/iframe_api">` before polling for `window.YT` (was missing — player never initialized, infinite "Loading player..." spinner); (2) added `min-w-0` to the Start/End annotation inputs so they shrink (they previously pinned at intrinsic ~200px each and overflowed the panel → page had ~39px horizontal scroll)
- Saved share emails for future use: `saved_share_emails` table (user_id + email, unique) + migration `drizzle/0014_add_saved_share_emails.sql` applied to Neon; `GET/POST/DELETE /api/users/saved-emails` route; share dialog in `app/page.tsx` has a "Save this email for future shares" checkbox (default on) and "Saved emails" chips that fill the email input on click / remove with `×`; emails stored per `session.user.id` (keyed `google-<email>`). Test: `tests/saved-emails.test.ts`
- Note: `/api/*` unauthenticated requests are 307-redirected to `/signin` by middleware (node fetch follows redirects — assert `redirect: "manual"` or expect 200-from-/signin); route handlers still return 401 as defense-in-depth
- **Three enhancements implemented, tested, and DEPLOYED to Vercel prod:**
  - **Live annotation updates**: `app/shared/folder/[token]/page.tsx` polls annotations every 5s while a video is selected; replaces state only when ids/`updatedAt` changed; `SharedAnnotation.updatedAt: string | null`; verified in-browser (annotation added via curl appeared without reload).
  - **Edit annotations on shared page**: `app/api/shared/folder/[token]/annotations/route.ts` gained PUT (requires annotationId/email/timestampStart/timestampEnd; only edit-permission invitees; only own annotations — 403 otherwise; sets `updatedAt`). Edit/cancel/save form in page (edit/cancel/save handlers). Verified in-browser (Edit → save → note updated).
  - **Atomic add-video-to-folder**: `lib/import-video.ts` `createVideo()` shared by `POST /api/videos` and `POST /api/folders/[id]/videos`; folder endpoint accepts `url` (optional videoId/title/thumbnailUrl/extractKeyMoments), creates+links atomically, idempotent (200 "Already in folder"); response includes `created` flag so tests can safely delete newly-created videos; `app/page.tsx` playlist import calls the folder endpoint when a target folder is chosen.
  - Test: `tests/enhancements.test.ts` (atomic 201/idempotent/400, edit own 200, edit other 403, poll GET shows updatedAt, cleanup deletes folder + only-if-created video). Lint: `npx eslint` clean.
  - Note: when forging prod session cookies in a browser, `__Secure-authjs.session-token` REQUIRES the `Secure` attribute or Chromium silently drops it (auto-verify on the shared page then fails → shows the email gate).
- **Collaboration + export + rate limiting (implemented and DEPLOYED to Vercel prod):**
  - **Edit collaborators can add videos to the shared folder**: `POST /api/shared/folder/[token]/videos` (public, email verified against `folderShares` with `edit` permission; body `{email, name, url}`) reuses `createVideo` from `lib/import-video.ts`, links atomically, idempotent. IMPORTANT: pass `userId: folder.userId` (folder owner) so the video is owned by the folder owner and can be deleted via `DELETE /api/videos/[id]` — passing `null` orphans the video (owner can't delete it).
  - **Annotation export**: `GET /api/shared/folder/[token]/export?email=...&format=csv|json` — any authorized collaborator (view OR edit) can export all folder annotations joined with video titles; CSV is RFC-4180-escaped with Content-Disposition attachment.
  - **Rate limiting**: `lib/rate-limit.ts` in-memory sliding window (`checkLimit(key,max,windowMs)` unit-testable; `rateLimit(request,{max,windowMs})` returns 429 `NextResponse`); applied to all public `/api/shared/folder/[token]/*` endpoints (GET 60/min, mutations 30/min, videos 20/min, export 30/min). Per-instance only on serverless — defense-in-depth, not a hard guarantee.
  - Shared page toolbar (folder view): "Add video" URL input (edit collaborators only) + Export CSV/JSON buttons; `refreshFolder` callback re-fetches folder data after add; shared page auto-verify effect now includes `session?.user?.name` in deps.
  - NOTE: share token is NOT auto-generated on folder creation (AGENTS.md earlier note is wrong) — generated by `POST /api/folders/[id]/share` (idempotent, returns existing token).
  - Tests: `tests/collab-add-export.test.ts` (fresh folder + edit/view shares; collab add 201/idempotent/400/403 view/403 stranger/400 no-url; export json+csv content, view 200, stranger 403, missing email 400; cleanup) and `tests/rate-limit.test.ts` (unit). Lint clean, tsc clean.
  - Verified on prod: toolbar renders, collab add 201 + idempotent 200, export CSV/JSON with content, view-only/stranger 403, cleanup via owner.
- **Vimeo player support (implemented and verified locally; NOT yet committed/deployed):**
  - `lib/vimeo-adapter.ts` — adapts promise-based Vimeo Player SDK to the synchronous YT-IFrame interface (`SyncPlayerInterface`); caches time/duration/state from `timeupdate`/`seeked`/`play`/`pause`/`ended` events so reads are synchronous; `onReady` fires after SDK ready + getDuration. Unit tests: `tests/vimeo-adapter.test.ts` (run `npx tsx tests/vimeo-adapter.test.ts`).
  - `app/video/[id]/page.tsx` + `app/shared/folder/[token]/page.tsx` — `playerKind` is `"youtube" | "vimeo" | "embed"` (vimeo → full control via SDK adapter + iframe `?api=1`; other socials → embed-only, no seek controls, "Watch on" badge). Vimeo SDK script lazy-loaded; player created on `iframe[data-vimeo-player]`.
  - `GET /api/shared/folder/[token]` now returns `videos.platform`; `next.config.ts` remotePatterns gained `i.vimeocdn.com`, `pbs.twimg.com`, `p16-sign-va.tiktokcdn.com`, `*.cdninstagram.com`, `*.fbcdn.net` — ANY unlisted social thumbnail host crashes the home page (`next/image` throws, page shows "This page couldn't load").
  - FIXED pre-existing bug in `app/api/shared/folder/[token]/verify/route.ts`: session email used to override the manually-submitted email, so signed-in users could never pass the email gate with an invited address. Now explicit body email wins: `email?.trim()?.toLowerCase() || sessionEmail`.
  - eslint.config.mjs: `@typescript-eslint/no-unused-vars` warn with `^_` ignore pattern.
  - Verified in-browser locally: vimeo video page (duration 1:02, seek 0:00→0:10), shared folder via email gate (same), youtube regression OK, home page renders social thumbnails. NOTE: actual playback can't be exercised in Playwright-driven browsers — even player.vimeo.com direct embed stalls (`readyState` stays 1) / PlaybackError; seek+events prove the adapter wiring.

### Active
- Vimeo support pending commit + Vercel deploy (all checks green: tsc, eslint, unit test, browser verify)

### Blocked
- (none)
