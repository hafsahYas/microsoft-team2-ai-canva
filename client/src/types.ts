export type BoxType = "agent" | "idea" | "research" | "summarize" | "image" | "documents" | "cartoon" | "slides" | "code" | "prd" | "devplan" | "ui" | "stitch" | "note" | "label" | "timer" | "custom" | "securityAdvisor" | "irPlanner" | "threatModeler" | "riskScorer" | "assetMapper";
export type BoxStatus = "idle" | "running" | "done" | "error";

/** A single slide in a generated deck. */
export interface Slide {
  title: string;
  bullets: string[];
  notes?: string;
}

/**
 * A document attached to a Documents box. All fields are always defined (no
 * `undefined`) so the object survives Firestore writes, which reject
 * `undefined` anywhere in a nested value.
 */
export interface BoxDocument {
  id: string;
  name: string;
  size: number;
  ext: string;
  url: string;
  text: string;
  chars: number;
  truncated: boolean;
  error: string;
}

/** A user currently active on a board with their cursor position. */
export interface PresenceUser {
  userId: string;
  email: string;
  displayName: string;
  initials: string;
  color: string;
  cursorX: number;
  cursorY: number;
  hasCursor?: boolean;
}

/** A connected upstream input with its box name and output. */
export interface NamedInput {
  name: string;
  output: string;
}

/** One recorded step of an Agent box run. */
export interface AgentStep {
  id: string;
  type: "plan" | "add_box" | "connect" | "run" | "finish" | "stopped" | "error";
  label: string;
  detail?: string;
  boxId?: string;
  at: number;
}

export const AGENT_CONTROLLER_SYSTEM_PROMPT = `You are an autonomous AI agent working inside a collaborative whiteboard app ("AI Canva"). The whiteboard is your workspace: you complete tasks by creating BOXES on the board, wiring them together, and running them. Each box is an AI worker with a type and a prompt you write for it.

## Box types you can create
- "idea" — a plain text note (no AI; give it \`content\` with the text)
- "research" — deep research on a topic → Markdown report
- "summarize" — combines its inputs into a concise summary
- "prd" — turns research into a Product Requirements Document
- "devplan" — turns a PRD into a short technical build plan
- "slides" — generates a pitch deck (JSON-driven slide deck)
- "code" — generates a working React prototype (live preview on the board)
- "ui" — generates a polished React UI prototype with Tailwind (live preview)

## Protocol
Each turn you take EXACTLY ONE action. Reply with ONLY one JSON object — no markdown fences, no commentary, no text before or after.

- Create a box:  {"action":"add_box","ref":"r1","boxType":"research","title":"Market research","prompt":"full prompt template for this box","content":"optional initial text (only useful for idea boxes)"}
- Wire boxes:    {"action":"connect","from":"r1","to":"r2"}   (refs of boxes you created, or titles of existing board boxes)
- Run a box:     {"action":"run_box","box":"r1"}              → its output is returned to you in the next turn
- Finish:        {"action":"finish","answer":"final Markdown answer to the user"}

## Rules
- ONE action per reply, and nothing but the JSON object.
- Prefer a small pipeline: usually create 2-4 boxes, connect them into a chain, then run them in order.
- Write each box's \`prompt\` so the box is self-contained and specific to THIS task (do not leave generic template text). Boxes pull their inputs from boxes connected upstream, available to them as {{inputs}}.
- Run boxes in dependency order — a box run before its upstream boxes have run gets no input.
- NEVER run or create an agent box, and never run the same box twice.
- Use existing boxes on the board when relevant (their titles are listed below) instead of recreating them.
- You have a limited step budget — plan to finish comfortably. When everything has run and the task is satisfiable, call finish with a concise Markdown answer summarizing what you built and the key results.`;

/** Data stored per-box, separate from React Flow's graph nodes. */
export interface BoxData {
  content: string;
  prompt: string;
  systemPrompt: string;
  output: string;
  status: BoxStatus;
  error?: string;
  imageData?: string;
  outputImage?: string;
  documents?: BoxDocument[];
  slides?: Slide[];
  code?: string;
  tokens?: { promptTokens: number; completionTokens: number; totalTokens: number };
  agentSteps?: AgentStep[];
  authorEmail?: string;
  authorName?: string;
  labelColor?: string;
  timerDurationMs?: number;
  timerStatus?: "idle" | "running" | "stopped" | "paused";
  timerStartedAt?: number;
  timerRemainingMs?: number;
  timerStartedBy?: string;
}

/** Metadata for each box type. */
export type BoxCategory = "input" | "worker" | "collab" | "custom";
export type BoxRole = "everyone" | "designer" | "developer" | "product";

export interface BoxTypeMeta {
  label: string;
  icon: string;
  color: string;
  description: string;
  hasAI: boolean;
  category: BoxCategory;
  roles: BoxRole[];
  defaultPrompt: string;
  defaultSystemPrompt: string;
  defaultWidth: number;
  defaultHeight: number;
}

