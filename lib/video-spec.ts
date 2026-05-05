import type { DesignInspirationSpec } from "./design-library";

export type BrandSpec = {
  name: string;
  tagline: string;
  logoSrc?: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  logoText: string;
  cta: string;
};

export type SceneKind = "brand" | "problem" | "feature" | "proof" | "cta";
export const sceneLayouts = ["hero", "split", "showcase", "cards", "quote", "metrics", "cta"] as const;
export const visualTreatments = ["browser", "device", "floating", "stack", "spotlight", "plain"] as const;
export const sceneAnimations = ["fade", "slide", "zoom", "parallax", "stack", "spotlight"] as const;
export const sceneEmphases = ["headline", "asset", "bullets", "balanced"] as const;
export const assetBehaviors = ["cover", "contain", "pan", "zoom", "none"] as const;
export const stylePresets = ["product", "editorial", "launch", "minimal", "bold"] as const;
export const motionPresets = ["calm", "snappy", "cinematic", "kinetic"] as const;
export const tonePresets = ["professional", "playful", "premium", "urgent", "warm"] as const;
export const pacePresets = ["slow", "medium", "fast"] as const;
export const backgroundPresets = ["grid", "soft", "spotlight", "bands", "solid"] as const;
export const transitionPresets = ["fade", "wipe", "push", "scale"] as const;

export type SceneLayout = (typeof sceneLayouts)[number];
export type VisualTreatment = (typeof visualTreatments)[number];
export type SceneAnimation = (typeof sceneAnimations)[number];
export type SceneEmphasis = (typeof sceneEmphases)[number];
export type AssetBehavior = (typeof assetBehaviors)[number];
export type StylePreset = (typeof stylePresets)[number];
export type MotionPreset = (typeof motionPresets)[number];
export type TonePreset = (typeof tonePresets)[number];
export type PacePreset = (typeof pacePresets)[number];
export type BackgroundPreset = (typeof backgroundPresets)[number];
export type TransitionPreset = (typeof transitionPresets)[number];

export type CreativeSpec = {
  stylePreset: StylePreset;
  motionPreset: MotionPreset;
  tone: TonePreset;
  pace: PacePreset;
  backgroundPreset: BackgroundPreset;
  transitionPreset: TransitionPreset;
  design?: DesignInspirationSpec;
};

export type SceneSpec = {
  id: string;
  kind: SceneKind;
  title: string;
  subtitle: string;
  narration?: string;
  durationInSeconds: number;
  assetId?: string;
  bullets?: string[];
  layout?: SceneLayout;
  visualTreatment?: VisualTreatment;
  animation?: SceneAnimation;
  emphasis?: SceneEmphasis;
  assetBehavior?: AssetBehavior;
};

export type AssetSpec = {
  id: string;
  type: "generated" | "screenshot" | "background" | "video";
  src: string;
  alt: string;
};

export type OutputSpec = {
  width: number;
  height: number;
  fps: number;
};

export type VideoSpec = {
  brand: BrandSpec;
  scenes: SceneSpec[];
  assets: AssetSpec[];
  output: OutputSpec;
  creative?: CreativeSpec;
};

