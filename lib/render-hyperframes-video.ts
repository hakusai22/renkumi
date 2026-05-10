import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  getHyperframesCompositionPath,
  getHyperframesCompositionUrl,
  getHyperframesPosterPath,
  getHyperframesPosterUrl,
  getRenderOutputPath,
  getRenderOutputUrl,
  readRenderTask,
  updateRenderTask,
} from "./render-store";
import { getAssetById, getTotalDurationInFrames, type SceneSpec, type VideoSpec } from "./video-spec";

type HyperframesProgressEvent = {
  frame?: number;
  message?: string;
  percent?: number;
  stage?: "capturing" | "encoding" | "done";
  totalFrames?: number;
};

type HyperframesSceneView = {
  animation: string;
  assetBehavior: string;
  duration: number;
  index: number;
  start: number;
};

const compositionId = "renkumi-hyperframes-video";

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const escapeCssString = (value: string) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

const escapeScript = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");

const toClassToken = (value?: string) => (value ?? "plain").replace(/[^a-z0-9_-]/gi, "-").toLowerCase();

const isHexColor = (value?: string) => Boolean(value && /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(value));

const colorOr = (value: string | undefined, fallback: string) => (isHexColor(value) ? value! : fallback);

const assetSrcToHtml = (src?: string) => {
  if (!src) {
    return undefined;
  }

  if (/^(data:|https?:|file:)/i.test(src)) {
    return src;
  }

  if (src.startsWith("/")) {
    return pathToFileURL(path.join(process.cwd(), "public", src.replace(/^\/+/, ""))).href;
  }

  return pathToFileURL(path.resolve(process.cwd(), src)).href;
};

