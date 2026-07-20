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
): Promise<TranscriptResult | null> {
  const yt = await fetchYouTubeTranscript(youtubeId);
  if (yt) return yt;

  return fetchWhisperTranscript(youtubeId);
}
