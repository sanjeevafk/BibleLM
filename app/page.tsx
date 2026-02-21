'use client';

import { useState, useEffect, useSyncExternalStore } from 'react';

import { Chat } from '@/components/Chat';
import { Button } from '@/components/ui/button';
import { BookOpen, Sparkles, Languages, Search, ChevronRight, Moon, Sun } from 'lucide-react';

export default function Home() {
  const [showChat, setShowChat] = useState(false);
  
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  const isDarkMode = useSyncExternalStore(
    (onStoreChange) => {
      const mql = window.matchMedia('(prefers-color-scheme: dark)');
      mql.addEventListener('change', onStoreChange);
      return () => mql.removeEventListener('change', onStoreChange);
    },
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
    () => false
  );

  useEffect(() => {
    if (mounted) {
      document.documentElement.classList.toggle('dark', isDarkMode);
    }
  }, [isDarkMode, mounted]);

  const toggleDarkMode = () => {
    document.documentElement.classList.toggle('dark');
  };



  if (showChat) {
    return (
      <main className="min-h-screen bg-background">
        <Chat />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center space-y-12 relative overflow-hidden">
      {/* Theme Toggle */}
      <div className="absolute top-6 right-6 z-50">
        <Button variant="ghost" size="icon" onClick={toggleDarkMode} className="rounded-full">
          {mounted ? (isDarkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />) : <div className="h-5 w-5" />}
        </Button>
      </div>


      {/* Background decoration */}
      <div className="absolute inset-0 -z-10 h-full w-full bg-white dark:bg-zinc-950 bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] dark:bg-[radial-gradient(#27272a_1px,transparent_1px)] bg-size-[24px_24px] mask-[radial-gradient(ellipse_60%_60%_at_50%_50%,#000_70%,transparent_100%)]"></div>
      
      {/* Glow effect */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/5 rounded-full blur-[120px] -z-10 animate-pulse"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-primary/5 rounded-full blur-[120px] -z-10 animate-pulse"></div>

      <div className="max-w-4xl space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-1000 ease-out">
        <div className="flex flex-col items-center gap-6">
          <div className="p-3 bg-primary/10 rounded-2xl ring-1 ring-primary/20 shadow-xl shadow-primary/5">
            <BookOpen className="w-10 h-10 text-primary" />
          </div>
          <h1 className="text-6xl md:text-7xl font-serif font-black tracking-tighter bg-linear-to-b from-foreground to-foreground/70 bg-clip-text text-transparent">
            BibleLM
          </h1>
        </div>
        
        <p className="text-xl md:text-2xl text-muted-foreground font-light leading-relaxed max-w-2xl mx-auto">
          Scripture-first study through semantic RAG, direct scriptural reporting, 
          and original language word-level data.
        </p>

        <div className="flex flex-wrap justify-center gap-4 pt-6">
          <Button 
            size="lg" 
            onClick={() => setShowChat(true)}
            className="rounded-full px-10 h-14 text-lg font-semibold group relative overflow-hidden transition-all hover:scale-105 active:scale-95 shadow-2xl shadow-primary/20"
          >
            <span className="relative z-10 flex items-center gap-2">
              Begin Research
              <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </span>
            <div className="absolute inset-0 bg-linear-to-r from-primary to-primary/80 group-hover:opacity-90 transition-opacity"></div>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl w-full pt-20 animate-in fade-in slide-in-from-bottom-12 duration-1000 delay-300 ease-out">
        <div className="group relative flex flex-col items-center p-8 space-y-4 rounded-3xl border bg-card/40 backdrop-blur-md transition-all hover:bg-card/60 hover:-translate-y-1 hover:shadow-2xl hover:shadow-primary/5">
          <div className="p-3 bg-secondary/50 rounded-xl group-hover:scale-110 transition-transform">
            <Search className="w-6 h-6 text-primary" />
          </div>
          <h3 className="text-lg font-bold">Direct Quotes</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">Exact, neutral quotes from Scripture based on your inquiries, ensuring textual fidelity at all times.</p>
        </div>
        <div className="group relative flex flex-col items-center p-8 space-y-4 rounded-3xl border bg-card/40 backdrop-blur-md transition-all hover:bg-card/60 hover:-translate-y-1 hover:shadow-2xl hover:shadow-primary/5">
          <div className="p-3 bg-secondary/50 rounded-xl group-hover:scale-110 transition-transform">
            <Languages className="w-6 h-6 text-primary" />
          </div>
          <h3 className="text-lg font-bold">Original Meanings</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">Unpack the richness of original Greek and Hebrew with Strong&apos;s data and word-level definitions.</p>
        </div>
        <div className="group relative flex flex-col items-center p-8 space-y-4 rounded-3xl border bg-card/40 backdrop-blur-md transition-all hover:bg-card/60 hover:-translate-y-1 hover:shadow-2xl hover:shadow-primary/5">
          <div className="p-3 bg-secondary/50 rounded-xl group-hover:scale-110 transition-transform">
            <Sparkles className="w-6 h-6 text-primary" />
          </div>
          <h3 className="text-lg font-bold">Thematic Retrieval</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">Ask complex questions and receive cross-referenced passages from the BSB and other authoritative translations.</p>
        </div>
      </div>

      <footer className="pt-20 pb-8 text-sm text-muted-foreground/60 font-medium">
        BibleLM &copy; {new Date().getFullYear()} &bull; Built for deeper understanding
      </footer>
    </main>
  );
}
