import { useState } from "react";
import { useBoardStore } from "../store/boardStore.js";
import type { BoxData, BoxType } from "../types.js";
import {
  blockingFindings,
  gateState,
  latestVersion,
  sdlcStageMeta,
  upstreamBlockReason,
} from "../lib/sdlc.js";

/**
 * The approval gate of an SDLC stage box.
 *
 * Renders inside the box body (below the artifact) and owns its own store
 * subscriptions — the same pattern as the header — so a box re-render does not
 * have to push the whole board through props.
 *
 * Every action here is a HUMAN decision that lands in the box's audit trail:
 * approving records who and when, requesting changes sends the stage back with a
 * note the next regeneration must address, and editing appends a new version
 * instead of overwriting the old one.
 */
export default function SdlcGatePanel({ id, boxType }: { id: string; boxType: BoxType }) {
  const data = useBoardStore((s) => s.boxData[id]);
  const approveArtifact = useBoardStore((s) => s.approveArtifact);
  const requestChanges = useBoardStore((s) => s.requestChanges);
  const rejectArtifact = useBoardStore((s) => s.rejectArtifact);
  const editArtifact = useBoardStore((s) => s.editArtifact);
  const dismissFinding = useBoardStore((s) => s.dismissFinding);
  // Recomputes on board changes but only re-renders when the reason changes.
  const blockedReason = useBoardStore((s) => upstreamBlockReason(s.nodes, s.edges, s.boxData, id));

  const [noteOpen, setNoteOpen] = useState<"changes" | "reject" | null>(null);
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [viewVersion, setViewVersion] = useState<number | null>(null);

  if (!data) return null;
  const meta = sdlcStageMeta(boxType);
  if (!meta) return null;

  const versions = data.sdlcVersions || [];
  const latest = latestVersion(versions);
  const gate = gateState(boxType, data);
  const state = data.sdlcGate || "pending";
  const blocking = blockingFindings(data);
  const findings = data.sdlcFindings || [];

  /** Chip styling per gate state — one accent per state, matching the chrome. */
  const chip =
    state === "approved"
      ? { className: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: "✅" }
      : state === "rejected"
        ? { className: "bg-rose-50 text-rose-700 border-rose-200", icon: "⛔" }
        : state === "stale"
          ? { className: "bg-violet-50 text-violet-700 border-violet-200", icon: "↻" }
          : state === "changes_requested"
            ? { className: "bg-amber-50 text-amber-700 border-amber-200", icon: "✏️" }
            : { className: "bg-slate-50 text-slate-600 border-slate-200", icon: "🔒" };

  const submitNote = () => {
    if (noteOpen === "changes") requestChanges(id, note.trim());
    else if (noteOpen === "reject") rejectArtifact(id, note.trim());
    setNote("");
    setNoteOpen(null);
  };

  const startEditing = () => {
    setDraft(latest?.content || "");
    setEditing(true);
    setViewVersion(null);
  };

  const viewedVersion = viewVersion !== null ? versions.find((v) => v.version === viewVersion) : null;

  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50/70">
      {/* === Gate bar === */}
      <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5 border-b border-slate-200">
        <span
          className={"text-[10px] font-semibold px-1.5 py-0.5 rounded-md border " + chip.className}
          title={gate.reason || "This stage must be approved before the next stage can run."}
        >
          {chip.icon} {state === "approved" ? "Approved" : state === "pending" ? "Awaiting approval" : state === "changes_requested" ? "Changes requested" : state === "rejected" ? "Rejected" : "Stale"}
          {latest ? ` · v${latest.version}` : ""}
        </span>

        {state === "approved" && (
          <span className="text-[10px] text-slate-500 truncate" title={`Approved by ${data.sdlcApprovedBy || "someone"}`}>
            by {data.sdlcApprovedBy || "someone"}
            {data.sdlcApprovedAt ? ` · ${new Date(data.sdlcApprovedAt).toLocaleString()}` : ""}
          </span>
        )}

        {blocking.length > 0 && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-rose-50 text-rose-700 border border-rose-200">
            ⛔ {blocking.length} blocking
          </span>
        )}

        {(data.sdlcOpenItems || []).length > 0 && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200">
            ⚠ {(data.sdlcOpenItems || []).length} unresolved
          </span>
        )}

        {(data.sdlcGaps || []).length > 0 && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200">
            ⚠ {(data.sdlcGaps || []).length} decision(s) untested
          </span>
        )}

        {data.sdlcDeviation && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200">
            ⚠ plan deviation
          </span>
        )}

        <span className="flex-1" />

        {versions.length > 0 && (
          <button
            onClick={() => { setShowHistory((v) => !v); setViewVersion(null); }}
            className="text-[10px] px-1.5 py-0.5 rounded-md bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 transition whitespace-nowrap"
            title="Show every version and the audit trail"
          >
            🕘 {versions.length} version{versions.length === 1 ? "" : "s"}
          </button>
        )}
      </div>

      {/* Blocked reason — the stage cannot run until this is resolved. */}
      {blockedReason && (
        <p className="px-2 py-1.5 text-[11px] text-rose-600 bg-rose-50/70 border-b border-rose-100">
          {blockedReason}
        </p>
      )}

      {/* Gate actions */}
      <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5">
        <button
          onClick={() => approveArtifact(id)}
          disabled={!latest}
          className="text-[11px] font-medium px-2 py-1 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 transition"
          title="Approve this artifact version — later stages can then run"
        >
          ✅ Approve
        </button>
        <button
          onClick={() => { setNoteOpen(noteOpen === "changes" ? null : "changes"); setNote(data.sdlcFeedback || ""); }}
          disabled={!latest}
          className="text-[11px] font-medium px-2 py-1 rounded-md bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 disabled:opacity-40 transition"
          title="Send this stage back with feedback — the next run must address it"
        >
          ✏️ Request changes
        </button>
        <button
          onClick={() => { setNoteOpen(noteOpen === "reject" ? null : "reject"); setNote(""); }}
          disabled={!latest}
          className="text-[11px] font-medium px-2 py-1 rounded-md bg-white border border-slate-200 text-slate-700 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40 transition"
          title="Reject this artifact (all versions are kept)"
        >
          ⛔ Reject
        </button>
        <button
          onClick={() => (editing ? setEditing(false) : startEditing())}
          disabled={!latest}
          className={"text-[11px] font-medium px-2 py-1 rounded-md border transition disabled:opacity-40 " + (editing ? "bg-slate-700 text-white border-slate-700" : "bg-white border-slate-200 text-slate-700 hover:bg-slate-100")}
          title="Edit the artifact and save it as a new version"
        >
          ✏️ Edit
        </button>
      </div>

      {/* Change-request / rejection note */}
      {noteOpen && (
        <div className="px-2 pb-2 space-y-1.5">
          <textarea
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={noteOpen === "changes" ? "What must change? (sent into the next regeneration)" : "Why is this rejected?"}
            className="nodrag nowheel w-full min-h-[54px] resize-y rounded-lg border border-slate-200 p-2 text-[11px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
          <div className="flex gap-1.5">
            <button
              onClick={submitNote}
              className="text-[11px] font-medium px-2 py-1 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 transition"
            >
              {noteOpen === "changes" ? "Send back" : "Confirm rejection"}
            </button>
            <button
              onClick={() => { setNoteOpen(null); setNote(""); }}
              className="text-[11px] px-2 py-1 rounded-md bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Artifact editor — saving appends a version, it never overwrites one */}
      {editing && (
        <div className="px-2 pb-2 space-y-1.5">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="nodrag nowheel w-full min-h-[140px] resize-y rounded-lg border border-slate-200 p-2 text-[11px] font-mono text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => { editArtifact(id, draft, "edited at the gate"); setEditing(false); }}
              disabled={!draft.trim() || draft === latest?.content}
              className="text-[11px] font-medium px-2 py-1 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 transition"
              title="Append this text as a new version (the previous versions are kept)"
            >
              💾 Save as new version
            </button>
            <button
              onClick={() => setEditing(false)}
              className="text-[11px] px-2 py-1 rounded-md bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 transition"
            >
              Cancel
            </button>
            <span className="text-[10px] text-slate-400">
              {latest ? `New version v${latest.version + 1}` : "New version v1"}
            </span>
          </div>
        </div>
      )}

      {/* Open questions / plan gaps — the app's own cross-checks */}
      {(data.sdlcOpenItems || []).length > 0 && (
        <div className="px-2 pb-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700 mb-1">
            Unresolved — this stage stays gated
          </p>
          <ul className="space-y-0.5">
            {(data.sdlcOpenItems || []).map((item, i) => (
              <li key={i} className="text-[11px] text-amber-800 leading-snug">⚠ {item}</li>
            ))}
          </ul>
        </div>
      )}

      {(data.sdlcGaps || []).length > 0 && (
        <div className="px-2 pb-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700 mb-1">
            Spec decisions with no named test
          </p>
          <ul className="space-y-0.5">
            {(data.sdlcGaps || []).map((gap, i) => (
              <li key={i} className="text-[11px] text-amber-800 leading-snug">⚠ {gap}</li>
            ))}
          </ul>
        </div>
      )}

      {data.sdlcDeviation && (
        <p className="px-2 pb-2 text-[11px] text-amber-800">
          ⚠ The artifact reports a deviation from the approved plan — resolve it or approve deliberately.
        </p>
      )}

      {/* Review findings */}
      {findings.length > 0 && (
        <div className="px-2 pb-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
            Findings ({findings.length})
          </p>
          <div className="space-y-1">
            {findings.map((f) => (
              <div
                key={f.id}
                className={"flex items-start gap-1.5 rounded-md border px-1.5 py-1 " + (f.dismissed ? "border-slate-200 bg-white/60" : f.severity === "blocking" ? "border-rose-200 bg-rose-50/60" : f.severity === "important" ? "border-amber-200 bg-amber-50/60" : "border-slate-200 bg-white")}
              >
                <span
                  className={"text-[9px] font-bold uppercase px-1 py-0.5 rounded " + (f.severity === "blocking" ? "bg-rose-600 text-white" : f.severity === "important" ? "bg-amber-500 text-white" : "bg-slate-200 text-slate-600")}
                >
                  {f.severity}
                </span>
                <span className={"flex-1 text-[11px] leading-snug " + (f.dismissed ? "text-slate-400 line-through" : "text-slate-700")}>
                  {f.description}
                  {f.location && <span className="text-slate-400 font-mono"> · {f.location}</span>}
                </span>
                {f.dismissed ? (
                  <span className="text-[9px] text-slate-400 whitespace-nowrap">dismissed{f.dismissedBy ? ` · ${f.dismissedBy}` : ""}</span>
                ) : (
                  <button
                    onClick={() => dismissFinding(id, f.id)}
                    className="text-[9px] px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 transition whitespace-nowrap"
                    title="Dismiss this finding (recorded in the audit trail)"
                  >
                    Dismiss
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {versions.length > 0 && findings.length === 0 && meta.stage === "review" && (
        <p className="px-2 pb-2 text-[11px] text-amber-800">
          ⚠ No structured findings could be parsed from this artifact — review it manually before approving.
        </p>
      )}

      {/* Version history + audit trail (old versions stay queryable) */}
      {showHistory && (
        <div className="px-2 pb-2 border-t border-slate-200 pt-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
            Versions — nothing is ever overwritten
          </p>
          <div className="space-y-0.5">
            {versions.map((v) => (
              <div key={v.version} className="flex items-center gap-1.5 text-[11px]">
                <span className="font-mono text-slate-500">v{v.version}</span>
                <span className="text-slate-400">{v.source === "edited" ? "✏️ edited" : "✨ generated"}</span>
                <span className="text-slate-500 truncate">{v.createdBy}</span>
                <span className="text-slate-400">{new Date(v.createdAt).toLocaleString()}</span>
                <span className="flex-1" />
                <button
                  onClick={() => setViewVersion(viewVersion === v.version ? null : v.version)}
                  className="px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 transition whitespace-nowrap"
                >
                  {viewVersion === v.version ? "hide" : "👁 view"}
                </button>
                {latest?.version === v.version && (
                  <span className="text-[9px] font-semibold text-slate-500 bg-slate-200 rounded px-1 py-0.5">latest</span>
                )}
              </div>
            ))}
          </div>

          {viewedVersion && (
            <pre className="nodrag nowheel mt-1.5 max-h-40 overflow-auto rounded-lg border border-slate-200 bg-white p-2 text-[10px] leading-snug text-slate-700 whitespace-pre-wrap">
              {viewedVersion.content}
            </pre>
          )}

          {(data.sdlcHistory || []).length > 0 && (
            <>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mt-2 mb-1">
                Audit trail
              </p>
              <div className="space-y-0.5">
                {[...(data.sdlcHistory || [])].reverse().map((e, i) => (
                  <div key={i} className="text-[10px] leading-snug text-slate-500">
                    <span className="text-slate-400">{new Date(e.at).toLocaleString()}</span>
                    {" — "}
                    <span className="font-medium text-slate-600">{e.actor}</span>
                    {" "}
                    {e.action}
                    {e.note && <span className="text-slate-400"> — {e.note}</span>}
                  </div>
                ))}
              </div>
            </>
          )}

          {data.sdlcFeedback && (
            <p className="mt-2 text-[10px] text-amber-800">
              Last change request at the gate: {data.sdlcFeedback}
            </p>
          )}
        </div>
      )}

      {/* Gate configuration note — the toggle itself lives in the ⚙ panel */}
      <p className="px-2 pb-1.5 text-[10px] text-slate-400">
        {gate.locked
          ? `Always gated: ${gate.reason}`
          : gate.required
            ? "The next stage waits for your approval."
            : "Auto-advance: the next stage may run without an approval."}
      </p>
    </div>
  );
}

/**
 * Compact gate state badge for the box header, so the pipeline's state is
 * readable on the canvas without opening the box.
 */
export function SdlcGateBadge({ data }: { data: BoxData }) {
  const state = data.sdlcGate;
  const hasArtifact = (data.sdlcVersions || []).length > 0;
  if (!state && !hasArtifact) return null;

  const map: Record<string, { icon: string; className: string; title: string }> = {
    approved: { icon: "✅", className: "bg-emerald-100 text-emerald-700", title: "Artifact approved" },
    pending: { icon: "🔒", className: "bg-amber-100 text-amber-700", title: "Awaiting approval at the gate" },
    changes_requested: { icon: "✏️", className: "bg-amber-100 text-amber-700", title: "Changes requested" },
    rejected: { icon: "⛔", className: "bg-rose-100 text-rose-700", title: "Rejected" },
    stale: { icon: "↻", className: "bg-violet-100 text-violet-700", title: "Stale — an upstream stage changed" },
  };
  const info = map[state || "pending"];

  return (
    <span
      className={"text-[10px] px-1 rounded font-semibold flex-shrink-0 " + info.className}
      title={info.title}
    >
      {info.icon}
    </span>
  );
}
