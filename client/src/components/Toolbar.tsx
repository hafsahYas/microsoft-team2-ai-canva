import { useState } from "react";

/**
 * Canvas help card ("How to use") — bottom-left, dismissible to a "?" pill.
 * Note: the E2E suite locates this card by finding a `rounded-xl` div whose
 * text includes "How to use" — keep both markers when restyling.
 */
export default function Toolbar() {
  const [open, setOpen] = useState(true);

  return (
    <div className="help-anchor absolute bottom-4 left-4 z-10">
      {open ? (
        <div className="rounded-xl bg-white/95 backdrop-blur border border-slate-200 shadow-xl shadow-slate-900/10 p-4 w-[300px]">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[13px] font-semibold text-slate-700">How to use</h2>
            <button
              onClick={() => setOpen(false)}
              className="w-6 h-6 flex items-center justify-center rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
              title="Hide help"
            >
              ✕
            </button>
          </div>

          <ol className="space-y-2.5">
            {[
              <>
                Add boxes from the panel on the right (toggle with{" "}
                <span className="font-medium text-slate-700">+ Add Box</span>).
              </>,
              <>
                Type your idea in an{" "}
                <span className="font-medium text-amber-600">💡 Idea</span> box, or upload an image
                in an <span className="font-medium text-emerald-600">🖼️ Image</span> box.
              </>,
              <>
                Drag from a box's right edge <span className="text-slate-400">●</span> to another
                box's left edge <span className="text-slate-400">●</span> to connect them.
              </>,
              <>
                Click <span className="font-medium text-slate-700">▶ Run</span> on any AI box
                (Research, PRD, Summarize, Cartoon, Slides, Code) to generate output.
              </>,
              <>
                Click <span className="font-medium text-slate-700">⚙</span> to edit the AI prompt —
                reference connected inputs with <code className="text-[10px] bg-slate-100 px-1 py-0.5 rounded font-mono">{"{{input_1}}"}</code>,{" "}
                <code className="text-[10px] bg-slate-100 px-1 py-0.5 rounded font-mono">{"{{inputs}}"}</code>.
              </>,
              <>
                Click a box, then drag the corner handles to resize it.
              </>,
            ].map((step, i) => (
              <li key={i} className="flex gap-2.5 text-xs text-slate-600 leading-relaxed">
                <span className="w-4 h-4 mt-0.5 rounded-full bg-slate-100 text-slate-500 text-[9px] font-semibold flex items-center justify-center flex-shrink-0">
                  {i + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>

          <div className="mt-3 pt-3 border-t border-slate-100 space-y-1.5">
            <p className="text-[11px] text-slate-500 leading-snug">
              <span className="font-semibold text-pink-600">🎨 Cartoon</span> — connect an Image box
              to cartoonify it, or an Idea box for text-to-image.
            </p>
            <p className="text-[11px] text-slate-500 leading-snug">
              <span className="font-semibold text-orange-500">📊 Slides</span> — connect Research
              boxes to generate a navigable pitch deck.
            </p>
            <p className="text-[11px] text-slate-500 leading-snug">
              <span className="font-semibold text-cyan-600">💻 Code</span> — connect a PRD or
              Research box for a live React prototype.
            </p>
          </div>

          <div className="mt-3 pt-2.5 border-t border-slate-100 text-[10px] text-slate-400">
            Boards auto-save — to the browser when signed out, to the cloud when signed in.
          </div>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="rounded-full bg-white shadow-lg border border-slate-200 w-10 h-10 flex items-center justify-center text-slate-500 hover:text-slate-700 hover:border-slate-300 transition"
          title="Show help"
        >
          ?
        </button>
      )}
    </div>
  );
}