import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);

const extensionForType: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing screenshot file." }, { status: 400 });
  }

  if (!allowedTypes.has(file.type)) {
    return NextResponse.json({ error: "Only PNG, JPG, WebP, or SVG screenshots are supported." }, { status: 400 });
  }

  const maxSize = 12 * 1024 * 1024;
  if (file.size > maxSize) {
    return NextResponse.json({ error: "Screenshot must be smaller than 12MB." }, { status: 400 });
  }

  const id = `shot-${Date.now()}`;
  const extension = extensionForType[file.type] ?? "png";
  const filename = `${id}.${extension}`;
  const outputDir = path.join(process.cwd(), "public", "assets", "uploads");
  const outputPath = path.join(outputDir, filename);
  const bytes = Buffer.from(await file.arrayBuffer());

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(outputPath, bytes);

  return NextResponse.json({
    asset: {
      id,
      type: "screenshot",
      src: `/assets/uploads/${filename}`,
      alt: file.name || "Uploaded product screenshot",
      mimeType: file.type,
      size: file.size,
      originalName: file.name || filename,
    },
  });
}
