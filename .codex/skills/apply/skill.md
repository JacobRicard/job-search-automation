---
name: apply
description: Generate reviewed copy-answer prep for job applications in Jake Mercure's voice. Use when asked to prepare application answers, extract ATS questions, create dashboard Copy Answers data, or assist with an application. This skill does not submit applications.
---

# Apply

Use this skill to prepare application question answers and dashboard Copy Answers data. Generate prep only. Do not submit applications or mark jobs as applied unless the user explicitly gives a separate instruction after manual submission.

## Scope

- Extract live ATS questions when possible.
- Generate deterministic answers from Jake's profile and local overrides.
- Store prep in `application_preps` for `/job-application-data?id=<job-id>` and the dashboard Copy Answers flow.
- Leave unresolved, unsupported, legal, compliance, identity, or low-confidence fields for review.
- Report unsupported pages instead of guessing.

## Required Context

Read `.env` first and resolve:

- `DATA_DIR_DB`
- `DATA_DIR`

Load these profile files when drafting free-text answers:

- `data/context.md`
- `data/career-detail.md`
- `data/resume.md`
- `.context/people/voice.md`

If the newer Jake-specific voice files exist, prefer them:

- `.context/people/jake.md`
- `.context/people/jake-voice.md`

## Job Selection

If the user asks for live pending jobs, select:

```sql
SELECT *
FROM jobs
WHERE status = 'pending'
  AND score > 7
  AND COALESCE(stage, '') NOT IN ('rejected', 'closed', 'ghosted')
ORDER BY score DESC, company ASC;
```

Skip jobs that are rejected, closed, ghosted, already applied, or otherwise unavailable.

## Prep Workflow

For each selected job, run the existing application prep path:

```js
const { prepareApplication } = require('./lib/application-prep');
const prep = await prepareApplication(db, job, { force: false, extractQuestions: true });
```

This writes to `application_preps`, which powers the dashboard Copy Answers payload.

Use the prep result as the source of truth:

- `status`
- `workflow`
- `apply_url`
- `questions`
- `answers`
- `voiceChecks`
- `summary`
- `error`

If a live ATS page cannot be reached, extraction fails, or the platform is unsupported, save and report the unsupported/manual prep state rather than inventing questions or answers.

## Answer Rules

- Select fields must exactly match one of the available options.
- Multi-select fields should use only available options.
- Work authorization: Jake is authorized to work in the US and does not require sponsorship when the profile confirms that.
- US citizenship, clearance, export controls, background checks, conflicts, and EEO fields must come from profile defaults or stay unresolved.
- Text answers should be concise, grounded in real profile details, and written in Jake's voice.
- No em dashes or en dashes.
- Avoid filler such as "passionate about", "delve", "synergy", "leverage", and "excited to".
- Leave genuinely uncertain answers as unresolved for review.

## Verification

After prep generation, query `application_preps` for each target job and report:

- company
- title
- job ID
- prep status
- workflow
- question count
- answer count
- unresolved required fields
- page issue or error, if present

Also confirm the job was not marked as applied.

## Safe Stopping Points

Stop at generated prep and review artifacts. Do not run `apply-submit.js`, click submit, update `jobs.status` to `applied`, or claim an application was submitted as part of this skill.
