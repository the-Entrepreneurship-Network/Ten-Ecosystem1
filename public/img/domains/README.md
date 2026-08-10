# Domain artwork

The Academics preview shows one logo per scroll beat. Each looks for a PNG in
this folder and falls back to a coloured medallion if the file is missing, so
the sequence works with none, some, or all of them present.

Drop files here with these exact names. Transparent PNG, square, 1024px or
larger:

| File | Domain |
| --- | --- |
| `ten.png` | TEN (opening beat) |
| `flutter.png` | Flutter Development |
| `java.png` | Java Development |
| `python.png` | Python Development |
| `mern.png` | MERN Stack |
| `cybersecurity.png` | Cyber Security |
| `ai.png` | Artificial Intelligence |

Nothing else needs changing — the page picks them up on the next load.

To add or reorder beats, edit `BEATS` in `public/academics.html`; the `slug`
field is the filename without the extension.
