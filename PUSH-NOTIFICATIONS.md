# Buyer and runner push notifications

## Current readiness

App registration, per-device preferences, notification navigation and the Convex delivery queue are implemented. `expo-notifications` is installed and its native plugin is configured. **No real phone push has been verified.**

Joel chose iPhone first and currently has no paid Apple Developer membership. Signed iPhone development-build installation and APNs credential setup remain pending. As of 2026-10-05 the app is linked to the existing Expo project `33fea92d-6ddd-44e3-a5cf-940f36d671b7`, and a standalone Android preview APK build has been submitted with package `com.joel61.melangemobile`. APK packaging does not configure Firebase/FCM or validate notification delivery. No Apple membership purchase or Apple credential creation was performed. Expo Go continues to support the existing live in-app updates, but this implementation deliberately enables remote push registration only in a development/standalone build, not Expo Go or web.

## Included events

| Recipient | Event |
| --- | --- |
| Buyer | Runner sends or changes a service-fee quote; runner withdraws a quote |
| Runner | Buyer declines a quote or approves it and assigns the job |
| Both | A new text/image message from the other participant |
| Buyer | Pickup confirmed; delivery reported |
| Buyer | Collection approval requested, once per request version on a tracked assignment |
| Runner and each active buyer | Tracking interruption, attention and recovery, once per run incident and kind |
| Runner | Buyer confirms completion; buyer submits a review |
| Runner | Buyer reports sending the service fee |
| Buyer | Runner confirms receiving the service fee |

Settings on both roles offer **Push notifications**, with separate message and errand-update preferences. Permission is requested only after the user chooses Enable. Returning to the app refreshes registration for an account that has already opted in. Signing out unregisters this installation and clears its local binding. Notifications open the related chat or errand; quote updates that no longer lead to an accessible runner errand open My pricing & quotes.

This phase does not include broadcasts of newly posted errands, scheduled reminders, browser push, or Telegram admin notifications. It does not add substitution, expense or problem-report alerts before those workflows exist.

## iPhone setup when Apple membership is available

Official instructions: https://docs.expo.dev/push-notifications/push-notifications-setup/

From `melange mobile/app` in PowerShell:

```powershell
npx eas-cli@latest login
npx eas-cli@latest init
npx eas-cli@latest build:configure
npx eas-cli@latest device:create
```

- Connect the correct Expo project; EAS writes `extra.eas.projectId` into app configuration.
- Choose the permanent iOS bundle identifier when prompted. Do not reuse the old web app's identity by guessing.
- Register the physical iPhone through the device-registration link.
- Configure the EAS development environment with `EXPO_PUBLIC_CONVEX_URL` and `EXPO_PUBLIC_CONVEX_SITE_URL`, using the existing `.env.local` values. These are public endpoint URLs. Ignored `.env.local` should not be relied on to supply cloud-build configuration.
- Let EAS configure signing and APNs credentials through the Apple account. Keep Apple credentials out of source files and chat.

Then build:

```powershell
npx eas-cli@latest build --platform ios --profile development
```

Install the resulting development build on the registered iPhone, enable Developer Mode if prompted, and start Metro:

```powershell
npx expo start --dev-client --clear
```

On the iPhone, sign in → Settings → Push notifications → Enable. Repeat for the runner account on its own device (or use the browser as the other participant to trigger events). Development and background-location native changes require rebuilding an older development client too.

For Android instead, configure an Android application ID, Firebase `google-services.json` and FCM V1 credentials in EAS before building with `--platform android`. This does not require Apple membership. Use Expo's official FCM setup guide; never embed the FCM service-account private key in the mobile app.

## Backend operation

Business mutations create `pushJobs` only for registered devices with the relevant preference enabled. Each device/event pair is deduplicated. Demo events do not send pushes. Delivery actions send to Expo, retry network/429/5xx errors with bounded backoff, recover interrupted sends with a lease, and check push receipts after 15 minutes. Invalid device tokens are removed. Up to five registrations are kept per account.

`pushJobs.state = delivered` means Expo's receipt reports acceptance by the platform provider, not that a person read the notification or that the phone displayed it. External delivery is best effort and can duplicate after an ambiguous timeout despite business-event deduplication.

Bodies do not include chat text, images, addresses, payment account numbers or errand titles. Notification taps resolve the target through an authenticated query instead of trusting an arbitrary URL from the payload. Reassigning a device deletes the old binding, so queued jobs for it cannot be sent to its new account; a push already handed to the platform cannot be recalled reliably.

For tracked assignments, dispatch/retry and notification navigation re-check current membership, enabled runner access, incident identity and server-time tracking state. Terminal or superseded buyer notices are skipped. The runner receives one alert per incident/kind and may open a still-active member after the first shared delivery; a delivered buyer is never redirected to another buyer’s errand. Reactive tracking/pickup cards and neutral activity need no push token. Task 6 automated dispatch uses a mocked provider and does not verify real phone delivery.

The Expo Push API is used server-side. If Expo enhanced push security is enabled, set `EXPO_ACCESS_TOKEN` as a Convex environment secret. Never use an `EXPO_PUBLIC_` variable for that token. Provider error codes and tickets are stored for diagnosis; push tokens are never returned by public device queries.

## Pending device checks

1. Allow/deny notifications and verify Settings accurately describes the permission outcome.
2. With buyer and runner accounts, submit/approve a quote; send text and image messages; progress delivery; complete/review; report/confirm direct payment.
3. Check notifications while foregrounded, backgrounded and closed. Tap an alert from a cold start and confirm the correct role and screen open after authentication.
4. Disable either preference, turn alerts off, sign out, and switch accounts on the same phone; check the previous account no longer receives new alerts there.
5. Inspect Convex push jobs for Expo credential or receipt errors. Automated mocked-provider tests and JS exports do not prove native push delivery.
