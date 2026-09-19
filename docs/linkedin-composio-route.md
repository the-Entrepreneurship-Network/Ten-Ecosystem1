# The Composio route — reference only, not the route this app takes

Third-party reference material, kept here so the decision not to use it is
legible later. Verbatim from `skills/linkedin-automation/SKILL.md` in the
`mcpmarket-me` plugin (MCPmarket, community-contributed, marked `risk: unknown`),
below the horizontal rule. Nothing in this document is wired into the app.

**Why it is not the route.** Read the tool table at the bottom. Every write path
here is person-scoped: `LINKEDIN_GET_MY_INFO` returns a `urn:li:person:` URN,
`visibility` takes `PUBLIC` or `CONNECTIONS`, and `LINKEDIN_GET_COMPANY_INFO` only
reads. There is no create-organization-post tool. So this publishes to a personal
profile, and this was evaluated when the plan was still to post to the TEN
**company page** automatically.

It is genuinely true that this needs no LinkedIn app approval. That is because
Composio's own approved app holds the OAuth, and personal posting only wants
`w_member_social`. Company-page posting wants `w_organization_social`, which
requires Community Management API approval whoever asks for it. Composio does not
remove that requirement; it sidesteps it by not posting to a page at all.

The two routes that do reach a company page are recorded in
[linkedin-agent.md](linkedin-agent.md): our own app once Community Management
approval lands, or a scheduler that already holds approval and lets a page admin
connect the page through its OAuth.

**Do not install the plugin this came from.** It ships a `SessionStart` hook plus
`PostToolUse`/`PostToolUseFailure` hooks on every `Skill` call, each POSTing to
`app.mcpmarket.com`, and its `shared/sync.sh` does `rm -rf` on skill directories
it does not recognise as its own. Its `.mcp.json` also shipped with a live bearer
token committed in plaintext.

---

Automate LinkedIn operations through Composio's LinkedIn toolkit via Rube MCP.

## Prerequisites

- Rube MCP must be connected (RUBE_SEARCH_TOOLS available)
- Active LinkedIn connection via `RUBE_MANAGE_CONNECTIONS` with toolkit `linkedin`
- Always call `RUBE_SEARCH_TOOLS` first to get current tool schemas

## Setup

**Get Rube MCP**: Add `https://rube.app/mcp` as an MCP server in your client configuration. No API keys needed — just add the endpoint and it works.


1. Verify Rube MCP is available by confirming `RUBE_SEARCH_TOOLS` responds
2. Call `RUBE_MANAGE_CONNECTIONS` with toolkit `linkedin`
3. If connection is not ACTIVE, follow the returned auth link to complete LinkedIn OAuth
4. Confirm connection status shows ACTIVE before running any workflows

## Core Workflows

### 1. Create a LinkedIn Post

**When to use**: User wants to publish a text post on LinkedIn

**Tool sequence**:
1. `LINKEDIN_GET_MY_INFO` - Get authenticated user's profile info [Prerequisite]
2. `LINKEDIN_REGISTER_IMAGE_UPLOAD` - Register image upload if post includes an image [Optional]
3. `LINKEDIN_CREATE_LINKED_IN_POST` - Publish the post [Required]

**Key parameters**:
- `text`: Post content text
- `visibility`: 'PUBLIC' or 'CONNECTIONS'
- `media_title`: Title for attached media
- `media_description`: Description for attached media

**Pitfalls**:
- Must retrieve user profile URN via GET_MY_INFO before creating a post
- Image uploads require a two-step process: register upload first, then include the asset in the post
- Post text has character limits enforced by LinkedIn API
- Visibility defaults may vary; always specify explicitly

### 2. Get Profile Information

**When to use**: User wants to retrieve their LinkedIn profile or company details

**Tool sequence**:
1. `LINKEDIN_GET_MY_INFO` - Get authenticated user's profile [Required]
2. `LINKEDIN_GET_COMPANY_INFO` - Get company page details [Optional]

**Key parameters**:
- No parameters needed for GET_MY_INFO (uses authenticated user)
- `organization_id`: Company/organization ID for GET_COMPANY_INFO

