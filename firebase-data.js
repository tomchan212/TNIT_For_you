/* ═══════════════════════════════════════════════════════════════════════════
   Firestore data layer.

   Replaces the Apps Script backend. Two things change the shape of the app:

   1. Reads are subscriptions, not polls. onSnapshot pushes updates over one
      open connection, so the interval and backoff machinery the old backend
      needed is gone along with the lag it caused.
   2. Writes land in the local cache first and sync in the background. The SDK
      retries on its own across reconnects, so the app no longer needs its own
      queue to keep the UI responsive.
   ═══════════════════════════════════════════════════════════════════════════ */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  setPersistence,
  browserSessionPersistence,
  signInWithEmailAndPassword,
  signOut
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js';

import { ADMIN_EMAIL, firebaseConfig, participantEmail } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Firestore caps a batch at 500 operations.
const BATCH_LIMIT = 450;

// ─── Authentication ─────────────────────────────────────────────────────────

export function isAdminId(participantId) {
  return String(participantId || '').trim().toUpperCase() === 'ADMIN';
}

export async function signIn(participantId, phone) {
  // Keep the Firebase session in this browser tab only: reload stays signed
  // in, closing the tab (or signing out) clears it.
  await setPersistence(auth, browserSessionPersistence);
  const email = isAdminId(participantId) ? ADMIN_EMAIL : participantEmail(participantId);
  const password = resolveAuthPassword(participantId, phone);
  const credential = await signInWithEmailAndPassword(auth, email, password);
  return credential.user;
}

/**
 * Firebase Auth requires passwords of at least 6 characters. Numbered seats
 * like "1A" are shorter, so we repeat the id until it meets the minimum.
 * The participant still types just their id; this expansion is internal.
 */
export function authPasswordForParticipantId(participantId) {
  const id = String(participantId || '').trim().toUpperCase();
  if (!id) return '';
  if (id.length >= 6) return id;
  let password = id;
  while (password.length < 6) password += id;
  return password;
}

/** Map what the user typed into the Auth password we actually stored. */
export function resolveAuthPassword(participantId, entered) {
  const raw = String(entered || '').trim();
  const id = String(participantId || '').trim().toUpperCase();
  if (raw && id && raw.toUpperCase() === id) {
    return authPasswordForParticipantId(id);
  }
  return raw;
}

export function signOutUser() {
  return signOut(auth);
}

/** Map a Firebase Auth user back to the app's participant id. */
export function identityFromUser(user) {
  if (!user || !user.email) return null;
  const email = String(user.email).trim().toLowerCase();
  if (email === ADMIN_EMAIL.toLowerCase()) {
    return { participantId: 'ADMIN', isAdmin: true };
  }
  const local = email.split('@')[0] || '';
  if (!local) return null;
  return { participantId: local.toUpperCase(), isAdmin: false };
}

/** Resolves once Firebase has restored (or ruled out) a previous session. */
export function waitForAuth() {
  return new Promise(resolve => {
    const stop = onAuthStateChanged(auth, user => {
      stop();
      resolve(user || null);
    });
  });
}

export function describeAuthError(err) {
  switch (err && err.code) {
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return '參加者編號或密碼不正確';
    case 'auth/invalid-email':
      return '參加者編號格式不正確';
    case 'auth/user-disabled':
      return '此帳戶已被停用，請聯絡工作人員';
    case 'auth/too-many-requests':
      return '嘗試次數過多，請稍等一陣再試';
    case 'auth/network-request-failed':
      return '網絡連線失敗，請檢查你的網絡';
    default:
      return (err && err.message) || '登入失敗，請再試一次';
  }
}

// ─── Shared helpers ─────────────────────────────────────────────────────────

function toIso(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  return '';
}

function newestFirst(a, b) {
  return String(b.created_at || '').localeCompare(String(a.created_at || ''));
}

