import type { NamedInput, RepoMeta } from "../types.js";
import { fillPromptTemplate } from "./prompts.js";

/**
 * Pure helpers for the Code Map worker (a box type in the sidebar's Workers
 * section). The box reads a GitHub repository through the backend's
 * `/api/repo-digest` endpoint; everything here is deterministic and unit-tested
 * so the store only orchestrates the fetch + model call.
 */

/** A GitHub repository reference the backend can fetch. */
export interface RepoRef {
  owner: string;
  repo: string;
  /** Branch/tag, or "" to let the backend use the default branch. */
  branch: string;
  /** Canonical URL, e.g. https://github.com/owner/repo */
  url: string;
  /** "owner/repo" — what the UI shows. */
  slug: string;
}

/** GitHub owner/repo names: letters, digits, `-`, `_`, `.` (no spaces, no slashes). */
const NAME = /^[A-Za-z0-9_.-]+$/;

function build(owner: string, repo: string, branch: string): RepoRef | null {
  if (!NAME.test(owner) || !NAME.test(repo)) return null;
  if (branch && !/^[A-Za-z0-9_./-]+$/.test(branch)) return null;
  // A repo name may end in ".git" on a clone URL.
  const cleanRepo = repo.replace(/\.git$/, "");
  if (!cleanRepo) return null;
  return {
    owner,
    repo: cleanRepo,
    branch,
    // The URL handed to the backend carries the branch (as a `#branch` fragment,
    // which both the client and the server parse) — otherwise a request for
    // `owner/repo#release-2.0` would silently read the default branch instead.
    url: branch
      ? `https://github.com/${owner}/${cleanRepo}#${branch}`
      : `https://github.com/${owner}/${cleanRepo}`,
    slug: `${owner}/${cleanRepo}`,
  };
}

/**
 * Parses the forms a person (or an agent) is likely to paste:
 *
 * - `https://github.com/owner/repo` (also with `/tree/<branch>`, `/blob/…`, `#branch`, trailing `/`, or `.git`)
 * - `git@github.com:owner/repo.git`
 * - `owner/repo`, `owner/repo#branch`, `owner/repo@branch`
 *
 * Returns null for anything that is not a GitHub repository reference — the box
 * then falls back to whatever is connected to it. Only github.com is accepted:
 * the backend must never be pointed at an arbitrary host.
 */
