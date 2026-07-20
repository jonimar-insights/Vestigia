interface SceneJob {
  videoId: number;
  status: "running" | "done" | "error";
  message?: string;
  stage?: string;
  scenesFound: number;
  totalScenes?: number;
  startedAt: string;
  completedAt?: string;
}

const jobs = new Map<number, SceneJob>();

export function startSceneJob(videoId: number): void {
  jobs.set(videoId, {
    videoId,
    status: "running",
    scenesFound: 0,
    startedAt: new Date().toISOString(),
  });
}

export function updateSceneJob(
  videoId: number,
  update: Partial<Omit<SceneJob, "videoId">>,
): void {
  const job = jobs.get(videoId);
  if (job) {
    Object.assign(job, update);
  }
}

export function getSceneJob(videoId: number): SceneJob | undefined {
  return jobs.get(videoId);
}

export function isSceneJobRunning(videoId: number): boolean {
  const job = jobs.get(videoId);
  return job?.status === "running";
}
