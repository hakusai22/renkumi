import { promises as fs } from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import { z } from "zod";
import { getDesignPromptCatalog } from "./design-library";
import {
  assetBehaviors,
  backgroundPresets,
  defaultVideoSpec,
  motionPresets,
  pacePresets,
  sceneAnimations,
  sceneEmphases,
  sceneLayouts,
  stylePresets,
  tonePresets,
  transitionPresets,
  visualTreatments,
  type SceneKind,
  type AssetSpec,
  type VideoSpec,
} from "./video-spec";
import type { GeneratedVideoPlan } from "./video-script";

type AiModelConfig = {
  provider: string;
  apiKey: string;
  baseURL?: string;
  model: string;
};

type GenerateCreativeVideoPlanInput = {
  brief: string;
  spec?: VideoSpec;
};

type GenerateCreativeVideoPlanStreamInput = GenerateCreativeVideoPlanInput & {
  onStatus?: (message: string) => void;
  onToken?: (token: string) => void;
};

type VisionInput = {
  asset: AssetSpec;
  dataUrl: string;
};

type GenerateCreativeVideoPlanResult =
  | {
      skipped: true;
      reason: string;
      message: string;
    }
  | {
      skipped: false;
      provider: string;
      model: string;
      plan: GeneratedVideoPlan;
    };

const nullToUndefined = (value: unknown) => (value === null ? undefined : value);

const optionalText = (max: number, min = 1) =>
  z.preprocess(nullToUndefined, z.string().trim().min(min).max(max).optional());

const durationSchema = z.preprocess(
  (value) => {
    if (value === null || value === undefined) {
      return undefined;
    }

    return typeof value === "string" ? Number(value) : value;
  },
  z.number().min(3).max(16).catch(8),
);

const sceneAnimationSchema = z.preprocess(
  (value) => {
    if (value === null || value === undefined) {
      return undefined;
    }

    return value === "scale" ? "zoom" : value;
  },
  z.enum(sceneAnimations).catch("fade").optional(),
);

const sceneKindSchema = z.enum(["brand", "problem", "feature", "proof", "cta"]);
const generatedVideoPlanSchema = z.object({
  brand: z.preprocess(
    nullToUndefined,
    z
      .object({
        name: optionalText(24),
        tagline: optionalText(40),
        cta: optionalText(28),
      })
      .optional(),
  ),
  creative: z.preprocess(
    nullToUndefined,
    z
      .object({
        stylePreset: z.preprocess(nullToUndefined, z.enum(stylePresets).catch("product").optional()),
        motionPreset: z.preprocess(nullToUndefined, z.enum(motionPresets).catch("calm").optional()),
        tone: z.preprocess(nullToUndefined, z.enum(tonePresets).catch("professional").optional()),
        pace: z.preprocess(nullToUndefined, z.enum(pacePresets).catch("medium").optional()),
        backgroundPreset: z.preprocess(nullToUndefined, z.enum(backgroundPresets).catch("grid").optional()),
        transitionPreset: z.preprocess(nullToUndefined, z.enum(transitionPresets).catch("fade").optional()),
        designId: optionalText(48),
      })
      .optional(),
  ),
  scenes: z
    .array(
      z.object({
        id: z.preprocess(nullToUndefined, z.string().trim().min(1).max(36).catch("")),
        kind: sceneKindSchema.catch("feature"),
        title: z.preprocess(nullToUndefined, z.string().trim().min(1).max(36).catch("产品亮点")),
        subtitle: z.preprocess(nullToUndefined, z.string().trim().min(1).max(96).catch("根据输入生成的视频镜头说明")),
        narration: optionalText(120),
        durationInSeconds: durationSchema,
        assetId: optionalText(48, 0),
        bullets: z.preprocess(
          nullToUndefined,
          z.array(z.preprocess(nullToUndefined, z.string().trim().min(1).max(12).catch(""))).max(3).optional(),
        ),
        layout: z.preprocess(nullToUndefined, z.enum(sceneLayouts).catch("split").optional()),
        visualTreatment: z.preprocess(nullToUndefined, z.enum(visualTreatments).catch("browser").optional()),
        animation: sceneAnimationSchema,
        emphasis: z.preprocess(nullToUndefined, z.enum(sceneEmphases).catch("balanced").optional()),
        assetBehavior: z.preprocess(nullToUndefined, z.enum(assetBehaviors).catch("contain").optional()),
      }),
    )
    .min(4)
    .max(7),
});

