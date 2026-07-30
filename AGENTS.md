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

### Active
- (none)

### Blocked
- (none)
