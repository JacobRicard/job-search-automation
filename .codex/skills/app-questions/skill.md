---
name: app-questions
description: Answer job application questions in Jake Mercure's voice. Use when the user asks for /app-questions, pasted application questions, custom ATS fields, cover-letter style application prompts, or an Ashby/Greenhouse/Lever apply URL or job ID.
---

# App Questions

Answer application questions on Jake's behalf. Write the answer first, then analysis or caveats after.

## Step 1: Load context

Read `.env` to find `JOB_PROFILE_DIR`. Default: `profiles/example`.

Load these files before drafting any answer:

- `.context/people/jake.md`
- `.context/people/jake-voice.md`
- `{JOB_PROFILE_DIR}/context.md`
- `{JOB_PROFILE_DIR}/career-detail.md`
- `{JOB_PROFILE_DIR}/resume.md`

If the old generic files exist instead, use them as fallback:

- `.context/people/applicant.md`
- `.context/people/voice.md`

## Step 2: Detect input type and parse questions

If input is a supported ATS URL or job ID, extract structured fields first:

- Job ID: `node scripts/apply-extract.js <job-id>`
- URL: `node scripts/apply-extract.js --url=<url>` when supported by the script

Parse JSON from stdout. Use `customFields` as the question list. Each field can have `label`, `name`, `type`, `required`, and `options`.

For `select` or `multi_select` fields, the answer must exactly match available options unless the field is unresolved and needs user review.

Otherwise, treat the pasted text as the source and identify each distinct question or form field.

## Step 3: Draft answers

For each question:

- Answer in Jake's voice per `.context/people/jake-voice.md`.
- Ground claims in a specific company, number, system, or result from the profile.
- Match field size: short fields get one concise answer, long fields get 1 to 3 short paragraphs.
- Do not assess role fit before answering.
- Leave ambiguous compliance, legal, or identity questions blank unless context gives a deterministic answer.

After answers are drafted, put any fit concerns or missing information at the end.

## Step 4: Voice-check all answers

For every answer longer than one sentence, run:

```bash
node scripts/check-voice.js "ANSWER_TEXT"
```

- If local checks fail, rewrite immediately and re-check.
- If Sapling score >= 50% AI, rewrite to add roughness and re-check.
- If HuggingFace score >= 30% AI, rewrite and re-check.
- Keep iterating until all local checks pass.
- Skip for single-sentence, yes/no, city/state, URL, and select-field answers.

If remote detector calls fail, report the fetch failure and still include the local result.

## Step 5: Format output

Present each question with its answer clearly labeled. Include voice check results for long answers, or `skipped` for short fields. Make each answer easy to copy into the form individually.
