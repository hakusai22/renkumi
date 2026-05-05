import { NextResponse } from "next/server";
import { readLatestRenderTask } from "@/lib/render-store";

export const runtime = "nodejs";

export async function GET() {
  const task = await readLatestRenderTask();

  if (!task) {
    return NextResponse.json({ error: "No render tasks found." }, { status: 404 });
  }

  return NextResponse.json(task);
}
