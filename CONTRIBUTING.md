# Contributing to BibleLM
Thank you for considering contributing to BibleLM!  

We are building a fast, **entirely neutral**, citation-first Bible chatbot that runs **for free** on Vercel Hobby tier + Groq free tier (with optional user-provided Groq key for larger models). Every change should preserve these core invariants.

## 🛕 Project Philosophy – Non-Negotiable Principles

Please read and internalize these before opening a PR or spending time on a feature:
1. **Absolute Scriptural Neutrality**  
   - Responses **must quote exact verses** with chapter:verse citations.  
   - **No** theological interpretation, denominational slant, modern application, political commentary, or moralizing.  
   - The system prompt enforces this strictly — do **not** weaken it.  
   - We reject PRs that soften neutrality guards or inject opinionated prompts.
2. **Zero-Cost Forever (Vercel Hobby + Groq Free Tier)**  
   - No paid vector stores (Pinecone, Weaviate, etc.).  
   - No heavy serverful databases beyond lightweight PostgreSQL (already used for embeddings & TSK seeding).  
   - Prefer edge-compatible solutions: bundled JSON, in-memory vectors, Upstash Redis free tier, Hugging Face free inference, or build-time precomputation.  
   - Latency matters — `/api/chat` **must** stay Edge runtime compatible.
3. **Citation Discipline & Original-Language Fidelity**  
   - Always prefer direct verse lookup over LLM hallucination.  
   - Preserve Hebrew/Greek word popups (Strong's number, transliteration, gloss).  
   - Use Treasury of Scripture Knowledge (TSK) cross-references where helpful, but never override explicit verse quotes.
4. **Speed & Reliability**  
   - Common devotional queries should feel instant (bundled data + cache hits).  
   - Rare verses may fallback gracefully, but aim to minimize live fetches.
If your change violates any of the above → it will be closed (kindly, but firmly).

## 🚀 High-Impact Areas for Contribution (Feb 2026)

These are the most valuable ways to help right now:
- **UI/UX & Accessibility Polish**  
   - Improve markdown rendering (better verse highlighting, clickable references)  
- **Retrieval & RAG Accuracy (Zero-Cost Only)**  
   - Expand bundled verse coverage beyond ~1,000 (public-domain translations: BSB, WEB, ASV, etc.)  
- **Caching & Rate-Limit Defense**  
   - Robust Upstash Redis caching (query hash → verses + answer)  
- **Translation & Data Expansion**  
   - Add more free/public-domain translations (toggleable)  

## 💻 Development Setup

```bash
# 1. Fork & clone
git clone https://github.com/YOUR-USERNAME/BibleLM.git
cd BibleLM

# 2. Install dependencies
npm install

# 3. (Optional) Set environment variables
cp .env.example .env.local
# → add GROQ_API_KEY if you want 70B model during dev

# 4. Run locally
npm run dev
# Open http://localhost:3000
```

Linting & formatting are enforced:
```bash
npm run lint      # ESLint
npm run format    # Prettier
```
We use conventional commits:

feat:, fix:, docs:, refactor:, chore:, test:, etc.

Example:
```bash
git commit -m "feat: precompute verse embeddings at build time"
```

## 📝 Submitting Changes

- Create a branch: `git checkout -b feat/add-more-bundled-translations`
- Make focused, incremental commits
- Update README.md or inline docs if behavior changes
- Run `npm run build` locally to catch Edge runtime issues
- Open a clearly titled PR against main
- Describe what changed and why (link to philosophy if relevant)
- Include before/after screenshots for UI work
- Mention any trade-offs (e.g. bundle size increase)

Small, high-quality PRs are reviewed fastest.

## 🐞 Reporting Bugs
Open an Issue with:

- Exact prompt that failed
- Translation + model used
- Expected vs. actual output (screenshot ideal)
- Groq rate-limit or 429 errors if relevant

Especially valuable: cases where neutrality breaks or verses are hallucinated.

## 🔐 Security & Prompt Injection
Do not open public issues for prompt-injection vulnerabilities or ways to bypass the system prompt.
Email the maintainer directly (find contact in README or profile).

## ❤️ Thank You
Your help keeps BibleLM neutral, fast, and truly free.
Even starring the repo or sharing it with people tired of biased Bible chatbots is a big contribution.
Happy coding — and may your pull requests be merged speedily! ✝️

## 💻 Development Workflow

1. **Fork the repository** to your own GitHub account.
2. **Clone your fork** locally.
3. **Create a new branch** for your feature or bug fix:
   ```bash
   git checkout -b feature/your-feature-name
   ```
   Use fix/ for bug fixes, docs/ for documentation, and chore/ for maintenance tasks.
4. Make your changes and ensure the app still runs seamlessly locally using npm run dev.
5. Lint your code before committing:
   ```bash
   npm run lint
   ```
   Commit your changes using conventional commit messages:
   ```bash
   git commit -m "feat: add NASB translation support via helloao api"
   ```
   Push to your fork and submit a Pull Request to the main branch of the upstream repository.

## 🐛 Reporting Bugs

If you find a bug (especially instances where the LLM breaks neutrality or hallucinates verses), please open an Issue with the following information:

- The exact user prompt that caused the issue.
- The expected behavior vs. the actual behavior.
- The translation selected and the model used (if BYOK was enabled).

## 🔒 Security

If you discover a security vulnerability (such as a prompt injection flaw that allows users to bypass the system prompt instructions), please do not open a public issue. Email the maintainers directly.
