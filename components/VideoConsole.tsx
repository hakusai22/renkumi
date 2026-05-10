"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { designLibrary, type DesignLibraryEntry } from "@/lib/design-library";
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
  workflowRoute?: WorkflowRoute;
};

type WorkflowRoute = "input" | "ai-plan" | "storyboard" | "render";
type WorkflowStep = "input" | "generating" | "review" | "rendering" | "result";

const workflowStages = [
  { id: "input", label: "输入素材", href: "/generate/input" },
  { id: "ai-plan", label: "AI 生成方案", href: "/generate/ai-plan" },
  { id: "storyboard", label: "确认分镜", href: "/generate/storyboard" },
  { id: "render", label: "渲染视频", href: "/generate/render" },
] as const;

const getWorkflowStageIndex = (route: WorkflowRoute) =>
  workflowStages.findIndex((stage) => stage.id === route);

const getInitialWorkflowStep = (route: WorkflowRoute): WorkflowStep =>
  route === "input" ? "input" : route === "ai-plan" ? "generating" : "review";

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
  skills?: string[];
  missingSkillNames?: string[];
};

type SkillSummary = {
  name: string;
  description: string;
  tags: string[];
  source: "project" | "user";
  activeByDefault: boolean;
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

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Failed to read file.")));
    reader.readAsDataURL(file);
  });

const sessionDraftKey = "renkumi.video-draft.v1";
const latestRenderFallbackWindowMs = 24 * 60 * 60 * 1000;
const allowedLocalImageTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);
const maxLocalImageBytes = 3 * 1024 * 1024;
const maxVisionImageEdge = 1280;
const compressedImageQuality = 0.78;
const aiPlanTimeoutMs = 90 * 1000;
const defaultRemotionSkillName = "remotion-best-practices";
const defaultDesignId = "vercel";

type SessionDraft = {
  brief?: string;
  assets?: AssetSpec[];
  selectedDesignId?: string;
  selectedSkillNames?: string[];
  generatedPlan?: GeneratedVideoPlan | null;
  latestRender?: RenderSnapshot | null;
};

type BrowserGenerationRecord = {
  id: string;
  title: string;
  brief: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  pageUrl?: string;
  outputUrl?: string;
  assetCount: number;
  designName?: string;
};

const dataUrlByteSize = (dataUrl: string) => {
  const base64 = dataUrl.split(",", 2)[1] ?? "";
  return Math.ceil((base64.length * 3) / 4);
};

const loadImageFromDataUrl = (dataUrl: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", () => reject(new Error("Failed to decode image.")));
    image.src = dataUrl;
  });

const prepareLocalImage = async (file: File) => {
  const originalDataUrl = await readFileAsDataUrl(file);

  if (file.type === "image/svg+xml") {
    return {
      src: originalDataUrl,
      mimeType: file.type,
      size: file.size,
    };
  }

  try {
    const image = await loadImageFromDataUrl(originalDataUrl);
    const scale = Math.min(1, maxVisionImageEdge / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) {
      return {
        src: originalDataUrl,
        mimeType: file.type,
        size: file.size,
      };
    }

    canvas.width = width;
    canvas.height = height;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    const mimeType = file.type === "image/webp" ? "image/webp" : "image/jpeg";
    const compressedDataUrl = canvas.toDataURL(mimeType, compressedImageQuality);
    const compressedSize = dataUrlByteSize(compressedDataUrl);

    if (!compressedDataUrl || compressedSize >= file.size) {
      return {
        src: originalDataUrl,
        mimeType: file.type,
        size: file.size,
      };
    }

    return {
      src: compressedDataUrl,
      mimeType,
      size: compressedSize,
    };
  } catch {
    return {
      src: originalDataUrl,
      mimeType: file.type,
      size: file.size,
    };
  }
};

const browserRecordsKey = "renkumi.browser-records.v1";

const stringifyDraft = (draft: SessionDraft) => JSON.stringify(draft);

const lightweightDraft = (draft: SessionDraft): SessionDraft => ({
  ...draft,
  assets: draft.assets?.filter((asset) => !asset.src.startsWith("data:")) ?? [],
});

const persistSessionDraft = (draft: SessionDraft) => {
  const value = stringifyDraft(draft);

  try {
    window.sessionStorage.setItem(sessionDraftKey, value);
    window.localStorage.setItem(sessionDraftKey, value);
  } catch {
    const fallbackValue = stringifyDraft(lightweightDraft(draft));
    window.sessionStorage.setItem(sessionDraftKey, fallbackValue);
    window.localStorage.setItem(sessionDraftKey, fallbackValue);
  }
};

const loadBrowserRecords = () => {
  try {
    const raw = window.localStorage.getItem(browserRecordsKey);
    const records = raw ? (JSON.parse(raw) as BrowserGenerationRecord[]) : [];
    return Array.isArray(records) ? records.slice(0, 12) : [];
  } catch {
    return [];
  }
};

