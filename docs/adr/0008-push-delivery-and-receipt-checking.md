# 0008. Push delivery: fire-and-forget, receipts checked in memory

- **Status:** Accepted
- **Date:** 2026-09-28

## Context

Push notifications go through Expo's push service. Expo's protocol has two
steps. Sending returns a **ticket** per message, which only says Expo
accepted it. About 15 minutes later a **receipt** says whether Apple or Google
delivered it. Receipts are kept for 24 hours.

A `DeviceNotRegistered` error means the app was uninstalled or the token
rotated, and the token should be deleted. It usually shows up on the
receipt, not the ticket. The original code only looked at tickets, so dead
tokens piled up and were retried on every notification.

## Decision

- Sending stays **fire-and-forget**: `NotificationsService` calls
  `void push.sendToUser(...)` after the database transaction commits, and
  `PushService` never throws. A failed push never fails the request that
  caused it.
- `PushService` remembers each successful ticket id and its token **in
  memory**. Every 10 minutes it fetches receipts for tickets at least 15
  minutes old, deletes tokens whose receipt says `DeviceNotRegistered`, and
  forgets the ticket. Tickets without a receipt yet are retried until the
  24-hour retention runs out. The map is capped at 10 000 entries, dropping
  the oldest.

## Alternatives considered

- **A `push_tickets` table.** It survives restarts, but costs a migration,
  a write per notification and a cleanup job. What a restart loses is at
  most one receipt check per recent token, and the next push to a dead
  token produces a fresh ticket that gets checked.
- **A queue with retries for the sends themselves.** Worth it once
  notifications carry anything that must arrive; today they are nudges, and
  the app shows the same state when opened.

## Consequences

- A notification can be lost if Expo is down when it is sent. Nothing
  retries it.
- Each instance checks only the tickets it sent, which stays correct if the
  API is scaled out.
- The notification catalogue is in [notifications.md](../notifications.md).
