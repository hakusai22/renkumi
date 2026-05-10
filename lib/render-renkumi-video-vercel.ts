import { promises as fs } from "node:fs";
import path from "node:path";
import { readRenderTask, updateRenderTask } from "./render-store";

const compositionId = "RenkumiVideo";
const defaultSandboxVcpus = 4;

type VercelModule = typeof import("@remotion/vercel");
type VercelSandbox = Awaited<ReturnType<VercelModule["createSandbox"]>>;
type RenderMediaOnVercelProgress = import("@remotion/vercel").RenderMediaOnVercelProgress;

const getSandboxVcpus = () => {
  const raw = Number(process.env.REMOTION_VERCEL_SANDBOX_VCPUS);
  return Number.isFinite(raw) && raw > 0 ? Math.min(8, Math.round(raw)) : defaultSandboxVcpus;
};

const getBundleDir = async () => {
  const bundleDir = process.env.REMOTION_VERCEL_BUNDLE_DIR
    ? path.resolve(process.env.REMOTION_VERCEL_BUNDLE_DIR)
    : path.join(process.cwd(), ".remotion");

  try {
    await fs.access(bundleDir);
    return bundleDir;
  } catch {
    throw new Error(
      `Remotion bundle not found at ${bundleDir}. Run "pnpm remotion:bundle" before deploying, or set REMOTION_VERCEL_BUNDLE_DIR to an included bundle directory.`,
    );
  }
};

const getRenderStage = (progress: RenderMediaOnVercelProgress) => {
  if (progress.stage !== "render-progress") {
    return "rendering" as const;
  }

  if (progress.progress.progress >= 1) {
    return "done" as const;
  }

  if (progress.progress.stitchStage === "encoding" || progress.progress.stitchStage === "muxing") {
    return progress.progress.stitchStage;
  }

  return "rendering" as const;
};

const getRenderMessage = (progress: RenderMediaOnVercelProgress) => {
  if (progress.stage === "opening-browser") {
    return "正在启动 Vercel Sandbox 浏览器";
  }

  if (progress.stage === "selecting-composition") {
    return "正在读取 Remotion 合成";
  }

  if (progress.progress.stitchStage === "encoding") {
    return "正在编码视频";
  }

  if (progress.progress.stitchStage === "muxing") {
    return "正在封装视频";
  }

  return progress.progress.progress >= 1 ? "视频生成完成" : "正在合成视频";
};

const createRenderSandbox = async (id: string) => {
  const snapshotId = process.env.REMOTION_VERCEL_SNAPSHOT_ID?.trim();
  const resources = { vcpus: getSandboxVcpus() };

  if (snapshotId) {
    const { Sandbox } = await import("@vercel/sandbox");
    return Sandbox.create({
      source: {
        type: "snapshot",
        snapshotId,
      },
      resources,
    }) as Promise<VercelSandbox>;
  }

  const { addBundleToSandbox, createSandbox } = await import("@remotion/vercel");
  const sandbox = await createSandbox({
    resources,
    onProgress: async ({ progress, message }) => {
      await updateRenderTask(id, {
        progress: {
          percent: Math.max(2, Math.round(progress * 8)),
          renderedFrames: 0,
          encodedFrames: 0,
          stage: "bundling",
          message,
        },
      }).catch(() => undefined);
    },
  });
  const bundleDir = await getBundleDir();
  await addBundleToSandbox({ sandbox, bundleDir });
  return sandbox;
};

export async function renderRenkumiVideoOnVercel(id: string) {
  const task = await readRenderTask(id);
  if (!task) {
    throw new Error(`Render task ${id} was not found`);
  }

  await updateRenderTask(id, {
    engine: "remotion",
    status: "rendering",
    error: undefined,
    progress: {
      percent: 1,
      renderedFrames: 0,
      encodedFrames: 0,
      stage: "bundling",
      message: "准备 Vercel Sandbox 渲染环境",
    },
  });

  let sandbox: VercelSandbox | undefined;
  let lastRenderedFrames = 0;
  let lastEncodedFrames = 0;

  try {
    sandbox = await createRenderSandbox(id);
    const { renderMediaOnVercel, uploadToVercelBlob } = await import("@remotion/vercel");
    let lastProgressWrite = 0;

    const { sandboxFilePath, contentType } = await renderMediaOnVercel({
      sandbox,
      compositionId,
      inputProps: { spec: task.spec },
      codec: "h264",
      muted: true,
      enforceAudioTrack: false,
      outputFile: "/tmp/renkumi-video.mp4",
      onProgress: (progress) => {
        const now = Date.now();
        if (now - lastProgressWrite < 1000 && progress.overallProgress < 1) {
          return;
        }

        lastProgressWrite = now;

        if (progress.stage === "render-progress") {
          lastRenderedFrames = progress.progress.renderedFrames;
          lastEncodedFrames = progress.progress.encodedFrames;
        }

        void updateRenderTask(id, {
          progress: {
            percent: Math.max(8, Math.min(95, Math.round(progress.overallProgress * 95))),
            renderedFrames: lastRenderedFrames,
            encodedFrames: lastEncodedFrames,
            stage: getRenderStage(progress),
            message: getRenderMessage(progress),
          },
        }).catch(() => undefined);
      },
    });

    await updateRenderTask(id, {
      progress: {
        percent: 96,
        renderedFrames: lastRenderedFrames,
        encodedFrames: lastEncodedFrames,
        stage: "muxing",
        message: "正在上传视频到 Vercel Blob",
      },
    });

    const { url } = await uploadToVercelBlob({
      sandbox,
      sandboxFilePath,
      contentType,
      blobPath: `renders/${id}/renkumi-video.mp4`,
      blobToken: process.env.BLOB_READ_WRITE_TOKEN!,
      access: "public",
    });

    return updateRenderTask(id, {
      status: "succeeded",
      engine: "remotion",
      progress: {
        percent: 100,
        renderedFrames: lastRenderedFrames,
        encodedFrames: lastEncodedFrames,
        stage: "done",
        message: "视频生成完成",
      },
      outputUrl: url,
    });
  } catch (error) {
    await updateRenderTask(id, {
      status: "failed",
      progress: {
        percent: 0,
        renderedFrames: 0,
        encodedFrames: 0,
        stage: "queued",
        message: "生成失败",
      },
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    await sandbox?.stop().catch(() => undefined);
  }
}
