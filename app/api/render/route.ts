import { spawn } from "node:child_process";
import { after, NextResponse } from "next/server";
import { renderRenkumiVideoOnVercel } from "@/lib/render-renkumi-video-vercel";
import {
  createRenderTask,
  defaultRenderEngine,
  getHostedRenderConfigError,
  isHostedRenderRuntime,
  updateRenderTask,
  type RenderEngine,
} from "@/lib/render-store";
import { defaultVideoSpec, type VideoSpec } from "@/lib/video-spec";

export const runtime = "nodejs";
export const maxDuration = 300;

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
          code: "RENDER_ENGINE_UNAVAILABLE_ON_VERCEL",
          error: "当前 Vercel 部署环境仅支持 Remotion Sandbox 渲染。",
          detail: "HyperFrames 仍需要本地 worker/浏览器/文件系统路径，请在本地运行或接入独立 worker。",
          engine,
        },
        { status: 501 },
      );
    }

    const configError = getHostedRenderConfigError();
    if (configError) {
      return NextResponse.json({ ...configError, engine }, { status: 501 });
    }

    const task = await createRenderTask(body.spec ?? defaultVideoSpec, engine);
    const startedTask = await updateRenderTask(task.id, {
      status: "rendering",
      progress: {
        percent: 1,
        renderedFrames: 0,
        encodedFrames: 0,
        stage: "bundling",
        message: "任务已创建，正在启动 Vercel Sandbox",
      },
    });

    after(
      renderRenkumiVideoOnVercel(task.id).catch((error: unknown) => {
        void failRenderTask(task.id, error instanceof Error ? error.message : String(error));
        console.error(error);
      }),
    );

    return NextResponse.json({
      id: startedTask.id,
      engine: startedTask.engine,
      status: startedTask.status,
      progress: startedTask.progress,
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
