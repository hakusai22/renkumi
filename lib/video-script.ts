import { getDesignPalette, selectDesignForBrief, toDesignInspiration } from "./design-library";
import {
  defaultVideoSpec,
  type AssetSpec,
  type BrandSpec,
  type CreativeSpec,
  type SceneLayout,
  type SceneSpec,
  type VideoSpec,
} from "./video-spec";

export type OptimizedSceneScript = {
  id: SceneSpec["id"];
  title: string;
  subtitle: string;
  narration?: string;
  bullets?: string[];
};

export type OptimizedVideoScript = {
  brand?: Partial<Pick<VideoSpec["brand"], "name" | "tagline" | "cta">>;
  scenes: OptimizedSceneScript[];
};

export type GeneratedVideoPlan = {
  brand?: Partial<VideoSpec["brand"]>;
  creative?: Partial<CreativeSpec> & { designId?: string };
  scenes?: SceneSpec[];
};

export const splitBrief = (brief: string) =>
  brief
    .split(/\n|。|；|;|\./)
    .map((line) => line.trim())
    .filter(Boolean);

const assetAt = (assets: AssetSpec[], index: number, fallbackId?: string) => assets[index]?.id ?? fallbackId;

const pickCreativeFromBrief = (brief: string): CreativeSpec => {
  const text = brief.toLowerCase();

  if (/活动|课程|报名|限时|促销|发布会|webinar|event/.test(text)) {
    return {
      stylePreset: "bold",
      motionPreset: "kinetic",
      tone: "urgent",
      pace: "fast",
      backgroundPreset: "bands",
      transitionPreset: "push",
    };
  }

  if (/高端|premium|奢华|品牌|咨询|金融|enterprise|b2b/.test(text)) {
    return {
      stylePreset: "editorial",
      motionPreset: "cinematic",
      tone: "premium",
      pace: "slow",
      backgroundPreset: "spotlight",
      transitionPreset: "scale",
    };
  }

  if (/app|移动|手机|小程序|社区|社交|游戏|playful/.test(text)) {
    return {
      stylePreset: "launch",
      motionPreset: "snappy",
      tone: "playful",
      pace: "fast",
      backgroundPreset: "soft",
      transitionPreset: "wipe",
    };
  }

  return {
    stylePreset: "product",
    motionPreset: "calm",
    tone: "professional",
    pace: "medium",
    backgroundPreset: "grid",
    transitionPreset: "fade",
  };
};

const layoutCycle = (creative: CreativeSpec): SceneLayout[] => {
  if (creative.stylePreset === "editorial") {
    return ["hero", "quote", "split", "showcase", "metrics", "cta"];
  }

  if (creative.stylePreset === "bold") {
    return ["hero", "cards", "showcase", "metrics", "split", "cta"];
  }

  if (creative.tone === "playful") {
    return ["hero", "showcase", "cards", "split", "metrics", "cta"];
  }

  return ["hero", "cards", "split", "showcase", "metrics", "cta"];
};

const durationsForPace = (creative: CreativeSpec) => {
  if (creative.pace === "fast") {
    return [4, 7, 9, 9, 8, 4];
  }

  if (creative.pace === "slow") {
    return [6, 11, 14, 14, 12, 6];
  }

  return [5, 9, 12, 12, 11, 5];
};

const applyDesignPalette = (brand: BrandSpec, brief: string, preferredId?: string): BrandSpec => {
  const design = selectDesignForBrief(brief, preferredId);
  const palette = getDesignPalette(design);

  return {
    ...brand,
    primaryColor: palette.primaryColor,
    secondaryColor: palette.secondaryColor,
    accentColor: palette.accentColor,
    backgroundColor: palette.backgroundColor,
    textColor: palette.textColor,
  };
};

export const getSpecAssets = (userAssets: AssetSpec[], baseSpec: VideoSpec = defaultVideoSpec) => [
  ...userAssets,
  ...baseSpec.assets,
];

