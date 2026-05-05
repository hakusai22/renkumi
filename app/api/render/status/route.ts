import { NextResponse } from "next/server";
import { readRenderTask } from "@/lib/render-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Missing render id." }, { status: 400 });
  }

  const task = await readRenderTask(id);

  if (!task) {
    return NextResponse.json({ error: "Render task not found." }, { status: 404 });
  }

  return NextResponse.json(task);
}
