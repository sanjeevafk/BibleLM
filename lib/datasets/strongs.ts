'use server';

import { loadJsonDataset, resolveDatasetPath } from './base';

export type StrongsEntry = {
  definition?: string;
  short_definition?: string;
  transliteration?: string;
  [key: string]: string | undefined;
};

const STRONGS_DICT_PATH = resolveDatasetPath('data', 'strongs-dict.json');

export async function loadStrongsDictionary(): Promise<Record<string, StrongsEntry> | null> {
  return loadJsonDataset<Record<string, StrongsEntry>>('strongs:dictionary', [STRONGS_DICT_PATH]);
}

export async function getStrongsEntry(strongsId: string): Promise<StrongsEntry | null> {
  const normalizedId = strongsId.trim().toUpperCase();
  if (!normalizedId) {
    return null;
  }

  const dict = await loadStrongsDictionary();
  if (!dict) {
    return null;
  }

  return dict[normalizedId] || null;
}
