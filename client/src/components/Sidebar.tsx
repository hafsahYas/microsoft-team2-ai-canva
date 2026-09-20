import { useState } from "react";
import { useBoardStore } from "../store/boardStore.js";
import { useUserBoxesStore } from "../store/userBoxesStore.js";
import { BOX_TYPES } from "../types.js";
import type { BoxType, BoxCategory, BoxRole } from "../types.js";
import CustomBoxModal from "./CustomBoxModal.js";

interface SidebarProps {
  open: boolean;
  onToggle: () => void;
}

const SECTIONS: { title: string; category: BoxCategory }[] = [
  { title: "Inputs", category: "input" },
  // The gated SDLC pipeline (stages 1-6, in order). Kept next to Inputs because
  // an Idea box is the usual seed for stage 1.
  { title: "SDLC", category: "sdlc" },
  { title: "Workers", category: "worker" },
  { title: "Companions", category: "companion" },
  { title: "Collaboration", category: "collab" },
  { title: "Custom", category: "custom" },
];

/** Role filters shown as a dropdown at the top of the palette. */
const ROLE_STORAGE_KEY = "ai-canva:sidebar-role";

/** The selectable role profiles (must stay in sync with the <option> list). */
const ROLES: BoxRole[] = ["designer", "developer", "product", "sdlc"];

const ROLE_LABELS: Record<BoxRole, string> = {
  everyone: "Everyone",
  designer: "🎨 Designer",
  developer: "💻 Developer",
  product: "📊 Product",
  sdlc: "🔁 SDLC",
};

