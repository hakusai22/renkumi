"use client";

import Image from "next/image";
import Link from "next/link";
import { Player } from "@remotion/player";
import { useCallback, useEffect, useMemo, useState } from "react";
import { designLibrary, type DesignLibraryEntry } from "@/lib/design-library";
import { LaunchCutVideo } from "@/remotion/LaunchCutVideo";
import {
  defaultVideoSpec,
  getTotalDurationInFrames,
  type AssetSpec,
  type SceneSpec,
  type VideoSpec,
} from "@/lib/video-spec";
import { buildSpecFromBrief, buildSpecFromGeneratedPlan, type GeneratedVideoPlan } from "@/lib/video-script";

type VideoConsoleProps = {
  initialSpec: VideoSpec;
};

type WorkflowStep = "input" | "generating" | "review" | "rendering" | "result";

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
  updatedAt?: string;
  spec?: VideoSpec;
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

const splitBullets = (value: string) =>
  value
    .split(/\n|,|，|、/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3);

const planFromSpec = (spec: VideoSpec): GeneratedVideoPlan => ({
  brand: spec.brand,
  creative: spec.creative,
  scenes: spec.scenes,
});

const sessionDraftKey = "launchcut.video-draft.v1";
const latestRenderFallbackWindowMs = 24 * 60 * 60 * 1000;

type SessionDraft = {
  brief?: string;
  assets?: AssetSpec[];
  selectedDesignId?: string;
  generatedPlan?: GeneratedVideoPlan | null;
  latestRender?: RenderSnapshot | null;
};

