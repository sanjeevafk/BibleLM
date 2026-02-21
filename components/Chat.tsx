'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
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
            text: 'Welcome to the Bible Librarian. I provide neutral, direct quotes of Scripture along with original Greek and Hebrew word meanings. Ask me anything, such as *"What does the Bible say about creation?"*',
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

  // Auto scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

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
  };

  const handleClearChat = () => {
    clearError();
    onClearChat();
  };

  return (
    <div className="flex flex-col h-screen max-w-4xl mx-auto border-x bg-background">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b bg-card">
        <div className="flex items-center gap-2">
          <span className="font-serif text-xl font-bold">Bible Librarian</span>
          <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">Beta</span>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={toggleDarkMode}>
            {isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <Settings className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>Settings</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <div className="p-2 space-y-2">
                <p className="text-xs text-muted-foreground">
                  By default, we use a free rate-limited Groq Llama 3.1 8B model. Enter your own Groq API key to use Llama 3.1 70B instantly.
                </p>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold">Groq API Key (Stored Locally)</label>
                  <Input 
                    type="password" 
                    placeholder="gsk_..." 
                    value={customKey} 
                    onChange={onCustomKeyChange}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleClearChat}>
                <Trash2 className="h-4 w-4 mr-2" /> Clear Chat History
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4" ref={scrollRef}>
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
          Librarian can make mistakes. All responses are direct quotes based on your chosen translation.
        </div>
      </div>
    </div>
  );
}
