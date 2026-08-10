# Domain artwork

Used by the Academics preview, one plate per scroll beat.

| File | Used for |
| --- | --- |
| `ten.webp` | Opening beat |
| `flutter.webp` | Learn by building |
| `java.webp` | Assignments, marked |
| `python.webp` | Resume builder |
| `mern.webp` | Job readiness |
| `swe.webp` | Job findings |
| `webdev.webp` | Hackathons |
| `space.webp` | Every track (the beat the camera descends onto) |
| `space-stars.webp` | Page background — starfield and nebulae |
| `space-earth.webp` | Earth on the horizon |

The last two are crops of the Space Intern render: the right-hand starfield,
clear of the astronaut and the emblem, and the Earth limb above the podium.

To add or reorder beats, edit `BEATS` in `public/academics.html`. `slug` is the
filename without its extension; a beat with no matching file falls back to a
coloured medallion, so nothing breaks while artwork is missing.

Source PNGs were 1.6–7.5 MB each. Re-encode with:

    ffmpeg -i in.png -vf "scale='min(1000,iw)':-2" -c:v libwebp -quality 86 -o out.webp
