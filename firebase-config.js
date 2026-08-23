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

// Participants log in as A1 / 4-digit password, which maps to a1@tnit.org
// (and still 1a@tnit.local / a1@tnit.local for leftover accounts).
export const EMAIL_DOMAIN = 'tnit.org';
export const LEGACY_EMAIL_DOMAIN = 'tnit.local';
export const ADMIN_EMAIL = 'admin@tnit.local';

export function participantEmail(participantId, domain = EMAIL_DOMAIN) {
  return `${String(participantId || '').trim().toLowerCase()}@${domain}`;
}

function flippedLegacyLocal(participantId) {
  const raw = String(participantId || '').trim().toLowerCase();
  const fromNew = raw.match(/^([a-h])(\d+)$/);
  if (fromNew) return `${fromNew[2]}${fromNew[1]}`;
  const fromOld = raw.match(/^(\d+)([a-h])$/);
  if (fromOld) return `${fromOld[2]}${fromOld[1]}`;
  return '';
}

export function participantEmails(participantId) {
  const local = String(participantId || '').trim().toLowerCase();
  if (!local) return [];
  const locals = [local];
  const flipped = flippedLegacyLocal(local);
  if (flipped && flipped !== local) locals.push(flipped);
  const emails = [];
  locals.forEach(part => {
    emails.push(participantEmail(part, EMAIL_DOMAIN));
    if (LEGACY_EMAIL_DOMAIN && LEGACY_EMAIL_DOMAIN !== EMAIL_DOMAIN) {
      emails.push(participantEmail(part, LEGACY_EMAIL_DOMAIN));
    }
  });
  return emails;
}
