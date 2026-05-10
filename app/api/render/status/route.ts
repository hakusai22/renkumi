import { NextResponse } from "next/server";
import { readRenderTask } from "@/lib/render-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Missing render id." }, { status: 400, headers: noStoreHeaders });
  }

  const task = await readRenderTask(id);

  if (!task) {
    return NextResponse.json({ error: "Render task not found." }, { status: 404, headers: noStoreHeaders });
  }

  return NextResponse.json(task, { headers: noStoreHeaders });
}
