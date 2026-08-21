# Locale and versions

From olegvg resume-tailor-plugin and Chasen-Liao version manager.

## Locale

Default **EN/US** unless the user says otherwise.

**EN/US / most APAC tech**

- No photo, DOB, marital status, full street address
- Contact → Summary → Skills → Experience → Projects → Education
- 1 page under ~10 years, else 2
- Direct, metrics-forward

**IN (India tech, default if user is targeting Indian IT + EN)**

- Same as EN/US. No photo. City + country is enough
- Projects may lead for campus / switch

**RU/CIS** only if asked:

- Photo/DOB may be expected locally — still warn about ATS risk if they insist on a photo
- Contact → Target role → Education → Experience → Skills
- 2–3 pages acceptable
- Mixed RU + EN tool names allowed

## Versions

If the user will apply to more than one job, keep:

- `resume-facts.md` — master ledger (never overwrite blindly)
- One derivative per company-role: `resume-<company>-<role>.pdf`

Name the derivative in the delivery line. Do not auto-delete the master.

Visibility flags on ledger rows: `always` | `this-jd` | `hide`.

## Page target

- New grad / intern: 1 page
- Mid: 1 page unless two strong distinct functions
- Senior / 15+ years: 2 pages, last 10–15 years in detail
