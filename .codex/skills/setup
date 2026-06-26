---
description: First-run setup interview. Ask the user questions to configure their data/ profile files. Run automatically when data/ is missing or unconfigured, or when the user says "setup", "configure", "first time", or "set up my profile".
allowed-tools: Read, Write, Bash
---

You are setting up a new user's job-search profile. Their data/ directory is either missing or still contains blank templates. Conduct a conversational interview, then write their files.

## Before you start

Run this to check what already exists:

```bash
ls data/ 2>/dev/null && grep -l "\[Your Name\]" data/*.md data/*.js 2>/dev/null || true
```

If `data/` already exists and the files look customized (no `[Your Name]` markers), tell the user setup looks complete and ask if they want to reconfigure anyway. Stop if they say no.

If setup is needed, ensure `data/` exists:

```bash
[ -d data ] || cp -r data.example data
[ -d .context ] || cp -r .context.example .context
```

## Interview

Ask the questions below **one section at a time**. Present each section heading, ask all questions in that section together, then wait for a reply before moving to the next section. Do not ask all questions at once.

Keep the tone conversational. Explain briefly what each answer will be used for if it's not obvious.

---

### Section 1 — About you

Ask:
- Full name
- Email and phone (say "for the resume header")
- LinkedIn profile URL or handle, and GitHub handle (optional)

---

### Section 2 — Location

Ask:
- What city are you based in? (This is where local jobs are searched first.)
- Are you open to relocating? If so, which cities? (NYC, SF, Austin, etc.)
- Are you open to remote-only roles?

---

### Section 3 — What you're looking for

Ask:
- What job titles are you targeting? (Give 3-5 examples like "AI Engineer, ML Researcher, AI Consultant")
- Describe your current situation in one sentence. (Student, new grad, career changer, current role, etc.)
- What's your tech stack — languages, frameworks, tools you know well?
- Compensation range or expectation? (Optional — skip if not sure)
- Any deal breakers? (e.g. no staffing agencies, no 100% travel, must be in-person)

---

### Section 4 — Target companies (optional)

Say: "This part is optional — the pipeline will discover companies automatically using AI, but you can seed it with a few specific ones now."

Ask:
- Any companies on **Greenhouse** you definitely want to track? (boards.greenhouse.io/<slug> — the slug is the part after the last slash)
- Any on **Ashby**? (jobs.ashbyhq.com/<slug>)
- Any on **Lever**? (jobs.lever.co/<slug>)

If they don't know the platform, just ask for company names and note them as "to verify."

---

### Section 5 — Voice and writing style (optional but valuable)

Say: "Last section — this helps Claude write application answers and outreach in your voice, not generic AI text."

Ask:
- How would you describe your communication style? (e.g. direct, technical, casual, formal)
- Any words or phrases you'd never say? (e.g. "leverage," "passionate about," "synergy")
- Anything you want Claude to always remember when writing as you?

---

## After all sections are answered

Confirm you have everything, then write all five files in sequence. Use the Write tool for each. Do not ask for confirmation before writing — just do it and report what you wrote.

### Write `data/context.md`

Fill in each section from the interview answers. Use full sentences, not bullet dumps. Keep it personal and specific. This file is read before every application answer and outreach message.

```
# [Name] — Working Context

## What I'm looking for
[Target titles and types of roles, 2-3 sentences]

## Target titles
[Comma-separated list]

## Stack I'm most productive in
[Languages, frameworks, tools from interview]

## Compensation
[Range or "market" or "not a constraint"]

## Location
Primary: [city]
Open to: [other cities, or "not open to relocation"]
Remote: [Yes / No / Preferred]

## Deal breakers
[From interview, or "None specified"]

## What I bring
[Current situation / background, 2-3 sentences]

## Open questions I ask interviewers
- [Leave 2-3 placeholder questions they can fill in]
```

### Write `data/resume.md`

Create a markdown resume template pre-filled with what you know from the interview. Mark everything that needs filling in with `[fill in]`. Include:
- Header: name, contact info, LinkedIn, GitHub
- Summary section (placeholder)
- Skills section (fill in from stack answers)
- Experience section (placeholder structure with their current role if given)
- Education section (placeholder)

### Write `data/companies.js`

Use the exact file structure from `data.example/companies.js`. Populate `SEARCH_TERMS` from their target titles. Add verified slugs to the right ATS arrays. Leave empty arrays with comments for platforms they didn't provide. Note any company names they gave without a known slug as a comment with `// TODO: find slug`.

### Write `data/jobspy-config.json`

```json
{
  "search_term": [from target titles],
  "location": [home city, plus relocation cities if any — array if multiple, string if one],
  "site_name": ["indeed", "linkedin", "glassdoor", "zip_recruiter"],
  "results_wanted": 25,
  "hours_old": 168,
  "country_indeed": "USA",
  "linkedin_fetch_description": true,
  "request_delay_ms": 3000
}
```

### Write `data/career-detail.md`

```
# [Name] — Career Detail

Supplements resume.md with behind-the-scenes detail for outreach, application answers, and interview prep.

## [Current role or situation from interview]

### What I do / did
[Summary from interview]

### Differentiator
[What makes their background unique vs. other candidates — infer from what they shared]
```

### Write `.context/people/applicant.md`

Short summary Claude can load fast at session start:

```
# Applicant Profile

## Who I am
[2-3 sentences from the interview]

## How I work
[Communication style and preferences from Section 5]

## Career preferences (summary)
[Titles, locations, key deal breakers — 3-4 bullets]

## Source of truth
Full detail in `data/context.md` and `data/career-detail.md`. Read those before working on applications or outreach.
```

---

## After writing all files

Tell the user:
1. What was written and what still needs their attention (placeholder sections)
2. That the pipeline can now run: `node scripts/refresh.js`
3. That they can refine their profile any time by editing the files in `data/`
4. Offer to run `/load-context` to fully load their new profile into this session

Do not write any setup summary document — keep it in the conversation.
