import { promises as fs } from "node:fs";
import path from "node:path";

type GitHubContentItem = {
  name: string;
  type: "dir" | "file";
};

type DesignLibraryEntry = {
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

const repoOwner = "VoltAgent";
const repoName = "awesome-design-md";
const branch = "main";
const rootDir = path.join(process.cwd(), "data", "design-library");
const indexPath = path.join(rootDir, "index.json");

const titleCase = (slug: string) =>
  slug
    .split(/[-.]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const unique = <T>(items: T[]) => Array.from(new Set(items));

const stripMarkdown = (value: string) =>
  value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#>*_]/g, "")
    .trim();

const firstParagraphAfterHeading = (markdown: string, heading: string) => {
  const index = markdown.indexOf(heading);

  if (index === -1) {
    return "";
  }

  const rest = markdown.slice(index + heading.length);
  const paragraphs = rest
    .split(/\n\s*\n/)
    .map((paragraph) => stripMarkdown(paragraph.replace(/\n/g, " ")))
    .filter((paragraph) => paragraph && !paragraph.startsWith("-") && !paragraph.startsWith("|"));

  return paragraphs[0] ?? "";
};

const extractListAfterHeading = (markdown: string, heading: string, limit: number) => {
  const index = markdown.indexOf(heading);

  if (index === -1) {
    return [];
  }

  return markdown
    .slice(index + heading.length)
    .split("\n")
    .filter((line) => line.trim().startsWith("-"))
    .map((line) => stripMarkdown(line.replace(/^-\s*/, "")))
    .filter(Boolean)
    .slice(0, limit);
};

const extractFonts = (markdown: string) =>
  unique(
    Array.from(markdown.matchAll(/\*\*([^*]*(?:Font|Sans|Mono|Serif|Typeface|Typography)[^*]*)\*\*/gi))
      .map((match) => stripMarkdown(match[1]))
      .filter((font) => font.length <= 48),
  ).slice(0, 8);

const extractKeywords = (markdown: string, slug: string) => {
  const text = markdown.toLowerCase();
  const categories = [
    "ai",
    "developer",
    "dashboard",
    "saas",
    "product",
    "editorial",
    "cinematic",
    "minimal",
    "dark",
    "premium",
    "finance",
    "commerce",
    "media",
    "automotive",
    "consumer",
    "creative",
    "documentation",
    "terminal",
    "analytics",
    "mobile",
  ];

  return unique([
    ...slug.split(/[-.]/),
    ...categories.filter((keyword) => text.includes(keyword)),
  ]).slice(0, 16);
};

const buildEntry = (slug: string, markdown: string): DesignLibraryEntry => {
  const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? `Design System Inspired by ${titleCase(slug)}`;
  const name = title.replace(/^Design System Inspired by\s+/i, "").trim() || titleCase(slug);
  const atmosphere = firstParagraphAfterHeading(markdown, "## 1. Visual Theme & Atmosphere");
  const keyCharacteristics = extractListAfterHeading(markdown, "**Key Characteristics:**", 8);
  const colors = unique(Array.from(markdown.matchAll(/#[0-9a-fA-F]{3,8}\b/g)).map((match) => match[0].toUpperCase())).slice(0, 18);
  const summary = [atmosphere, ...keyCharacteristics]
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, 700);

  return {
    id: slug,
    name,
    title,
    summary,
    keywords: extractKeywords(markdown, slug),
    colors,
    fonts: extractFonts(markdown),
    sourceUrl: `https://github.com/${repoOwner}/${repoName}/tree/${branch}/design-md/${slug}`,
    localPath: `data/design-library/${slug}/DESIGN.md`,
  };
};

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "launchcut-design-library-sync",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { "User-Agent": "launchcut-design-library-sync" },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

async function main() {
  const contentsUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/design-md?ref=${branch}`;
  const items = await fetchJson<GitHubContentItem[]>(contentsUrl);
  const slugs = items.filter((item) => item.type === "dir").map((item) => item.name).sort();
  const entries: DesignLibraryEntry[] = [];

  await fs.mkdir(rootDir, { recursive: true });

  for (const slug of slugs) {
    const markdownUrl = `https://raw.githubusercontent.com/${repoOwner}/${repoName}/${branch}/design-md/${slug}/DESIGN.md`;
    const markdown = await fetchText(markdownUrl);
    const designDir = path.join(rootDir, slug);

    await fs.mkdir(designDir, { recursive: true });
    await fs.writeFile(path.join(designDir, "DESIGN.md"), markdown);
    entries.push(buildEntry(slug, markdown));
    console.log(`synced ${slug}`);
  }

  await fs.writeFile(
    indexPath,
    `${JSON.stringify(
      {
        source: `https://github.com/${repoOwner}/${repoName}`,
        syncedAt: new Date().toISOString(),
        count: entries.length,
        designs: entries,
      },
      null,
      2,
    )}\n`,
  );

  console.log(`Synced ${entries.length} DESIGN.md files to ${rootDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
