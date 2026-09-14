import type { BoxData } from "../types.js";

/**
 * The repository field shared by the Code Map and Code Edit workers: the URL
 * input plus, after a run, exactly what was read (repo@branch · files · chars ·
 * capped · when) and the digest's notes. Showing this is what makes the box's
 * claims auditable instead of plausible.
 */
export default function RepoField({
  boxData,
  onChange,
  hint,
  children,
}: {
  boxData: BoxData;
  onChange: (url: string) => void;
  /** Extra one-liner under the field (the Code Edit box explains file targeting). */
  hint?: string;
  /** Rendered below the read summary (e.g. the change set). */
  children?: React.ReactNode;
}) {
  const meta = boxData.repoMeta;

  return (
    <div className="mb-2 rounded-lg border border-slate-200 bg-slate-50/70 px-2 py-1.5">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          🗂 Repository
        </span>
        {(boxData.repoUrl || "").trim() === "" && (
          <span className="text-[10px] text-slate-400">(a GitHub link in a connected box works too)</span>
        )}
      </div>
      <input
        type="text"
        value={boxData.repoUrl || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder="https://github.com/owner/repo  ·  owner/repo#branch"
        className="nodrag mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
        title="The public repository this box reads. Private repos need GITHUB_TOKEN on the server."
      />

      {hint && <p className="mt-1 text-[10px] text-slate-400">{hint}</p>}

      {meta && (
        <div className="mt-1 space-y-0.5">
          {meta.repo ? (
            <p className="text-[10px] text-slate-500">
              {meta.repo}
              {meta.branch ? `@${meta.branch}` : ""}
              {" · "}
              {meta.files} file{meta.files === 1 ? "" : "s"} of {meta.treeEntries}
              {" · "}
              {(meta.chars / 1000).toFixed(1)}k chars
              {meta.truncated && <span className="font-semibold text-amber-700"> · capped</span>}
              {meta.fetchedAt > 0 && (
                <span className="text-slate-400">
                  {" · read "}
                  {new Date(meta.fetchedAt).toLocaleString()}
                </span>
              )}
            </p>
          ) : null}
          {meta.error && <p className="text-[10px] text-amber-800">⚠ {meta.error}</p>}
          {meta.notes.length > 0 && (
            <details className="text-[10px] text-slate-500">
              <summary className="cursor-pointer select-none">
                Repository notes ({meta.notes.length})
              </summary>
              <ul className="mt-0.5 space-y-0.5 pl-3">
                {meta.notes.map((note, i) => (
                  <li key={i} className="list-disc">{note}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {children}
    </div>
  );
}
