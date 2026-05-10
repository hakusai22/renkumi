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
  attempts?: number;
  workerId?: string;
  startedAt?: string;
  heartbeatAt?: string;
  completedAt?: string;
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

export type RenderWorkerStatus = "idle" | "rendering" | "stopped";

export type RenderWorkerHeartbeat = {
  workerId: string;
  status: RenderWorkerStatus;
  updatedAt: string;
  currentTaskIds?: string[];
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
const renderWorkerHeartbeatPrefix = "render-workers";
const renderHealthKey = `${hostedRenderTaskPrefix}/_health/latest.json`;

export const isHostedRenderRuntime = isVercelLikeRuntime;

export const getRenderRoot = () => renderRoot;

export const getRenderTaskPath = (id: string) => path.join(renderRoot, id, "task.json");

export const getRenderBlobToken = () => process.env.BLOB_READ_WRITE_TOKEN?.trim();

export const isBlobRenderStoreRequested = () => process.env.RENDER_STORE?.trim().toLowerCase() === "blob";

export const isBlobRenderStoreEnabled = () => isBlobRenderStoreRequested() && Boolean(getRenderBlobToken());

const shouldUseBlobRenderStore = isBlobRenderStoreEnabled;

export const getRenderStoreMode = () => (isBlobRenderStoreRequested() ? "blob" : "filesystem");

export const getRenderStoreConfigError = () => {
  if (isBlobRenderStoreRequested() && !getRenderBlobToken()) {
    return {
      code: "RENDER_BLOB_STORE_NOT_CONFIGURED",
      error: "Vercel 渲染需要先配置 Vercel Blob。",
      detail:
        "请在 Vercel Storage 创建并绑定 Blob Store，确保部署环境存在 BLOB_READ_WRITE_TOKEN。渲染结果和任务状态都会写入 Blob。",
    };
  }

  return null;
};

export const getHostedRenderConfigError = () => {
  if (!isHostedRenderRuntime()) {
    return null;
  }

  if (!isBlobRenderStoreRequested()) {
    return {
      code: "RENDER_BLOB_STORE_NOT_ENABLED",
      error: "Vercel 渲染队列需要启用 Blob Render Store。",
      detail:
        "请在 Vercel 环境变量中设置 RENDER_STORE=blob，并确保独立 worker 使用同一个 BLOB_READ_WRITE_TOKEN。",
    };
  }

  return getRenderStoreConfigError();
};

const getHostedRenderTaskKey = (id: string) => `${hostedRenderTaskPrefix}/${id}/task.json`;

const getRenderWorkerHeartbeatKey = (workerId: string) => `${renderWorkerHeartbeatPrefix}/${workerId}.json`;

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

async function writeHostedJson(key: string, value: unknown) {
  const token = getRenderBlobToken();
  if (!token) {
    return;
  }

  const { put } = await import("@vercel/blob");
  await put(key, JSON.stringify(value, null, 2), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    token,
  });
}

async function readHostedRenderTaskByKey(key: string): Promise<RenderTask | null> {
  return readHostedJsonByKey<RenderTask>(key);
}

async function readHostedJsonByKey<Value>(key: string): Promise<Value | null> {
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

    return (await new Response(blob.stream).json()) as Value;
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

async function listHostedJsonKeys(prefix: string): Promise<string[]> {
  const token = getRenderBlobToken();
  if (!token) {
    return [];
  }

  const { list } = await import("@vercel/blob");
  const keys: string[] = [];
  let cursor: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const page = await list({
      cursor,
      limit: 1000,
      prefix,
      token,
    });
    keys.push(...page.blobs.map((blob: { pathname: string }) => blob.pathname));
    cursor = page.cursor;
    hasMore = page.hasMore;
  }

  return keys;
}

