import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { defaultVideoSpec, type VideoSpec } from "./video-spec";

export type RenderEngine = "remotion" | "hyperframes";
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
  engine: RenderEngine;
  status: RenderStatus;
  createdAt: string;
  updatedAt: string;
  spec: VideoSpec;
  progress: RenderProgress;
  outputUrl?: string;
  outputPath?: string;
  compositionUrl?: string;
  compositionPath?: string;
  posterUrl?: string;
  posterPath?: string;
  error?: string;
};

const isVercelLikeRuntime = () =>
  process.env.VERCEL === "1" ||
  Boolean(process.env.VERCEL_REGION) ||
  Boolean(process.env.NOW_REGION) ||
  process.cwd().startsWith("/var/task");

const renderRoot = isVercelLikeRuntime()
  ? path.join(os.tmpdir(), "renkumi", "renders")
  : path.join(process.cwd(), "public", "renders");
export const defaultRenderEngine: RenderEngine = "remotion";
const renderTaskReadRetries = 3;
const renderTaskReadRetryDelayMs = 40;
const hostedRenderTaskPrefix = "renders";

export const isHostedRenderRuntime = isVercelLikeRuntime;

export const getRenderRoot = () => renderRoot;

export const getRenderTaskPath = (id: string) => path.join(renderRoot, id, "task.json");

const getRenderBlobToken = () => process.env.BLOB_READ_WRITE_TOKEN?.trim();

const shouldUseHostedRenderStore = () => isHostedRenderRuntime() && Boolean(getRenderBlobToken());

export const getHostedRenderConfigError = () => {
  if (!isHostedRenderRuntime()) {
    return null;
  }

  if (!getRenderBlobToken()) {
    return {
      code: "RENDER_BLOB_STORE_NOT_CONFIGURED",
      error: "Vercel 渲染需要先配置 Vercel Blob。",
      detail:
        "请在 Vercel Storage 创建并绑定 Blob Store，确保部署环境存在 BLOB_READ_WRITE_TOKEN。渲染结果和任务状态都会写入 Blob。",
    };
  }

  return null;
};

const getHostedRenderTaskKey = (id: string) => `${hostedRenderTaskPrefix}/${id}/task.json`;

const getRenderOutputFileName = (engine: RenderEngine = defaultRenderEngine) =>
  engine === "hyperframes" ? "renkumi-hyperframes-video.mp4" : "renkumi-video.mp4";

export const getRenderOutputPath = (id: string, engine: RenderEngine = defaultRenderEngine) =>
  path.join(renderRoot, id, getRenderOutputFileName(engine));

export const getRenderOutputUrl = (id: string, engine: RenderEngine = defaultRenderEngine) =>
  `/renders/${id}/${getRenderOutputFileName(engine)}`;

export const getHyperframesCompositionPath = (id: string) => path.join(renderRoot, id, "hyperframes", "index.html");

export const getHyperframesCompositionUrl = (id: string) => `/renders/${id}/hyperframes/index.html`;

export const getHyperframesPosterPath = (id: string) => path.join(renderRoot, id, "hyperframes-poster.png");

export const getHyperframesPosterUrl = (id: string) => `/renders/${id}/hyperframes-poster.png`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function writeHostedRenderTask(task: RenderTask) {
  const token = getRenderBlobToken();
  if (!token) {
    return;
  }

  const { put } = await import("@vercel/blob");
  await put(getHostedRenderTaskKey(task.id), JSON.stringify(task, null, 2), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    token,
  });
}

async function readHostedRenderTaskByKey(key: string): Promise<RenderTask | null> {
  const token = getRenderBlobToken();
  if (!token) {
    return null;
  }

  const { BlobNotFoundError, get } = await import("@vercel/blob");

  try {
    const blob = await get(key, {
      access: "private",
      token,
      useCache: false,
    });

    if (!blob || blob.statusCode !== 200 || !blob.stream) {
      return null;
    }

    return (await new Response(blob.stream).json()) as RenderTask;
  } catch (error) {
    if (error instanceof BlobNotFoundError) {
      return null;
    }

    throw error;
  }
}

async function readHostedRenderTask(id: string): Promise<RenderTask | null> {
  return readHostedRenderTaskByKey(getHostedRenderTaskKey(id));
}

async function listHostedRenderTasks(): Promise<RenderTask[]> {
  const token = getRenderBlobToken();
  if (!token) {
    return [];
  }

  const { list } = await import("@vercel/blob");
  const blobs: { pathname: string; url: string }[] = [];
  let cursor: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const page = await list({
      cursor,
      limit: 1000,
      prefix: `${hostedRenderTaskPrefix}/`,
      token,
    });
    blobs.push(...page.blobs);
    cursor = page.cursor;
    hasMore = page.hasMore;
  }

  const tasks = await Promise.all(
    blobs
      .filter((blob) => blob.pathname.endsWith("/task.json"))
      .map((blob) =>
        readHostedRenderTaskByKey(blob.pathname).catch(() => {
          return null;
        }),
      ),
  );

  return tasks
    .filter((task): task is RenderTask => Boolean(task))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function createRenderTask(
  spec: VideoSpec = defaultVideoSpec,
  engine: RenderEngine = defaultRenderEngine,
): Promise<RenderTask> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const task: RenderTask = {
    id,
    engine,
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
  if (shouldUseHostedRenderStore()) {
    const hostedTask = await readHostedRenderTask(id);
    if (hostedTask) {
      return hostedTask;
    }
  }

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

export async function listRenderTasks(): Promise<RenderTask[]> {
  if (shouldUseHostedRenderStore()) {
    return listHostedRenderTasks();
  }

  const entries = await fs.readdir(renderRoot, { withFileTypes: true }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  });

  const tasks = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        try {
          return await readRenderTask(entry.name);
        } catch {
          return null;
        }
      }),
  );

  return tasks
    .filter((task): task is RenderTask => Boolean(task))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function readLatestRenderTask(): Promise<RenderTask | null> {
  const [latestTask] = await listRenderTasks();
  return latestTask ?? null;
}

export async function writeRenderTask(task: RenderTask) {
  const taskPath = getRenderTaskPath(task.id);
  const taskDir = path.dirname(taskPath);
  const tempPath = path.join(taskDir, `task.${process.pid}.${Date.now()}.tmp`);
  const persistedTask = { ...task, updatedAt: new Date().toISOString() };

  await fs.mkdir(taskDir, { recursive: true });
  await fs.writeFile(tempPath, JSON.stringify(persistedTask, null, 2));
  await fs.rename(tempPath, taskPath);

  if (shouldUseHostedRenderStore()) {
    await writeHostedRenderTask(persistedTask);
  }
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
