# Notifications

Every push notification the API sends, for wiring up the mobile app's
notification handler. They are sent through Expo after the triggering change
has committed, and are best-effort
([ADR 0008](adr/0008-push-delivery-and-receipt-checking.md)).

Every payload's `data` has a `type` and a `jobId` to deep-link to.

| `type`                 | To       | When                                                        | Extra `data`                                   |
| ---------------------- | -------- | ----------------------------------------------------------- | ---------------------------------------------- |
| `application.created`  | employer | A worker applied to their job                               | —                                              |
| `application.accepted` | worker   | The employer accepted them                                  | —                                              |
| `application.rejected` | worker   | The employer rejected them, or withdrew an acceptance       | —                                              |
| `application.closed`   | worker   | The job stopped hiring while they were still `pending`      | `reason`: `filled` \| `cancelled` \| `expired` |
| `job.cancelled`        | worker   | A job they were hired for was cancelled                     | —                                              |
| `job.expiring`         | employer | Daily at 09:00 Zurich, for their open jobs expiring in 24 h | —                                              |

The wording lives in
[`notifications.service.ts`](../apps/api/src/modules/notifications/notifications.service.ts).

## Tokens

- The app registers its Expo push token with
  `POST /v1/users/me/push-tokens` after sign-in, and removes it with
  `DELETE /v1/users/me/push-tokens/:token` on sign-out.
- A token belongs to the device, not the account. Registering a token that
  another account had moves it to the current user.
- Tokens Expo reports as `DeviceNotRegistered` are deleted automatically,
  whether the report comes on the send ticket or on the delivery receipt
  checked about 15 minutes later.