export default function Sidebar({ open, onToggle }: SidebarProps) {
  const addBox = useBoardStore((s) => s.addBox);
  const addCustomBox = useBoardStore((s) => s.addCustomBox);
  const customDefs = useUserBoxesStore((s) => s.defs);
  const removeCustomDef = useUserBoxesStore((s) => s.remove);
  const [showCustomModal, setShowCustomModal] = useState(false);

  const [role, setRole] = useState<"all" | BoxRole>(() => {
    const stored = typeof localStorage !== "undefined" ? localStorage.getItem(ROLE_STORAGE_KEY) : null;
    return ROLES.includes(stored as BoxRole) ? (stored as BoxRole) : "all";
  });

  const handleAdd = (type: BoxType) => {
    addBox(type);
  };

  const selectRole = (next: "all" | BoxRole) => {
    setRole(next);
    if (typeof localStorage !== "undefined") {
      if (next === "all") localStorage.removeItem(ROLE_STORAGE_KEY);
      else localStorage.setItem(ROLE_STORAGE_KEY, next);
    }
  };

  /** True when a box should appear under the active role filter.
   *  `everyone` boxes are shared scaffolding and show in every view. */
  const boxVisible = (meta: typeof BOX_TYPES[BoxType]) =>
    role === "all" || meta.roles.includes("everyone") || meta.roles.includes(role);

  const boxesByCategory = (cat: BoxCategory) =>
    (Object.entries(BOX_TYPES) as [BoxType, typeof BOX_TYPES[BoxType]][])
      .filter(([, meta]) => meta.category === cat && boxVisible(meta));

  return (
    <>
      {/* Collapsed tab — shows when sidebar is hidden */}
      {!open && (
        <button
          onClick={onToggle}
          className="absolute right-0 top-1/2 -translate-y-1/2 z-20 bg-slate-900 shadow-lg rounded-l-xl w-8 h-16 flex items-center justify-center text-slate-400 hover:text-cyan-300 hover:bg-slate-800 transition border border-r-0 border-slate-700"
          title="Show panel"
        >
          <span className="text-lg">◀</span>
        </button>
      )}

      {/* Sidebar panel */}
      <div
        className={
          "absolute right-0 top-0 bottom-0 z-20 bg-[#07111f] shadow-xl border-l border-slate-700 " +
          "transition-transform duration-300 flex flex-col " +
          (open ? "translate-x-0" : "translate-x-full")
        }
        style={{ width: "232px" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 flex-shrink-0">
          <span className="text-[13px] font-semibold text-slate-200">Add Box</span>
          <button
            onClick={onToggle}
            className="text-slate-400 hover:text-cyan-300 transition w-6 h-6 flex items-center justify-center rounded hover:bg-slate-800"
            title="Hide panel"
          >
            ✕
          </button>
        </div>

        {/* Role filter */}
        <div className="px-3 py-2.5 border-b border-slate-700 bg-[#0b1626] flex-shrink-0">
          <label className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            <span>View</span>
          </label>
          <select
            value={role}
            onChange={(e) => selectRole(e.target.value as "all" | BoxRole)}
            className="w-full h-8 rounded-lg border border-slate-700 bg-slate-900 px-2 text-[13px] font-medium text-slate-200 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 transition"
            title="Filter which boxes appear in the palette"
          >
            <option value="all">🧩 All boxes</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>

        {/* Scrollable palette */}
        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-4">
          {SECTIONS.map((section) => {
            // The static "custom" meta is a runtime fallback, never a
            // palette item — the Custom section lists the user's saved
            // definitions instead.
            const boxes = boxesByCategory(section.category).filter(([t]) => t !== "custom");
            const isCustom = section.category === "custom";
            if (!isCustom && boxes.length === 0) return null;
            return (
              <div key={section.title}>
                <h3 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5 px-1">
                  {section.title}
                </h3>
                <div className="space-y-1">
                  {boxes.map(([type, meta]) => (
                    <button
                      key={type}
                      onClick={() => handleAdd(type)}
                      className="w-full flex items-center gap-2.5 pl-2 pr-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-900 text-left transition hover:border-cyan-700 hover:bg-slate-800 hover:shadow-sm"
                      title={meta.description}
                    >
                      <span
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-sm flex-shrink-0"
                        style={{ backgroundColor: meta.color + "1F" }}
                      >
                        {meta.icon}
                      </span>
                      <span className="flex-1 text-[13px] font-medium text-slate-200 truncate">
                        {meta.label}
                      </span>
                    </button>
                  ))}
                  {isCustom && (
                    <>
                      {/* The user's saved custom box templates — click to add
                          an instance to the board; ✕ removes the template
                          (boxes already on boards are unaffected). */}
                      {customDefs.map((def) => (
                        <div key={def.id} className="relative group">
                          <button
                            onClick={() => addCustomBox(def)}
                            className="w-full flex items-center gap-2.5 pl-2 pr-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-900 text-left transition hover:border-cyan-700 hover:bg-slate-800 hover:shadow-sm"
                            title={def.description || "Add this custom box"}
                          >
                            <span
                              className="w-7 h-7 rounded-lg flex items-center justify-center text-sm flex-shrink-0"
                              style={{ backgroundColor: def.color + "1F" }}
                            >
                              {def.icon}
                            </span>
                            <span className="flex-1 text-[13px] font-medium text-slate-200 truncate">
                              {def.label}
                            </span>
                          </button>
                          <button
                            onClick={() => removeCustomDef(def.id)}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full text-[10px] text-slate-500 hover:text-red-400 hover:bg-red-950 opacity-0 group-hover:opacity-100 transition flex items-center justify-center"
                            title="Delete this template (boards keep their copies)"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                      {customDefs.length === 0 && (
                        <p className="text-[11px] text-slate-500 px-1 leading-snug">
                          Create your own reusable AI boxes — saved to your profile.
                        </p>
                      )}
                      <button
                        onClick={() => setShowCustomModal(true)}
                        className="w-full flex items-center gap-2.5 pl-2 pr-2.5 py-1.5 rounded-lg border border-dashed border-cyan-800 bg-cyan-950/30 text-left transition hover:bg-cyan-950/50 hover:border-cyan-600"
                        title="Create a custom box"
                      >
                        <span className="w-7 h-7 rounded-lg flex items-center justify-center text-sm flex-shrink-0 bg-cyan-950">
                          ✨
                        </span>
                        <span className="flex-1 text-[13px] font-medium text-cyan-300 truncate">
                          New Custom Box
                        </span>
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Create Custom Box dialog */}
      {showCustomModal && <CustomBoxModal onClose={() => setShowCustomModal(false)} />}
    </>
  );
}