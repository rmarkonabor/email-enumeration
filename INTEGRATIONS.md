# Integrations: Clay and n8n

Drop-in patterns to wire this API into your existing outbound workflows.

---

## Clay

Clay's **HTTP API** column type calls any REST endpoint per row. Here's the setup:

### Column config

- **Method:** POST
- **URL:** `https://your-api.com/find`
- **Headers:**
  - `Content-Type: application/json`
  - `X-API-Key: <your API_KEY>`
- **Body:**
  ```json
  {
    "first_name": "{{ First Name }}",
    "last_name":  "{{ Last Name }}",
    "domain":     "{{ Domain }}"
  }
  ```

### Output mapping

Pull two fields from the JSON response into separate columns:

| New column | JSON path |
|---|---|
| Email (free path) | `email` |
| Status | `status` |
| Needs paid fallback? | `fallback_recommended` |

### Waterfall in Clay

This is the move. Build a column chain:

1. **Column A — Email finder API** (this service)
   - If `status == "verified"` → done.
2. **Column B — Conditional run** — only run if `Column A.fallback_recommended == true`.
   - Call your paid enrichment (Clay-native or an HTTP API column to LeadMagic / Findymail / Icypeas / BetterContact).
3. **Column C — Final email** — `COALESCE(Column A.email, Column B.email)`.

You only spend paid enrichment credits when Column A flagged a catch-all or couldn't find a match. Everything else is free.

---

## n8n

### Single-contact node

Use the **HTTP Request** node:

- **Method:** POST
- **URL:** `https://your-api.com/find`
- **Authentication:** Generic Header Auth → `X-API-Key: <your API_KEY>` (store as credential)
- **Body Content Type:** JSON
- **JSON Body:**
  ```json
  {
    "first_name": "={{$json.firstName}}",
    "last_name":  "={{$json.lastName}}",
    "domain":     "={{$json.domain}}"
  }
  ```

### Waterfall in n8n

```
[Trigger] → [HTTP: Email Finder API] → [IF: status === "verified"]
                                              │
                              ┌───────────────┴───────────────┐
                              │ true                          │ false
                              ▼                               ▼
                       [Set: email = $json.email]   [HTTP: Paid Tool (LeadMagic)]
                              │                               │
                              └───────────────┬───────────────┘
                                              ▼
                                     [Next step: send / store]
```

### Batch endpoint in n8n

For lists, use `/find/batch` instead and post up to 50 contacts in one request:

- **URL:** `https://your-api.com/find/batch`
- **JSON Body:**
  ```json
  {
    "contacts": [
      {"first_name": "Jamie", "last_name": "Lee", "domain": "notion.so"},
      {"first_name": "Sarah", "last_name": "Chen", "domain": "stripe.com"}
    ]
  }
  ```

Then use a **Split Out** node to fan results back out into one item per contact.

---

## Cost model in practice

Out of every 100 contacts you push through:

- A chunk will be **verified** by the free API — zero marginal cost.
- A chunk will be **catch-all** — these fall through to your paid tool.
- A chunk will be **not_found** — also fall through to your paid tool.

The paid tools become your last resort instead of the first call. Same coverage, smaller bill.

---

## Sanity check before going live

After deployment, smoke-test against a few known good emails:

```bash
curl -s https://your-api.com/find \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"first_name":"Patrick","last_name":"Collison","domain":"stripe.com","return_attempts":true}' \
  | jq
```

If everything returns `unknown` for every attempt, your VPS is probably blocking outbound port 25. Check with:

```bash
nc -zv aspmx.l.google.com 25   # Gmail's MX
```

If that times out, switch hosts.
