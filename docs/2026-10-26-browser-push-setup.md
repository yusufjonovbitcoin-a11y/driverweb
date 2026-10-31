# Browser notification controls — configuration diagnosis

Local notification settings failed before FCM registration: both `VITE_FIREBASE_API_KEY` and `VITE_FIREBASE_VAPID_KEY` were absent from the actual Vite client environment. The token adapter converted the missing VAPID key into a generic registration/network error. The test buttons were disabled because neither category had successfully been enabled.

The public Firebase Web API key and the subsequently supplied VAPID public key are now configured in ignored `.env.local`. The VAPID key passed the P-256 public-key shape check, and both values were verified in the actual Vite client environment without printing them. No service-account private key was added to the frontend. A Firebase Admin service-account JSON is a separate server credential; the attached file was not uploaded or used for this change.

The client now checks configuration before requesting notification permission or attempting registration. Missing Firebase configuration and missing VAPID have separate safe diagnostics. The UI explains why activation/testing is unavailable, and does not display automatic-save reassurance for an unconfigured service. Clear-all remains available when old category preferences exist. No successful push delivery is claimed while configuration is incomplete.

Verification: 934 Node tests, all 34 Profile desktop UI tests, lint, i18n catalog validation and production build passed. The real authenticated localhost page successfully registered with Firebase, independently enabled Calls and Messages, and received a successful browser/service-worker acknowledgement for each category's test notification. Both switches were then restored to their original off state. Screenshot: `output/browser-push-connected.png` shows the final controls after restoration.

The test buttons verify local browser notification display through the service worker. They do not establish server-to-FCM delivery, operating-system banner visibility, or ringing on a locked physical Android device. No driver was called or messaged by the agent. The existing server push configuration was not changed. These local Vite environment values also need to be configured separately in the production deployment environment when deploying the web app.

Reference: [Firebase Web Cloud Messaging setup](https://firebase.google.com/docs/cloud-messaging/web/get-started#configure_web_credentials_with_fcm).
