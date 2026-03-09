'use client';

import React from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
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
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="w-[160px] h-8 text-xs bg-background">
        <SelectValue placeholder="Translation" />
      </SelectTrigger>
      <SelectContent>
        {TRANSLATION_OPTIONS.map(t => (
          <SelectItem key={t.shortName} value={t.shortName} className="text-xs">
            {t.shortName} - {t.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
