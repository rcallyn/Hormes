# Hormes on iPhone

A native companion for the existing saved Mac quizzes. The student can answer short MCQs in an expanded Dynamic Island or on the Lock Screen, without opening the app. Longer questions open the companion. A downloaded review and its answer outbox work without Wi-Fi or an awake Mac.

## Pair and use

1. Build and install on an unlocked, paired iPhone with Developer Mode enabled:
   `pnpm build:ios --device <identifier-from-xcrun-devicectl-list-devices>`.
2. On the Mac, open Console → Settings → iPhone → Pair iPhone.
3. On iPhone, open Hormes → Pair with Mac → Scan Mac QR code. The QR code expires in two minutes and can be redeemed once. Allow Local Network and Camera when using those features.
4. Set up automatic delivery in Mac Settings → iPhone → Set up. Select your Apple Push authentication `.p8` key, Team ID, Key ID, and environment. A development iPhone build uses Sandbox; TestFlight/App Store use Production. The app must be signed with the Push Notifications capability. Xcode → Settings → Accounts must have a valid developer login.
5. Prepare the four-question review through the existing next-class flow, or prepare a saved quiz. The Mac starts a Live Activity through Apple Push even while the phone app is closed. Short review packs arrive encrypted for that phone, without needing the Mac’s Wi-Fi for answering. Reviews downloaded in the foreground also start automatically; there is no start button.
6. Hold the compact island to expand it; answer and press Next. The same review is available in the phone app. Lock Screen actions require unlocking/authentication as determined by iOS. The system controls presentation and the user can dismiss or disable Live Activities.
7. Saved answers sync when the companion reconnects to the Mac. Console → Education → Today shows iPhone attempts. Pull to refresh or use Connection → Sync for a manual retry. If the Mac’s network address changes, pair again.

The Mac uses its existing Gemini Live voice setting. The companion has no voice provider or model API credential. It checks cached choices against the same tutor-authored reference key, and never claims broad mastery from an MCQ score. Demo attempts stay separate from real learning.

## Implementation

- `PhoneBridge` in the daemon serves TLS on port 47831 only after explicit pairing. Previously enabled connections resume with the daemon. The Unix daemon, tools, settings, microphone and model credentials are never exposed over this listener.
- The QR pins the SHA-256 fingerprint of a persistent self-signed certificate. The phone rejects certificate changes and redirects. The Mac stores device token hashes in mode-0600 files; the phone keeps its token in Keychain. Removing a phone in Mac Settings revokes it.
- Routes are limited to `/v1/pair`, `/v1/quiz`, `/v1/answers` and authenticated `/v1/push-token` registration. A quiz ID can retrieve only a previously exported review. Quiz snapshots freeze the source session and reference key. The app caches the reference key privately; it never enters Live Activity state or appears before an answer.
- Choice IDs are durable and idempotent. The application checks the original session's saved key on sync, records server receipt time, preserves device time separately and publishes the normal work history. A late phone answer cannot resume a session, run a tool, change current Mac work or complete a goal. Conflicting prior answers and revised criteria are rejected visibly.
- Outboxes are bound to the Mac certificate identity. A re-pair to a different Mac cannot upload another Mac's saved reviews. Pending answers are retained until individually acknowledged; rejection preserves the local answer for review.
- Short questions with up to four short choices fit the island. Larger prompts/options use an Open question link. Live Activity payloads are bounded below Apple's 4 KB combined state/attribute limit.

Automatic background delivery uses ActivityKit push-to-start (iOS 17.2+). A new quiz is sent once per paired phone; repeated work updates cannot restart it. Changed push tokens are registered on reconnection. Apple failures remain visible and retries are bounded. The APNs key is stored privately on the Mac; ES256 provider tokens rotate within one hour. Removing a phone stops delivery and sync access.

The full private review is compressed with raw DEFLATE, then sealed using AES-256-GCM for the paired phone. A `v1.` combined nonce/ciphertext/tag is carried in the Live Activity attributes. The phone decrypts it in Apple's background runtime and saves it before answering. Reference keys never appear in public activity state. Combined payloads stay below 4 KB. Larger packs need a local TLS download; oversized individual questions open the phone app.

First pairing and answer sync use local Wi-Fi. There is no internet relay for answer uploads or large downloads. Starting a new remotely delivered review needs the Mac online, phone internet, valid Apple Push setup and permitted Live Activities. Existing downloaded reviews work offline. Apple Push signing and real background delivery must be verified on a properly provisioned iPhone; simulator tests alone do not establish physical-device delivery.

## Build and verify

No npm or project-generation dependencies were added. Xcode and Python's standard library are sufficient; the generated Xcode project is committed alongside its reproducible generator.

```sh
pnpm build:ios
xcodebuild -project apps/ios/HormesPhone.xcodeproj -scheme HormesPhone \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro' \
  -derivedDataPath build/ios-simulator CODE_SIGN_IDENTITY=- test
```

Simulator builds use ad-hoc signing so Keychain pairing works. The icon uses the same five voice bars as the Mac; regenerate it with `node --import tsx apps/ios/Scripts/make-icon.ts`.

The unit checks cover durable offline answers, duplicate taps, private reference keys, oversized activity content, cross-platform encrypted delivery and preservation of corrupt caches. The UI check verifies automatic appearance with no start button, answers a question through the actual expanded Dynamic Island and verifies progress after relaunch. Server checks cover TLS pairing, expiration, replay, auth, revocation, scoped routes, partial acknowledgements and durable cross-session answer sync.
