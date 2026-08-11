# Domain artwork

One file per domain, shown in the Academics preview. Sources were Grok
renders on black; each was trimmed 10% off the bottom to remove the
generator watermark, then encoded to WebP at 900px.

    ffmpeg -i in.jpg -vf "crop=iw:ih*0.90:0:0,scale='min(900,iw)':-2" \
      -c:v libwebp -quality 88 out.webp

| File | Domain |
| --- | --- |
| `python.webp` | Python Development |
| `java.webp` | Java Development |
| `space.webp` | Space Intern Program |
| `flutter.webp` | Flutter Development |
| `mern.webp` | MERN Stack |
| `webdev.webp` | Web Development |
| `swe.webp` | Software Engineering |
| `ai.webp` | Artificial Intelligence |
| `data.webp` | Data Science |
| `cyber.webp` | Cyber Security |
| `aws.webp` | DevOps with AWS |
| `biz.webp` | Business Development |
| `hr.webp` | Human Resources |
| `finance.webp` | Finance, and stands in for Venture Capital |
| `space-stars.webp` | Unused by the current preview |
| `space-earth.webp` | Unused by the current preview |
| `ten.webp` | Unused by the current preview |

Venture Capital has no render of its own; `FILE` in `public/academics.html`
maps it to Finance until one exists. Drop in `vc.webp` and delete that entry.

The renders are shown screen-blended with a feathered radial mask, so their
black backgrounds fall into the starfield instead of showing as rectangles.
Artwork on a light background will not work without changes.
