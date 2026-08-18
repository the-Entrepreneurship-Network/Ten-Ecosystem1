# Install this skill into an agent

This file is for the operator. The agent can also follow it if the user says "install this".

## What you unzip

```
ats-resume/
  SKILL.md
  assets/plain-resume-template.md
  references/   (all playbooks)
```

The folder name must stay `ats-resume` and match `name: ats-resume`.

## Grok / this environment

Already lives at `/home/workdir/.grok/skills/ats-resume/`.

To replace from a zip:

```bash
unzip ats-resume-skill.zip -d /home/workdir/.grok/skills
# if the zip contains ats-resume/, that is the destination
```

## Claude Code

Global:

```bash
mkdir -p ~/.claude/skills
unzip -o ats-resume-skill.zip -d ~/.claude/skills
```

Project:

```bash
mkdir -p .claude/skills
unzip -o ats-resume-skill.zip -d .claude/skills
```

Then in Claude Code say: `Check this resume PDF with ats-resume` or `/ats-resume`.

Codex-team / Fable loop is only for building an *app*. Do not start `/codex:transfer` to write a single resume.

## Cursor / Windsurf / Copilot / Codex

```bash
mkdir -p .agents/skills
unzip -o ats-resume-skill.zip -d .agents/skills
```

If the product uses `.cursor/skills` or `~/.codex/skills`, unzip there instead. Point the agent at `ats-resume/SKILL.md`.

## Claude.ai custom skill

Zip the `ats-resume` folder itself (must contain SKILL.md at the top of that folder). Upload under Settings → Skills.

## Companion skills to keep enabled

- `pdf` — extract uploaded resumes, write the shipped PDF
- `docx` — Word export

No other skill is required.

## Smoke test

1. Paste a weak resume or upload a PDF
2. Agent should run `check`, print two scores, then ask the target job title
3. After enough answers, agent should write markdown + PDF

If it writes a two-column designed file, the skill is not being followed.
