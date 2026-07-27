import { callAIWithUserKeys } from "./ai";

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
                  const startSeconds =
                    chapter.onTap?.watchEndpoint?.startTimeSeconds;
                  const timeMs =
                    chapter.timeRangeStartMillis != null
                      ? chapter.timeRangeStartMillis
                      : startSeconds != null
                        ? startSeconds * 1000
                        : null;
                  if (title && timeMs != null && !isNaN(timeMs)) {
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
      } catch (e) {
        console.warn("Failed to parse ytInitialData chapters:", e);
      }
    }

    // Fallback: parse chapters from description
    if (chapters.length === 0) {
      // Use a character class that stops at an unescaped double quote
      const descMatch = html.match(
        /"shortDescription":"((?:[^"\\]|\\.)*)"/,
      );
      if (descMatch) {
        const desc = descMatch[1]
          .replace(/\\n/g, "\n")
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, "\\");
        // Only match timestamps at the start of a line (actual chapter markers)
        const chapterRegex =
          /^(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+)/gm;
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

    // Try to get actual duration from multiple sources
    let duration = 600; // fallback default
    try {
      // Attempt 1: oEmbed
      const durationRes = await fetch(
        `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${youtubeId}&format=json`,
      );
      if (durationRes.ok) {
        const oembedData = await durationRes.json();
        if (oembedData.duration && typeof oembedData.duration === "number") {
          duration = oembedData.duration;
        }
      }
    } catch (e) {
      console.warn("Failed to fetch duration from oEmbed:", e);
    }

    // Attempt 2: if oEmbed didn't give us duration, scrape the video page
    if (duration === 600) {
      try {
        const pageRes = await fetch(`https://www.youtube.com/watch?v=${youtubeId}`);
        const html = await pageRes.text();
        const dataMatch = html.match(/var ytInitialData = ([\s\S]*?);<\/script>/);
        if (dataMatch) {
          const data = JSON.parse(dataMatch[1]);
          const lengthSeconds =
            data?.videoDetails?.lengthSeconds ||
            data?.playerOverlays?.playerOverlayRenderer?.lengthSeconds;
          if (lengthSeconds) {
            duration = parseInt(lengthSeconds);
          }
        }
      } catch (e) {
        console.warn("Failed to fetch duration from page scrape:", e);
      }
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

      if (gap > 3.0) {
        // Significant pause (3s+ indicates a genuine structural break)
        const precedingText = segments
          .slice(Math.max(0, i - 3), i)
          .map((s) => s.text)
          .join(" ");

        const title =
          precedingText.length > 60
            ? precedingText.slice(0, 60).trim() + "..."
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

/**
 * Fetch video metadata with fallback chain:
 *   1. YouTube Data API v3 (requires YOUTUBE_API_KEY env var)
 *   2. YouTube oEmbed endpoint (no key needed, limited data)
 *   3. Scrape video page directly
 */
async function fetchVideoMetadata(
  youtubeId: string,
): Promise<{
  title: string;
  description: string;
  duration: number;
  channelTitle: string;
  category: string;
  tags: string[];
  viewCount: number;
} | null> {
  // Attempt 1: YouTube Data API v3
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (apiKey) {
    try {
      const res = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics&id=${youtubeId}&key=${apiKey}`,
      );
      const data = await res.json();
      const item = data.items?.[0];
      if (item) {
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
          channelTitle: item.snippet?.channelTitle || "",
          category: item.snippet?.categoryId || "",
          tags: item.snippet?.tags || [],
          viewCount: parseInt(item.statistics?.viewCount || "0"),
        };
      }
    } catch (e) {
      console.warn("YouTube Data API failed, trying fallback:", e);
    }
  }

  // Attempt 2: oEmbed (no key needed)
  try {
    const oembedRes = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${youtubeId}&format=json`,
    );
    if (oembedRes.ok) {
      const oembed = await oembedRes.json();
      return {
        title: oembed.title || "",
        description: oembed.author_name || "",
        duration: 600,
        channelTitle: oembed.author_name || "",
        category: "",
        tags: [],
        viewCount: 0,
      };
    }
  } catch (e) {
    console.warn("oEmbed fallback failed, trying page scrape:", e);
  }

  // Attempt 3: scrape video page for title and description
  try {
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${youtubeId}`);
    const html = await pageRes.text();

    const titleMatch = html.match(/<title>([^<]*)<\/title>/);
    const title = titleMatch ? titleMatch[1].replace(" - YouTube", "").trim() : "";

    const descMatch = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
    const description = descMatch
      ? descMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\")
      : "";

    // Try to extract duration from ytInitialData
    let duration = 600;
    const dataMatch = html.match(/var ytInitialData = ([\s\S]*?);<\/script>/);
    if (dataMatch) {
      try {
        const data = JSON.parse(dataMatch[1]);
        const lengthSeconds = data?.videoDetails?.lengthSeconds;
        if (lengthSeconds) {
          duration = parseInt(lengthSeconds);
        }
      } catch (e) {
        console.warn("Failed to parse ytInitialData duration:", e);
      }
    }

    return {
      title,
      description,
      duration,
      channelTitle: "",
      category: "",
      tags: [],
      viewCount: 0,
    };
  } catch (e) {
    console.error("All metadata fetch methods failed:", e);
    return null;
  }
}

function parseDescriptionChapters(
  description: string,
): { timestamp: number; title: string }[] {
  const chapters: { timestamp: number; title: string }[] = [];
  const lines = description.split("\n");

  for (const line of lines) {
    const match = line.match(
      /^(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+)/,
    );
    if (match) {
      const timeParts = match[1].split(":").map(Number);
      let ts = 0;
      if (timeParts.length === 3) {
        ts = timeParts[0] * 3600 + timeParts[1] * 60 + timeParts[2];
      } else {
        ts = timeParts[0] * 60 + timeParts[1];
      }
      chapters.push({ timestamp: ts, title: match[2].trim() });
    }
  }

  return chapters;
}

const CATEGORY_MAP: Record<string, string> = {
  "1": "Film & Animation",
  "2": "Autos & Vehicles",
  "10": "Music",
  "15": "Pets & Animals",
  "17": "Sports",
  "18": "Short Movies",
  "19": "Travel & Events",
  "20": "Gaming",
  "21": "Videoblogging",
  "22": "People & Blogs",
  "23": "Comedy",
  "24": "Entertainment",
  "25": "News & Politics",
  "26": "Howto & Style",
  "27": "Education",
  "28": "Science & Technology",
  "29": "Nonprofits & Activism",
};

/**
 * Sample transcript segments prioritizing dense conversational areas.
 * Dense regions (many words per second) indicate active discussion = more topic shifts.
 */
function sampleTranscriptSmart(
  segments: { start: number; duration: number; text: string }[],
  targetCount: number,
): { start: number; duration: number; text: string }[] {
  if (segments.length <= targetCount) return segments;

  // Score each segment by word density (words per second)
  const scored = segments.map((s, i) => {
    const words = s.text.split(/\s+/).length;
    const density = s.duration > 0 ? words / s.duration : 0;
    return { segment: s, index: i, density };
  });

  // Always include first and last segment
  const selected = new Set<number>([0, segments.length - 1]);
  // Always include segments near the start (10%) and end (90%)
  selected.add(Math.floor(segments.length * 0.1));
  selected.add(Math.floor(segments.length * 0.9));

  // Pick remaining from highest density, spread across the video
  const sorted = [...scored].sort((a, b) => b.density - a.density);
  const bucketSize = segments.length / targetCount;

  for (const item of sorted) {
    if (selected.size >= targetCount) break;
    const bucket = Math.floor(item.index / bucketSize);
    // Only pick one per bucket to ensure even coverage
    const alreadyInBucket = [...selected].some(
      (si) => Math.floor(si / bucketSize) === bucket,
    );
    if (!alreadyInBucket || item.density > 1.5) {
      selected.add(item.index);
    }
  }

  // Fill remaining slots from evenly-spaced segments
  if (selected.size < targetCount) {
    const step = segments.length / targetCount;
    for (let i = 0; selected.size < targetCount && i < targetCount; i++) {
      const idx = Math.min(Math.floor(i * step), segments.length - 1);
      selected.add(idx);
    }
  }

  return [...selected]
    .sort((a, b) => a - b)
    .map((i) => segments[i]);
}

/**
 * Extract timestamps and topics mentioned in the video description.
 */
function extractDescriptionTopics(
  description: string,
): { timestamps: number[]; topics: string[] } {
  const timestamps: number[] = [];
  const topics: string[] = [];

  // Extract inline timestamps (e.g., "2:30 - Topic" or "(1:23:45)")
  const tsRegex = /(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–—:]\s*(.+)/gm;
  let m;
  while ((m = tsRegex.exec(description)) !== null) {
    const parts = m[1].split(":").map(Number);
    const ts = parts.length === 3
      ? parts[0] * 3600 + parts[1] * 60 + parts[2]
      : parts[0] * 60 + parts[1];
    timestamps.push(ts);
    topics.push(m[2].trim().slice(0, 80));
  }

  // Extract bullet-point topics (lines starting with - or •)
  const bulletRegex = /^[•\-\*]\s+(.+)/gm;
  while ((m = bulletRegex.exec(description)) !== null) {
    const text = m[1].trim();
    if (text.length > 5 && text.length < 200) {
      topics.push(text);
    }
  }

  return { timestamps, topics };
}

/**
 * Validate AI-returned timestamps against transcript — nudge to nearest
 * real speech boundary if the timestamp lands in a silence gap.
 */
function validateTimestamps(
  moments: Array<{ timestamp: number; [k: string]: unknown }>,
  segments: { start: number; duration: number; text: string }[],
): Array<{ timestamp: number; [k: string]: unknown }> {
  if (segments.length === 0) return moments;

  return moments.map((m) => {
    const ts = m.timestamp;
    // Find the nearest segment
    let nearest = segments[0];
    let minDist = Math.abs(ts - segments[0].start);
    for (const seg of segments) {
      const dist = Math.abs(ts - seg.start);
      if (dist < minDist) {
        minDist = dist;
        nearest = seg;
      }
    }
    // If timestamp is >15s away from nearest speech, nudge it
    if (minDist > 15) {
      return { ...m, timestamp: nearest.start };
    }
    return m;
  });
}

function parseAIResponse(
  text: string,
  videoDuration: number,
  dedupThreshold: number,
  transcriptSegments?: { start: number; duration: number; text: string }[],
): Array<{ timestamp: number; title: string; description: string; source: "ai"; confidence: number }> {
  const stripped = text.replace(/```(?:json)?\s*\n?([\s\S]*?)\n?```/g, "$1").trim();
  const jsonMatch = stripped.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  let parsed: Array<{
    timestamp: number;
    title: string;
    description?: string;
    confidence?: number;
  }>;

  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    const fixed = jsonMatch[0]
      .replace(/,\s*]/g, "]")
      .replace(/,\s*}/g, "}");
    parsed = JSON.parse(fixed);
  }

  if (!Array.isArray(parsed) || parsed.length === 0) return [];

  let deduped = parsed
    .map((item) => ({
      timestamp: Math.min(Math.max(0, Number(item.timestamp) || 0), videoDuration),
      title: String(item.title || "").slice(0, 60).trim(),
      description: String(item.description || "").trim(),
      source: "ai" as const,
      confidence: Math.min(1, Math.max(0, Number(item.confidence) || 0.5)),
    }))
    .filter((item) => item.title.length > 0)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (transcriptSegments && transcriptSegments.length > 0) {
    deduped = validateTimestamps(deduped, transcriptSegments) as typeof deduped;
  }

  const final: typeof deduped = [];
  for (const moment of deduped) {
    const closeIndex = final.findIndex(
      (f) => Math.abs(f.timestamp - moment.timestamp) < dedupThreshold,
    );
    if (closeIndex >= 0) {
      if (moment.confidence > final[closeIndex].confidence) {
        final[closeIndex] = moment;
      }
    } else {
      final.push(moment);
    }
  }

  return final;
}

/**
 * Split transcript into overlapping chunks for focused per-chunk extraction.
 */
function chunkTranscript(
  segments: { start: number; duration: number; text: string }[],
  chunkSize: number,
  overlap: number,
): { start: number; duration: number; text: string }[][] {
  if (segments.length <= chunkSize) return [segments];
  const chunks: { start: number; duration: number; text: string }[][] = [];
  for (let i = 0; i < segments.length; i += chunkSize - overlap) {
    chunks.push(segments.slice(i, i + chunkSize));
    if (i + chunkSize >= segments.length) break;
  }
  return chunks;
}

export async function extractAIKeyMoments(
  youtubeId: string,
  transcriptSegments?: { start: number; duration: number; text: string }[],
  userKeys?: Record<string, string>,
  preferred?: string | null,
  depth?: "shallow" | "normal" | "deep" | "ultra",
  actualDuration?: number | null,
): Promise<KeyMoment[]> {
  const meta = await fetchVideoMetadata(youtubeId);
  if (!meta) return [];

  const videoDuration = actualDuration && actualDuration > 0 ? actualDuration : meta.duration;

  const descFull = meta.description;
  const descPreview = descFull.length > 4000
    ? descFull.slice(0, 4000) + "..."
    : descFull;

  const descriptionChapters = parseDescriptionChapters(descFull);
  const hasDescriptionChapters = descriptionChapters.length >= 2;

  const { timestamps: descTimestamps, topics: descTopics } = extractDescriptionTopics(descFull);

  const categoryName = CATEGORY_MAP[meta.category] || (meta.category ? "Unknown" : "Unknown");
  const tagStr = meta.tags.length > 0
    ? meta.tags.slice(0, 15).join(", ")
    : "none";

  const durationMin = Math.floor(videoDuration / 60);
  const durationSec = videoDuration % 60;

  const durationMinutes = videoDuration / 60;
  const dScale = Math.max(1, durationMinutes / 10);

  const isUltra = depth === "ultra";
  const isDeep = depth === "deep";
  const isShallow = depth === "shallow";
  const transcriptSampleSize = isUltra ? Math.round(200 * dScale) : isDeep ? Math.round(150 * dScale) : isShallow ? 15 : Math.round(60 * dScale);
  const maxTokens = isUltra ? Math.min(32000, Math.round(16000 * dScale)) : isDeep ? Math.min(24000, Math.round(12000 * dScale)) : isShallow ? 1500 : Math.min(12000, Math.round(6000 * dScale));
  const dedupThreshold = isUltra ? 2 : isDeep ? 3 : 5;

  let chapterSection = "";
  if (hasDescriptionChapters) {
    chapterSection = `
DESCRIPTION CHAPTERS (author-defined, high confidence):
${descriptionChapters.map((c) => `  [${c.timestamp}s] ${c.title}`).join("\n")}
`;
  }

  let descTimestampSection = "";
  if (descTimestamps.length > 0 && !hasDescriptionChapters) {
    descTimestampSection = `
TIMESTAMPS FOUND IN DESCRIPTION:
${descTimestamps.map((ts, i) => `  [${ts}s] ${descTopics[i] || "Section"}`).join("\n")}
`;
  }

  let descTopicsSection = "";
  if (descTopics.length > 0) {
    descTopicsSection = `
KEY TOPICS FROM DESCRIPTION:
${descTopics.slice(0, 20).map((t) => `  - ${t}`).join("\n")}
`;
  }

  let transcriptSection = "";
  let sampledSegments = transcriptSegments;
  if (transcriptSegments && transcriptSegments.length > 0) {
    sampledSegments = sampleTranscriptSmart(transcriptSegments, transcriptSampleSize);
    transcriptSection = `
TRANSCRIPT EXCERPTS (intelligently sampled from dense conversational regions):
${sampledSegments.map((s) => `  [${Math.floor(s.start)}s] ${s.text}`).join("\n")}
`;
  }

  const systemMessage = isUltra
    ? "You are an expert video content analyst who extracts MAXIMALLY detailed key moments. Always return valid JSON arrays. Never include markdown code fences or explanatory text outside the JSON. Be extremely specific and granular — every distinct piece of information is a separate moment."
    : "You are a precise video content analyst. Always return valid JSON arrays. Never include markdown code fences or explanatory text outside the JSON. Be specific and granular in moment titles — avoid vague labels. Extract all distinct topics, key points, examples, and conclusions.";

  // Multi-pass chunked extraction for longer videos (ultra always, deep/normal when video is long enough)
  const useMultiPass = isUltra || (transcriptSegments && transcriptSegments.length > 60 && videoDuration > 600);
  if (useMultiPass && transcriptSegments && transcriptSegments.length > 60) {
    const allMoments: Array<{ timestamp: number; title: string; description: string; source: "ai"; confidence: number }> = [];

    // Pass 1: Overview — identify major sections
    const overviewPrompt = buildPrompt(meta, categoryName, tagStr, videoDuration, durationMin, durationSec, descPreview, chapterSection, descTimestampSection, descTopicsSection, transcriptSection, hasDescriptionChapters, descTimestamps, "overview");
    try {
      const overviewResult = await callAIWithUserKeys({
        messages: [
          { role: "system", content: systemMessage },
          { role: "user", content: overviewPrompt },
        ],
        temperature: 0.3,
        maxTokens: isUltra ? 4000 : 3000,
      }, userKeys, preferred);
      const overviewMoments = parseAIResponse(overviewResult.text, videoDuration, dedupThreshold, transcriptSegments);
      allMoments.push(...overviewMoments);
    } catch (e) {
      console.warn("Overview pass failed:", e);
    }

    // Pass 2: Chunked deep extraction — split transcript into overlapping chunks
    const chunkSize = isUltra ? 100 : isDeep ? 80 : 60;
    const overlap = 20;
    const chunks = chunkTranscript(transcriptSegments, chunkSize, overlap);
    const perChunkTarget = isUltra ? "8-15" : isDeep ? "6-12" : "5-10";

    for (let ci = 0; ci < chunks.length; ci++) {
      const chunk = chunks[ci];
      const chunkStart = chunk[0].start;
      const chunkEnd = chunk[chunk.length - 1].start + chunk[chunk.length - 1].duration;
      const chunkDuration = `${Math.floor(chunkStart / 60)}m${Math.round(chunkStart % 60)}s - ${Math.floor(chunkEnd / 60)}m${Math.round(chunkEnd % 60)}s`;

      const chunkTranscript = `
TRANSCRIPT SEGMENTS (chunk ${ci + 1}/${chunks.length}, covering ${chunkDuration}):
${chunk.map((s) => `  [${Math.floor(s.start)}s] ${s.text}`).join("\n")}
`;

      const chunkPrompt = `You are an expert video analyst. Extract key moments from this SECTION of a YouTube video.

VIDEO: "${meta.title}" by ${meta.channelTitle} (${videoDuration}s total)
THIS SECTION: ${chunkDuration}
${chapterSection}${descTimestampSection}
${chunkTranscript}
INSTRUCTIONS:
1. Extract EVERY distinct topic shift, sub-topic, example, quote, demonstration, tip, and conclusion in this section.
2. Only return moments within the time range ${Math.floor(chunkStart)}s to ${Math.floor(chunkEnd)}s.
3. Be maximally granular — if two moments are 5+ seconds apart and cover different content, list both.
4. For each moment:
   - timestamp: start time in SECONDS (between ${Math.floor(chunkStart)} and ${Math.floor(chunkEnd)})
   - title: specific verb/noun phrase (max 60 chars)
   - description: 1-2 sentences of exactly what is discussed
   - confidence: 0.0-1.0
5. Aim for ${perChunkTarget} moments per chunk.

Return ONLY a JSON array. Example:
[{"timestamp":120,"title":"Introducing the bubble sort algorithm","description":"Explaining how bubble sort works by comparing adjacent elements","confidence":0.9}]`;

      try {
        const chunkResult = await callAIWithUserKeys({
          messages: [
            { role: "system", content: systemMessage },
            { role: "user", content: chunkPrompt },
          ],
          temperature: 0.3,
          maxTokens: 6000,
        }, userKeys, preferred);
        const chunkMoments = parseAIResponse(chunkResult.text, videoDuration, dedupThreshold, transcriptSegments);
        allMoments.push(...chunkMoments);
      } catch (e) {
        console.warn(`Chunk ${ci + 1}/${chunks.length} failed:`, e);
      }
    }

    // Final dedup across all passes
    const final: typeof allMoments = [];
    allMoments.sort((a, b) => a.timestamp - b.timestamp);
    for (const moment of allMoments) {
      const closeIndex = final.findIndex(
        (f) => Math.abs(f.timestamp - moment.timestamp) < dedupThreshold,
      );
      if (closeIndex >= 0) {
        if (moment.confidence > final[closeIndex].confidence) {
          final[closeIndex] = moment;
        }
      } else {
        final.push(moment);
      }
    }

    return final;
  }

  // Single-pass for shallow/normal/deep (or ultra without enough transcript)
  const prompt = buildPrompt(meta, categoryName, tagStr, videoDuration, durationMin, durationSec, descPreview, chapterSection, descTimestampSection, descTopicsSection, transcriptSection, hasDescriptionChapters, descTimestamps, depth);

  try {
    const result = await callAIWithUserKeys({
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      maxTokens,
    }, userKeys, preferred);

    return parseAIResponse(result.text, videoDuration, dedupThreshold, transcriptSegments);
  } catch (e) {
    console.error("Failed to extract AI key moments:", e);
    return [];
  }
}

function buildPrompt(
  meta: { title: string; channelTitle: string; category: string; tags: string[]; viewCount: number },
  categoryName: string,
  tagStr: string,
  videoDuration: number,
  durationMin: number,
  durationSec: number,
  descPreview: string,
  chapterSection: string,
  descTimestampSection: string,
  descTopicsSection: string,
  transcriptSection: string,
  hasDescriptionChapters: boolean,
  descTimestamps: number[],
  depth?: string,
): string {
  const durationMinutes = videoDuration / 60;
  const dScale = Math.max(1, durationMinutes / 10);

  const depthInstruction = depth === "ultra"
    ? `Be MAXIMALLY granular. Extract EVERY distinct piece of information:
- Every topic introduction and transition
- Every sub-topic shift within larger topics
- Every example, case study, and demonstration
- Every important quote, statistic, claim, or result
- Every practical tip, technique, or actionable advice
- Every conceptual explanation, definition, or derivation
- Every comparison, contrast, or evaluation
- Every Q&A moment, audience interaction, or aside
- Every conclusion, summary, or key takeaway
Aim for ${Math.round(25 * dScale)}-${Math.round(50 * dScale)}+ moments for this ${Math.round(durationMinutes)}-minute video.
If you think you have enough, look again — there are probably more distinct moments you missed.
Each moment must represent a genuinely distinct piece of information.`
    : depth === "deep"
    ? `Be EXTREMELY granular. Identify every meaningful moment:
- Topic introductions and transitions
- Sub-topic shifts within a larger topic
- Key examples, demonstrations, or case studies
- Important quotes, statistics, or claims
- Practical tips or actionable advice
- Conceptual explanations and definitions
- Q&A moments or audience interaction
- Conclusions and summaries
Aim for ${Math.round(15 * dScale)}-${Math.round(30 * dScale)}+ moments for this ${Math.round(durationMinutes)}-minute video.
Each moment should represent a distinct piece of information or shift in focus.`
    : depth === "shallow"
    ? `Focus only on the most important structural moments (major topic changes, introduction, conclusion). Aim for ${Math.max(3, Math.round(3 * dScale))}-${Math.max(6, Math.round(6 * dScale))} moments.`
    : `Aim for ${Math.round(15 * dScale)}-${Math.round(25 * dScale)} well-spaced moments covering the main topics, transitions, key points, examples, and conclusions for this ${Math.round(durationMinutes)}-minute video.`;

  return `You are an expert video content analyst specializing in extracting structured key moments from YouTube videos.

VIDEO INFORMATION:
- Title: "${meta.title}"
- Channel: "${meta.channelTitle}"
- Category: ${categoryName}
- Tags: ${tagStr}
- Duration: ${durationMin}m ${durationSec}s (${videoDuration} seconds total)
- Views: ${meta.viewCount.toLocaleString()}
${chapterSection}${descTimestampSection}${descTopicsSection}
FULL VIDEO DESCRIPTION:
${descPreview}
${transcriptSection}
ANALYSIS INSTRUCTIONS:
1. First, mentally map the video's structure: what is the overall topic, what are the main sections, and how does the content flow?
${hasDescriptionChapters ? "2. The author provided chapters — use them as a skeleton, then identify MORE specific sub-moments within each chapter." : descTimestamps.length > 0 ? "2. Timestamps were found in the description — use them as anchor points, then fill in moments between them." : "2. Infer the structure from title, description, tags, and transcript. Educational content: intro → concepts → examples → conclusion. Entertainment: setup → key events → climax → resolution."}
3. For each moment provide:
   - timestamp: precise start time in SECONDS (0 to ${videoDuration})
   - title: concise verb/noun phrase (max 60 chars, be specific not generic)
   - description: 1-2 sentences explaining exactly what happens or is discussed
   - confidence: 0.0-1.0 based on how certain you are this is a real distinct moment
4. SPREAD moments evenly — never cluster more than 20% of moments in any 25% segment of the video.
5. PREFER specificity: "Deriving the chain rule formula" > "Math discussion". "Comparing React vs Vue performance" > "Framework comparison".
6. Use transcript timestamps to anchor moments to actual speech — don't invent timestamps that don't align with what's being said.
7. ${depthInstruction}

Return ONLY a JSON array. No markdown, no explanation. Example:
[{"timestamp":12,"title":"Setting up the development environment","description":"Installing Node.js, creating the project folder, and initializing npm","confidence":0.9}]`;
}