const persistBrowserRecords = (records: BrowserGenerationRecord[]) => {
  window.localStorage.setItem(browserRecordsKey, JSON.stringify(records.slice(0, 12)));
};

const formatRecordTime = (value: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

export function VideoConsole({ initialSpec, workflowRoute = "storyboard" }: VideoConsoleProps) {
  const router = useRouter();
  const [workflowStep, setWorkflowStep] = useState<WorkflowStep>(() => getInitialWorkflowStep(workflowRoute));
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
  const [selectedDesignId, setSelectedDesignId] = useState(defaultDesignId);
  const [availableSkills, setAvailableSkills] = useState<SkillSummary[]>([]);
  const [selectedSkillNames, setSelectedSkillNames] = useState<string[]>([]);
  const [skillStatus, setSkillStatus] = useState("");
  const [selectedSceneIndex, setSelectedSceneIndex] = useState(0);
  const [hasLoadedSessionDraft, setHasLoadedSessionDraft] = useState(false);
  const [browserRecords, setBrowserRecords] = useState<BrowserGenerationRecord[]>([]);
  const hasManualPlanEditsRef = useRef(false);
  const hasAutoGeneratedRef = useRef(false);
  const hasRestoredSessionRef = useRef(false);

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
  const scenes = generatedPlan?.scenes ?? [];
  const activeSceneIndex = scenes.length ? Math.min(selectedSceneIndex, scenes.length - 1) : 0;
  const selectedScene = scenes[activeSceneIndex];
  const selectedSceneNumber = scenes.length ? activeSceneIndex + 1 : 0;
  const latestScriptMessage = scriptMessages[scriptMessages.length - 1] ?? scriptStatus ?? "正在准备视频方案...";
  const selectedSkillLabel =
    selectedSkillNames.length > 0 ? selectedSkillNames.join(", ") : "自动启用 Remotion skill";
  const isInputRoute = workflowRoute === "input";
  const isAiPlanRoute = workflowRoute === "ai-plan";
  const isStoryboardRoute = workflowRoute === "storyboard";
  const isRenderRoute = workflowRoute === "render";
  const isActiveRender = useCallback((status?: string) => status === "queued" || status === "rendering", []);
  const isRecentRender = useCallback(
    (task: RenderSnapshot) => !task.updatedAt || Date.now() - new Date(task.updatedAt).getTime() < latestRenderFallbackWindowMs,
    [],
  );

  const getUserAssetsFromSpec = useCallback((taskSpec: VideoSpec) => {
    const baseAssets = new Set((initialSpec ?? defaultVideoSpec).assets.map((asset) => `${asset.id}:${asset.src}`));
    return taskSpec.assets.filter((asset) => !baseAssets.has(`${asset.id}:${asset.src}`));
  }, [initialSpec]);

  const hasDraftContent = Boolean(brief.trim() || generatedPlan || assets.length > 0 || latestRender);

  const upsertBrowserRecord = useCallback(
    (task: RenderSnapshot) => {
      const now = new Date().toISOString();
      const record: BrowserGenerationRecord = {
        id: task.id,
        title: generatedPlan?.brand?.name || spec.brand.name || brief.trim().slice(0, 44) || "未命名视频",
        brief,
        status: task.status,
        createdAt: now,
        updatedAt: task.updatedAt ?? now,
        pageUrl: task.pageUrl ?? `/renders/${task.id}`,
        outputUrl: task.outputUrl,
        assetCount: assets.length,
        designName: selectedDesign?.name,
      };

      setBrowserRecords((current) => {
        const existing = current.find((item) => item.id === task.id);
        const nextRecord = existing ? { ...existing, ...record, createdAt: existing.createdAt } : record;
        const nextRecords = [nextRecord, ...current.filter((item) => item.id !== task.id)].slice(0, 12);
        persistBrowserRecords(nextRecords);
        return nextRecords;
      });
    },
    [assets.length, brief, generatedPlan?.brand?.name, selectedDesign?.name, spec.brand.name],
  );

  const hydrateRenderSpec = useCallback((task: RenderSnapshot) => {
    if (!task.spec) {
      return;
    }

    setGeneratedPlan(planFromSpec(task.spec));
    setAssets(getUserAssetsFromSpec(task.spec));
    setSelectedDesignId(task.spec.creative?.design?.id || defaultDesignId);
  }, [getUserAssetsFromSpec]);

  const applyRenderSnapshot = useCallback((task: RenderSnapshot, options: { syncSpec?: boolean } = {}) => {
    setLatestRender(task);
    setRenderStatus(task.progress?.message ?? task.status);
    upsertBrowserRecord(task);

    if (options.syncSpec) {
      hydrateRenderSpec(task);
    }

    if (workflowRoute === "render") {
      setWorkflowStep(isActiveRender(task.status) ? "rendering" : "result");
      return;
    }

    setWorkflowStep(getInitialWorkflowStep(workflowRoute));
  }, [hydrateRenderSpec, isActiveRender, upsertBrowserRecord, workflowRoute]);

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
    setBrowserRecords(loadBrowserRecords());
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadSkills = async () => {
      const response = await fetch("/api/skills").catch(() => null);

      if (!response?.ok) {
        if (isMounted) {
          setSkillStatus("未能读取本机 skills，生成仍可继续。");
        }
        return;
      }

      const payload = (await response.json().catch(() => ({}))) as { skills?: SkillSummary[] };
      const skills = Array.isArray(payload.skills) ? payload.skills : [];

      if (!isMounted) {
        return;
      }

      setAvailableSkills(skills);
      setSelectedSkillNames((current) => {
        const availableNames = new Set(skills.map((skill) => skill.name));
        const restored = current.filter((name) => availableNames.has(name));
        const defaultSkillNames = skills.filter((skill) => skill.activeByDefault).map((skill) => skill.name);

        if (restored.length > 0 || defaultSkillNames.length === 0) {
          return Array.from(new Set([...defaultSkillNames, ...restored]));
        }

        return defaultSkillNames;
      });

      if (skills.length === 0) {
        setSkillStatus("未发现本机 Agent Skill；生成将使用内置 Remotion 规则。");
      }
    };

    void loadSkills();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (availableSkills.length === 0) {
      return;
    }

    if (selectedSkillNames.length === 0) {
      setSkillStatus("后端会直接使用 Remotion 默认 skill。");
      return;
    }

    setSkillStatus(`生成 Remotion 视频将直接使用 ${selectedSkillNames.join(", ")} skill。`);
  }, [availableSkills.length, selectedSkillNames]);

  useEffect(() => {
    if (hasRestoredSessionRef.current) {
      return;
    }

    hasRestoredSessionRef.current = true;
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
      setSelectedDesignId(draft.selectedDesignId || defaultDesignId);
      setSelectedSkillNames(Array.isArray(draft.selectedSkillNames) ? draft.selectedSkillNames : []);
      setGeneratedPlan(draft.generatedPlan ?? null);

      if (draft.latestRender?.id) {
        setLatestRender(draft.latestRender);
        setRenderStatus(draft.latestRender.progress?.message ?? draft.latestRender.status);
        setWorkflowStep(
          workflowRoute === "input"
            ? "input"
            : workflowRoute === "render"
              ? isActiveRender(draft.latestRender.status)
                ? "rendering"
                : "result"
              : workflowRoute === "ai-plan"
                ? "generating"
                : "review",
        );
        void restoreRender(draft.latestRender.id);
      } else if (draft.generatedPlan?.scenes?.length) {
        setWorkflowStep(getInitialWorkflowStep(workflowRoute));
        void restoreRender();
      } else {
        setWorkflowStep(getInitialWorkflowStep(workflowRoute));
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
  }, [applyRenderSnapshot, isActiveRender, isRecentRender, pollRender, workflowRoute]);

  useEffect(() => {
    if (!hasLoadedSessionDraft) {
      return;
    }

    const renderDraft = latestRender
      ? {
          id: latestRender.id,
          status: latestRender.status,
          statusUrl: latestRender.statusUrl,
          pageUrl: latestRender.pageUrl,
          outputUrl: latestRender.outputUrl,
          error: latestRender.error,
          updatedAt: latestRender.updatedAt,
          progress: latestRender.progress,
        }
      : null;
    const draft = {
      brief,
      assets,
      selectedDesignId,
      selectedSkillNames,
      generatedPlan,
      latestRender: renderDraft,
    } satisfies SessionDraft;

    try {
      persistSessionDraft(draft);
    } catch {
      // Ignore quota failures after the lightweight fallback has also failed.
    }
  }, [assets, brief, generatedPlan, hasLoadedSessionDraft, latestRender, selectedDesignId, selectedSkillNames]);

  const updateBrief = (value: string) => {
    hasManualPlanEditsRef.current = false;
    setBrief(value);
    setGeneratedPlan(null);
    setLatestRender(null);
    setWorkflowStep("input");
    setScriptStatus("");
    setScriptMessages([]);
    setScriptTokenCount(0);
    setRenderStatus("");
  };

  const resetDraft = () => {
    hasManualPlanEditsRef.current = false;
    hasAutoGeneratedRef.current = false;
    setWorkflowStep("input");
    setBrief("");
    setGeneratedPlan(null);
    setAssets([]);
    setScriptStatus("");
    setScriptMessages([]);
    setScriptTokenCount(0);
    setIsGeneratingPlan(false);
    setUploadStatus("");
    setRenderStatus("");
    setLatestRender(null);
    setSelectedDesignId(defaultDesignId);
    setSelectedSkillNames(availableSkills.filter((skill) => skill.activeByDefault).map((skill) => skill.name));
    window.sessionStorage.removeItem(sessionDraftKey);
    window.localStorage.removeItem(sessionDraftKey);
  };

  const removeAsset = (assetId: string) => {
    hasManualPlanEditsRef.current = true;
    setAssets((current) => current.filter((asset) => asset.id !== assetId));
    setUploadStatus("");
  };

  const stageScreenshots = async (fileList: FileList | null) => {
    const files = Array.from(fileList ?? []);
    if (files.length === 0) {
      return;
    }

    hasManualPlanEditsRef.current = false;
    setGeneratedPlan(null);
    setLatestRender(null);
    setWorkflowStep("input");
    setRenderStatus("");
    setUploadStatus(`正在读取 ${files.length} 张本地截图...`);

    const stageOne = async (file: File) => {
      if (!allowedLocalImageTypes.has(file.type)) {
        throw new Error(`${file.name} 不是支持的图片格式，请使用 PNG、JPG、WebP 或 SVG。`);
      }

      if (file.size > maxLocalImageBytes) {
        throw new Error(`${file.name} 超过 3MB。部署环境会把图片作为 base64 随请求发送，请先压缩后再试。`);
      }

      const extension = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1] || "png";
      const id = `shot-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
      const prepared = await prepareLocalImage(file);

      return {
        id,
        type: "screenshot",
        src: prepared.src,
        alt: file.name || "Local product screenshot",
        mimeType: prepared.mimeType,
        size: prepared.size,
        originalName: file.name || `${id}.${extension}`,
      } satisfies AssetSpec;
    };

    try {
      const staged = await Promise.all(files.map(stageOne));
      setAssets((current) => [...staged, ...current]);
      setUploadStatus(`已临时添加 ${staged.length} 张截图。图片已在浏览器内压缩，生成时会作为 base64 随请求发送。`);
    } catch (error) {
      setUploadStatus(error instanceof Error ? error.message : "读取本地截图失败");
    }
  };

  const pushScriptMessage = (message: string) => {
    setScriptMessages((current) => {
      const next = [...current, message].filter(Boolean);
      return next.slice(-6);
    });
  };

  const generatePlan = useCallback(async () => {
    const input = brief.trim();

    if (!input) {
      setScriptStatus("请先输入一段产品说明或视频需求。");
      return;
    }

    const fallbackSpec = initialSpec ?? defaultVideoSpec;
    const localDraftSpec = buildSpecFromBrief(input, assets, fallbackSpec, selectedDesignId || undefined);
    const localDraftPlan = planFromSpec(localDraftSpec);

    hasManualPlanEditsRef.current = false;
    setWorkflowStep("generating");
    setIsGeneratingPlan(true);
    setGeneratedPlan(localDraftPlan);
    setLatestRender(null);
    setRenderStatus("");
    setScriptMessages([]);
    setScriptTokenCount(0);
    setScriptStatus("已先生成本地可编辑草稿，AI 正在读取图片并增强方案...");
    pushScriptMessage("已生成本地可编辑草稿。");
    pushScriptMessage("AI 正在读取图片并增强方案...");

    if (isInputRoute) {
      try {
        persistSessionDraft({
          brief: input,
          assets,
          selectedDesignId,
          selectedSkillNames,
          generatedPlan: localDraftPlan,
          latestRender: null,
        });
      } catch {
        setScriptStatus("草稿太大，浏览器暂时无法保存；请减少本地图片后再生成。");
        setIsGeneratingPlan(false);
        return;
      }
      router.push("/generate/ai-plan");
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), aiPlanTimeoutMs);

    try {
      const response = await fetch("/api/script/optimize/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief: input, spec: localDraftSpec, skillNames: selectedSkillNames }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({}));
        setScriptStatus(`${payload.error ?? "AI 视频方案生成失败"}。已保留本地可编辑草稿。`);
        setWorkflowStep("review");
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
              buildSpecFromBrief(input, assets, fallbackSpec, selectedDesignId || undefined),
            );
            if (!hasManualPlanEditsRef.current) {
              setGeneratedPlan(fallbackPlan);
            }
            setWorkflowStep("review");
            setScriptStatus(payload.message ?? "未配置可用文本模型，已使用本地动态方案。");
            pushScriptMessage("已生成可编辑方案。");
            router.push("/generate/storyboard");
            return;
          }

          if (payload.plan) {
            if (hasManualPlanEditsRef.current) {
              setScriptStatus(`AI 已使用 ${payload.provider} · ${payload.model} 返回方案；你已手动编辑，暂不自动覆盖当前草稿。`);
              pushScriptMessage("AI 方案已返回；保留你的手动编辑。");
              return;
            }

            setGeneratedPlan(payload.plan);
            setWorkflowStep("review");
            setScriptStatus(`已使用 ${payload.provider} · ${payload.model} 生成 Remotion 视频方案`);
            pushScriptMessage("方案已生成，可以编辑或直接进入渲染。");
            router.push("/generate/storyboard");
          }
          return;
        }

        if (event === "error") {
          didReceiveResult = true;
          setWorkflowStep("review");
          setScriptStatus(`${payload.error ?? "AI 视频方案生成失败"}。已保留本地可编辑草稿。`);
          router.push("/generate/storyboard");
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
        setWorkflowStep("review");
        setScriptStatus("AI 响应结束，但没有返回可用视频方案。已保留本地可编辑草稿。");
        router.push("/generate/storyboard");
      }
    } catch (error) {
      setWorkflowStep("review");
      const message =
        error instanceof DOMException && error.name === "AbortError"
          ? "AI 响应超过 90 秒，已停止等待"
          : error instanceof Error
            ? error.message
            : "AI 视频方案生成失败";
      setScriptStatus(`${message}。已保留本地可编辑草稿。`);
      router.push("/generate/storyboard");
    } finally {
      window.clearTimeout(timeoutId);
      setIsGeneratingPlan(false);
    }
  }, [assets, brief, initialSpec, isInputRoute, router, selectedDesignId, selectedSkillNames]);

  useEffect(() => {
    if (!isAiPlanRoute || !hasLoadedSessionDraft || hasAutoGeneratedRef.current) {
      return;
    }

    if (!brief.trim()) {
      return;
    }

    hasAutoGeneratedRef.current = true;
    void generatePlan();
  }, [brief, generatePlan, hasLoadedSessionDraft, isAiPlanRoute]);

  useEffect(() => {
    setSelectedSceneIndex((current) => Math.max(0, Math.min(current, Math.max(0, scenes.length - 1))));
  }, [scenes.length]);

  const updateScene = (index: number, patch: Partial<SceneSpec>) => {
    hasManualPlanEditsRef.current = true;
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
    hasManualPlanEditsRef.current = true;
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

  const toggleSkill = (skillName: string) => {
    setSelectedSkillNames((current) =>
      current.includes(skillName)
        ? skillName === defaultRemotionSkillName
          ? current
          : current.filter((name) => name !== skillName)
        : [...current, skillName],
    );
  };

  const submitRender = async () => {
    if (!generatedPlan) {
      setScriptStatus("请先生成并确认视频方案，再开始渲染。");
      router.push("/generate/input");
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

    const queuedRender = {
      ...payload,
      progress: {
        percent: 0,
        renderedFrames: 0,
        encodedFrames: 0,
        stage: "queued",
        message: "等待开始",
      },
    } satisfies RenderSnapshot;
    setLatestRender(queuedRender);
    upsertBrowserRecord(queuedRender);
    persistSessionDraft({
      brief,
      assets,
      selectedDesignId,
      selectedSkillNames,
      generatedPlan,
      latestRender: queuedRender,
    });
    setRenderStatus("任务已创建，正在生成视频...");
    router.push("/generate/render");
    pollRender(payload.id);
  };

  const currentWorkflowStageIndex = Math.max(0, getWorkflowStageIndex(workflowRoute));

  const inputPanel = (
    <div className="generator-flow">
      <section className="generator-panel">
        <div className="section-heading generator-panel-heading">
          <div>
            <p className="eyebrow">Brief</p>
            <h2>描述产品和视频目标</h2>
          </div>
          <span className="pill">{brief.length} / 1000</span>
        </div>

        <div className="field">
          <label>产品描述 / 视频需求</label>
          <textarea
            className="brief-input"
            value={brief}
            maxLength={1000}
            onChange={(event) => updateBrief(event.target.value)}
            placeholder="例如：Yomori 是一个面向学生的 AI 阅读学习工具。用户上传 PDF、文章或教材，系统自动总结重点、生成学习路径和复习卡片。视频要突出上传文档、智能分析、可视化学习进度。"
          />
        </div>

        <label className="upload-box upload-box-large">
          <input
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            onChange={(event) => stageScreenshots(event.target.files)}
          />
          <span>添加产品截图 / 文件</span>
          <strong>支持 PNG、JPG、WebP、SVG 图片；图片仅临时保存在本浏览器</strong>
        </label>

        <div className="generator-actions">
          <button className="button" onClick={generatePlan} disabled={isGeneratingPlan || !brief.trim()}>
            开始生成方案
          </button>
          <span>
            {assets.length} 张自定义截图 · {selectedSkillLabel} ·{" "}
            {selectedDesign ? `${selectedDesign.name} 风格` : "自动选风格"}
          </span>
        </div>

        {scriptStatus ? <div className="status-box">{scriptStatus}</div> : null}
        {uploadStatus ? <div className="status-box">{uploadStatus}</div> : null}
      </section>

      <AssetList assets={assets} fallbackAssets={spec.assets.slice(0, 3)} onRemove={removeAsset} />

      <TemplatePicker activeId={selectedDesign?.id ?? selectedDesignId} onSelect={updateDesign} />

      <SkillPicker
        skills={availableSkills}
        selectedSkillNames={selectedSkillNames}
        status={skillStatus}
        onToggle={toggleSkill}
      />
    </div>
  );

  return (
    <main className="app-shell generate-shell">
      <header className="top-nav">
        <div className="brand-lockup">
          <Link className="brand-home-link" href="/" aria-label="返回首页">
            <div className={`brand-mark ${spec.brand.logoSrc ? "brand-mark-image" : ""}`} aria-hidden="true">
              {spec.brand.logoSrc ? (
                <Image src={spec.brand.logoSrc} alt="" width={34} height={34} unoptimized />
              ) : (
                spec.brand.logoText
              )}
            </div>
          </Link>
          <div>
            <div>{spec.brand.name}</div>
            <div className="muted" style={{ fontSize: 13, fontWeight: 650 }}>
              描述 + 截图识别 → 方案 → 视频
            </div>
          </div>
        </div>
        <nav className="workflow-progress" aria-label="视频生成进度">
          {workflowStages.map((stage, index) => {
            const state =
              index < currentWorkflowStageIndex ? "complete" : index === currentWorkflowStageIndex ? "current" : "upcoming";
            return (
              <Link
                aria-current={state === "current" ? "step" : undefined}
                className="workflow-progress-step"
                data-state={state}
                href={stage.href}
                key={stage.id}
              >
                {stage.label}
              </Link>
            );
          })}
        </nav>
        <div className="nav-actions">
          <Link className="button secondary" href="/generate/input" onClick={resetDraft}>
            新建方案
          </Link>
          {!isInputRoute ? (
            <Link className="button secondary" href="/generate/input" onClick={resetDraft}>
              重新生成
            </Link>
          ) : hasDraftContent ? (
            <Link className="button" href="/generate/storyboard">
              继续草稿
            </Link>
          ) : null}
          {latestRender?.pageUrl ? (
            <Link className="button secondary" href={latestRender.pageUrl}>
              查看任务
            </Link>
          ) : null}
        </div>
      </header>

      <div className="page-wrap simple-page">
        <section className="simple-hero">
          <p className="eyebrow">Renkumi workflow</p>
          <h1>先让 AI 读懂描述和截图，再确认分镜，最后生成视频</h1>
          <p>添加产品截图后，AI 会结合画面内容、用户描述和设计库生成 Remotion 视频方案。方案完成后可以编辑，也可以直接下一步渲染。</p>
        </section>

        {isInputRoute ? (
          <div className="home-route-grid">
            <div>{inputPanel}</div>
            <aside className="home-side-stack">
              <DraftCard
                hasDraftContent={hasDraftContent}
                brief={brief}
                assetCount={assets.length}
                generatedPlan={generatedPlan}
                latestRender={latestRender}
                onReset={resetDraft}
              />
              <BrowserRecordsList records={browserRecords} />
            </aside>
          </div>
        ) : null}

        {!isInputRoute && !canReview && !latestRender && (!isAiPlanRoute || !brief.trim()) ? (
          <section className="generator-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">No draft</p>
                <h2>还没有可继续的视频草稿</h2>
              </div>
              <Link className="button secondary" href="/generate/input">
                去生成页
              </Link>
            </div>
            <p className="empty-copy">先去生成页添加文件和描述，点击开始生成方案后会自动进入这里。</p>
          </section>
        ) : null}

        {isAiPlanRoute && brief.trim() ? (
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
                  <strong>{assets.length > 0 ? `${assets.length} 张本地图片` : "仅根据描述"}</strong>
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

        {(isStoryboardRoute || isRenderRoute) && canReview ? (
          <>
            <div className="review-workspace">
              <section className="review-editor">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Review</p>
                    <h2>确认视频方案</h2>
                  </div>
                  <span className="pill">
                    {isGeneratingPlan
                      ? scriptTokenCount > 0
                        ? `AI 已接收 ${scriptTokenCount} 字`
                        : "AI 优化中"
                      : selectedDesign
                        ? `${selectedDesign.name} 风格`
                        : "自动风格"}
                  </span>
                </div>

                {scriptStatus ? <div className="status-box">{scriptStatus}</div> : null}
                {skillStatus ? <div className="status-box compact">{skillStatus}</div> : null}

                <div className="review-summary-strip" aria-label="视频方案概览">
                  <div>
                    <span>镜头</span>
                    <strong>{scenes.length}</strong>
                  </div>
                  <div>
                    <span>总时长</span>
                    <strong>{totalSeconds}s</strong>
                  </div>
                  <div>
                    <span>素材</span>
                    <strong>{assets.length}</strong>
                  </div>
                </div>

                <details className="review-settings">
                  <summary>
                    <span>视觉风格</span>
                    <strong>{selectedDesign ? selectedDesign.name : "AI 自动推荐"}</strong>
                  </summary>
                  <div className="review-settings-body">
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
                  </div>
                </details>

                <div className="scene-planner">
                  <div className="scene-rail" role="tablist" aria-label="分镜列表">
                    {scenes.map((scene, index) => (
                      <button
                        className={index === activeSceneIndex ? "scene-tab active" : "scene-tab"}
                        key={scene.id ?? index}
                        type="button"
                        role="tab"
                        aria-selected={index === activeSceneIndex}
                        onClick={() => setSelectedSceneIndex(index)}
                      >
                        <span>{String(index + 1).padStart(2, "0")}</span>
                        <strong>{scene.title}</strong>
                        <small>
                          {scene.durationInSeconds}s · {scene.layout ?? scene.kind}
                        </small>
                      </button>
                    ))}
                  </div>

                  {selectedScene ? (
                    <div className="scene-inspector">
                      <div className="scene-inspector-header">
                        <div>
                          <p className="eyebrow">Scene {selectedSceneNumber}</p>
                          <h3>{selectedScene.title || "未命名镜头"}</h3>
                        </div>
                        <span className="pill">{selectedScene.kind}</span>
                      </div>
                      <div className="grid-2">
                        <div className="field">
                          <label>屏幕标题</label>
                          <input
                            value={selectedScene.title}
                            onChange={(event) => updateScene(activeSceneIndex, { title: event.target.value })}
                          />
                        </div>
                        <div className="field">
                          <label>时长（秒）</label>
                          <input
                            min={3}
                            max={16}
                            type="number"
                            value={selectedScene.durationInSeconds}
                            onChange={(event) =>
                              updateScene(activeSceneIndex, {
                                durationInSeconds: Math.max(3, Math.min(16, Number(event.target.value) || 8)),
                              })
                            }
                          />
                        </div>
                      </div>
                      <div className="field">
                        <label>副标题</label>
                        <textarea
                          value={selectedScene.subtitle}
                          onChange={(event) => updateScene(activeSceneIndex, { subtitle: event.target.value })}
                        />
                      </div>
                      <div className="field">
                        <label>旁白</label>
                        <textarea
                          value={selectedScene.narration ?? ""}
                          onChange={(event) => updateScene(activeSceneIndex, { narration: event.target.value })}
                        />
                      </div>
                      <div className="field">
                        <label>短标签（每行一条，最多 3 条）</label>
                        <textarea
                          value={(selectedScene.bullets ?? []).join("\n")}
                          onChange={(event) => updateScene(activeSceneIndex, { bullets: splitBullets(event.target.value) })}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="scene-inspector empty">
                      <p className="empty-copy">生成方案后会在这里逐镜头确认内容。</p>
                    </div>
                  )}
                </div>
              </section>

              <aside className="preview-column">
                {isStoryboardRoute ? (
                  <section className="storyboard-side-card">
                    <div className="section-heading">
                      <div>
                        <p className="eyebrow">Storyboard</p>
                        <h2>待生成视频</h2>
                      </div>
                      <span className="pill">{scenes.length} 个镜头</span>
                    </div>
                    <div className="storyboard-readiness" aria-label="生成前检查">
                      <div>
                        <span>当前阶段</span>
                        <strong>确认分镜</strong>
                      </div>
                      <div>
                        <span>预计时长</span>
                        <strong>{totalSeconds}s</strong>
                      </div>
                      <div>
                        <span>视觉风格</span>
                        <strong>{selectedDesign ? selectedDesign.name : "自动风格"}</strong>
                      </div>
                    </div>
                    <p className="empty-copy">这里还不会生成或播放视频。确认镜头文案、时长和素材后，点击底部按钮开始渲染。</p>
                  </section>
                ) : (
                  <div className="media-stage">
                    <div className="player-aspect">
                      {latestRender?.outputUrl ? (
                        <video className="render-output-video" src={latestRender.outputUrl} controls playsInline preload="metadata" />
                      ) : (
                        <div className="render-preview-empty">
                          <p className="eyebrow">Rendering</p>
                          <h2>{workflowStep === "rendering" ? "正在生成视频" : "准备生成视频"}</h2>
                          <p>
                            {workflowStep === "rendering"
                              ? renderStatus || "渲染任务创建后，完成的视频会显示在这里。"
                              : "确认分镜无误后，点击底部按钮开始渲染。"}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <AssetList assets={assets} fallbackAssets={spec.assets.slice(0, 3)} onRemove={removeAsset} />
              </aside>
            </div>

            <section className="render-submit-bar">
              <div>
                <p className="eyebrow">Ready to render</p>
                <h2>{workflowStep === "result" ? "视频生成完成" : isRenderRoute ? "准备生成视频" : "审核完成后生成视频"}</h2>
                <p>
                  {scenes.length} 个镜头 · {assets.length} 张自定义截图 · {totalSeconds}s · 1080p
                  {selectedDesign ? ` · ${selectedDesign.name} 风格` : ""}
                </p>
              </div>
              <div className="render-submit-actions">
                {workflowStep === "rendering" || latestRender ? (
                  <div className="render-submit-progress">
                    <div className="progress-track">
                      <div className="progress-fill" style={{ width: `${progress?.percent ?? 0}%` }} />
                    </div>
                    <div className="progress-meta">
                      <span>{renderStatus || "等待生成"}</span>
                      <span>{progress ? `${progress.renderedFrames} rendered / ${progress.encodedFrames} encoded` : ""}</span>
                    </div>
                  </div>
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
                <Link
                  className={workflowStep === "rendering" ? "button secondary disabled-link" : "button secondary"}
                  href="/generate/input"
                  onClick={resetDraft}
                >
                  重新生成
                </Link>
              </div>
              {latestRender?.error ? <div className="status-box">{latestRender.error}</div> : null}
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}

function DraftCard({
  hasDraftContent,
  brief,
  assetCount,
  generatedPlan,
  latestRender,
  onReset,
}: {
  hasDraftContent: boolean;
  brief: string;
  assetCount: number;
  generatedPlan: GeneratedVideoPlan | null;
  latestRender: RenderSnapshot | null;
  onReset: () => void;
}) {
  return (
    <section className="draft-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Draft</p>
          <h2>当前草稿</h2>
        </div>
        <span className="pill">{hasDraftContent ? "已保存" : "空"}</span>
      </div>
      {hasDraftContent ? (
        <>
          <p className="draft-summary">
            {brief.trim() || generatedPlan?.brand?.tagline || "已保存一个可继续的视频方案。"}
          </p>
          <div className="record-meta">
            <span>{assetCount} 张素材</span>
            <span>{generatedPlan?.scenes?.length ?? 0} 个镜头</span>
            <span>{latestRender ? `渲染 ${latestRender.status}` : "未渲染"}</span>
          </div>
          <Link className="button" href="/generate/storyboard">
            继续编辑
          </Link>
          <button className="button secondary" type="button" onClick={onReset}>
            新建空白方案
          </button>
        </>
      ) : (
        <p className="empty-copy">填写描述并添加截图后，首页会自动保存当前浏览器的草稿。</p>
      )}
    </section>
  );
}

function BrowserRecordsList({ records }: { records: BrowserGenerationRecord[] }) {
  return (
    <section className="records-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Browser records</p>
          <h2>当前浏览器记录</h2>
        </div>
        <span className="pill">{records.length}</span>
      </div>
      {records.length > 0 ? (
        <div className="record-list">
          {records.map((record) => (
            <article className="record-row" key={record.id}>
              <div>
                <div className="record-title">{record.title}</div>
                <p>{record.brief || "没有保存描述"}</p>
                <div className="record-meta">
                  <span>{formatRecordTime(record.updatedAt)}</span>
                  <span>{record.status}</span>
                  <span>{record.assetCount} 张素材</span>
                  {record.designName ? <span>{record.designName}</span> : null}
                </div>
              </div>
              <div className="record-actions">
                {record.pageUrl ? (
                  <Link className="button secondary" href={record.pageUrl}>
                    查看
                  </Link>
                ) : null}
                {record.outputUrl ? (
                  <a className="button secondary" href={record.outputUrl} download>
                    下载
                  </a>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="empty-copy">这里会显示本浏览器创建过的渲染任务，方便回看或下载。</p>
      )}
    </section>
  );
}

function AssetList({
  assets,
  fallbackAssets,
  onRemove,
}: {
  assets: AssetSpec[];
  fallbackAssets: AssetSpec[];
  onRemove?: (assetId: string) => void;
}) {
  const visibleAssets = assets.length > 0 ? assets : fallbackAssets;
  const canRemove = assets.length > 0 && Boolean(onRemove);

  return (
    <div className="asset-list-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Screenshots</p>
          <h2>已添加素材</h2>
        </div>
        <span className="pill">{visibleAssets.length}</span>
      </div>
      <div className="asset-list">
        {visibleAssets.map((asset) => (
          <div className="asset-row" key={asset.id}>
            <Image className="asset-thumb" src={asset.src} alt={asset.alt} width={84} height={54} unoptimized />
            <div className="asset-row-content">
              <strong>{asset.originalName ?? asset.id}</strong>
              <div className="muted" style={{ fontSize: 13 }}>
                {asset.mimeType ?? asset.type} · {asset.size ? `${Math.round(asset.size / 1024)}KB · ` : ""}
                {asset.src.startsWith("data:") ? "本地临时图片（base64）" : asset.src}
              </div>
            </div>
            {canRemove ? (
              <button className="button secondary mini-button" type="button" onClick={() => onRemove?.(asset.id)}>
                删除
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function SkillPicker({
  skills,
  selectedSkillNames,
  status,
  onToggle,
}: {
  skills: SkillSummary[];
  selectedSkillNames: string[];
  status: string;
  onToggle: (skillName: string) => void;
}) {
  return (
    <section className="skill-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Agent skills</p>
          <h2>生成规则</h2>
        </div>
        <span className="pill">{selectedSkillNames.length || "Auto"}</span>
      </div>
      {skills.length > 0 ? (
        <div className="skill-chip-list">
          {skills.map((skill) => {
            const isActive = selectedSkillNames.includes(skill.name);

            return (
              <button
                className={isActive ? "skill-chip active" : "skill-chip"}
                disabled={skill.name === defaultRemotionSkillName}
                key={skill.name}
                type="button"
                onClick={() => onToggle(skill.name)}
              >
                <strong>{skill.name}</strong>
                <span>
                  {skill.source}
                  {skill.tags.length ? ` · ${skill.tags.slice(0, 3).join(", ")}` : ""}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="empty-copy">未发现 Remotion skill。你仍可先生成视频，后端会使用内置 Remotion 规则。</p>
      )}
      {status ? <div className="skill-status">{status}</div> : null}
    </section>
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
