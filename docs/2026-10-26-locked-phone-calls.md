# Locked-phone incoming call diagnosis — 26 October 2026

User report: calls appear after opening the mobile app, but do not ring while the phone is locked.

## Confirmed first broken boundary

The latest recipient is an active driver. For that recipient, the live database has **zero push-device registrations and zero VoIP-device registrations**. The two calls at 03:59 UTC on 26 October have no native delivery rows. The previous call on 25 October likewise has no device/delivery. This prevents the server from addressing a background wake to that installation. Foreground Realtime signaling can still work.

The server workers are running: `native-call-delivery` every five seconds and chat push every ten seconds. The latest worker outcomes inspected at about 04:01 UTC were HTTP 200 with empty queues. An empty successful worker run does not verify phone delivery.

No real call, test notification, registration mutation, credential change or production deploy was performed during diagnosis.

## Mobile source inspected

The sibling workspace `C:/Users/Intel/Desktop/driverapp` contains the Flutter client and native Android/iOS call handlers. It already implements `register_push_device`, Android `register_native_call_device`, iOS `register_voip_device`, token-refresh listeners and registration retry.

The local Android `android/app/google-services.json` and iOS `ios/Runner/GoogleService-Info.plist` are both absent. Debug builds can continue without Firebase configuration; the push initializer then returns false. The installed mobile build has not been inspected, so missing local files are a build risk, **not proof** that the user's installed build lacks its configuration.

No Android device is connected through ADB. Phone OS and installation type were requested from the user; that answer is needed to distinguish native APK/iOS from browser/PWA and target the installation correctly.

## Separate iOS evidence

The project has no VoIP device registrations at all. Two older iOS FCM deliveries for a different call were cancelled with `FCM call delivery failed (401, THIRD_PARTY_AUTH_ERROR)`. Firebase documents this error as invalid/missing APNs or web-push authentication. This is separate from the latest recipient's complete lack of a registration; do not attribute the older provider error to the latest phone without device/account evidence.

Reference: https://firebase.google.com/docs/cloud-messaging/error-codes

## Next verification

1. Identify Android/iPhone/browser and installed build.
2. Inspect that installation's Firebase/APNs setup, notification permission and token-registration result without printing tokens.
3. Confirm an enabled device registration for the current recipient. On iOS confirm its PushKit VoIP registration and matching APNs environment/topic.
4. Only after the user authorizes a call to a named test recipient, test foreground, background and locked delivery. A provider `sent` result does not prove the phone displayed its call UI.

## Remediation after Android clarification

The user confirmed Android and supplied the Android `google-services.json` and iOS plist. Both were validated against Firebase project `t-fleets`, sender `931497947609` and package/bundle `com.tfleest.truck`, then restored to the mobile project's ignored native configuration paths. Public Supabase/Mapbox client build settings were prepared from the existing web configuration; the build refuses privileged Supabase keys.

The previously generated local Profile APK was inspected with `aapt2` and lacked all four initialization resources: `google_app_id`, `gcm_defaultSenderId`, `project_id`, `google_api_key`. This confirms the local APK's push setup defect. It does not independently identify the binary currently installed on the phone.

Changes in `C:/Users/Intel/Desktop/driverapp`:

- Profile builds now fail, like Release builds, when `android/app/google-services.json` is absent. The missing-config case was exercised with an actual Profile build and failed with the intended message before compilation.
- `tools/verify_android_push.py` inspects the APK's initialization resources without printing keys; `scripts/build_android.sh` runs it before copying an APK for distribution.
- `docs/PUSH_NOTIFICATIONS.md` documents the Profile build requirement and verification.
- No call runtime or business rules were rewritten; the confirmed missing build configuration was restored.

Verification:

- 44 focused Flutter tests passed across push service lifecycle, native runtime/events and native chat.
- `flutter build apk --profile --no-pub --dart-define-from-file=config/supabase.local.json` succeeded.
- Newly built APK passed Firebase resource inspection, `apksigner verify` and copied-artifact SHA-256 equality.
- Artifact: `C:/Users/Intel/Desktop/driverweb/output/t-fleets-android-calls.apk` (Profile build for device testing).
- Logs: `output/android-push-preflight.log`, `output/android-background-calls-build.log`, `output/android-background-calls-tests.log`.

Next required device step: install this APK, open it and authenticate once, grant notification/microphone/full-screen call permissions as offered, then verify an enabled Android registration and locked-screen call. No phone is attached through ADB, so installation and physical-device ringing have not been asserted. The separate old iOS FCM authentication error was not changed by restoring local client configuration.

## Installation and registration verified

Later in the same session, the user connected a Samsung SM-A156M and explicitly requested installation. `adb install -r` returned `Success`; the package update was verified and `com.tfleest.truck/.MainActivity` launched successfully. Existing notification and microphone grants were both true; no app data was cleared and no additional permission was force-granted.

At 04:34 UTC (09:34 Asia/Karachi) on 26 October, the live database showed one newly registered, enabled Android device with `native_calls=true` for the latest call recipient. This resolves the previously confirmed missing device-registration boundary. A real incoming call to the locked phone has not been initiated or asserted by the agent; the user can now run that device test.
