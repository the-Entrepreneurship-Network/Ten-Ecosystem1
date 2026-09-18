# Attendance agent

After 11 PM every night the agent reads the attendance Google Form's response
sheet, lists everyone who filled it that day and when, and sends the list to
WhatsApp. Portal sign-ins are recorded too and available through the API (and
in the message, if asked for).

## Where the report goes

The report is sent to **`ATTENDANCE_REPORT_TO` and nowhere else.** The number
the message is sent *from* (`WHATSAPP_PHONE_NUMBER_ID`, the Meta test number)
and any test recipient the existing n8n flow uses are not consulted. Changing
the recipient is one variable; nothing else in the WhatsApp setup moves.

```
ATTENDANCE_REPORT_TO=918317873609        # digits, country code, no plus. Comma-separate for several.
ATTENDANCE_REPORT_CRON=5 23 * * *        # 23:05 in ATTENDANCE_TZ
```

## Configuring it from the HR portal

Nobody needs the server's `.env` to switch this on. In the HR portal, *Attendance
Report* → **Agent settings** takes the responses sheet link, the WhatsApp
number the report goes to, the send time, the submissions required per day,
the WhatsApp sender id and token, and an optional n8n webhook. They are saved
in the database (`AttendanceSettings`, one document), picked up within a
minute without a restart, and the schedule moves with the time. **Send test
WhatsApp** sends one line to the number right away, so the whole path can be
proved in the afternoon.

An environment variable, where one is set, still wins over the saved value
and shows as locked in the panel. The token is never sent back to the
browser: the panel shows whether one is set and its last four characters.

```
GET  /api/v2/attendance-agent/settings            values (token masked), source per field, schedule
PUT  /api/v2/attendance-agent/settings            { sheetUrl, reportTo, reportTime, requiredPerDay, phoneNumberId, whatsappToken, n8nWebhookUrl }
POST /api/v2/attendance-agent/settings/test-send  one test message to the configured number
```

## The Google Form

The form itself cannot be read; its **linked responses sheet** can. In the
form editor: Responses → the Sheets icon → open the sheet → Share → "Anyone
with the link" → Viewer. Then:

```
ATTENDANCE_SHEET_URL=https://docs.google.com/spreadsheets/d/<id>/edit#gid=0
```

Google Forms writes `Timestamp` first and one column per question. The
form's own **DATE** and **TIME** questions are the day and the clock a
submission counts for, so a form filled at ten past midnight for the day
before lands on the day before; the submission timestamp stands in when they
are blank. The report shows, per person, that time and up to three fields,
chosen by heading: something like *Name*, something like *Employee ID*, and
something like *Domain*. Override with `ATTENDANCE_SHEET_COLUMNS=Full
Name,Employee ID,Domain` (exact or partial headings, in display order).
Repeat submissions by the same person (same employee id, else email, else
phone, else name) collapse into one line with `xN, last HH:MM`.

Timestamps are in the form owner's timezone. Day-first (`17/09/2026`) versus
month-first (`9/17/2026`) is worked out from the data; force it with
`ATTENDANCE_SHEET_DATE_FORMAT=DMY` or `MDY`.

`GET /api/v2/attendance-agent/form/check` confirms the sheet is readable and
shows the headings and columns the report will use.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `ATTENDANCE_REPORT_TO` | *(unset: report built, not sent)* | Recipient(s). |
| `ATTENDANCE_SHEET_URL` | *(unset: no form section)* | The form's responses sheet. `ATTENDANCE_SHEET_ID` + `ATTENDANCE_SHEET_GID`, or `ATTENDANCE_SHEET_CSV_URL`, also work. |
| `ATTENDANCE_REPORT_CRON` | `5 23 * * *` | When to send, in `ATTENDANCE_TZ`. |
| `ATTENDANCE_REPORT_DAY` | `today` | `today` or `yesterday`: which day a scheduled run reports. |
| `ATTENDANCE_TZ` | `Asia/Kolkata` | Day boundaries and clock times. |
| `ATTENDANCE_INCLUDE_PORTAL_LOGINS` | `false` | Add portal sign-ins under the form list. Always shown when no sheet is configured. |
| `ATTENDANCE_AGENT_ENABLED` | `true` | `false` switches the schedule off; the API stays. |
| `ATTENDANCE_LOGIN_RETENTION_DAYS` | `90` | Login events older than this are purged nightly. |
| `ATTENDANCE_TRANSPORT` | `auto` | `n8n`, `meta`, `log`, or `auto` (n8n if its URL is set, else Meta if a token is set, else dry run). |

### Transport: n8n (the existing WhatsApp automation)