function messageFromDoc(snapshot) {
  // An estimated timestamp keeps a just-sent message in the right order while
  // the server value is still in flight.
  const data = snapshot.data({ serverTimestamps: 'estimate' }) || {};
  return {
    message_id: snapshot.id,
    pending: snapshot.metadata.hasPendingWrites,
    sender_id: data.sender_id || '',
    receiver_id: data.receiver_id || '',
    content: data.content || '',
    created_at: toIso(data.created_at),
    status: data.status || 'active',
    deleted_at: toIso(data.deleted_at)
  };
}

/** Runs a large set of writes as however many batches it takes. */
async function commitAll(operations) {
  for (let i = 0; i < operations.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    operations.slice(i, i + BATCH_LIMIT).forEach(apply => apply(batch));
    await batch.commit();
  }
}

// ─── Groups and teammates ───────────────────────────────────────────────────

export function getTeammates(participantId, allParticipants) {
  const me = (allParticipants || []).find(p => p.participant_id === participantId);
  if (!me) return [];
  const group = String(me.group_id || '').trim();
  if (!group) return [];
  return allParticipants.filter(
    p => p.participant_id !== participantId && String(p.group_id || '').trim() === group
  );
}

// ─── Messages ───────────────────────────────────────────────────────────────

/**
 * Security rules allow reading a message only when the query filters on
 * receiver_id or sender_id, so each of these keeps its where() clause. Status
 * filtering and sorting happen here rather than in the query to avoid needing
 * a composite index.
 */
export function subscribeInbox(participantId, onData, onError) {
  const q = query(collection(db, 'messages'), where('receiver_id', '==', participantId));
  return onSnapshot(q, snapshot => {
    onData(snapshot.docs.map(messageFromDoc).filter(m => m.status === 'active').sort(newestFirst));
  }, onError);
}

export function subscribeSent(participantId, onData, onError) {
  const q = query(collection(db, 'messages'), where('sender_id', '==', participantId));
  return onSnapshot(q, snapshot => {
    onData(snapshot.docs.map(messageFromDoc).sort(newestFirst), snapshot.metadata.hasPendingWrites);
  }, onError);
}

export function subscribeAllMessages(onData, onError) {
  return onSnapshot(collection(db, 'messages'), snapshot => {
    onData(snapshot.docs.map(messageFromDoc).sort(newestFirst));
  }, onError);
}

export function sendMessage(senderId, receiverId, content) {
  const ref = doc(collection(db, 'messages'));
  return setDoc(ref, {
    sender_id: senderId,
    receiver_id: receiverId,
    content,
    status: 'active',
    created_at: serverTimestamp(),
    deleted_at: ''
  });
}

export function retractMessage(messageId) {
  return updateDoc(doc(db, 'messages', messageId), {
    status: 'deleted',
    deleted_at: serverTimestamp()
  });
}

export function restoreMessage(messageId) {
  return updateDoc(doc(db, 'messages', messageId), {
    status: 'active',
    deleted_at: ''
  });
}

// ─── Configuration ──────────────────────────────────────────────────────────

export function subscribeMessagingStatus(onData, onError) {
  return onSnapshot(doc(db, 'config', 'messaging'), snapshot => {
    onData((snapshot.data() || {}).status === 'CLOSE' ? 'CLOSE' : 'OPEN');
  }, onError);
}

export function setMessagingStatus(status) {
  return setDoc(doc(db, 'config', 'messaging'), {
    status: status === 'CLOSE' ? 'CLOSE' : 'OPEN'
  }, { merge: true });
}

export function subscribeVotingConfig(onData, onError) {
  return onSnapshot(doc(db, 'config', 'voting'), snapshot => {
    const data = snapshot.data() || {};
    onData({
      voting_status: data.voting_status || 'DRAFT',
      allow_resubmit: !!data.allow_resubmit,
      calculated_at: toIso(data.calculated_at),
      published_at: toIso(data.published_at)
    });
  }, onError);
}