export const bindSceneAssets = (scenes: SceneSpec[], assets: AssetSpec[]): SceneSpec[] =>
  scenes.map((scene, index) => {
    const selectedAsset = scene.assetId && assets.some((asset) => asset.id === scene.assetId) ? scene.assetId : undefined;

    if (index === 0 || index === scenes.length - 1) {
      return {
        ...scene,
        assetId: selectedAsset ?? assetAt(assets, 0, scene.assetId),
      };
    }

    return {
      ...scene,
      assetId: selectedAsset ?? assetAt(assets, index - 1, scene.assetId ?? assetAt(assets, 0)),
    };
  });

export const buildSpecFromBrief = (
  brief: string,
  userAssets: AssetSpec[],
  baseSpec: VideoSpec = defaultVideoSpec,
): VideoSpec => {
  const lines = splitBrief(brief);
  const fallback = baseSpec.scenes;
  const assets = getSpecAssets(userAssets, baseSpec);
  const creative = pickCreativeFromBrief(brief);
  const design = selectDesignForBrief(brief);
  const layouts = layoutCycle(creative);
  const durations = durationsForPace(creative);

  const scenes: SceneSpec[] = [
    {
      ...fallback[0],
      title: lines[0] ?? baseSpec.brand.name,
      subtitle: lines[1] ?? baseSpec.brand.tagline,
      narration: lines[1] ?? fallback[0].narration,
      durationInSeconds: durations[0],
      assetId: assetAt(assets, 0, "hero"),
      layout: layouts[0],
      visualTreatment: creative.tone === "playful" ? "device" : "spotlight",
      animation: creative.motionPreset === "kinetic" ? "zoom" : "spotlight",
      emphasis: "headline",
      assetBehavior: "cover",
    },
    {
      ...fallback[1],
      title: lines[2] ?? "先用文字讲清楚卖点",
      subtitle: lines[3] ?? "把产品定位、用户痛点、核心能力和行动号召写进一个输入框。",
      narration: lines[3] ?? fallback[1].narration,
      durationInSeconds: durations[1],
      assetId: assetAt(assets, 0),
      bullets: ["文字输入", "自动分镜", "节奏统一"],
      layout: layouts[1],
      visualTreatment: "plain",
      animation: creative.motionPreset === "cinematic" ? "fade" : "slide",
      emphasis: "bullets",
      assetBehavior: "none",
    },
    {
      ...fallback[2],
      title: lines[4] ?? "再用截图证明产品真实存在",
      subtitle: lines[5] ?? "上传自己的界面截图，系统会把截图包装进宣传片镜头。",
      narration: lines[5] ?? fallback[2].narration,
      durationInSeconds: durations[2],
      assetId: assetAt(assets, 1, assetAt(assets, 0, "workflow")),
      bullets: ["多图上传", "截图优先", "真实可信"],
      layout: layouts[2],
      visualTreatment: "browser",
      animation: creative.motionPreset === "calm" ? "parallax" : "zoom",
      emphasis: "asset",
      assetBehavior: "contain",
    },
    {
      ...fallback[3],
      title: lines[6] ?? "Remotion 负责合成视频",
      subtitle: lines[7] ?? "标题、副标题、截图、动效和导出规格都由同一份 videoSpec 驱动。",
      narration: lines[7] ?? fallback[3].narration,
      durationInSeconds: durations[3],
      assetId: assetAt(assets, 2, assetAt(assets, 0, "results")),
      bullets: ["1080p", "可复用", "可扩展"],
      layout: layouts[3],
      visualTreatment: "floating",
      animation: creative.motionPreset === "kinetic" ? "stack" : "parallax",
      emphasis: "balanced",
      assetBehavior: "pan",
    },
    {
      ...fallback[4],
      title: lines[8] ?? "Image 只是可选增强",
      subtitle: lines[9] ?? "有 Key 时再优化图片、扩展背景或生成 hero 视觉；没有 Key 也能完整生成视频。",
      narration: lines[9] ?? fallback[4].narration,
      durationInSeconds: durations[4],
      assetId: assetAt(assets, 3, assetAt(assets, 1, "results")),
      bullets: ["优化截图", "扩展背景", "不阻塞主流程"],
      layout: layouts[4],
      visualTreatment: "stack",
      animation: "stack",
      emphasis: "bullets",
      assetBehavior: "contain",
    },
    {
      ...fallback[5],
      title: baseSpec.brand.name,
      subtitle: lines[10] ?? baseSpec.brand.cta,
      narration: lines[10] ?? fallback[5].narration,
      durationInSeconds: durations[5],
      assetId: assetAt(assets, 0, "results"),
      layout: layouts[5],
      visualTreatment: "spotlight",
      animation: "fade",
      emphasis: "headline",
      assetBehavior: "cover",
    },
  ];

  return {
    ...baseSpec,
    brand: applyDesignPalette(baseSpec.brand, brief, design.id),
    creative: {
      ...creative,
      design: toDesignInspiration(design),
    },
    assets,
    scenes,
  };
};

