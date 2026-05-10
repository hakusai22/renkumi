import { spawn } from "node:child_process";
import { NextResponse } from "next/server";
import {
  createRenderTask,
  defaultRenderEngine,
  getHostedRenderConfigError,
  getRenderStoreConfigError,
  isBlobRenderStoreEnabled,
  isHostedRenderRuntime,
  updateRenderTask,
  type RenderEngine,
} from "@/lib/render-store";
import { defaultVideoSpec, type VideoSpec } from "@/lib/video-spec";

export const runtime = "nodejs";
export const maxDuration = 10;

type RenderBody = {
  engine?: RenderEngine;
  spec?: VideoSpec;
};

const parseRenderEngine = (value: unknown): RenderEngine =>
  value === "hyperframes" || value === "remotion" ? value : defaultRenderEngine;

const failRenderTask = async (id: string, message: string) => {
  await updateRenderTask(id, {
    status: "failed",
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

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as RenderBody;
  const engine = parseRenderEngine(body.engine);

  if (isHostedRenderRuntime()) {
    if (engine !== "remotion") {
      return NextResponse.json(
        {
          code: "RENDER_ENGINE_UNAVAILABLE_IN_HOSTED_QUEUE",
          error: "当前部署环境仅支持 Remotion 队列渲染。",
          detail: "HyperFrames 仍需要本地浏览器、Python 和 ffmpeg，请在本地运行。",
          engine,
        },
        { status: 501 },
      );
    }

    const configError = getHostedRenderConfigError();
    if (configError) {
      return NextResponse.json({ ...configError, engine }, { status: 503 });
    }

    try {
      const task = await createRenderTask(body.spec ?? defaultVideoSpec, engine);
      return NextResponse.json({
        id: task.id,
        engine: task.engine,
        status: task.status,
        progress: task.progress,
        statusUrl: `/api/render/status?id=${task.id}`,
        pageUrl: `/renders/${task.id}`,
      });
    } catch (error) {
      return NextResponse.json(
        {
          code: "RENDER_TASK_QUEUE_FAILED",
          error: "渲染任务创建失败。",
          detail: error instanceof Error ? error.message : String(error),
          engine,
        },
        { status: 503 },
      );
    }
  }

  const storeConfigError = getRenderStoreConfigError();
  if (storeConfigError) {
    return NextResponse.json({ ...storeConfigError, engine }, { status: 503 });
  }

  if (isBlobRenderStoreEnabled()) {
    if (engine !== "remotion") {
      return NextResponse.json(
        {
          code: "RENDER_ENGINE_UNAVAILABLE_IN_HOSTED_QUEUE",
          error: "Blob 队列模式仅支持 Remotion 渲染。",
          detail: "HyperFrames 请使用本地文件系统模式运行。",
          engine,
        },
        { status: 501 },
      );
    }

    const task = await createRenderTask(body.spec ?? defaultVideoSpec, engine);
    return NextResponse.json({
      id: task.id,
      engine: task.engine,
      status: task.status,
      progress: task.progress,
      statusUrl: `/api/render/status?id=${task.id}`,
      pageUrl: `/renders/${task.id}`,
    });
  }

  const task = await createRenderTask(body.spec ?? defaultVideoSpec, engine);
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const child = spawn(pnpm, ["exec", "tsx", "scripts/render-worker.ts", task.id], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
  });

  child.on("error", (error) => {
    void failRenderTask(task.id, error instanceof Error ? error.message : String(error));
  });

  child.on("exit", (code) => {
    if (code && code !== 0) {
      void failRenderTask(task.id, `Render worker exited with code ${code}`);
    }
  });

  child.unref();

  return NextResponse.json({
    id: task.id,
    engine: task.engine,
    status: task.status,
    progress: task.progress,
    statusUrl: `/api/render/status?id=${task.id}`,
    pageUrl: `/renders/${task.id}`,
  });
}
