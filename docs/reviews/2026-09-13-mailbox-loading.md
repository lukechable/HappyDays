# Mailbox loading — 13 September 2026

The follow-up clarified that the mailboxes open after a delay. Live checks on the previous build returned 20 rows for Inbox, Unread, Sent, Starred, Drafts and Archive.

Changes:

- Remove the redundant browser token bucket, which prepaid 810 units per folder regardless of the actual result size. The shared backend quota remains enforced across tabs and background workers. The browser now limits concurrency to two reads and cancels obsolete queued reads.
- Fetch 10 conversations on the first page and 20 on subsequent pages, reducing initial thread-read work by half.
- Show explicit loading text; preserve immediate display of recently cached folders.
- Do not cache failed reads as successful empty folders. On returning to a failed folder, show the error and retry. Invalidate old list-cache entries, preserving cached message bodies.
- Reject failed, missing and malformed Gmail batch parts rather than silently returning an empty/partial mailbox. A thread deleted between listing and reading (404) remains skippable.
- Include Spam/Trash when opening those mailboxes, as supported by [Gmail threads.list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.threads/list).
- Keep Load more available on an empty intermediate page and avoid adding the same other-mailbox count again on pagination.

Validation: typecheck, ESLint, production webpack build; 99 automated tests (90 Vitest plus 9 rebate rules). New tests reproduce the previous empty-cache and batch-error failures, exercise nonempty results through all 16 Gmail-backed folder/search views, verify cached return navigation, and verify immediate/cancelled/bounded browser reads.
