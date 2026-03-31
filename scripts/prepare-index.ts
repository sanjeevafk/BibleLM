import fs from 'fs';
import path from 'path';

/**
 * Aggregates all BSB translation files into a single full Bible index.
 * Format: { "BOOK CH:V": { text, translation, reference, original: [] } }
 */

const TRANSLATIONS_DIR = path.join(process.cwd(), 'data', 'translations');
const OUTPUT_FILE = path.join(process.cwd(), 'data', 'bible-full-index.json');

interface VerseContext {
  text: string;
  translation: string;
  reference: string;
  original: any[];
}

async function prepareIndex() {
  console.log('Starting full Bible index preparation...');
  const files = fs.readdirSync(TRANSLATIONS_DIR);
  const bsbFiles = files.filter(f => f.startsWith('bsb-') && f.endsWith('.json'));

  const fullIndex: Record<string, VerseContext> = {};
  let totalVerses = 0;

  for (const file of bsbFiles) {
    const bookCode = file.replace('bsb-', '').replace('.json', '');
    const filePath = path.join(TRANSLATIONS_DIR, file);
    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    // Content structure: { "1": { "1": "Text...", "2": "Text..." }, "2": { ... } }
    for (const chapterNum of Object.keys(content)) {
      const verses = content[chapterNum];
      for (const verseNum of Object.keys(verses)) {
        const text = verses[verseNum];
        const reference = `${bookCode} ${chapterNum}:${verseNum}`;
        
        fullIndex[reference] = {
          text,
          translation: 'BSB',
          reference,
          original: []
        };
        totalVerses++;
      }
    }
  }

  console.log(`Writing ${totalVerses} verses to ${OUTPUT_FILE}...`);
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(fullIndex));
  console.log('Index preparation complete.');
}

prepareIndex().catch(err => {
  console.error('Failed to prepare index:', err);
  process.exit(1);
});
