import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import {
  getRenderOutputPath,
  getRenderOutputUrl,
  readRenderTask,
  updateRenderTask,
} from "./render-store";

export async function renderLaunchCutVideo(id: string) {
  const task = await readRenderTask(id);
  if (!task) {
    throw new Error(`Render task ${id} was not found`);
  }

  await updateRenderTask(id, {
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
    const entryPoint = path.join(process.cwd(), "remotion", "index.ts");
    const serveUrl = await bundle({
      entryPoint,
      webpackOverride: (config) => config,
    });
    const composition = await selectComposition({
      serveUrl,
      id: "LaunchCutVideo",
      inputProps: { spec: task.spec },
    });
    const outputLocation = getRenderOutputPath(id);
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
            stage: progress.progress >= 1 ? "done" : progress.stitchStage,
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
