# Errand messaging

Open **Errands > an accepted errand > Messages > Open chat**. For a demo errand, use **Open demo chat**. Start demo tracking first if the errand is still posted and unassigned.

Each conversation supports:
- Reactive text messages (up to 2,000 characters), with earlier messages loaded in pages.
- One image per message, with an optional caption. Choose a photo or use the camera.
- A preview before sending, removal before sending, and a full-screen image viewer.
- Photos are converted to JPEG before upload, with the longest side limited to 1,920 pixels. This includes HEIC photos that the device can decode. The server enforces a 5 MB limit; videos are not supported.
- Sending feedback and retrying the same request without creating duplicate messages or files.
- Chat remains open after delivery is reported, until the customer confirms receipt. History becomes read-only after confirmation or cancellation.

Only the customer and current assigned runner may access a real conversation. Conversations are separated by assignment; a replacement runner does not receive the previous runner's conversation. There is no inbox, read-receipt system, push notification or runner-assignment UI in this change.

Demo conversations are private to the customer, visibly labelled, and receive fixed simulated acknowledgements. They never contact a real runner. New demo sends require the existing `ENABLE_DEMO_TRACKING=true` Convex development setting.

## Running

These features use Expo ImagePicker, ImageManipulator, FileSystem and Expo Image and are compatible with Expo Go. Restart Metro with `npx expo start --go --clear` after installing dependencies, then reload the app.

Image sending uses the authenticated `/chat/image` HTTP endpoint at `EXPO_PUBLIC_CONVEX_SITE_URL`, which is already configured in this project. Text uses Convex mutations and both message types arrive via reactive queries. No extra messaging service or new credentials are needed.

The image picker config includes camera/photo permission descriptions and disables microphone permission. These config changes apply to the next custom native build; Expo Go already includes its own picker.

## Implementation

- `convex/messages.ts`: access-checked context, pagination, text send and internal image commit.
- `convex/lib/chatAccess.ts`: assignment, participant and closed-errand checks.
- `convex/chatUploads.ts`: authenticated, size-bounded multipart uploads; validates actual image signatures and normalizes the stored MIME type before atomically creating its message. Failed commits clean up their new file.
- `convex/lib/chatImage.ts`: upload byte limit and JPEG/PNG/WebP signature recognition.
- `src/components/chat-composer.tsx`: draft, photo picker, camera, JPEG conversion, upload and retry behavior. Native uploads use an Expo File rather than the URI descriptor rejected by Expo fetch.
- `src/components/errand-chat.tsx`: conversation, message bubbles, paging and image viewer.
- `src/app/errands/chat.tsx`: authenticated screen and recoverable error boundary.

Storage download URLs are returned only through authorized message queries. They are bearer links, so a participant who copies an image URL can share access to that image. This is not end-to-end encrypted messaging. Drafts and an unconfirmed upload are held in screen state; leaving the screen aborts the active HTTP upload, but an already-committed message remains in history.

## Validation

`npm test` and `npm run typecheck` cover the backend and TypeScript integration. The new tests cover real participants, outsiders, retries, blank/oversized text, closed errands, reassignment, demo isolation, actual HTTP image uploads, captions, file deduplication, invalid file signatures, oversized/chunked requests and pagination.

Device smoke test: open a demo chat, send a short text, select a small JPG/PNG, add a caption and send, tap the received image to view it, then test camera permission denial and a network interruption. Complete the errand and check that history remains readable while sending is disabled. Image picking, camera access and keyboard layout still need this physical-device check.

References: [Expo 57 ImagePicker](https://docs.expo.dev/versions/v57.0.0/sdk/imagepicker/), [Convex HTTP actions](https://docs.convex.dev/functions/http-actions), [Convex file storage](https://docs.convex.dev/file-storage/upload-files).
