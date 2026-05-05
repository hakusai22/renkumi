import { promises as fs } from "node:fs";
import path from "node:path";
import { defaultVideoSpec, type VideoSpec } from "./video-spec";

export type RenderStatus = "queued" | "rendering" | "succeeded" | "failed";

export type RenderProgress = {
  percent: number;
  renderedFrames: number;
  encodedFrames: number;
  stage: "queued" | "bundling" | "rendering" | "encoding" | "muxing" | "done";
  message: string;
};

export type RenderTask = {
  id: string;
  status: RenderStatus;
  createdAt: string;
  updatedAt: string;
  spec: VideoSpec;
  progress: RenderProgress;
  outputUrl?: string;
  outputPath?: string;
  error?: string;
};

const renderRoot = path.join(process.cwd(), "public", "renders");
const renderTaskReadRetries = 3;
const renderTaskReadRetryDelayMs = 40;

export const getRenderRoot = () => renderRoot;

export const getRenderTaskPath = (id: string) => path.join(renderRoot, id, "task.json");

export const getRenderOutputPath = (id: string) => path.join(renderRoot, id, "launchcut-video.mp4");

export const getRenderOutputUrl = (id: string) => `/renders/${id}/launchcut-video.mp4`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function createRenderTask(spec: VideoSpec = defaultVideoSpec): Promise<RenderTask> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const task: RenderTask = {
    id,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    spec,
    progress: {
      percent: 0,
      renderedFrames: 0,
      encodedFrames: 0,
      stage: "queued",
      message: "等待开始",
    },
  };

  await fs.mkdir(path.join(renderRoot, id), { recursive: true });
  await writeRenderTask(task);

  return task;
}

export async function readRenderTask(id: string): Promise<RenderTask | null> {
  for (let attempt = 0; attempt <= renderTaskReadRetries; attempt += 1) {
    try {
      const raw = await fs.readFile(getRenderTaskPath(id), "utf8");
      return JSON.parse(raw) as RenderTask;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }

      if (error instanceof SyntaxError && attempt < renderTaskReadRetries) {
        await sleep(renderTaskReadRetryDelayMs);
        continue;
      }

      throw error;
    }
  }

  return null;
}

export async function writeRenderTask(task: RenderTask) {
  const taskPath = getRenderTaskPath(task.id);
  const taskDir = path.dirname(taskPath);
  const tempPath = path.join(taskDir, `task.${process.pid}.${Date.now()}.tmp`);

  await fs.mkdir(taskDir, { recursive: true });
  await fs.writeFile(tempPath, JSON.stringify({ ...task, updatedAt: new Date().toISOString() }, null, 2));
  await fs.rename(tempPath, taskPath);
}

export async function updateRenderTask(id: string, patch: Partial<RenderTask>) {
  const task = await readRenderTask(id);
  if (!task) {
    throw new Error(`Render task ${id} was not found`);
  }
  const nextTask = { ...task, ...patch, updatedAt: new Date().toISOString() };
  await writeRenderTask(nextTask);
  return nextTask;
}
