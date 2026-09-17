# The public marketing site

`main` serves the CRM only: `/` sends you to the sign-in screen. This branch is
where the public site it used to serve was parked, so it can be brought back
whole rather than rebuilt from memory.

## What lives here and nowhere else

| Path | What it is |
| --- | --- |
| `src/app/page.tsx` | The landing page at `/` — hero, the day timeline, modules, trust. Signed-in staff are redirected to their panel, exactly as on `main`. |
| `src/app/demo/page.tsx` | "Book a demo" — the contact page the landing page's buttons point at. |
| `src/components/marketing/landing.tsx` | The landing page itself, plus `landing.module.css` (its own ink-and-paper palette and type, deliberately not the panel's). |
| `src/components/marketing/hero-console.tsx` | The ticking console in the hero. |
| `src/components/marketing/reveal.tsx` | The scroll reveal wrapper. |
| `src/components/marketing/demo-form.tsx` | The demo request form. |
| `src/app/api/demo/request/route.ts` | The public endpoint that form posts to — rate-limited, validated, writes one `DemoLead`. |
| `src/middleware.ts` | Differs from `main` by one line: `/api/demo/request` in `PUBLIC_API`. |

## What stayed on `main`

The control room keeps its half of this: `/admin/control/demo-leads`,
`src/components/control/demo-leads.tsx`, `src/lib/demo-leads.ts` and
`src/models/DemoLead.ts` are all still there, so leads captured while the site
was live remain readable. Only the public front door moved.

## Bringing it back

```sh
git checkout main
git merge marketing-site        # or: git cherry-pick the commits you want
```

Nothing on `main` has touched these files since they left, so the merge is a
fast addition rather than a fight — except `src/app/page.tsx` and
`src/middleware.ts`, which `main` edited. Take this branch's `page.tsx`, and for
the middleware take both sides: `main`'s file with `/api/demo/request` added back
to `PUBLIC_API`.

Rebase this branch onto `main` first if `main` has moved far; the marketing pages
share almost nothing with the CRM, so conflicts should be confined to those two
files.
