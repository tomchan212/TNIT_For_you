// Firebase client configuration for HKCYS TNIT Just For You.
//
// These values are meant to be public: they identify the project, they do not
// grant access to it. What actually protects the data is firestore.rules plus
// each participant needing to sign in. Never put the service account key here.

export const firebaseConfig = {
  apiKey: 'AIzaSyBIQrLARWje_fe7TX7f2u0Wk7xjFDAyNcs',
  authDomain: 'tnit-6c48d.firebaseapp.com',
  projectId: 'tnit-6c48d',
  storageBucket: 'tnit-6c48d.firebasestorage.app',
  messagingSenderId: '649245917670',
  appId: '1:649245917670:web:dce565a213bade09fc1627',
};

/**
 * Web Push VAPID key from Firebase Console → Project settings → Cloud Messaging
 * → Web Push certificates. Also overridable via Firestore config/push.vapidKey.
 * Leave empty until generated; client will refuse to register tokens without it.
 */
export const FCM_VAPID_KEY = '';

// Participants log in as 1A / 1A, which maps to 1a@tnit.org (and still
// 1a@tnit.local for accounts created before the domain switch).
export const EMAIL_DOMAIN = 'tnit.org';
export const LEGACY_EMAIL_DOMAIN = 'tnit.local';
export const ADMIN_EMAIL = 'admin@tnit.local';

export function participantEmail(participantId, domain = EMAIL_DOMAIN) {
  return `${String(participantId || '').trim().toLowerCase()}@${domain}`;
}

export function participantEmails(participantId) {
  const local = String(participantId || '').trim().toLowerCase();
  if (!local) return [];
  const emails = [participantEmail(local, EMAIL_DOMAIN)];
  if (LEGACY_EMAIL_DOMAIN && LEGACY_EMAIL_DOMAIN !== EMAIL_DOMAIN) {
    emails.push(participantEmail(local, LEGACY_EMAIL_DOMAIN));
  }
  return emails;
}
