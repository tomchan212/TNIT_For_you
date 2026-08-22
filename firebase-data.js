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
  inMemoryPersistence,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  deleteUser,
  signOut,
  updatePassword
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  deleteField,
  where,
  writeBatch
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js';

import { ADMIN_EMAIL, FCM_VAPID_KEY, firebaseConfig, participantEmail, participantEmails } from './firebase-config.js?v=f6ec941';
import { getMessaging, getToken, deleteToken, isSupported, onMessage } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-messaging.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/** Secondary Auth app so admin can create / delete other accounts without swapping session. */
const secondaryApp = initializeApp(firebaseConfig, 'SecondaryAdmin');
const secondaryAuth = getAuth(secondaryApp);
setPersistence(secondaryAuth, inMemoryPersistence).catch(() => {});

export const GROUP_UNASSIGNED = 'GROUP_UNASSIGNED';
export const GROUP_STAFF = 'GROUP_STAFF';
export const SEAT_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

// Firestore caps a batch at 500 operations.
const BATCH_LIMIT = 450;

// ─── Authentication ─────────────────────────────────────────────────────────

export function isAdminId(participantId) {
  return String(participantId || '').trim().toUpperCase() === 'ADMIN';
}

function hideAuthCooldown(err) {
  const code = err && err.code;
  const msg = String((err && err.message) || '');
  if (
    code === 'auth/too-many-requests' ||
    /too[-_ ]many[-_ ]requests|TOO_MANY_ATTEMPTS|嘗試次數過多|稍等一陣/i.test(msg)
  ) {
    const wrapped = new Error('參加者編號或密碼不正確');
    wrapped.code = 'auth/invalid-credential';
    return wrapped;
  }
  return err;
}

function isRetryableAuthLookup(err) {
  const code = err && err.code;
  return code === 'auth/invalid-credential'
    || code === 'auth/invalid-login-credentials'
    || code === 'auth/wrong-password'
    || code === 'auth/user-not-found'
    || code === 'auth/too-many-requests';
}

function authPasswordsToTry(participantId, entered) {
  const passwords = [];
  const add = (value) => {
    const next = String(value || '');
    if (next && !passwords.includes(next)) passwords.push(next);
  };
  add(resolveAuthPassword(participantId, entered));
  const raw = String(entered || '').trim();
  if (raw.length >= 6) add(raw);
  return passwords;
}

async function signInWithResolvedPassword(authInstance, participantId, entered) {
  const passwords = authPasswordsToTry(participantId, entered);
  if (!passwords.length) {
    const err = new Error('請輸入密碼');
    err.code = 'auth/invalid-credential';
    throw err;
  }
  const emails = isAdminId(participantId) ? [ADMIN_EMAIL] : participantEmails(participantId);
  let lastErr = null;
  for (const password of passwords) {
    for (const email of emails) {
      try {
        return await signInWithEmailAndPassword(authInstance, email, password);
      } catch (err) {
        lastErr = err;
        if (!isRetryableAuthLookup(err)) throw hideAuthCooldown(err);
      }
    }
  }
  throw hideAuthCooldown(lastErr || new Error('參加者編號或密碼不正確'));
}

export async function signIn(participantId, phone) {
  // Keep the Firebase session in this browser tab only: reload stays signed
  // in, closing the tab (or signing out) clears it.
  await setPersistence(auth, browserSessionPersistence);
  const credential = await signInWithResolvedPassword(auth, participantId, phone);
  return credential.user;
}

/**
 * Firebase Auth requires passwords of at least 6 characters. Numbered seats
 * like "1A" are shorter, so we repeat the id until it meets the minimum.
 * The participant still types just their id; this expansion is internal.
 */
export function authPasswordForParticipantId(participantId, toUpper = true) {
  let id = String(participantId || '').trim();
  if (toUpper) id = id.toUpperCase();
  if (!id) return '';
  if (id.length >= 6) return id;
  let password = id;
  while (password.length < 6) password += id;
  return password;
}

/** Map what the user typed into the Auth password we actually stored. */
export function resolveAuthPassword(participantId, entered) {
  const raw = String(entered || '').trim();
  const id = String(participantId || '').trim();
  if (!raw) return '';
  const expandedId = authPasswordForParticipantId(id);
  if (id && (raw.toUpperCase() === id.toUpperCase() || raw.toUpperCase() === expandedId.toUpperCase())) {
    return expandedId;
  }
  if (raw.length < 6) {
    let expanded = raw.toUpperCase();
    while (expanded.length < 6) expanded += raw.toUpperCase();
    return expanded;
  }
  return raw;
}

/** If the password was the old seat id, move it with the person to the new id. */
function followSeatPassword(oldId, newId, stored) {
  const raw = String(stored || '').trim();
  const from = String(oldId || '').trim().toUpperCase();
  const to = String(newId || '').trim().toUpperCase();
  if (!to) return raw;
  if (!raw) return to;
  const expandedFrom = authPasswordForParticipantId(from);
  if (raw.toUpperCase() === from || raw.toUpperCase() === expandedFrom.toUpperCase()) {
    return to;
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
  const code = err && err.code;
  const msg = String((err && err.message) || '');
  if (
    code === 'auth/too-many-requests' ||
    /too[-_ ]many[-_ ]requests|TOO_MANY_ATTEMPTS|嘗試次數過多|稍等一陣/i.test(msg)
  ) {
    return '參加者編號或密碼不正確';
  }
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return '參加者編號或密碼不正確';
    case 'auth/invalid-email':
      return '參加者編號格式不正確';
    case 'auth/user-disabled':
      return '此帳戶已被停用，請聯絡工作人員';
    case 'auth/weak-password':
      return '密碼更新失敗，請再試一次';
    case 'auth/network-request-failed':
      return '網絡連線失敗，請檢查你的網絡';
    default:
      return msg || '登入失敗，請再試一次';
  }
}

/**
 * Map Firestore failures to short Chinese copy. Never surface the SDK’s raw
 * English "Missing or insufficient permissions." string in the UI.
 */
