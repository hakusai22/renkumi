import { NextResponse } from "next/server";
import { generateCreativeVideoPlan } from "@/lib/ai-script";
import { defaultVideoSpec, type VideoSpec } from "@/lib/video-spec";

export const runtime = "nodejs";

type OptimizeScriptBody = {
  brief?: string;
  spec?: VideoSpec;
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as OptimizeScriptBody;
  const brief = body.brief?.trim();

  if (!brief) {
    return NextResponse.json({ error: "Missing video brief." }, { status: 400 });
  }

  try {
    const result = await generateCreativeVideoPlan({
      brief,
      spec: body.spec ?? defaultVideoSpec,
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Script optimization failed.",
      },
      { status: 500 },
    );
  }
}
