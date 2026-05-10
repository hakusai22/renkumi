import {
  createRenderTask,
  getRenderStoreConfigError,
  isBlobRenderStoreEnabled,
  listRenderTasks,
  readRenderTask,
  updateRenderTask,
  uploadRenderOutputToBlob,
  writeRenderWorkerHeartbeat,
  type RenderTask,
} from "../lib/render-store";
import { renderRenkumiHyperframesVideo } from "../lib/render-hyperframes-video";
import { renderRenkumiVideo } from "../lib/render-renkumi-video";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getWorkerId = () => process.env.RENDER_WORKER_ID?.trim() || `render-worker-${process.pid}`;

const getPositiveIntegerEnv = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
};

const getPollMs = () => getPositiveIntegerEnv("RENDER_WORKER_POLL_MS", 3000);

const getConcurrency = () => getPositiveIntegerEnv("RENDER_WORKER_CONCURRENCY", 1);

const getStaleTaskMs = () => getPositiveIntegerEnv("RENDER_WORKER_STALE_TASK_MS", 15 * 60 * 1000);

const failTask = async (task: RenderTask, message: string, workerId = getWorkerId()) => {
  await updateRenderTask(task.id, {
    status: "failed",
    workerId,
    completedAt: new Date().toISOString(),
    error: message,
    progress: {
      percent: 0,
      renderedFrames: 0,
      encodedFrames: 0,
      stage: "queued",
      message: "生成失败",
    },
  }).catch(() => undefined);
};

const isStaleRenderingTask = (task: RenderTask) => {
  if (task.status !== "rendering") {
    return false;
  }

  const lastHeartbeat = task.heartbeatAt ?? task.updatedAt;
  return Date.now() - Date.parse(lastHeartbeat) > getStaleTaskMs();
};

const renderTask = async (task: RenderTask, workerId = getWorkerId()) => {
  if (task.engine !== "remotion") {
    await failTask(task, "Hosted render worker only supports Remotion tasks.", workerId);
    throw new Error("Hosted render worker only supports Remotion tasks.");
  }

  const now = new Date().toISOString();
  await updateRenderTask(task.id, {
    status: "rendering",
    attempts: (task.attempts ?? 0) + 1,
    workerId,
    startedAt: now,
    heartbeatAt: now,
    completedAt: undefined,
    error: undefined,
    progress: {
      percent: 1,
      renderedFrames: 0,
      encodedFrames: 0,
      stage: "queued",
      message: "任务已领取，等待 worker 渲染",
    },
  });

  try {
    await writeRenderWorkerHeartbeat(workerId, "rendering", [task.id]);
    const result = await renderRenkumiVideo(task.id);

    if (isBlobRenderStoreEnabled()) {
      if (!result.outputPath) {
        throw new Error("Render finished without a local output path to upload.");
      }

      await updateRenderTask(task.id, {
        heartbeatAt: new Date().toISOString(),
        progress: {
          ...result.progress,
          percent: 96,
          stage: "muxing",
          message: "正在上传视频到 Vercel Blob",
        },
      });

      const outputUrl = await uploadRenderOutputToBlob(task.id, result.outputPath, "remotion");
      return updateRenderTask(task.id, {
        status: "succeeded",
        workerId,
        heartbeatAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        outputUrl,
      });
    }

    return updateRenderTask(task.id, {
      status: "succeeded",
      workerId,
      heartbeatAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
  } catch (error) {
    await failTask(task, error instanceof Error ? error.message : String(error), workerId);
    throw error;
  } finally {
    await writeRenderWorkerHeartbeat(workerId, "idle", []).catch(() => undefined);
  }
};

async function renderSingleTask() {
  const requestedId = process.argv[2];
  const requestedEngine = process.argv[3] === "hyperframes" ? "hyperframes" : "remotion";
  const task =
    requestedId && requestedId !== "sample"
      ? await readRenderTask(requestedId)
      : await createRenderTask(undefined, requestedEngine);

  if (!task) {
    throw new Error(`Render task ${requestedId} was not found`);
  }

  const engine = task.engine ?? "remotion";
  console.log(`Rendering ${task.id} with ${engine}...`);
  const result = engine === "hyperframes" ? await renderRenkumiHyperframesVideo(task.id) : await renderTask(task);
  console.log(`Rendered ${result.outputUrl}`);
}

async function runWorkerLoop() {
  const workerId = getWorkerId();
  const pollMs = getPollMs();
  const concurrency = getConcurrency();
  const activeTaskIds = new Set<string>();

  const heartbeatTimer = setInterval(() => {
    const status = activeTaskIds.size > 0 ? "rendering" : "idle";
    const ids = [...activeTaskIds];
    void writeRenderWorkerHeartbeat(workerId, status, ids).catch(() => undefined);
    ids.forEach((id) => {
      void updateRenderTask(id, { heartbeatAt: new Date().toISOString(), workerId }).catch(() => undefined);
    });
  }, Math.max(1000, Math.min(pollMs, 10_000)));

  console.log(`Render worker ${workerId} polling every ${pollMs}ms with concurrency ${concurrency}.`);
  await writeRenderWorkerHeartbeat(workerId, "idle", []);

  try {
    while (true) {
      const tasks = await listRenderTasks();
      const staleTasks = tasks.filter(isStaleRenderingTask);
      await Promise.all(
        staleTasks.map((task) =>
          failTask(task, `Render worker heartbeat timed out after ${getStaleTaskMs()}ms.`, workerId),
        ),
      );

      const queuedTasks = tasks
        .filter((task) => task.status === "queued" && task.engine === "remotion")
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .slice(0, concurrency);

      if (queuedTasks.length === 0) {
        await writeRenderWorkerHeartbeat(workerId, "idle", []);
        await sleep(pollMs);
        continue;
      }

      await Promise.all(
        queuedTasks.map(async (task) => {
          activeTaskIds.add(task.id);
          try {
            const latestTask = await readRenderTask(task.id);
            if (!latestTask || latestTask.status !== "queued") {
              return;
            }

            await renderTask(latestTask, workerId);
          } finally {
            activeTaskIds.delete(task.id);
          }
        }),
      );
    }
  } finally {
    clearInterval(heartbeatTimer);
    await writeRenderWorkerHeartbeat(workerId, "stopped", [...activeTaskIds]).catch(() => undefined);
  }
}

async function main() {
  const configError = getRenderStoreConfigError();
  if (configError) {
    throw new Error(`${configError.error} ${configError.detail}`);
  }

  if (process.argv.includes("--loop")) {
    await runWorkerLoop();
    return;
  }

  await renderSingleTask();
}

main().catch(async (error) => {
  console.error(error);
  await writeRenderWorkerHeartbeat(getWorkerId(), "stopped", []).catch(() => undefined);
  process.exit(1);
});