const formatDuration = (seconds: number) => {
  const rounded = Math.max(1, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  const rest = rounded % 60;

  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
};

const getPalette = (spec: VideoSpec) => {
  const designColors = spec.creative?.design?.colors ?? [];

  return {
    accent: colorOr(designColors[2], colorOr(spec.brand.accentColor, "#0070f3")),
    background: colorOr(designColors[1], colorOr(spec.brand.backgroundColor, "#ffffff")),
    ink: colorOr(designColors[0], colorOr(spec.brand.textColor, "#171717")),
    line: "rgba(23, 23, 23, 0.12)",
    muted: colorOr(designColors[3], colorOr(spec.brand.secondaryColor, "#666666")),
    secondary: colorOr(designColors[4], colorOr(spec.brand.secondaryColor, "#ebebeb")),
  };
};

const getFontFamily = (spec: VideoSpec) => {
  const [preferredFont] = spec.creative?.design?.fonts ?? [];
  const normalized = preferredFont?.replace(/[";]/g, "").trim();

  return normalized
    ? `"${escapeCssString(normalized)}", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif`
    : `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif`;
};

const sceneDuration = (scene: SceneSpec) => Math.max(1, Number.isFinite(scene.durationInSeconds) ? scene.durationInSeconds : 6);

const buildSceneVisual = (spec: VideoSpec, scene: SceneSpec) => {
  const asset = getAssetById(spec, scene.assetId);
  const src = assetSrcToHtml(asset?.src);

  if (!src) {
    return `
      <div class="abstract-visual" aria-hidden="true">
        <span></span>
        <span></span>
        <span></span>
        <strong>${escapeHtml(scene.kind.toUpperCase())}</strong>
      </div>
    `;
  }

  return `
    <figure class="asset-frame asset-behavior-${toClassToken(scene.assetBehavior)}">
      <img data-scene-img src="${escapeHtml(src)}" alt="${escapeHtml(asset?.alt ?? scene.title)}" />
    </figure>
  `;
};

const buildScene = (spec: VideoSpec, scene: SceneSpec, index: number, start: number) => {
  const bullets = (scene.bullets?.length ? scene.bullets : [scene.subtitle]).slice(0, 3);
  const layout = toClassToken(scene.layout);
  const treatment = toClassToken(scene.visualTreatment);
  const emphasis = toClassToken(scene.emphasis);
  const duration = sceneDuration(scene);

  return `
    <section
      class="scene layout-${layout} treatment-${treatment} emphasis-${emphasis}"
      data-start="${start.toFixed(3)}"
      data-duration="${duration.toFixed(3)}"
      data-track-index="${index + 1}"
      data-scene
    >
      <div class="scene-band" aria-hidden="true"></div>
      <div class="scene-copy" data-scene-copy>
        <div class="kicker">Scene ${String(index + 1).padStart(2, "0")} / ${escapeHtml(scene.kind)}</div>
        <h1>${escapeHtml(scene.title)}</h1>
        <p class="subtitle">${escapeHtml(scene.subtitle)}</p>
        <div class="bullet-row">
          ${bullets.map((bullet) => `<span>${escapeHtml(bullet)}</span>`).join("")}
        </div>
      </div>
      <div class="scene-visual" data-scene-visual>
        ${buildSceneVisual(spec, scene)}
      </div>
    </section>
  `;
};

const buildHyperframesCompositionHtml = (spec: VideoSpec) => {
  const width = Math.max(320, Math.round(spec.output.width));
  const height = Math.max(320, Math.round(spec.output.height));
  const fps = Math.max(1, Math.round(spec.output.fps));
  const totalSeconds = Math.max(1, getTotalDurationInFrames(spec) / fps);
  const palette = getPalette(spec);
  const isPortrait = height > width;
  let cursor = 0;
  const scenes: HyperframesSceneView[] = [];
  const sceneHtml = spec.scenes
    .map((scene, index) => {
      const start = cursor;
      const duration = sceneDuration(scene);
      cursor += duration;
      scenes.push({
        animation: scene.animation ?? "fade",
        assetBehavior: scene.assetBehavior ?? "contain",
        duration,
        index,
        start,
      });

      return buildScene(spec, scene, index, start);
    })
    .join("\n");

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(spec.brand.name)} HyperFrames Render</title>
    <style>
      :root {
        --ink: ${palette.ink};
        --paper: ${palette.background};
        --muted: ${palette.muted};
        --secondary: ${palette.secondary};
        --accent: ${palette.accent};
        --line: ${palette.line};
      }

      * {
        box-sizing: border-box;
      }

      html,
      body {
        width: 100%;
        height: 100%;
        margin: 0;
        overflow: hidden;
        background: var(--paper);
        color: var(--ink);
        font-family: ${getFontFamily(spec)};
      }

      [data-composition-id="${compositionId}"] {
        position: relative;
        width: ${width}px;
        height: ${height}px;
        overflow: hidden;
        background:
          linear-gradient(135deg, color-mix(in srgb, var(--secondary) 28%, transparent), transparent 34%),
          linear-gradient(315deg, color-mix(in srgb, var(--accent) 14%, transparent), transparent 36%),
          var(--paper);
      }

      .composition-grid {
        position: absolute;
        inset: 0;
        opacity: 0.42;
        background-image:
          linear-gradient(var(--line) 1px, transparent 1px),
          linear-gradient(90deg, var(--line) 1px, transparent 1px);
        background-size: 56px 56px;
      }

      .brand-strip,
      .timecode {
        position: absolute;
        z-index: 8;
        display: inline-flex;
        align-items: center;
        height: 44px;
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 0 16px;
        background: color-mix(in srgb, var(--paper) 88%, white);
        color: var(--ink);
        font-size: 18px;
        font-weight: 760;
      }

      .brand-strip {
        top: 36px;
        left: 48px;
        gap: 10px;
      }

      .brand-strip span {
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        border-radius: 6px;
        background: var(--ink);
        color: var(--paper);
        font-size: 12px;
      }

      .timecode {
        top: 36px;
        right: 48px;
        color: var(--muted);
        font-size: 15px;
        font-variant-numeric: tabular-nums;
      }

      .scene {
        position: absolute;
        inset: 0;
        display: grid;
        grid-template-columns: minmax(0, 0.92fr) minmax(0, 1.08fr);
        gap: 72px;
        align-items: center;
        width: 100%;
        height: 100%;
        padding: ${isPortrait ? "132px 72px 96px" : "116px 104px 92px"};
        opacity: 0;
        transform-origin: center;
        will-change: opacity, transform;
      }

      .scene-band {
        position: absolute;
        inset: auto -12% 10% -12%;
        height: 34%;
        background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent) 22%, transparent), transparent);
        transform: skewY(-7deg);
      }

      .scene-copy,
      .scene-visual {
        position: relative;
        z-index: 1;
        min-width: 0;
      }

      .scene-copy {
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 24px;
      }

      .kicker {
        display: inline-flex;
        width: max-content;
        max-width: 100%;
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 8px 12px;
        background: color-mix(in srgb, var(--paper) 84%, white);
        color: var(--accent);
        font-size: 16px;
        font-weight: 820;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      h1 {
        max-width: 11ch;
        margin: 0;
        font-size: ${isPortrait ? "86px" : "104px"};
        line-height: 0.98;
        letter-spacing: 0;
      }

      .subtitle {
        max-width: 760px;
        margin: 0;
        color: var(--muted);
        font-size: ${isPortrait ? "30px" : "34px"};
        font-weight: 520;
        line-height: 1.28;
        letter-spacing: 0;
      }

      .bullet-row {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
      }

      .bullet-row span {
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 12px 14px;
        background: color-mix(in srgb, var(--paper) 88%, white);
        color: var(--ink);
        font-size: 20px;
        font-weight: 720;
      }

      .scene-visual {
        min-height: ${isPortrait ? "620px" : "650px"};
      }

      .asset-frame,
      .abstract-visual {
        position: relative;
        width: 100%;
        height: 100%;
        min-height: inherit;
        overflow: hidden;
        border: 1px solid var(--line);
        border-radius: 8px;
        background:
          linear-gradient(145deg, color-mix(in srgb, var(--paper) 92%, white), color-mix(in srgb, var(--secondary) 22%, var(--paper))),
          var(--paper);
        box-shadow:
          0 1px 2px rgba(17, 24, 39, 0.05),
          0 28px 80px rgba(17, 24, 39, 0.12);
      }

      .asset-frame img {
        width: 100%;
        height: 100%;
        object-fit: contain;
        transform-origin: center;
        will-change: transform;
      }

      .asset-behavior-cover img,
      .asset-behavior-pan img,
      .asset-behavior-zoom img {
        object-fit: cover;
      }

      .abstract-visual {
        display: grid;
        place-items: center;
      }

      .abstract-visual span {
        position: absolute;
        width: 56%;
        height: 18%;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: color-mix(in srgb, var(--accent) 18%, var(--paper));
      }

      .abstract-visual span:nth-child(1) {
        transform: translate(-18%, -110%) rotate(-8deg);
      }

      .abstract-visual span:nth-child(2) {
        transform: translate(12%, 8%) rotate(5deg);
        background: color-mix(in srgb, var(--secondary) 28%, var(--paper));
      }

      .abstract-visual span:nth-child(3) {
        transform: translate(-4%, 126%) rotate(-2deg);
      }

      .abstract-visual strong {
        position: relative;
        z-index: 1;
        color: var(--ink);
        font-size: 72px;
        letter-spacing: 0;
      }

      .layout-hero,
      .layout-cta,
      .emphasis-headline {
        grid-template-columns: 1fr;
        text-align: center;
      }

      .layout-hero .scene-copy,
      .layout-cta .scene-copy,
      .emphasis-headline .scene-copy {
        align-items: center;
      }

      .layout-hero h1,
      .layout-cta h1,
      .emphasis-headline h1 {
        max-width: 14ch;
        font-size: ${isPortrait ? "96px" : "128px"};
      }

      .layout-hero .scene-visual,
      .layout-cta .scene-visual,
      .emphasis-headline .scene-visual {
        display: none;
      }

      .layout-cards .bullet-row,
      .layout-metrics .bullet-row {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        width: min(100%, 860px);
      }

      .layout-cards .bullet-row span,
      .layout-metrics .bullet-row span {
        min-height: 112px;
        align-content: center;
        font-size: 28px;
      }

      .layout-quote .subtitle {
        color: var(--ink);
        font-size: ${isPortrait ? "42px" : "54px"};
        line-height: 1.12;
      }

      .composition-progress {
        position: absolute;
        left: 48px;
        right: 48px;
        bottom: 36px;
        z-index: 8;
        height: 10px;
        overflow: hidden;
        border-radius: 8px;
        background: color-mix(in srgb, var(--ink) 10%, transparent);
      }

      .composition-progress span {
        display: block;
        width: 0%;
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, var(--accent), var(--ink));
      }

      @media (orientation: portrait) {
        .scene {
          grid-template-columns: 1fr;
          grid-template-rows: auto minmax(0, 1fr);
        }
      }
    </style>
  </head>
  <body>
    <div
      data-composition-id="${compositionId}"
      data-width="${width}"
      data-height="${height}"
      data-start="0"
      data-duration="${totalSeconds.toFixed(3)}"
      data-track-index="0"
    >
      <div class="composition-grid" aria-hidden="true"></div>
      <div class="brand-strip"><span>${escapeHtml(spec.brand.logoText.slice(0, 2) || "R")}</span>${escapeHtml(spec.brand.name)}</div>
      <div class="timecode" data-timecode>00:00 / ${formatDuration(totalSeconds)}</div>
      ${sceneHtml}
      <div class="composition-progress" aria-hidden="true"><span data-progress-fill></span></div>
    </div>

    <script>
      (function () {
        const duration = ${Number(totalSeconds.toFixed(3))};
        const scenes = ${escapeScript(scenes)};
        const sceneEls = Array.from(document.querySelectorAll("[data-scene]"));
        const timecode = document.querySelector("[data-timecode]");
        const progressFill = document.querySelector("[data-progress-fill]");
        const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
        const seg = (time, start, end) => end <= start ? (time >= end ? 1 : 0) : clamp((time - start) / (end - start), 0, 1);
        const easeOut = (x) => 1 - Math.pow(1 - clamp(x, 0, 1), 3);
        const easeIn = (x) => Math.pow(clamp(x, 0, 1), 3);
        const formatClock = (value) => {
          const rounded = Math.max(0, Math.floor(value));
          const minutes = Math.floor(rounded / 60);
          const seconds = rounded % 60;
          return String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
        };

        function sceneTransform(data, local, alpha) {
          const intro = 1 - alpha;
          const drift = Math.sin(local * 1.8);

          if (data.animation === "slide") {
            return "translate3d(" + intro * 90 + "px,0,0) scale(" + (0.99 + alpha * 0.01) + ")";
          }

          if (data.animation === "zoom" || data.animation === "spotlight") {
            return "translate3d(0," + intro * 18 + "px,0) scale(" + (0.94 + alpha * 0.06) + ")";
          }

          if (data.animation === "parallax") {
            return "translate3d(" + (intro * -64 + drift * 7) + "px,0,0) scale(1)";
          }

          if (data.animation === "stack") {
            return "translate3d(0," + intro * 62 + "px,0) rotate(" + intro * -2 + "deg) scale(" + (0.97 + alpha * 0.03) + ")";
          }

          return "translate3d(0," + intro * 28 + "px,0) scale(1)";
        }

        function renderAt(time) {
          const t = clamp(Number(time) || 0, 0, duration);
          timecode.textContent = formatClock(t) + " / ${formatDuration(totalSeconds)}";
          progressFill.style.width = (duration ? (t / duration) * 100 : 0) + "%";

          sceneEls.forEach((scene, index) => {
            const data = scenes[index];
            const local = t - data.start;
            const end = data.start + data.duration;
            const isLast = index === sceneEls.length - 1;
            const active = t >= data.start && (t < end || (isLast && t >= data.start));
            const inWindow = Math.min(0.72, data.duration * 0.22);
            const outStart = Math.max(inWindow, data.duration - Math.min(0.55, data.duration * 0.16));
            const entrance = easeOut(seg(local, 0, inWindow));
            const exit = easeIn(seg(local, outStart, data.duration));
            const alpha = active ? Math.max(0, Math.min(entrance, 1 - exit)) : 0;
            const copy = scene.querySelector("[data-scene-copy]");
            const visual = scene.querySelector("[data-scene-visual]");
            const img = scene.querySelector("[data-scene-img]");

            scene.style.opacity = String(alpha);
            scene.style.zIndex = active ? "2" : "1";
            scene.style.transform = sceneTransform(data, Math.max(0, local), alpha);

            if (copy) {
              copy.style.opacity = String(alpha);
              copy.style.transform = "translate3d(0," + (1 - alpha) * 28 + "px,0)";
            }

            if (visual) {
              visual.style.opacity = String(alpha);
              visual.style.transform = "translate3d(0," + (1 - alpha) * -22 + "px,0) scale(" + (0.98 + alpha * 0.02) + ")";
            }

            if (img) {
              const progress = clamp(local / data.duration, 0, 1);
              if (data.assetBehavior === "pan") {
                img.style.transform = "translate3d(" + (-2 + progress * 4) + "%,0,0) scale(1.06)";
              } else if (data.assetBehavior === "zoom") {
                img.style.transform = "scale(" + (1.02 + progress * 0.07) + ")";
              } else {
                img.style.transform = "scale(1)";
              }
            }
          });
        }

        window.__timelines = window.__timelines || {};
        window.__timelines["${compositionId}"] = { duration: duration, seek: renderAt };
        window.__renkumiRenderAt = renderAt;
        renderAt(Number(new URLSearchParams(window.location.search).get("t") || 0));
      })();
    </script>
  </body>
