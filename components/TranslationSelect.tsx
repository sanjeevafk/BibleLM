'use client';

import React from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";

const TRANSLATION_OPTIONS = [
  { shortName: 'BSB', name: 'Berean Study Bible' },
  { shortName: 'KJV', name: 'King James Version' },
  { shortName: 'WEB', name: 'World English Bible' },
  { shortName: 'ASV', name: 'American Standard Version' },
  { shortName: 'NHEB', name: 'New Heart English Bible' }
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
  const selected = TRANSLATION_OPTIONS.find((option) => option.shortName === value);

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="h-8 min-w-[132px] w-[132px] sm:min-w-[200px] sm:w-[200px] text-xs bg-background">
        <span className="flex w-full min-w-0 items-center">
          <span className="truncate" title={selected ? `${selected.shortName} - ${selected.name}` : value}>
            {selected ? `${selected.shortName} - ${selected.name}` : value}
          </span>
        </span>
      </SelectTrigger>
      <SelectContent className="min-w-[260px]">
        {TRANSLATION_OPTIONS.map(t => (
          <SelectItem key={t.shortName} value={t.shortName} className="text-xs py-2 whitespace-normal leading-snug">
            {t.shortName} - {t.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
