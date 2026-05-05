import { promises as fs } from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type GenerateImageBody = {
  prompt?: string;
  model?: string;
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as GenerateImageBody;
  const prompt = body.prompt?.trim();

  if (!prompt) {
    return NextResponse.json({ error: "Missing image prompt." }, { status: 400 });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      {
        skipped: true,
        reason: "OPENAI_API_KEY is not configured.",
        message: "GPT Image is optional. The video can continue using local placeholder or product screenshot assets.",
      },
      { status: 200 },
    );
  }

  const model = body.model ?? process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1.5";
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const response = await client.images.generate({
      model,
      prompt,
      size: "1536x1024",
      quality: "auto",
      output_format: "png",
      n: 1,
    } as Parameters<typeof client.images.generate>[0]);
    const image = (response as { data?: Array<{ b64_json?: string; revised_prompt?: string }> }).data?.[0];
    const base64 = image?.b64_json;

    if (!base64) {
      return NextResponse.json({ error: "OpenAI did not return image data." }, { status: 502 });
    }

    const id = `gpt-${Date.now()}`;
    const filename = `${id}.png`;
    const outputDir = path.join(process.cwd(), "public", "assets", "generated");
    const outputPath = path.join(outputDir, filename);

    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(outputPath, Buffer.from(base64, "base64"));

    return NextResponse.json({
      asset: {
        id,
        src: `/assets/generated/${filename}`,
        model,
      },
      revisedPrompt: image?.revised_prompt,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Image generation failed.",
      },
      { status: 500 },
    );
  }
}
