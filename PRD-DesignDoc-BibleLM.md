### Product Requirements Document (PRD) - Bible Librarian Chatbot

**1\. Product Overview**

- **Name**: Bible Librarian (working title)
- **One-liner**: A fast, neutral, Scripture-first chatbot that answers Bible-related questions by quoting exact verses from multiple translations and always including original Hebrew/Greek linguistic details - powered by Groq + free Bible data.
- **Vision**: Provide users with direct access to biblical text on any topic (including controversial ones) without added interpretation, opinion, or denominational bias. Emphasize textual faithfulness, transparency, and educational value through original languages.
- **Target users**:
  - Christians studying Scripture independently
  - Theology students / seminarians
  - People researching controversial topics (abortion, sexuality, divorce, women in ministry, etc.)
  - Anyone seeking what "the Bible actually says" without commentary
- **Non-goals** (MVP):
  - No user accounts / login
  - No saving chats / history persistence
  - No audio Bible / reading plans
  - No modern application / "what this means for today"
  - No image generation or non-text media

**2\. Core Value Proposition**

- Absolute neutrality → responses are 95%+ direct quotes + linguistic data
- Mandatory original-language insight on every quoted verse/passage
- Extremely fast responses (<1 s first token, 3-10 s full via Groq streaming)
- Zero-cost operation for moderate usage (Vercel Hobby + Groq free tier + free Bible APIs)

**3\. Key Features (MVP scope)**

| Priority | Feature | Description | Acceptance Criteria |
| --- | --- | --- | --- |
| P0  | Chat interface | Conversational UI like ChatGPT/Grok: bubbles, streaming text, markdown support | User types question → sees typing indicator → text streams in → history scrolls |
| P0  | LLM-powered answers | Groq (llama-3.1-70b or equivalent free model) with strict system prompt | Response follows exact template: neutral summary + verse bullets + original lang blocks |
| P0  | Verse quoting | Fetch real verse text from free API(s) → LLM quotes accurately | No hallucinated verses; always cites translation & reference |
| P0  | Mandatory original lang | For every verse/passage quoted: Hebrew/Greek word(s) • translit • Strong's • 1-5 word gloss | Format consistent: e.g. "Hebrew: בָּרָא (baraʾ, H1254 - create)" |
| P1  | Translation selection | Dropdown: ESV (default), KJV, NIV, NASB, YLT, etc. (from available free sources) | Selection persists in session (localStorage); affects quoted verses |
| P1  | Topic handling (no direct verse) | Explicitly state absence + closest thematic verses | e.g. Abortion: "No explicit command on elective abortion; closest themes in Ps 139, Ex 21, etc." |
| P2  | Search / verse lookup helper | Backend fetches verses via API before/parallel to LLM call (tool use or pre-fetch) | Reduces hallucinations; enriches context |
| P2  | Error handling & fallbacks | Rate-limit message, API down → fallback to bundled JSON | Graceful degradation |

**4\. Success Metrics (MVP launch)**

- Deployment live on Vercel (public URL)
- ≥ 5 test controversial queries answered faithfully (e.g. homosexuality, abortion, divorce, slavery, women pastors)
- Average response time < 8 seconds end-to-end
- Zero cost incurred (monitor Groq & Vercel dashboards first month)

**5\. Constraints & Assumptions**

- Budget: \$0 (use only free tiers)
- Traffic assumption: < 10k requests/month initially
- Data freshness: Bible text static → no issue
- Legal: Use only public domain / freely licensed translations (KJV, YLT, WEB, etc.; avoid copyrighted like NIV/ESV unless API permits non-commercial use)

**6\. Risks & Mitigations**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Groq free tier throttles | Medium | Short prompts, low temp, fallback model, show polite wait message |
| Bible API downtime / changes | Medium | Multiple sources (helloao + bolls + bible-api.com) + bundled JSON fallback |
| LLM hallucinates verses | High | Strict prompt + pre-fetch real verses into context + low temperature (0.1-0.3) |
| Vercel Hobby limits hit | Low | Optimize edge functions, short context |

### High-Level Design Document

**1\. Architecture Overview**

