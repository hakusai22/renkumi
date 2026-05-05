import designIndex from "../data/design-library/index.json";

export type DesignLibraryEntry = {
  id: string;
  name: string;
  title: string;
  summary: string;
  keywords: string[];
  colors: string[];
  fonts: string[];
  sourceUrl: string;
  localPath: string;
};

export type DesignInspirationSpec = {
  id: string;
  name: string;
  summary: string;
  colors: string[];
  fonts: string[];
  sourceUrl: string;
};

export type DesignPalette = {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
};

const library = designIndex as {
  source: string;
  syncedAt: string;
  count: number;
  designs: DesignLibraryEntry[];
};

export const designLibrary = library.designs;

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, " ");

const domainHints: Array<{ terms: string[]; ids: string[]; weight?: number }> = [
  {
    terms: ["视频", "影像", "创意", "生成", "电影", "视觉", "短片", "设计", "creative", "video", "film"],
    ids: ["runwayml", "figma", "framer", "apple"],
  },
  {
    terms: ["ai", "agent", "智能体", "模型", "开发者", "api", "sdk", "基础设施", "developer", "infra"],
    ids: ["vercel", "linear.app", "supabase", "voltagent", "cursor", "mistral.ai", "together.ai"],
  },
  {
    terms: ["文档", "知识", "学习", "课程", "教育", "笔记", "docs", "documentation", "learning"],
    ids: ["mintlify", "notion"],
    weight: 72,
  },
  {
    terms: ["金融", "支付", "交易", "钱包", "银行", "crypto", "payment", "finance"],
    ids: ["stripe", "wise", "coinbase", "binance", "revolut"],
  },
  {
    terms: ["电商", "商品", "店铺", "零售", "marketplace", "commerce", "shop"],
    ids: ["shopify", "airbnb", "pinterest", "nike"],
  },
  {
    terms: ["汽车", "出行", "速度", "性能", "car", "auto", "mobility"],
    ids: ["bmw-m", "tesla", "ferrari", "lamborghini", "uber"],
  },
  {
    terms: ["音乐", "播客", "媒体", "杂志", "内容", "music", "media", "editorial"],
    ids: ["spotify", "wired", "theverge", "pinterest"],
  },
];

const luminance = (hex: string) => {
  const normalized = hex.replace("#", "");
  const full =
    normalized.length === 3
      ? normalized
          .split("")
          .map((char) => char + char)
          .join("")
      : normalized.slice(0, 6);
  const channels = [0, 2, 4].map((start) => parseInt(full.slice(start, start + 2), 16) / 255);
  const [r, g, b] = channels.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4),
  );

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const isNeutral = (hex: string) => {
  const full = hex.replace("#", "").slice(0, 6);
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);

  return Math.max(r, g, b) - Math.min(r, g, b) < 18;
};

const scoreDesign = (entry: DesignLibraryEntry, brief: string) => {
  const text = normalize(brief);
  const haystack = normalize([entry.id, entry.name, entry.summary, ...entry.keywords].join(" "));
  let score = 0;

  for (const token of text.split(" ").filter((part) => part.length > 1)) {
    if (haystack.includes(token)) {
      score += token.length > 3 ? 3 : 1;
    }
  }

  for (const hint of domainHints) {
    if (hint.terms.some((term) => text.includes(normalize(term).trim()))) {
      const index = hint.ids.indexOf(entry.id);

      if (index >= 0) {
        score += (hint.weight ?? 18) - index * 2;
      }
    }
  }

  if (entry.id === "linear.app") {
    score += 2;
  }

  return score;
};

export const getDesignById = (id?: string) =>
  id ? designLibrary.find((entry) => entry.id === id || entry.name.toLowerCase() === id.toLowerCase()) : undefined;

export const selectDesignForBrief = (brief: string, preferredId?: string) => {
  const preferred = getDesignById(preferredId);

  if (preferred) {
    return preferred;
  }

  return [...designLibrary].sort((a, b) => scoreDesign(b, brief) - scoreDesign(a, brief))[0] ?? designLibrary[0];
};

export const toDesignInspiration = (entry: DesignLibraryEntry): DesignInspirationSpec => ({
  id: entry.id,
  name: entry.name,
  summary: entry.summary,
  colors: entry.colors.slice(0, 10),
  fonts: entry.fonts.slice(0, 4),
  sourceUrl: entry.sourceUrl,
});

export const getDesignPalette = (entry: DesignLibraryEntry): DesignPalette => {
  const colors = entry.colors.length ? entry.colors : ["#111111", "#FFFFFF", "#E65A4F"];
  const dark = colors.find((color) => luminance(color) < 0.16) ?? "#111111";
  const light = colors.find((color) => luminance(color) > 0.86) ?? "#FFFFFF";
  const accent = colors.find((color) => !isNeutral(color) && luminance(color) > 0.08 && luminance(color) < 0.82) ?? colors[0];
  const secondary =
    colors.find((color) => color !== accent && !isNeutral(color) && luminance(color) > 0.18 && luminance(color) < 0.9) ??
    (luminance(accent) > 0.5 ? dark : light);
  const prefersDark = /dark|black|cinematic|terminal|void|night|monochrome/i.test(
    `${entry.summary} ${entry.keywords.join(" ")}`,
  );

  return {
    primaryColor: dark,
    secondaryColor: secondary,
    accentColor: accent,
    backgroundColor: prefersDark ? dark : light,
    textColor: prefersDark ? light : dark,
  };
};

export const getDesignPromptCatalog = () =>
  designLibrary.map((entry) => ({
    id: entry.id,
    name: entry.name,
    keywords: entry.keywords.slice(0, 10),
    colors: entry.colors.slice(0, 6),
    summary: entry.summary.slice(0, 220),
  }));
