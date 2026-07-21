import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import os from "os";

const execFileAsync = promisify(execFile);

export interface TranscriptSegment {
  start: number;
  duration: number;
  text: string;
}

export interface TranscriptResult {
  segments: TranscriptSegment[];
  source: "auto-caption" | "whisper";
  language: string;
}

export async function fetchYouTubeTranscript(
  youtubeId: string,
): Promise<TranscriptResult | null> {
  try {
    const { fetchTranscript } = await import("youtube-transcript");
    const raw = await fetchTranscript(youtubeId);
    const segments = raw.map((s) => ({
      start: s.offset / 1000,
      duration: s.duration / 1000,
      text: s.text,
    }));
    return { segments, source: "auto-caption", language: "en" };
  } catch {
    return null;
  }
}

async function downloadAudio(youtubeId: string): Promise<string> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "whisper-audio-"));
  const outputPath = path.join(tmpDir, "audio.%(ext)s");

  const formats = [
    "bestaudio[ext=m4a]",
    "bestaudio[ext=ogg]",
    "bestaudio",
    "worst",
  ];

  for (const format of formats) {
    try {
      await execFileAsync("yt-dlp", [
        "-f",
        format,
        "--no-playlist",
        "--extract-audio",
        "--audio-format",
        "mp3",
        "--audio-quality",
        "5",
        "-o",
        outputPath,
        `https://www.youtube.com/watch?v=${youtubeId}`,
      ]);

      const files = fs.readdirSync(tmpDir).filter((f) => f.endsWith(".mp3"));
      if (files.length > 0) {
        return path.join(tmpDir, files[0]);
      }
    } catch {
      continue;
    }
  }

  throw new Error("Failed to download audio");
}

export async function fetchWhisperTranscript(
  youtubeId: string,
): Promise<TranscriptResult | null> {
  const apiKey = process.env.GROQ_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const isGroq = !!process.env.GROQ_API_KEY;
  const baseUrl = isGroq
    ? "https://api.groq.com/openai/v1"
    : "https://api.openai.com/v1";
  const model = isGroq ? "whisper-large-v3-turbo" : "whisper-1";

  let audioPath: string | null = null;

  try {
    audioPath = await downloadAudio(youtubeId);

    const fileBuffer = fs.readFileSync(audioPath);
    const blob = new Blob([fileBuffer], { type: "audio/mpeg" });

    const formData = new FormData();
    formData.append("file", blob, "audio.mp3");
    formData.append("model", model);
    formData.append("response_format", "verbose_json");
    formData.append("timestamp_granularities[]", "segment");

    const res = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });

    if (!res.ok) {
      console.error("Whisper API error:", res.status, await res.text());
      return null;
    }

    const data = (await res.json()) as {
      language?: string;
      segments?: { start: number; duration: number; text: string }[];
    };

    const segments: TranscriptSegment[] = (data.segments ?? []).map((s) => ({
      start: s.start,
      duration: s.duration,
      text: s.text.trim(),
    }));

    if (segments.length === 0) return null;

    return {
      segments,
      source: "whisper",
      language: data.language ?? "en",
    };
  } catch (e) {
    console.error("Whisper transcription failed:", e);
    return null;
  } finally {
    if (audioPath) {
      try {
        const dir = path.dirname(audioPath);
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
  }
}

export async function fetchTranscriptWithFallback(
  youtubeId: string,
  accessToken?: string,
): Promise<TranscriptResult | null> {
  // Try YouTube Data API v3 with OAuth token first (works from any IP)
  if (accessToken) {
    const yt = await fetchYouTubeTranscriptViaAPI(youtubeId, accessToken);
    if (yt) return yt;
  }

  const yt = await fetchYouTubeTranscript(youtubeId);
  if (yt) return yt;

  return fetchWhisperTranscript(youtubeId);
}

async function fetchYouTubeTranscriptViaAPI(
  youtubeId: string,
  accessToken: string,
): Promise<TranscriptResult | null> {
  try {
    // Step 1: List available captions
    const listRes = await fetch(
      `https://www.googleapis.com/youtube/v3/captions?videoId=${youtubeId}&part=snippet`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!listRes.ok) return null;
    const listData = (await listRes.json()) as { items?: Array<{ id: string; snippet: { language: string; trackKind: string } }> };
    const items = listData.items ?? [];
    if (items.length === 0) return null;

    // Prefer ASR (auto-generated), then standard
    const asr = items.find((i) => i.snippet.trackKind === "asr");
    const captionId = (asr ?? items[0]).id;

    // Step 2: Download the caption track
    const dlRes = await fetch(
      `https://www.googleapis.com/youtube/v3/captions/${captionId}?tfmt=json3`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!dlRes.ok) {
      // If json3 not supported, try default format
      const dlRes2 = await fetch(
        `https://www.googleapis.com/youtube/v3/captions/${captionId}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!dlRes2.ok) return null;
      const text = await dlRes2.text();
      return parseSrtOrVtt(text);
    }
    const captionData = (await dlRes.json()) as {
      events?: Array<{ tStartMs: number; dMs: number; segs?: Array<{ utf8: string }> }>;
    };
    const segments: TranscriptSegment[] = (captionData.events ?? [])
      .filter((e) => e.segs)
      .map((e) => ({
        start: e.tStartMs / 1000,
        duration: (e.dMs ?? 0) / 1000,
        text: e.segs!.map((s) => s.utf8 ?? "").join("").trim(),
      }))
      .filter((s) => s.text);
    if (segments.length === 0) return null;
    return { segments, source: "auto-caption", language: asr?.snippet.language ?? "en" };
  } catch (e) {
    console.error("YouTube API transcript fetch failed:", e);
    return null;
  }
}

function parseSrtOrVtt(text: string): TranscriptResult | null {
  const segments: TranscriptSegment[] = [];
  // Parse SRT/VTT format: number, timestamp, text
  const blocks = text.split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.trim().split("\n");
    if (lines.length < 2) continue;
    // Find timestamp line
    const tsLine = lines.find((l) => l.includes("-->"));
    if (!tsLine) continue;
    const match = tsLine.match(/(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[.,](\d{3})/);
    if (!match) continue;
    const start = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3]) + parseInt(match[4]) / 1000;
    const end = parseInt(match[5]) * 3600 + parseInt(match[6]) * 60 + parseInt(match[7]) + parseInt(match[8]) / 1000;
    const textLines = lines.filter((l) => !l.includes("-->") && !/^\d+$/.test(l.trim()));
    const text = textLines.join(" ").replace(/<[^>]+>/g, "").trim();
    if (text) {
      segments.push({ start, duration: end - start, text });
    }
  }
  if (segments.length === 0) return null;
  return { segments, source: "auto-caption", language: "en" };
}
