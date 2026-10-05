# Self-hosted fonts

These replace `next/font/google`, which downloaded fonts at build time and failed the
build on a network blip (TOOL-26). Each family is the exact release Google Fonts
serves, taken from the [google/fonts](https://github.com/google/fonts) repository
(`ofl/<family>/`), with its `OFL.txt` alongside.

| Family           | Version | Axes                         | Files                                   |
| ---------------- | ------- | ---------------------------- | --------------------------------------- |
| Inter            | 4.001   | `opsz` 14–32, `wght` 100–900 | `Inter-latin`, `Inter-latin-ext`        |
| JetBrains Mono   | 2.211   | `wght` 100–800               | `JetBrainsMono-latin`, `-latin-ext`     |
| Geist            | 1.800   | `wght` 100–900               | `Geist-latin`, `Geist-latin-ext`        |
| Playfair Display | 1.203   | `wght` 400–900               | `PlayfairDisplay-Variable` (unmodified) |

## Subsets

Inter, JetBrains Mono and Geist have no Reserved Font Name, so they are subset the
way Google serves them: one file per script, loaded by `unicode-range`, latin
preloaded. Only `latin` and `latin-ext` are shipped; characters outside them use the
fallback font. The layouts explain how the two faces are wired to one CSS variable.

Each file was made from the upstream variable TTF with fontTools, using the
`unicode-range` from Google's own CSS for that family and the OpenType features
Google keeps in its served files:

```sh
python -m fontTools.subset '<Family>[axes].ttf' \
  --unicodes='<range from Google CSS>' \
  --layout-features='<Google feature list>' \
  --flavor=woff2 --name-IDs='*' --name-languages='*' --notdef-outline \
  --output-file=<Family>-<subset>.woff2
```

| Family         | `--layout-features`                                      |
| -------------- | -------------------------------------------------------- |
| Inter          | `calt,ccmp,dnom,frac,locl,numr,pnum,tnum,kern,mark,mkmk` |
| JetBrains Mono | `calt,ccmp,frac,locl,mark`                               |
| Geist          | `ccmp,dnom,frac,liga,locl,numr,pnum,tnum,kern,mark,mkmk` |

Playfair Display carries the Reserved Font Name "Playfair Display", so it is not
subset (a subset is a Modified Version under the OFL). It ships whole, converted to
woff2 only, and is not preloaded: only the certificate uses it.
