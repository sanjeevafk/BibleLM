'use client';

import React, { useEffect, useMemo, useRef, useState, useCallback, useLayoutEffect, useSyncExternalStore } from 'react';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { Message } from './Message';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TranslationSelect } from './TranslationSelect';
import { Moon, Plus, Settings, Sun } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type ChatInnerProps = {
  customKey: string;
  onCustomKeyChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  isDarkMode: boolean;
  toggleDarkMode: () => void;
  onNewChat: () => void;
  key?: React.Key;
};

const TRANSLATION_STORAGE_KEY = 'biblelm-translation';
const DEFAULT_TRANSLATION = 'BSB';
const VALID_TRANSLATIONS = ['BSB', 'KJV', 'WEB', 'ASV', 'NHEB'];

export function Chat() {
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  const customKey = useSyncExternalStore(
    (onStoreChange: () => void) => {
      window.addEventListener('storage', onStoreChange);
      return () => window.removeEventListener('storage', onStoreChange);
    },
    () => (typeof window !== 'undefined' ? localStorage.getItem('groq-api-key') || '' : ''),
    () => ''
  );

  const DARK_MODE_KEY = 'biblelm-dark-mode';

  const isDarkMode = useSyncExternalStore(
    (onStoreChange: () => void) => {
      window.addEventListener('storage', onStoreChange);
      return () => window.removeEventListener('storage', onStoreChange);
    },
    () => {
      const stored = typeof window !== 'undefined' ? localStorage.getItem(DARK_MODE_KEY) : null;
      if (stored !== null) return stored === 'true';
      return typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)').matches : false;
    },
    () => false
  );

  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    if (mounted) {
      document.documentElement.classList.toggle('dark', isDarkMode);
    }
  }, [isDarkMode, mounted]);

  const saveCustomKey = (e: React.ChangeEvent<HTMLInputElement>) => {
    localStorage.setItem('groq-api-key', e.target.value);
    window.dispatchEvent(new Event('storage'));
  };

  const toggleDarkMode = () => {
    const next = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('biblelm-dark-mode', String(next));
    window.dispatchEvent(new Event('storage'));
  };

  const handleNewChat = () => {
    setResetKey((prev) => prev + 1);
  };

  if (!mounted) return null;

  return (
    <ChatInner
      key={resetKey}
      customKey={customKey}
      onCustomKeyChange={saveCustomKey}
      isDarkMode={isDarkMode}
      toggleDarkMode={toggleDarkMode}
      onNewChat={handleNewChat}
    />
  );
}

