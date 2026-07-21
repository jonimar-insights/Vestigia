import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

async function fetchTranscript(youtubeId: string): Promise<{ segments: { start: number; duration: number; text: string }[]; language: string } | null> {
  // Try YouTube auto-captions via youtube-transcript API
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${youtubeId}`);
    const html = await res.text();

    // Extract caption track URL from the page
    const captionMatch = html.match(/"captionTracks":\s*(\[.*?\])/);
    if (!captionMatch) return null;

    const tracks = JSON.parse(captionMatch[1]);
    const enTrack = tracks.find((t: { languageCode: string; baseUrl: string }) => t.languageCode === "en") || tracks[0];
    if (!enTrack) return null;

    const captionRes = await fetch(enTrack.baseUrl + "&fmt=json3");
    if (!captionRes.ok) return null;
    const captionData = await captionRes.json() as { events: Array<{ tStartMs: number; dMs: number; segs?: Array<{ utf8: string }> }> };

    const segments: { start: number; duration: number; text: string }[] = [];
    for (const event of captionData.events) {
      if (!event.segs) continue;
      const text = event.segs.map((s) => s.utf8).join("").trim();
      if (!text) continue;
      segments.push({
        start: event.tStartMs / 1000,
        duration: (event.dMs || 0) / 1000,
        text,
      });
    }

    if (segments.length > 0) {
      return { segments, language: enTrack.languageCode || "en" };
    }
  } catch (e) {
    console.error(`  Auto-caption failed for ${youtubeId}:`, (e as Error).message?.slice(0, 100));
  }

  return null;
}

async function main() {
  const vids = await sql`SELECT v.id, v.youtube_id, v.title FROM videos v WHERE (SELECT 1 FROM transcripts t WHERE t.video_id = v.id) IS NULL ORDER BY v.id`;

  console.log(`Found ${vids.length} videos missing transcripts\n`);

  let ok = 0;
  let fail = 0;

  for (const v of vids) {
    const title = (v.title || "").slice(0, 60);
    process.stdout.write(`${v.id} ${v.youtube_id} ${title} ... `);

    const result = await fetchTranscript(v.youtube_id);
    if (result && result.segments.length > 0) {
      await sql`INSERT INTO transcripts (video_id, segments, language, source) VALUES (${v.id}, ${JSON.stringify(result.segments)}, ${result.language}, 'auto-caption')`;
      console.log(`OK (${result.segments.length} segments)`);
      ok++;
    } else {
      console.log("FAILED");
      fail++;
    }

    // Small delay to avoid rate limiting
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`\nDone: ${ok} extracted, ${fail} failed`);
}

main().catch(console.error);
