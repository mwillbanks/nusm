import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Blocks,
  DatabaseZap,
  Gauge,
  PlugZap,
  Sparkles,
} from "lucide-react";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { Brand } from "@/components/brand";
import { baseOptions } from "@/lib/layout.shared";

export const Route = createFileRoute("/")({
  component: Home,
});

const highlights = [
  {
    description:
      "Keep TanStack Store semantics and add persistence only where your state needs it.",
    icon: Blocks,
    title: "A familiar core",
  },
  {
    description:
      "Persist an entire store or selected slices to localStorage, sessionStorage, or IndexedDB.",
    icon: DatabaseZap,
    title: "Persistence by design",
  },
  {
    description:
      "Inspect memory, adapter state, hydration, and mutations inside TanStack Devtools.",
    icon: Gauge,
    title: "State you can see",
  },
];

function Home() {
  return (
    <HomeLayout {...baseOptions()}>
      <main className="home-shell flex-1 overflow-hidden">
        <section className="relative mx-auto grid max-w-[90rem] grid-cols-[minmax(0,1fr)] gap-12 px-6 pb-20 pt-20 lg:grid-cols-[1.15fr_0.85fr] lg:px-12 lg:pb-28 lg:pt-28">
          <div className="hero-glow" aria-hidden="true" />
          <div className="relative z-10 min-w-0">
            <div className="mb-8 inline-flex rounded-full border border-cyan-500/20 bg-cyan-500/8 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
              Built on @tanstack/store
            </div>
            <div className="mb-8 lg:hidden">
              <Brand />
            </div>
            <h1 className="max-w-4xl text-balance text-5xl font-semibold leading-[0.98] tracking-[-0.055em] sm:text-7xl lg:text-[5.6rem]">
              Your application state,
              <span className="hero-gradient block">remembered.</span>
            </h1>
            <p className="mt-7 max-w-2xl text-pretty text-lg leading-8 text-fd-muted-foreground sm:text-xl">
              nusm adds resilient, adapter-based persistence, observable
              hydration, React hooks, and first-class Devtools to the small,
              reactive core you already know.
            </p>
            <div className="mt-10 flex flex-col gap-3 sm:flex-row">
              <Link
                className="group inline-flex items-center justify-center gap-2 rounded-full bg-fd-primary px-6 py-3 text-sm font-semibold text-fd-primary-foreground shadow-lg shadow-cyan-500/10 transition hover:-translate-y-0.5 hover:shadow-cyan-500/20"
                params={{ _splat: "getting-started/quick-start" }}
                to="/docs/$"
              >
                Get started
                <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
              </Link>
              <a
                className="inline-flex items-center justify-center gap-2 rounded-full border border-fd-border bg-fd-card/70 px-6 py-3 text-sm font-semibold backdrop-blur transition hover:border-cyan-500/40 hover:bg-fd-accent"
                href="https://github.com/mwillbanks/nusm"
              >
                View on GitHub
              </a>
            </div>
          </div>

          <div className="relative z-10 flex min-w-0 items-center">
            <div className="code-window w-full overflow-hidden rounded-3xl border border-fd-border/80 bg-slate-950 shadow-2xl shadow-cyan-950/25">
              <div className="flex items-center justify-between border-b border-white/10 px-5 py-3 text-xs text-slate-400">
                <span className="flex gap-1.5" aria-hidden="true">
                  <span className="size-2.5 rounded-full bg-rose-400/80" />
                  <span className="size-2.5 rounded-full bg-amber-300/80" />
                  <span className="size-2.5 rounded-full bg-emerald-400/80" />
                </span>
                counter.ts
              </div>
              <pre className="overflow-x-auto p-6 text-[0.82rem] leading-7 text-slate-300 sm:p-8 sm:text-sm">
                <code>
                  {[
                    "import {",
                    "  createNusmStore,",
                    "  createLocalStorageAdapter,",
                    '} from "nusm"',
                    "",
                    "const counter = createNusmStore(",
                    "  { count: 0 },",
                    "  {",
                    '    storeId: "counter",',
                    "    adapter: createLocalStorageAdapter(),",
                    '    persist: { strategy: "entire" },',
                    "  },",
                    ")",
                    "",
                    "await counter.ready",
                    "counter.setState((state) => ({",
                    "  count: state.count + 1,",
                    "}))",
                  ].join("\n")}
                </code>
              </pre>
            </div>
          </div>
        </section>

        <section className="border-y border-fd-border/70 bg-fd-card/35">
          <div className="mx-auto grid max-w-[90rem] gap-px px-6 py-6 md:grid-cols-3 lg:px-12">
            {highlights.map(({ description, icon: Icon, title }) => (
              <article className="feature-card p-6 sm:p-8" key={title}>
                <Icon className="mb-5 size-6 text-cyan-600 dark:text-cyan-400" />
                <h2 className="text-lg font-semibold tracking-tight">
                  {title}
                </h2>
                <p className="mt-3 text-sm leading-6 text-fd-muted-foreground">
                  {description}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-[90rem] px-6 py-20 lg:px-12 lg:py-28">
          <div className="mb-12 flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div>
              <p className="mb-3 text-sm font-semibold text-cyan-700 dark:text-cyan-300">
                Choose your path
              </p>
              <h2 className="max-w-2xl text-3xl font-semibold tracking-[-0.035em] sm:text-5xl">
                From first store to full visibility.
              </h2>
            </div>
            <p className="max-w-md text-sm leading-6 text-fd-muted-foreground">
              Learn the core in minutes, then go deeper on hydration, adapter
              contracts, selective persistence, and the live inspector.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <JourneyCard
              icon={Sparkles}
              label="01 / Start"
              slug="getting-started/quick-start"
              text="Create a typed persistent store and wait for hydration."
              title="Quick Start"
            />
            <JourneyCard
              icon={PlugZap}
              label="02 / Extend"
              slug="storage-adapters/custom-adapters"
              text="Connect any storage system through a small, explicit interface."
              title="Custom adapters"
            />
            <JourneyCard
              icon={Gauge}
              label="03 / Inspect"
              slug="devtools"
              text="Explore memory, persistence, hydration, and mutations in context."
              title="Devtools"
            />
          </div>
        </section>
      </main>
    </HomeLayout>
  );
}

type JourneyCardProps = {
  icon: typeof Sparkles;
  label: string;
  slug: string;
  text: string;
  title: string;
};

function JourneyCard({
  icon: Icon,
  label,
  slug,
  text,
  title,
}: JourneyCardProps) {
  return (
    <Link
      className="journey-card group rounded-2xl border border-fd-border bg-fd-card p-6 transition hover:-translate-y-1 hover:border-cyan-500/40 hover:shadow-xl hover:shadow-cyan-950/5"
      params={{ _splat: slug }}
      to="/docs/$"
    >
      <div className="flex items-start justify-between">
        <span className="font-mono text-xs text-fd-muted-foreground">
          {label}
        </span>
        <Icon className="size-5 text-cyan-600 dark:text-cyan-400" />
      </div>
      <h3 className="mt-10 text-xl font-semibold tracking-tight">{title}</h3>
      <p className="mt-3 text-sm leading-6 text-fd-muted-foreground">{text}</p>
      <span className="mt-7 inline-flex items-center gap-2 text-sm font-semibold text-cyan-700 dark:text-cyan-300">
        Read guide
        <ArrowRight className="size-4 transition group-hover:translate-x-1" />
      </span>
    </Link>
  );
}