export function VideoConsole({ initialSpec }: VideoConsoleProps) {
  const [workflowStep, setWorkflowStep] = useState<WorkflowStep>("input");
  const [brief, setBrief] = useState("");
  const [generatedPlan, setGeneratedPlan] = useState<GeneratedVideoPlan | null>(null);
  const [assets, setAssets] = useState<AssetSpec[]>([]);
  const [scriptStatus, setScriptStatus] = useState<string>("");
  const [scriptMessages, setScriptMessages] = useState<string[]>([]);
  const [scriptTokenCount, setScriptTokenCount] = useState(0);
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string>("");
  const [renderStatus, setRenderStatus] = useState<string>("");
  const [latestRender, setLatestRender] = useState<RenderSnapshot | null>(null);
  const [selectedDesignId, setSelectedDesignId] = useState("");
  const [hasLoadedSessionDraft, setHasLoadedSessionDraft] = useState(false);

  const spec = useMemo(() => {
    const baseSpec = initialSpec ?? defaultVideoSpec;

    if (generatedPlan) {
      return buildSpecFromGeneratedPlan(generatedPlan, assets, baseSpec, selectedDesignId || undefined);
    }

    return buildSpecFromBrief(brief, assets, baseSpec, selectedDesignId || undefined);
  }, [assets, brief, generatedPlan, initialSpec, selectedDesignId]);
  const durationInFrames = useMemo(() => getTotalDurationInFrames(spec), [spec]);
  const totalSeconds = Math.round(durationInFrames / spec.output.fps);
  const progress = latestRender?.progress;
  const selectedDesign = spec.creative?.design;
  const canReview = Boolean(generatedPlan?.scenes?.length);
  const latestScriptMessage = scriptMessages[scriptMessages.length - 1] ?? scriptStatus ?? "正在准备视频方案...";
  const isActiveRender = useCallback((status?: string) => status === "queued" || status === "rendering", []);
  const isRecentRender = useCallback(
    (task: RenderSnapshot) => !task.updatedAt || Date.now() - new Date(task.updatedAt).getTime() < latestRenderFallbackWindowMs,
    [],
  );

  const getUserAssetsFromSpec = useCallback((taskSpec: VideoSpec) => {
    const baseAssets = new Set((initialSpec ?? defaultVideoSpec).assets.map((asset) => `${asset.id}:${asset.src}`));
    return taskSpec.assets.filter((asset) => !baseAssets.has(`${asset.id}:${asset.src}`));
  }, [initialSpec]);

  const hydrateRenderSpec = useCallback((task: RenderSnapshot) => {
    if (!task.spec) {
      return;
    }

    setGeneratedPlan(planFromSpec(task.spec));
    setAssets(getUserAssetsFromSpec(task.spec));
    setSelectedDesignId(task.spec.creative?.design?.id ?? "");
  }, [getUserAssetsFromSpec]);

  const applyRenderSnapshot = useCallback((task: RenderSnapshot, options: { syncSpec?: boolean } = {}) => {
    setLatestRender(task);
    setRenderStatus(task.progress?.message ?? task.status);

    if (options.syncSpec) {
      hydrateRenderSpec(task);
    }

    setWorkflowStep(isActiveRender(task.status) ? "rendering" : "result");
  }, [hydrateRenderSpec, isActiveRender]);

  const pollRender = useCallback((id: string) => {
    window.setTimeout(async () => {
      const response = await fetch(`/api/render/status?id=${id}`).catch(() => null);

      if (!response?.ok) {
        setRenderStatus("暂时无法获取渲染状态，稍后自动重试...");
        pollRender(id);
        return;
      }

      const task = (await response.json()) as RenderSnapshot;
      applyRenderSnapshot(task);

      if (isActiveRender(task.status)) {
        pollRender(id);
      }
    }, 1000);
  }, [applyRenderSnapshot, isActiveRender]);

  useEffect(() => {
    let isMounted = true;
    const cached = window.localStorage.getItem(sessionDraftKey) ?? window.sessionStorage.getItem(sessionDraftKey);

    const restoreRender = async (id?: string, fallbackUrl = "/api/render/latest") => {
      const url = id ? `/api/render/status?id=${id}` : fallbackUrl;
      const response = await fetch(url).catch(() => null);

      if (!response?.ok) {
        return;
      }

      const task = (await response.json()) as RenderSnapshot;

      if (!isMounted || !isRecentRender(task)) {
        return;
      }

      applyRenderSnapshot(task, { syncSpec: true });

      if (isActiveRender(task.status)) {
        pollRender(task.id);
      }
    };

    if (!cached) {
      setHasLoadedSessionDraft(true);
      void restoreRender();
      return () => {
        isMounted = false;
      };
    }

    try {
      const draft = JSON.parse(cached) as SessionDraft;
      setBrief(draft.brief ?? "");
      setAssets(Array.isArray(draft.assets) ? draft.assets : []);
      setSelectedDesignId(draft.selectedDesignId ?? "");
      setGeneratedPlan(draft.generatedPlan ?? null);

      if (draft.latestRender?.id) {
        setLatestRender(draft.latestRender);
        setRenderStatus(draft.latestRender.progress?.message ?? draft.latestRender.status);
        setWorkflowStep(isActiveRender(draft.latestRender.status) ? "rendering" : "result");
        void restoreRender(draft.latestRender.id);
      } else if (draft.generatedPlan?.scenes?.length) {
        setWorkflowStep("review");
        void restoreRender();
      } else {
        void restoreRender();
      }
    } catch {
      window.sessionStorage.removeItem(sessionDraftKey);
      window.localStorage.removeItem(sessionDraftKey);
      void restoreRender();
    } finally {
      setHasLoadedSessionDraft(true);
    }

    return () => {
      isMounted = false;
    };
  }, [applyRenderSnapshot, isActiveRender, isRecentRender, pollRender]);

  useEffect(() => {
    if (!hasLoadedSessionDraft) {
      return;
    }

    const draft = JSON.stringify({
      brief,
      assets,
      selectedDesignId,
      generatedPlan,
      latestRender,
    } satisfies SessionDraft);

    window.sessionStorage.setItem(sessionDraftKey, draft);
    window.localStorage.setItem(sessionDraftKey, draft);
  }, [assets, brief, generatedPlan, hasLoadedSessionDraft, latestRender, selectedDesignId]);

  const updateBrief = (value: string) => {
    setBrief(value);
    setGeneratedPlan(null);
    setLatestRender(null);
    setWorkflowStep("input");
    setScriptStatus("");
    setScriptMessages([]);
    setScriptTokenCount(0);
    setRenderStatus("");
  };

  const uploadScreenshots = async (fileList: FileList | null) => {
    const files = Array.from(fileList ?? []);
    if (files.length === 0) {
      return;
    }

    setGeneratedPlan(null);
    setLatestRender(null);
    setWorkflowStep("input");
    setRenderStatus("");
    setUploadStatus(`上传 ${files.length} 张截图中...`);

    const uploadOne = async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/assets/upload", {
        method: "POST",
        body: formData,
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? `${file.name} 上传失败`);
      }

      return payload.asset as AssetSpec;
    };

    try {
      const uploaded = await Promise.all(files.map(uploadOne));
      setAssets((current) => [...uploaded, ...current]);
      setUploadStatus(`已添加 ${uploaded.length} 张截图，本次浏览器会话已缓存素材引用。`);
    } catch (error) {
      setUploadStatus(error instanceof Error ? error.message : "截图上传失败");
    }
  };

  const pushScriptMessage = (message: string) => {
    setScriptMessages((current) => {
      const next = [...current, message].filter(Boolean);
      return next.slice(-6);
    });
  };

  const generatePlan = async () => {
    const input = brief.trim();

    if (!input) {
      setScriptStatus("请先输入一段产品说明或视频需求。");
      return;
    }

    setWorkflowStep("generating");
    setIsGeneratingPlan(true);
    setGeneratedPlan(null);
    setLatestRender(null);
    setRenderStatus("");
    setScriptMessages([]);
    setScriptTokenCount(0);
    setScriptStatus("准备根据描述和图片生成视频方案...");
    pushScriptMessage("正在整理用户描述和上传素材...");

    try {
      const response = await fetch("/api/script/optimize/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief: input, spec }),
      });

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({}));
        setScriptStatus(payload.error ?? "AI 视频方案生成失败");
        setWorkflowStep("input");
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
          const message = payload.message ?? "正在生成视频方案...";
          setScriptStatus(message);
          pushScriptMessage(message);
          return;
        }

        if (event === "token" && payload.token) {
          setScriptStatus("AI 正在输出镜头方案...");
          setScriptTokenCount((current) => current + payload.token!.length);
          return;
        }

        if (event === "result") {
          didReceiveResult = true;

          if (payload.skipped) {
            const fallbackPlan = planFromSpec(
              buildSpecFromBrief(input, assets, initialSpec ?? defaultVideoSpec, selectedDesignId || undefined),
            );
            setGeneratedPlan(fallbackPlan);
            setWorkflowStep("review");
            setScriptStatus(payload.message ?? "未配置可用文本模型，已使用本地动态方案。");
            pushScriptMessage("已生成可编辑方案。");
            return;
          }

          if (payload.plan) {
            setGeneratedPlan(payload.plan);
            setWorkflowStep("review");
            setScriptStatus(`已使用 ${payload.provider} · ${payload.model} 生成 Remotion 视频方案`);
            pushScriptMessage("方案已生成，可以编辑或直接进入渲染。");
          }
          return;
        }

        if (event === "error") {
          didReceiveResult = true;
          setWorkflowStep("input");
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
        setWorkflowStep("input");
        setScriptStatus("AI 响应结束，但没有返回可用视频方案。");
      }
    } catch (error) {
      setWorkflowStep("input");
      setScriptStatus(error instanceof Error ? error.message : "AI 视频方案生成失败");
    } finally {
      setIsGeneratingPlan(false);
    }
  };

  const updateScene = (index: number, patch: Partial<SceneSpec>) => {
    setGeneratedPlan((current) => {
      if (!current?.scenes) {
        return current;
      }

      return {
        ...current,
        scenes: current.scenes.map((scene, sceneIndex) => (sceneIndex === index ? { ...scene, ...patch } : scene)),
      };
    });
  };

  const updateDesign = (designId: string) => {
    setSelectedDesignId(designId);
    setGeneratedPlan((current) =>
      current
        ? {
            ...current,
            creative: {
              ...current.creative,
              designId: designId || undefined,
            },
          }
        : current,
    );
  };

  const submitRender = async () => {
    if (!generatedPlan) {
      setScriptStatus("请先生成并确认视频方案，再开始渲染。");
      setWorkflowStep("input");
      return;
    }

    setWorkflowStep("rendering");
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
      setWorkflowStep("review");
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
              描述 + 截图识别 → 方案 → 视频
            </div>
          </div>
        </div>
        <div className="workflow-steps" aria-label="生成流程">
          {["输入", "AI 生成", "确认编辑", "渲染"].map((label, index) => {
            const activeIndex = ["input", "generating", "review", "rendering", "result"].indexOf(workflowStep);
            const normalizedActive = activeIndex === 4 ? 3 : activeIndex;
            return (
              <span className={index <= normalizedActive ? "workflow-step active" : "workflow-step"} key={label}>
                {label}
              </span>
            );
          })}
        </div>
        <div className="nav-actions">
          {latestRender?.pageUrl ? (
            <Link className="button secondary" href={latestRender.pageUrl}>
              查看任务
            </Link>
          ) : null}
        </div>
      </header>

      <div className="page-wrap simple-page">
        <section className="simple-hero">
          <p className="eyebrow">LaunchCut workflow</p>
          <h1>先让 AI 读懂描述和截图，再确认分镜，最后生成视频</h1>
          <p>上传产品截图后，AI 会结合画面内容、用户描述和设计库生成 Remotion 视频方案。方案完成后可以编辑，也可以直接下一步渲染。</p>
        </section>

        {workflowStep === "input" ? (
          <section className="generator-panel">
            <div className="field">
              <label>产品描述 / 视频需求</label>
              <textarea
                className="brief-input"
                value={brief}
                onChange={(event) => updateBrief(event.target.value)}
                placeholder="例如：Yomori 是一个面向学生的 AI 阅读学习工具。用户上传 PDF、文章或教材，系统自动总结重点、生成学习路径和复习卡片。视频要突出上传文档、智能分析、可视化学习进度。"
              />
            </div>

            <label className="upload-box upload-box-large">
              <input
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                onChange={(event) => uploadScreenshots(event.target.files)}
              />
              <span>上传产品截图</span>
              <strong>PNG / JPG / WebP 会进入 AI 识图；SVG 会作为素材保留但不送入视觉模型</strong>
            </label>

            <AssetList assets={assets} fallbackAssets={spec.assets.slice(0, 3)} />

            <TemplatePicker activeId={selectedDesign?.id ?? selectedDesignId} onSelect={updateDesign} />

            <div className="generator-actions">
              <button className="button" onClick={generatePlan} disabled={isGeneratingPlan || !brief.trim()}>
                AI 生成视频方案
              </button>
              <span>
                {assets.length} 张自定义截图 · 生成后进入确认编辑 · {selectedDesign ? `${selectedDesign.name} 风格` : "自动选风格"}
              </span>
            </div>

            {scriptStatus ? <div className="status-box">{scriptStatus}</div> : null}
            {uploadStatus ? <div className="status-box">{uploadStatus}</div> : null}
          </section>
        ) : null}

        {workflowStep === "generating" ? (
          <section className="generator-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">AI planning</p>
                <h2>正在生成 Remotion 视频方案</h2>
              </div>
              <span className="pill">{assets.length} 张图片</span>
            </div>
            <div className="stream-timeline">
              {scriptMessages.map((message, index) => (
                <div className="stream-step" key={`${message}-${index}`}>
                  {message}
                </div>
              ))}
            </div>
            <div className="ai-plan-card" aria-live="polite">
              <div className="ai-plan-card-header">
                <div>
                  <p className="eyebrow">Structured plan</p>
                  <h3>{latestScriptMessage}</h3>
                </div>
                <span className="pill">{scriptTokenCount > 0 ? `已接收 ${scriptTokenCount} 字` : "等待输出"}</span>
              </div>
              <div className="ai-plan-grid">
                <div>
                  <span>设计风格</span>
                  <strong>{selectedDesign ? selectedDesign.name : "AI 正在选择"}</strong>
                </div>
                <div>
                  <span>素材识别</span>
                  <strong>{assets.length > 0 ? `${assets.length} 张上传图片` : "仅根据描述"}</strong>
                </div>
                <div>
                  <span>镜头结构</span>
                  <strong>4-7 个 Remotion 镜头</strong>
                </div>
              </div>
              <div className="ai-plan-skeleton" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            </div>
          </section>
        ) : null}

        {workflowStep === "review" || workflowStep === "rendering" || workflowStep === "result" ? (
          <div className="review-workspace">
            <section className="review-editor">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Review</p>
                  <h2>确认视频方案</h2>
                </div>
                <span className="pill">{selectedDesign ? `${selectedDesign.name} 风格` : "自动风格"}</span>
              </div>

              <div className="field">
                <label>设计风格</label>
                <select value={selectedDesign?.id ?? ""} onChange={(event) => updateDesign(event.target.value)}>
                  <option value="">AI 自动推荐</option>
                  {designLibrary.map((design) => (
                    <option value={design.id} key={design.id}>
                      {design.name}
                    </option>
                  ))}
                </select>
              </div>

              <TemplatePicker compact activeId={selectedDesign?.id ?? selectedDesignId} onSelect={updateDesign} />

              <div className="scene-list">
                {(generatedPlan?.scenes ?? []).map((scene, index) => (
                  <div className="scene-card" key={scene.id ?? index}>
                    <div className="scene-card-title">
                      <span>镜头 {index + 1}</span>
                      <span className="pill">{scene.layout ?? scene.kind}</span>
                    </div>
                    <div className="grid-2">
                      <div className="field">
                        <label>标题</label>
                        <input value={scene.title} onChange={(event) => updateScene(index, { title: event.target.value })} />
                      </div>
                      <div className="field">
                        <label>时长（秒）</label>
                        <input
                          min={3}
                          max={16}
                          type="number"
                          value={scene.durationInSeconds}
                          onChange={(event) =>
                            updateScene(index, {
                              durationInSeconds: Math.max(3, Math.min(16, Number(event.target.value) || 8)),
                            })
                          }
                        />
                      </div>
                    </div>
                    <div className="field">
                      <label>副标题</label>
                      <textarea value={scene.subtitle} onChange={(event) => updateScene(index, { subtitle: event.target.value })} />
                    </div>
                    <div className="field">
                      <label>旁白</label>
                      <textarea
                        value={scene.narration ?? ""}
                        onChange={(event) => updateScene(index, { narration: event.target.value })}
                      />
                    </div>
                    <div className="field">
                      <label>短标签（每行一条，最多 3 条）</label>
                      <textarea
                        value={(scene.bullets ?? []).join("\n")}
                        onChange={(event) => updateScene(index, { bullets: splitBullets(event.target.value) })}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <aside className="preview-column">
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

              <div className="render-dock">
                <div>
                  <p className="eyebrow">Next step</p>
                  <h2>{workflowStep === "result" ? "视频生成完成" : "准备生成视频"}</h2>
                  <p>
                    {assets.length} 张自定义截图 · {totalSeconds}s · 1080p
                    {selectedDesign ? ` · ${selectedDesign.name} 风格` : ""}
                  </p>
                </div>
                {workflowStep === "rendering" || latestRender ? (
                  <>
                    <div className="progress-track">
                      <div className="progress-fill" style={{ width: `${progress?.percent ?? 0}%` }} />
                    </div>
                    <div className="progress-meta">
                      <span>{renderStatus || "等待生成"}</span>
                      <span>{progress ? `${progress.renderedFrames} rendered / ${progress.encodedFrames} encoded` : ""}</span>
                    </div>
                  </>
                ) : null}
                {latestRender?.outputUrl ? (
                  <a className="button" href={latestRender.outputUrl} download>
                    下载 MP4
                  </a>
                ) : (
                  <button className="button" onClick={submitRender} disabled={!canReview || workflowStep === "rendering"}>
                    {workflowStep === "rendering" ? "生成中..." : "下一步：生成视频"}
                  </button>
                )}
                <button className="button secondary" onClick={() => setWorkflowStep("input")} disabled={workflowStep === "rendering"}>
                  返回修改输入
                </button>
                {latestRender?.error ? <div className="status-box">{latestRender.error}</div> : null}
              </div>

              <AssetList assets={assets} fallbackAssets={spec.assets.slice(0, 3)} />
            </aside>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function AssetList({ assets, fallbackAssets }: { assets: AssetSpec[]; fallbackAssets: AssetSpec[] }) {
  const visibleAssets = assets.length > 0 ? assets : fallbackAssets;

  return (
    <div className="asset-list-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Screenshots</p>
          <h2>已上传素材</h2>
        </div>
        <span className="pill">{assets.length}</span>
      </div>
      <div className="asset-list">
        {visibleAssets.map((asset) => (
          <div className="asset-row" key={asset.id}>
            <Image className="asset-thumb" src={asset.src} alt={asset.alt} width={84} height={54} unoptimized />
            <div>
              <strong>{asset.originalName ?? asset.id}</strong>
              <div className="muted" style={{ fontSize: 13 }}>
                {asset.mimeType ?? asset.type} · {asset.size ? `${Math.round(asset.size / 1024)}KB · ` : ""}
                {asset.src}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TemplatePicker({
  activeId,
  compact = false,
  onSelect,
}: {
  activeId?: string;
  compact?: boolean;
  onSelect: (designId: string) => void;
}) {
  const visibleDesigns = compact ? designLibrary.slice(0, 18) : designLibrary;

  return (
    <section className={compact ? "template-panel compact" : "template-panel"}>
      <div className="section-heading">
        <div>
          <p className="eyebrow">Design templates</p>
          <h2>选择视频视觉模板</h2>
        </div>
        <span className="pill">{designLibrary.length} 套</span>
      </div>
      <div className="template-grid">
        <button
          className={!activeId ? "template-card active" : "template-card"}
          type="button"
          onClick={() => onSelect("")}
        >
          <div className="template-card-top">
            <strong>AI 自动推荐</strong>
            <span>Auto</span>
          </div>
          <p>根据描述、图片和素材内容自动选择最贴近的设计语言。</p>
          <ColorSwatches colors={["#103D4A", "#F4C95D", "#E65A4F"]} />
        </button>

        {visibleDesigns.map((design) => (
          <button
            className={activeId === design.id ? "template-card active" : "template-card"}
            type="button"
            key={design.id}
            onClick={() => onSelect(design.id)}
          >
            <div className="template-card-top">
              <strong>{design.name}</strong>
              <span>{design.id}</span>
            </div>
            <p>{design.summary}</p>
            <ColorSwatches colors={design.colors} />
          </button>
        ))}
      </div>
    </section>
  );
}

function ColorSwatches({ colors }: { colors: DesignLibraryEntry["colors"] }) {
  return (
    <div className="template-swatches" aria-hidden="true">
      {colors.slice(0, 5).map((color) => (
        <span style={{ background: color }} key={color} />
      ))}
    </div>
  );
}