const getTextModelConfig = (): AiModelConfig | null => {
  const candidates: Array<AiModelConfig | null> = [
    process.env.OPENAI_API_KEY
      ? {
          provider: "OpenAI",
          apiKey: process.env.OPENAI_API_KEY,
          baseURL: process.env.OPENAI_BASE_URL || undefined,
          model: process.env.OPENAI_TEXT_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini",
        }
      : null,
    process.env.DASHSCOPE_API_KEY
      ? {
          provider: "DashScope",
          apiKey: process.env.DASHSCOPE_API_KEY,
          baseURL: process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1",
          model: process.env.DASHSCOPE_MODEL || "qwen-plus",
        }
      : null,
    process.env.ZHIPU_API_KEY
      ? {
          provider: "Zhipu",
          apiKey: process.env.ZHIPU_API_KEY,
          baseURL: process.env.ZHIPU_BASE_URL || "https://open.bigmodel.cn/api/paas/v4",
          model: process.env.ZHIPU_MODEL || "glm-4-flash",
        }
      : null,
    process.env.MIMO_API_KEY
      ? {
          provider: "Mimo",
          apiKey: process.env.MIMO_API_KEY,
          baseURL: process.env.MIMO_BASE_URL || "https://token-plan-cn.xiaomimimo.com/v1",
          model: process.env.MIMO_MODEL || "mimo-v2.5-pro",
        }
      : null,
  ];

  return candidates.find(Boolean) ?? null;
};

const getVisionModelConfig = (): AiModelConfig | null => {
  const candidates: Array<AiModelConfig | null> = [
    process.env.OPENAI_API_KEY
      ? {
          provider: "OpenAI",
          apiKey: process.env.OPENAI_API_KEY,
          baseURL: process.env.OPENAI_BASE_URL || undefined,
          model:
            process.env.OPENAI_VISION_MODEL ||
            process.env.OPENAI_TEXT_MODEL ||
            process.env.OPENAI_MODEL ||
            "gpt-4.1-mini",
        }
      : null,
    process.env.DASHSCOPE_API_KEY && process.env.DASHSCOPE_VISION_MODEL
      ? {
          provider: "DashScope",
          apiKey: process.env.DASHSCOPE_API_KEY,
          baseURL: process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1",
          model: process.env.DASHSCOPE_VISION_MODEL,
        }
      : null,
  ];

  return candidates.find(Boolean) ?? null;
};

const isVisionAsset = (asset: AssetSpec) =>
  asset.type === "screenshot" &&
  (asset.src.startsWith("/assets/uploads/") || asset.src.startsWith("data:image/")) &&
  asset.mimeType !== "image/svg+xml" &&
  (asset.src.startsWith("data:image/") || /\.(png|jpe?g|webp)$/i.test(asset.src));

const loadVisionInputs = async (assets: AssetSpec[], onStatus?: (message: string) => void): Promise<VisionInput[]> => {
  const maxVisionBytes = 6 * 1024 * 1024;
  const candidates = assets.filter(isVisionAsset).slice(0, 4);
  const inputs: VisionInput[] = [];

  if (candidates.length > 0) {
    onStatus?.(`正在读取 ${candidates.length} 张本地图片...`);
  }

  for (const asset of candidates) {
    if (asset.src.startsWith("data:image/")) {
      const base64 = asset.src.split(",", 2)[1] ?? "";
      const byteLength = Math.ceil((base64.length * 3) / 4);

      if (!base64 || byteLength > maxVisionBytes) {
        onStatus?.(`${asset.originalName ?? asset.alt} 太大或无法读取，已作为素材保留但跳过识图。`);
        continue;
      }

      inputs.push({
        asset,
        dataUrl: asset.src,
      });
      continue;
    }

    const relativePath = asset.src.replace(/^\/+/, "");
    const filePath = path.join(process.cwd(), "public", relativePath);
    const stat = await fs.stat(filePath).catch(() => null);

    if (!stat || stat.size > maxVisionBytes) {
      onStatus?.(`${asset.originalName ?? asset.alt} 太大或无法读取，已作为素材保留但跳过识图。`);
      continue;
    }

    const bytes = await fs.readFile(filePath);
    const mimeType = asset.mimeType || (asset.src.endsWith(".webp") ? "image/webp" : "image/png");
    inputs.push({
      asset,
      dataUrl: `data:${mimeType};base64,${bytes.toString("base64")}`,
    });
  }

  return inputs;
};