</html>
`;
};

const runHyperframesCapture = (
  args: string[],
  onProgress: (event: HyperframesProgressEvent) => void,
) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn("python3", args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdoutBuffer = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }

        try {
          onProgress(JSON.parse(line) as HyperframesProgressEvent);
        } catch {
          // Ignore non-JSON tool output.
        }
      }
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `HyperFrames renderer exited with code ${code}`));
    });
  });

export async function renderRenkumiHyperframesVideo(id: string) {
  const task = await readRenderTask(id);
  if (!task) {
    throw new Error(`Render task ${id} was not found`);
  }

  const fps = Math.max(1, Math.round(task.spec.output.fps));
  const totalFrames = getTotalDurationInFrames(task.spec);
  const totalSeconds = Math.max(1, totalFrames / fps);
  const compositionPath = getHyperframesCompositionPath(id);
  const posterPath = getHyperframesPosterPath(id);
  const outputLocation = getRenderOutputPath(id, "hyperframes");

  await updateRenderTask(id, {
    engine: "hyperframes",
    status: "rendering",
    error: undefined,
    compositionPath,
    compositionUrl: getHyperframesCompositionUrl(id),
    posterPath,
    posterUrl: getHyperframesPosterUrl(id),
    progress: {
      percent: 2,
      renderedFrames: 0,
      encodedFrames: 0,
      stage: "bundling",
      message: "准备 HyperFrames HTML composition",
    },
  });

  try {
    await fs.mkdir(path.dirname(compositionPath), { recursive: true });
    await fs.writeFile(compositionPath, buildHyperframesCompositionHtml(task.spec), "utf8");

    await updateRenderTask(id, {
      progress: {
        percent: 6,
        renderedFrames: 0,
        encodedFrames: 0,
        stage: "rendering",
        message: "HyperFrames 正在捕获帧",
      },
    });

    await runHyperframesCapture(
      [
        "scripts/render-hyperframes-storyboard.py",
        "--source",
        compositionPath,
        "--output",
        outputLocation,
        "--poster",
        posterPath,
        "--width",
        String(Math.max(320, Math.round(task.spec.output.width))),
        "--height",
        String(Math.max(320, Math.round(task.spec.output.height))),
        "--fps",
        String(fps),
        "--duration",
        String(totalSeconds),
        "--progress-json",
      ],
      (event) => {
        if (event.stage === "capturing") {
          void updateRenderTask(id, {
            progress: {
              percent: Math.max(6, Math.min(88, Math.round(event.percent ?? 6))),
              renderedFrames: event.frame ?? 0,
              encodedFrames: 0,
              stage: "rendering",
              message: `HyperFrames 正在捕获帧 ${event.frame ?? 0}/${event.totalFrames ?? totalFrames}`,
            },
          }).catch(() => undefined);
          return;
        }

        if (event.stage === "encoding") {
          void updateRenderTask(id, {
            progress: {
              percent: Math.max(88, Math.min(96, Math.round(event.percent ?? 92))),
              renderedFrames: totalFrames,
              encodedFrames: 0,
              stage: "encoding",
              message: "HyperFrames 正在编码视频",
            },
          }).catch(() => undefined);
        }
      },
    );

    return updateRenderTask(id, {
      status: "succeeded",
      outputPath: outputLocation,
      outputUrl: getRenderOutputUrl(id, "hyperframes"),
      compositionPath,
      compositionUrl: getHyperframesCompositionUrl(id),
      posterPath,
      posterUrl: getHyperframesPosterUrl(id),
      progress: {
        percent: 100,
        renderedFrames: totalFrames,
        encodedFrames: totalFrames,
        stage: "done",
        message: "HyperFrames 视频生成完成",
      },
    });
  } catch (error) {
    await updateRenderTask(id, {
      status: "failed",
      progress: {
        percent: 0,
        renderedFrames: 0,
        encodedFrames: 0,
        stage: "queued",
        message: "HyperFrames 生成失败",
      },
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
