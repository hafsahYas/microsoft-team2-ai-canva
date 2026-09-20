import type { NamedInput } from "../types.js";
import { CODE_CHANGE_PROMPT } from "../types.js";
import { fillPromptTemplate } from "./prompts.js";

/**
 * Wraps generated React component code in a self-contained HTML file
 * that loads React + Babel via CDN. Used for iframe preview and download.
 */
export function wrapCodeInHtml(code: string): string {
  return [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '  <meta charset="UTF-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '  <script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"></script>',
    '  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>',
    '  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>',
    '  <style>',
    '    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; }',
    '    #root { padding: 16px; }',
    '    * { box-sizing: border-box; }',
    '  </style>',
    '</head>',
    '<body>',
    '  <div id="root"></div>',
    '  <script type="text/babel">',
    code,
    "  setTimeout(function() { window.parent.postMessage({ type: 'preview-ready' }, '*'); }, 300);",
    '  </script>',
    '</body>',
    '</html>',
  ].join('\n');
}

/**
 * Wraps generated React code in HTML with Tailwind CSS + Google Fonts.
 * Used by the UI Design box for beautiful, production-quality previews.
 * The model generates Tailwind class-based JSX instead of inline styles.
 */
export function wrapUIInHtml(code: string): string {
  return [
    "<!DOCTYPE html>",
    "<html>",
    "<head>",
    "  <meta charset=\"UTF-8\">",
    "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">",
    "  <script crossorigin src=\"https://unpkg.com/react@18/umd/react.development.js\"></script>",
    "  <script crossorigin src=\"https://unpkg.com/react-dom@18/umd/react-dom.development.js\"></script>",
    "  <script src=\"https://unpkg.com/@babel/standalone/babel.min.js\"></script>",
    "  <script src=\"https://cdn.tailwindcss.com\"></script>",
    "  <link href=\"https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap\" rel=\"stylesheet\">",
    "  <style>",
    "    body { margin: 0; font-family: Inter, -apple-system, BlinkMacSystemFont, sans-serif; }",
    "    #root { padding: 0; }",
    "    * { box-sizing: border-box; }",
    "  </style>",
    "</head>",
    "<body>",
    "  <div id=\"root\"></div>",
    "  <script type=\"text/babel\">",
    code,
    "  setTimeout(function() { window.parent.postMessage({ type: 'preview-ready' }, '*'); }, 300);",
    "  </script>",
    "</body>",
    "</html>",
  ].join("\n");
}

/**
 * Strips markdown code block wrappers if the LLM wrapped the output.
 */
export function extractCode(raw: string): string {
  let code = raw.trim();
  // Remove markdown code block wrapper (```jsx ... ```)
  const codeBlockMatch = code.match(/```(?:jsx?|javascript|react)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    code = codeBlockMatch[1].trim();
  }
  return code;
}

/**
 * True when generated code is a complete, previewable prototype: it must define
 * something and still mount it. Used both after a build and after an AI change,
 * so a truncated reply can never replace good code.
 */
export function isCompletePrototype(code: string): boolean {
  if (!code || !code.trim()) return false;
  if (!/ReactDOM\.createRoot|ReactDOM\.render/.test(code)) return false;
  return /function\s+App|const\s+App|class\s+App|export\s+default/.test(code);
}

/**
 * Builds the prompt for an AI change to existing code: the current code, the
 * change request, and any connected context (e.g. a Review box's findings).
 *
 * The template is fixed (see CODE_CHANGE_PROMPT) because its rules — return the
 * complete file, change nothing else — are the safeguard against a rewrite that
 * silently drops features.
 */
export function buildCodeChangePrompt(
  opts: { code: string; request: string; context?: NamedInput[] },
  template: string = CODE_CHANGE_PROMPT
): string {
  let filled = fillPromptTemplate(template, []);
  filled = filled.replace(/\{\{code\}\}/g, () => opts.code.trim());
  filled = filled.replace(/\{\{request\}\}/g, () => opts.request.trim() || "[no change request given]");

  const context = (opts.context || []).filter((input) => (input.output || "").trim().length > 0);
  if (context.length > 0) {
    filled +=
      "\n\nAdditional context from connected boxes (use it, but still apply only the request above):\n" +
      context.map((input) => `${input.name}:\n${input.output.trim()}`).join("\n\n---\n\n");
  }
  return filled;
}

/**
 * Triggers a browser download of the HTML file.
 */
export function downloadHtml(html: string, filename = "prototype.html") {
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Copies text to the clipboard.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}