const extractJson = (content: string) => {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const source = fenced ?? content;
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("AI response did not contain JSON.");
  }

  return JSON.parse(source.slice(start, end + 1)) as unknown;
};

const buildSystemPrompt = (spec: VideoSpec) => `你是 LaunchCut 的 AI 视频创意导演。
你要把用户的原始输入转化成 Remotion 可渲染的结构化视频创意方案。
你不能生成代码，只能从给定白名单中选择布局、动效、风格和节奏。
只返回 JSON，不要 Markdown，不要解释。

输出格式：
{
  "brand": { "name": "品牌名", "tagline": "一句定位", "cta": "行动号召" },
  "creative": {
    "designId": "从 designCatalog 中选择的 id",
    "stylePreset": "product | editorial | launch | minimal | bold",
    "motionPreset": "calm | snappy | cinematic | kinetic",
    "tone": "professional | playful | premium | urgent | warm",
    "pace": "slow | medium | fast",
    "backgroundPreset": "grid | soft | spotlight | bands | solid",
    "transitionPreset": "fade | wipe | push | scale"
  },
  "scenes": [
    {
      "id": "scene-1",
      "kind": "brand | problem | feature | proof | cta",
      "title": "屏幕大字",
      "subtitle": "镜头说明",
      "narration": "旁白",
      "durationInSeconds": 3-16,
      "assetId": "可选素材 id",
      "bullets": ["短词", "短词", "短词"],
      "layout": "hero | split | showcase | cards | quote | metrics | cta",
      "visualTreatment": "browser | device | floating | stack | spotlight | plain",
      "animation": "fade | slide | zoom | parallax | stack | spotlight",
      "emphasis": "headline | asset | bullets | balanced",
      "assetBehavior": "cover | contain | pan | zoom | none"
    }
  ]
}

硬性要求：
- 生成 4-7 个镜头，第一镜头通常是 brand/hero，最后一镜头必须适合 cta。
- 必须从用户输入和 designCatalog 中选择最匹配的一套设计语言，写入 creative.designId。
- 不要默认选择 LaunchCut、Airbnb 或 Vercel；只有用户语境匹配时才选。
- 根据用户描述大胆选择不同 layout、visualTreatment、animation、backgroundPreset，不要每次都像同一个模板。
- 每个 layout 和 animation 必须来自白名单，不能自造值。
- 可选字段没有值时请省略，不要返回 null。
- animation 不允许使用 scale；需要缩放效果时使用 zoom。
- 标题适合屏幕大字，尽量 6-16 个中文字符。
- 副标题适合 Remotion 镜头说明，尽量 18-42 个中文字符。
- bullets 每条不超过 6 个中文字符，最多 3 条。
- 不要虚构用户没有表达的功能、数据、客户或奖项。
- 如果用户没有提供品牌名，使用当前品牌名：${spec.brand.name}。
- 文案要直接可用于视频标题、副标题和旁白。`;

const buildUserPrompt = (brief: string, spec: VideoSpec) => {
  const sceneSummary = spec.scenes.map((scene) => ({
    id: scene.id,
    kind: scene.kind,
    durationInSeconds: scene.durationInSeconds,
    currentTitle: scene.title,
  }));
  const assetSummary = spec.assets.map((asset) => ({
    id: asset.id,
    type: asset.type,
    alt: asset.alt,
  }));

  return JSON.stringify(
    {
      currentBrand: spec.brand,
      currentCreative: spec.creative,
      currentScenes: sceneSummary,
      availableAssets: assetSummary,
      uploadedImageGuidance:
        "If image inputs are attached, inspect them for product type, visible UI structure, dominant colors, content density, and credible feature evidence. Bind scene assetId values to uploaded asset ids when useful.",
      designCatalog: getDesignPromptCatalog({
        brief,
        preferredId: spec.creative?.design?.id,
        limit: 5,
      }),
      userBrief: brief,
    },
    null,
    2,
  );
};

const buildMessages = (brief: string, spec: VideoSpec, visionInputs: VisionInput[]) => {
  const prompt = buildUserPrompt(brief, spec);

  if (visionInputs.length === 0) {
    return [
      { role: "system" as const, content: buildSystemPrompt(spec) },
      { role: "user" as const, content: prompt },
    ];
  }

  return [
    { role: "system" as const, content: buildSystemPrompt(spec) },
    {
      role: "user" as const,
      content: [
        { type: "text", text: `${prompt}\n\n下面附带用户上传的产品截图，请先识别图片内容，再生成方案。` },
        ...visionInputs.map((input) => ({
          type: "image_url",
          image_url: {
            url: input.dataUrl,
            detail: "low",
          },
        })),
      ],
    },
  ];
};

