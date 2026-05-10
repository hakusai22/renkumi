import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export type SkillSource = "project" | "user";

export type SkillSummary = {
  name: string;
  description: string;
  tags: string[];
  source: SkillSource;
  activeByDefault: boolean;
};

export type LoadedSkill = SkillSummary & {
  content: string;
  references: Array<{
    path: string;
    content: string;
  }>;
};

export type SkillSelection = {
  skills: LoadedSkill[];
  missingSkillNames: string[];
  defaultedSkillNames: string[];
};

type SkillLocation = {
  directory: string;
  source: SkillSource;
  priority: number;
};

const skillDocument = "SKILL.md";
export const defaultVideoSkillName = "remotion-best-practices";
const maxSkillContentChars = 6500;
const maxReferenceContentChars = 3200;
const maxSkillNameLength = 96;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const normalizeSkillName = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-")
    .slice(0, maxSkillNameLength);

const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)));

const stripQuotes = (value: string) => value.replace(/^['"]|['"]$/g, "").trim();

const parseInlineList = (value: string) => {
  const trimmed = value.trim();

  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => stripQuotes(item.trim()))
      .filter(Boolean);
  }

  return trimmed
    .split(",")
    .map((item) => stripQuotes(item.trim()))
    .filter(Boolean);
};

const extractFrontmatter = (content: string) => {
  if (!content.startsWith("---")) {
    return { frontmatter: "", body: content };
  }

  const marker = "\n---";
  const end = content.indexOf(marker, 3);

  if (end === -1) {
    return { frontmatter: "", body: content };
  }

  return {
    frontmatter: content.slice(3, end).trim(),
    body: content.slice(end + marker.length).replace(/^\s*\n/, ""),
  };
};

const parseSkillFrontmatter = (frontmatter: string) => {
  const parsed: Record<string, unknown> = {};
  const metadata: Record<string, unknown> = {};
  let section: string | undefined;
  let listKey: string | undefined;

  for (const rawLine of frontmatter.split("\n")) {
    const line = rawLine.replace(/\r$/, "");

    if (!line.trim() || line.trimStart().startsWith("#")) {
      continue;
    }

    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    const trimmed = line.trim();

    if (trimmed.startsWith("- ") && section === "metadata" && listKey === "tags") {
      const current = Array.isArray(metadata.tags) ? metadata.tags : [];
      metadata.tags = [...current, stripQuotes(trimmed.slice(2).trim())];
      continue;
    }

    const separator = trimmed.indexOf(":");

    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();

    if (indent === 0) {
      section = value ? undefined : key;
      listKey = undefined;

      if (key === "metadata") {
        parsed.metadata = metadata;
        section = "metadata";
        continue;
      }

      parsed[key] = stripQuotes(value);
      continue;
    }

    if (section === "metadata") {
      listKey = value ? undefined : key;
      metadata[key] = key === "tags" ? parseInlineList(value) : stripQuotes(value);
    }
  }

  if (Object.keys(metadata).length > 0) {
    parsed.metadata = metadata;
  }

  return parsed;
};

const getPluginSkillLocations = async (home: string): Promise<SkillLocation[]> => {
  const cacheRoots = [
    path.join(home, ".codex", "plugins", "cache", "openai-curated"),
    path.join(home, ".codex", "plugins", "cache", "openai-bundled"),
  ];
  const locations: SkillLocation[] = [];

  for (const cacheRoot of cacheRoots) {
    const plugins = await fs.readdir(cacheRoot, { withFileTypes: true }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }

      throw error;
    });

    for (const plugin of plugins.filter((entry) => entry.isDirectory())) {
      const pluginRoot = path.join(cacheRoot, plugin.name);
      const versions = await fs.readdir(pluginRoot, { withFileTypes: true }).catch(() => []);

      for (const version of versions.filter((entry) => entry.isDirectory())) {
        locations.push({
          directory: path.join(pluginRoot, version.name, "skills"),
          source: "user",
          priority: 6,
        });
      }
    }
  }

  return locations;
};

