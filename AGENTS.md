# NEMLab frontend

- Use the `project-management` skill and read the canonical [documentation guide](https://github.com/ryanzzzdev/nemlab/blob/main/docs/project/documentation-guide.md) before meaningful project work.
- Maintain task status, decisions, architecture and the dated work journal in [the backend project records](https://github.com/ryanzzzdev/nemlab/tree/main/docs/project/). Do not create a duplicate frontend backlog. Journal entries identify the session model and coding agent; do not guess unavailable versions.
- If the backend checkout is unavailable, report that documentation updates are pending rather than inventing a second source of truth.
- Run `npm run format` on changed frontend files, then `npm run check`. Preserve readable standard formatting. Do not edit generated contract types by hand when introduced.
- `apps/public` is the public browser application. A future Admin is a separately built application within this repository; do not add operator credentials or administrative capabilities to the public bundle.
- Never put OE keys, database credentials or operator tokens in frontend code or Vite environment variables. Vite variables are public bundle inputs.
- Keep implementation and setup documentation local; shared product requirements and decisions remain canonical in the backend.
- Follow [docs/ui-standards.md](docs/ui-standards.md) for public-app pages/components. Admin follows the canonical [desktop redesign](https://github.com/ryanzzzdev/nemlab/blob/main/docs/project/features/admin-desktop-redesign.md); do not apply public page-width/layout rules to Admin.
