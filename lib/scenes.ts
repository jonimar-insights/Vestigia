import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import os from "os";

const execFileAsync = promisify(execFile);

export interface Scene {
  timestamp: number;
  duration?: number;
  score?: number;
  thumbnailPath?: string;
  middleFramePath?: string;
}

export interface DetectOptions {
  threshold?: number;
  minSceneDuration?: number;
  maxScenes?: number;
  onProgress?: (message: string) => void;
}

function getFfmpegPath(): string {
  const candidates = [
    path.join(/* turbopackIgnore: true */ process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg"),
    path.join(/* turbopackIgnore: true */ process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg.exe"),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  throw new Error(
    `ffmpeg-static binary not found. Tried: ${candidates.join(", ")}`,
  );
}

export async function getVideoDuration(inputPath: string): Promise<number> {
  const ffmpeg = getFfmpegPath();
  const { stderr } = await execFileAsync(ffmpeg, [
    "-i",
    inputPath,
    "-f",
    "null",
    "-",
  ]);

  const match = stderr.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
  if (!match) return 0;

  const hours = parseInt(match[1]);
  const minutes = parseInt(match[2]);
  const seconds = parseInt(match[3]);
  return hours * 3600 + minutes * 60 + seconds;
}

export async function detectScenes(
  inputPath: string,
  options: DetectOptions = {},
): Promise<Scene[]> {
  const {
    threshold = 0.3,
    minSceneDuration = 1.0,
    maxScenes = 50,
    onProgress,
  } = options;

  const ffmpeg = getFfmpegPath();
  const duration = await getVideoDuration(inputPath);

  onProgress?.("Running scene detection...");

  let scenes: Scene[] = [];

  try {
    const { stderr } = await execFileAsync(ffmpeg, [
      "-i",
      inputPath,
      "-vf",
      `select='gt(scene,${threshold})',showinfo`,
      "-f",
      "null",
      "-",
    ]);

    const regex = /pts_time:([\d.]+)/g;
    let match;
    while ((match = regex.exec(stderr)) !== null) {
      scenes.push({ timestamp: parseFloat(match[1]) });
    }
  } catch {
    // Fallback to scdet filter
    const { stderr } = await execFileAsync(ffmpeg, [
      "-i",
      inputPath,
      "-vf",
      `scdet=t=${Math.round(threshold * 100)}`,
      "-f",
      "null",
      "-",
    ]);

    const regex = /pts_time:([\d.]+)/g;
    let match;
    while ((match = regex.exec(stderr)) !== null) {
      scenes.push({ timestamp: parseFloat(match[1]) });
    }
  }

  // Always include start and end
  if (scenes.length === 0 && duration > 0) {
    scenes.push({ timestamp: 0 });
  }

  if (scenes.length > 0 && duration > 0) {
    const lastScene = scenes[scenes.length - 1];
    if (duration - lastScene.timestamp > 2) {
      scenes.push({ timestamp: duration - 0.1 });
    }
  }

  // Calculate scene durations
  for (let i = 0; i < scenes.length; i++) {
    const nextTimestamp =
      i < scenes.length - 1 ? scenes[i + 1].timestamp : duration;
    scenes[i].duration = nextTimestamp - scenes[i].timestamp;
  }

  // Filter by minimum duration
  scenes = scenes.filter(
    (s) => (s.duration ?? 0) >= minSceneDuration || s.timestamp === 0,
  );

  // Recalculate durations after filtering
  for (let i = 0; i < scenes.length; i++) {
    const nextTimestamp =
      i < scenes.length - 1 ? scenes[i + 1].timestamp : duration;
    scenes[i].duration = nextTimestamp - scenes[i].timestamp;
  }

  // Smart sampling if too many scenes
  if (scenes.length > maxScenes && duration > 0) {
    scenes = smartSample(scenes, maxScenes);
  }

  // Add scores based on scene duration (shorter = more interesting)
  const maxDur = Math.max(...scenes.map((s) => s.duration ?? 1));
  for (const scene of scenes) {
    scene.score = 1 - (scene.duration ?? 1) / maxDur;
  }

  onProgress?.(`Found ${scenes.length} scenes`);

  return scenes;
}

function smartSample(scenes: Scene[], maxScenes: number): Scene[] {
  if (scenes.length <= maxScenes) return scenes;

  // Always keep first and last
  const first = scenes[0];
  const last = scenes[scenes.length - 1];
  const middle = scenes.slice(1, -1);

  // Sort by score (interestingness) and take top N
  middle.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const selected = middle.slice(0, maxScenes - 2);

  // Sort by timestamp
  selected.sort((a, b) => a.timestamp - b.timestamp);

  return [first, ...selected, last];
}

export async function extractFrame(
  inputPath: string,
  timestamp: number,
  outputPath: string,
): Promise<void> {
  const ffmpeg = getFfmpegPath();

  await execFileAsync(ffmpeg, [
    "-i",
    inputPath,
    "-ss",
    timestamp.toString(),
    "-vframes",
    "1",
    "-q:v",
    "3",
    "-vf",
    "scale='min(640,iw)':'-1'",
    outputPath,
  ]);
}

export async function extractSceneFrames(
  inputPath: string,
  scenes: Scene[],
  outputDir: string,
  onProgress?: (message: string) => void,
): Promise<Scene[]> {
  fs.mkdirSync(outputDir, { recursive: true });

  const results: Scene[] = [];
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const thumbPath = path.join(outputDir, `scene_${i}.jpg`);
    const middlePath = path.join(outputDir, `scene_${i}_mid.jpg`);

    try {
      await extractFrame(inputPath, scene.timestamp + 0.5, thumbPath);
      results.push({ ...scene, thumbnailPath: thumbPath });

      if (scene.duration && scene.duration > 3) {
        const midTime = scene.timestamp + scene.duration / 2;
        await extractFrame(inputPath, midTime, middlePath);
        results[results.length - 1].middleFramePath = middlePath;
      }
    } catch (e) {
      console.error(`Failed to extract frame at ${scene.timestamp}s:`, e);
      results.push(scene);
    }

    if (i % 10 === 0) {
      onProgress?.(`Extracting frames: ${i + 1}/${scenes.length}`);
    }
  }

  return results;
}

export async function downloadVideo(
  youtubeId: string,
  onProgress?: (message: string) => void,
): Promise<string> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yt-video-"));
  const outputPath = path.join(tmpDir, `${youtubeId}.mp4`);

  onProgress?.("Downloading video...");

  const formats = [
    "bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480][ext=mp4]",
    "bestvideo[height<=480]+bestaudio/best[height<=480]",
    "best[height<=480]",
    "worst[ext=mp4]",
    "worst",
  ];

  for (const format of formats) {
    try {
      await execFileAsync("yt-dlp", [
        "-f",
        format,
        "--merge-output-format",
        "mp4",
        "--no-playlist",
        "-o",
        outputPath,
        `https://www.youtube.com/watch?v=${youtubeId}`,
      ]);

      if (fs.existsSync(outputPath)) {
        return outputPath;
      }

      const files = fs.readdirSync(tmpDir).filter((f) => f.endsWith(".mp4"));
      if (files.length > 0) {
        return path.join(tmpDir, files[0]);
      }
    } catch {
      continue;
    }
  }

  throw new Error("Failed to download video with any format");
}

export function cleanupTempDir(dirPath: string) {
  try {
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
    }
  } catch (e) {
    console.error("Failed to cleanup temp dir:", e);
  }
}
