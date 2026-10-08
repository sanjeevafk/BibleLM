'use client';

import React, { useEffect, useRef, useState, useCallback, useLayoutEffect, useSyncExternalStore } from 'react';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { Message } from './Message';
import { Button } from '@/components/ui/button';
import { TranslationSelect } from './TranslationSelect';
import { StudyPane } from './study/StudyPane';
import { useStudyPane } from './study/useStudyPane';
import { ArrowDown, ArrowUp, Moon, Plus, RotateCcw, Sparkles, Sun, Square } from 'lucide-react';

type ChatInnerProps = {
  isDarkMode: boolean;
  toggleDarkMode: () => void;
  onNewChat: () => void;
};

const TRANSLATION_STORAGE_KEY = 'biblelm-translation';
const DEFAULT_TRANSLATION = 'BSB';
const VALID_TRANSLATIONS = ['BSB', 'KJV', 'WEB', 'ASV', 'NHEB'];

const STARTER_PROMPTS = [
  'Good Samaritan in Greek',
  'Romans 8:28 context',
  'What does the Bible say about faith?',
  'Genesis 1:1 original words',
];

/** Plain-text snapshot of an assistant message (for streaming phase UI). */
function getAssistantText(message: UIMessage): string {
  const parts = (message as unknown as { parts?: Array<{ type?: string; text?: string }> }).parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .filter((part) => part?.type === 'text')
    .map((part) => part.text || '')
    .join('');
}

export function Chat() {
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
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
      isDarkMode={isDarkMode}
      toggleDarkMode={toggleDarkMode}
      onNewChat={handleNewChat}
    />
  );
}

