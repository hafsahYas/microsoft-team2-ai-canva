import Reveal from "./Reveal.js";

const ROLES = [
  {
    icon: "🎨",
    title: "For designers",
    color: "#f472b6",
    points: [
      "Generate polished UIs with Tailwind or Google Stitch",
      "Turn research into visual screens and prototypes",
      "A palette tuned to design boxes",
    ],
  },
  {
    icon: "💻",
    title: "For developers",
    color: "#22d3ee",
    points: [
      "Go from PRD to a working React prototype",
      "Preview code live in a sandboxed iframe",
      "Track token usage per run",
    ],
  },
  {
    icon: "📊",
    title: "For product & PMs",
    color: "#fb923c",
    points: [
      "Draft PRDs and pitch decks from research",
      "Align requirements before a line of code",
      "Share one board across the whole team",
    ],
  },
  {
    icon: "🔁",
    title: "For SDLC teams",
    color: "#4f46e5",
    points: [
      "Intent → spec → plan → implementation → review → merge, gated",
      "Approve, send back or edit every artifact — versions are never lost",
      "Export the whole chain as one audit document",
    ],
  },
];

export default function LandingRoles() {
  return (
    <section id="for-teams" className="border-t border-white/5 py-20">
      <div className="mx-auto max-w-6xl px-5">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-white md:text-4xl">
            Built for the whole team
          </h2>
          <p className="mt-3 text-slate-400">
            One shared canvas, with a palette that adapts to how each role works.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {ROLES.map((role, i) => (
            <Reveal key={role.title} delay={i * 120}>
              <div className="h-full rounded-2xl border border-white/10 bg-white/5 p-6 transition hover:border-white/20 hover:bg-white/[0.07]">
                <div
                  className="flex h-11 w-11 items-center justify-center rounded-xl text-2xl"
                  style={{ backgroundColor: role.color + "1f" }}
                >
                  {role.icon}
                </div>
                <h3 className="mt-4 text-lg font-semibold text-white">{role.title}</h3>
                <ul className="mt-3 space-y-2">
                  {role.points.map((p) => (
                    <li key={p} className="flex items-start gap-2 text-sm text-slate-400">
                      <span className="mt-0.5 text-emerald-400">✓</span>
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