export async function setVotingStatus(votingStatus, allowResubmit) {
  const patch = { voting_status: votingStatus };
  if (allowResubmit !== undefined) patch.allow_resubmit = !!allowResubmit;
  if (votingStatus === 'PUBLISHED') patch.published_at = serverTimestamp();
  // Reopening voting has to clear the published flag, otherwise participants
  // would keep seeing last round's results while voting again.
  if (votingStatus === 'VOTING_OPEN') {
    patch.published_at = '';
    patch.allow_resubmit = true;
  }
  await setDoc(doc(db, 'config', 'voting'), patch, { merge: true });
}

// ─── Trophies ───────────────────────────────────────────────────────────────

export async function fetchTrophies() {
  const snapshot = await getDocs(collection(db, 'trophies'));
  return snapshot.docs
    .map(d => ({
      trophy_id: (d.data() || {}).trophy_id || d.id,
      trophy_name: (d.data() || {}).trophy_name || d.id
    }))
    .sort((a, b) => a.trophy_id.localeCompare(b.trophy_id));
}

function submissionFromDoc(snapshot) {
  const data = snapshot.data() || {};
  return {
    participant_id: data.participant_id || snapshot.id,
    status: data.status === 'submitted' ? 'submitted' : 'draft',
    pairings: Array.isArray(data.pairings) ? data.pairings : [],
    updated_at: toIso(data.updated_at),
    submitted_at: toIso(data.submitted_at)
  };
}

export function pairingsToAssignments(pairings) {
  const assignments = {};
  (pairings || []).forEach(pair => {
    if (!pair || !pair.receiver_id || !pair.trophy_id) return;
    if (!assignments[pair.receiver_id]) assignments[pair.receiver_id] = [];
    if (!assignments[pair.receiver_id].includes(pair.trophy_id)) {
      assignments[pair.receiver_id].push(pair.trophy_id);
    }
  });
  return assignments;
}

export function subscribeMySubmission(participantId, onData, onError) {
  return onSnapshot(doc(db, 'submissions', participantId), snapshot => {
    onData(snapshot.exists() ? submissionFromDoc(snapshot) : null);
  }, onError);
}

export function saveSubmission(participantId, pairings, submitted) {
  const payload = {
    participant_id: participantId,
    pairings: pairings || [],
    status: submitted ? 'submitted' : 'draft',
    updated_at: serverTimestamp()
  };
  if (submitted) payload.submitted_at = serverTimestamp();
  // The whole ballot is one document, so two people voting at the same moment
  // can never overwrite each other the way appending rows to a sheet could.
  return setDoc(doc(db, 'submissions', participantId), payload, { merge: true });
}

export function subscribeAllSubmissions(onData, onError) {
  return onSnapshot(collection(db, 'submissions'), snapshot => {
    onData(snapshot.docs.map(submissionFromDoc));
  }, onError);
}

// ─── Results ────────────────────────────────────────────────────────────────

function resultFromDoc(snapshot) {
  const data = snapshot.data() || {};
  return {
    participant_id: data.participant_id || snapshot.id,
    awards: Array.isArray(data.awards) ? data.awards : [],
    calculated_at: toIso(data.calculated_at)
  };
}

export function subscribeMyResult(participantId, onData, onError) {
  return onSnapshot(doc(db, 'results', participantId), snapshot => {
    onData(snapshot.exists() ? resultFromDoc(snapshot) : null);
  }, err => {
    // Before results are published the rules deny this read. That is the
    // system working, not a failure worth surfacing to the participant.
    if (err && err.code === 'permission-denied') {
      onData(null);
      return;
    }
    if (onError) onError(err);
  });
}

export function subscribeAllResults(onData, onError) {
  return onSnapshot(collection(db, 'results'), snapshot => {
    onData(snapshot.docs.map(resultFromDoc));
  }, onError);
}

/**
 * Tally awards per group: each trophy goes to whoever holds the highest vote
 * count inside their own group (ties included). No consolation / fallback awards.
 */
