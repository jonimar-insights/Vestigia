import { callAI } from "./ai";

export interface KeyMoment {
  timestamp: number;
  title: string;
  description?: string;
  source: "chapter" | "storyboard" | "transcript" | "ai";
  thumbnailUrl?: string;
  confidence: number;
}

export interface StoryboardFrame {
  timestamp: number;
  imageUrl: string;
  index: number;
}

export async function extractYouTubeChapters(
  youtubeId: string,
): Promise<KeyMoment[]> {
  try {
    const res = await fetch(
      `https://www.youtube.com/watch?v=${youtubeId}`,
    );
    const html = await res.text();

    const chapters: KeyMoment[] = [];

    // Try to extract chapters from ytInitialData
    const dataMatch = html.match(
      /var ytInitialData = ([\s\S]*?);<\/script>/,
    );
    if (dataMatch) {
      try {
        const data = JSON.parse(dataMatch[1]);
        const engagementPanels =
          data?.playerOverlays?.playerOverlayRenderer?.decoratedPlayerBarRenderer
            ?.decoratedPlayerBarRenderer?.playerBar?.multiMarkersPlayerBarRenderer
            ?.markersMap;

        if (engagementPanels) {
          for (const panel of engagementPanels) {
            if (
              panel?.key === "DESCRIPTION_CHAPTERS" ||
              panel?.key === "AUTO_CHAPTERS"
            ) {
              const markers =
                panel?.value?.chapters || panel?.value?.markers || [];
              for (const marker of markers) {
                const chapter =
                  marker.chapterRenderer || marker;
                if (chapter) {
                  const title =
                    chapter.title?.simpleText ||
                    chapter.title?.runs?.[0]?.text ||
                    "";
                  const timeMs =
                    chapter.timeRangeStartMillis ||
                    chapter.onTap?.watchEndpoint?.startTimeSeconds * 1000;
                  if (title && timeMs != null) {
                    chapters.push({
                      timestamp: timeMs / 1000,
                      title,
                      source: "chapter",
                      confidence: 1.0,
                    });
                  }
                }
              }
            }
          }
        }
      } catch {}
    }

    // Fallback: parse chapters from description
    if (chapters.length === 0) {
      const descMatch = html.match(
        /"shortDescription":"([\s\S]*?)"(?:,|})/,
      );
      if (descMatch) {
        const desc = descMatch[1]
          .replace(/\\n/g, "\n")
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, "\\");
        const chapterRegex =
          /(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+)/g;
        let match;
        while ((match = chapterRegex.exec(desc)) !== null) {
          const timeParts = match[1].split(":").map(Number);
          let seconds = 0;
          if (timeParts.length === 3) {
            seconds =
              timeParts[0] * 3600 + timeParts[1] * 60 + timeParts[2];
          } else {
            seconds = timeParts[0] * 60 + timeParts[1];
          }
          chapters.push({
            timestamp: seconds,
            title: match[2].trim(),
            source: "chapter",
            confidence: 0.9,
          });
        }
      }
    }

    return chapters.sort((a, b) => a.timestamp - b.timestamp);
  } catch (e) {
    console.error("Failed to extract chapters:", e);
    return [];
  }
}