```
N8N_ATTENDANCE_WEBHOOK_URL=https://<your-n8n>/webhook/<path>
N8N_WEBHOOK_SECRET=<optional; sent as x-webhook-secret>
```

The agent POSTs JSON; the workflow's WhatsApp node sends it:

```json
{
  "to": "918317873609",
  "text": "*TEN Attendance*\nThu, 17 Sep 2026 (Asia/Kolkata)\n...",
  "kind": "attendance_daily",
  "dateKey": "2026-09-17",
  "trigger": "cron",
  "summary": { "formRespondents": 23, "formResponses": 25, "logins": 14, "uniqueUsers": 11, "failedAttempts": 1 }
}
```

Use `{{ $json.to }}` as the recipient and `{{ $json.text }}` as the body. A
JSON reply carrying `id` or `messageId` is recorded as the message id.

### Transport: Meta Cloud API (direct)

```
WHATSAPP_TOKEN=<access token>
WHATSAPP_PHONE_NUMBER_ID=1243779175483305
WHATSAPP_API_VERSION=v20.0
```

Two Meta rules that bite:

- **Test number:** every recipient must be added and OTP-verified in the Meta
  dashboard (WhatsApp → API Setup → "To"). Otherwise the send fails with
  `(#131030) Recipient phone number not in allowed list`.
- **24-hour window:** a free-text body is only delivered if the recipient
  messaged the number in the last 24 hours. Outside that window Meta requires
  an approved template. Set `WHATSAPP_TEMPLATE_NAME` (and
  `WHATSAPP_TEMPLATE_LANG`, default `en_US`) and the agent sends the template
  with two body parameters: `{{1}}` the date, `{{2}}` a one-line summary.

Dashboard tokens expire in 24 hours. Exchange for a ~60-day token:

```
node scripts/whatsapp-exchange-token.js --write
```

## In the dashboards

Nowhere, any more. The *Attendance Report* section — one script,
`public/attendance-report.js`, mounted by the student dashboard, the
coordinator dashboard and the HR portal — was removed, and the script with it.

The API below is unaffected and still serves the WhatsApp daily report, which
is what this agent is for. Anything that needs the per-student table can call
it; `tests/public/attendanceReportRemoved.test.js` is what keeps the dashboard
side from creeping back half-wired.

Who is asking stays the session's business alone, through the same
`middleware/sessionAuth` every other portal route uses: no header or query
string names a student, and the HR portal's `Bearer hr_` header is not what
admits it — its session is.

## API

Student (their own session):

```
GET  /api/v2/attendance-agent/my?from=&to=        days, counts, status per date
GET  /api/v2/attendance-agent/my.csv?from=&to=
```

Staff (an HR, admin or coordinator session; the controls below the tables are HR/admin only):

```
GET  /api/v2/attendance-agent/all?from=&to=&domain=&q=   one row per student, one column per date
GET  /api/v2/attendance-agent/all.csv?from=&to=&domain=&q=
GET  /api/v2/attendance-agent/config              transport, schedule, masked recipient
GET  /api/v2/attendance-agent/form?date=          the day's form submissions
GET  /api/v2/attendance-agent/form/check          is the sheet readable; headings and columns
GET  /api/v2/attendance-agent/logins?date=&role=&domain=&success=
GET  /api/v2/attendance-agent/report?date=        structured report (form + portal)
GET  /api/v2/attendance-agent/report/text?date=   exactly what WhatsApp receives
POST /api/v2/attendance-agent/report/send         { "date": "2026-09-17", "force": true }
```

`domain` matches exactly (a picked suggestion); `q` matches as typed. `send`
is once per day; `force` resends. Every send, skip and failure is an
`AuditLog` row (`ATTENDANCE_REPORT_SENT` / `ATTENDANCE_REPORT_SKIPPED`).

The sheet is cached for `ATTENDANCE_SHEET_CACHE_SECONDS` (default 120) so a
class opening the dashboard together downloads it once.

## What the message looks like

```
*TEN Attendance*
Thu, 17 Sep 2026 (Asia/Kolkata)

*Attendance form*
Filled: *23* people (25 responses)

08:00  Bikram Das (TEN002) - MERN
09:05  Asha Rao (TEN001) - Python x2, last 14:40
...
```

Capped at 25 rows per section and 3900 characters so it always fits one
WhatsApp message.

## Portal sign-ins

Every sign-in attempt on `/login`, `/student-login`, `/hr-login`,
`/coordinator-login` and `/ten-admin/login` is stored as a `LoginEvent` (who,
which portal, when, from where, success or not). The report's portal section
lists them per role, flags students who marked themselves present without
signing in and the reverse, and counts failed attempts. IP address and user
agent are stored for the retention window and never included in the message.