**Pitfalls**:
- GET_MY_INFO returns the authenticated user only; cannot look up other users
- Company info requires the numeric organization ID, not the company name or vanity URL
- Some profile fields may be restricted based on OAuth scopes granted

### 3. Manage Post Images

**When to use**: User wants to upload and attach images to LinkedIn posts

**Tool sequence**:
1. `LINKEDIN_REGISTER_IMAGE_UPLOAD` - Register an image upload with LinkedIn [Required]
2. Upload the image binary to the returned upload URL [Required]
3. `LINKEDIN_GET_IMAGES` - Verify uploaded image status [Optional]
4. `LINKEDIN_CREATE_LINKED_IN_POST` - Create post with the image asset [Required]

**Key parameters**:
- `owner`: URN of the image owner (user or organization)
- `image_id`: ID of the uploaded image for GET_IMAGES

**Pitfalls**:
- The upload is a two-phase process: register then upload binary
- Image asset URN from registration must be used when creating the post
- Supported formats typically include JPG, PNG, and GIF
- Large images may take time to process before they are available

### 4. Comment on Posts

**When to use**: User wants to comment on an existing LinkedIn post

**Tool sequence**:
1. `LINKEDIN_CREATE_COMMENT_ON_POST` - Add a comment to a post [Required]

**Key parameters**:
- `post_id`: The URN or ID of the post to comment on
- `text`: Comment content
- `actor`: URN of the commenter (user or organization)

**Pitfalls**:
- Post ID must be a valid LinkedIn URN format
- The actor URN must match the authenticated user or a managed organization
- Rate limits apply to comment creation; avoid rapid-fire comments

### 5. Delete a Post

**When to use**: User wants to remove a previously published LinkedIn post

**Tool sequence**:
1. `LINKEDIN_DELETE_LINKED_IN_POST` - Delete the specified post [Required]

**Key parameters**:
- `post_id`: The URN or ID of the post to delete

**Pitfalls**:
- Deletion is permanent and cannot be undone
- Only the post author or organization admin can delete a post
- The post_id must be the exact URN returned when the post was created

## Common Patterns

### ID Resolution

**User URN from profile**:
```
1. Call LINKEDIN_GET_MY_INFO
2. Extract user URN (e.g., 'urn:li:person:XXXXXXXXXX')
3. Use URN as actor/owner in subsequent calls
```

**Organization ID from company**:
```
1. Call LINKEDIN_GET_COMPANY_INFO with organization_id
2. Extract organization URN for posting as a company page
```

### Image Upload Flow

- Call REGISTER_IMAGE_UPLOAD to get upload URL and asset URN
- Upload the binary image to the provided URL
- Use the asset URN when creating a post with media
- Verify with GET_IMAGES if upload status is uncertain

## Known Pitfalls

**Authentication**:
- LinkedIn OAuth tokens have limited scopes; ensure required permissions are granted
- Tokens expire; re-authenticate if API calls return 401 errors

**URN Formats**:
- LinkedIn uses URN identifiers (e.g., 'urn:li:person:ABC123')
- Always use the full URN format, not just the alphanumeric ID portion
- Organization URNs differ from person URNs

**Rate Limits**:
- LinkedIn API has strict daily rate limits on post creation and comments
- Implement backoff strategies for bulk operations
- Monitor 429 responses and respect Retry-After headers

**Content Restrictions**:
- Posts have character limits enforced by the API
- Some content types (polls, documents) may require additional API features
- HTML markup in post text is not supported

## Quick Reference

| Task | Tool Slug | Key Params |
|------|-----------|------------|
| Get my profile | LINKEDIN_GET_MY_INFO | (none) |
| Create post | LINKEDIN_CREATE_LINKED_IN_POST | text, visibility |
| Get company info | LINKEDIN_GET_COMPANY_INFO | organization_id |
| Register image upload | LINKEDIN_REGISTER_IMAGE_UPLOAD | owner |
| Get uploaded images | LINKEDIN_GET_IMAGES | image_id |
| Delete post | LINKEDIN_DELETE_LINKED_IN_POST | post_id |
| Comment on post | LINKEDIN_CREATE_COMMENT_ON_POST | post_id, text, actor |

## When to Use
This skill is applicable to execute the workflow or actions described in the overview.
