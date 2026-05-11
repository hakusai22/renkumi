import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import {
  getRenderOutputPath,
  getRenderOutputUrl,
  isHostedRenderRuntime,
  readRenderTask,
  updateRenderTask,
} from "./render-store";

const compositionId = "RenkumiVideo";
const entryPoint = path.join(process.cwd(), "remotion", "index.ts");
const nodeRequire = createRequire(import.meta.url);
let bundledServeUrlPromise: Promise<string> | undefined;

const getRuntimeRequire = (): NodeJS.Require => {
  try {
    return Function("return require")() as NodeJS.Require;
  } catch {
    return nodeRequire;
  }
};

const getRemotionBrowserCacheDir = () => {
  const configuredDir = process.env.REMOTION_BROWSER_CACHE_DIR?.trim();
  if (configuredDir) {
    return path.isAbsolute(configuredDir) ? configuredDir : path.join(process.cwd(), configuredDir);
  }

  return isHostedRenderRuntime() ? path.join(os.tmpdir(), "renkumi", "remotion-browser") : null;
};

const getRemotionRendererPackageDirFromPath = (filePath: string) => {
  const marker = `${path.sep}node_modules${path.sep}@remotion${path.sep}renderer${path.sep}`;
  const markerIndex = filePath.lastIndexOf(marker);
  if (markerIndex === -1) {
    return null;
  }

  return filePath.slice(0, markerIndex + marker.length - 1);
};

const getRemotionRendererPackageDir = (runtimeRequire: NodeJS.Require) => {
  const resolvedEntry = runtimeRequire.resolve("@remotion/renderer");
  const packageDirFromEntry = getRemotionRendererPackageDirFromPath(resolvedEntry);
  if (packageDirFromEntry) {
    return packageDirFromEntry;
  }

  for (const cachedModule of Object.values(runtimeRequire.cache)) {
    const filename = cachedModule?.filename;
    if (!filename) {
      continue;
    }

    const packageDirFromCache = getRemotionRendererPackageDirFromPath(filename);
    if (packageDirFromCache) {
      return packageDirFromCache;
    }
  }

  throw new Error(`Cannot locate @remotion/renderer package directory from ${resolvedEntry}`);
};

const patchRemotionBrowserCacheDir = () => {
  const cacheDir = getRemotionBrowserCacheDir();
  if (!cacheDir) {
    return;
  }

  try {
    const runtimeRequire = getRuntimeRequire();
    const packageDir = getRemotionRendererPackageDir(runtimeRequire);
    const modulePath = path.join(packageDir, "dist", "browser", "get-download-destination.js");
    const downloadDestination = runtimeRequire(modulePath) as { getDownloadsCacheDir: () => string };
    downloadDestination.getDownloadsCacheDir = () => cacheDir;
  } catch (error) {
    throw new Error(
      `Failed to configure Remotion browser cache directory at ${cacheDir}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
};

const { renderMedia, selectComposition } = nodeRequire("@remotion/renderer") as typeof import("@remotion/renderer");

patchRemotionBrowserCacheDir();

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
    const composition = await selectComposition({
      serveUrl,
      id: compositionId,
      inputProps: { spec: task.spec },
    });
    const outputLocation = getRenderOutputPath(id);
    await fs.mkdir(path.dirname(outputLocation), { recursive: true });
    let lastProgressWrite = 0;
    type RenderMediaProgress = Parameters<NonNullable<Parameters<typeof renderMedia>[0]["onProgress"]>>[0];

    await renderMedia({
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
    });

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
