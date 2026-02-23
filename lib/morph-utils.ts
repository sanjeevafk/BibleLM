export type MorphDecode = {
  code: string;
  description: string;
};

const STEM_MAP: Record<string, string> = {
  q: 'Qal',
  Q: 'Qal',
  p: 'Piel',
  P: 'Pual',
  h: 'Hiphil',
  H: 'Hophal',
  n: 'Niphal',
  N: 'Niphal',
  t: 'Hithpael',
  T: 'Hithpael',
  o: 'Hithpoel',
  O: 'Hithpoel'
};

const ASPECT_MAP: Record<string, string> = {
  p: 'Perfect',
  q: 'Sequential Perfect',
  i: 'Imperfect',
  w: 'Wayyiqtol',
  j: 'Jussive',
  v: 'Imperative',
  h: 'Cohortative',
  r: 'Participle',
  s: 'Passive Participle',
  a: 'Infinitive Absolute',
  c: 'Infinitive Construct'
};

const PERSON_MAP: Record<string, string> = {
  '1': '1st Person',
  '2': '2nd Person',
  '3': '3rd Person'
};

const GENDER_MAP: Record<string, string> = {
  m: 'Masculine',
  f: 'Feminine',
  c: 'Common'
};

const NUMBER_MAP: Record<string, string> = {
  s: 'Singular',
  p: 'Plural',
  d: 'Dual'
};

const STATE_MAP: Record<string, string> = {
  a: 'Absolute',
  c: 'Construct',
  d: 'Determined'
};

function decodeVerb(seg: string): string[] {
  const parts: string[] = ['Verb'];
  const stem = seg[1];
  const aspect = seg[2];
  if (stem && STEM_MAP[stem]) parts.push(STEM_MAP[stem]);
  if (aspect && ASPECT_MAP[aspect]) parts.push(ASPECT_MAP[aspect]);

  for (const ch of seg.slice(3)) {
    if (PERSON_MAP[ch]) {
      parts.push(PERSON_MAP[ch]);
    } else if (GENDER_MAP[ch]) {
      parts.push(GENDER_MAP[ch]);
    } else if (NUMBER_MAP[ch]) {
      parts.push(NUMBER_MAP[ch]);
    } else if (STATE_MAP[ch]) {
      parts.push(STATE_MAP[ch]);
    }
  }

  return parts;
}

function decodeNounLike(seg: string, label: string): string[] {
  const parts: string[] = [label];
  for (const ch of seg.slice(1)) {
    if (ch === 'c') parts.push('Common');
    else if (ch === 'p') parts.push('Proper');
    else if (GENDER_MAP[ch]) parts.push(GENDER_MAP[ch]);
    else if (NUMBER_MAP[ch]) parts.push(NUMBER_MAP[ch]);
    else if (STATE_MAP[ch]) parts.push(STATE_MAP[ch]);
  }
  return parts;
}

function decodeSegment(seg: string): string | null {
  if (!seg) return null;
  if (seg.startsWith('V')) return decodeVerb(seg).join(', ');
  if (seg.startsWith('N')) return decodeNounLike(seg, 'Noun').join(', ');
  if (seg.startsWith('A')) return decodeNounLike(seg, 'Adjective').join(', ');
  if (seg.startsWith('P')) return decodeNounLike(seg, 'Pronoun').join(', ');
  if (seg.startsWith('R')) return 'Preposition';
  if (seg.startsWith('C')) return 'Conjunction';
  if (seg.startsWith('D')) return 'Adverb';
  if (seg.startsWith('T')) {
    if (seg.includes('d')) return 'Definite Article';
    return 'Particle';
  }
  return null;
}

export function decodeMorph(code?: string): MorphDecode | null {
  if (!code) return null;
  const trimmed = code.trim();
  if (!trimmed) return null;

  const withoutLang = trimmed.startsWith('H') || trimmed.startsWith('A')
    ? trimmed.slice(1)
    : trimmed;

  const segments = withoutLang.split('/');
  const decodedSegments = segments
    .map((seg) => decodeSegment(seg))
    .filter((seg): seg is string => Boolean(seg));

  if (decodedSegments.length === 0) return null;

  return {
    code: trimmed,
    description: decodedSegments.join(' / ')
  };
}