export function describeFirestoreError(err, fallback = '操作失敗，請再試一次') {
  const code = err && err.code;
  if (code === 'permission-denied') {
    return '目前無法完成此操作，請確認功能已開放或稍後再試';
  }
  if (code === 'unauthenticated') {
    return '登入已失效，請重新登入';
  }
  if (code === 'unavailable' || code === 'deadline-exceeded') {
    return '網絡不穩，請稍後再試';
  }
  if (code === 'not-found') {
    return '找不到相關資料';
  }
  if (code === 'auth-password-sync-failed') {
    return String((err && err.message) || '').trim() || fallback;
  }
  const msg = String((err && err.message) || '').trim();
  if (!msg) return fallback;
  if (/missing or insufficient permissions/i.test(msg)) {
    return '目前無法完成此操作，請確認功能已開放或稍後再試';
  }
  // Prefer the local fallback over Firebase’s English SDK phrasing.
  if (/^(FirebaseError|[A-Z][A-Z0-9_]+):/.test(msg) || /firestore/i.test(msg)) {
    return fallback;
  }
  return msg;
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

export const EMOJI_NOT_ALLOWED_MESSAGE = '內容不可包含 emoji，請刪除後才可提交';

export function containsEmoji(text) {
  try {
    return /\p{Extended_Pictographic}/u.test(String(text || ''));
  } catch (_) {
    return false;
  }
}

function assertNoEmoji(text, label = '內容') {
  if (containsEmoji(text)) {
    throw new Error(`${label}不可包含 emoji，請刪除後才可提交`);
  }
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
    deleted_at: toIso(data.deleted_at),
    sender_group_id: data.sender_group_id || '',
    thread_group_id: data.thread_group_id || ''
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

export function isSeatParticipantId(participantId) {
  return /^[0-9][A-H]$/i.test(String(participantId || '').trim());
}

export function isUnassignedGroup(groupId) {
  const g = String(groupId || '').trim();
  if (!g) return true;
  const compact = g.toUpperCase().replace(/[\s_-]+/g, '');
  return compact === 'GROUPUNASSIGNED'
    || compact === 'UNASSIGNED'
    || g === '未分組'
    || g === '未分配';
}

export function normalizeGroupId(groupId) {
  const g = String(groupId || '').trim();
  if (isUnassignedGroup(g)) return GROUP_UNASSIGNED;
  return g;
}

export function isNumberedGroupId(groupId) {
  return /^GROUP_[1-9]\d*$/i.test(String(groupId || '').trim());
}

export function groupNumberFromId(groupId) {
  const m = String(groupId || '').trim().match(/^GROUP_(\d+)$/i);
  return m ? Number(m[1]) : 0;
}

export function getTeammates(participantId, allParticipants) {
  const me = (allParticipants || []).find(p => p.participant_id === participantId);
  if (!me) return [];
  const group = String(me.group_id || '').trim();
  if (!group || isUnassignedGroup(group) || !isNumberedGroupId(group)) return [];
  return allParticipants.filter(
    p => p.participant_id !== participantId
      && String(p.group_id || '').trim() === group
      && isSeatParticipantId(p.participant_id)
  );
}

export function isStaffParticipantId(participantId) {
  const id = String(participantId || '').trim().toUpperCase();
  return !!id && !isSeatParticipantId(id) && id !== 'ADMIN';
}

/** Same-group recipients for seats; Staff may message anyone in a numbered group (全域). */
export function getMessageRecipients(participantId, allParticipants) {
  const me = (allParticipants || []).find(p => p.participant_id === participantId);
  if (!me) return [];
  const selfId = String(participantId || '').trim().toUpperCase();

  if (isStaffParticipantId(participantId)) {
    return (allParticipants || [])
      .filter(p => {
        const id = String(p.participant_id || '').trim().toUpperCase();
        if (!id || id === selfId || id === 'ADMIN') return false;
        return isNumberedGroupId(normalizeGroupId(p.group_id));
      })
      .sort((a, b) => {
        const ga = groupNumberFromId(a.group_id) - groupNumberFromId(b.group_id);
        if (ga !== 0) return ga;
        return String(a.participant_id || '').localeCompare(String(b.participant_id || ''), 'en');
      });
  }

  const group = normalizeGroupId(me.group_id);
  if (!group || isUnassignedGroup(group) || !isNumberedGroupId(group)) return [];
  return (allParticipants || []).filter(p => {
    const id = String(p.participant_id || '').trim().toUpperCase();
    if (!id || id === selfId) return false;
    if (id === 'ADMIN') return false;
    return normalizeGroupId(p.group_id) === group;
  });
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

export function sendMessage(senderId, receiverId, content, groupMeta = {}) {
  assertNoEmoji(content, '留言');
  const ref = doc(collection(db, 'messages'));
  const senderGroupId = String(groupMeta.senderGroupId || '').trim();
  const receiverGroupId = String(groupMeta.receiverGroupId || '').trim();
  const threadGroupId = senderGroupId && senderGroupId === receiverGroupId
    ? senderGroupId
    : '';
  return setDoc(ref, {
    sender_id: senderId,
    receiver_id: receiverId,
    content,
    status: 'active',
    created_at: serverTimestamp(),
    deleted_at: '',
    sender_group_id: senderGroupId,
    thread_group_id: threadGroupId
  });
}

/** Intra-group messages for a Staff facilitator monitoring one group. */
export function subscribeGroupThreadMessages(groupId, onData, onError) {
  const q = query(
    collection(db, 'messages'),
    where('thread_group_id', '==', groupId)
  );
  return onSnapshot(q, snapshot => {
    onData(snapshot.docs.map(messageFromDoc).sort(newestFirst));
  }, onError);
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

function votingConfigFromData(data) {
  return {
    voting_status: data.voting_status || 'DRAFT',
    allow_resubmit: !!data.allow_resubmit,
    calculated_at: toIso(data.calculated_at),
    published_at: toIso(data.published_at)
  };
}

export function subscribeVotingConfig(onData, onError) {
  return onSnapshot(doc(db, 'config', 'voting'), snapshot => {
    onData(votingConfigFromData(snapshot.data() || {}));
  }, onError);
}

export async function setVotingStatus(votingStatus, allowResubmit) {
  // Clear group overrides first so nobody stays stuck on a stale staff override
  // while the new global status is already live.
  await clearAllGroupVotingOverrides();
  const patch = { voting_status: votingStatus };
  if (allowResubmit !== undefined) patch.allow_resubmit = !!allowResubmit;
  if (votingStatus === 'PUBLISHED') patch.published_at = serverTimestamp();
  // Reopening voting has to clear the published flag, otherwise participants
  // would keep seeing last round's results while voting again.
  if (votingStatus === 'VOTING_OPEN') {
    patch.published_at = '';
    // Default: one ballot per person. Admin may still pass allowResubmit=true.
    if (allowResubmit === undefined) patch.allow_resubmit = false;
  }
  if (votingStatus === 'CALCULATED') {
    patch.calculated_at = serverTimestamp();
    patch.fallback_activated = false;
  }
  await setDoc(doc(db, 'config', 'voting'), patch, { merge: true });
}

/** Remove every group's voting override so all groups follow the global config. */
export async function clearAllGroupVotingOverrides() {
  const snapshot = await getDocs(collection(db, 'groups'));
  const operations = [];
  snapshot.docs.forEach(d => {
    const raw = d.data() || {};
    if (
      !('voting_status' in raw)
      && !('allow_resubmit' in raw)
      && !('calculated_at' in raw)
      && !('published_at' in raw)
    ) {
      return;
    }
    operations.push(batch => batch.set(d.ref, {
      voting_status: deleteField(),
      allow_resubmit: deleteField(),
      calculated_at: deleteField(),
      published_at: deleteField()
    }, { merge: true }));
  });
  if (operations.length) await commitAll(operations);
}

/** Per-group display names and messaging / voting overrides. */
export function subscribeGroups(onData, onError) {
  return onSnapshot(collection(db, 'groups'), snapshot => {
    const map = {};
    snapshot.docs.forEach(d => {
      const raw = d.data() || {};
      map[d.id] = {
        group_id: raw.group_id || d.id,
        display_name: String(raw.display_name || '').trim(),
        messaging_status: raw.messaging_status === 'CLOSE' ? 'CLOSE' : 'OPEN',
        voting_status: raw.voting_status || '',
        allow_resubmit: !!raw.allow_resubmit,
        calculated_at: toIso(raw.calculated_at),
        published_at: toIso(raw.published_at)
      };
    });
    onData(map);
  }, onError);
}

export function setGroupDisplayName(groupId, displayName) {
  const name = String(displayName || '').trim();
  assertNoEmoji(name, '組名');
  return setDoc(doc(db, 'groups', groupId), {
    group_id: groupId,
    display_name: name
  }, { merge: true });
}

export function setGroupMessagingStatus(groupId, status) {
  return setDoc(doc(db, 'groups', groupId), {
    group_id: groupId,
    messaging_status: status === 'CLOSE' ? 'CLOSE' : 'OPEN'
  }, { merge: true });
}

export async function setGroupVotingStatus(groupId, votingStatus, allowResubmit) {
  const patch = {
    group_id: groupId,
    voting_status: votingStatus
  };
  if (allowResubmit !== undefined) patch.allow_resubmit = !!allowResubmit;
  if (votingStatus === 'PUBLISHED') patch.published_at = serverTimestamp();
  if (votingStatus === 'VOTING_OPEN') {
    patch.published_at = '';
    if (allowResubmit === undefined) patch.allow_resubmit = false;
  }
  if (votingStatus === 'CALCULATED') patch.calculated_at = serverTimestamp();
  await setDoc(doc(db, 'groups', groupId), patch, { merge: true });
}

/** Remove the group voting override so the group follows the global config again. */
export async function clearGroupVotingStatus(groupId) {
  await setDoc(doc(db, 'groups', groupId), {
    group_id: groupId,
    voting_status: deleteField(),
    allow_resubmit: deleteField(),
    calculated_at: deleteField(),
    published_at: deleteField()
  }, { merge: true });
}

/** Clear both voting and messaging overrides for a group. */
export async function clearGroupAllOverrides(groupId) {
  await setDoc(doc(db, 'groups', groupId), {
    group_id: groupId,
    voting_status: deleteField(),
    messaging_status: deleteField(),
    allow_resubmit: deleteField(),
    calculated_at: deleteField(),
    published_at: deleteField()
  }, { merge: true });
}

// ─── Trophies ───────────────────────────────────────────────────────────────

export async function fetchTrophies() {
  const snapshot = await getDocs(collection(db, 'trophies'));
  return snapshot.docs
    .map(d => {
      const raw = d.data() || {};
      return {
        trophy_id: raw.trophy_id || d.id,
        trophy_name: raw.trophy_name || d.id,
        description: typeof raw.description === 'string' ? raw.description : ''
      };
    })
    .sort((a, b) => a.trophy_id.localeCompare(b.trophy_id));
}

/** Update trophy name/description and rewrite result snapshots that still show the old label. */
export async function updateTrophyMeta(trophyId, { trophyName, description } = {}) {
  const id = String(trophyId || '').trim();
  const name = String(trophyName || '').trim();
  const hasDescription = description !== undefined;
  const desc = hasDescription ? String(description ?? '').trim() : null;
  if (!id) throw new Error('缺少獎項編號');
  if (!name) throw new Error('獎項名稱不可空白');
  if (name.length > 40) throw new Error('獎項名稱最多 40 字');
  if (hasDescription && desc.length > 160) throw new Error('獎項描述最多 160 字');
  assertNoEmoji(name, '獎項名稱');
  if (hasDescription) assertNoEmoji(desc, '獎項描述');

  const payload = {
    trophy_id: id,
    trophy_name: name
  };
  if (hasDescription) payload.description = desc;

  await updateDoc(doc(db, 'trophies', id), payload);

  const snapshot = await getDocs(collection(db, 'results'));
  const operations = [];
  snapshot.docs.forEach(d => {
    const raw = d.data() || {};
    const awards = Array.isArray(raw.awards) ? raw.awards : [];
    let changed = false;
    const next = awards.map(award => {
      if (!award || award.trophy_id !== id || award.trophy_name === name) return award;
      changed = true;
      return { ...award, trophy_name: name };
    });
    if (!changed) return;
    operations.push(batch => batch.update(doc(db, 'results', d.id), { awards: next }));
  });
  if (operations.length) await commitAll(operations);
  return {
    trophy_id: id,
    trophy_name: name,
    ...(hasDescription ? { description: desc } : {})
  };
}

/** @deprecated Prefer updateTrophyMeta */
export async function updateTrophyName(trophyId, trophyName) {
  const saved = await updateTrophyMeta(trophyId, { trophyName });
  return saved.trophy_name;
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

export async function saveSubmission(participantId, pairings, submitted = true, { allowResubmit = false } = {}) {
  // Local picks stay in the browser until submit; we no longer persist drafts.
  if (!submitted) {
    return Promise.reject(new Error('草稿功能已移除，請直接提交投票'));
  }
  const ref = doc(db, 'submissions', participantId);
  if (!allowResubmit) {
    const existing = await getDoc(ref);
    if (existing.exists() && (existing.data() || {}).status === 'submitted') {
      const err = new Error('你已經投過票，不能重複提交');
      err.code = 'already-submitted';
      throw err;
    }
  }
  const payload = {
    participant_id: participantId,
    pairings: pairings || [],
    status: 'submitted',
    updated_at: serverTimestamp(),
    submitted_at: serverTimestamp()
  };
  // The whole ballot is one document, so two people voting at the same moment
  // can never overwrite each other the way appending rows to a sheet could.
  return setDoc(ref, payload, { merge: true });
}

export function clearMySubmission(participantId) {
  return deleteDoc(doc(db, 'submissions', participantId));
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
  const roster = (participants || []).filter(p =>
    isSeatParticipantId(p.participant_id) && isNumberedGroupId(p.group_id)
  );
  const seatIds = new Set(roster.map(p => p.participant_id));
  const voteCounts = new Map();
  const key = (receiver, trophy) => receiver + '|' + trophy;

  submissions.forEach(submission => {
    if (!seatIds.has(submission.participant_id)) return;
    (submission.pairings || []).forEach(pair => {
      if (!pair || !pair.receiver_id || !pair.trophy_id) return;
      if (!seatIds.has(pair.receiver_id)) return;
      const k = key(pair.receiver_id, pair.trophy_id);
      voteCounts.set(k, (voteCounts.get(k) || 0) + 1);
    });
  });

  const countFor = (participantId, trophyId) => voteCounts.get(key(participantId, trophyId)) || 0;
  const awarded = new Map(roster.map(p => [p.participant_id, []]));

  const byGroup = new Map();
  roster.forEach(p => {
    const group = isUnassignedGroup(p.group_id) ? GROUP_UNASSIGNED : (p.group_id || GROUP_UNASSIGNED);
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
    const ranking = roster
      .map(p => ({ participant_id: p.participant_id, vote_count: countFor(p.participant_id, trophy.trophy_id) }))
      .filter(entry => entry.vote_count > 0)
      .sort((a, b) => b.vote_count - a.vote_count);
    const winners = roster
      .filter(p => awarded.get(p.participant_id).some(a => a.trophy_id === trophy.trophy_id))
      .map(p => ({ participant_id: p.participant_id, vote_count: countFor(p.participant_id, trophy.trophy_id) }));
    return {
      trophy_id: trophy.trophy_id,
      trophy_name: trophy.trophy_name,
      description: typeof trophy.description === 'string' ? trophy.description : '',
      winners,
      is_tie: winners.length > 1,
      top_ranking: ranking
    };
  });

  const profiles = roster.map(p => ({
    participant_id: p.participant_id,
    trophies: awarded.get(p.participant_id),
    vote_count: awarded.get(p.participant_id).reduce((sum, a) => sum + (a.vote_count || 0), 0)
  }));

  return { awarded, profiles, trophySummary };
}

export async function writeResults(awarded, options = {}) {
  const operations = [];
  awarded.forEach((awards, participantId) => {
    operations.push(batch => batch.set(doc(db, 'results', participantId), {
      participant_id: participantId,
      awards,
      calculated_at: serverTimestamp()
    }));
  });
  await commitAll(operations);
  if (options.groupId) {
    await setGroupVotingStatus(options.groupId, 'CALCULATED');
    return;
  }
  await setVotingStatus('CALCULATED');
}

/** Listen to a small set of documents by id (Staff cannot query whole collections). */
function subscribeDocsByIds(collectionName, ids, fromDoc, onData, onError) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (!unique.length) {
    onData([]);
    return () => {};
  }
  const cache = new Map();
  const unsubs = unique.map(id => onSnapshot(doc(db, collectionName, id), snapshot => {
    if (snapshot.exists()) cache.set(id, fromDoc(snapshot));
    else cache.delete(id);
    onData(unique.map(pid => cache.get(pid)).filter(Boolean));
  }, onError));
  return () => unsubs.forEach(stop => {
    try { stop(); } catch (_) { /* already closed */ }
  });
}

/** One-shot reads for Staff facilitators (collection listens are admin-only). */
export async function fetchSubmissionsForParticipants(participantIds) {
  const ids = [...new Set((participantIds || []).filter(Boolean))];
  const rows = await Promise.all(ids.map(async id => {
    const snapshot = await getDoc(doc(db, 'submissions', id));
    return snapshot.exists() ? submissionFromDoc(snapshot) : {
      participant_id: id,
      status: '',
      pairings: [],
      updated_at: '',
      submitted_at: ''
    };
  }));
  return rows;
}

export function subscribeSubmissionsForParticipants(participantIds, onData, onError) {
  return subscribeDocsByIds('submissions', participantIds, submissionFromDoc, onData, onError);
}

export async function fetchResultsForParticipants(participantIds) {
  const ids = [...new Set((participantIds || []).filter(Boolean))];
  const rows = await Promise.all(ids.map(async id => {
    const snapshot = await getDoc(doc(db, 'results', id));
    return snapshot.exists() ? resultFromDoc(snapshot) : null;
  }));
  return rows.filter(Boolean);
}

export function subscribeResultsForParticipants(participantIds, onData, onError) {
  return subscribeDocsByIds('results', participantIds, resultFromDoc, onData, onError);
}

function presenceFromDoc(snapshot) {
  const data = snapshot.data() || {};
  return {
    participant_id: data.participant_id || snapshot.id,
    online: data.online !== false,
    first_seen: toIso(data.first_seen),
    last_seen: toIso(data.last_seen)
  };
}

export function subscribePresenceForParticipants(participantIds, onData, onError) {
  return subscribeDocsByIds('presence', participantIds, presenceFromDoc, onData, onError);
}

export async function fetchPresenceForParticipants(participantIds) {
  const ids = [...new Set((participantIds || []).filter(Boolean))];
  const rows = await Promise.all(ids.map(async id => {
    const snapshot = await getDoc(doc(db, 'presence', id));
    return snapshot.exists() ? presenceFromDoc(snapshot) : null;
  }));
  return rows.filter(Boolean);
}

// ─── Admin: participants and contacts ───────────────────────────────────────

export function subscribeParticipants(onData, onError) {
  return onSnapshot(collection(db, 'participants'), snapshot => {
    onData(snapshot.docs.map(d => {
      const raw = d.data() || {};
      return {
        participant_id: raw.participant_id || d.id,
        group_id: raw.group_id || '',
        display_name: String(raw.display_name || '').trim(),
        force_logout_rev: Number(raw.force_logout_rev || 0) || 0
      };
    }).sort((a, b) => a.participant_id.localeCompare(b.participant_id)));
  }, onError);
}

export function updateParticipantDisplayName(participantId, displayName) {
  const name = String(displayName || '').trim();
  assertNoEmoji(name, '顯示名稱');
  // Only touch display_name so security rules can require hasOnly(['display_name']).
  return updateDoc(doc(db, 'participants', participantId), {
    display_name: name
  });
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

export async function updateMyPassword(newPassword) {
  if (!auth.currentUser) throw new Error('未登入');
  const clean = String(newPassword || '').trim();
  if (!clean) throw new Error('請輸入密碼');
  const identity = identityFromUser(auth.currentUser);
  const pid = identity ? identity.participantId : '';
  const authPwd = resolveAuthPassword(pid, clean);
  await updatePassword(auth.currentUser, authPwd);
  if (pid) {
    await setDoc(doc(db, 'contacts', pid), {
      participant_id: pid,
      phone_number: clean
    }, { merge: true });
  }
}

export function updateParticipantGroup(participantId, groupId) {
  return setDoc(doc(db, 'participants', participantId), {
    participant_id: participantId,
    group_id: groupId
  }, { merge: true });
}

async function withSecondaryAuth(fn) {
  try {
    return await fn(secondaryAuth);
  } finally {
    try {
      if (secondaryAuth.currentUser) await signOut(secondaryAuth);
    } catch (_) { /* ignore */ }
  }
}

async function signInSecondaryOnce(participantId, hint) {
  return signInWithResolvedPassword(secondaryAuth, participantId, hint);
}

function passwordHintsForSync(participantId, oldPassword) {
  const pid = String(participantId || '').trim().toUpperCase();
  const hints = [];
  const add = (value) => {
    const raw = String(value || '').trim();
    if (raw && !hints.includes(raw)) hints.push(raw);
  };
  add(oldPassword);
  add(pid);
  add(authPasswordForParticipantId(pid));
  return hints;
}

async function trySecondaryUpdatePassword(participantId, hints, nextPwd) {
  const tried = new Set();
  for (const hint of hints) {
    for (const pwd of authPasswordsToTry(participantId, hint)) {
      if (tried.has(pwd)) continue;
      tried.add(pwd);
      try {
        const cred = await signInWithResolvedPassword(secondaryAuth, participantId, pwd);
        if (cred?.user) {
          await updatePassword(cred.user, nextPwd);
          return true;
        }
      } catch (err) {
        if (!isRetryableAuthLookup(err)) throw hideAuthCooldown(err);
      }
    }
  }
  return false;
}

async function syncAuthPassword(participantId, newPassword, oldPassword) {
  const pid = String(participantId || '').trim().toUpperCase();
  const nextPwd = resolveAuthPassword(pid, newPassword);
  if (!nextPwd) throw new Error('請輸入密碼');

  await withSecondaryAuth(async () => {
    const hints = passwordHintsForSync(pid, oldPassword);

    if (await trySecondaryUpdatePassword(pid, hints, nextPwd)) return;

    for (const email of participantEmails(pid)) {
      try {
        await createUserWithEmailAndPassword(secondaryAuth, email, nextPwd);
        return;
      } catch (createErr) {
        if (createErr?.code !== 'auth/email-already-in-use') throw createErr;
      }
    }

    if (await trySecondaryUpdatePassword(pid, hints, nextPwd)) return;

    const fail = new Error(
      '登入密碼未能同步到 Firebase Auth，對方仍會用舊密碼登入。'
      + '請先用舊密碼確認對方可登入，或執行 set_participant_phone.py 修正。'
    );
    fail.code = 'auth-password-sync-failed';
    throw fail;
  });
}

async function ensureAuthAccount(participantId, password) {
  await syncAuthPassword(participantId, password, password);
}

async function deleteAuthAccount(participantId, passwordHint) {
  await withSecondaryAuth(async () => {
    try {
      await signInSecondaryOnce(participantId, passwordHint);
    } catch (_) {
      return;
    }
    if (secondaryAuth.currentUser) await deleteUser(secondaryAuth.currentUser);
  });
}

/** Next free seat id for a numbered group (e.g. GROUP_1 → 1A…1H). */
export function nextSeatIdForGroup(groupId, participants) {
  const n = groupNumberFromId(groupId);
  if (!n) return '';
  const taken = new Set(
    (participants || [])
      .map(p => String(p.participant_id || '').toUpperCase())
      .filter(id => id.startsWith(String(n)) && isSeatParticipantId(id))
  );
  for (const letter of SEAT_LETTERS) {
    const id = `${n}${letter}`;
    if (!taken.has(id)) return id;
  }
  return '';
}

/** Any globally unused seat id (used when creating unassigned people). */
export function nextGlobalSeatId(participants) {
  const taken = new Set(
    (participants || []).map(p => String(p.participant_id || '').toUpperCase())
  );
  for (let n = 1; n <= 9; n++) {
    for (const letter of SEAT_LETTERS) {
      const id = `${n}${letter}`;
      if (!taken.has(id)) return id;
    }
  }
  return '';
}

/**
 * Rewrite every document that references oldId as a participant id.
 * Must run while both old and new participant docs can exist.
 */
async function rewriteParticipantIdReferences(oldId, newId, newGroupId) {
  const operations = [];

  const messages = await getDocs(collection(db, 'messages'));
  messages.docs.forEach(d => {
    const raw = d.data() || {};
    const patch = {};
    if (raw.sender_id === oldId) {
      patch.sender_id = newId;
      if (newGroupId) patch.sender_group_id = newGroupId;
    }
    if (raw.receiver_id === oldId) patch.receiver_id = newId;
    if (Object.keys(patch).length) {
      if (patch.sender_id || patch.receiver_id) {
        const senderG = patch.sender_group_id || raw.sender_group_id || '';
        const thread = raw.thread_group_id || '';
        if (thread && senderG && thread === (raw.sender_group_id || '')) {
          patch.thread_group_id = senderG;
        }
      }
      operations.push(batch => batch.update(d.ref, patch));
    }
  });

  const submissions = await getDocs(collection(db, 'submissions'));
  submissions.docs.forEach(d => {
    const raw = d.data() || {};
    let changed = false;
    const pairings = (raw.pairings || []).map(pair => {
      if (!pair || pair.receiver_id !== oldId) return pair;
      changed = true;
      return { ...pair, receiver_id: newId };
    });
    if (d.id === oldId) {
      // Copied separately; skip in-place rewrite of the old doc itself.
      return;
    }
    if (changed) {
      operations.push(batch => batch.update(d.ref, { pairings }));
    }
  });

  if (operations.length) await commitAll(operations);
}

/**
 * Move a seat id to a new seat id, copying Auth + Firestore and rewriting refs.
 * Returns the new id.
 */
export async function renameParticipantId(oldId, newId, { groupId, displayName, password } = {}) {
  const from = String(oldId || '').trim().toUpperCase();
  const to = String(newId || '').trim().toUpperCase();
  if (!from || !to) throw new Error('編號不能為空');
  if (from === to) {
    if (groupId) await updateParticipantGroup(from, groupId);
    return from;
  }
  if (!isSeatParticipantId(to)) throw new Error('新編號格式不正確（例如 1A）');

  const existing = await getDoc(doc(db, 'participants', to));
  if (existing.exists()) throw new Error(`編號 ${to} 已被使用`);

  const fromSnap = await getDoc(doc(db, 'participants', from));
  if (!fromSnap.exists()) throw new Error(`搵唔到 ${from}`);
  const fromData = fromSnap.data() || {};
  const targetGroup = groupId || fromData.group_id || GROUP_UNASSIGNED;
  const name = displayName != null ? String(displayName).trim() : String(fromData.display_name || '').trim();

  const contactSnap = await getDoc(doc(db, 'contacts', from));
  const oldPhone = contactSnap.exists() ? String((contactSnap.data() || {}).phone_number || '') : '';
  const explicitPassword = password != null ? String(password).trim() : '';
  const phone = explicitPassword || followSeatPassword(from, to, oldPhone);
  if (!phone) throw new Error('請先設定密碼再改編號');

  await ensureAuthAccount(to, phone);

  await setDoc(doc(db, 'participants', to), {
    participant_id: to,
    group_id: targetGroup,
    display_name: name,
    force_logout_rev: Date.now()
  });
  await setDoc(doc(db, 'contacts', to), {
    participant_id: to,
    phone_number: phone
  }, { merge: true });

  const subSnap = await getDoc(doc(db, 'submissions', from));
  if (subSnap.exists()) {
    const raw = subSnap.data() || {};
    await setDoc(doc(db, 'submissions', to), {
      ...raw,
      participant_id: to,
      pairings: (raw.pairings || []).map(pair => (
        pair && pair.receiver_id === from ? { ...pair, receiver_id: to } : pair
      ))
    });
  }

  const resultSnap = await getDoc(doc(db, 'results', from));
  if (resultSnap.exists()) {
    const raw = resultSnap.data() || {};
    await setDoc(doc(db, 'results', to), { ...raw, participant_id: to });
  }

  await rewriteParticipantIdReferences(from, to, targetGroup);

  await Promise.all([
    deleteDoc(doc(db, 'participants', from)),
    deleteDoc(doc(db, 'contacts', from)).catch(() => {}),
    deleteDoc(doc(db, 'submissions', from)).catch(() => {}),
    deleteDoc(doc(db, 'results', from)).catch(() => {}),
    deleteDoc(doc(db, 'presence', from)).catch(() => {})
  ]);

  try {
    await deleteAuthAccount(from, oldPhone || phone);
  } catch (_) { /* orphan Auth account is acceptable; login id is gone from roster */ }

  return to;
}

/** Compact seat letters inside a numbered group to consecutive A,B,C… */
export async function compactGroupSeats(groupId, participants) {
  if (!isNumberedGroupId(groupId)) return [];
  const n = groupNumberFromId(groupId);
  const members = (participants || [])
    .filter(p => String(p.group_id || '').trim() === groupId && isSeatParticipantId(p.participant_id))
    .sort((a, b) => a.participant_id.localeCompare(b.participant_id));

  const plan = members.map((p, i) => ({
    from: String(p.participant_id).toUpperCase(),
    to: `${n}${SEAT_LETTERS[i]}`
  })).filter(row => row.from !== row.to);

  if (!plan.length) return [];

  // Two-phase rename via temporary free seats to avoid collisions.
  const taken = new Set(
    (participants || []).map(p => String(p.participant_id || '').toUpperCase())
  );
  const temps = [];
  const pickTemp = () => {
    for (let n = 9; n >= 0; n--) {
      for (const letter of SEAT_LETTERS) {
        const id = `${n}${letter}`;
        if (!taken.has(id) && !temps.some(t => t.temp === id)) return id;
      }
    }
    return '';
  };
  for (let i = 0; i < plan.length; i++) {
    const temp = pickTemp();
    if (!temp) throw new Error('暫時無法重排座位，請稍後再試');
    temps.push({ ...plan[i], temp });
  }

  let roster = participants.slice();
  for (const row of temps) {
    await renameParticipantId(row.from, row.temp, { groupId });
    roster = roster.map(p => (
      p.participant_id === row.from
        ? { ...p, participant_id: row.temp, group_id: groupId }
        : p
    ));
  }
  const renamed = [];
  for (const row of temps) {
    await renameParticipantId(row.temp, row.to, { groupId });
    renamed.push({ from: row.from, to: row.to });
    roster = roster.map(p => (
      p.participant_id === row.temp
        ? { ...p, participant_id: row.to, group_id: groupId }
        : p
    ));
  }
  return renamed;
}

/**
 * Assign a person to a group. Seat members in numbered groups get auto-renumbered
 * (e.g. 3E → Group 1 becomes next free 1x). Source numbered groups are compacted.
 */
export async function assignParticipantToGroup(participantId, targetGroupId, participants) {
  const pid = String(participantId || '').trim().toUpperCase();
  const target = String(targetGroupId || '').trim() || GROUP_UNASSIGNED;
  const roster = participants || [];
  const person = roster.find(p => String(p.participant_id).toUpperCase() === pid);
  if (!person) throw new Error('搵唔到呢位參加者');

  const sourceGroup = String(person.group_id || '').trim();
  const isSeat = isSeatParticipantId(pid);

  // Staff (named ids) only move group membership; login id stays stable.
  if (!isSeat) {
    await updateParticipantGroup(pid, target);
    return { participantId: pid, renamed: false };
  }

  let finalId = pid;
  if (isNumberedGroupId(target)) {
    const desiredPrefix = String(groupNumberFromId(target));
    const alreadyCorrect = pid.startsWith(desiredPrefix) && sourceGroup === target;
    if (!alreadyCorrect) {
      const nextId = nextSeatIdForGroup(target, roster.filter(p => String(p.participant_id).toUpperCase() !== pid));
      if (!nextId) throw new Error(`${target} 座位已滿（最多 ${SEAT_LETTERS.length} 人）`);
      if (nextId !== pid) {
        finalId = await renameParticipantId(pid, nextId, { groupId: target });
      } else {
        await updateParticipantGroup(pid, target);
      }
    } else {
      await updateParticipantGroup(pid, target);
    }
  } else {
    await updateParticipantGroup(pid, target);
  }

  let compactRemaps = [];
  if (isNumberedGroupId(sourceGroup) && sourceGroup !== target) {
    const afterMove = roster.map(p => {
      if (String(p.participant_id).toUpperCase() === pid) {
        return { ...p, participant_id: finalId, group_id: target };
      }
      return p;
    });
    compactRemaps = await compactGroupSeats(sourceGroup, afterMove);
  }

  return { participantId: finalId, renamed: finalId !== pid, compactRemaps };
}

/**
 * Apply a batch of draft group placements (pid → target group).
 * Tracks seat renames from each move so later pending keys stay resolvable.
 */
export async function applyRosterGroupDraft(desiredById, participants) {
  let roster = (participants || []).map(p => ({ ...p }));
  const idChain = new Map();
  const resolve = (id) => {
    let cur = String(id || '').trim().toUpperCase();
    while (idChain.has(cur)) cur = idChain.get(cur);
    return cur;
  };
  const noteRename = (from, to) => {
    const a = String(from || '').trim().toUpperCase();
    const b = String(to || '').trim().toUpperCase();
    if (a && b && a !== b) idChain.set(a, b);
  };

  const entries = Object.entries(desiredById || {})
    .map(([pid, groupId]) => [String(pid).trim().toUpperCase(), normalizeGroupId(groupId)])
    .filter(([pid]) => pid)
    .sort((a, b) => a[0].localeCompare(b[0]));

  const results = [];
  for (const [origId, target] of entries) {
    const pid = resolve(origId);
    const person = roster.find(p => String(p.participant_id).toUpperCase() === pid);
    if (!person) continue;
    if (normalizeGroupId(person.group_id) === target) continue;

    const result = await assignParticipantToGroup(pid, target, roster);
    noteRename(pid, result.participantId);
    for (const row of result.compactRemaps || []) noteRename(row.from, row.to);

    roster = roster.map(p => {
      const id = String(p.participant_id).toUpperCase();
      if (id === pid) {
        return { ...p, participant_id: result.participantId, group_id: target };
      }
      for (const row of result.compactRemaps || []) {
        if (id === String(row.from).toUpperCase()) {
          return { ...p, participant_id: row.to };
        }
      }
      return p;
    });
    results.push({ from: origId, to: result.participantId, groupId: target, renamed: result.renamed });
  }
  return { results, participants: roster };
}

export async function createParticipant({ participantId, groupId, password, displayName }) {
  const pid = String(participantId || '').trim().toUpperCase();
  const group = String(groupId || '').trim() || GROUP_UNASSIGNED;
  const phone = String(password || '').trim();
  if (!pid) throw new Error('請輸入參加者編號');
  if (!phone) throw new Error('請輸入密碼');
  assertNoEmoji(String(displayName || '').trim(), '顯示名稱');

  const existing = await getDoc(doc(db, 'participants', pid));
  if (existing.exists()) throw new Error(`編號 ${pid} 已存在`);

  await ensureAuthAccount(pid, phone);
  await setDoc(doc(db, 'participants', pid), {
    participant_id: pid,
    group_id: group,
    display_name: String(displayName || '').trim(),
    force_logout_rev: 0
  });
  await setDoc(doc(db, 'contacts', pid), {
    participant_id: pid,
    phone_number: phone
  }, { merge: true });
  return pid;
}

export async function deleteParticipantCompletely(participantId, participants) {
  const pid = String(participantId || '').trim().toUpperCase();
  if (!pid) return;
  const person = (participants || []).find(p => String(p.participant_id).toUpperCase() === pid);
  const groupId = person ? person.group_id : '';
  const contactSnap = await getDoc(doc(db, 'contacts', pid));
  const phone = contactSnap.exists() ? String((contactSnap.data() || {}).phone_number || '') : '';

  await clearParticipantRecords(pid, {
    deleteMessages: true,
    deleteTrophy: true,
    deleteResults: true
  });

  // Also delete messages where they are the receiver.
  const messages = await getDocs(collection(db, 'messages'));
  const ops = [];
  messages.docs.forEach(d => {
    const raw = d.data() || {};
    if (raw.receiver_id === pid || raw.sender_id === pid) {
      ops.push(batch => batch.delete(d.ref));
    }
  });
  if (ops.length) await commitAll(ops);

  await Promise.all([
    deleteDoc(doc(db, 'participants', pid)),
    deleteDoc(doc(db, 'contacts', pid)).catch(() => {}),
    deleteDoc(doc(db, 'presence', pid)).catch(() => {})
  ]);

  try {
    await deleteAuthAccount(pid, phone || pid);
  } catch (_) { /* ignore */ }

  if (isNumberedGroupId(groupId)) {
    const remaining = (participants || []).filter(p => String(p.participant_id).toUpperCase() !== pid);
    await compactGroupSeats(groupId, remaining);
  }
}

export async function updateParticipantContact(participantId, newPassword) {
  const pid = String(participantId || '').trim().toUpperCase();
  if (!pid) return;
  const clean = String(newPassword || '').trim();
  if (!clean) return;

  const contactSnap = await getDoc(doc(db, 'contacts', pid));
  const oldPhone = contactSnap.exists() ? String((contactSnap.data() || {}).phone_number || '') : '';

  const identity = identityFromUser(auth.currentUser);
  if (identity && identity.participantId === pid) {
    await updatePassword(auth.currentUser, resolveAuthPassword(pid, clean));
    await setDoc(doc(db, 'contacts', pid), {
      participant_id: pid,
      phone_number: clean
    }, { merge: true });
    return;
  }

  await syncAuthPassword(pid, clean, oldPhone || pid);
  await setDoc(doc(db, 'contacts', pid), {
    participant_id: pid,
    phone_number: clean
  }, { merge: true });
}

export function forceLogoutParticipant(participantId) {
  const rev = Date.now();
  return Promise.all([
    setDoc(doc(db, 'participants', participantId), {
      participant_id: participantId,
      force_logout_rev: rev
    }, { merge: true }),
    deleteDoc(doc(db, 'presence', participantId)).catch(() => {})
  ]);
}

export async function forceLogoutParticipants(participantIds) {
  const ids = [...new Set((participantIds || []).filter(Boolean))];
  if (!ids.length) return 0;
  const rev = Date.now();
  const operations = ids.map(id => batch => batch.set(doc(db, 'participants', id), {
    participant_id: id,
    force_logout_rev: rev
  }, { merge: true }));
  await commitAll(operations);
  await Promise.all(ids.map(id => deleteDoc(doc(db, 'presence', id)).catch(() => {})));
  return ids.length;
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
  await clearAllGroupVotingOverrides();
  return operations.length;
}

/**
 * Clears every ballot and computed award, but leaves messages alone.
 * If the lifecycle had already moved past voting, step it back to
 * VOTING_CLOSED so admins can reopen or recalculate from a clean slate.
 */
export async function resetAllVotes() {
  const operations = [];
  for (const name of ['submissions', 'results']) {
    const snapshot = await getDocs(collection(db, name));
    snapshot.docs.forEach(d => operations.push(batch => batch.delete(d.ref)));
  }
  await commitAll(operations);

  const votingRef = doc(db, 'config', 'voting');
  const snap = await getDoc(votingRef);
  const status = ((snap.exists() && snap.data()) || {}).voting_status || 'DRAFT';
  const patch = {
    calculated_at: '',
    published_at: '',
    fallback_activated: false
  };
  if (status === 'CALCULATED' || status === 'PUBLISHED') {
    patch.voting_status = 'VOTING_CLOSED';
  }
  await setDoc(votingRef, patch, { merge: true });
  await clearAllGroupVotingOverrides();
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
  await setDoc(doc(db, 'presence', participantId), {
    participant_id: participantId,
    online: true,
    last_seen: serverTimestamp()
  }, { merge: true });
}

export function markPresenceOffline(participantId) {
  // Remove the presence doc so admin login status flips to「未登入」immediately.
  return deleteDoc(doc(db, 'presence', participantId)).catch(() =>
    setDoc(doc(db, 'presence', participantId), {
      participant_id: participantId,
      online: false,
      last_seen: serverTimestamp()
    }, { merge: true })
  );
}

export function subscribePresence(onData, onError) {
  return onSnapshot(collection(db, 'presence'), snapshot => {
    onData(snapshot.docs.map(presenceFromDoc));
  }, onError);
}

export async function fetchPresence() {
  const snapshot = await getDocs(collection(db, 'presence'));
  return snapshot.docs.map(presenceFromDoc);
}

// ─── Web Push (FCM) ─────────────────────────────────────────────────────────

const PUSH_TOKEN_LIMIT = 8;
let messagingInstance = null;
let messagingInitPromise = null;

export async function fetchPushVapidKey() {
  try {
    const snap = await getDoc(doc(db, 'config', 'push'));
    const fromDoc = String((snap.data() || {}).vapidKey || '').trim();
    if (fromDoc) return fromDoc;
  } catch (_) { /* permission or offline */ }
  return String(FCM_VAPID_KEY || '').trim();
}

export async function setPushVapidKey(vapidKey) {
  const key = String(vapidKey || '').trim();
  if (!key) throw new Error('VAPID 金鑰不可空白');
  await setDoc(doc(db, 'config', 'push'), {
    vapidKey: key,
    updated_at: serverTimestamp()
  }, { merge: true });
  return key;
}

async function getMessagingSafe() {
  if (messagingInstance) return messagingInstance;
  if (messagingInitPromise) return messagingInitPromise;
  messagingInitPromise = (async () => {
    if (typeof window === 'undefined') return null;
    if (!(await isSupported())) return null;
    messagingInstance = getMessaging(app);
    return messagingInstance;
  })();
  return messagingInitPromise;
}

export function isNotificationApiSupported() {
  return typeof window !== 'undefined' && typeof Notification !== 'undefined';
}

/** FCM token registration (needs VAPID). Spark/free local alerts do not require this. */
export async function isPushSupported() {
  try {
    if (!isNotificationApiSupported() || !('serviceWorker' in navigator)) return false;
    return await isSupported();
  } catch (_) {
    return false;
  }
}

export function getNotificationPermission() {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

export async function savePushToken(participantId, token) {
  const id = String(participantId || '').trim().toUpperCase();
  const nextToken = String(token || '').trim();
  if (!id || !nextToken) return;
  const ref = doc(db, 'push_tokens', id);
  const snap = await getDoc(ref);
  const existing = snap.exists() && Array.isArray(snap.data().tokens)
    ? snap.data().tokens.map(t => String(t || '').trim()).filter(Boolean)
    : [];
  const tokens = [nextToken, ...existing.filter(t => t !== nextToken)].slice(0, PUSH_TOKEN_LIMIT);
  await setDoc(ref, {
    participant_id: id,
    tokens,
    updated_at: serverTimestamp()
  }, { merge: true });
}

export async function removePushToken(participantId, token) {
  const id = String(participantId || '').trim().toUpperCase();
  const drop = String(token || '').trim();
  if (!id) return;
  const ref = doc(db, 'push_tokens', id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const existing = Array.isArray(snap.data().tokens) ? snap.data().tokens : [];
  const tokens = drop
    ? existing.filter(t => t !== drop)
    : [];
  await setDoc(ref, {
    participant_id: id,
    tokens,
    updated_at: serverTimestamp()
  }, { merge: true });
}

/**
 * Ask for notification permission. FCM token is optional (Blaze Functions only).
 * Spark/free: permission + Firestore listeners while the PWA/tab stays open.
 * Returns { ok, token, reason }.
 */
export async function enablePushNotifications(participantId, _serviceWorkerRegistration) {
  if (!String(participantId || '').trim()) return { ok: false, reason: 'missing-id' };
  if (!isNotificationApiSupported()) return { ok: false, reason: 'unsupported' };

  if (Notification.permission === 'denied') return { ok: false, reason: 'denied' };
  if (Notification.permission !== 'granted') {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return { ok: false, reason: perm === 'denied' ? 'denied' : 'dismissed' };
  }

  // Spark/free: do not write push_tokens (needs unpublished rules + Cloud Functions).
  return { ok: true, token: '' };
}

export async function disablePushNotifications(participantId, token) {
  try {
    const messaging = await getMessagingSafe();
    if (messaging) await deleteToken(messaging);
  } catch (_) { /* ignore */ }
  try {
    await removePushToken(participantId, token || '');
  } catch (_) { /* live rules may not allow push_tokens */ }
}

/** Foreground FCM handler (app open). */
export async function listenForegroundPush(onPayload) {
  const messaging = await getMessagingSafe();
  if (!messaging) return () => {};
  return onMessage(messaging, payload => {
    if (typeof onPayload === 'function') onPayload(payload);
  });
}
