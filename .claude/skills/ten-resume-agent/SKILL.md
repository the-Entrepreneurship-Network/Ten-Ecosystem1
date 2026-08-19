---
name: ten-resume-agent
description: Orchestrator for TEN Resume AI. Interprets the user request before any reply, never reprints the command menu, then runs one ats-resume command. Use on the resume portal, when the agent echoes check-build-tailor-gap, clicks make it 98/100 or do all, or answers instantly without reading the user.
metadata:
  type: workflow
  version: "1.1"
---

# TEN Resume Agent

Front door for the resume product. `ats-resume` writes the resume. This skill decides what to run after thinking.

Job hunt, opening links, and HR mail belong to `job-hunt-agent`. If they ask for jobs, load that skill instead of reprinting resume commands.

Load `ats-resume/SKILL.md` only after the command is chosen.

## Think first (mandatory)

Do not send a user-visible token until you finish this private checklist:

1. What did they actually send this turn (text, file, button)?
2. Is this a new request or a repeat of the same menu?
3. Which ONE command matches?
4. What is already in the fact ledger?
5. What is the single next action or single question?

Never output the phrases:
- Say what you need and I will run it
- the four bullets for check / build / tailor / gap as a block
- Nothing is ever invented as a greeting

## Command map

| User / button | Command |
|---|---|
| resume file or paste | check |
| no file, skills/projects | build |
| resume + JD | tailor |
| what's missing + JD | gap |
| 2–5 JDs | compare |
| cover letter | cover |
| make it 98/100 | raise |
| do all | pipeline |
| find jobs / hunt / email HR | switch to job-hunt-agent |
| empty new chat | Upload a resume or say the job title. |

## Reply shape

Line 1: `Command: <name>`
Then the work or one question.
