import { useEffect, useRef, useState } from "react";
import { useBoardStore } from "../store/boardStore.js";
import { useAuthStore } from "../store/authStore.js";
import { groupRoster, type RosterEntry } from "../lib/presence.js";

/**
 * Header presence UI: a stack of avatars of everyone currently on the board
 * plus a "N online" pill. Clicking it opens the full roster — online users
 * (with names/emails and a "you" marker) and, below, collaborators the board
 * is shared with who are not online right now. Shown whenever a board is
 * open, so the roster works both for solo boards ("only you") and shared ones.
 */
export default function PresenceRoster() {
  const activeUsers = useBoardStore((s) => s.activeUsers);
  const collaborators = useBoardStore((s) => s.collaborators);
  const currentUser = useAuthStore((s) => s.user);

  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const roster = groupRoster(activeUsers, collaborators, currentUser?.email || undefined);
  const shown = roster.online.slice(0, 4);
  const extra = roster.online.length - shown.length;

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-transparent border border-[#12304A] hover:bg-[#10263A] transition"
        title="Who is on this board right now"
      >
        <span className="flex items-center -space-x-1.5">
          {shown.map((u) => (
            <span
              key={u.email}
              className="w-6 h-6 rounded-full text-white text-xs font-bold flex items-center justify-center border-2 border-[#0A1428]"
              style={{ backgroundColor: u.color }}
              title={u.email}
            >
              {u.initials}
            </span>
          ))}
        </span>
        <span className="text-xs font-medium text-slate-200 flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-[#00D4AA] animate-pulse" />
          {roster.online.length} online
        </span>
      </button>

      {open && (
        <div
          data-testid="roster-popover"
          className="absolute right-0 top-full mt-2 w-72 rounded-xl bg-white border border-slate-200 shadow-xl z-50 overflow-hidden"
        >
          <div className="px-3.5 py-2.5 border-b border-slate-100">
            <p className="text-sm font-semibold text-slate-800">On this board now</p>
            <p className="text-[11px] text-slate-400">
              {roster.online.length === 1
                ? "Only you — share the board to collaborate."
                : `${roster.online.length} people have this board open.`}
            </p>
          </div>

          <div className="max-h-64 overflow-y-auto py-1">
            {roster.online.map((u: RosterEntry) => (
              <div
                key={u.email}
                data-testid="roster-row"
                className="flex items-center gap-2.5 px-3.5 py-2 hover:bg-slate-50"
              >
                <span
                  className="w-7 h-7 rounded-full text-white text-xs font-bold flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: u.color }}
                >
                  {u.initials}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="text-sm font-medium text-slate-700 truncate">{u.name}</span>
                    {u.isSelf && (
                      <span
                        data-testid="you-chip"
                        className="text-[10px] font-semibold text-cyan-700 bg-cyan-50 border border-cyan-200 rounded-full px-1.5 py-0.5"
                      >
                        you
                      </span>
                    )}
                  </span>
                  <span className="block text-xs text-slate-400 truncate">{u.email}</span>
                </span>
                <span
                  className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0"
                  title="Online"
                />
              </div>
            ))}

            {roster.offline.length > 0 && (
              <>
                <div className="px-3.5 pt-2 pb-1 border-t border-slate-100 mt-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Shared with · offline
                  </p>
                </div>
                {roster.offline.map((email) => (
                  <div key={email} className="flex items-center gap-2.5 px-3.5 py-1.5">
                    <span className="w-7 h-7 rounded-full bg-slate-200 text-slate-500 text-xs font-bold flex items-center justify-center flex-shrink-0">
                      {email.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm text-slate-500 truncate">{email}</span>
                    </span>
                    <span
                      className="w-2 h-2 rounded-full bg-slate-300 flex-shrink-0"
                      title="Offline"
                    />
                  </div>
                ))}
              </>
            )}
          </div>

          <div className="px-3.5 py-2 border-t border-slate-100 bg-slate-50">
            <p className="text-[10px] text-slate-400">
              People appear here while they have the board open.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}