const getSkillLocations = async (): Promise<SkillLocation[]> => {
  const cwd = process.cwd();
  const home = os.homedir();

  return [
    { directory: path.join(cwd, ".agents", "skills"), source: "project", priority: 0 },
    { directory: path.join(cwd, ".codex", "skills"), source: "project", priority: 1 },
    { directory: path.join(cwd, ".claude", "skills"), source: "project", priority: 2 },
    { directory: path.join(home, ".agents", "skills"), source: "user", priority: 3 },
    { directory: path.join(home, ".codex", "skills"), source: "user", priority: 4 },
    { directory: path.join(home, ".claude", "skills"), source: "user", priority: 5 },
    ...(await getPluginSkillLocations(home)),
  ];
};

const readSkillSummary = async (skillPath: string, source: SkillSource): Promise<SkillSummary | null> => {
  const raw = await fs.readFile(path.join(skillPath, skillDocument), "utf8").catch(() => null);

  if (!raw) {
    return null;
  }

  const { frontmatter } = extractFrontmatter(raw);
  const metadata = parseSkillFrontmatter(frontmatter);
  const name = typeof metadata.name === "string" ? normalizeSkillName(metadata.name) : normalizeSkillName(path.basename(skillPath));
  const description = typeof metadata.description === "string" ? metadata.description.trim() : "";
  const tags = isRecord(metadata.metadata) && Array.isArray(metadata.metadata.tags) ? metadata.metadata.tags : [];

  if (!name) {
    return null;
  }

  return {
    name,
    description,
    tags: unique(tags.map((tag) => (typeof tag === "string" ? normalizeSkillName(tag) : ""))),
    source,
    activeByDefault: name === defaultVideoSkillName,
  };
};

const listSkillDirectories = async (location: SkillLocation) => {
  const entries = await fs.readdir(location.directory, { withFileTypes: true }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  });

  return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(location.directory, entry.name));
};

const getSkillIndex = async () => {
  const byName = new Map<string, SkillSummary & { directory: string; priority: number }>();

  for (const location of await getSkillLocations()) {
    const directories = await listSkillDirectories(location);

    for (const directory of directories) {
      const summary = await readSkillSummary(directory, location.source);

      if (!summary) {
        continue;
      }

      const existing = byName.get(summary.name);

      if (!existing || location.priority < existing.priority) {
        byName.set(summary.name, {
          ...summary,
          directory,
          priority: location.priority,
        });
      }
    }
  }

  return [...byName.values()].sort((left, right) => {
    if (left.activeByDefault !== right.activeByDefault) {
      return left.activeByDefault ? -1 : 1;
    }

    if (left.source !== right.source) {
      return left.source === "project" ? -1 : 1;
    }

    return left.name.localeCompare(right.name);
  });
};

export const listAvailableSkills = async (): Promise<SkillSummary[]> => {
  const skills = await getSkillIndex();

  return skills.map(({ directory: _directory, priority: _priority, ...summary }) => summary);
};

const isVideoSkill = (skill: SkillSummary) => {
  const searchable = [skill.name, skill.description, ...skill.tags].join(" ").toLowerCase();

  return skill.name === defaultVideoSkillName || /remotion|hyperframes/.test(searchable);
};

export const listVideoSkills = async () => {
  const skills = await listAvailableSkills();

  return skills.filter(isVideoSkill);
};

