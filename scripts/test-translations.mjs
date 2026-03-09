#!/usr/bin/env node
import { getTranslationVerse } from '../lib/translations.js';

async function testTranslations() {
  const reference = 'JHN 3:16';
  const translations = ['BSB', 'KJV', 'WEB', 'ASV'];
  
  console.log(`Testing ${reference} across translations:\n`);
  
  for (const trans of translations) {
    const text = await getTranslationVerse(reference, trans);
    if (text) {
      console.log(`${trans}: ${text.substring(0, 80)}...`);
    } else {
      console.log(`${trans}: [NULL/MISSING]`);
    }
  }
}

testTranslations().catch(console.error);
