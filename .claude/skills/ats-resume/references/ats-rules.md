# ATS parse rules

Use these as hard constraints when writing or scoring. Safer defaults beat prettier layouts.

## What parsers actually do

Most ATS convert the file to a text stream, then try to label sections and fields (name, email, titles, dates, employers). They do not "see" the designed page.

If content is in a table, text box, column, header, footer, or image, it may be skipped, reordered, or glued to the wrong field.

## Layout

- Single column, top to bottom, left aligned
- No sidebars, no two-column skills grids
- No tables for layout (including "invisible" Word tables)
- No text boxes, shapes, SmartArt
- No photos, logos, icons, charts, skill bars
- No critical text in header/footer (Workday is especially bad here)
- Page length — 1 page under ~10 years experience, 2 pages after
- Margins 0.5–1.0 in

## Typography

Safe fonts: Calibri, Arial, Helvetica, Times New Roman, Georgia, Garamond, Cambria.

- Name 14–16pt
- Headings 11–13pt bold
- Body 10–12pt
- Black text on white
- No columns of different fonts
- Simple bullets — `•` or `-` only. No dingbats, arrows-as-icons, or emoji

## Headings (use these exact words)

| Section | Use | Do not use |
|---|---|---|
| Opening | Summary or Professional Summary | About Me, Profile Snapshot, My Story |
| Work | Experience or Work Experience | Journey, Impact, Career Highlights Reel |
| School | Education | Learning, Knowledge Base |
| Skills | Skills or Technical Skills | Toolkit, Superpowers, What I Do |
| Builds | Projects | Passion Builds, Labs |
| Proof | Certifications | Badges |

One heading per section. Do not merge "Education & Skills".

## Contact

Put in the document body, first lines:

```
Full Name
City, ST | phone | email | linkedin.com/in/handle | github.com/handle
```

Do not hide phone/email only in the header. Spell out URLs or use full linkedin.com paths; icon-only contact rows disappear.

## Dates and job lines

- `March 2023 – Present` or `03/2023 – Present`
- Do not write only "2023–2024" if the ATS is Taleo-like and the JD cares about tenure
- Do not use "Present" with no start date
- Consistent format across all roles
- Title and employer on their own line, immediately followed by dates

Preferred job header:

```
Software Engineer | Acme Corp | Bengaluru, IN | June 2023 – Present
```

## Files

- DOCX is the safest default for Workday, Taleo, iCIMS
- Text-based PDF is fine for Greenhouse and Lever if the posting asks for PDF
- Never a scanned/image PDF
- Sanity check — select-all and copy. If the order is wrong in Notepad, the parser will be wrong too

## Platform quirks (when the user knows the ATS)

| Platform | Be extra strict about |
|---|---|
| Workday | No columns/tables, contact in body, standard headings, MM/YYYY dates |
| Taleo | DOCX, exact dates, no tables, exact-match keywords |
| SAP SuccessFactors | Standard headings, no decorative fonts |
| iCIMS | Clear skills list, explicit years |
| Greenhouse | Humans read it; still parse-safe. Keywords help recruiter search, not an auto-score |
| Lever | Semantic matching is kinder; still avoid image-only content |

If the ATS is unknown, write to the Workday-safe subset. It survives the others.

## Keyword placement (truthful only)

Highest-yield places for a required term:

1. Summary (once)
2. Skills list (verbatim)
3. Current or most relevant role bullets (once, in a real accomplishment)

Do not hide a keywords paragraph in white text. Modern checkers and some ATS flag it.

## Common parse failures

- Two-column templates from Canva / Fancy Google Docs
- Skills as a table or tag cloud
- Icons before headings (🎓 Education)
- Dates in a right-side text box
- Job titles as images or stylized graphics
- "Present" without a start month
- Section called anything cute
