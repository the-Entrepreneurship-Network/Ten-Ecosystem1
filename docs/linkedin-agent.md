# LinkedIn agent

A section inside the HR portal, the coordinator dashboard, the mentor
dashboard and Founder OS. A member of staff types a post idea — or a whole
draft — into a chat and attaches the photograph they want on it. The agent
checks it, tidies the lines, and publishes it to the company page,
https://www.linkedin.com/company/the-entrepreneurship-network/.

Students, investors and contractors do not see the section, and the API
refuses them if they find the URL.

## What the agent does with a draft

**The post is yours.** What goes out is the text you typed and the photograph
you attached. The agent does not write the post for you and it does not choose
the picture.

1. **Checks it.** A deterministic content guard reads the draft and reports
   every issue with the exact excerpt and a fix: hate or harassment, someone's
   personal phone or e-mail, discriminatory hiring language, a person or
   company called a fraud, guaranteed-placement claims, unverifiable
   superlatives, shouting, hashtag and emoji overload, placeholder text, links
   in the body, machine-written phrases, a weak first line, the company name
   written wrong.
2. **Tidies the lines.** Shouting becomes a sentence, `!!!` becomes `!`, a
   missing capital and a missing full stop are added, doubled spaces and
   accidental blank lines go. Your line breaks, your hashtags, your link and
   your words are left exactly as typed. A clean draft comes back unchanged,
   character for character.
3. **Attaches your photo.** Whatever image you attach is the image on the post.
   If you would rather the agent drew something, ask it to "make a poster" and
   it will build a branded square from the facts in your draft — but only then.
4. **Publishes the appropriate version, always.** "Post it" publishes what the
   agent approved. If something had to be corrected, the reply says what. If
   the draft was blocked, nothing is posted and the reply says why; "post it
   anyway" does not change that, and the text is re-checked again at the
   moment of publishing in case the session was tampered with.

It also schedules ("schedule tomorrow 10am", India time), lists what has been
posted, shows page statistics when the token allows, and takes line-level
edits on request ("shorter", "change the headline to …", "no image").

## Connecting the page

Until a token is present the agent runs **dry**: every post is reviewed,
rewritten, saved and previewed with the exact payload it would send, and
nothing reaches LinkedIn. That is how the test suite runs and how a fresh
deployment behaves.

Posting to a company page uses LinkedIn's Community Management API. That
needs:

- a LinkedIn developer app with the **Community Management API** product
  added (LinkedIn reviews the request; allow a few days);
- a member who is an **ADMINISTRATOR** (or CONTENT_ADMIN) of the page to
  authorise the app with the scopes `w_organization_social`,
  `r_organization_social`, `rw_organization_admin`.

Two ways to hand the token to the server:

```
# 1. Paste it. Simplest; the token lives ~60 days and is then replaced by hand.
LINKEDIN_ACCESS_TOKEN=...
LINKEDIN_ORG_ID=            # numeric page id or urn:li:organization:<id>; blank = resolve by vanity name

# 2. OAuth from the HR portal. Set these three, then an HR or admin user
#    clicks "Connect LinkedIn" inside the agent. The token is stored in the
#    database (LinkedInConnection), never in a file.
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
LINKEDIN_REDIRECT_URI=https://virtualinternships.entrepreneurshipnetwork.net/api/v2/linkedin/oauth/callback
```

`LINKEDIN_API_VERSION` (default `202609`) is the Marketing API version sent
as the `Linkedin-Version` header. LinkedIn retires each version about a year
after release; a 426 from the API means it is time to bump it.

The status card at the top of the section says which of the three states the
server is in — connected (with the token's expiry), dry run, or expiring —
so nobody discovers a lapsed token from a failed post.

## API

All routes require a signed-in HR, coordinator, mentor, founder or admin.

```
GET  /api/v2/linkedin/status              connection, LLM provider, scheduler
POST /api/v2/linkedin/chat                { message, session, pngBase64? } → the agent's turn
GET  /api/v2/linkedin/posts?limit=20      history
GET  /api/v2/linkedin/posts/:id           one post, with its poster SVG
GET  /api/v2/linkedin/posts/:id/poster.svg
POST /api/v2/linkedin/posts/:id/publish   { pngBase64? } — publishes the stored final text, never the draft
POST /api/v2/linkedin/posts/:id/schedule  { when }
DELETE /api/v2/linkedin/posts/:id         withdraw an unpublished post
GET  /api/v2/linkedin/oauth/start         HR/admin only — begins the LinkedIn authorisation
GET  /api/v2/linkedin/oauth/callback
GET  /api/v2/linkedin/stats               page share statistics, when the token allows
```

The chat is stateless in the way the resume agent is: the server returns a
`session` object and the browser sends it back with the next message. Posts
themselves are persisted (`LinkedInPost`) so history, scheduling and the audit
trail — who posted what, when, and what the guard changed — survive a reload.

## Where the pieces live

```
routes/v2/linkedinAgent.js            the HTTP surface and the role guard
services/v2/linkedin/agent.js         the conversation: intents, review reply, refusals
services/v2/linkedin/contentGuard.js  the rules, each with an excerpt and a fix
services/v2/linkedin/postComposer.js  the sub-editor: tidies lines, adds nothing
services/v2/linkedin/llm.js           OpenAI / Gemini, JSON only, never logs a key
services/v2/linkedin/posterStudio.js  the SVG posters
services/v2/linkedin/linkedinClient.js the official API: images, posts, org lookup, OAuth
services/v2/linkedin/scheduler.js     minute cron for scheduled posts; "tomorrow 10am" parsing
models/LinkedInPost.js, models/LinkedInConnection.js
public/linkedin-agent.js              the section, mounted by the four dashboards
```