const parseGeneratedVideoPlan = (content: string): GeneratedVideoPlan => {
  const parsed = generatedVideoPlanSchema.parse(extractJson(content));

  return {
    ...parsed,
    scenes: parsed.scenes.map((scene, index) => ({
      ...scene,
      kind: scene.kind as SceneKind,
      id: scene.id || `scene-${index + 1}`,
      assetId: scene.assetId || undefined,
      narration: scene.narration || undefined,
      bullets: scene.bullets?.filter(Boolean).slice(0, 3),
    })),
  };
};

const planFromSpec = (spec: VideoSpec): GeneratedVideoPlan => ({
  brand: spec.brand,
  creative: spec.creative,
  scenes: spec.scenes,
});

const parseGeneratedVideoPlanOrFallback = (
  content: string,
  spec: VideoSpec,
  onStatus?: (message: string) => void,
): GeneratedVideoPlan => {
  try {
    return parseGeneratedVideoPlan(content);
  } catch {
    onStatus?.("AI 返回格式不完整，已切换为本地可编辑视频方案。");
    return planFromSpec(spec);
  }
};

export const generateCreativeVideoPlan = async ({
  brief,
  spec = defaultVideoSpec,
}: GenerateCreativeVideoPlanInput): Promise<GenerateCreativeVideoPlanResult> => {
  const visionInputs = await loadVisionInputs(spec.assets);
  const config = visionInputs.length > 0 ? getVisionModelConfig() ?? getTextModelConfig() : getTextModelConfig();

  if (!config) {
    return {
      skipped: true,
      reason: "No compatible text model is configured.",
      message: "未在 .env 中配置可用的文本模型 Key，已使用本地规则生成动态视频方案。",
    };
  }

  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });

  const completion = await client.chat.completions.create({
    model: config.model,
    messages: buildMessages(brief, spec, visionInputs) as Parameters<typeof client.chat.completions.create>[0]["messages"],
    temperature: 0.4,
  });
  const content = completion.choices[0]?.message?.content;

  if (!content) {
    throw new Error("AI response was empty.");
  }

  return {
    skipped: false,
    provider: config.provider,
    model: config.model,
    plan: parseGeneratedVideoPlanOrFallback(content, spec),
  };
};

export const generateCreativeVideoPlanStream = async ({
  brief,
  spec = defaultVideoSpec,
  onStatus,
  onToken,
}: GenerateCreativeVideoPlanStreamInput): Promise<GenerateCreativeVideoPlanResult> => {
  const visionInputs = await loadVisionInputs(spec.assets, onStatus);
  const visionConfig = visionInputs.length > 0 ? getVisionModelConfig() : null;
  const config = visionConfig ?? getTextModelConfig();

  if (!config) {
    return {
      skipped: true,
      reason: "No compatible text model is configured.",
      message: "未在 .env 中配置可用的文本模型 Key，已使用本地规则生成动态视频方案。",
    };
  }

  if (visionInputs.length > 0 && visionConfig) {
    onStatus?.(`正在识别 ${visionInputs.length} 张图片，并结合用户描述生成方案...`);
  } else if (spec.assets.some(isVisionAsset)) {
    onStatus?.("未配置可用视觉模型，仅基于描述和素材名生成方案。");
  }

  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });

  onStatus?.(`已连接 ${config.provider} · ${config.model}`);

  const stream = await client.chat.completions.create({
    model: config.model,
    messages: buildMessages(brief, spec, visionConfig ? visionInputs : []) as Parameters<
      typeof client.chat.completions.create
    >[0]["messages"],
    temperature: 0.4,
    stream: true,
  });
  let content = "";

  onStatus?.("AI 正在选择设计风格、拆分镜头和规划动效...");

  for await (const chunk of stream) {
    const token = chunk.choices[0]?.delta?.content ?? "";

    if (!token) {
      continue;
    }

    content += token;
    onToken?.(token);
  }

  if (!content) {
    throw new Error("AI response was empty.");
  }

  onStatus?.("正在校验并套用 Remotion 安全预设...");

  return {
    skipped: false,
    provider: config.provider,
    model: config.model,
    plan: parseGeneratedVideoPlanOrFallback(content, spec, onStatus),
  };
};