export const BOX_TYPES: Record<BoxType, BoxTypeMeta> = {
  idea: { label: "Idea", icon: "💡", color: "#fbbf24", description: "Write down a basic idea. No AI — just your text.", hasAI: false, category: "input", roles: ["everyone"], defaultPrompt: "", defaultSystemPrompt: "", defaultWidth: 320, defaultHeight: 200 },
  agent: { label: "Agent", icon: "🤖", color: "#4f46e5", description: "Give the agent a task — it plans, creates boxes on the board, wires and runs them, then reports back.", hasAI: true, category: "worker", roles: ["everyone"], defaultPrompt: "", defaultSystemPrompt: AGENT_CONTROLLER_SYSTEM_PROMPT, defaultWidth: 400, defaultHeight: 480 },
  research: { label: "Research", icon: "🔍", color: "#60a5fa", description: "Research a topic using AI.", hasAI: true, category: "worker", roles: ["everyone"], defaultPrompt: "Research the following topic thoroughly.\n\nTopic:\n{{input_1}}", defaultSystemPrompt: "You are a thorough research assistant.", defaultWidth: 320, defaultHeight: 320 },
  summarize: { label: "Summarize", icon: "📋", color: "#a78bfa", description: "Combine and summarize multiple inputs.", hasAI: true, category: "worker", roles: ["everyone"], defaultPrompt: "Synthesize the following inputs.\n\n{{inputs}}", defaultSystemPrompt: "You are a synthesis expert.", defaultWidth: 320, defaultHeight: 320 },

  irPlanner: {
    label: "IR Planner",
    icon: "🚨",
    color: "#ef4444",
    description: "Generate a structured incident response plan aligned with SANS PICERL and NIST SP 800-61 Rev. 2.",
    hasAI: true,
    category: "worker",
    roles: ["everyone"],
    defaultPrompt: "Create a structured incident response plan based on the incident information below...\n\nIncident information:\n{{inputs}}",
    defaultSystemPrompt: "You are an incident response planning assistant...",
    defaultWidth: 400,
    defaultHeight: 520,
  },

  image: { label: "Image", icon: "🖼️", color: "#34d399", description: "Upload an image.", hasAI: false, category: "input", roles: ["designer"], defaultPrompt: "", defaultSystemPrompt: "", defaultWidth: 320, defaultHeight: 320 },
  documents: { label: "Documents", icon: "📎", color: "#64748b", description: "Upload files.", hasAI: false, category: "input", roles: ["everyone"], defaultPrompt: "", defaultSystemPrompt: "", defaultWidth: 340, defaultHeight: 380 },
  cartoon: { label: "Cartoon Profile", icon: "🎨", color: "#f472b6", description: "Generate cartoon profile pictures.", hasAI: true, category: "worker", roles: ["designer"], defaultPrompt: "Cartoon style 3D profile picture of {{input_1}}", defaultSystemPrompt: "", defaultWidth: 320, defaultHeight: 380 },
  slides: { label: "Slides", icon: "📊", color: "#fb923c", description: "Generate a pitch deck.", hasAI: true, category: "worker", roles: ["product", "designer"], defaultPrompt: "Create a 10-slide startup pitch deck.", defaultSystemPrompt: "You are a pitch deck creator.", defaultWidth: 380, defaultHeight: 380 },
  code: { label: "Code", icon: "💻", color: "#22d3ee", description: "Generate a React prototype.", hasAI: true, category: "worker", roles: ["developer"], defaultPrompt: "Create a React prototype.", defaultSystemPrompt: "You are a React developer.", defaultWidth: 440, defaultHeight: 420 },
  prd: { label: "PRD", icon: "📄", color: "#818cf8", description: "Generate a PRD.", hasAI: true, category: "worker", roles: ["product"], defaultPrompt: "Create a PRD.", defaultSystemPrompt: "You are a product manager.", defaultWidth: 360, defaultHeight: 380 },
  devplan: { label: "Dev Plan", icon: "🗺️", color: "#14b8a6", description: "Transform a PRD into a development plan.", hasAI: true, category: "worker", roles: ["developer"], defaultPrompt: "Create a simple development plan.", defaultSystemPrompt: "You are a pragmatic developer.", defaultWidth: 360, defaultHeight: 380 },
  ui: { label: "UI Design", icon: "✨", color: "#c026d3", description: "Generate beautiful React UIs.", hasAI: true, category: "worker", roles: ["designer"], defaultPrompt: "Design a beautiful React UI.", defaultSystemPrompt: "You are an expert UI designer.", defaultWidth: 440, defaultHeight: 420 },
  stitch: { label: "Stitch UI", icon: "🧵", color: "#0ea5e9", description: "Generate UI using Google Stitch.", hasAI: true, category: "worker", roles: ["designer"], defaultPrompt: "Generate a beautiful UI screen.", defaultSystemPrompt: "", defaultWidth: 440, defaultHeight: 420 },
  note: { label: "Note", icon: "🗒️", color: "#fbbf24", description: "Post-it note.", hasAI: false, category: "collab", roles: ["everyone"], defaultPrompt: "", defaultSystemPrompt: "", defaultWidth: 260, defaultHeight: 240 },
  label: { label: "Label", icon: "🏷️", color: "#64748b", description: "Colored label.", hasAI: false, category: "collab", roles: ["everyone"], defaultPrompt: "", defaultSystemPrompt: "", defaultWidth: 200, defaultHeight: 64 },
  timer: { label: "Timer", icon: "⏱️", color: "#06b6d4", description: "Shared countdown clock.", hasAI: false, category: "collab", roles: ["everyone"], defaultPrompt: "", defaultSystemPrompt: "", defaultWidth: 260, defaultHeight: 190 },
  custom: { label: "Custom", icon: "✨", color: "#6366f1", description: "Reusable AI box.", hasAI: true, category: "custom", roles: ["everyone"], defaultPrompt: "", defaultSystemPrompt: "", defaultWidth: 320, defaultHeight: 320 },

  securityAdvisor: {
    label: "Security Advisor",
    icon: "🛡️",
    color: "#3C6E71",
    description: "On-demand security and compliance guidance, available at any stage of the pipeline.",
    hasAI: true,
    category: "worker",
    roles: ["everyone"],
    defaultPrompt: "Review the connected content below and identify what stage of the pipeline it represents...\n\nContent:\n{{inputs}}",
    defaultSystemPrompt: "You are a Security Advisor available at any stage of an AI-assisted security/compliance pipeline.",
    defaultWidth: 320,
    defaultHeight: 280,
  },

  riskScorer: {
    label: "Risk Scorer",
    icon: "🎲",
    color: "#dc2626",
    description: "Scores identified threats by likelihood × impact and produces a prioritized risk register.",
    hasAI: true,
    category: "worker",
    roles: ["everyone"],
    defaultPrompt: "Given the threats or incident scenarios below, identify each distinct threat...\n\nThreats:\n{{inputs}}",
    defaultSystemPrompt: "You are a security risk analyst using a likelihood x impact scoring model.",
    defaultWidth: 360,
    defaultHeight: 360,
  },

  threatModeler: {
    label: "Threat Modeler",
    icon: "🧠",
    color: "#8B5CF6",
    description: "Identifies threats using STRIDE.",
    hasAI: true,
    category: "worker",
    roles: ["everyone"],
    defaultPrompt: "Analyze each asset using STRIDE...\n\nAsset Inventory:\n{{inputs}}",
    defaultSystemPrompt: "You are a threat modeling expert specializing in STRIDE methodology.",
    defaultWidth: 360,
    defaultHeight: 380,
  },

  assetMapper: {
    label: "Asset Mapper",
    icon: "🗂️",
    color: "#0f766e",
    description:
      "Identify, classify, and structure organisational assets for downstream security analysis.",
    hasAI: true,
    category: "worker",
    roles: ["everyone"],
    defaultPrompt:
      "Analyse the following information and create a structured asset inventory.\n\n" +
      "Identify relevant assets such as data, applications, systems, cloud services, infrastructure, people, and physical resources where applicable.\n\n" +
      "For each asset, provide:\n" +
      "- Asset Name\n" +
      "- Category\n" +
      "- Description\n" +
      "- Owner\n" +
      "- Classification (Public, Internal, Confidential, or Restricted)\n" +
      "- Location\n" +
      "- Dependencies\n" +
      "- Relevant compliance or regulatory tags\n" +
      "- Missing information or review flags\n\n" +
      "Do not invent missing information. If something cannot be determined from the input, mark it as Unknown / Requires Review.\n\n" +
      "Briefly explain classifications where useful. Focus only on identifying, organising, and classifying assets. Do not perform threat modelling or final risk scoring, as these are handled by downstream security boxes.\n\n" +
      "Input:\n{{inputs}}",
    defaultSystemPrompt:
      "You are a cybersecurity asset mapping assistant. Convert user and upstream system information into a clear, structured asset inventory. Be accurate, avoid assumptions, clearly flag missing information, and preserve useful relationships and dependencies between assets.",
    defaultWidth: 360,
    defaultHeight: 380,
  },

};

export const LABEL_COLORS = ["#e2e8f0", "#fde68a", "#fecdd3", "#a5f3fc", "#a7f3d0"];

export const AREA_COLORS = [
  { fill: "#fef3c7", border: "#fde68a", name: "Amber" },
  { fill: "#dbeafe", border: "#bfdbfe", name: "Blue" },
  { fill: "#d1fae5", border: "#a7f3d0", name: "Emerald" },
  { fill: "#fce7f3", border: "#fbcfe8", name: "Pink" },
  { fill: "#ede9fe", border: "#ddd6fe", name: "Violet" },
  { fill: "#cffafe", border: "#a5f3fc", name: "Cyan" },
  { fill: "#ffedd5", border: "#fed7aa", name: "Orange" },
  { fill: "#f1f5f9", border: "#e2e8f0", name: "Slate" },
];