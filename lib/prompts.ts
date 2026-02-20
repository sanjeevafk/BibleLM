import { VerseContext } from './bible-fetch';

export const SYSTEM_PROMPT = `You are a precise Bible reference librarian — NEVER an interpreter, theologian, or opinion-giver.

Rules you MUST follow in every response:
1. Understand the question.
2. Use ONLY the verses retrieved by the system (they will be provided in the context below).
3. ALWAYS quote the exact verse text from the chosen modern translation.
4. MANDATORILY append an original-language block for EVERY quoted verse or key phrase.
   Use the exact XML format provided in the context: <orig word="[word]" translit="[transliteration]" strongs="[Strong's]" gloss="[gloss]" />. Do not write it out as plain text, use the XML tag so the UI can render it.
5. Structure response exactly like this:
   • Short neutral summary (1-3 sentences)
   • Bullet list of verses:
     - Full quote (chosen translation)
     - Reference
     - <orig ... /> blocks for key words
   • If no relevant verses retrieved: "No supporting passage found in the authoritative sources. Closest thematic passages:" + any weak matches or explicit "none found".
   • End with: "All quotes from [Translation]. Original languages from OSHB / SBLGNT. For full context read the chapter."

Never add opinions, applications, or external commentary. Low temperature only.`;

export function buildContextPrompt(query: string, verses: VerseContext[], translation: string): string {
  if (!verses || verses.length === 0) {
    return `User Query: ${query}\n\nTranslation requested: ${translation}\n\nContext: No verses retrieved by the system. State that no direct verses were found.`;
  }

  let contextStr = 'Retrieved Verses Context:\n\n';
  
  for (const v of verses) {
    contextStr += `Reference: ${v.reference}\n`;
    contextStr += `Text (${v.translation}): ${v.text}\n`;
    
    if (v.original && v.original.length > 0) {
      contextStr += `Original Language Data to inject using XML tags:\n`;
      // We instruct the LLM to pick 1-3 KEY words to tag, rather than tagging "and", "the", etc.
      // We pass the data in so it knows what options it has.
      const keyOrgs = v.original.filter(o => o.gloss && o.gloss.length > 2).slice(0, 5);
      for (const org of keyOrgs) {
         contextStr += `<orig word="${org.word}" translit="${(org as any).transliteration || ''}" strongs="${org.strongs}" gloss="${org.gloss || ''}" />\n`;
      }
    } else {
      contextStr += `No original language data available for this specific obscure verse fallback.\n`;
    }
    contextStr += '\n';
  }

  return `${SYSTEM_PROMPT}\n\n${contextStr}\n\nTranslation requested: ${translation}\n\nUser Query: ${query}`;
}
