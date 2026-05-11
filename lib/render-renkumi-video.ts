import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import {
  getRenderOutputPath,
  getRenderOutputUrl,
  isHostedRenderRuntime,
  readRenderTask,
  updateRenderTask,
} from "./render-store";

const compositionId = "RenkumiVideo";
const entryPoint = path.join(process.cwd(), "remotion", "index.ts");
let bundledServeUrlPromise: Promise<string> | undefined;
let remotionRuntimeCwdLock = Promise.resolve();

const getRemotionBrowserCacheDir = () => {
  const configuredDir = process.env.REMOTION_BROWSER_CACHE_DIR?.trim();
  if (configuredDir) {
    return path.isAbsolute(configuredDir) ? configuredDir : path.join(process.cwd(), configuredDir);
  }

  return isHostedRenderRuntime() ? path.join(os.tmpdir(), "renkumi", "remotion-browser") : null;
};

const ensureRemotionRuntimeCwd = async () => {
  const runtimeCwd = getRemotionBrowserCacheDir();
  if (!runtimeCwd) {
    return null;
  }

  await fs.mkdir(path.join(runtimeCwd, "node_modules"), { recursive: true });
  await fs.writeFile(
    path.join(runtimeCwd, "package.json"),
    JSON.stringify({ name: "renkumi-remotion-runtime", private: true }, null, 2),
  );

  return runtimeCwd;
};

const withRemotionRuntimeCwd = async <Value>(operation: () => Promise<Value>) => {
  if (!isHostedRenderRuntime()) {
    return operation();
  }

  let releaseLock: () => void = () => undefined;
  const previousLock = remotionRuntimeCwdLock;
  remotionRuntimeCwdLock = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  await previousLock;
  let previousCwd: string | null = null;

  try {
    const runtimeCwd = await ensureRemotionRuntimeCwd();
    if (!runtimeCwd) {
      return await operation();
    }

    previousCwd = process.cwd();
    process.chdir(runtimeCwd);
    return await operation();
  } finally {
    if (previousCwd) {
      process.chdir(previousCwd);
    }
    releaseLock();
  }
};

const getBundledServeUrl = () => {
  bundledServeUrlPromise ??= bundle({
    enableCaching: !isHostedRenderRuntime(),
    entryPoint,
    webpackOverride: (config) => config,
  }).catch((error) => {
    bundledServeUrlPromise = undefined;
    throw error;
  });

  return bundledServeUrlPromise;
};

const getRenderStage = (progress: Parameters<NonNullable<Parameters<typeof renderMedia>[0]["onProgress"]>>[0]) => {
  if (progress.progress >= 1) {
    return "done";
  }

  if (progress.stitchStage === "encoding" || progress.stitchStage === "muxing") {
    return progress.stitchStage;
  }

  return "rendering";
};

export async function renderRenkumiVideo(id: string) {
  const task = await readRenderTask(id);
  if (!task) {
    throw new Error(`Render task ${id} was not found`);
  }

  await updateRenderTask(id, {
    engine: "remotion",
    status: "rendering",
    error: undefined,
    progress: {
      percent: 2,
      renderedFrames: 0,
      encodedFrames: 0,
      stage: "bundling",
      message: "准备 Remotion 工程",
    },
  });

  try {
    const serveUrl = await getBundledServeUrl();
    const composition = await withRemotionRuntimeCwd(() =>
      selectComposition({
        serveUrl,
        id: compositionId,
        inputProps: { spec: task.spec },
      }),
    );
    const outputLocation = getRenderOutputPath(id);
    await fs.mkdir(path.dirname(outputLocation), { recursive: true });
    let lastProgressWrite = 0;
    type RenderMediaProgress = Parameters<NonNullable<Parameters<typeof renderMedia>[0]["onProgress"]>>[0];

    await withRemotionRuntimeCwd(() =>
      renderMedia({
        composition,
        serveUrl,
        codec: "h264",
        outputLocation,
        inputProps: { spec: task.spec },
        muted: true,
        enforceAudioTrack: false,
        onProgress: (progress: RenderMediaProgress) => {
          const now = Date.now();
          if (now - lastProgressWrite < 750 && progress.progress < 1) {
            return;
          }
          lastProgressWrite = now;
          void updateRenderTask(id, {
            progress: {
              percent: Math.max(3, Math.round(progress.progress * 100)),
              renderedFrames: progress.renderedFrames,
              encodedFrames: progress.encodedFrames,
              stage: getRenderStage(progress),
              message:
                progress.progress >= 1
                  ? "视频生成完成"
                  : progress.stitchStage === "encoding"
                    ? "正在编码视频"
                    : "正在合成视频",
            },
          }).catch(() => undefined);
        },
      }),
    );

    return updateRenderTask(id, {
      status: "succeeded",
      engine: "remotion",
      progress: {
        percent: 100,
        renderedFrames: composition.durationInFrames,
        encodedFrames: composition.durationInFrames,
        stage: "done",
        message: "视频生成完成",
      },
      outputPath: outputLocation,
      outputUrl: getRenderOutputUrl(id),
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
  }
}
