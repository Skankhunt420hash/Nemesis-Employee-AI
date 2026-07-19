# Agent Improvement Plan — Rick-D96 Agent nr3

**Goal**: Build a stable, capable, self-maintaining agent that can handle anything thrown at it.

---

## Phase 1: Foundation (Week 1) — *Stabilize*

- [x] **Memory directory** — Created `memory/`
- [ ] **Daily memory log** — Create `memory/YYYY-MM-DD.md` for today, start logging
- [ ] **MEMORY.md** — Create curated long-term memory file
- [ ] **TOOLS.md** — Document actual environment (SSH hosts, cameras, TTS voices, etc.)
- [ ] **Git init** — Commit workspace, set up auto-commit cron
- [ ] **HEARTBEAT.md** — Add real periodic checks (email, calendar, weather, git status)

---

## Phase 2: Skills & Automation (Week 2) — *Automate*

- [ ] **Skill audit** — List installed skills, identify gaps
- [ ] **Custom skills via skill_workshop** — Create skills for recurring tasks:
  - [ ] `git-auto-commit` — Auto-commit workspace changes
  - [ ] `memory-consolidation` — Weekly MEMORY.md curation from daily logs
  - [ ] `health-check` — System health (disk, git status, cron jobs, skill status)
  - [ ] `session-summary` — Summarize session on wake/sleep
- [ ] **Cron jobs** — Register recurring jobs via `cron` tool:
  - [ ] Daily memory log creation (00:05 UTC)
  - [ ] Weekly memory consolidation (Sunday 03:00 UTC)
  - [ ] Daily git auto-commit (23:55 UTC)
  - [ ] Health check (every 6h)
  - [ ] Heartbeat checks (rotate: email, calendar, weather, git status)

---

## Phase 3: Capability Expansion (Week 3-4) — *Extend*

- [ ] **Script library** in `workspace/scripts/`:
  - `git-sync.sh` — Pull/push workspace
  - `memory-summarize.py` — LLM-assisted memory consolidation
  - `health-check.sh` — Disk, git, cron, skills status
  - `session-digest.py` — Summarize session for MEMORY.md
- [ ] **External integrations** (as needed):
  - [ ] GitHub/GitLab CLI integration
  - [ ] Notion sync (skill exists)
  - [ ] Email/calendar monitoring
  - [ ] Home Assistant / IoT (if applicable)
- [ ] **Custom skills published** to ClawHub if reusable

---

## Phase 4: Resilience & Polish (Ongoing) — *Harden*

- [ ] **Error handling** — Retry logic, fallback models, graceful degradation
- [ ] **Monitoring** — Heartbeat health endpoint, alerting on failures
- [ ] **Documentation** — Keep AGENTS.md, SOUL.md, TOOLS.md current
- [ ] **Testing** — Spike skills for new capabilities before committing
- [ ] **Memory hygiene** — Quarterly MEMORY.md review, prune stale entries

---

## Tracking

| Phase | Status | Started | Completed |
|-------|--------|---------|-----------|
| 1: Foundation | 🟡 In Progress | 2025-07-19 | — |
| 2: Skills & Automation | ⬜ Pending | — | — |
| 3: Capability Expansion | ⬜ Pending | — | — |
| 4: Resilience | ⬜ Pending | — | — |

**Next Action**: Create today's daily memory log + MEMORY.md skeleton