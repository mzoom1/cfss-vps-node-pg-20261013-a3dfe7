Tiny single-root npm application for the explicitly enabled local pilot.
`npm start` serves the page, JSON GET/POST `/values`, and unauthenticated
GET `/healthz` on `PORT` (default 3000). Health queries PostgreSQL.

The platform must inject `DATABASE_URL` containing `sslmode=verify-full` and
`sslrootcert` pointing at its project database CA file. The source contains
no credentials and does not provision a database. The platform keeps this
application behind its project access gate.

`pg` 8.23.1 and its transitive graph were locked with trusted npm using
`npm install --package-lock-only --ignore-scripts --no-audit --no-fund
--registry=https://registry.npmjs.org`. The published pg integrity was checked
with `npm view pg version dist.integrity --json` on 2026-10-06.
Official TLS behavior: https://node-postgres.com/features/ssl

The v2 fixture changes only `version.json`. Both versions create the same
`pilot_values` table if absent and retain its rows; they never drop the table.
Source and syntax checks do not demonstrate deployed PostgreSQL/TLS behavior.
