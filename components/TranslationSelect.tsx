'use client';

import React from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchTranslations } from '@/lib/bible-fetch';

export function TranslationSelect({
  value,
  onChange
}: {
  value: string;
  onChange: (val: string) => void;
}) {
  const [translations, setTranslations] = React.useState<any[]>([
    { shortName: 'WEB', name: 'World English Bible' }
  ]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    async function load() {
      const data = await fetchTranslations();
      // Filter down to a curated list for the MVP to avoid a 1000-item dropdown
      // Ensure we keep the major english public domain or allowed versions
      const curatedCodes = ['WEB', 'KJV', 'YLT', 'BSB', 'ASV', 'DARBY'];
      const filtered = data.filter((t: any) => curatedCodes.includes(t.shortName));
      if (filtered.length > 0) {
        setTranslations(filtered);
      }
      setLoading(false);
    }
    load();
  }, []);

  return (
    <Select value={value} onValueChange={onChange} disabled={loading}>
      <SelectTrigger className="w-[180px] h-8 text-xs bg-background">
        <SelectValue placeholder="Translation" />
      </SelectTrigger>
      <SelectContent>
        {translations.map(t => (
          <SelectItem key={t.shortName} value={t.shortName} className="text-xs">
            {t.shortName} - {t.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
