"use client";

import Image from "next/image";
import Link from "next/link";
import { Player } from "@remotion/player";
import { useMemo, useState } from "react";
import { LaunchCutVideo } from "@/remotion/LaunchCutVideo";
import {
  defaultVideoSpec,
  getTotalDurationInFrames,
  type AssetSpec,
  type VideoSpec,
} from "@/lib/video-spec";
import {
  buildSpecFromBrief,
  buildSpecFromGeneratedPlan,
  type GeneratedVideoPlan,
} from "@/lib/video-script";

type VideoConsoleProps = {
  initialSpec: VideoSpec;
};

type RenderProgress = {
  percent: number;
  renderedFrames: number;
  encodedFrames: number;
  stage: string;
  message: string;
};

type RenderSnapshot = {
  id: string;
  status: string;
  statusUrl?: string;
  pageUrl?: string;
  outputUrl?: string;
  error?: string;
  progress: RenderProgress;
};

type ScriptStreamPayload = {
  message?: string;
  token?: string;
  error?: string;
  skipped?: boolean;
  provider?: string;
  model?: string;
  plan?: GeneratedVideoPlan;
};

export function VideoConsole({ initialSpec }: VideoConsoleProps) {
  const [brief, setBrief] = useState("");
  const [generatedPlan, setGeneratedPlan] = useState<GeneratedVideoPlan | null>(null);
  const [assets, setAssets] = useState<AssetSpec[]>([]);
  const [imagePrompt, setImagePrompt] = useState(
    "基于我上传的产品截图，扩展周围留白与背景，保持真实 UI 不变，增加干净的发布页宣传质感。",
  );
  const [scriptStatus, setScriptStatus] = useState<string>("");
  const [scriptStreamPreview, setScriptStreamPreview] = useState<string>("");
  const [isOptimizingScript, setIsOptimizingScript] = useState(false);
  const [imageStatus, setImageStatus] = useState<string>("");
  const [uploadStatus, setUploadStatus] = useState<string>("");
  const [renderStatus, setRenderStatus] = useState<string>("");
  const [latestRender, setLatestRender] = useState<RenderSnapshot | null>(null);
  const spec = useMemo(() => {
    const baseSpec = initialSpec ?? defaultVideoSpec;

    if (generatedPlan) {
      return buildSpecFromGeneratedPlan(generatedPlan, assets, baseSpec);
    }

    return buildSpecFromBrief(brief, assets, baseSpec);
  }, [assets, brief, generatedPlan, initialSpec]);
  const durationInFrames = useMemo(() => getTotalDurationInFrames(spec), [spec]);
  const totalSeconds = Math.round(durationInFrames / spec.output.fps);
  const progress = latestRender?.progress;
  const selectedDesign = spec.creative?.design;

  const updateBrief = (value: string) => {
    setBrief(value);
    setGeneratedPlan(null);
    setScriptStatus("");
    setScriptStreamPreview("");
  };

  const uploadScreenshots = async (fileList: FileList | null) => {
    const files = Array.from(fileList ?? []);
    if (files.length === 0) {
      return;
    }

    setUploadStatus(`上传 ${files.length} 张截图中...`);
    const uploaded: AssetSpec[] = [];

    for (const file of files) {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/assets/upload", {
        method: "POST",
        body: formData,
      });
      const payload = await response.json();

      if (!response.ok) {
        setUploadStatus(payload.error ?? `${file.name} 上传失败`);
        return;
      }

      uploaded.push(payload.asset);
    }

    setAssets((current) => [...uploaded, ...current]);
    setUploadStatus(`已添加 ${uploaded.length} 张截图`);
  };

  const optimizeScript = async () => {
    const input = brief.trim();

    if (!input) {
      setScriptStatus("请先输入一段产品说明或视频需求。");
      return;
    }

    setIsOptimizingScript(true);
    setScriptStreamPreview("");
    setScriptStatus("正在用 AI 生成 Remotion 视频方案...");

    try {
      const response = await fetch("/api/script/optimize/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief: input, spec }),
      });

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({}));
        setScriptStatus(payload.error ?? "AI 视频方案生成失败");
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let didReceiveResult = false;

      const handleStreamEvent = (block: string) => {
        const event = block.match(/^event:\s*(.+)$/m)?.[1]?.trim();
        const data = block
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");

        if (!event || !data) {
          return;
        }

        const payload = JSON.parse(data) as ScriptStreamPayload;

        if (event === "status") {
          setScriptStatus(payload.message ?? "正在生成视频方案...");
          return;
        }

        if (event === "token" && payload.token) {
          setScriptStatus("AI 正在输出镜头方案...");
          setScriptStreamPreview((current) => {
            const next = `${current}${payload.token}`.replace(/\s+/g, " ").trimStart();
            return next.length > 640 ? `...${next.slice(-640)}` : next;
          });
          return;
        }

        if (event === "result") {
          didReceiveResult = true;

          if (payload.skipped) {
            setScriptStatus(payload.message ?? "未配置可用文本模型，已继续使用本地动态方案。");
            return;
          }

          if (payload.plan) {
            setGeneratedPlan(payload.plan);
            setScriptStatus(`已使用 ${payload.provider} · ${payload.model} 生成 Remotion 视频方案`);
          }
          return;
        }

        if (event === "error") {
          didReceiveResult = true;
          setScriptStatus(payload.error ?? "AI 视频方案生成失败");
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";

        for (const block of blocks) {
          handleStreamEvent(block);
        }

        if (done) {
          break;
        }
      }

      if (buffer.trim()) {
        handleStreamEvent(buffer);
      }

      if (!didReceiveResult) {
        setScriptStatus("AI 响应结束，但没有返回可用视频方案。");
      }
    } catch (error) {
      setScriptStatus(error instanceof Error ? error.message : "AI 视频方案生成失败");
    } finally {
      setIsOptimizingScript(false);
    }
  };

  const pollRender = (id: string) => {
    window.setTimeout(async () => {
      const response = await fetch(`/api/render/status?id=${id}`);
      const task = (await response.json()) as RenderSnapshot;
      setLatestRender((current) => ({ ...current, ...task }));
      setRenderStatus(task.progress?.message ?? task.status);

      if (task.status === "queued" || task.status === "rendering") {
        pollRender(id);
      }
    }, 1000);
  };

  const submitRender = async () => {
    setRenderStatus("创建渲染任务...");
    setLatestRender(null);
    const response = await fetch("/api/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spec }),
    });
    const payload = await response.json();

    if (!response.ok) {
      setRenderStatus(payload.error ?? "渲染任务创建失败");
      return;
    }

    setLatestRender({
      ...payload,
      progress: {
        percent: 0,
        renderedFrames: 0,
        encodedFrames: 0,
        stage: "queued",
        message: "等待开始",
      },
    });
    setRenderStatus("任务已创建，正在生成视频...");
    pollRender(payload.id);
  };

  const generateImage = async () => {
    setImageStatus("检查图片增强能力...");
    const response = await fetch("/api/images/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: imagePrompt }),
    });
    const payload = await response.json();

    if (!response.ok) {
      setImageStatus(payload.error ?? "图片增强失败");
      return;
    }

    if (payload.skipped) {
      setImageStatus(payload.message ?? "未配置 OpenAI Key，当前继续使用上传截图。");
      return;
    }

    const generated: AssetSpec = {
      id: payload.asset.id,
      type: "generated",
      src: payload.asset.src,
      alt: "Generated LaunchCut campaign visual",
    };
    setAssets((current) => [generated, ...current]);
    setImageStatus(`已生成增强图 ${payload.asset.src}`);
  };

  return (
    <main className="app-shell">
      <header className="top-nav">
        <div className="brand-lockup">
          <div className={`brand-mark ${spec.brand.logoSrc ? "brand-mark-image" : ""}`} aria-hidden="true">
            {spec.brand.logoSrc ? (
              <Image src={spec.brand.logoSrc} alt="" width={34} height={34} unoptimized />
            ) : (
              spec.brand.logoText
            )}
          </div>
          <div>
            <div>{spec.brand.name}</div>
            <div className="muted" style={{ fontSize: 13, fontWeight: 650 }}>
              文字 + 多截图 → 视频
            </div>
          </div>
        </div>
        <div className="nav-actions">
          {latestRender?.pageUrl ? (
            <Link className="button secondary" href={latestRender.pageUrl}>
              查看任务
            </Link>
          ) : null}
          <button className="button" onClick={submitRender}>
            生成视频
          </button>
        </div>
      </header>

      <div className="page-wrap simple-page">
        <section className="simple-hero">
          <p className="eyebrow">LaunchCut video generator</p>
          <h1>输入文字，上传截图，生成宣传视频</h1>
          <p>主流程只需要一段说明和多张产品截图。图片模型只是可选增强，不影响视频生成。</p>
        </section>

        <section className="generator-panel">
          <div className="field">
            <label>视频文案 / 卖点 / 脚本</label>
            <textarea
              className="brief-input"
              value={brief}
              onChange={(event) => updateBrief(event.target.value)}
              placeholder="例如：LaunchCut 是一个把产品卖点、截图和品牌视觉自动合成为宣传视频的工具。适合官网发布页、社媒短视频和销售演示。核心能力：上传截图、输入文案、自动生成 Remotion 视频。"
            />
          </div>

          <label className="upload-box upload-box-large">
            <input
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              onChange={(event) => uploadScreenshots(event.target.files)}
            />
            <span>上传多张产品截图</span>
            <strong>PNG / JPG / WebP / SVG，上传后会自动进入视频镜头</strong>
          </label>

          <div className="generator-actions">
            <button className="button" onClick={submitRender}>
              生成视频
            </button>
            <button className="button secondary" onClick={optimizeScript} disabled={isOptimizingScript}>
              {isOptimizingScript ? "生成中..." : "AI 生成视频方案"}
            </button>
            <span>
              {assets.length} 张自定义截图 · {totalSeconds}s · 1080p
              {selectedDesign ? ` · ${selectedDesign.name} 风格` : ""}
            </span>
          </div>

          {scriptStatus ? (
            <div className="status-box">
              <div>{scriptStatus}</div>
              {scriptStreamPreview ? <pre className="stream-preview">{scriptStreamPreview}</pre> : null}
            </div>
          ) : null}
          {uploadStatus ? <div className="status-box">{uploadStatus}</div> : null}
        </section>

        <div className="simple-workspace">
          <section className="preview-column" id="preview">
            <div className="media-stage">
              <div className="player-aspect">
                <Player
                  component={LaunchCutVideo}
                  inputProps={{ spec }}
                  durationInFrames={durationInFrames}
                  fps={spec.output.fps}
                  compositionWidth={spec.output.width}
                  compositionHeight={spec.output.height}
                  style={{ width: "100%", height: "100%" }}
                  acknowledgeRemotionLicense
                  controls
                  loop
                />
              </div>
            </div>
          </section>

          <aside className="side-stack">
            <div className="progress-card">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Render</p>
                  <h2>生成进度</h2>
                </div>
                <span className="pill">{progress?.percent ?? 0}%</span>
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${progress?.percent ?? 0}%` }} />
              </div>
              <div className="progress-meta">
                <span>{renderStatus || "等待生成"}</span>
                <span>{progress ? `${progress.renderedFrames} rendered / ${progress.encodedFrames} encoded` : ""}</span>
              </div>
              {latestRender?.outputUrl ? (
                <a className="button" href={latestRender.outputUrl} download>
                  下载 MP4
                </a>
              ) : null}
              {latestRender?.error ? <div className="status-box">{latestRender.error}</div> : null}
            </div>

            <div className="asset-list-card">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Screenshots</p>
                  <h2>已上传素材</h2>
                </div>
                <span className="pill">{assets.length}</span>
              </div>
              <div className="asset-list">
                {(assets.length > 0 ? assets : spec.assets.slice(0, 3)).map((asset) => (
                  <div className="asset-row" key={asset.id}>
                    <Image
                      className="asset-thumb"
                      src={asset.src}
                      alt={asset.alt}
                      width={84}
                      height={54}
                      unoptimized
                    />
                    <div>
                      <strong>{asset.id}</strong>
                      <div className="muted" style={{ fontSize: 13 }}>
                        {asset.type} · {asset.src}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <details className="optional-enhance">
              <summary>可选：图片优化 / 扩展</summary>
              <div className="form-stack compact">
                <div className="optional-note">
                  有 OpenAI Key 时再使用。它只优化图片，不负责主视频生成。
                </div>
                <div className="field">
                  <label>优化 / 扩展说明</label>
                  <textarea value={imagePrompt} onChange={(event) => setImagePrompt(event.target.value)} />
                </div>
                <button className="button secondary" onClick={generateImage}>
                  可选生成增强图
                </button>
                {imageStatus ? <div className="status-box">{imageStatus}</div> : null}
              </div>
            </details>
          </aside>
        </div>
      </div>
    </main>
  );
}