const isSafeMarkdownReference = (reference: string) => {
  const withoutHash = reference.split("#", 1)[0];
  const normalized = withoutHash.replace(/^\.\//, "");

  if (!normalized || path.isAbsolute(normalized) || normalized.includes("..")) {
    return null;
  }

  const parts = normalized.split("/");

  if (parts.length !== 2 || !parts.every(Boolean) || !parts[1].endsWith(".md")) {
    return null;
  }

  return normalized;
};

const extractSafeMarkdownReferences = (content: string) => {
  const references = new Set<string>();
  const markdownLinks = content.matchAll(/\[[^\]]*]\(([^)]+\.md(?:#[^)]+)?)\)/g);
  const inlinePaths = content.matchAll(/`((?:\.\/)?[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+\.md)`/g);

  for (const match of [...markdownLinks, ...inlinePaths]) {
    const safePath = isSafeMarkdownReference(match[1]);

    if (safePath) {
      references.add(safePath);
    }
  }

  return [...references].slice(0, 4);
};

const shouldLoadReferenceForBrief = (reference: string, brief: string) => {
  const text = `${reference} ${brief}`.toLowerCase();

  if (/subtitles?|captions?|srt|字幕|标题|旁白/.test(text) && /subtitles?|captions?|srt|字幕/.test(reference)) {
    return true;
  }

  if (/ffmpeg|trim|silence|audio|video|剪辑|裁剪|静音|音频/.test(text) && /ffmpeg/.test(reference)) {
    return true;
  }

  return false;
};

const truncateForPrompt = (content: string, maxLength: number) => {
  const trimmed = content.trim();

  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength)}\n\n[Skill content truncated for prompt safety.]`;
};

export const loadSkill = async (name: string, options: { brief?: string } = {}): Promise<LoadedSkill | null> => {
  const normalizedName = normalizeSkillName(name);
  const skill = (await getSkillIndex()).find((entry) => entry.name === normalizedName);

  if (!skill) {
    return null;
  }

  const raw = await fs.readFile(path.join(skill.directory, skillDocument), "utf8");
  const { body } = extractFrontmatter(raw);
  const references = await Promise.all(
    extractSafeMarkdownReferences(body)
      .filter((reference) => shouldLoadReferenceForBrief(reference, options.brief ?? ""))
      .map(async (reference) => {
        const content = await fs.readFile(path.join(skill.directory, reference), "utf8").catch(() => "");

        return content
          ? {
              path: reference,
              content: truncateForPrompt(extractFrontmatter(content).body, maxReferenceContentChars),
            }
          : null;
      }),
  );

  const { directory: _directory, priority: _priority, ...summary } = skill;

  return {
    ...summary,
    content: truncateForPrompt(body, maxSkillContentChars),
    references: references.filter((reference): reference is LoadedSkill["references"][number] => Boolean(reference)),
  };
};

export const selectSkillsForVideo = async ({
  requestedSkills,
  brief,
}: {
  requestedSkills?: string[];
  brief: string;
}): Promise<SkillSelection> => {
  const available = await listAvailableSkills();
  const availableNames = new Set(available.map((skill) => skill.name));
  const normalizedRequested = unique((requestedSkills ?? []).map(normalizeSkillName));
  const defaultedSkillNames =
    availableNames.has(defaultVideoSkillName) && !normalizedRequested.includes(defaultVideoSkillName)
      ? [defaultVideoSkillName]
      : [];
  const selectedNames = unique([...defaultedSkillNames, ...normalizedRequested.filter((name) => availableNames.has(name))]);
  const missingSkillNames = normalizedRequested.filter((name) => !availableNames.has(name));
  const skills = await Promise.all(selectedNames.map((name) => loadSkill(name, { brief })));

  return {
    skills: skills.filter((skill): skill is LoadedSkill => Boolean(skill)),
    missingSkillNames,
    defaultedSkillNames,
  };
};

export const composeSkillPrompt = (skills: LoadedSkill[]) => {
  if (skills.length === 0) {
    return "";
  }

  return skills
    .map((skill) => {
      const references = skill.references
        .map((reference) => `\n\n### Referenced rule: ${reference.path}\n${reference.content}`)
        .join("");

      return `## Skill: ${skill.name}\nDescription: ${skill.description || "No description"}\nTags: ${
        skill.tags.join(", ") || "none"
      }\n\n${skill.content}${references}`;
    })
    .join("\n\n---\n\n");
};
