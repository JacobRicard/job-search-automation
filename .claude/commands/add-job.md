---
description: Parse a pasted LinkedIn job description and create a record in the jobs database. Usage: /add-job [paste LinkedIn JD text]
allowed-tools: Bash, Read
---

You are importing a job from LinkedIn into the jobs database. Follow these steps exactly.

## Step 0: Load env

```bash
cat .env
```

Parse `DATA_DIR_DB` and `DATA_DIR`. Note today's date from your context (needed to convert "X days ago" to an absolute date).

## Step 1: Parse the input

Read `$ARGUMENTS` — this is a raw LinkedIn job page paste. Extract the following fields:

| Field | How to find it |
|---|---|
| `title` | The job title (e.g. "Platform Engineer") — usually near the top before the company name |
| `company` | Company name (e.g. "NeuBird AI") — the line or element just after or before the title |
| `location` | Location string (e.g. "United States · Remote", "San Francisco, CA") — normalize dots/bullets to commas, note Remote separately |
| `url` | Any `linkedin.com/jobs/view/` URL in the paste — use `null` if not present |
| `posted_at` | "X days ago" / "X hours ago" / "X weeks ago" → convert to absolute ISO date (YYYY-MM-DD) using today's date |
| `description` | Everything under "About the job" — full text, no truncation |
| `is_applied` | `true` if paste contains "Application submitted", "Applied", or "Applied X ago" / "Applied seconds ago" |

If the paste is ambiguous for any field, make a reasonable inference and note it in the confirmation summary.

## Step 2: Generate job ID and check for collision

Build the job ID by slugging company and title: lowercase, spaces to hyphens, strip all punctuation except hyphens.

Format: `linkedin-{company-slug}-{title-slug}`

Examples:
- NeuBird AI + Platform Engineer → `linkedin-neubird-ai-platform-engineer`
- Google + Senior SRE → `linkedin-google-senior-sre`

Check for an existing record:

```bash
node -e "
const db = require('better-sqlite3')(process.env.DATA_DIR_DB);
const existing = db.prepare('SELECT id, title, company, status, score FROM jobs WHERE id=?').get('GENERATED_ID');
console.log(JSON.stringify(existing || null));
"
```

If a record exists, show it and ask: **keep existing** (abort), **update fields** (overwrite non-null fields), or **create with a suffix** (append `-2`). Do not proceed silently.

## Step 3: Insert the job

```bash
node -e "
const db = require('better-sqlite3')(process.env.DATA_DIR_DB);
const now = new Date().toISOString();
const r = db.prepare(\`
  INSERT OR IGNORE INTO jobs
    (id, title, company, url, platform, location, posted_at, description, status, created_at, updated_at)
  VALUES (?, ?, ?, ?, 'linkedin', ?, ?, ?, 'pending', ?, ?)
\`).run('ID', 'TITLE', 'COMPANY', URL_OR_EMPTY_STRING, 'LOCATION', 'POSTED_AT', 'DESCRIPTION', now, now);
// Note: url is NOT NULL in the schema — use '' when no URL is available, not null
console.log(r.changes ? 'inserted' : 'already existed');
"
```

## Step 4: Score with Gemini

Run the scorer against the parsed job. Escape any single quotes in DESCRIPTION before passing it in.

```bash
node -e "
const job = { title: 'TITLE', company: 'COMPANY', description: \`DESCRIPTION\`, location: 'LOCATION' };
process.stdout.write(JSON.stringify([job]));
" | GEMINI_API_KEY=$(grep GEMINI_API_KEY .env | cut -d= -f2) \
    DATA_DIR=$(grep DATA_DIR .env | cut -d= -f2) \
    node scorer.js
```

Parse the JSON array output `[{ score, reasoning }]`.

Save the score:

```bash
node -e "
const db = require('better-sqlite3')(process.env.DATA_DIR_DB);
db.prepare(\"UPDATE jobs SET score=?, reasoning=?, updated_at=datetime('now') WHERE id=?\").run(SCORE, 'REASONING', 'JOB_ID');
console.log('score saved');
"
```

If the scorer errors or returns no output, skip this step silently. The pipeline will score it on its next run.

## Step 5: Mark as applied (if detected)

If `is_applied` is `true` from Step 1:

```bash
node -e "
const db = require('better-sqlite3')(process.env.DATA_DIR_DB);
const now = new Date().toISOString();
db.prepare(\"UPDATE jobs SET status='applied', stage='applied', applied_at=COALESCE(applied_at,?), updated_at=datetime('now') WHERE id=?\").run(now, 'JOB_ID');
// Write an events row so the Daily Insight modal counts this apply today
db.prepare(\`
  INSERT INTO events (job_id, event_type, from_value, to_value)
  SELECT ?, 'stage_change', 'pending', 'applied'
  WHERE NOT EXISTS (
    SELECT 1 FROM events WHERE job_id=? AND event_type='stage_change' AND to_value='applied'
  )
\`).run('JOB_ID', 'JOB_ID');
console.log('marked applied');
"
```

## Step 6: Confirm

Print a summary like this:

```
Created: {Company} — {Title}
ID:      {job-id}
Score:   {score} — {one-line reasoning, or "pending" if scorer failed}
Status:  {pending|applied}
Location: {location}
Posted:  {posted_at}

Dashboard: http://localhost:3131
```