export function parseRepoRef(input: string | undefined): RepoRef | null {
  const raw = (input || "").trim();
  if (!raw) return null;

  // https://github.com/owner/repo(/tree|blob/<branch>/…)  |  github.com/owner/repo
  // (also the git@github.com:owner/repo.git clone form)
  const url = raw.match(/^(?:git@)?(?:https?:\/\/)?(?:www\.)?github\.com[/:]([^/\s#]+)\/([^/\s#]+)(.*)$/i);
  if (url) {
    const [, owner, repo, rest] = url;
    let branch = "";
    const tree = rest.match(/^\/(?:tree|blob)\/([^/\s#?]+)/i);
    if (tree) branch = tree[1];
    const hash = rest.match(/#([A-Za-z0-9_./-]+)/);
    if (!branch && hash) branch = hash[1];
    return build(owner, repo, branch);
  }

  // owner/repo[#branch|@branch]
  const short = raw.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:[#@]([A-Za-z0-9_./-]+))?$/);
  if (short) return build(short[1], short[2], short[3] || "");

  return null;
}

/**
 * Resolves the repository this box should read, in priority order:
 * the box's own URL field → a GitHub URL anywhere in its note → a GitHub URL in
 * its prompt (only when the prompt was customised) → a GitHub URL in the text of
 * a connected box. Any of these lets a person (or the Agent box) just paste a
 * repo link somewhere sensible.
 *
 * The stock prompt is skipped deliberately: its placeholder example
 * (`https://github.com/owner/repo`) is documentation, not a repository.
 */
export function resolveRepoRef(sources: {
  repoUrl?: string;
  content?: string;
  prompt?: string;
  /** The box type's stock prompt — ignored when the prompt is untouched. */
  defaultPrompt?: string;
  inputs?: NamedInput[];
}): RepoRef | null {
  const direct = parseRepoRef(sources.repoUrl);
  if (direct) return direct;

  const found = findRepoRefInText(sources.content);
  if (found) return found;

  const customPrompt = (sources.prompt || "").trim();
  const stockPrompt = (sources.defaultPrompt || "").trim();
  if (customPrompt && customPrompt !== stockPrompt) {
    const inPrompt = findRepoRefInText(customPrompt);
    if (inPrompt) return inPrompt;
  }

  for (const input of sources.inputs || []) {
    const inInput = findRepoRefInText(input.output);
    if (inInput) return inInput;
  }

  return null;
}

/** Finds the first GitHub repository reference inside a block of text. */
export function findRepoRefInText(text: string | undefined): RepoRef | null {
  if (!text) return null;
  // Longest-match-first: a bare `owner/repo` is only accepted for the whole
  // token, so prose and paths in prompts don't turn into repos by accident.
  const urls = text.match(/(?:https?:\/\/)?(?:www\.)?github\.com[/:][^\s)"'`]+/gi) || [];
  for (const candidate of urls) {
    const ref = parseRepoRef(candidate);
    if (ref) return ref;
  }
  const slugs =
    text.match(/(?<![A-Za-z0-9_./-])[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:[#@][A-Za-z0-9_./-]+)?(?![A-Za-z0-9_./-])/g) || [];
  for (const candidate of slugs) {
    const [owner, repoPart] = candidate.split(/[/#@]/);
    // A real owner/repo needs letters on both sides (`3/4` and `src/lib` — which
    // the lookarounds already reject — are not repositories).
    if (!/[A-Za-z]/.test(owner || "") || !/[A-Za-z]/.test(repoPart || "")) continue;
    if (/\.[A-Za-z]{1,5}$/.test(candidate)) continue;
    const ref = parseRepoRef(candidate);
    if (ref) return ref;
  }
  return null;
}

/**
 * Builds the prompt for a Code Map run: the user's (editable) template filled
 * with the connected inputs, then the repository digest the backend fetched, and
 * — when the fetch failed — an explicit block saying so, so the brief can never
 * pretend to have read a repository it never saw.
 */
export function buildCodeMapPrompt(
  opts: {
    prompt: string;
    digest?: string;
    meta?: RepoMeta | null;
    fetchError?: string;
  },
  namedInputs: NamedInput[]
): string {
  let filled = fillPromptTemplate(opts.prompt, namedInputs);

  // A user-edited template may not reference {{inputs}} at all. The box must not
  // silently drop what is connected to it, so any input the filled prompt does
  // not already contain is appended explicitly (probed by prefix to keep the
  // check cheap for large code blocks).
  const missing = namedInputs.filter((input) => {
    const text = (input.output || "").trim();
    return text.length > 0 && !filled.includes(text.slice(0, 80));
  });
  if (missing.length > 0) {
    filled +=
      "\n\n## Connected context\n" +
      missing.map((input) => `${input.name}:\n${input.output.trim()}`).join("\n\n---\n\n");
  }

  const digest = (opts.digest || "").trim();
  const meta = opts.meta || null;

  if (digest) {
    const header = meta && meta.repo
      ? `## Repository digest — ${meta.repo}${meta.branch ? `@${meta.branch}` : ""}\n` +
        `Fetched ${meta.files} file(s) of ${meta.treeEntries} in the tree` +
        `${meta.truncated ? ", capped by the digest budget" : ""}.\n\n`
      : "## Repository digest\n\n";
    filled += "\n\n" + header + digest;
    if (meta?.truncated) {
      filled +=
        "\n\nNote: the digest above was capped, so it is NOT the whole repository. " +
        "Do not present it as complete — list what is missing under Open questions.";
    }
    if (meta && meta.notes.length > 0) {
      filled += "\n\nSkipped or capped during digest building:\n" + meta.notes.map((n) => `- ${n}`).join("\n");
    }
  } else {
    filled +=
      "\n\n## Repository not read\n" +
      (opts.fetchError || "No GitHub repository was given.") +
      "\nMap only the connected context above. Say clearly that the repository itself was not read, " +
      "and put what you could not determine under Open questions.";
  }

  return filled;
}