export const defaultVideoSpec: VideoSpec = {
  brand: {
    name: "LaunchCut",
    tagline: "把产品文案和截图，快速合成为发布视频",
    logoSrc: "/icon-512x512.png",
    primaryColor: "#103D4A",
    secondaryColor: "#F4C95D",
    accentColor: "#E65A4F",
    backgroundColor: "#F7F4EC",
    textColor: "#142326",
    logoText: "LC",
    cta: "生成发布视频",
  },
  output: {
    width: 1920,
    height: 1080,
    fps: 30,
  },
  creative: {
    stylePreset: "product",
    motionPreset: "calm",
    tone: "professional",
    pace: "medium",
    backgroundPreset: "grid",
    transitionPreset: "fade",
  },
  assets: [
    {
      id: "hero",
      type: "background",
      src: "/assets/launchcut-hero.svg",
      alt: "LaunchCut campaign workspace",
    },
    {
      id: "workflow",
      type: "screenshot",
      src: "/assets/launchcut-workflow.svg",
      alt: "LaunchCut workflow screenshot",
    },
    {
      id: "results",
      type: "screenshot",
      src: "/assets/launchcut-results.svg",
      alt: "LaunchCut results dashboard",
    },
  ],
  scenes: [
    {
      id: "intro",
      kind: "brand",
      title: "LaunchCut",
      subtitle: "用文字脚本和产品截图生成宣传视频",
      narration: "让每一次产品发布，都能从真实截图和清晰文案开始生成视频。",
      durationInSeconds: 5,
      assetId: "hero",
      layout: "hero",
      visualTreatment: "spotlight",
      animation: "spotlight",
      emphasis: "headline",
      assetBehavior: "cover",
    },
    {
      id: "problem",
      kind: "problem",
      title: "宣传视频不该每次从零开始",
      subtitle: "文字、截图、图片、卖点和渠道规格分散，导致交付慢、风格不稳、复用困难。",
      narration: "团队常常有产品，却没有稳定产出宣传视频的系统。",
      durationInSeconds: 10,
      bullets: ["脚本反复改", "素材风格散", "多渠道版本难维护"],
      layout: "cards",
      visualTreatment: "plain",
      animation: "slide",
      emphasis: "bullets",
      assetBehavior: "none",
    },
    {
      id: "feature-script",
      kind: "feature",
      title: "先定义脚本，再驱动画面",
      subtitle: "用 videoSpec 管理品牌、镜头、文案、素材和输出规格。",
      narration: "LaunchCut 把宣传片拆成可配置的数据，而不是一次性的剪辑文件。",
      durationInSeconds: 15,
      assetId: "workflow",
      bullets: ["镜头结构固定", "文案一处维护", "版本自动生成"],
      layout: "split",
      visualTreatment: "browser",
      animation: "parallax",
      emphasis: "asset",
      assetBehavior: "contain",
    },
    {
      id: "feature-assets",
      kind: "feature",
      title: "上传自己的截图，绑定到每个镜头",
      subtitle: "产品画面来自真实截图，标题、副标题和节奏由文字配置驱动。",
      narration: "截图负责可信度，文字负责叙事，Remotion 负责把它们合成为视频。",
      durationInSeconds: 15,
      assetId: "hero",
      bullets: ["上传截图", "镜头绑定", "自动合成"],
      layout: "showcase",
      visualTreatment: "floating",
      animation: "zoom",
      emphasis: "balanced",
      assetBehavior: "pan",
    },
    {
      id: "proof",
      kind: "proof",
      title: "一次配置，多次输出",
      subtitle: "官网横版、社媒竖版、销售演示，都能基于同一套脚本扩展。",
      narration: "LaunchCut 的价值不是做一条视频，而是建立长期可复用的推广生产线。",
      durationInSeconds: 15,
      assetId: "results",
      bullets: ["1080p 横版", "预留 9:16", "可持续迭代"],
      layout: "metrics",
      visualTreatment: "stack",
      animation: "stack",
      emphasis: "bullets",
      assetBehavior: "contain",
    },
    {
      id: "cta",
      kind: "cta",
      title: "LaunchCut",
      subtitle: "从产品卖点到宣传视频，让发布更快发生。",
      narration: "用 LaunchCut，把推广内容变成工程化能力。",
      durationInSeconds: 5,
      assetId: "results",
      layout: "cta",
      visualTreatment: "spotlight",
      animation: "fade",
      emphasis: "headline",
      assetBehavior: "cover",
    },
  ],
};

export const getCreativeSpec = (spec: VideoSpec): CreativeSpec => ({
  ...defaultVideoSpec.creative!,
  ...spec.creative,
});

export const getTotalDurationInFrames = (spec: VideoSpec) =>
  spec.scenes.reduce((total, scene) => total + scene.durationInSeconds * spec.output.fps, 0);

export const getSceneStartFrame = (spec: VideoSpec, sceneIndex: number) =>
  spec.scenes
    .slice(0, sceneIndex)
    .reduce((total, scene) => total + scene.durationInSeconds * spec.output.fps, 0);

export const getAssetById = (spec: VideoSpec, assetId?: string) =>
  spec.assets.find((asset) => asset.id === assetId);