function ChatInner({
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

  const study = useStudyPane();
  const [studyPrimary, setStudyPrimary] = useState(selectedTranslation);
  const [studySecondary, setStudySecondary] = useState(
    selectedTranslation === 'KJV' ? 'WEB' : 'KJV'
  );

  // The study pane opens on the chat translation unless the user picked
  // explicit study translations already.
  useEffect(() => {
    if (!study.isOpen) {
      setStudyPrimary(selectedTranslation);
      setStudySecondary(selectedTranslation === 'KJV' ? 'WEB' : 'KJV');
    }
  }, [selectedTranslation, study.isOpen]);

  const chatFetch = useCallback(async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await fetch(input, init);
    const warning = response.headers.get('x-rate-limit-warning');
    setRateLimitWarning(warning);
    return response;
  }, []);

  const transport = React.useMemo(
    () =>
      new DefaultChatTransport<UIMessage>({
        fetch: chatFetch,
      }),
    [chatFetch]
  );

  const { messages, sendMessage, regenerate, stop, status, error } = useChat<UIMessage>({
    messages: [],
    transport,
  });

  const isLoading = status === 'submitted' || status === 'streaming';

  const shouldAutoScroll = useRef(true);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isProgrammaticScroll = useRef(false);
  const programmaticScrollTimer = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    localStorage.setItem(TRANSLATION_STORAGE_KEY, selectedTranslation);
  }, [selectedTranslation]);

  const setProgrammaticScroll = useCallback(() => {
    isProgrammaticScroll.current = true;
    if (programmaticScrollTimer.current) {
      clearTimeout(programmaticScrollTimer.current);
    }
    programmaticScrollTimer.current = setTimeout(() => {
      isProgrammaticScroll.current = false;
    }, 600);
  }, []);

  const scrollToBottom = useCallback((smooth = false) => {
    if (scrollRef.current) {
      if (smooth) {
        setProgrammaticScroll();
      }
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto',
      });
    }
  }, [setProgrammaticScroll]);

  const handleScrollToBottom = useCallback(() => {
    // Re-pin follow mode so appended stream tokens keep us at the bottom
    // even though content grows mid-flight.
    shouldAutoScroll.current = true;
    setIsAtBottom(true);
    scrollToBottom(true);
  }, [scrollToBottom]);

  const handleUserScrollIntent = useCallback(() => {
    isProgrammaticScroll.current = false;
    if (programmaticScrollTimer.current) {
      clearTimeout(programmaticScrollTimer.current);
      programmaticScrollTimer.current = null;
    }
  }, []);

  const handleScroll = useCallback(() => {
    if (scrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      // Disengage autoscroll as soon as the user scrolls up past 40px.
      const atBottom = scrollHeight - scrollTop - clientHeight < 40;
      if (atBottom) {
        isProgrammaticScroll.current = false;
        shouldAutoScroll.current = true;
        setIsAtBottom(true);
      } else if (!isProgrammaticScroll.current) {
        shouldAutoScroll.current = false;
        setIsAtBottom(false);
      }
    }
  }, []);

  useLayoutEffect(() => {
    if (shouldAutoScroll.current && messages.length > 0) {
      scrollToBottom();
    }
  }, [messages, isLoading, scrollToBottom]);

  useEffect(() => {
    if (messages.length > 0) {
      scrollToBottom();
    }
  }, [messages.length, scrollToBottom]);

  useEffect(() => {
    const handleResize = () => handleScroll();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [handleScroll]);

  const handleTranslationChange = useCallback((newTranslation: string) => {
    setSelectedTranslation(newTranslation);
  }, []);

  const submitQuery = useCallback(async (rawText: string) => {
    const trimmed = rawText.trim();
    if (!trimmed || isLoading) return;

    shouldAutoScroll.current = true;
    setIsAtBottom(true);

    try {
      await sendMessage(
        { text: trimmed },
        {
          body: {
            translation: selectedTranslation,
          },
        }
      );
      setInput('');
      setTimeout(() => scrollToBottom(true), 50);
    } catch (err) {
      console.error('Failed to send message:', err);
    }
  }, [isLoading, scrollToBottom, selectedTranslation, sendMessage]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submitQuery(input);
  };

  const handleRetry = useCallback(() => {
    // Resubmits the previous user prompt without duplicating it.
    void regenerate({ body: { translation: selectedTranslation } });
  }, [regenerate, selectedTranslation]);

  // Auto-grow the composer up to its max height and keep scroll anchored if at bottom.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    if (shouldAutoScroll.current && messages.length > 0) {
      scrollToBottom();
    }
  }, [input, messages.length, scrollToBottom]);

  const lastMessage = messages[messages.length - 1];
  const lastAssistantText = lastMessage?.role === 'assistant' ? getAssistantText(lastMessage) : '';
  // Pre-token progress: the worker tags stream-open metadata with
  // phase: 'synthesizing', and no assistant text yet means no tokens
  // have arrived — show the active progress bubble below.
  const showSynthesizing =
    isLoading && lastMessage?.role === 'assistant' && !lastAssistantText;

  return (
    <div className="flex min-h-[100vh] min-h-[100dvh] h-[100dvh] flex-col bg-background">
      <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden md:border-x">
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
          </div>
        </div>
      </header>

      {/* Messages */}
      <section
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden"
        ref={scrollRef}
        onScroll={handleScroll}
        onWheel={handleUserScrollIntent}
        onTouchMove={handleUserScrollIntent}
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
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2" role="group" aria-label="Starter prompts">
                  {STARTER_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      disabled={isLoading}
                      onClick={() => void submitQuery(prompt)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground/80 shadow-sm transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Sparkles className="h-3 w-3 text-primary/60" />
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className={`${contentContainerClass} py-3 sm:py-4`}>
            <div className="flex flex-col gap-2 pb-4">
              {messages.map((message) => (
                <Message
                  key={message.id}
                  message={message}
                  onExploreVerse={study.openStudy}
                  isStreaming={isLoading && message.id === lastMessage?.id && message.role === 'assistant'}
                />
              ))}

              {isLoading && (!lastMessage || lastMessage.role === 'user') && (
                <div className="flex justify-start my-4" role="status" aria-live="polite">
                  <div className="bg-muted border rounded-2xl rounded-bl-sm px-4 py-3 text-sm text-muted-foreground animate-pulse">
                    Retrieving verses...
                  </div>
                </div>
              )}

              {showSynthesizing && (
                <div className="flex justify-start my-4" role="status" aria-live="polite">
                  <div className="bg-muted border rounded-2xl rounded-bl-sm px-4 py-3 text-sm text-muted-foreground animate-pulse">
                    Synthesizing response...
                  </div>
                </div>
              )}

              {error && (
                <div className="mx-auto w-full max-w-md my-4 p-4 border border-destructive bg-destructive/10 text-destructive text-sm rounded-lg text-center">
                  <p>{error.message || 'An error occurred. Please try again.'}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRetry}
                    className="mt-3 gap-1.5"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Retry
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Floating scroll-to-bottom button */}
      {!isAtBottom && messages.length > 0 && (
        <Button
          size="icon"
          onClick={handleScrollToBottom}
          aria-label="Scroll to bottom"
          title="Scroll to bottom"
          className="absolute bottom-24 right-4 z-10 h-10 w-10 rounded-full shadow-lg"
        >
          <ArrowDown className="h-4 w-4" />
        </Button>
      )}

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
            className="relative shadow-sm"
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void submitQuery(input);
                }
              }}
              placeholder="Ask a question..."
              disabled={isLoading}
              rows={1}
              aria-label="Ask a question"
              className="max-h-40 min-h-[48px] w-full resize-none overflow-y-auto rounded-3xl border border-input bg-background py-3 pl-4 pr-12 text-sm shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 sm:text-base"
            />
            {isLoading ? (
              <Button
                type="button"
                onClick={stop}
                size="icon"
                aria-label="Stop generating"
                title="Stop generating"
                className="absolute bottom-1.5 right-1.5 rounded-full h-9 w-9 sm:h-10 sm:w-10"
              >
                <Square className="h-4 w-4 fill-current" />
              </Button>
            ) : (
              <Button
                type="submit"
                disabled={!input.trim()}
                size="icon"
                aria-label="Send message"
                className="absolute bottom-1.5 right-1.5 rounded-full h-9 w-9 sm:h-10 sm:w-10"
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
            )}
          </form>
          <p className="text-center text-[10px] text-muted-foreground/70 mt-1.5">
            Translation: {selectedTranslation} · Exact quotes, no commentary · OpenHebrewBible CC BY-NC 4.0
          </p>
        </div>
      </div>
      </div>

      {/* Desktop (≥1024px): side-by-side split view */}
      {study.isOpen && study.target && (
        <aside
          aria-label="Side-by-side study pane"
          className="hidden min-h-0 w-[400px] shrink-0 border-l bg-card lg:flex xl:w-[520px]"
        >
          <div className="h-full min-h-0 w-full">
            <StudyPane
              target={study.target}
              primary={studyPrimary}
              secondary={studySecondary}
              onPrimaryChange={setStudyPrimary}
              onSecondaryChange={setStudySecondary}
              onClose={study.closeStudy}
              onNavigateChapter={study.navigateChapter}
              onFocusPericope={study.focusPericope}
            />
          </div>
        </aside>
      )}
      </div>

      {/* Mobile / tablet (<1024px): slide-out drawer */}
      {study.isOpen && study.target && (
        <div className="lg:hidden">
          <div
            aria-hidden="true"
            onClick={study.closeStudy}
            className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm"
          />
          <aside
            aria-label="Side-by-side study pane"
            role="dialog"
            aria-modal="true"
            className="fixed inset-y-0 right-0 z-50 flex w-[min(100vw,440px)] flex-col border-l bg-card shadow-xl"
          >
            <StudyPane
              target={study.target}
              primary={studyPrimary}
              secondary={studySecondary}
              onPrimaryChange={setStudyPrimary}
              onSecondaryChange={setStudySecondary}
              onClose={study.closeStudy}
              onNavigateChapter={study.navigateChapter}
              onFocusPericope={study.focusPericope}
            />
          </aside>
        </div>
      )}
    </div>
  );
}
