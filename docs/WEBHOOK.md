# Integrating a system with Linkord through a webhook

A **webhook** lets an outside system (a deploy, a monitor, an automation, a cron script) post into a server's text channel. The system sends an HTTP `POST` to the webhook URL, and the message shows up immediately for everyone who can see the channel, with the webhook's name and image, a **WEBHOOK** badge, an unread count and a notification.

A channel can have several webhooks, each with its own URL, name and image (changed under **Edit Channel → Integrations**, which also applies to the messages it already posted). For an announcements-only channel, remove the **Send Messages** permission from `@everyone` in that channel: people can still read and react, and only webhooks can post.

---

## Contents

1. [Create the webhook](#1-create-the-webhook)
2. [Store the webhook URL](#2-store-the-webhook-url)
3. [Send the first message](#3-send-the-first-message)
4. [Who gets the messages](#4-who-gets-the-messages)
5. [Message format](#5-message-format)
6. [Cards (embeds)](#6-cards-embeds)
7. [Avoiding duplicate messages](#7-avoiding-duplicate-messages)
8. [Responses and errors](#8-responses-and-errors)
9. [Limits](#9-limits)
10. [Ready-made examples](#10-ready-made-examples)
11. [Security](#11-security)
12. [Common problems](#12-common-problems)

---

## 1. Create the webhook

You need the **Manage Webhooks** permission in the channel (the server owner and anyone with **Administrator** already have it).

1. In the server, hover over the text channel and click the gear (**Edit Channel**).
2. Open the **Integrations** tab and click **New Webhook**.
3. Give it a name (for example *Deploys*, *Monitoring*).

The name can be changed later in the same tab (edit the field and leave it). Old messages start showing the new name.

> Each channel can have up to 10 webhooks (the limit is configurable per instance with `MAX_WEBHOOKS_PER_CHANNEL`).

## 2. Store the webhook URL

Right after creating it, Linkord shows the **webhook URL**:

```
https://your-linkord/api/webhooks/<id>/<token>
```

**Copy it now and keep it somewhere safe** (your CI's secret store, an environment variable, and so on). Linkord stores only a hash of the token, so the URL **is not shown again**.

Lost the URL? Open the channel → **Edit Channel** → **Integrations** → **Generate new URL** on the webhook. The old URL stops working immediately, so update every system that used it.

> The URL is the whole credential: anyone who has it can post as the webhook. Treat it like a password.

## 3. Send the first message

With the URL in hand, a JSON `POST` is enough:

```bash
curl -X POST "$LINKORD_WEBHOOK_URL" \
  -H 'Content-Type: application/json' \
  -d '{"content": "Deploy finished ✅"}'
```

Success response (`201 Created`):

```json
{ "id": 123, "duplicate": false }
```

The message appears in the channel in real time for whoever is online, and as unread for whoever is not.

### Two ways to send the token

| Way | When to use |
|---|---|
| Token in the URL: `POST /api/webhooks/<id>/<token>` | Tools that only accept a URL (most services with a "webhook" option). |
| Header: `POST /api/webhooks/<id>` with `Authorization: Bearer <token>` | When you control the code and want the token out of the URL. Proxies and access logs usually record URLs, but not headers. |

The `<id>` and `<token>` are the last two parts of the URL Linkord showed you.

```bash
curl -X POST "https://your-linkord/api/webhooks/$WEBHOOK_ID" \
  -H "Authorization: Bearer $WEBHOOK_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"content": "Backup finished"}'
```

## 4. Who gets the messages

Everyone who **can see the channel**: every member of the server, unless the channel's permissions hide it from some role. To reach more people, invite them to the server (friends or an invite link, from the server menu).

Anyone with **Manage Messages** in the channel can delete a webhook's messages, just like anyone else's.

## 5. Message format

The body is a JSON object:

| Field | Type | Required | Description |
|---|---|---|---|
| `content` | string | yes, if there are no `embeds` | Message text, up to **2000 characters**. |
| `embeds` | list | yes, if there is no `content` | Up to **5 cards**, see [section 6](#6-cards-embeds). |

The `Content-Type` must be `application/json`.

### Text formatting

`content` supports the same markdown as the chat:

| Write | Appears as |
|---|---|
| `**bold**` | **bold** |
| `*italic*` or `_italic_` | *italic* |
| `~~strikethrough~~` | ~~strikethrough~~ |
| `` `code` `` | `code` |
| ` ```code block``` ` (with an optional language: ` ```js `) | block with syntax highlighting |
| `> quote` | quote |
| `- item` or `1. item` | list |
| `https://...` | link, with a site preview |
| `<https://...>` | link without a preview |
| `@username` | highlighted mention |
| `<@&roleId>` | role mention, by the role's ID |
| `@everyone`, `@here` | the whole channel, or the members online |

A mention notifies whoever it names. `@everyone`, `@here` and roles that are not marked "Allow anyone to @mention this role" only notify when the account that created the webhook holds the "Mention @everyone, @here and All Roles" permission in that channel; otherwise they are sent as text and notify nobody.

Text over 2000 characters is **rejected** (not truncated), so your system knows not everything would arrive.

## 6. Cards (embeds)

For more readable notices, send `embeds`: cards with a colored bar, a title, fields and a footer. The format is the same as Discord's, so payloads made for Discord usually work as they are.

```json
{
  "content": "New production deploy",
  "embeds": [
    {
      "title": "Deploy finished",
      "url": "https://ci.example.com/runs/42",
      "color": "green",
      "description": "Pipeline **main** passed all tests.",
      "fields": [
        { "name": "Version", "value": "1.4.2", "inline": true },
        { "name": "Environment", "value": "production", "inline": true },
        { "name": "Duration", "value": "3m 12s", "inline": true },
        { "name": "Commit", "value": "`b13da04` feat: new screen" }
      ],
      "footer": "CI",
      "timestamp": "2026-10-28T18:45:00Z"
    }
  ]
}
```

### Card fields

| Field | Type | Limit | Description |
|---|---|---|---|
| `title` | string | 256 | Highlighted title. Becomes a link if there is a `url`. |
| `url` | string | 2048 | Title link. Only `http://` or `https://`. |
| `description` | string | 2000 | Card body, with markdown. |
| `color` | number or string | — | Side bar color, see below. |
| `fields` | list | 10 | Name/value pairs, see below. |
| `footer` | string or `{ "text": "..." }` | 256 | Small line at the end of the card. |
| `timestamp` | ISO 8601 string | — | Date shown in the footer, in the reader's time zone. |

Every card needs at least a `title`, `description` or `fields`.

### Fields (`fields`)

| Field | Type | Limit | Description |
|---|---|---|---|
| `name` | string | 256 | Label, in bold. |
| `value` | string | 1024 | Value, with markdown. |
| `inline` | boolean | — | `true` to share the row with other `inline` fields (up to 3 per row). Without it, the field takes the whole row. |

### Colors

`color` accepts three forms:

- **Number** `0xRRGGBB`, as in Discord: `5763719`.
- **Hexadecimal text**: `"#57F287"` or `"57F287"`.
- **Name**: `"red"`, `"green"`, `"yellow"`, `"blue"`, `"orange"`, `"purple"` or `"gray"`.

A useful convention: green for success, red for failure or alert, yellow for warning, blue for information.

### What is not supported

Images, thumbnails and author (`image`, `thumbnail`, `author`) are ignored on purpose: a card never makes the reader's browser load anything from an address the sender chose. To point to a page or image, put the link in `content` (it gets the chat's normal link preview) or in the card's `url`.

## 7. Avoiding duplicate messages

If your system resends when the network fails (a queue, an automatic retry), send the **`Idempotency-Key`** header with an identifier that is unique to that event:

```bash
curl -X POST "$LINKORD_WEBHOOK_URL" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: deploy-42' \
  -d '{"content": "Deploy 42 finished"}'
```

- The first send with the key creates the message: `201` and `{"id": 123, "duplicate": false}`.
- A resend with the **same key** does not create another one: it responds `200` and `{"id": 123, "duplicate": true}`, with the original message's id.

The key is scoped to the webhook, can be up to 128 visible characters (no spaces), and is free to use again if the message is deleted. Good examples: the CI job id, the alert id in the monitor, `order-981-paid`.

## 8. Responses and errors

Every error has the same format:

```json
{ "error": { "code": "invalid_message", "message": "embeds[0]: \"url\" precisa ser um link http(s)." } }
```

The `message` says exactly what to fix. Its text is currently written in Portuguese, so have your code branch on `code`, never on `message`.

| Status | `code` | When |
|---|---|---|
| `201` | — | Message created. |
| `200` | — | Resend of an `Idempotency-Key` already used: nothing new was created. |
| `400` | `invalid_message` | No `content` or `embeds`, or an invalid card. |
| `400` | `message_too_long` | `content` over 2000 characters. |
| `400` | `invalid_request` | Invalid `Idempotency-Key`. |
| `400` | `invalid_json` | The body is not a JSON object. |
| `401` | `invalid_webhook` | Wrong URL or token, URL replaced by a new one, webhook revoked by the administration, or server suspended. |
| `413` | `FST_ERR_CTP_BODY_TOO_LARGE` | Body larger than 64 KB. |
| `415` | `FST_ERR_CTP_INVALID_MEDIA_TYPE` | `Content-Type` other than `application/json`. |
| `429` | `rate_limited` | Too many sends in a short time. Respect the `Retry-After` header, in seconds. |

A `401` never says which part is wrong, on purpose. If it suddenly starts appearing, the URL was probably replaced or revoked: ask whoever manages the channel's webhooks for a new one.

**Is it worth retrying?** Yes on `429` (after `Retry-After`) and on `5xx` or network errors. Use `Idempotency-Key` so a retry never duplicates. Retrying on `400`, `401`, `413` or `415` without changing the request is pointless.

## 9. Limits

| Limit | Value |
|---|---|
| Sends per webhook | 30 per minute |
| Sends per IP | 120 per minute (the sender's address as the proxy reports it, via `TRUST_PROXY`) |
| Body size | 64 KB |
| Text (`content`) | 2000 characters |
| Cards per message | 5 |
| Fields per card | 10 |
| Webhooks per channel | 10 |

Need to send a lot at once? Group it into a single send (several `fields` or several cards) instead of one message per item.

## 10. Ready-made examples

### Shell

```bash
#!/usr/bin/env bash
# notifies Linkord when the disk goes over 90%
usage=$(df / | awk 'NR==2 {gsub("%", "", $5); print $5}')
if [ "$usage" -gt 90 ]; then
  curl -sS -X POST "$LINKORD_WEBHOOK_URL" \
    -H 'Content-Type: application/json' \
    -d "{\"embeds\": [{\"title\": \"Disk almost full\", \"color\": \"red\", \"fields\": [{\"name\": \"Host\", \"value\": \"$(hostname)\", \"inline\": true}, {\"name\": \"Usage\", \"value\": \"${usage}%\", \"inline\": true}]}]}"
fi
```

### Node.js (18+)

```js
async function notify(content, embeds, idempotencyKey) {
  const res = await fetch(process.env.LINKORD_WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: JSON.stringify({ content, embeds }),
  });
  if (res.status === 429) {
    const wait = Number(res.headers.get('retry-after') ?? 1);
    await new Promise((r) => setTimeout(r, wait * 1000));
    return notify(content, embeds, idempotencyKey);
  }
  if (!res.ok) {
    const { error } = await res.json();
    throw new Error(`Linkord rejected the request: ${error.code}: ${error.message}`);
  }
  return res.json(); // { id, duplicate }
}

await notify('Order paid', [{
  title: 'Order #981', color: 'green',
  fields: [{ name: 'Amount', value: '$249.90', inline: true }, { name: 'Customer', value: 'Ana', inline: true }],
}], 'order-981-paid');
```

### Python

```python
import os, time, requests

def notify(content=None, embeds=None, idempotency_key=None):
    headers = {"Idempotency-Key": idempotency_key} if idempotency_key else {}
    body = {k: v for k, v in {"content": content, "embeds": embeds}.items() if v}
    res = requests.post(os.environ["LINKORD_WEBHOOK_URL"], json=body, headers=headers, timeout=10)
    if res.status_code == 429:
        time.sleep(int(res.headers.get("Retry-After", "1")))
        return notify(content, embeds, idempotency_key)
    res.raise_for_status()
    return res.json()

notify(embeds=[{
    "title": "Backup finished",
    "color": "blue",
    "fields": [{"name": "Size", "value": "12.4 GB", "inline": True}],
    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
}])
```

### GitHub Actions

Store the URL under **Settings → Secrets and variables → Actions** as `LINKORD_WEBHOOK_URL` and add a step at the end of the workflow:

```yaml
      - name: Notify Linkord
        if: always()
        env:
          LINKORD_WEBHOOK_URL: ${{ secrets.LINKORD_WEBHOOK_URL }}
          STATUS: ${{ job.status }}
        run: |
          if [ "$STATUS" = "success" ]; then COLOR=green; TITLE="Deploy finished"; else COLOR=red; TITLE="Deploy failed"; fi
          curl -sS -X POST "$LINKORD_WEBHOOK_URL" \
            -H 'Content-Type: application/json' \
            -H "Idempotency-Key: gh-${{ github.run_id }}-${{ github.run_attempt }}" \
            -d "{\"embeds\": [{\"title\": \"$TITLE\", \"url\": \"${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}\", \"color\": \"$COLOR\", \"fields\": [{\"name\": \"Branch\", \"value\": \"${{ github.ref_name }}\", \"inline\": true}, {\"name\": \"Author\", \"value\": \"${{ github.actor }}\", \"inline\": true}], \"footer\": \"GitHub Actions\"}]}"
```

## 11. Security

- **The URL is a secret.** Keep it in environment variables or a secret store, never in code or in a repository.
- **Prefer the `Authorization: Bearer` header** when you can: the token stays out of URLs, which tend to show up in proxy and access logs. Linkord never writes the token to its own logs.
- **Leaked? Generate a new URL** (channel → **Edit Channel** → **Integrations** → **Generate new URL**). The previous one dies immediately.
- **Linkord stores only the token's hash.** Not even the instance's administration can see your URL.
- **The administration can revoke the webhook or suspend the server** (for abuse or a leak). In both cases sends start receiving `401`. After a revocation, whoever manages the channel gets messages flowing again by generating a new URL. After a suspension, the same URL works again once the administration reactivates the server.
- **Links in cards** can only be `http(s)`. There is no way to run a script or load an external image through a card.

## 12. Common problems

**I get `401 invalid_webhook` on a URL that used to work.**
The URL was replaced (someone clicked "Generate new URL"), the administration revoked the webhook, or the server is suspended. Ask whoever manages the channel's webhooks for a new URL.

**I get `415`.**
The `Content-Type: application/json` header is missing.

**I get `400 invalid_json`.**
The body is not a valid JSON object. In a shell, watch the quoting: validate the JSON with `echo "$BODY" | jq .` before sending.

**The message arrived twice.**
Your system repeated the send. Send a unique `Idempotency-Key` per event ([section 7](#7-avoiding-duplicate-messages)).

**A field showed up alone on its row.**
Only fields with `"inline": true` share a row, up to 3 at a time.

**Nobody received the message.**
Check that the people are in the server and that the channel's permissions let them see the channel. Whoever was not online sees the message as unread the next time they open Linkord.
