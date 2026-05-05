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

const sceneKindSchema = z.enum(["brand", "problem", "feature", "proof", "cta"]);
const generatedVideoPlanSchema = z.object({
  brand: z
    .object({
      name: z.string().trim().min(1).max(24).optional(),
      tagline: z.string().trim().min(1).max(40).optional(),
      cta: z.string().trim().min(1).max(28).optional(),
    })
    .optional(),
  creative: z
    .object({
      stylePreset: z.enum(stylePresets).catch("product"),
      motionPreset: z.enum(motionPresets).catch("calm"),
      tone: z.enum(tonePresets).catch("professional"),
      pace: z.enum(pacePresets).catch("medium"),
      backgroundPreset: z.enum(backgroundPresets).catch("grid"),
      transitionPreset: z.enum(transitionPresets).catch("fade"),
      designId: z.string().trim().min(1).max(48).optional(),
    })
    .partial()
    .optional(),
  scenes: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(36),
        kind: sceneKindSchema.catch("feature"),
        title: z.string().trim().min(1).max(36),
        subtitle: z.string().trim().min(1).max(96),
        narration: z.string().trim().min(1).max(120).optional(),
        durationInSeconds: z.number().min(3).max(16).catch(8),
        assetId: z.string().trim().max(48).optional(),
        bullets: z.array(z.string().trim().min(1).max(12)).max(3).optional(),
        layout: z.enum(sceneLayouts).catch("split").optional(),
        visualTreatment: z.enum(visualTreatments).catch("browser").optional(),
        animation: z.enum(sceneAnimations).catch("fade").optional(),
        emphasis: z.enum(sceneEmphases).catch("balanced").optional(),
        assetBehavior: z.enum(assetBehaviors).catch("contain").optional(),
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
      designCatalog: getDesignPromptCatalog(),
      userBrief: brief,
    },
    null,
    2,
  );
};

const parseGeneratedVideoPlan = (content: string): GeneratedVideoPlan => {
  const parsed = generatedVideoPlanSchema.parse(extractJson(content));

  return {
    ...parsed,
    scenes: parsed.scenes.map((scene, index) => ({
      ...scene,
      kind: scene.kind as SceneKind,
      id: scene.id || `scene-${index + 1}`,
    })),
  };
};

export const generateCreativeVideoPlan = async ({
  brief,
  spec = defaultVideoSpec,
}: GenerateCreativeVideoPlanInput): Promise<GenerateCreativeVideoPlanResult> => {
  const config = getTextModelConfig();

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
    messages: [
      { role: "system", content: buildSystemPrompt(spec) },
      { role: "user", content: buildUserPrompt(brief, spec) },
    ],
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
    plan: parseGeneratedVideoPlan(content),
  };
};

export const generateCreativeVideoPlanStream = async ({
  brief,
  spec = defaultVideoSpec,
  onStatus,
  onToken,
}: GenerateCreativeVideoPlanStreamInput): Promise<GenerateCreativeVideoPlanResult> => {
  const config = getTextModelConfig();

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

  onStatus?.(`已连接 ${config.provider} · ${config.model}`);

  const stream = await client.chat.completions.create({
    model: config.model,
    messages: [
      { role: "system", content: buildSystemPrompt(spec) },
      { role: "user", content: buildUserPrompt(brief, spec) },
    ],
    temperature: 0.4,
    stream: true,
  });
  let content = "";

  onStatus?.("AI 正在构思镜头、风格和动效...");

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
    plan: parseGeneratedVideoPlan(content),
  };
};
