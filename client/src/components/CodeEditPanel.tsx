import { lazy, Suspense, useState } from "react";
import { useBoardStore } from "../store/boardStore.js";
import type { BoxData, BoxType, FileChange } from "../types.js";
import { buildPatch, computeLineDiff, summarizeChangeSet } from "../lib/codeedit.js";
import RepoField from "./RepoField.js";

// The editor pulls in CodeMirror (~500KB), so it is only fetched when a file is
// actually opened for editing — same pattern as the Code box.
const CodeEditor = lazy(() => import("./CodeEditor.js"));

/**
 * The Code Edit worker's panel: repository + file targeting, then the proposed
 * change set as a reviewable diff you can fix by hand.
 *
 * The diff is computed from the whole-file content the model returned, so what
 * this panel shows IS what the downloaded `.patch` contains.
 */
export default function CodeEditPanel({ id, boxType }: { id: string; boxType: BoxType }) {
  const boxData = useBoardStore((s) => s.boxData[id]);
  const updateBoxData = useBoardStore((s) => s.updateBoxData);
  const setChangeSetFile = useBoardStore((s) => s.setChangeSetFile);

  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<"diff" | "edit">("diff");

  if (!boxData) return null;

  const changeSet = boxData.changeSet || [];
  const totals = summarizeChangeSet(changeSet);
  const current: FileChange | undefined =
    changeSet.find((c) => c.path === selected) || changeSet[0];

  const operationStyle = (change: FileChange) =>
    change.operation === "create"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : change.operation === "delete"
        ? "bg-rose-50 text-rose-700 border-rose-200"
        : "bg-blue-50 text-blue-700 border-blue-200";

  return (
    <div className="space-y-2">
      <RepoField
        boxData={boxData}
        onChange={(url) => updateBoxData(id, { repoUrl: url })}
        hint="Describe the change below (or connect an Idea / Spec / Plan box). Files to change are taken from this list, then from an upstream Plan, otherwise chosen automatically."
      >
        <div className="mt-1.5">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Files to change (optional)
          </label>
          <textarea
            value={boxData.filesToEdit || ""}
            onChange={(e) => updateBoxData(id, { filesToEdit: e.target.value })}
            placeholder={"one repository path per line\ne.g. server/src/app.ts"}
            className="nodrag nowheel mt-0.5 w-full min-h-[46px] resize-y rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-mono text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </div>
      </RepoField>

      {/* Change request */}
      <textarea
        value={boxData.content}
        onChange={(e) => updateBoxData(id, { content: e.target.value })}
        placeholder="What should change in this repository? e.g. “rate-limit the SSO callback and add a test”"
        className="nodrag nowheel w-full min-h-[56px] resize-y rounded-lg border border-slate-200 p-2 text-[12px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
      />

      {/* Provenance: how the targets were chosen and what was read */}
      {boxData.editMeta && (
        <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-2 py-1.5 space-y-0.5">
          <p className="text-[10px] text-slate-500">
            <span className="font-semibold uppercase tracking-wider text-slate-400">Files chosen:</span>{" "}
            {boxData.editMeta.source === "pinned"
              ? "from the list above"
              : boxData.editMeta.source === "plan"
                ? "from the upstream Plan"
                : boxData.editMeta.source === "triage"
                  ? "chosen automatically from the repo tree"
                  : "none"}
            {boxData.editMeta.read.length > 0 && (
              <> · read {boxData.editMeta.read.join(", ")}</>
            )}
            {boxData.editMeta.generatedAt > 0 && (
              <span className="text-slate-400">
                {" · "}
                {new Date(boxData.editMeta.generatedAt).toLocaleString()}
              </span>
            )}
          </p>
          {boxData.editMeta.missing.length > 0 && (
            <p className="text-[10px] text-amber-800">
              ⚠ not readable (left untouched): {boxData.editMeta.missing.join(", ")}
            </p>
          )}
          {boxData.editMeta.notes.length > 0 && (
            <ul className="text-[10px] text-amber-800 space-y-0.5">
              {boxData.editMeta.notes.map((note, i) => (
                <li key={i}>• {note}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* The change set */}
      {changeSet.length > 0 && (
        <div className="rounded-lg border border-slate-200">
          {boxData.status === "error" && (
            <p className="px-2 py-1 text-[10px] text-amber-800 bg-amber-50 border-b border-amber-100">
              ⚠ The change set below is from the previous successful run — this attempt failed, so it is
              not a proposal for the current request.
            </p>
          )}
          <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-slate-200 bg-slate-50/70">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Change set
            </span>
            <span className="text-[10px] text-slate-500 tabular-nums">
              {totals.files} file{totals.files === 1 ? "" : "s"} ·{" "}
              <span className="text-emerald-700 font-semibold">+{totals.added}</span>{" "}
              <span className="text-rose-700 font-semibold">−{totals.removed}</span>
            </span>
            <span className="flex-1" />
            <span className="text-[10px] text-slate-400">💾 Save downloads .patch</span>
          </div>

          <div className="divide-y divide-slate-100">
            {changeSet.map((change) => (
              <button
                key={change.path}
                onClick={() => setSelected(change.path)}
                className={
                  "w-full flex items-center gap-1.5 px-2 py-1 text-left transition " +
                  ((current && current.path === change.path) ? "bg-blue-50/60" : "hover:bg-slate-50")
                }
              >
                <span className={"text-[9px] font-bold uppercase px-1 py-0.5 rounded border " + operationStyle(change)}>
                  {change.operation}
                </span>
                <span className="flex-1 min-w-0 text-[11px] font-mono text-slate-700 truncate">{change.path}</span>
                <span className="text-[10px] tabular-nums whitespace-nowrap">
                  <span className="text-emerald-700">+{change.added}</span>{" "}
                  <span className="text-rose-700">−{change.removed}</span>
                </span>
              </button>
            ))}
          </div>

          {current && (
            <div className="border-t border-slate-200">
              <div className="flex items-center gap-1.5 px-2 py-1">
                <button
                  onClick={() => setMode("diff")}
                  className={"text-[10px] px-1.5 py-0.5 rounded transition " + (mode === "diff" ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}
                >
                  🔀 Diff
                </button>
                <button
                  onClick={() => setMode("edit")}
                  className={"text-[10px] px-1.5 py-0.5 rounded transition " + (mode === "edit" ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}
                >
                  ✏️ Edit file
                </button>
                <span className="flex-1" />
                {current.reason && (
                  <span className="text-[10px] text-slate-500 truncate" title={current.reason}>
                    {current.reason}
                  </span>
                )}
              </div>

              {mode === "diff" && (
                <pre className="nodrag nowheel max-h-64 overflow-auto bg-slate-900 text-slate-100 text-[10px] leading-[1.45] px-2 py-1.5 font-mono whitespace-pre">
                  {computeLineDiff(current.original, current.content).map((op, i) => (
                    <div
                      key={i}
                      className={
                        op.type === "+"
                          ? "text-emerald-300"
                          : op.type === "-"
                            ? "text-rose-300"
                            : "text-slate-400"
                      }
                    >
                      {op.type + op.line}
                    </div>
                  ))}
                </pre>
              )}

              {mode === "edit" && (
                <div className="p-1.5">
                  <Suspense
                    fallback={<div className="text-[11px] text-slate-400 py-3 text-center">Loading editor…</div>}
                  >
                    <CodeEditor
                      value={current.content}
                      onChange={(next) => setChangeSetFile(id, current.path, next)}
                      height="260px"
                    />
                  </Suspense>
                  <p className="mt-1 text-[10px] text-slate-400">
                    ✏️ Edits recompute the diff — the .patch always matches what you see here.
                  </p>
                </div>
              )}
            </div>
          )}

          <p className="px-2 py-1 border-t border-slate-200 text-[10px] text-slate-400">
            Nothing was pushed anywhere: apply the patch in your checkout with{" "}
            <code className="bg-slate-100 px-1 rounded">git apply code-changes.patch</code>, or paste a
            file's contents. Nothing here has been compiled or tested — CI and the Review stage are where
            that happens.
          </p>
        </div>
      )}

      {/* A run that produced no change still has to say why */}
      {changeSet.length === 0 && boxData.status === "done" && boxData.editMeta?.error === "" && (
        <p className="text-[11px] text-amber-800">
          No change was proposed. {boxData.editMeta?.notes[0] || "See the box's output for the model's reasoning."}
        </p>
      )}

      {/* Nothing to show yet */}
      {changeSet.length === 0 && boxData.status !== "done" && (
        <p className="text-[11px] text-slate-400">
          No change set yet. Give it a repository and a change request, then press{" "}
          <strong>▶ Run</strong>.
        </p>
      )}
    </div>
  );
}

/** The patch text a Code Edit box would download (also used by the footer). */
export function boxPatch(boxData: BoxData | undefined): string {
  return buildPatch(boxData?.changeSet);
}
