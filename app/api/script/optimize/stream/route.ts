import { NextResponse } from "next/server";
import { generateCreativeVideoPlanStream } from "@/lib/ai-script";
import { defaultVideoSpec, type VideoSpec } from "@/lib/video-spec";

export const runtime = "nodejs";

type OptimizeScriptBody = {
  brief?: string;
  spec?: VideoSpec;
};

type StreamEvent = "status" | "token" | "result" | "error";

const encoder = new TextEncoder();

const encodeEvent = (event: StreamEvent, data: unknown) =>
  encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as OptimizeScriptBody;
  const brief = body.brief?.trim();

  if (!brief) {
    return NextResponse.json({ error: "Missing video brief." }, { status: 400 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StreamEvent, data: unknown) => controller.enqueue(encodeEvent(event, data));

      try {
        send("status", { message: "正在连接文本模型..." });

        const result = await generateCreativeVideoPlanStream({
          brief,
          spec: body.spec ?? defaultVideoSpec,
          onStatus: (message) => send("status", { message }),
          onToken: (token) => send("token", { token }),
        });

        send("result", result);
      } catch (error) {
        send("error", {
          error: error instanceof Error ? error.message : "AI video plan generation failed.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
    },
  });
}
