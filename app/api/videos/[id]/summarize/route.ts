import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { videos, transcripts, keyMoments } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { callAI, checkAIProvider } from "@/lib/ai";

export const maxDuration = 300;

interface TranscriptSegment {
  start: number;
  duration: number;
  text: string;
}

interface SummarizedMoment {
  timestamp: number;
  endTimestamp: number;
  title: string;
  summary: string;
  importance: "high" | "medium" | "low";
}

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

interface TimeChunk {
  startSec: number;
  endSec: number;
  lines: string[];
}

function chunkByTime(segments: TranscriptSegment[], segmentDurationSec = 600): TimeChunk[] {
  if (segments.length === 0) return [];

  const totalDuration = segments[segments.length - 1].start + (segments[segments.length - 1].duration || 0);
  const chunks: TimeChunk[] = [];

  for (let startSec = 0; startSec < totalDuration; startSec += segmentDurationSec) {
    const endSec = Math.min(startSec + segmentDurationSec, totalDuration);
    const lines: string[] = [];

    for (const seg of segments) {
      if (seg.start + seg.duration > startSec && seg.start < endSec) {
        lines.push(`[${formatTimestamp(seg.start)}] ${seg.text}`);
      }
    }

    if (lines.length > 0) {
      chunks.push({ startSec, endSec, lines });
    }
  }

  return chunks;
}

