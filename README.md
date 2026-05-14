# Email Finder API

A small self-hosted REST API that finds verified work emails from a contact name and company domain. Designed to slot into outbound workflows (Clay, n8n, etc.) as a **cheap first-pass** before falling back to paid enrichment tools.

## How it works

1. **Permutations.** Given `first_name`, `last_name`, and `domain`, generate the most-likely email formats in priority order (`firstname.lastname@`, `flastname@`, `firstname@`, etc.).
2. **Catch-all check.** Send a clearly-bogus probe to the domain. If the mail server accepts it, the domain is catch-all and SMTP can't verify anything — return early so the caller can fall through to a paid tool.
3. **SMTP verify.** For non-catch-all domains, RCPT-TO each candidate in priority order. First `2xx` wins. `5xx` (550/551/553) means the address doesn't exist; `4xx` or no response means unknown.
4. **Cache.** Catch-all status and per-email verifications are cached in SQLite, so repeat lookups are free.

## What it does NOT do

- **Verify catch-all domains.** No SMTP-based tool can. The API returns `status: "catch_all"` and `fallback_recommended: true` so your workflow can call a paid tool (LeadMagic, Findymail, Icypeas, BetterContact) only for those.
- **Bypass providers that accept-then-bounce.** Many Google Workspace domains accept any RCPT and bounce later. These look catch-all to this verifier and will fall through.

## Quick start (Docker)

```bash
cp .env.example .env
# Edit .env: set API_KEY (any long random string), SENDER_EMAIL, HELO_HOSTNAME
docker compose up -d
curl http://localhost:8000/health
```

## Quick start (VPS — Ubuntu/Debian)

```bash
git clone <this-repo> email-finder
cd email-finder
sudo bash deploy/install.sh
# Edit /opt/email-finder/.env to set SENDER_EMAIL / HELO_HOSTNAME
sudo systemctl restart email-finder
```

The install script:
- Creates a system user `emailfinder`
- Installs the app to `/opt/email-finder`
- Sets up a Python venv with dependencies
- Generates a random API key and writes it to `.env`
- Installs a systemd service (`email-finder`)
- Installs an nginx reverse-proxy config (edit `server_name`, then `certbot --nginx`)

## Configuration

All config is via environment variables (`.env`):

| Variable | Default | Notes |
|---|---|---|
| `API_KEY` | *(required)* | Long random string. Sent as `X-API-Key` header. |
| `SENDER_EMAIL` | `verify@example.com` | Used in SMTP `MAIL FROM`. Use a real address on a domain you own. |
| `HELO_HOSTNAME` | `verifier.example.com` | Used in SMTP `EHLO`. Should be a real FQDN with PTR record for best results. |
| `SMTP_TIMEOUT` | `10` | Per-connection timeout in seconds. |
| `PACING_SECONDS` | `0.3` | Wait between live SMTP checks against the same domain. |
| `DB_PATH` | `./data/cache.db` | SQLite cache location. |
| `CATCH_ALL_TTL_SECONDS` | `2592000` | Catch-all status cache lifetime (30 days). |
| `VERIFIED_TTL_SECONDS` | `1209600` | Per-email verification cache lifetime (14 days). |
| `LOG_LEVEL` | `INFO` | `DEBUG` is helpful when tuning. |

## API

### `POST /find`

```bash
curl -X POST https://your-api.com/find \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "first_name": "Jamie",
    "last_name": "Lee",
    "domain": "notion.so",
    "return_attempts": false
  }'
```

Response shapes:

```json
// Verified
{
  "email": "jamie.lee@notion.so",
  "status": "verified",
  "catch_all": false,
  "candidates_tried": 1,
  "fallback_recommended": false,
  "message": null
}

// Catch-all — fall through to paid tool
{
  "email": null,
  "status": "catch_all",
  "catch_all": true,
  "candidates_tried": 0,
  "fallback_recommended": true,
  "message": "Domain is catch-all; SMTP cannot confirm. Fall back to paid enrichment."
}

// Not found
{
  "email": null,
  "status": "not_found",
  "catch_all": false,
  "candidates_tried": 16,
  "fallback_recommended": true,
  "message": "No candidate verified. Consider a paid enrichment tool."
}
```

Set `"return_attempts": true` to see every candidate and its SMTP response (useful for debugging).

### `POST /find/batch`

Same body wrapped in `contacts`, up to 50 per call:

```json
{
  "contacts": [
    {"first_name": "Jamie", "last_name": "Lee", "domain": "notion.so"},
    {"first_name": "Sarah", "last_name": "Chen", "domain": "stripe.com"}
  ]
}
```

Concurrency is capped server-side at 5 to avoid hammering mail servers.

### `GET /health`

```json
{"status": "ok"}
```

## Operational notes (read before deploying)

- **Outbound port 25 is blocked on many hosts.** AWS, GCP, Azure, DigitalOcean (by default), Vultr (by default) block it to fight spam. Hosts that work: **Hostinger**, **OVH**, **Hetzner**, most cheap VPS providers. Check with `nc -zv smtp.gmail.com 25`.
- **Sender reputation matters.** Set `SENDER_EMAIL` and `HELO_HOSTNAME` to real values on a domain you own. Set up SPF/DKIM/DMARC and a PTR (reverse DNS) record on your VPS IP. Without these, many mail servers will reject your verification attempts (returning `unknown` for everything).
- **Don't share an IP across many SMTP probes.** If you push too hard, mail servers will null-route you. The default `PACING_SECONDS=0.3` is conservative. Lower it carefully.
- **Catch-all is the floor, not the ceiling.** A meaningful share of B2B domains will land here. Plan for fallback in your workflow.

## Integrating with Clay and n8n

See [INTEGRATIONS.md](./INTEGRATIONS.md) for working examples.

## Local development

```bash
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # edit API_KEY
uvicorn app.main:app --reload
# Visit http://127.0.0.1:8000/docs for the auto-generated Swagger UI
```

Run tests:

```bash
python tests/test_permutations.py
```

## Project layout

```
email-finder/
├── app/
│   ├── main.py              # FastAPI app + routes
│   ├── permutations.py      # Email format generator
│   ├── smtp_verifier.py     # SMTP RCPT-TO checker + catch-all probe
│   ├── verifier.py          # Orchestrator: cache -> catch-all -> permute -> verify
│   └── cache.py             # SQLite cache (catch-all + verifications)
├── tests/
│   └── test_permutations.py
├── deploy/
│   ├── install.sh           # VPS one-shot installer
│   ├── systemd/email-finder.service
│   └── nginx/email-finder.conf
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
├── .env.example
└── README.md
```

## License

MIT — do whatever you want with this.
