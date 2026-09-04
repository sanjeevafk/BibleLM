'use client';

import React from 'react';

const TRANSLATION_OPTIONS = [
  { shortName: 'BSB', name: 'Berean Study Bible' },
  { shortName: 'KJV', name: 'King James Version' },
  { shortName: 'WEB', name: 'World English Bible' },
  { shortName: 'ASV', name: 'American Standard Version' },
  { shortName: 'NHEB', name: 'New Heart English Bible' },
];

export function TranslationSelect({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      aria-label="Select Bible translation"
      className="h-8 min-w-[132px] sm:min-w-[200px] cursor-pointer rounded-md border border-input bg-background px-2 text-xs font-medium text-foreground shadow-sm transition-colors focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
    >
      {TRANSLATION_OPTIONS.map((t) => (
        <option key={t.shortName} value={t.shortName} className="bg-popover text-popover-foreground">
          {t.shortName} - {t.name}
        </option>
      ))}
    </select>
  );
}