async function listHostedRenderTasks(): Promise<RenderTask[]> {
  const keys = await listHostedJsonKeys(`${hostedRenderTaskPrefix}/`);

  const tasks = await Promise.all(
    keys
      .filter((key) => key.endsWith("/task.json"))
      .map((key) =>
        readHostedRenderTaskByKey(key).catch(() => {
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
    attempts: 0,
    spec,
    progress: {
      percent: 0,
      renderedFrames: 0,
      encodedFrames: 0,
      stage: "queued",
      message: "等待开始",
    },
  };

  if (!shouldUseBlobRenderStore()) {
    await fs.mkdir(path.join(renderRoot, id), { recursive: true });
  }

  await writeRenderTask(task);

  return task;
}

export async function readRenderTask(id: string): Promise<RenderTask | null> {
  if (shouldUseBlobRenderStore()) {
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
  if (shouldUseBlobRenderStore()) {
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
  if (shouldUseBlobRenderStore()) {
    await writeHostedRenderTask({ ...task, updatedAt: new Date().toISOString() });
    return;
  }

  const taskPath = getRenderTaskPath(task.id);
  const taskDir = path.dirname(taskPath);
  const tempPath = path.join(taskDir, `task.${process.pid}.${Date.now()}.tmp`);
  const persistedTask = { ...task, updatedAt: new Date().toISOString() };

  await fs.mkdir(taskDir, { recursive: true });
  await fs.writeFile(tempPath, JSON.stringify(persistedTask, null, 2));
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

export async function listQueuedRenderTasks(): Promise<RenderTask[]> {
  return (await listRenderTasks())
    .filter((task) => task.status === "queued")
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export async function uploadRenderOutputToBlob(
  id: string,
  filePath: string,
  engine: RenderEngine = defaultRenderEngine,
) {
  const token = getRenderBlobToken();
  if (!token) {
    throw new Error("BLOB_READ_WRITE_TOKEN is required to upload render output.");
  }

  const { put } = await import("@vercel/blob");
  const bytes = await fs.readFile(filePath);
  const blob = await put(`${hostedRenderTaskPrefix}/${id}/${getRenderOutputFileName(engine)}`, bytes, {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "video/mp4",
    token,
  });

  return blob.url;
}

export async function writeRenderWorkerHeartbeat(
  workerId: string,
  status: RenderWorkerStatus = "idle",
  currentTaskIds: string[] = [],
) {
  const heartbeat: RenderWorkerHeartbeat = {
    workerId,
    status,
    currentTaskIds,
    updatedAt: new Date().toISOString(),
  };

  if (shouldUseBlobRenderStore()) {
    await writeHostedJson(getRenderWorkerHeartbeatKey(workerId), heartbeat);
    return heartbeat;
  }

  const workerDir = path.join(renderRoot, "_workers");
  await fs.mkdir(workerDir, { recursive: true });
  await fs.writeFile(path.join(workerDir, `${workerId}.json`), JSON.stringify(heartbeat, null, 2));
  return heartbeat;
}

export async function listRenderWorkerHeartbeats(): Promise<RenderWorkerHeartbeat[]> {
  if (shouldUseBlobRenderStore()) {
    const keys = await listHostedJsonKeys(`${renderWorkerHeartbeatPrefix}/`);
    const heartbeats = await Promise.all(
      keys
        .filter((key) => key.endsWith(".json"))
        .map((key) =>
          readHostedJsonByKey<RenderWorkerHeartbeat>(key).catch(() => {
            return null;
          }),
        ),
    );

    return heartbeats
      .filter((heartbeat): heartbeat is RenderWorkerHeartbeat => Boolean(heartbeat))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  const workerDir = path.join(renderRoot, "_workers");
  const entries = await fs.readdir(workerDir).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  });

  const heartbeats = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".json"))
      .map(async (entry) => {
        try {
          return JSON.parse(await fs.readFile(path.join(workerDir, entry), "utf8")) as RenderWorkerHeartbeat;
        } catch {
          return null;
        }
      }),
  );

  return heartbeats
    .filter((heartbeat): heartbeat is RenderWorkerHeartbeat => Boolean(heartbeat))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function readLatestRenderWorkerHeartbeat(): Promise<RenderWorkerHeartbeat | null> {
  const [latestHeartbeat] = await listRenderWorkerHeartbeats();
  return latestHeartbeat ?? null;
}

export async function checkRenderStoreHealth() {
  const now = new Date().toISOString();

  if (shouldUseBlobRenderStore()) {
    const payload = { ok: true, checkedAt: now };
    await writeHostedJson(renderHealthKey, payload);
    const readBack = await readHostedJsonByKey<typeof payload>(renderHealthKey);
    return {
      mode: "blob" as const,
      ok: Boolean(readBack?.ok),
      checkedAt: now,
    };
  }

  const healthDir = path.join(renderRoot, "_health");
  const healthPath = path.join(healthDir, "latest.json");
  const payload = { ok: true, checkedAt: now };
  await fs.mkdir(healthDir, { recursive: true });
  await fs.writeFile(healthPath, JSON.stringify(payload, null, 2));
  const readBack = JSON.parse(await fs.readFile(healthPath, "utf8")) as typeof payload;

  return {
    mode: "filesystem" as const,
    ok: Boolean(readBack.ok),
    checkedAt: now,
  };
}
