"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import {
  BookOpen,
  Sparkles,
  Languages,
  Search,
  ChevronRight,
  Moon,
  Sun,
  Github,
  Layers,
} from "lucide-react";

export default function Home() {
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const isDarkMode = useSyncExternalStore(
    (onStoreChange) => {
      const mql = window.matchMedia("(prefers-color-scheme: dark)");
      mql.addEventListener("change", onStoreChange);
      return () => mql.removeEventListener("change", onStoreChange);
    },
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
    () => false,
  );

  useEffect(() => {
    if (mounted) {
      document.documentElement.classList.toggle("dark", isDarkMode);
    }
  }, [isDarkMode, mounted]);

  const toggleDarkMode = () => {
    document.documentElement.classList.toggle("dark");
  };

  return (
    <main className="min-h-screen bg-background flex flex-col items-center justify-start p-4 md:p-6 pt-16 md:pt-20 pb-20 md:pb-24 text-center space-y-12 md:space-y-16 relative overflow-hidden">
      {/* Header Links */}
      <div className="absolute top-6 right-6 z-50 flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild className="rounded-full w-14 h-14 md:w-16 md:h-16">
          <a href="https://github.com/voidcommit-afk/BibleLM" target="_blank" rel="noopener noreferrer" title="View on GitHub">
            <Github className="h-7 w-7 md:h-8 md:w-8" />
          </a>
        </Button>
        <Button variant="ghost" size="icon" onClick={toggleDarkMode} className="rounded-full w-14 h-14 md:w-16 md:h-16">
          {mounted ? (isDarkMode ? <Sun className="h-7 w-7 md:h-8 md:w-8" /> : <Moon className="h-7 w-7 md:h-8 md:w-8" />) : <div className="h-7 w-7 md:h-8 md:w-8" />}
        </Button>
      </div>

      {/* Background decoration */}
      <div className="absolute inset-0 -z-10 h-full w-full bg-white dark:bg-zinc-950 bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] dark:bg-[radial-gradient(#27272a_1px,transparent_1px)] bg-size-[24px_24px] mask-[radial-gradient(ellipse_60%_60%_at_50%_50%,#000_70%,transparent_100%)]"></div>

      {/* Glow effect */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/5 rounded-full blur-[120px] -z-10 animate-pulse"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-primary/5 rounded-full blur-[120px] -z-10 animate-pulse"></div>

      <div className="max-w-4xl space-y-6 md:space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-1000 ease-out">
        <div className="flex flex-col items-center gap-6">
          <div className="p-3 bg-primary/10 rounded-2xl ring-1 ring-primary/20 shadow-xl shadow-primary/5">
            <BookOpen className="w-10 h-10 text-primary" />
          </div>
          <h1 className="text-4xl sm:text-5xl md:text-7xl font-serif font-black tracking-tighter bg-linear-to-b from-foreground to-foreground/70 bg-clip-text text-transparent">
            BibleLM
          </h1>
          <p className="text-base sm:text-lg md:text-xl font-semibold tracking-wide text-primary/90">
            The Scripture-First Bible Chatbot
          </p>
          <p className="text-sm sm:text-base text-foreground/70">Made for His Glory ✝️</p>
        </div>

        <p className="text-lg sm:text-xl md:text-2xl text-muted-foreground font-light leading-relaxed max-w-3xl mx-auto">
          Zero-cost. Edge-safe. Precision-first.
        </p>

        <p className="text-base sm:text-lg md:text-xl text-foreground/80 leading-relaxed max-w-3xl mx-auto">
          Ask anything. Get <span className="font-semibold text-foreground">exact verse quotes</span>,
          <span className="font-semibold text-foreground"> original Hebrew/Greek insights</span>, and
          <span className="font-semibold text-foreground"> cross-references</span>, with no commentary,
          no softening, no modern spin.
        </p>

        <div className="flex flex-wrap justify-center gap-4 pt-6">
          <Button
            size="lg"
            asChild
            className="rounded-full px-10 h-14 text-base sm:text-lg font-semibold group relative overflow-hidden transition-all hover:scale-105 active:scale-95 shadow-2xl shadow-primary/20"
          >
            <a href="/chat">
              <span className="relative z-10 flex items-center gap-2">
                Try it now → Start Chatting
                <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </span>
              <div className="absolute inset-0 bg-linear-to-r from-primary to-primary/80 group-hover:opacity-90 transition-opacity"></div>
            </a>
          </Button>
        </div>
      </div>

      <section className="max-w-5xl w-full space-y-6 pt-6 md:pt-10 animate-in fade-in slide-in-from-bottom-12 duration-1000 delay-300 ease-out">
        <h2 className="text-2xl sm:text-3xl md:text-4xl font-semibold">Core Strengths</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
          <div className="group relative flex flex-col items-center p-6 md:p-8 space-y-4 rounded-3xl border bg-card/40 backdrop-blur-md transition-all hover:bg-card/60 hover:-translate-y-1 hover:shadow-2xl hover:shadow-primary/5">
            <div className="p-3 bg-secondary/50 rounded-xl group-hover:scale-110 transition-transform">
              <Search className="w-6 h-6 text-primary" />
            </div>
            <h3 className="text-lg font-bold">Exact Citations Only</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Every answer quotes real verses with chapter:verse refs. No invented content.
            </p>
          </div>
          <div className="group relative flex flex-col items-center p-6 md:p-8 space-y-4 rounded-3xl border bg-card/40 backdrop-blur-md transition-all hover:bg-card/60 hover:-translate-y-1 hover:shadow-2xl hover:shadow-primary/5">
            <div className="p-3 bg-secondary/50 rounded-xl group-hover:scale-110 transition-transform">
              <Languages className="w-6 h-6 text-primary" />
            </div>
            <h3 className="text-lg font-bold">Mandatory Original-Language Depth</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Every relevant word shows Strong&apos;s number, transliteration, gloss, plus advanced layers:
              Clause segmentation & boundaries • Poetic parallelism & structure • BHS ↔ WLC alignments • Extended glosses & features
            </p>
            <p className="text-xs text-muted-foreground">
              Powered by MorphHB + OpenHebrewBible subset
            </p>
          </div>
          <div className="group relative flex flex-col items-center p-6 md:p-8 space-y-4 rounded-3xl border bg-card/40 backdrop-blur-md transition-all hover:bg-card/60 hover:-translate-y-1 hover:shadow-2xl hover:shadow-primary/5">
            <div className="p-3 bg-secondary/50 rounded-xl group-hover:scale-110 transition-transform">
              <Layers className="w-6 h-6 text-primary" />
            </div>
            <h3 className="text-lg font-bold">Hybrid Retrieval (Lexical + Semantic)</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Fuse.js lexical search + embeddings with Reciprocal Rank Fusion, plus domain-aware boosts and query expansion.
              Strict dedupe by verseId, with topK capped at 10–15.
            </p>
          </div>
          <div className="group relative flex flex-col items-center p-6 md:p-8 space-y-4 rounded-3xl border bg-card/40 backdrop-blur-md transition-all hover:bg-card/60 hover:-translate-y-1 hover:shadow-2xl hover:shadow-primary/5">
            <div className="p-3 bg-secondary/50 rounded-xl group-hover:scale-110 transition-transform">
              <BookOpen className="w-6 h-6 text-primary" />
            </div>
            <h3 className="text-lg font-bold">Neutrality Enforced</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Rigid system prompt bans interpretation, application, or bias. Handles controversial topics with raw text + guards (no dilution).
            </p>
          </div>
          <div className="group relative flex flex-col items-center p-6 md:p-8 space-y-4 rounded-3xl border bg-card/40 backdrop-blur-md transition-all hover:bg-card/60 hover:-translate-y-1 hover:shadow-2xl hover:shadow-primary/5">
            <div className="p-3 bg-secondary/50 rounded-xl group-hover:scale-110 transition-transform">
              <Sparkles className="w-6 h-6 text-primary" />
            </div>
            <h3 className="text-lg font-bold">Zero-Cost Forever</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Vercel Hobby + free-tier providers + Upstash Redis + static bundles. Optional BYOK for larger models.
            </p>
          </div>
          <div className="group relative flex flex-col items-center p-6 md:p-8 space-y-4 rounded-3xl border bg-card/40 backdrop-blur-md transition-all hover:bg-card/60 hover:-translate-y-1 hover:shadow-2xl hover:shadow-primary/5">
            <div className="p-3 bg-secondary/50 rounded-xl group-hover:scale-110 transition-transform">
              <Search className="w-6 h-6 text-primary" />
            </div>
            <h3 className="text-lg font-bold">Edge-Safe & Private</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Edge-compatible runtime, no user accounts, no tracking.
            </p>
          </div>
        </div>
      </section>

      <section className="max-w-4xl w-full pt-2 md:pt-4">
        <div className="rounded-3xl border bg-card/60 backdrop-blur-md px-6 py-6 md:px-10 md:py-8 shadow-xl shadow-primary/5">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-semibold">How It Works</h2>
          <ol className="mt-4 space-y-3 text-sm sm:text-base md:text-lg text-foreground/80">
            <li>Ask a question (e.g., &quot;What does the Bible say about divorce?&quot; or &quot;Break down John 1:1 in Greek&quot;).</li>
            <li>Query expansion + hybrid ranking find the most relevant verses.</li>
            <li>Get direct quotes + cross-refs + original-language layers. No fluff, just Scripture speaking for itself.</li>
          </ol>
        </div>
      </section>

      <section className="max-w-4xl w-full pt-2 md:pt-4">
        <div className="rounded-3xl border bg-card/60 backdrop-blur-md px-6 py-6 md:px-10 md:py-8 shadow-xl shadow-primary/5">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-semibold">Current Sources</h2>
          <ul className="mt-4 space-y-2 text-sm sm:text-base md:text-lg text-foreground/80">
            <li><span className="font-semibold">Default Translation:</span> Berean Study Bible (BSB)</li>
            <li><span className="font-semibold">Original Languages:</span> OpenScriptures MorphHB, OpenHebrewBible layers (CC BY-NC 4.0), Strong&apos;s Concordance</li>
            <li><span className="font-semibold">Cross-References:</span> Treasury of Scripture Knowledge (TSK)</li>
            <li><span className="font-semibold">Retrieval Stack:</span> Fuse.js lexical search, embeddings + pgvector, RRF, and metadata-aware boosts</li>
            <li><span className="font-semibold">Fallbacks:</span> Public free APIs (bolls.life, etc.)</li>
          </ul>
        </div>
      </section>

      <section className="max-w-4xl w-full pt-2 md:pt-4">
        <div className="rounded-3xl border bg-card/60 backdrop-blur-md px-6 py-6 md:px-10 md:py-8 shadow-xl shadow-primary/5">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-semibold">Why BibleLM Stands Out</h2>
          <p className="mt-4 text-sm sm:text-base md:text-lg text-foreground/80 leading-relaxed">
            Most Bible AIs add commentary, balance, or &quot;helpful&quot; interpretation. BibleLM refuses to.
            It stays true to the text, prioritizes original languages, and lets Scripture speak without editorial voice.
          </p>
        </div>
      </section>

      <footer className="pt-12 md:pt-16 pb-8 text-base sm:text-lg text-muted-foreground/80 font-semibold flex flex-col items-center gap-4">
        <div className="flex items-center gap-4">
          <a 
            href="https://github.com/voidcommit-afk/BibleLM" 
            target="_blank" 
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 hover:text-foreground transition-colors"
          >
            <Github className="w-6 h-6" />
            GitHub
          </a>
        </div>
        <div>
          MIT Licensed &bull; Built for truth-seekers &bull; Actively evolving (hybrid retrieval + metadata boosts now live)
        </div>
        <div>
          BibleLM &copy; {new Date().getFullYear()}
        </div>
      </footer>
    </main>
  );
}
