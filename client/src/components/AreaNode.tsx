import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { useBoardStore } from "../store/boardStore.js";
import { AREA_COLORS } from "../types.js";

/**
 * A drawn rectangular area — a background grouping region that sits UNDER
 * the boxes (created via zIndex -1 by `addArea` in boardStore). Renders as a
 * very light rectangle with a dashed border. When selected, it shows a color
 * picker (very light palette) and a delete button; areas can also be moved
 * by dragging and deleted with the keyboard.
 */
function AreaNodeInner({ id, data, selected }: NodeProps) {
  const setAreaColor = useBoardStore((s) => s.setAreaColor);
  const deleteBox = useBoardStore((s) => s.deleteBox);

  const fill = (data?.fill as string) || AREA_COLORS[0].fill;
  const border = (data?.border as string) || AREA_COLORS[0].border;

  return (
    <div
      className="w-full h-full rounded-xl"
      style={{ backgroundColor: fill, border: `1.5px dashed ${border}` }}
      title="Area — drag to move, select to recolor"
    >
      {selected && (
        <>
          {/* Color picker — very light shades only, so areas never compete
              with the boxes on top of them. */}
          <div className="nodrag absolute -top-9 left-0 flex items-center gap-1.5 rounded-lg bg-white/90 backdrop-blur px-2 py-1.5 shadow-md border border-slate-200">
            {AREA_COLORS.map((c) => (
              <button
                key={c.fill}
                onClick={() => setAreaColor(id, c.fill, c.border)}
                title={`Area color — ${c.name}`}
                className={
                  "area-color-dot w-5 h-5 rounded-md border transition hover:scale-110 " +
                  (fill === c.fill ? "border-slate-600 scale-110" : "border-slate-300")
                }
                style={{ backgroundColor: c.fill, borderColor: fill === c.fill ? c.border : undefined }}
              />
            ))}
          </div>
          {/* Delete */}
          <button
            onClick={() => deleteBox(id)}
            title="Delete area"
            className="box-delete nodrag absolute -top-4 -right-4 w-6 h-6 rounded-full bg-white text-slate-500 hover:text-red-500 text-sm shadow-md border border-slate-200 flex items-center justify-center"
          >
            ✕
          </button>
        </>
      )}
    </div>
  );
}

export default memo(AreaNodeInner);