function ChatInner({
  customKey,
  onCustomKeyChange,
  isDarkMode,
  toggleDarkMode,
  onNewChat,
}: ChatInnerProps) {
  const [input, setInput] = useState('');
  const [rateLimitWarning, setRateLimitWarning] = useState<string | null>(null);
  const [selectedTranslation, setSelectedTranslation] = useState(() => {
    if (typeof window === 'undefined') {
      return DEFAULT_TRANSLATION;
    }
    const stored = localStorage.getItem(TRANSLATION_STORAGE_KEY);
    return stored && VALID_TRANSLATIONS.includes(stored) ? stored : DEFAULT_TRANSLATION;
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentContainerClass = 'w-full max-w-[720px] mx-auto px-3 sm:px-4';

  const chatFetch = useCallback(async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await fetch(input, init);
    const warning = response.headers.get('x-rate-limit-warning');
    setRateLimitWarning(warning);
    return response;
  }, []);

  const transport = useMemo(
    () =>
      new DefaultChatTransport<UIMessage>({
        fetch: chatFetch,
      }),
    [chatFetch]
  );

  const { messages, sendMessage, status, error } = useChat<UIMessage>({
    messages: [],
    transport,
  });

  const isLoading = status === 'submitted' || status === 'streaming';

  const shouldAutoScroll = useRef(true);

  useEffect(() => {
    localStorage.setItem(TRANSLATION_STORAGE_KEY, selectedTranslation);
  }, [selectedTranslation]);

  const scrollToBottom = useCallback((smooth = false) => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto',
      });
    }
  }, []);

  const handleScroll = useCallback(() => {
    if (scrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      // If within 100px of bottom, enable auto-scroll
      const atBottom = scrollHeight - scrollTop - clientHeight < 100;
      shouldAutoScroll.current = atBottom;
    }
  }, []);

  // Use useLayoutEffect to prevent flicker/jumps during renders
  useLayoutEffect(() => {
    if (shouldAutoScroll.current) {
      scrollToBottom();
    }
  }, [messages, isLoading, scrollToBottom]);

  // Initial scroll on mount
  useEffect(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  const handleTranslationChange = useCallback((newTranslation: string) => {
    setSelectedTranslation(newTranslation);
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    // Force auto-scroll to bottom when user sends a message
    shouldAutoScroll.current = true;

    try {
      await sendMessage(
        { text: trimmed },
        {
          body: {
            translation: selectedTranslation,
          },
          headers: customKey ? { Authorization: `Bearer ${customKey}` } : undefined,
        }
      );
      setInput('');
      // Ensure we scroll after sending
      setTimeout(() => scrollToBottom(true), 50);
    } catch (err) {
      console.error('Failed to send message:', err);
    }
  };

  return (
    <div className="flex min-h-[100vh] min-h-[100dvh] h-[100dvh] flex-col bg-background">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:border-x">
      {/* Header */}
      <header className="shrink-0 border-b bg-card/80 backdrop-blur-md">
        <div className={`${contentContainerClass} grid grid-cols-[auto_1fr_auto] items-center py-2.5 sm:py-3 md:py-4`}>
          <div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onNewChat}
              className="h-8 w-8 rounded-md border border-border bg-background hover:bg-muted/70"
              aria-label="Start new chat"
              title="New chat"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          <div className="justify-self-center text-center leading-tight">
            <span className="block font-serif text-lg sm:text-xl font-bold tracking-tight">BibleLM</span>
            <span className="block text-[9px] sm:text-[10px] text-muted-foreground font-medium uppercase tracking-widest">Scriptural Reporter</span>
          </div>

          <div className="justify-self-end flex items-center gap-3 shrink-0">
            <TranslationSelect
              value={selectedTranslation}
              onChange={handleTranslationChange}
              disabled={isLoading}
            />

            <Button variant="ghost" size="icon" onClick={toggleDarkMode} className="rounded-full w-9 h-9 hover:bg-muted/80">
              {isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-full w-9 h-9 hover:bg-muted/80">
                  <Settings className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72 mt-2">
                <DropdownMenuLabel className="font-serif text-lg px-3 pt-3">Settings</DropdownMenuLabel>
                <DropdownMenuSeparator className="mx-2" />
                <div className="p-3 space-y-4">
                  <div className="space-y-1.5 text-xs text-muted-foreground leading-normal">
                    <p>
                      The Librarian currently operates on a free, rate-limited resource.
                    </p>
                    <p>
                      To ensure uninterrupted service and deeper research capabilities, you may provide your own API key.
                    </p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">API Key (Stored Locally)</label>
                    <Input
                      type="password"
                      placeholder="Enter Groq API key..."
                      value={customKey}
                      onChange={onCustomKeyChange}
                      className="h-10 text-sm rounded-lg"
                    />
                    <p className="text-[10px] text-muted-foreground italic">Your key never leaves your browser.</p>
                  </div>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* Messages */}
      <section
        className="flex-1 min-h-0 overflow-y-auto"
        ref={scrollRef}
        onScroll={handleScroll}
      >
        {messages.length === 0 ? (
          <div className="flex min-h-full items-center justify-center py-6">
            <div className={`${contentContainerClass}`}>
              <div className="mx-auto rounded-2xl border bg-card/70 px-5 py-6 text-center shadow-sm">
                <h2 className="font-serif text-xl font-semibold tracking-tight">Welcome to BibleLM</h2>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                  I provide neutral, direct quotes of Scripture along with original Greek and Hebrew word meanings.
                </p>
                <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                  Ask me anything, such as <span className="italic">&quot;What does the Bible say about creation?&quot;</span>
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className={`${contentContainerClass} py-3 sm:py-4`}>
            <div className="flex flex-col gap-2 pb-4">
              {messages.map((message) => (
                <Message key={message.id} message={message} />
              ))}

              {isLoading && messages[messages.length - 1]?.role === 'user' && (
                <div className="flex justify-start my-4">
                  <div className="bg-muted border rounded-2xl rounded-bl-sm px-4 py-3 text-sm text-muted-foreground">
                    Retrieving verses...
                  </div>
                </div>
              )}

              {error && (
                <div className="mx-auto w-full max-w-md my-4 p-4 border border-destructive bg-destructive/10 text-destructive text-sm rounded-lg text-center">
                  {error.message || 'An error occurred. Please try again.'}
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Input Form */}
      <div className="sticky bottom-0 z-20 shrink-0 border-t bg-background/95 backdrop-blur">
        <div className={`${contentContainerClass} py-3 sm:py-4`}>
          {rateLimitWarning && (
            <div className="mb-2 w-full rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              {rateLimitWarning}
            </div>
          )}
          <form
            onSubmit={handleSubmit}
            className="relative flex items-center shadow-sm"
          >
            <Input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask a question..."
              disabled={isLoading}
              className="pr-12 py-3 sm:py-5 rounded-full text-sm sm:text-base"
            />
            <Button
              type="submit"
              disabled={isLoading || !input.trim()}
              size="icon"
              aria-label="Send message"
              className="absolute right-1.5 rounded-full h-9 w-9 sm:h-10 sm:w-10"
            >
              ✓
            </Button>
          </form>
          <p className="text-center text-[10px] text-muted-foreground/70 mt-1.5">
            Translation: {selectedTranslation} · Exact quotes, no commentary · OpenHebrewBible CC BY-NC 4.0
          </p>
        </div>
      </div>
      </div>
    </div>
  );
}
