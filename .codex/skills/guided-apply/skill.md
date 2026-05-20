---
name: guided-apply
description: Compatibility alias for the apply skill. Use when asked for guided application prep, answer review, or dashboard Copy Answers data. This skill does not submit applications.
---

# Guided Apply

This is an alias for `.codex/skills/apply/SKILL.md`.

Use the apply skill's prep-only workflow:

- load `.env`, `JOB_DB_PATH`, and `JOB_PROFILE_DIR`
- extract ATS questions through `prepareApplication(db, job, { force: false, extractQuestions: true })`
- save and review `application_preps`
- leave unresolved or low-confidence fields for manual review
- report unsupported pages without guessing
- do not submit applications
- do not mark jobs as applied
