import { memo } from "react";
import type { User } from "firebase/auth";
import { useBoardStore } from "../store/boardStore.js";
import { useTokenStore } from "../store/tokenStore.js";
import { Button } from "./ui/Button.js";
import { Menu, MenuDivider, MenuItem } from "./ui/Menu.js";
import PresenceRoster from "./PresenceRoster.js";

/**
 * Top app bar — the app's primary chrome.
 *
 * Decluttered from the original ~12 inline controls to a calm two-group bar:
 *   left  — brand, board title, save status
 *   right — collaboration (roster / Share), board actions (Boards menu),
 *           usage badge, role-gated views, account menu
 *
 * Rare + destructive actions (Clear / Delete board, Sign out) live inside
 * menus instead of the bar itself.
 *
 * Performance: this component subscribes to the store slices it renders
 * (title, save status, board list). App does NOT — so typing in the board
 * title re-renders only this (memoized) header, not the whole Canvas tree.
 */

const SAVE_LABEL: Record<string, string> = {
  saving: "Saving…",
  saved: "Saved",
  error: "Save failed",
};

interface HeaderProps {
  user: User;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onShare: () => void;
  onNewBoard: () => void;
  onLoadBoard: (boardId: string) => void;
  onDeleteBoard: () => void;
  onClearBoard: () => void;
  onLogout: () => void;
  isAdmin: boolean;
  isFacilitator: boolean;
  adminView: boolean;
  facilitatorView: boolean;
  onToggleAdminView: () => void;
  onToggleFacilitatorView: () => void;
}

