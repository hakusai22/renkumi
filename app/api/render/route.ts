import { spawn } from "node:child_process";
import { NextResponse } from "next/server";
import { createRenderTask, defaultRenderEngine, type RenderEngine } from "@/lib/render-store";
import { defaultVideoSpec, type VideoSpec } from "@/lib/video-spec";

export const runtime = "nodejs";

type RenderBody = {
  engine?: RenderEngine;
  spec?: VideoSpec;
};

const parseRenderEngine = (value: unknown): RenderEngine =>
  value === "hyperframes" || value === "remotion" ? value : defaultRenderEngine;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as RenderBody;
  const task = await createRenderTask(body.spec ?? defaultVideoSpec, parseRenderEngine(body.engine));
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const child = spawn(pnpm, ["exec", "tsx", "scripts/render-worker.ts", task.id], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
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
