# Workspace typography

All workspace routes share the bundled IBM Plex Sans family and typography tokens in `design-tokens.css`.

| Role | Size |
| --- | --- |
| Page title / headline metric | 28 px |
| Section title | 18 px |
| Subheading | 16 px |
| Body, controls and table data | 14 px |
| Metadata and table headings | 12 px |

Mobile form fields use 16 px to avoid browser input zoom. Metadata never shrinks below 12 px. Tables retain readable text and scroll horizontally when necessary.

`workspace-typography.css` defines shared semantic contracts for the workspace and dialogs. Component stylesheet font declarations below 14 px use shared body/caption tokens. The analytics center uses the same font family and scale as the driver, profile and accounting pages, in either theme. PDF document canvas/text geometry is excluded.

Regression checks: `npx playwright test --config playwright.financial-center.config.js` (analytics and legacy stylesheet type contracts), and `npx playwright test --config playwright.typography.config.js` (workspace, profile and import interactions).
