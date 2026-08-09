# Certificate verification — technical reference

How anyone can confirm that a TEN document is genuine, end to end.

Audience: the engineering team. For the student-facing version, see
[certificate-verification-for-students.md](certificate-verification-for-students.md).

> Written against the code as it stands after the security pass. Where behaviour
> changed, that is called out — the previous behaviour is noted so an older
> deployment can be recognised.

---

## 1. What gets a document number

Five document types are verifiable:

| Type | Prefix | Issued when |
|---|---|---|
| Offer Letter | `TEN-OL` | On joining, after document verification |
| Letter of Completion (LOC) | `TEN-LOC` | Internship complete, attendance ≥ 75% |
| Letter of Recommendation (LOR) | `TEN-LOR` | Completion + performance ≥ 70 |
| Expert / Nano Degree / Fellowship certificates | `TEN-EXP` / `TEN-ND` / `TEN-FEL` | On claim, after payment where applicable |
| Star Performer award | `TEN-DOC` | HR approves a Star contribution |

### Generation

`utils/documentNumber.js`:

```js
generateDocumentNumber(type) → `${prefix}-${year}-${6 hex chars}`
// e.g. TEN-LOC-2026-A3F91C
```

The suffix is `crypto.randomBytes(3)` — 16.7 million values per type per year.
It is an **identifier, not a secret**: a verifier is expected to have it, and it
is printed on the document. Verification proves the number was issued by TEN and
returns what it was issued for; it is not an authentication token and grants no
access.

`normalizeDocumentNumber()` upper-cases and trims, so lookups tolerate however
the number was transcribed.

### Recording

Every service that produces a document calls `DocumentHistory.logSend()`
(`models/DocumentHistory.js:45`):

| Service | Document |
|---|---|
| `services/v2/offerLetterService.js` | Offer Letter |
| `services/v2/locService.js` | LOC |
| `services/v2/lorService.js` | LOR |
| `services/v2/certificateService.js` | Expert / Nano / Fellowship |
| `services/v2/promotionLetterService.js` | Letter of Promotion |
| `services/automationCron.js` | Auto-generated offer letters and certificates |

`DocumentHistory` is the verification index. A document that was generated but
never logged cannot be verified — if a new document type is added, logging it is
not optional.

---

## 2. The public endpoints

All unauthenticated, by design.

| Route | File | Behaviour |
|---|---|---|
| `GET /verify` | `server.js` | Redirects to `/verify-document`, preserving `?id=` |
| `GET /verify-document` | `server.js` | Serves `public/verify.html` |
| `GET /api/verify-document/:id` | `server.js` | The lookup. Returns JSON |
| `GET /api/v2/verify/:documentNumber` | `server.js` | 302 onto the route above |
| `public/cert-verify.html` | — | Certificate-specific page, linked as `verificationUrl` from `routes/v2/certificates.js` |

### Lookup order

1. Exact match on `DocumentHistory.documentNumber`.
2. Case-insensitive anchored regex, with the input regex-escaped.
3. Fall back to matching a `Student` record, for documents predating
   `DocumentHistory`.

---

## 3. What a verifier is shown

```json
{
  "verified": true,
  "document_number": "TEN-LOC-2026-A3F91C",
  "student_name": "…",
  "employee_id": "TEN/WEB/1042",
  "document_type": "Letter of Completion",
  "domain": "Web Development",
  "college": "…",
  "issued_date": "2026-07-14T…",
  "issued_by": "The Entrepreneurship Network (TEN)"
}
```

### Deliberately not returned

- Credentials of any kind. Passwords are stored only as bcrypt hashes and are
  not retrievable by anyone, including staff.
- Email address and phone number.
- Attendance percentage, marks, performance score, coin balance.
- Payment records, fines, or outstanding dues.
- Any other document belonging to the same student.

The principle: a verifier needs enough to confirm the document is genuine and
belongs to the person in front of them, and nothing more. **Do not add fields to
this response because they are convenient for another page.**

> **Security note.** `employee_id` is returned publicly. Until the security pass,
> `POST /get-my-password` would return any student's cleartext password given
> only an employee ID — so this endpoint was an enumeration source feeding an
> account-takeover hole. That endpoint has been removed and passwords are no
> longer retrievable. Verification is only privacy-respecting with that fix in
> place; do not reintroduce any endpoint keyed solely on an employee ID.

---

## 4. Invalid and unknown numbers

An unknown number returns **404** with a clean body:

```json
{ "error": "Document not found", "docId": "TEN-OL-2026-ABCDEF" }
```

- Never a 500. Verified: a malformed input such as `%3Cscript%3E` also returns
  404, and the echoed `docId` is rendered as text by `verify.html`.
- The regex path escapes the input, so a crafted number cannot become a
  catastrophic pattern.
- There is deliberately no distinction between "never existed" and "revoked" —
  the answer to a verifier is the same: this is not a valid TEN document.

Covered by `scripts/verify-security.sh`:
```
check 'unknown document verifies as not-found' 404
check 'malformed document number does not 500' 404
```

---

## 5. Adding a new document type

1. Add a prefix to `generateDocumentNumber()` in `utils/documentNumber.js`.
2. Call `DocumentHistory.logSend()` when the document is issued — otherwise it
   is unverifiable.
3. Populate `studentName`, `employeeId`, `domain`, `college` on the history row;
   the verification response reads them there first and only falls back to the
   Student record.
4. Add a case to `scripts/verify-security.sh`.

## 6. Known limitations

- **No revocation.** A document number stays valid forever once logged. If a
  certificate is withdrawn there is no way to say so — worth a `revokedAt` field
  on `DocumentHistory` and a `verified: false, reason: "revoked"` response.
- **No rate limit** on `/api/verify-document/:id`. The 6-hex-character suffix
  makes enumeration impractical, but a limit would be cheap insurance.
- **The document itself is not returned**, only its metadata, so verification
  confirms a number was issued — it cannot detect a PDF whose *contents* were
  edited after issuance. A per-document hash stored at issue time would close
  that gap.
