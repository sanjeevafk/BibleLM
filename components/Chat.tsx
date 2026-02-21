'use client';

import React, { useEffect, useMemo, useRef, useState, useCallback, useLayoutEffect } from 'react';
import { useChat } from '@ai-sdk/react';
import type { UIMessage } from 'ai';
import { Message } from './Message';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Moon, Settings, Sun, Trash2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type ChatInnerProps = {
  customKey: string;
  onCustomKeyChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  isDarkMode: boolean;
  toggleDarkMode: () => void;
  onClearChat: () => void;
};

export function Chat() {
  const [customKey, setCustomKey] = useState(() => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem('groq-api-key') || '';
  });
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode);
  }, [isDarkMode]);

  const saveCustomKey = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCustomKey(e.target.value);
    localStorage.setItem('groq-api-key', e.target.value);
  };

  const toggleDarkMode = () => {
    const isDark = document.documentElement.classList.toggle('dark');
    setIsDarkMode(isDark);
  };

  const resetChat = () => {
    setResetKey((prev) => prev + 1);
  };

  return (
    <ChatInner
      key={resetKey}
      customKey={customKey}
      onCustomKeyChange={saveCustomKey}
      isDarkMode={isDarkMode}
      toggleDarkMode={toggleDarkMode}
      onClearChat={resetChat}
    />
  );
}

function ChatInner({
  customKey,
  onCustomKeyChange,
  isDarkMode,
  toggleDarkMode,
  onClearChat,
}: ChatInnerProps) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const translation = 'BSB';
  const initialMessages = useMemo<UIMessage[]>(
    () => [
      {
        id: 'welcome',
        role: 'assistant',
        parts: [
          {
            type: 'text',
            text: 'Welcome to BibleLM. I provide neutral, direct quotes of Scripture along with original Greek and Hebrew word meanings. Ask me anything, such as *"What does the Bible say about creation?"*',
          },
        ],
      },
    ],
    []
  );

  const { messages, sendMessage, status, error, clearError } = useChat<UIMessage>({
    messages: initialMessages,
  });

  const isLoading = status === 'submitted' || status === 'streaming';

  const shouldAutoScroll = useRef(true);

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

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    // Force auto-scroll to bottom when user sends a message
    shouldAutoScroll.current = true;
    
    await sendMessage(
      { text: trimmed },
      {
        body: {
          translation,
          customApiKey: customKey || undefined,
        },
      }
    );
    setInput('');
    // Ensure we scroll after sending
    setTimeout(() => scrollToBottom(true), 50);
  };

  const handleClearChat = () => {
    clearError();
    onClearChat();
  };

  return (
    <div className="flex flex-col h-screen max-w-4xl mx-auto border-x bg-background">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b bg-card/80 backdrop-blur-md sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="bg-primary text-primary-foreground p-1.5 rounded-lg shadow-md ring-1 ring-primary-foreground/10 flex items-center justify-center">
            <svg 
              viewBox="0 0 24 24" 
              fill="currentColor" 
              className="h-5 w-5"
            >
              <path d="M13 3h-2v6H5v2h6v10h2V11h6V9h-6V3z" />
            </svg>
          </div>

          <div className="flex flex-col">
            <div className="flex items-baseline gap-1">
              <span className="font-serif text-xl font-bold tracking-tight">BibleLM</span>
              <span className="text-[10px] text-muted-foreground font-bold italic opacity-70 lowercase">in beta</span>
            </div>
            <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-widest leading-none">Scriptural Reporter</span>
          </div>
        </div>


        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={toggleDarkMode} className="rounded-full hover:bg-muted/80">
            {isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full hover:bg-muted/80">
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
      </header>


      {/* Messages */}
      <ScrollArea 
        className="flex-1 p-4" 
        ref={scrollRef} 
        onScroll={handleScroll}
      >
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
      </ScrollArea>

      {/* Input Form */}
      <div className="p-4 bg-background border-t">
        <form 
          onSubmit={handleSubmit}
          className="relative max-w-3xl mx-auto flex items-center shadow-sm"
        >
          <Input 
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask a question..."
            disabled={isLoading}
            className="pr-12 py-6 rounded-full"
          />
          <Button 
            type="submit" 
            disabled={isLoading || !input.trim()}
            size="icon"
            className="absolute right-1.5 rounded-full"
          >
            ✓
          </Button>
        </form>
        <div className="text-center text-xs text-muted-foreground mt-2">
          The Librarian provides direct scriptural reports via semantic RAG, primarily using the BSB translation. Verifying references is recommended.
        </div>
      </div>
    </div>
  );
}
