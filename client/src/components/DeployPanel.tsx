import { useState } from "react";
import { useBoardStore } from "../store/boardStore.js";
import type { BoxType } from "../types.js";
import { deployBlockedReason, deployFilesFor } from "../lib/deploy.js";

/**
 * The result of publishing a box's code to here.now, and the button to do it
 * again.
 *
 * Two things here are deliberate rather than cosmetic:
 *
 * - an anonymous Site **expires in 24 hours** and is updatable only with the claim
 *   token here.now returns EXACTLY ONCE, so the expiry and the claim link are
 *   surfaced instead of being buried in a state file;
 * - a redeploy updates the same Site and sends the last live version back, so a
 *   Site that changed elsewhere is refused with a clear message rather than
 *   silently replaced — that message is what `deploy.error` shows.
 */
export default function DeployPanel({ id, boxType }: { id: string; boxType: BoxType }) {
  const boxData = useBoardStore((s) => s.boxData[id]);
  const deployBox = useBoardStore((s) => s.deployBox);
  const [showClaim, setShowClaim] = useState(false);

  if (!boxData) return null;
  const deploy = boxData.deploy;
  const blocked = deployBlockedReason(boxType, boxData);
  const files = deployFilesFor(boxType, boxData);
  const isRunning = boxData.status === "running";
  // A failed attempt keeps the previous good record and still SHOWS the live site:
  // after a refused update the site is still up and reachable, and hiding it would
  // be the least useful moment to hide it.
  const failed = deploy?.error ? deploy.error : "";
  const live = deploy?.url ? (deploy as NonNullable<typeof deploy>) : null;
  const hasLive = Boolean(live);

  if (!deploy && !files.length) return null;

  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50/70">
      <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          🌐 Live site
        </span>
        {live ? (
          <span className="text-[10px] text-slate-500 tabular-nums">
            {live.fileCount} file{live.fileCount === 1 ? "" : "s"} · {(live.bytes / 1024).toFixed(1)} KB ·{" "}
            {new Date(live.deployedAt).toLocaleString()}
          </span>
        ) : (
          <span className="text-[10px] text-slate-400">{blocked || `${files.length} file(s) ready to publish`}</span>
        )}
        <span className="flex-1" />
        <button
          onClick={() => deployBox(id)}
          disabled={isRunning || Boolean(blocked)}
          className="text-[11px] font-medium px-2 py-1 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 transition whitespace-nowrap"
          title={hasLive ? "Publish the current code to the same site" : "Publish this box's code to a live URL"}
        >
          {isRunning ? "⏳ Publishing…" : hasLive ? "🚀 Redeploy" : "🚀 Deploy"}
        </button>
      </div>

      {failed && (
        <p className="px-2 pb-1.5 text-[10px] text-rose-700 bg-rose-50/70 border-t border-rose-100 pt-1">
          ⚠ {failed}
          {deploy?.url ? " The previous site is still live and unchanged." : ""}
        </p>
      )}

      {live && (
        <div className="px-2 pb-1.5 border-t border-slate-200 pt-1 space-y-0.5">
          <a
            href={live.url}
            target="_blank"
            rel="noreferrer"
            className="nodrag block text-[11px] font-medium text-indigo-700 hover:underline truncate"
            title={live.url}
          >
            {live.url}
          </a>
          <p className="text-[10px] text-slate-500">
            {live.anonymous ? (
              <>
                Anonymous site —{" "}
                {live.expiresAt ? `expires ${new Date(live.expiresAt).toLocaleString()}` : "expires in 24 hours"}
                . Claim it to keep it permanently:
              </>
            ) : (
              "Permanent site, saved to the here.now account."
            )}
          </p>
          {live.anonymous && live.claimUrl && (
            <div className="space-y-0.5">
              <button
                onClick={() => setShowClaim((v) => !v)}
                className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 transition"
                title="here.now returns this link only once — copy it before it is lost"
              >
                {showClaim ? "Hide claim link" : "🔑 Show claim link"}
              </button>
              {showClaim && (
                <div>
                  <code className="nodrag block text-[10px] break-all bg-white border border-slate-200 rounded px-1.5 py-1 text-slate-700 select-all">
                    {live.claimUrl}
                  </code>
                  <p className="text-[10px] text-amber-800 mt-0.5">
                    ⚠ Returned once and cannot be recovered. Keep it if you want to update this site later —
                    a modified link will not work.
                  </p>
                </div>
              )}
            </div>
          )}
          {live.warnings.length > 0 && (
            <ul className="text-[10px] text-amber-800 space-y-0.5">
              {live.warnings.map((warning, i) => (
                <li key={i}>⚠ {warning}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