export function computeResults(participants, trophies, submissions) {
  const voteCounts = new Map();
  const key = (receiver, trophy) => receiver + '|' + trophy;

  submissions.forEach(submission => {
    (submission.pairings || []).forEach(pair => {
      if (!pair || !pair.receiver_id || !pair.trophy_id) return;
      const k = key(pair.receiver_id, pair.trophy_id);
      voteCounts.set(k, (voteCounts.get(k) || 0) + 1);
    });
  });

  const countFor = (participantId, trophyId) => voteCounts.get(key(participantId, trophyId)) || 0;
  const awarded = new Map(participants.map(p => [p.participant_id, []]));

  const byGroup = new Map();
  participants.forEach(p => {
    const group = p.group_id || '未分組';
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group).push(p);
  });

  byGroup.forEach(members => {
    trophies.forEach(trophy => {
      let best = 0;
      members.forEach(p => {
        best = Math.max(best, countFor(p.participant_id, trophy.trophy_id));
      });
      if (best <= 0) return;
      members.forEach(p => {
        if (countFor(p.participant_id, trophy.trophy_id) !== best) return;
        awarded.get(p.participant_id).push({
          trophy_id: trophy.trophy_id,
          trophy_name: trophy.trophy_name,
          award_source: 'round1',
          vote_count: best
        });
      });
    });
  });

  const trophySummary = trophies.map(trophy => {
    const ranking = participants
      .map(p => ({ participant_id: p.participant_id, vote_count: countFor(p.participant_id, trophy.trophy_id) }))
      .filter(entry => entry.vote_count > 0)
      .sort((a, b) => b.vote_count - a.vote_count);
    const winners = participants
      .filter(p => awarded.get(p.participant_id).some(a => a.trophy_id === trophy.trophy_id))
      .map(p => ({ participant_id: p.participant_id, vote_count: countFor(p.participant_id, trophy.trophy_id) }));
    return {
      trophy_id: trophy.trophy_id,
      trophy_name: trophy.trophy_name,
      winners,
      is_tie: winners.length > 1,
      top_ranking: ranking
    };
  });

  const profiles = participants.map(p => ({
    participant_id: p.participant_id,
    trophies: awarded.get(p.participant_id),
    vote_count: awarded.get(p.participant_id).reduce((sum, a) => sum + (a.vote_count || 0), 0)
  }));

  return { awarded, profiles, trophySummary };
}

export async function writeResults(awarded) {
  const operations = [];
  awarded.forEach((awards, participantId) => {
    operations.push(batch => batch.set(doc(db, 'results', participantId), {
      participant_id: participantId,
      awards,
      calculated_at: serverTimestamp()
    }));
  });
  await commitAll(operations);
  await setDoc(doc(db, 'config', 'voting'), {
    voting_status: 'CALCULATED',
    fallback_activated: false,
    calculated_at: serverTimestamp()
  }, { merge: true });
}

// ─── Admin: participants and contacts ───────────────────────────────────────

export function subscribeParticipants(onData, onError) {
  return onSnapshot(collection(db, 'participants'), snapshot => {
    onData(snapshot.docs.map(d => ({
      participant_id: (d.data() || {}).participant_id || d.id,
      group_id: (d.data() || {}).group_id || ''
    })).sort((a, b) => a.participant_id.localeCompare(b.participant_id)));
  }, onError);
}

export async function fetchContact(participantId) {
  try {
    const snapshot = await getDoc(doc(db, 'contacts', participantId));
    return snapshot.exists() ? (snapshot.data() || {}).phone_number || '' : '';
  } catch (err) {
    // Showing the phone number is a convenience. If the rules have not been
    // updated to grant it yet, the rest of the panel should still work.
    if (err && err.code === 'permission-denied') return '';
    throw err;
  }
}

export function updateParticipantGroup(participantId, groupId) {
  return setDoc(doc(db, 'participants', participantId), {
    participant_id: participantId,
    group_id: groupId
  }, { merge: true });
}

export async function bulkSetGroups(assignments) {
  const operations = Object.entries(assignments).map(([participantId, groupId]) => (
    batch => batch.set(doc(db, 'participants', participantId), {
      participant_id: participantId,
      group_id: groupId
    }, { merge: true })
  ));
  await commitAll(operations);
  return operations.length;
}

