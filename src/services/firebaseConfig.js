// Firebase Web configuration and the VAPID public key are public identifiers.
// Never put a Firebase service-account private key in this client bundle.
export const firebaseConfig = Object.freeze({
  apiKey: import.meta.env?.VITE_FIREBASE_API_KEY?.trim() || '',
  authDomain: 't-fleets.firebaseapp.com',
  projectId: 't-fleets',
  storageBucket: 't-fleets.firebasestorage.app',
  messagingSenderId: '931497947609',
  appId: '1:931497947609:web:c57364527df474a974a9c8',
  measurementId: 'G-SHX06FX3BV',
});
export const firebaseVapidKey = import.meta.env?.VITE_FIREBASE_VAPID_KEY?.trim() || '';

let appPromise;
export function getFirebaseApp() {
  if (!firebaseConfig.apiKey) return Promise.reject(new Error('Firebase web configuration is missing'));
  appPromise ??= import('firebase/app').then(({ getApps, initializeApp }) =>
    getApps().find((app) => app.name === 't-fleets-web') || initializeApp(firebaseConfig, 't-fleets-web'));
  return appPromise;
}
