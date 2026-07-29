# Phase 1 architecture

## Implementation checklist

- [x] Next.js App Router, strict TypeScript, Tailwind
- [x] Design tokens and reusable UI primitives
- [x] Responsive Admin and mobile Employee shells
- [x] Polished Admin dashboard and Employee daily dashboard
- [x] MongoDB connection reuse and indexed core schemas
- [x] JWT session and centralized authorization foundation
- [x] Environment validation and deployment-safe configuration
- [x] Error, not-found, and accessible interaction states
- [ ] Phase 2: login handlers, employee CRUD, password reset, audit events
- [ ] Phase 3+: domain modules described in the product brief

## Boundaries

App Router pages compose feature components. Route handlers validate input and call services. Services own business rules and database access. Models never enter client bundles. Authorization is checked in server entry points, independent of UI visibility. Provider interfaces isolate storage and geocoding integrations.

## Database relationships

| Entity | Key relationships |
|---|---|
| User | belongs to Territory; has Role and optional permission grants |
| Doctor | assigned to User; belongs to Territory; has embedded practice locations and MR slots |
| Assignment | Doctor → User; created by User; recurrence generates dated occurrences |
| Visit | Assignment/Doctor → User; optionally creates FollowUp and Order |
| FollowUp | Doctor → assigned User; optionally linked to Visit |
| Order | Doctor → User; contains product snapshots and server-calculated totals |
| AuditEvent | actor User → target type/id; immutable before/after metadata |
| ChangeRequest | Doctor → requesting User → approving Admin |

Doctor coordinates use GeoJSON `[longitude, latitude]` with a `2dsphere` index. Large lists use cursor/page queries with explicit projection; confidential fields default to excluded. Referential cleanup uses archive status rather than cascading deletion.

## Permission matrix

| Capability | Admin | MR | HR | Sales |
|---|:---:|:---:|:---:|:---:|
| All doctors / confidential notes | ✓ | — | — | — |
| Assigned doctors | ✓ | ✓ | — | ✓ |
| Employee management | ✓ | — | ✓ | — |
| Assignments | ✓ | own | view | own |
| Visits and follow-ups | all | own | basic | own |
| Orders / commercial values | all | permitted | — | own |
| Reports | all | own | basic | own |
| Audit logs / settings | ✓ | — | explicit grant | — |

Server permissions are defined in `src/constants/access.ts`; row-level access remains an additional database predicate.

## Design system

- Brand: deep clinical green `#173f3a`; accent: warm sand `#d3a768`.
- Canvas `#f5f7f5`, white surfaces, ink `#17201f`, muted `#697572`, line `#dfe5e2`.
- Semantic colors are reserved for status. Shadows are limited to one soft surface level.
- Typography: compact 12–14px supporting text, 16px section headings, 24–28px page headings.
- Radius: 12px controls, 16px surfaces. Touch targets are at least 44px.
- Admin: 232px collapsible desktop rail; top bar/drawer pattern on small screens.
- Employee: single-column content, fixed five-item safe-area bottom navigation.
- Tables collapse to cards below tablet width. Filters use mobile sheets and desktop drawers.

## Wireframe structures

- Admin dashboard: header/action → six compact metrics → quick actions → one activity chart + today list.
- Doctor search: search/action bar → active-filter chips → paginated table/card list; filters in drawer; list/map toggle.
- Doctor detail: identity/status header → action row → Overview, Timings, Activity, Business tabs.
- Assignment: doctor search → selected tray → employee/date/recurrence → conflict review → reasoned override.
- Daily planner: greeting/progress → next-visit primary card → chronological doctor cards → bottom navigation.
- Visit completion: outcome → conditional product/sample/order fields → notes/follow-up → location consent → submit.

