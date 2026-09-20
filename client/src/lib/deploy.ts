import type { BoxData, BoxType } from "../types.js";
import { wrapCodeInHtml, wrapUIInHtml } from "./code.js";
import { renderChangeSet } from "./codeedit.js";

/**
 * Turning a box's code into a publishable site.
 *
 * The backend does the actual publishing (`POST /api/herenow-deploy`); this module
 * decides WHAT gets published for each kind of box and keeps the caller inside the
 * hard limits before a request is ever made.
 */

/** One file to publish. */
export interface DeployFile {
  path: string;
  content: string;
}

/** Caps, mirrored from server/src/herenow.ts so the UI refuses early. */
export const MAX_DEPLOY_FILES = 400;
export const MAX_DEPLOY_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_DEPLOY_TOTAL_BYTES = 25 * 1024 * 1024;

/** Box types whose contents can be published. */
export function canDeployCode(type: BoxType | string): boolean {
  return type === "code" || type === "ui" || type === "stitch" || type === "codeedit";
}

/** True when the box currently holds something publishable. */
export function hasDeployableCode(type: BoxType | string, data: BoxData | undefined): boolean {
  if (!data || !canDeployCode(type)) return false;
  if (type === "codeedit") return (data.changeSet || []).length > 0;
  return Boolean((data.code || "").trim());
}

/** Bytes in a deploy set (utf-8), matching what the server measures. */
export function deployBytes(files: DeployFile[]): number {
  return files.reduce((sum, file) => sum + new TextEncoder().encode(file.content).length, 0);
}

/**
 * The files a box publishes.
 *
 * - **Code / UI Design:** a self-contained `index.html` (React + Babel from a CDN,
 *   exactly what the box's own preview uses) plus `App.jsx` holding the source, so
 *   the published site shows the running prototype AND the code that produced it.
 * - **Stitch UI:** its HTML is already a page — published as `index.html` as-is.
 * - **Code Edit:** the changed files at their repository paths (so a change that
 *   touches a static site deploys as that site) plus `CHANGES.md`, the diff
 *   document, so the published site explains itself.
 *
 * Returns [] when there is nothing to publish.
 */
export function deployFilesFor(type: BoxType | string, data: BoxData | undefined): DeployFile[] {
  if (!data) return [];
  const code = (data.code || "").trim();

  if (type === "code" || type === "ui") {
    if (!code) return [];
    const html = type === "code" ? wrapCodeInHtml(code) : wrapUIInHtml(code);
    return [
      { path: "index.html", content: html },
      { path: "App.jsx", content: code.endsWith("\n") ? code : code + "\n" },
    ];
  }

  if (type === "stitch") {
    if (!code) return [];
    return [{ path: "index.html", content: data.code as string }];
  }

  if (type === "codeedit") {
    const changeSet = data.changeSet || [];
    if (changeSet.length === 0) return [];
    const files: DeployFile[] = [];
    for (const change of changeSet) {
      if (change.operation === "delete") continue; // a deletion is not a file to publish
      if (!change.path.trim()) continue;
      files.push({ path: change.path.replace(/^\.\//, ""), content: change.content });
    }
    files.push({ path: "CHANGES.md", content: renderChangeSet(changeSet, changeSet[0]?.reason || "") });
    return files;
  }

  return [];
}

/**
 * Why this box cannot be published right now ("" when it can). Kept in one place
 * so the button's disabled state and its tooltip never disagree.
 */
export function deployBlockedReason(type: BoxType | string, data: BoxData | undefined): string {
  if (!canDeployCode(type)) return "This box has no code to publish.";
  if (!data) return "This box has no code to publish.";
  if (type === "codeedit") {
    return (data.changeSet || []).length > 0 ? "" : "Run this box first — there is no change set to publish.";
  }
  return (data.code || "").trim() ? "" : "Generate code first — then it can be published.";
}

/** Validates a deploy set against the caps, returning an error message or "". */
export function validateDeploySet(files: DeployFile[]): string {
  if (files.length === 0) return "There is nothing to publish.";
  if (files.length > MAX_DEPLOY_FILES) return `Too many files to publish (${files.length}; the limit is ${MAX_DEPLOY_FILES}).`;
  for (const file of files) {
    const bytes = new TextEncoder().encode(file.content).length;
    if (bytes > MAX_DEPLOY_FILE_BYTES) {
      return `${file.path} is ${(bytes / 1024 / 1024).toFixed(1)} MB — the per-file limit is ${MAX_DEPLOY_FILE_BYTES / 1024 / 1024} MB.`;
    }
  }
  if (deployBytes(files) > MAX_DEPLOY_TOTAL_BYTES) {
    return `The deploy set is over ${MAX_DEPLOY_TOTAL_BYTES / 1024 / 1024} MB — publish less at once.`;
  }
  return "";
}

/** A short, human title + description for the published Site. */
export function deploySiteTitle(
  type: BoxType | string,
  data: BoxData | undefined,
  boxTitle: string,
  boardTitle: string
): { displayName: string; displayDescription: string } {
  const kind = type === "ui" ? "UI Design" : type === "stitch" ? "Stitch UI" : type === "codeedit" ? "Code Edit" : "Code";
  const request = (data?.content || "").trim().replace(/\s+/g, " ");
  const name = `${boxTitle || `${kind} Box`}`.slice(0, 80);
  const parts = [
    `Published from AI Canva (${kind} box)`,
    boardTitle ? `board: ${boardTitle}` : "",
    request ? `request: ${request.slice(0, 120)}` : "",
  ].filter(Boolean);
  return { displayName: name, displayDescription: parts.join(" · ").slice(0, 280) };
}
