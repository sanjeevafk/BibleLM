---
license: cc-by-nc-4.0
task_categories:
- question-answering
- text-retrieval
language:
- en
- hbo
- grc
tags:
- bible
- religion
- rag
- stateless
- nextjs
configs:
- config_name: default
  data_files:
  - split: train
    path: bible-full-index.json
---

# BibleLM Dataset

A high-performance, stateless Bible dataset optimized for edge-first RAG (Retrieval-Augmented Generation). 

This dataset contains the processed Bible text, morphological data, and search indices used by the [BibleLM](https://github.com/sanjeevafk/BibleLM) project.

### 📚 What's inside?
- **Combined Bible Index**: Cleaned and tokenized text for BSB (Berean Standard Bible), KJV, WEB, and ASV.
- **Search Engine State**: Pre-computed BM25 term frequencies (`bm25-state.json`) allowing for <10ms search engine hydration on serverless platforms.
- **Original Languages**: Extensive morphological data for Hebrew (WLC/OSHB) and Greek (SBLGNT/OpenGNT), including word-by-word Strong's mappings and glosses.
- **TSK Cross-References**: Over 500,000 ranked thematic connections from the Treasury of Scripture Knowledge.

### 🛠 Technical Usage
The data is structured as flat JSON fragments to allow for efficient loading in Edge Functions (Vercel/Cloudflare).
```typescript
// Example: Loading the BM25 state in a serverless function
import bm25State from './data/bm25-state.json';
import bibleIndex from './data/bible-full-index.json';
const engine = BM25Engine.createFromState(bm25State, bibleIndex);
```

### ⚖️ License & Attributions
This dataset is distributed under **CC BY-NC 4.0** (Attribution-NonCommercial) because it incorporates the following open-source works:

1. **OpenHebrewBible**: CC BY-NC 4.0 (Source: [eliranwong/OpenHebrewBible](https://github.com/eliranwong/OpenHebrewBible)).
2. **OpenGNT**: CC BY-NC 4.0.
3. **MorphHB**: CC BY 4.0 (Source: [OpenScriptures](https://github.com/openscriptures/morphhb)).
4. **Berean Standard Bible (BSB)**: Public Domain ([berean.bible](https://berean.bible/terms.htm)).
5. **KJV/WEB/ASV**: Public Domain.
6. **Strong's Concordance**: Public Domain.
7. **TSK**: Public Domain.

### Citation
If you use this dataset in your research or applications, please attribute the original sources listed above and the BibleLM project.