- **Frontend** → Next.js 14+ App Router (React Server + Client Components)
- **Backend** → Next.js API routes (edge runtime for low latency)
- **LLM** → Groq API (free tier, streaming via Vercel AI SDK or groq-sdk)
- **Bible Data** → Hybrid: primary free APIs + bundled static JSON for originals
- **Deployment** → Vercel (Hobby tier, automatic previews)

**2\. Data Sources (Free / No-Key in 2026)**

From current landscape:

| Source | Type | Translations | Original Lang / Strong's? | Latency | Usage |
| --- | --- | --- | --- | --- | --- |
| bible.helloao.org | API | 1000+ (incl. many public domain) | Limited footnotes; no direct Strong's | Low (AWS/Cloudflare) | Primary for English/modern translations |
| bolls.life/api | API | Many (KJV, NKJV, NASB, ESV, YLT, WLC Hebrew, LXX Greek, etc.) | Yes - Strong's via dictionary endpoints (BDBT/RUSD), morphology hints | Low | Best for original lang + Strong's lookup |
| bible-api.com | API | Dozens (public domain focus) | No  | Very low | Lightweight fallback |
| Bundled JSON | Static | User-selected subset (e.g. KJV, YLT, WEB) | Yes - from HF / OpenScriptures / STEP Bible exports | Instant | Fallback + mandatory originals (hebrew-strongs.json, greek-strongs.json) |

**Bundled originals recommendation** (5-30 MB total, fits Vercel):

- Greek NT → hmcgovern/original-language-bibles-greek (Hugging Face, 2024, TAGNT with word-level glosses, Strong's disambiguated, parsing)
- Hebrew OT → hmcgovern/original-language-bibles-hebrew (TAHOT) or Clear-Bible/macula-hebrew (tsv → convert to JSON)
- Strong's defs → openscriptures/strongs (Hebrew + Greek dictionaries)
- Convert tsv/parquet → simple JSON map: { "Gen.1.1": \[{word: "בְּרֵאשִׁית", translit: "bereshit", strongs: "H7225", gloss: "in beginning"}\] }

**3\. System Flow**

- User opens app → sees chat UI + translation dropdown
- User asks question → client sends to /api/chat (POST, edge)
- Backend:
  - Parses message history
  - Optional: pre-fetch potential verses via bolls.life or helloao (using simple keyword/reference extraction or tool call)
  - Calls Groq with strict system prompt + history + fetched verses/context
  - Streams response back (Vercel AI SDK format)
- LLM generates → always follows template + appends originals (from fetch or bundled lookup)
- UI renders streaming markdown + original blocks (styled boxes)

**4\. Key Technical Decisions**

- **Runtime**: 'edge' for /api/chat → minimal cold starts + low latency to Groq
- **Streaming**: Vercel AI SDK (streamText / useChat hook) → instant typing effect
- **Prompt engineering**: Very low temperature (0.1), strict output template enforced via prompt + few-shot examples
- **Original lang enrichment**:
  - Best case: bolls.life dictionary call per key term
  - Fallback: static JSON lookup by verse/ref
- **State**: localStorage for chat history + translation preference (no server persistence)
- **Styling**: Tailwind + shadcn/ui (minimal: chat bubbles, input bar, dropdown)

**5\. Folder Structure (Next.js App Router)**

text

app/

├── page.tsx # Landing + chat UI

├── api/chat/route.ts # Edge POST → Groq streaming

components/

├── Chat.tsx

├── Message.tsx

├── TranslationSelect.tsx

lib/

├── bible-fetch.ts # Helpers for helloao/bolls + bundled originals

├── prompts.ts # System prompt constant + few-shot

data/ # Bundled JSON (gitignored or small subset)

├── hebrew-strongs.json

├── greek-strongs.json

public/

└── ...

**6\. MVP Roadmap (Suggested phases)**

- Week 1: Setup Next.js + Groq + basic chat UI + system prompt
- Week 2: Integrate bible.helloao.org + bolls.life fetch → quote real verses
- Week 3: Add bundled originals JSON + mandatory append logic
- Week 4: Translation selector + test 20 controversial queries → polish neutrality
- Launch: Deploy to Vercel → share link