# Deploy

The Render service is [`https://a-eye-1zsv.onrender.com`](https://a-eye-1zsv.onrender.com) (configuration in `render.yaml`). It runs as one Node server and mounts a persistent disk at `/var/data` for SQLite and local uploads. Render currently sets `ALLOW_UNPAID_QUESTIONS=1`; configure a treasury and disable that flag to demonstrate x402 payments. Configure the `S3_*` environment variables to store photos in Cloudflare R2 instead of on the Render disk.

## Production runbook

`/api/health` reports `ok`, `service`, `network`, `asset`, `commit`, and `checks` for the database, disk capacity, and photo storage. Only a database failure returns 503; disk or R2 issues are reported without restarting the service.

Deploys cause roughly 1–2 minutes of downtime: disk-backed services stop the old instance before the new one boots, and Render's disk detach/attach takes about 45–60 seconds of that window. `next start` itself is ready in under a second. **Don't merge to main during the demo / judging window.** Visitors who have loaded the site before the deploy see the service worker's “A-eye will be right back” page, which reloads automatically when the service is reachable.

Run `npm run db:backup` from a Render Shell, or SSH to `srv-db5udjp42hec73a8cu0g@ssh.oregon.render.com` and run it in `/opt/render/project/src` (SSH requires a key on the Render account). List backups with `npm run db:backups`. Restore with `npm run db:restore -- backups/<file>`, then restart the service using the dashboard's “Restart service” action or `curl -X POST -H "Authorization: Bearer $RENDER_API_KEY" https://api.render.com/v1/services/srv-db5udjp42hec73a8cu0g/restart`. The previous database is kept as `a-eye.db.pre-restore-<ts>`.