// ─── Admin: clearing data ───────────────────────────────────────────────────

export async function clearParticipantRecords(participantId, options = {}) {
  const operations = [];

  if (options.deleteMessages !== false) {
    const snapshot = await getDocs(collection(db, 'messages'));
    snapshot.docs
      .filter(d => (d.data() || {}).sender_id === participantId)
      .forEach(d => operations.push(batch => batch.delete(d.ref)));
  }
  if (options.deleteTrophy !== false) {
    operations.push(batch => batch.delete(doc(db, 'submissions', participantId)));
  }
  if (options.deleteResults !== false) {
    operations.push(batch => batch.delete(doc(db, 'results', participantId)));
  }

  await commitAll(operations);
  return operations.length;
}

export async function clearAllRecords() {
  const operations = [];
  for (const name of ['messages', 'submissions', 'results']) {
    const snapshot = await getDocs(collection(db, name));
    snapshot.docs.forEach(d => operations.push(batch => batch.delete(d.ref)));
  }
  await commitAll(operations);
  await setDoc(doc(db, 'config', 'voting'), {
    voting_status: 'DRAFT',
    allow_resubmit: false,
    calculated_at: '',
    published_at: '',
    fallback_activated: false
  }, { merge: true });
  return operations.length;
}

/** Wipe every message for every participant. */
export async function clearAllMessages() {
  const snapshot = await getDocs(collection(db, 'messages'));
  const operations = snapshot.docs.map(d => batch => batch.delete(d.ref));
  await commitAll(operations);
  return operations.length;
}

/**
 * Clear every ballot and published result. If results were already calculated
 * or published, drop the voting status back to closed so the admin can reopen.
 */
export async function resetAllVotes() {
  const operations = [];
  for (const name of ['submissions', 'results']) {
    const snapshot = await getDocs(collection(db, name));
    snapshot.docs.forEach(d => operations.push(batch => batch.delete(d.ref)));
  }
  await commitAll(operations);

  const votingSnap = await getDoc(doc(db, 'config', 'voting'));
  const status = (votingSnap.data() || {}).voting_status || 'DRAFT';
  const patch = {
    calculated_at: '',
    published_at: '',
    fallback_activated: false
  };
  if (status === 'CALCULATED' || status === 'PUBLISHED') {
    patch.voting_status = 'VOTING_CLOSED';
  }
  await setDoc(doc(db, 'config', 'voting'), patch, { merge: true });
  return operations.length;
}

export async function resetParticipantVote(participantId) {
  await commitAll([
    batch => batch.delete(doc(db, 'submissions', participantId)),
    batch => batch.delete(doc(db, 'results', participantId))
  ]);
}

// ─── Presence ───────────────────────────────────────────────────────────────

/**
 * Marks this participant as here. first_seen sticks for the whole event so the
 * admin dashboard can show who has logged in at least once; last_seen is
 * refreshed on a heartbeat so "currently online" stays meaningful.
 */
export async function touchPresence(participantId) {
  const ref = doc(db, 'presence', participantId);
  const existing = await getDoc(ref);
  const payload = {
    participant_id: participantId,
    online: true,
    last_seen: serverTimestamp()
  };
  if (!existing.exists() || !(existing.data() || {}).first_seen) {
    payload.first_seen = serverTimestamp();
  }
  await setDoc(ref, payload, { merge: true });
}

export function markPresenceOffline(participantId) {
  return setDoc(doc(db, 'presence', participantId), {
    participant_id: participantId,
    online: false,
    last_seen: serverTimestamp()
  }, { merge: true });
}

export function subscribePresence(onData, onError) {
  return onSnapshot(collection(db, 'presence'), snapshot => {
    onData(snapshot.docs.map(d => {
      const data = d.data() || {};
      return {
        participant_id: data.participant_id || d.id,
        online: data.online !== false,
        first_seen: toIso(data.first_seen),
        last_seen: toIso(data.last_seen)
      };
    }));
  }, onError);
}
