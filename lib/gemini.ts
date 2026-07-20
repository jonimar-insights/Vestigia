import fs from "fs";
import { callAI } from "./ai";

export interface SceneTag {
  description: string;
  tags: string[];
  confidence: number;
  sceneType: string;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 2000,
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "";
      const isRetryable = msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("503");
      if (isRetryable && attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
        console.log(`Rate limited, retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${maxRetries})`);
        await sleep(delay);
        continue;
      }
      throw error;
    }
  }
  throw new Error("Max retries exceeded");
}

export async function tagSceneWithAI(
  imagePath: string,
  context?: { timestamp: number; duration: number },
): Promise<SceneTag> {
  const imageBytes = fs.readFileSync(imagePath);
  const base64Image = imageBytes.toString("base64");

  const contextStr = context
    ? ` This scene starts at ${Math.floor(context.timestamp)}s and lasts ${Math.floor(context.duration)}s.`
    : "";

  const text = await retryWithBackoff(async () => {
    const result = await callAI({
      messages: [
        {
          role: "system",
          content: "You are a video frame analyzer. Respond with JSON only, no markdown.",
        },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${base64Image}` },
            },
            {
              type: "text",
              text: `Analyze this video frame.${contextStr} Respond with JSON only:
{
  "description": "Brief description of what's in this frame (1-2 sentences)",
  "tags": ["tag1", "tag2", "tag3"],
  "sceneType": "one of: talking-head, b-roll, screen-share, graphic, transition, title-card, interview, demonstration, montage, text-overlay, animation, landscape, product, data-viz, other",
  "confidence": 0.95
}

Tags should be lowercase, specific, and useful for searching.`,
            },
          ],
        },
      ],
      temperature: 0.3,
      maxTokens: 1024,
    });
    return result.text;
  });

  try {
    let clean = text.trim();
    if (clean.startsWith("```")) clean = clean.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    const parsed = JSON.parse(clean) as SceneTag;
    return {
      description: parsed.description ?? "",
      tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 8) : [],
      sceneType: parsed.sceneType ?? "other",
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
    };
  } catch {
    return { description: text.slice(0, 200), tags: [], sceneType: "other", confidence: 0 };
  }
}

export async function tagSceneWithMultipleFrames(
  framePaths: string[],
  context?: { timestamp: number; duration: number },
): Promise<SceneTag> {
  if (framePaths.length === 0) {
    return tagSceneWithAI("", context);
  }

  const content: Array<{ type: string; [key: string]: unknown }> = [];

  for (const framePath of framePaths.slice(0, 3)) {
    const imageBytes = fs.readFileSync(framePath);
    content.push({
      type: "image_url",
      image_url: { url: `data:image/jpeg;base64,${imageBytes.toString("base64")}` },
    });
  }

  const contextStr = context
    ? ` These are ${framePaths.length} frames from a ${Math.floor(context.duration)}s scene starting at ${Math.floor(context.timestamp)}s.`
    : "";

  content.push({
    type: "text",
    text: `Analyze these video frames from the same scene.${contextStr} Respond with JSON only:
{
  "description": "Brief description of what happens in this scene (1-2 sentences)",
  "tags": ["tag1", "tag2", "tag3"],
  "sceneType": "one of: talking-head, b-roll, screen-share, graphic, transition, title-card, interview, demonstration, montage, text-overlay, animation, landscape, product, data-viz, other",
  "confidence": 0.95
}

Tags should be lowercase, specific, and useful for searching.`,
  });

  const text = await retryWithBackoff(async () => {
    const result = await callAI({
      messages: [
        { role: "system", content: "You are a video frame analyzer. Respond with JSON only, no markdown." },
        { role: "user", content },
      ],
      temperature: 0.3,
      maxTokens: 1024,
    });
    return result.text;
  });

  try {
    let clean = text.trim();
    if (clean.startsWith("```")) clean = clean.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    const parsed = JSON.parse(clean) as SceneTag;
    return {
      description: parsed.description ?? "",
      tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 8) : [],
      sceneType: parsed.sceneType ?? "other",
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
    };
  } catch {
    return { description: text.slice(0, 200), tags: [], sceneType: "other", confidence: 0 };
  }
}

export async function tagMultipleScenes(
  scenes: { index: number; frames: string[]; timestamp: number; duration: number }[],
  onProgress?: (message: string) => void,
): Promise<Map<number, SceneTag>> {
  const results = new Map<number, SceneTag>();

  for (let i = 0; i < scenes.length; i++) {
    const item = scenes[i];
    try {
      const tag =
        item.frames.length > 1
          ? await tagSceneWithMultipleFrames(item.frames, { timestamp: item.timestamp, duration: item.duration })
          : await tagSceneWithAI(item.frames[0], { timestamp: item.timestamp, duration: item.duration });
      results.set(item.index, tag);
    } catch (e) {
      console.error(`Failed to tag scene ${item.index}:`, e);
      results.set(item.index, { description: "Tagging failed", tags: [], sceneType: "other", confidence: 0 });
    }

    if (i % 3 === 0) {
      onProgress?.(`AI tagging: ${i + 1}/${scenes.length}`);
    }

    if (i < scenes.length - 1) {
      await sleep(1500);
    }
  }

  return results;
}