function Header({
  user,
  sidebarOpen,
  onToggleSidebar,
  onShare,
  onNewBoard,
  onLoadBoard,
  onDeleteBoard,
  onClearBoard,
  onLogout,
  isAdmin,
  isFacilitator,
  adminView,
  facilitatorView,
  onToggleAdminView,
  onToggleFacilitatorView,
}: HeaderProps) {
  // Store slices the header itself renders (kept out of App on purpose).
  const currentBoardId = useBoardStore((s) => s.currentBoardId);
  const boardTitle = useBoardStore((s) => s.boardTitle);
  const setBoardTitle = useBoardStore((s) => s.setBoardTitle);
  const saveStatus = useBoardStore((s) => s.saveStatus);
  const boardList = useBoardStore((s) => s.boardList);
  const refreshBoardList = useBoardStore((s) => s.refreshBoardList);

  const totalTokens = useTokenStore((s) => s.totalTokens);
  const fmtTokens = (n: number) => n.toLocaleString("en-US");

  const saveLabel = SAVE_LABEL[saveStatus];
  const avatarInitials = (user.displayName || user.email || "?").slice(0, 2).toUpperCase();

  return (
    <header className="app-bar flex items-center justify-between gap-3 px-4 h-14 relative z-20 bg-[#0A1428] border-t-2 border-[#0C8CE9]">
      {/* ---- Left: brand + board identity ---- */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center flex-shrink-0">
          <img
            src="/secureflow-logo.png"
            alt="SecureFlow"
            className="h-10 w-auto object-contain"
          />
        </div>

        <div className="h-6 w-px bg-[#12304A] flex-shrink-0" />

        {currentBoardId ? (
          <div className="flex items-center gap-2.5 min-w-0">
            <input
              type="text"
              value={boardTitle}
              onChange={(e) => setBoardTitle(e.target.value)}
              placeholder="Untitled board"
              className="h-8 w-48 md:w-56 rounded-lg border border-[#12304A] bg-[#08122A] px-2.5 text-[13px] font-medium text-slate-200 transition hover:border-[#00D4AA] hover:bg-[#10263A] focus:border-[#00D4AA] focus:bg-[#08122A] focus:outline-none focus:ring-2 focus:ring-[#00D4AA]/20"
            />
            {saveLabel && (
              <span
                className="flex items-center gap-1.5 flex-shrink-0"
                title={"Board save status: " + saveLabel}
              >
                <span className={"save-dot save-" + saveStatus} />
                <span className="text-[11px] text-slate-400 hidden md:block">
                  {saveLabel}
                </span>
              </span>
            )}
          </div>
        ) : (
          <span className="text-xs text-slate-400">Opening board…</span>
        )}
      </div>

      {/* ---- Right: actions ---- */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {/* Collaboration group */}
        {currentBoardId && (
          <>
            <PresenceRoster />

            <Button
              variant="primary"
              onClick={onShare}
              className="ml-1 border border-[#00D4AA] bg-[#0A1428] text-[#00D4AA] hover:bg-[#10263A]"
            >
              👥 Share
            </Button>

            <div className="h-6 w-px bg-[#12304A] mx-1.5" />
          </>
        )}

        {/* Board tools */}
        <Button
          onClick={onToggleSidebar}
          active={sidebarOpen}
          title="Toggle the add-box panel"
          className="border border-[#00D4AA] bg-[#00D4AA] text-[#08122A] hover:bg-[#00BFA0]"
        >
          {"+ Add Box"}
        </Button>

        <Menu
          panelClassName="w-72"
          trigger={({ open, toggle }) => (
            <Button
  onClick={() => {
    if (!open) refreshBoardList();
    toggle();
  }}
  title="Open, create, or manage boards"
  className="!border-[#1E4968] !bg-[#0A1428] !text-white hover:!bg-[#12243A] hover:!border-[#00D4AA]"
>
  Boards ({boardList.length})
  <span
    className={
      "!text-white text-[10px] transition-transform " +
      (open ? "rotate-180" : "")
    }
  >
    ▾
  </span>
</Button>
          )}
        >
          {(close) => (
            <>
              <div className="max-h-80 overflow-y-auto">
                <MenuItem
                  icon="＋"
                  label="New Board"
                  accent
                  onClick={() => {
                    close();
                    onNewBoard();
                  }}
                />

                {boardList.length === 0 && (
                  <div className="px-3.5 py-3 text-xs text-slate-400">
                    No boards yet.
                  </div>
                )}

                {boardList.map((b) => (
                  <MenuItem
                    key={b.id}
                    label={b.title || "Untitled board"}
                    description={
                      new Date(b.updatedAt).toLocaleDateString() +
                      " · " +
                      (Array.isArray(b.nodes) ? b.nodes.length : 0) +
                      " boxes"
                    }
                    active={b.id === currentBoardId}
                    onClick={() => {
                      close();
                      onLoadBoard(b.id);
                    }}
                  />
                ))}
              </div>

              {currentBoardId && (
                <>
                  <MenuDivider />

                  <MenuItem
                    icon="🧹"
                    label="Clear this board"
                    description="Remove all boxes"
                    danger
                    onClick={() => {
                      close();
                      onClearBoard();
                    }}
                  />

                  <MenuItem
                    icon="🗑"
                    label="Delete this board"
                    description="Remove it from the cloud"
                    danger
                    onClick={() => {
                      close();
                      onDeleteBoard();
                    }}
                  />
                </>
              )}
            </>
          )}
        </Menu>

        <div className="h-6 w-px bg-[#12304A] mx-1.5" />

        {/* Usage + role views + account */}
        <div
          className="flex items-center gap-1 h-8 px-2.5 rounded-lg border border-[#12304A] bg-[#0A1428] text-[11px] text-slate-400 tabular-nums"
          title={"Your total LLM tokens used: " + fmtTokens(totalTokens)}
        >
          ⚡{" "}
          <span className="font-semibold text-[#00D4AA]">
            {fmtTokens(totalTokens)}
          </span>
          <span className="hidden md:inline">tok</span>
        </div>

        {isAdmin && (
          <Button
            variant="ghost"
            active={adminView}
            onClick={onToggleAdminView}
            title="Admin board — system stats and users"
          >
            🛠️ Admin
          </Button>
        )}

        {(isAdmin || isFacilitator) && (
          <Button
            variant="ghost"
            active={facilitatorView}
            onClick={onToggleFacilitatorView}
            title="Facilitator dashboard — templates, workshops, teams"
          >
            🧑‍🏫 Facilitator
          </Button>
        )}

        <Menu
          panelClassName="w-60"
          trigger={({ open, toggle }) => (
            <button
              type="button"
              onClick={toggle}
              className={
                "flex items-center gap-1 h-8 pl-1 pr-2 rounded-full border shadow-sm transition " +
                (open
                  ? "bg-[#08122A] border-[#00D4AA]"
                  : "bg-[#0A1428] border-[#12304A] hover:border-[#00D4AA]")
              }
              title="Account"
            >
              {user.photoURL ? (
                <img
                  src={user.photoURL}
                  alt=""
                  className="w-6 h-6 rounded-full"
                />
              ) : (
                <span className="w-6 h-6 rounded-full bg-[#12304A] text-[#00D4AA] text-[10px] font-bold flex items-center justify-center">
                  {avatarInitials}
                </span>
              )}

              <span className="text-[10px] text-slate-400">▾</span>
            </button>
          )}
        >
          {(close) => (
            <>
              <div className="px-3.5 py-2.5 border-b border-[#12304A]">
                <p className="text-[13px] font-medium text-slate-200 truncate">
                  {user.displayName || "Signed in"}
                </p>

                <p className="text-[11px] text-slate-400 truncate">
                  {user.email || "Workshop guest"}
                </p>
              </div>

              <div className="py-1">
                <MenuItem
                  icon="⏻"
                  label="Sign out"
                  danger
                  onClick={() => {
                    close();
                    onLogout();
                  }}
                />
              </div>
            </>
          )}
        </Menu>
      </div>
    </header>
  );
}

export default memo(Header);