export const buildSpecFromOptimizedScript = (
  script: OptimizedVideoScript,
  userAssets: AssetSpec[],
  baseSpec: VideoSpec = defaultVideoSpec,
): VideoSpec => {
  const assets = getSpecAssets(userAssets, baseSpec);
  const scriptById = new Map(script.scenes.map((scene) => [scene.id, scene]));
  const scenes = bindSceneAssets(
    baseSpec.scenes.map((scene) => {
      const optimized = scriptById.get(scene.id);

      if (!optimized) {
        return scene;
      }

      return {
        ...scene,
        title: optimized.title || scene.title,
        subtitle: optimized.subtitle || scene.subtitle,
        narration: optimized.narration || optimized.subtitle || scene.narration,
        bullets: optimized.bullets?.length ? optimized.bullets.slice(0, 3) : scene.bullets,
      };
    }),
    assets,
  );

  return {
    ...baseSpec,
    brand: {
      ...baseSpec.brand,
      ...script.brand,
      name: script.brand?.name?.trim() || baseSpec.brand.name,
      tagline: script.brand?.tagline?.trim() || baseSpec.brand.tagline,
      cta: script.brand?.cta?.trim() || baseSpec.brand.cta,
    },
    assets,
    scenes,
  };
};

export const buildSpecFromGeneratedPlan = (
  plan: GeneratedVideoPlan,
  userAssets: AssetSpec[],
  baseSpec: VideoSpec = defaultVideoSpec,
): VideoSpec => {
  const assets = getSpecAssets(userAssets, baseSpec);
  const plannedScenes = plan.scenes?.length ? plan.scenes : baseSpec.scenes;
  const selectionText = [
    plan.brand?.name,
    plan.brand?.tagline,
    plan.brand?.cta,
    ...(plannedScenes ?? []).flatMap((scene) => [scene.title, scene.subtitle, scene.narration, ...(scene.bullets ?? [])]),
  ]
    .filter(Boolean)
    .join(" ");
  const design = selectDesignForBrief(selectionText, plan.creative?.design?.id ?? plan.creative?.designId);
  const scenes = bindSceneAssets(
    plannedScenes.map((scene, index) => ({
      ...baseSpec.scenes[index % baseSpec.scenes.length],
      ...scene,
      id: scene.id || `scene-${index + 1}`,
      durationInSeconds: Math.max(3, Math.min(16, scene.durationInSeconds || 8)),
      bullets: scene.bullets?.slice(0, 3),
    })),
    assets,
  );

  return {
    ...baseSpec,
    brand: applyDesignPalette(
      {
        ...baseSpec.brand,
        ...plan.brand,
        name: plan.brand?.name?.trim() || baseSpec.brand.name,
        tagline: plan.brand?.tagline?.trim() || baseSpec.brand.tagline,
        cta: plan.brand?.cta?.trim() || baseSpec.brand.cta,
      },
      selectionText,
      design.id,
    ),
    creative: {
      ...baseSpec.creative!,
      ...plan.creative,
      design: toDesignInspiration(design),
    },
    assets,
    scenes,
  };
};

export const optimizedScriptToBrief = (script: OptimizedVideoScript) =>
  script.scenes
    .flatMap((scene) => [scene.title, scene.subtitle])
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
