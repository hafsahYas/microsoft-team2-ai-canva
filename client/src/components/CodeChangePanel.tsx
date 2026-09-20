import { useState } from "react";
import { useBoardStore } from "../store/boardStore.js";
import type { BoxData, BoxType } from "../types.js";
import { computeLineDiff, lineDiff } from "../lib/codeedit.js";

/**
 * AI change requests for a Code / UI Design box, with the safety net.
 *
 * The AI rewrites the whole component (that is the only reliable way to ask a
 * model for a code change), so the app shows what actually moved and keeps every
 * previous version. That is what makes a mangled rewrite cost one click instead
 * of the whole box.
 */
export default function CodeChangePanel({ id, boxType }: { id: string; boxType: BoxType }) {
  const boxData = useBoardStore((s) => s.boxData[id]);
  const updateBoxData = useBoardStore((s) => s.updateBoxData);
  const applyChangeRequest = useBoardStore((s) => s.applyChangeRequest);
  const revertCodeVersion = useBoardStore((s) => s.revertCodeVersion);

  const [showHistory, setShowHistory] = useState(false);
  const [viewVersion, setViewVersion] = useState<number | null>(null);
  const [showDiff, setShowDiff] = useState(false);

  if (!boxData || !boxData.code) return null;

  const versions = boxData.codeVersions || [];
  const currentVersion = boxData.codeVersion || 0;
  const current = versions.find((v) => v.version === currentVersion);
  // The diff of the current version against the one before it — what the last
  // build or change actually did.
  const previous = versions.filter((v) => v.version < currentVersion).pop();
  const stats = previous && current ? lineDiff(previous.content, current.content) : null;
  const isRunning = boxData.status === "running";
  const viewed = viewVersion !== null ? versions.find((v) => v.version === viewVersion) : null;

  return (
    <div className="mt-2 space-y-1.5">
      {/* Ask the AI to change the code it already produced */}
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={boxData.changePrompt || ""}
          onChange={(e) => updateBoxData(id, { changePrompt: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !isRunning && (boxData.changePrompt || "").trim()) applyChangeRequest(id);
          }}
          placeholder="Request a change… e.g. “make the header dark and add a search field”"
          className="nodrag flex-1 min-w-0 rounded-lg border border-slate-200 px-2 py-1 text-[11px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-cyan-300"
          title="The AI applies this to the code in this box. Nothing else is rewritten."
        />
        <button
          onClick={() => applyChangeRequest(id)}
          disabled={isRunning || !(boxData.changePrompt || "").trim()}
          className="px-2 py-1 rounded-lg text-[11px] font-medium bg-slate-700 text-white hover:bg-slate-800 disabled:opacity-40 transition whitespace-nowrap"
          title="Ask the AI to apply the change to the current code"
        >
          {isRunning ? "⏳ Applying…" : "✏️ Apply change"}
        </button>
      </div>

      {/* What the last change did, and how to undo it */}
      {versions.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-slate-50/70">
          <div className="flex flex-wrap items-center gap-1.5 px-2 py-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              v{currentVersion}
            </span>
            {stats && (stats.added > 0 || stats.removed > 0) && (
              <span className="text-[10px] tabular-nums">
                <span className="text-emerald-700 font-semibold">+{stats.added}</span>{" "}
                <span className="text-rose-700 font-semibold">−{stats.removed}</span>
                <span className="text-slate-400"> vs v{previous?.version}</span>
              </span>
            )}
            {previous && (
              <button
                onClick={() => setShowDiff((v) => !v)}
                className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 transition"
                title="Show the line-by-line difference from the previous version"
              >
                🔀 {showDiff ? "Hide diff" : "Diff"}
              </button>
            )}
            <span className="flex-1" />
            <button
              onClick={() => { setShowHistory((v) => !v); setViewVersion(null); }}
              className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 transition"
              title="Every version is kept — nothing is ever overwritten"
            >
              🕘 {versions.length} version{versions.length === 1 ? "" : "s"}
            </button>
          </div>

          {current?.note && current.note !== "initial build" && (
            <p className="px-2 pb-1 text-[10px] text-slate-500">requested: {current.note}</p>
          )}

          {showDiff && previous && current && (
            <pre className="nodrag nowheel mx-2 mb-1.5 max-h-48 overflow-auto bg-slate-900 text-slate-100 text-[10px] leading-[1.45] px-2 py-1.5 font-mono whitespace-pre rounded">
              {computeLineDiff(previous.content, current.content).map((op, i) => (
                <div
                  key={i}
                  className={op.type === "+" ? "text-emerald-300" : op.type === "-" ? "text-rose-300" : "text-slate-400"}
                >
                  {op.type + op.line}
                </div>
              ))}
            </pre>
          )}

          {showHistory && (
            <div className="px-2 pb-1.5 border-t border-slate-200 pt-1.5">
              <div className="space-y-0.5">
                {[...versions].reverse().map((version) => {
                  const before = versions.filter((v) => v.version < version.version).pop();
                  const delta = before ? lineDiff(before.content, version.content) : null;
                  return (
                    <div key={version.version} className="flex items-center gap-1.5 text-[10px]">
                      <span className="font-mono text-slate-500 w-6">v{version.version}</span>
                      <span className="text-slate-400 whitespace-nowrap">
                        {version.source === "edited" ? "↩️" : "✨"}{" "}
                        {delta ? `+${delta.added} −${delta.removed}` : "build"}
                      </span>
                      <span className="text-slate-500 truncate" title={version.note}>
                        {version.note.trim() ? version.note : "—"}
                      </span>
                      <span className="flex-1" />
                      {version.version === currentVersion ? (
                        <span className="text-[9px] font-semibold text-slate-500 bg-slate-200 rounded px-1 py-0.5">
                          current
                        </span>
                      ) : (
                        <>
                          <button
                            onClick={() => setViewVersion(viewVersion === version.version ? null : version.version)}
                            className="px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 transition whitespace-nowrap"
                          >
                            {viewVersion === version.version ? "hide" : "👁 view"}
                          </button>
                          <button
                            onClick={() => { revertCodeVersion(id, version.version); setViewVersion(null); }}
                            className="px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 transition whitespace-nowrap"
                            title={`Restore v${version.version} (kept as a new version — history is never rewritten)`}
                          >
                            ↩ Revert
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
              {viewed && (
                <pre className="nodrag nowheel mt-1.5 max-h-40 overflow-auto rounded-lg border border-slate-200 bg-white p-2 text-[10px] leading-snug text-slate-700 whitespace-pre-wrap">
                  {viewed.content}
                </pre>
              )}
            </div>
          )}
        </div>
      )}

      <p className="text-[10px] text-slate-400">
        The AI rewrites the whole component, so the diff and the version history are the check — nothing is
        verified for you beyond the preview.
      </p>
    </div>
  );
}

/** True when this box type supports AI change requests (used by BoxNode). */
export function supportsCodeChanges(data: BoxData | undefined): boolean {
  return !!data?.code;
}