export async function extractStoryboards(
  youtubeId: string,
): Promise<StoryboardFrame[]> {
  try {
    const res = await fetch(
      `https://www.youtube.com/watch?v=${youtubeId}`,
    );
    const html = await res.text();

    const storyboardSpecMatch = html.match(
      /"storyboards":\s*\{\s*"playerStoryboardSpecRenderer":\s*\{\s*"spec":\s*"([^"]+)"/,
    );

    if (!storyboardSpecMatch) return [];

    const spec = storyboardSpecMatch[1].replace(/\\u0026/g, "&");
    const parts = spec.split("|");

    if (parts.length < 2) return [];

    const baseUrl = parts[0];
    const storyboardParams = parts.slice(1);

    const frames: StoryboardFrame[] = [];

    // Use the highest quality storyboard (last set)
    const paramStr =
      storyboardParams[storyboardParams.length - 1] || storyboardParams[0];
    const params = new URLSearchParams(paramStr);

    const cols = parseInt(params.get("c") || "5");
    const rows = parseInt(params.get("r") || "5");
    const perSheet = cols * rows;
    const totalFrames = parseInt(params.get("n") || "100");

    const durationRes = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${youtubeId}&format=json`,
    );
    let duration = 600;
    if (durationRes.ok) {
      await durationRes.json();
      duration = 600;
    }

    const frameInterval = duration / totalFrames;

    for (let i = 0; i < Math.min(totalFrames, 100); i++) {
      const sheetIndex = Math.floor(i / perSheet);

      const sheetUrl = baseUrl
        .replace("$L", sheetIndex.toString())
        .replace("$N", "M");

      frames.push({
        timestamp: i * frameInterval,
        imageUrl: sheetUrl,
        index: i,
      });
    }

    return frames;
  } catch (e) {
    console.error("Failed to extract storyboards:", e);
    return [];
  }
}

export async function extractTranscriptKeyMoments(
  youtubeId: string,
  preloadedSegments?: { start: number; duration: number; text: string }[],
): Promise<KeyMoment[]> {
  try {
    const segments = preloadedSegments ?? (() => {
      throw new Error("No segments provided and fetch not implemented here");
    })();

    const keyMoments: KeyMoment[] = [];

    // Find natural pauses (gaps between segments)
    for (let i = 1; i < segments.length; i++) {
      const prevEnd = segments[i - 1].start + segments[i - 1].duration;
      const gap = segments[i].start - prevEnd;

      if (gap > 1.5) {
        // Significant pause
        const precedingText = segments
          .slice(Math.max(0, i - 3), i)
          .map((s) => s.text)
          .join(" ");

        const title =
          precedingText.length > 60
            ? precedingText.slice(-60).trim() + "..."
            : precedingText.trim();

        if (title.length > 5) {
          keyMoments.push({
            timestamp: segments[i].start,
            title: `Pause: ${title}`,
            description: `Natural break after ${Math.round(gap)}s pause`,
            source: "transcript",
            confidence: 0.7,
          });
        }
      }
    }

    // Find sentence-starting phrases that indicate topic shifts
    const topicMarkers = [
      "now let",
      "moving on",
      "next up",
      "let's talk about",
      "so basically",
      "the key point",
      "important",
      "remember that",
      "in summary",
      "to recap",
      "first of all",
      "secondly",
      "finally",
      "on the other hand",
      "however",
      "but wait",
      "here's the thing",
      "the problem is",
      "the solution",
      "how does this work",
      "let me show you",
      "look at this",
      "pay attention",
      "this is crucial",
    ];

    for (let i = 0; i < segments.length; i++) {
      const text = segments[i].text.toLowerCase();
      for (const marker of topicMarkers) {
        if (text.startsWith(marker) || text.includes(`. ${marker}`)) {
          const nearbyText = segments
            .slice(i, Math.min(segments.length, i + 3))
            .map((s) => s.text)
            .join(" ");

          keyMoments.push({
            timestamp: segments[i].start,
            title:
              nearbyText.length > 60
                ? nearbyText.slice(0, 60).trim() + "..."
                : nearbyText.trim(),
            description: `Topic shift detected: "${marker}"`,
            source: "transcript",
            confidence: 0.6,
          });
          break;
        }
      }
    }

    // Deduplicate by timestamp (within 10s) and prioritize chapters
    const deduped: KeyMoment[] = [];
    keyMoments.sort((a, b) => a.timestamp - b.timestamp);
    for (const moment of keyMoments) {
      const tooClose = deduped.some(
        (d) => Math.abs(d.timestamp - moment.timestamp) < 10,
      );
      if (!tooClose) {
        deduped.push(moment);
      }
    }

    // Limit to reasonable number, spread evenly
    if (deduped.length > 30) {
      const step = deduped.length / 30;
      return deduped.filter((_, i) => i % Math.ceil(step) === 0).slice(0, 30);
    }
    return deduped;
  } catch (e) {
    console.error("Failed to extract transcript key moments:", e);
    return [];
  }
}

async function fetchVideoMetadata(
  youtubeId: string,
): Promise<{ title: string; description: string; duration: number } | null> {
  try {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) return null;

    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${youtubeId}&key=${apiKey}`,
    );
    const data = await res.json();
    const item = data.items?.[0];
    if (!item) return null;

    const durationStr = item.contentDetails?.duration || "PT0S";
    const durationMatch = durationStr.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    const hours = parseInt(durationMatch?.[1] || "0");
    const minutes = parseInt(durationMatch?.[2] || "0");
    const seconds = parseInt(durationMatch?.[3] || "0");
    const duration = hours * 3600 + minutes * 60 + seconds;

    return {
      title: item.snippet?.title || "",
      description: item.snippet?.description || "",
      duration,
    };
  } catch {
    return null;
  }
}

export async function extractAIKeyMoments(
  youtubeId: string,
): Promise<KeyMoment[]> {
  const meta = await fetchVideoMetadata(youtubeId);
  if (!meta) return [];

  const descPreview = meta.description.length > 2000
    ? meta.description.slice(0, 2000) + "..."
    : meta.description;

  const prompt = `You are analyzing a YouTube video to identify its key moments.

Title: "${meta.title}"
Duration: ${Math.floor(meta.duration / 60)}m ${meta.duration % 60}s
Description:
${descPreview}

Based on the title and description, identify the key moments, sections, or topics covered in this video. For each moment, provide:
- timestamp: estimated start time in seconds (be realistic based on the duration)
- title: short descriptive title (max 60 chars)
- description: 1-2 sentence explanation
- confidence: 0.0-1.0 (how confident you are this is a real moment, lower for videos with vague descriptions)

Return a JSON array. Aim for 5-15 moments spread across the video duration. Do not repeat the same topic.`;

  try {
    const result = await callAI({
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
      maxTokens: 2048,
    });

    const text = result.text;
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]) as Array<{
      timestamp: number;
      title: string;
      description?: string;
      confidence?: number;
    }>;

    return parsed
      .map((item) => ({
        timestamp: Math.min(Math.max(0, item.timestamp), meta.duration),
        title: (item.title || "").slice(0, 60),
        description: item.description || "",
        source: "ai" as const,
        confidence: Math.min(1, Math.max(0, item.confidence ?? 0.5)),
      }))
      .sort((a, b) => a.timestamp - b.timestamp);
  } catch (e) {
    console.error("Failed to extract AI key moments:", e);
    return [];
  }
}