function extractJsonFromResponse(text: string): Record<string, unknown> | null {
  let clean = text.trim();

  if (clean.startsWith("```")) {
    clean = clean.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  try {
    return JSON.parse(clean);
  } catch { /* continue */ }

  const firstBrace = clean.indexOf("{");
  const lastBrace = clean.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(clean.slice(firstBrace, lastBrace + 1));
    } catch { /* continue */ }
  }

  const firstBracket = clean.indexOf("[");
  const lastBracket = clean.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    try {
      return { moments: JSON.parse(clean.slice(firstBracket, lastBracket + 1)) };
    } catch { /* continue */ }
  }

  return null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const db = getDb();
  const { id } = await params;
  const videoId = parseInt(id);

  if (isNaN(videoId)) {
    return NextResponse.json({ error: "Invalid video ID" }, { status: 400 });
  }

  const saved = await db
    .select()
    .from(keyMoments)
    .where(and(eq(keyMoments.videoId, videoId), eq(keyMoments.source, "ai-summary")));

  const moments = saved.map((m) => ({
    id: m.id,
    timestamp: m.timestamp,
    endTimestamp: m.endTimestamp,
    title: m.title,
    summary: m.description ?? "",
    importance: m.confidence >= 0.9 ? "high" : m.confidence >= 0.6 ? "medium" : "low",
  }));

  return NextResponse.json({ moments });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const db = getDb();
  const { id } = await params;
  const videoId = parseInt(id);
  const body = await request.json().catch(() => ({}));
  const regenerate = body.regenerate === true;

  if (isNaN(videoId)) {
    return NextResponse.json({ error: "Invalid video ID" }, { status: 400 });
  }

  const health = await checkAIProvider();
  if (!health.available) {
    return NextResponse.json(
      { error: `No AI provider available. Set one of: GROQ_API_KEY, GEMINI_API_KEY, CEREBRAS_API_KEY, OPENROUTER_API_KEY. ${health.error ?? ""}` },
      { status: 500 },
    );
  }

  const videoRows = await db.select().from(videos).where(eq(videos.id, videoId)).limit(1);
  if (!videoRows[0]) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }
  const video = videoRows[0];

  const existing = await db
    .select()
    .from(keyMoments)
    .where(and(eq(keyMoments.videoId, videoId), eq(keyMoments.source, "ai-summary")));

  if (existing.length > 0 && !regenerate) {
    return NextResponse.json({
      moments: existing.map((m) => ({
        id: m.id,
        timestamp: m.timestamp,
        endTimestamp: m.endTimestamp,
        title: m.title,
        summary: m.description ?? "",
        importance: m.confidence >= 0.9 ? "high" : m.confidence >= 0.6 ? "medium" : "low",
      })),
      saved: true,
    });
  }

  if (regenerate && existing.length > 0) {
    await db.delete(keyMoments)
      .where(and(eq(keyMoments.videoId, videoId), eq(keyMoments.source, "ai-summary")));
  }

  const transcriptRows = await db
    .select()
    .from(transcripts)
    .where(eq(transcripts.videoId, videoId))
    .limit(1);
  const transcript = transcriptRows[0] ?? null;

  if (!transcript) {
    return NextResponse.json({ error: "No transcript available. Extract transcript first." }, { status: 404 });
  }

  const segments: TranscriptSegment[] = JSON.parse(transcript.segments);
  if (segments.length === 0) {
    return NextResponse.json({ error: "Transcript is empty" }, { status: 404 });
  }

  const chunks = chunkByTime(segments);
  const allMoments: SummarizedMoment[] = [];
  const chunkErrors: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const chunkText = chunk.lines.join("\n");
    const timeRange = `${formatTimestamp(chunk.startSec)} - ${formatTimestamp(chunk.endSec)}`;
    const chunkLabel = chunks.length > 1 ? ` (segment ${i + 1}/${chunks.length}: ${timeRange})` : "";

    let text = "";
    try {
      const result = await callAI({
        messages: [
          {
            role: "system",
            content: "You are a video analysis assistant. Respond with JSON only, no markdown, no code blocks, no thinking.",
          },
          {
            role: "user",
            content: `Analyze this video transcript segment${chunkLabel} covering ${timeRange}.

CRITICAL: Spread moments EVENLY across the ENTIRE time range from ${formatTimestamp(chunk.startSec)} to ${formatTimestamp(chunk.endSec)}. Do not cluster moments at one point.

Transcript:
${chunkText}

Respond with JSON only:
{
  "moments": [
    {
      "timestamp": 123.4,
      "endTimestamp": 185.2,
      "title": "Short title (3-6 words)",
      "summary": "1-2 sentence summary",
      "importance": "high"
    }
  ]
}

Rules:
- Return 3-8 moments, SPREAD EVENLY from ${chunk.startSec} to ${chunk.endSec}
- timestamp and endTimestamp MUST be between ${chunk.startSec} and ${chunk.endSec}
- endTimestamp must be greater than timestamp
- importance: "high", "medium", or "low"`,
          },
        ],
        temperature: 0.3,
        maxTokens: 4096,
      });

      text = result.text;
      console.log(`Chunk ${i + 1}: served by ${result.provider}`);

      if (!text.trim()) {
        chunkErrors.push(`Chunk ${i + 1}: Empty response after retries`);
        continue;
      }

      try {
        const parsed = extractJsonFromResponse(text) as { moments?: SummarizedMoment[] } | null;
        if (!parsed || !Array.isArray(parsed.moments)) {
          console.warn(`Chunk ${i + 1}: Could not parse moments from response`);
          chunkErrors.push(`Chunk ${i + 1}: Unparseable response`);
          continue;
        }

        let accepted = 0;
        for (const m of parsed.moments) {
          if (typeof m.timestamp !== "number" || typeof m.endTimestamp !== "number") continue;

          if (m.timestamp < chunk.startSec || m.timestamp >= chunk.endSec) continue;
          if (m.endTimestamp <= m.timestamp) continue;
          if (m.endTimestamp > chunk.endSec + 30) continue;

          m.endTimestamp = Math.min(m.endTimestamp, chunk.endSec);

          if (!m.title || typeof m.title !== "string") continue;
          m.title = m.title.trim().slice(0, 100);
          m.summary = (typeof m.summary === "string" ? m.summary : "").trim().slice(0, 500);
          m.importance = (["high", "medium", "low"].includes(m.importance) ? m.importance : "medium") as "high" | "medium" | "low";

          allMoments.push(m);
          accepted++;
        }
        console.log(`Chunk ${i + 1}/${chunks.length}: accepted ${accepted}/${parsed.moments.length} moments`);
      } catch {
        chunkErrors.push(`Chunk ${i + 1}: Failed to parse JSON response`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`Failed to summarize chunk ${i}:`, msg);
      chunkErrors.push(`Chunk ${i + 1}: ${msg.slice(0, 120)}`);
    }

    if (i < chunks.length - 1) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  if (allMoments.length === 0 && chunkErrors.length > 0) {
    return NextResponse.json(
      { error: "Summarization failed for all segments", details: chunkErrors },
      { status: 500 },
    );
  }

  const deduped: SummarizedMoment[] = [];
  const importanceOrder = { high: 0, medium: 1, low: 2 };
  allMoments.sort((a, b) => a.timestamp - b.timestamp);

  for (const moment of allMoments) {
    const existingMoment = deduped.find(
      (d) => Math.abs(d.timestamp - moment.timestamp) < 10,
    );
    if (existingMoment) {
      if (
        importanceOrder[moment.importance] < importanceOrder[existingMoment.importance]
      ) {
        Object.assign(existingMoment, moment);
      }
    } else {
      deduped.push(moment);
    }
  }

  deduped.sort((a, b) => a.timestamp - b.timestamp);

  const saved = [];
  for (const m of deduped) {
    const confidence = m.importance === "high" ? 1.0 : m.importance === "medium" ? 0.7 : 0.4;
    const [inserted] = await db
      .insert(keyMoments)
      .values({
        videoId,
        timestamp: m.timestamp,
        endTimestamp: m.endTimestamp,
        title: m.title,
        description: m.summary,
        source: "ai-summary",
        confidence,
      })
      .returning();
    saved.push({
      id: inserted.id,
      timestamp: inserted.timestamp,
      endTimestamp: inserted.endTimestamp,
      title: inserted.title,
      summary: inserted.description ?? "",
      importance: m.importance,
    });
  }

  return NextResponse.json({
    moments: saved,
    videoTitle: video.title,
    totalSegments: segments.length,
    totalChunks: chunks.length,
    totalMomentsGenerated: allMoments.length,
    totalMomentsAfterDedup: deduped.length,
    saved: true,
  });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const db = getDb();
  const { id } = await params;
  const videoId = parseInt(id);

  if (isNaN(videoId)) {
    return NextResponse.json({ error: "Invalid video ID" }, { status: 400 });
  }

  await db.delete(keyMoments)
    .where(and(eq(keyMoments.videoId, videoId), eq(keyMoments.source, "ai-summary")));

  return NextResponse.json({ success: true });
}
