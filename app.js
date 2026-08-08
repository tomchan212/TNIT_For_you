/* ═══════════════════════════════════════════════════════════════════════════
   HKCYSTINTJustForYou — Frontend Application
   Sections: Configuration, State, DOM, Utilities, Data, Combobox,
             Messaging, Admin Monitor, 獎項, Init
   ═══════════════════════════════════════════════════════════════════════════ */

import * as data from './firebase-data.js';

// ─── Configuration ──────────────────────────────────────────────────────────

const CONFIG = {
  // Served by GitHub Pages so the login screen can draw before any network
  // round trip. It carries ids and groups only; phone numbers are passwords
  // and live in Firebase Authentication.
  PARTICIPANTS_URL: 'participants.json',
  PARTICIPANTS_CACHE_KEY: 'hkcy_participants',
  PARTICIPANTS_CACHE_TTL: 30 * 60 * 1000,
  // Tab-scoped login identity: survives reload, cleared on logout / tab close.
  SESSION_KEY: 'hkcy_session',
  READ_MSG_PREFIX: 'hkcy_read_',
  ADMIN_ID: 'ADMIN',
  MAX_MESSAGE_LENGTH: 300,
  CHAR_WARN_THRESHOLD: 250,
  TOAST_DURATION: 3000,
  // Firestore answers in well under a second on a working connection, so a
  // wait this long means the network is the problem and saying so beats
  // leaving someone watching a progress bar.
  LOADING_TIMEOUT_MS: 15000,
  // How often a logged-in participant refreshes their presence document.
  PRESENCE_HEARTBEAT_MS: 45000,
  // last_seen newer than this counts as currently online on the dashboard.
  PRESENCE_ONLINE_MS: 120000,
  // Admin message list: after the admin scrolls, pause live re-renders so they
  // can read / hit 撤回 without the list jumping. Resume after this idle time.
  ADMIN_MSG_SCROLL_RESUME_MS: 3000
};

const BAD_WORDS = [
  '撚','柒','屌','閪','仆街','死全家','操你','草你','fuck','shit','bitch','asshole',
  'damn','cunt','bastard','whore','slut','dick','pussy','cock','nigger','faggot',
  '冚家剷','死開','去死','白痴','蠢材','廢物','垃圾','人渣','賤人','婊子','雞婆',
  '老母','老味','鳩','戇鳩','戇居','戇撚','柒頭','粉腸','豬頭','死仔','死女',
  '撚樣','柒樣','臭閪','臭化','頂你','頂心','頂肺','收皮','仆你','戇鳩',
  'stupid','idiot','moron','retard','dumbass','motherfucker','mf','wtf',
  '撚毛','柒毛','死撚','死柒','臭撚','臭柒','閪仔','閪女','鳩仔','鳩女',
  'on9','on99','on999','撚樣','柒皮','柒精','柒撚','撚精','撚皮','死蠢',
  'hell','dammit','bullshit','horseshit','dickhead','jackass','twat','wanker',
  '撚閪','柒閪','死閪','臭閪','閪毛','鳩毛','撚鳩','柒鳩','死鳩','臭鳩'
];

// ─── State ──────────────────────────────────────────────────────────────────

const state = {
  participantId: null,
  participants: [],
  inboxMessages: [],
  sentMessages: [],
  messagingOpen: true,
  isAdmin: false,
  monitorMessages: [],
  monitorViewFilter: 'all',
  monitorGroupFilter: '',
  adminLoad: null,
  votingConfig: { voting_status: 'DRAFT', allow_resubmit: false, calculated_at: '', published_at: '' },
  knownMessageIds: new Set(),
  adminMessagesBootstrapped: false,
  adminMsgScrollPaused: false,
  adminMsgPendingRender: false,
  adminMsgScrollIdleTimer: null,
  trophy: {
    loaded: false,
    loading: false,
    votingStatus: 'DRAFT',
    trophies: [],
    teammates: [],
    assignments: {},
    readonly: false,
    editable: false,
    submissionStatus: 'draft',
    progress: { assigned: 0, total: 0 },
    myAwards: [],
    showResults: false,
    trophyRevision: '',
    resultsModalRevision: ''
  },
  adminTrophy: {
    loading: false,
    overview: null,
    auditVotes: [],
    profiles: [],
    trophySummary: [],
    trophies: [],
    submissions: [],
    results: [],
    // Open vote-matrix popup: { groupLabel, focusId } or null.
    matrixModal: null
  },
  adminParticipant: {
    selectedId: null,
    detail: null
  },
  presence: []
};

let adminParticipantCombobox = null;

// Every open Firestore listener, so signing out can close all of them.
let subscriptions = [];
let resultUnsubscribe = null;
// Skip the first snapshot so login itself does not look like a status change.
let votingStatusPrimed = false;
let messagingStatusPrimed = false;
let presenceHeartbeatTimer = null;

// ─── DOM References ─────────────────────────────────────────────────────────

const DOM = {};

function cacheDOM() {
  DOM.loadingOverlay = document.getElementById('loading-overlay');
  DOM.loadingPercent = document.getElementById('loading-percent');
  DOM.loadingBarFill = document.getElementById('loading-bar-fill');
  DOM.splashPercent = document.getElementById('splash-percent');
  DOM.splashBarFill = document.getElementById('splash-bar-fill');
  DOM.toastContainer = document.getElementById('toast-container');
  DOM.confettiCanvas = document.getElementById('confetti-canvas');

  DOM.screenSplash = document.getElementById('screen-splash');
  DOM.screenLogin = document.getElementById('screen-login');
  DOM.screenParticipant = document.getElementById('screen-participant');
  DOM.screenAdmin = document.getElementById('screen-admin');

  DOM.loginForm = document.getElementById('login-form');
  DOM.loginParticipant = document.getElementById('login-participant');
  DOM.loginPhone = document.getElementById('login-phone');
  DOM.loginNumpadToggle = document.getElementById('login-numpad-toggle');
  DOM.loginSubmit = document.getElementById('login-submit');
  DOM.loginDropdown = document.getElementById('login-dropdown');
  DOM.loginComboboxToggle = document.getElementById('login-combobox-toggle');
  DOM.loginNoMatch = document.getElementById('login-no-match');
  DOM.loginStatusBanner = document.getElementById('login-status-banner');

  DOM.participantGreeting = document.getElementById('participant-greeting');
  DOM.participantSubgreeting = document.getElementById('participant-subgreeting');
  DOM.participantLogout = document.getElementById('participant-logout');
  DOM.homeInboxBadge = document.getElementById('home-inbox-badge');

  DOM.sendForm = document.getElementById('send-form');
  DOM.sendReceiver = document.getElementById('send-receiver');
  DOM.sendDropdown = document.getElementById('send-dropdown');
  DOM.sendComboboxToggle = document.getElementById('send-combobox-toggle');
  DOM.sendContent = document.getElementById('send-content');
  DOM.sendSubmit = document.getElementById('send-submit');
  DOM.sendClosedBanner = document.getElementById('send-closed-banner');
  DOM.sendClosedState = document.getElementById('send-closed-state');
  DOM.charCounter = document.getElementById('char-counter');
  DOM.badWordsWarning = document.getElementById('bad-words-warning');

  DOM.inboxList = document.getElementById('inbox-list');
  DOM.inboxEmpty = document.getElementById('inbox-empty');
  DOM.inboxBadge = document.getElementById('inbox-badge');
  DOM.inboxRefresh = document.getElementById('inbox-refresh');

  DOM.sentList = document.getElementById('sent-list');
  DOM.sentEmpty = document.getElementById('sent-empty');
  DOM.sentRefresh = document.getElementById('sent-refresh');

  DOM.trophyNotOpen = document.getElementById('trophy-not-open');
  DOM.trophyStatusBanner = document.getElementById('trophy-status-banner');
  DOM.trophyResultsPanel = document.getElementById('trophy-results-panel');
  DOM.trophyResultsList = document.getElementById('trophy-results-list');
  DOM.trophyResultsTitle = document.getElementById('trophy-results-title');
  DOM.trophyVotingSection = document.getElementById('trophy-voting-section');
  DOM.trophyResultsModal = document.getElementById('trophy-results-modal');
  DOM.trophyResultsModalList = document.getElementById('trophy-results-modal-list');
  DOM.trophyResultsModalClose = document.getElementById('trophy-results-modal-close');
  DOM.voteMatrixModal = document.getElementById('vote-matrix-modal');
  DOM.voteMatrixModalTitle = document.getElementById('vote-matrix-modal-title');
  DOM.voteMatrixModalSubtitle = document.getElementById('vote-matrix-modal-subtitle');
  DOM.voteMatrixModalToolbar = document.getElementById('vote-matrix-modal-toolbar');
  DOM.voteMatrixModalBack = document.getElementById('vote-matrix-modal-back');
  DOM.voteMatrixModalBody = document.getElementById('vote-matrix-modal-body');
  DOM.voteMatrixModalClose = document.getElementById('vote-matrix-modal-close');
  DOM.trophyProgressText = document.getElementById('trophy-progress-text');
  DOM.trophyProgressFill = document.getElementById('trophy-progress-fill');
  DOM.trophyTeammates = document.getElementById('trophy-teammates');
  DOM.trophyEmpty = document.getElementById('trophy-empty');
  DOM.trophyActions = document.getElementById('trophy-actions');
  DOM.trophySaveDraft = document.getElementById('trophy-save-draft');
  DOM.trophySubmitAll = document.getElementById('trophy-submit-all');
  DOM.trophySubmittedHome = document.getElementById('trophy-submitted-home');

  DOM.profileAvatar = document.getElementById('profile-avatar');
  DOM.profileName = document.getElementById('profile-name');
  DOM.profileGroup = document.getElementById('profile-group');
  DOM.profileStats = document.getElementById('profile-stats');

  DOM.adminLogout = document.getElementById('admin-logout');
  DOM.adminDashboardPanel = document.getElementById('admin-dashboard-panel');
  DOM.adminDashboardStats = document.getElementById('admin-dashboard-stats');
  DOM.adminDashboardStatus = document.getElementById('admin-dashboard-status');
  DOM.adminLoginStatus = document.getElementById('admin-login-status');
  DOM.adminRecentActivity = document.getElementById('admin-recent-activity');
  DOM.adminQueuePill = document.getElementById('admin-queue-pill');
  DOM.adminLiveBadge = document.getElementById('admin-live-badge');
  DOM.adminLiveLoad = document.getElementById('admin-live-load');
  DOM.adminSyncTime = document.getElementById('admin-sync-time');
  DOM.adminMsgCount = document.getElementById('admin-msg-count');
  DOM.adminMsgSearch = document.getElementById('admin-msg-search');
  DOM.adminMsgGroupFilter = document.getElementById('admin-msg-group-filter');
  DOM.adminMessageList = document.getElementById('admin-message-list');
  DOM.adminMsgEmpty = document.getElementById('admin-msg-empty');
  DOM.adminEnableMsg = document.getElementById('admin-enable-msg');
  DOM.adminDisableMsg = document.getElementById('admin-disable-msg');
  DOM.adminMessagesPanel = document.getElementById('admin-messages-panel');
  DOM.adminMain = document.querySelector('#screen-admin .app-main');
  DOM.adminTrophyPanel = document.getElementById('admin-trophy-panel');
  DOM.adminResultsPanel = document.getElementById('admin-results-panel');
  DOM.adminVotingStatusBadge = document.getElementById('admin-voting-status-badge');

  DOM.adminTrophyStats = document.getElementById('admin-trophy-stats');
  DOM.adminPendingVoters = document.getElementById('admin-pending-voters');
  DOM.adminOpenVoting = document.getElementById('admin-open-voting');
  DOM.adminCloseVoting = document.getElementById('admin-close-voting');
  DOM.adminCalculate = document.getElementById('admin-calculate');
  DOM.adminPublish = document.getElementById('admin-publish');

  DOM.auditSearch = document.getElementById('audit-search');
  DOM.auditTrophyFilter = document.getElementById('audit-trophy-filter');
  DOM.auditCards = document.getElementById('audit-cards');
  DOM.auditTableBody = document.querySelector('#audit-table tbody');
  DOM.profilesList = document.getElementById('profiles-list');
  DOM.summaryList = document.getElementById('summary-list');

  DOM.adminParticipantsPanel = document.getElementById('admin-participants-panel');
  DOM.adminParticipantSelect = document.getElementById('admin-participant-select');
  DOM.adminParticipantDropdown = document.getElementById('admin-participant-dropdown');
  DOM.adminParticipantToggle = document.getElementById('admin-participant-toggle');
  DOM.adminParticipantDetail = document.getElementById('admin-participant-detail');
  DOM.adminParticipantStats = document.getElementById('admin-participant-stats');
  DOM.adminEditPhone = document.getElementById('admin-edit-phone');
  DOM.adminEditGroup = document.getElementById('admin-edit-group');
  DOM.adminSaveParticipant = document.getElementById('admin-save-participant');
  DOM.adminDeleteMessages = document.getElementById('admin-delete-messages');
  DOM.adminResetTrophy = document.getElementById('admin-reset-trophy');
  DOM.adminDeleteAllRecords = document.getElementById('admin-delete-all-records');
  DOM.adminBulkGroup = document.getElementById('admin-bulk-group');
  DOM.adminBulkAutoGroup = document.getElementById('admin-bulk-auto-group');
  DOM.adminBulkApplyGroup = document.getElementById('admin-bulk-apply-group');
  DOM.adminBulkDeleteAll = document.getElementById('admin-bulk-delete-all');
  DOM.adminVersion = document.getElementById('admin-version');
  DOM.adminParticipantCount = document.getElementById('admin-participant-count');
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function normalizeId(id) {
  if (!id) return '';
  const s = String(id).trim().toUpperCase();
  return s === 'ADMIN' ? CONFIG.ADMIN_ID : s;
}

function isAdminLogin(participantId) {
  return String(participantId || '').trim().toLowerCase() === 'admin';
}

function showScreen(name) {
  if (DOM.screenSplash) DOM.screenSplash.classList.add('hidden');
  DOM.screenLogin.classList.toggle('hidden', name !== 'login');
  DOM.screenParticipant.classList.toggle('hidden', name !== 'participant');
  DOM.screenAdmin.classList.toggle('hidden', name !== 'admin');
  document.body.classList.toggle('participant-active', name === 'participant');
  document.body.classList.toggle('admin-active', name === 'admin');
  if (name !== 'login') setLoginNativeNumpad(false);
}

let loadingTickTimer = null;
let splashTickTimer = null;
let loadingSafetyTimer = null;

function setLoadingPercent(percent) {
  const value = Math.min(100, Math.max(0, Math.round(percent)));
  if (DOM.loadingPercent) DOM.loadingPercent.textContent = value + '%';
  if (DOM.loadingBarFill) DOM.loadingBarFill.style.width = value + '%';
  if (DOM.loadingOverlay) DOM.loadingOverlay.setAttribute('aria-valuenow', String(value));
  return value;
}

function setSplashPercent(percent) {
  const value = Math.min(100, Math.max(0, Math.round(percent)));
  if (DOM.splashPercent) DOM.splashPercent.textContent = value + '%';
  if (DOM.splashBarFill) DOM.splashBarFill.style.width = value + '%';
  return value;
}

function stopLoadingTick() {
  if (loadingTickTimer) {
    clearInterval(loadingTickTimer);
    loadingTickTimer = null;
  }
}

function clearLoadingSafetyTimer() {
  if (loadingSafetyTimer) {
    clearTimeout(loadingSafetyTimer);
    loadingSafetyTimer = null;
  }
}

function startLoadingTick() {
  stopLoadingTick();
  loadingTickTimer = setInterval(() => {
    const current = parseInt(DOM.loadingPercent?.textContent || '0', 10) || 0;
    if (current < 80) setLoadingPercent(current + 2);
    else if (current < 96) setLoadingPercent(current + 1);
  }, 120);
}

function showLoading(show, percent) {
  if (!show) {
    stopLoadingTick();
    clearLoadingSafetyTimer();
    DOM.loadingOverlay.classList.add('hidden');
    DOM.loadingOverlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('is-loading');
    return;
  }

  DOM.loadingOverlay.classList.remove('hidden');
  DOM.loadingOverlay.setAttribute('aria-hidden', 'false');
  document.body.classList.add('is-loading');

  setLoadingPercent(percent !== undefined ? percent : 0);
  startLoadingTick();

  clearLoadingSafetyTimer();
  loadingSafetyTimer = setTimeout(() => {
    if (!DOM.loadingOverlay.classList.contains('hidden')) {
      finishLoading();
      showToast('載入時間較長，請檢查網絡後再試', 'error');
    }
  }, CONFIG.LOADING_TIMEOUT_MS);
}

function finishLoading() {
  stopLoadingTick();
  clearLoadingSafetyTimer();
  setLoadingPercent(100);
  setTimeout(() => showLoading(false), 120);
}

/** Plays the splash animation and resolves when it has finished exiting. */
function runSplashAnimation() {
  return new Promise(resolve => {
    if (!DOM.screenSplash) {
      resolve();
      return;
    }
    DOM.screenSplash.classList.remove('hidden', 'splash-exit');
    DOM.screenLogin.classList.add('hidden');
    if (DOM.screenParticipant) DOM.screenParticipant.classList.add('hidden');
    if (DOM.screenAdmin) DOM.screenAdmin.classList.add('hidden');
    setSplashPercent(0);

    if (splashTickTimer) clearInterval(splashTickTimer);
    splashTickTimer = setInterval(() => {
      const current = parseInt(DOM.splashPercent?.textContent || '0', 10) || 0;
      if (current < 100) setSplashPercent(current + 2);
    }, 36);

    setTimeout(() => {
      if (splashTickTimer) {
        clearInterval(splashTickTimer);
        splashTickTimer = null;
      }
      setSplashPercent(100);
      DOM.screenSplash.classList.add('splash-exit');
      setTimeout(() => {
        DOM.screenSplash.classList.add('hidden');
        resolve();
      }, 400);
    }, 1800);
  });
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = 'toast toast-' + type;
  toast.setAttribute('role', 'alert');
  toast.textContent = message;
  DOM.toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), CONFIG.TOAST_DURATION);
}

function formatDateTime(iso, options = {}) {
  if (!iso) return '—';
  try {
    const d = new Date(iso.replace(' ', 'T'));
    if (isNaN(d.getTime())) return iso;
    const opts = {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    };
    if (options.withSeconds) opts.second = '2-digit';
    return d.toLocaleString('zh-Hant', opts);
  } catch (_) {
    return iso;
  }
}

function formatMessageTime(iso) {
  return formatDateTime(iso, { withSeconds: true });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function appIcon(name, extraClass = '') {
  const cls = ['app-icon', 'app-icon-' + name];
  if (extraClass) cls.push(extraClass);
  return '<span class="' + cls.join(' ') + '" aria-hidden="true"></span>';
}

/** Springy “彈一下” on illustrated icons inside a tapped button/card. */
function popAppIcon(el) {
  const icon = el && el.querySelector ? el.querySelector('.app-icon') : null;
  if (!icon) return;
  icon.classList.remove('is-popping');
  // Restart the CSS animation even if tapped again mid-bounce.
  void icon.offsetWidth;
  icon.classList.add('is-popping');
}

function bindIconPopTargets(selector) {
  document.querySelectorAll(selector).forEach(el => {
    if (el.dataset.iconPopBound === '1') return;
    el.dataset.iconPopBound = '1';
    el.addEventListener('pointerdown', () => popAppIcon(el), { passive: true });
    el.addEventListener('animationend', (e) => {
      if (e.target && e.target.classList && e.target.classList.contains('app-icon')) {
        e.target.classList.remove('is-popping');
      }
    });
  });
}


function getReadMessageIds(participantId) {
  try {
    const raw = localStorage.getItem(CONFIG.READ_MSG_PREFIX + participantId);
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}

function saveReadMessageIds(participantId, ids) {
  localStorage.setItem(CONFIG.READ_MSG_PREFIX + participantId, JSON.stringify(ids));
}

function markAllInboxRead() {
  if (!state.participantId) return;
  const ids = state.inboxMessages.map(m => m.message_id);
  saveReadMessageIds(state.participantId, ids);
  updateInboxBadge();
}

function updateInboxBadge() {
  if (!state.participantId) return;
  const readIds = new Set(getReadMessageIds(state.participantId));
  const unread = state.inboxMessages.filter(m => !readIds.has(m.message_id)).length;
  if (DOM.inboxBadge) {
    DOM.inboxBadge.textContent = unread;
    DOM.inboxBadge.classList.toggle('hidden', unread === 0);
  }
  if (DOM.homeInboxBadge) {
    DOM.homeInboxBadge.textContent = unread;
    DOM.homeInboxBadge.classList.toggle('hidden', unread === 0);
  }
}

function launchConfetti() {
  const canvas = DOM.confettiCanvas;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const colors = ['#E9C46A', '#D4A373', '#7FB77E', '#D66A6A', '#FFF9F2'];
  const pieces = Array.from({ length: 80 }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height - canvas.height,
    w: 6 + Math.random() * 6,
    h: 4 + Math.random() * 4,
    color: colors[Math.floor(Math.random() * colors.length)],
    vx: (Math.random() - 0.5) * 4,
    vy: 2 + Math.random() * 4,
    rot: Math.random() * 360,
    vr: (Math.random() - 0.5) * 8
  }));
  let frame = 0;
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    pieces.forEach(p => {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rot * Math.PI) / 180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      p.vy += 0.05;
    });
    frame++;
    if (frame < 120) requestAnimationFrame(draw);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  draw();
}

function containsBadWords(text) {
  const lower = text.toLowerCase();
  return BAD_WORDS.some(word => lower.includes(word.toLowerCase()));
}

function runProgressButton(btn, promise) {
  btn.classList.add('is-loading');
  btn.disabled = true;
  return promise.finally(() => {
    btn.classList.remove('is-loading');
    btn.disabled = false;
  });
}

function getParticipantsCache() {
  try {
    const raw = sessionStorage.getItem(CONFIG.PARTICIPANTS_CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (Date.now() - data.timestamp > CONFIG.PARTICIPANTS_CACHE_TTL) return null;
    return data.participants;
  } catch (_) {
    return null;
  }
}

function setParticipantsCache(participants) {
  sessionStorage.setItem(CONFIG.PARTICIPANTS_CACHE_KEY, JSON.stringify({
    participants,
    timestamp: Date.now()
  }));
}

function buildPairingsFromAssignments(assignments) {
  const pairings = [];
  Object.entries(assignments).forEach(([receiverId, trophyIds]) => {
    (trophyIds || []).forEach(trophyId => {
      pairings.push({ receiver_id: receiverId, trophy_id: trophyId });
    });
  });
  return pairings;
}

// ─── Subscriptions ──────────────────────────────────────────────────────────

function track(unsubscribe) {
  subscriptions.push(unsubscribe);
  return unsubscribe;
}

function stopAllSubscriptions() {
  stopPresenceHeartbeat();
  subscriptions.forEach(stop => {
    try {
      stop();
    } catch (_) { /* already closed */ }
  });
  subscriptions = [];
  resultUnsubscribe = null;
  votingStatusPrimed = false;
  messagingStatusPrimed = false;
}

async function startPresenceHeartbeat() {
  if (!state.participantId || state.isAdmin) return;
  stopPresenceHeartbeat();
  const pulse = () => {
    data.touchPresence(state.participantId).catch(() => { /* presence is best-effort */ });
  };
  pulse();
  presenceHeartbeatTimer = setInterval(pulse, CONFIG.PRESENCE_HEARTBEAT_MS);
}

function stopPresenceHeartbeat() {
  if (presenceHeartbeatTimer) {
    clearInterval(presenceHeartbeatTimer);
    presenceHeartbeatTimer = null;
  }
}

function reportSubscriptionError(what) {
  return err => {
    console.warn(what + ' listener error:', err && err.message);
    showToast(what + '連線中斷，正在重試…', 'error');
  };
}

// ─── Roster ─────────────────────────────────────────────────────────────────

async function loadStaticParticipants() {
  const res = await fetch(CONFIG.PARTICIPANTS_URL, { cache: 'no-cache' });
  if (!res.ok) throw new Error('網路錯誤：' + res.status);
  const data = await res.json();
  if (!Array.isArray(data.participants) || data.participants.length === 0) {
    throw new Error('參加者名單是空的');
  }
  return data.participants;
}

// ─── Derived trophy views ───────────────────────────────────────────────────

/** GROUP_1 before GROUP_2 … then GROUP_STAFF / everything else. */
function compareGroupLabels(a, b) {
  const rank = label => {
    const m = String(label).match(/^GROUP_(\d+)$/i);
    if (m) return Number(m[1]);
    if (/STAFF/i.test(label)) return 1000;
    return 2000;
  };
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  return String(a).localeCompare(String(b));
}

function formatGroupLabel(label) {
  const m = String(label || '').match(/^GROUP_(\d+)$/i);
  if (m) return 'Group ' + m[1];
  if (/STAFF/i.test(label)) return 'Staff';
  return label || '未分組';
}

/**
 * The old backend assembled these summaries server side. Firestore has no
 * server to run code on, but the admin already holds every submission through
 * a listener, so the same numbers are derived here for free.
 */
function buildTrophyOverview(submissions, trophies) {
  const submitted = new Set(
    submissions.filter(s => s.status === 'submitted').map(s => s.participant_id)
  );
  const totalVotes = submissions.reduce((sum, s) => sum + s.pairings.length, 0);

  const byGroup = new Map();
  state.participants.forEach(p => {
    const group = p.group_id || '未分組';
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group).push({
      participant_id: p.participant_id,
      voted: submitted.has(p.participant_id)
    });
  });

  return {
    voting_status: state.votingConfig.voting_status,
    stats: {
      completed_voters: submitted.size,
      total_participants: state.participants.length,
      total_votes: totalVotes,
      trophy_count: trophies.length
    },
    group_voting_status: [...byGroup.entries()]
      .sort((a, b) => compareGroupLabels(a[0], b[0]))
      .map(([group_label, members]) => ({
        group_label,
        display_label: formatGroupLabel(group_label),
        members
      })),
    pending_participants: state.participants
      .filter(p => !submitted.has(p.participant_id))
      .map(p => p.participant_id)
  };
}

function buildAuditVotes(submissions, trophies) {
  const names = new Map(trophies.map(t => [t.trophy_id, t.trophy_name]));
  const rows = [];
  submissions.forEach(submission => {
    submission.pairings.forEach(pair => {
      rows.push({
        sender_id: submission.participant_id,
        receiver_id: pair.receiver_id,
        trophy_id: pair.trophy_id,
        trophy_name: names.get(pair.trophy_id) || pair.trophy_id,
        submitted_at: submission.submitted_at || submission.updated_at
      });
    });
  });
  return rows.sort((a, b) => a.sender_id.localeCompare(b.sender_id));
}

// ─── Combobox ───────────────────────────────────────────────────────────────

function createCombobox(config) {
  const {
    input, dropdown, toggle, getLabel, onSelect
  } = config;

  const comboState = {
    items: config.items || [],
    excludeIds: config.excludeIds || []
  };

  let highlightedIndex = -1;
  let isOpen = false;

  function getFilteredItems(query) {
    const q = (query || '').trim().toUpperCase();
    return comboState.items.filter(item => {
      const id = typeof item === 'string' ? item : item.participant_id;
      if (comboState.excludeIds.includes(id)) return false;
      if (!q) return true;
      return id.toUpperCase().includes(q);
    });
  }

  function renderDropdown(query) {
    const filtered = getFilteredItems(query);
    dropdown.innerHTML = '';
    highlightedIndex = -1;

    if (filtered.length === 0) {
      const li = document.createElement('li');
      li.textContent = '無匹配結果';
      li.style.color = 'var(--text-muted)';
      li.style.pointerEvents = 'none';
      dropdown.appendChild(li);
      return;
    }

    filtered.forEach((item, i) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.textContent = getLabel(item);
      li.dataset.index = i;
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        selectItem(item);
      });
      dropdown.appendChild(li);
    });
  }

  function openDropdown() {
    isOpen = true;
    input.setAttribute('aria-expanded', 'true');
    dropdown.classList.remove('hidden');
    renderDropdown(input.value);
  }

  function closeDropdown() {
    isOpen = false;
    input.setAttribute('aria-expanded', 'false');
    dropdown.classList.add('hidden');
    highlightedIndex = -1;
  }

  function selectItem(item) {
    const label = getLabel(item);
    input.value = label;
    closeDropdown();
    if (onSelect) onSelect(item);
  }

  function highlightItem(index) {
    const lis = dropdown.querySelectorAll('li[data-index]');
    lis.forEach(li => li.classList.remove('highlighted'));
    if (index >= 0 && index < lis.length) {
      lis[index].classList.add('highlighted');
      lis[index].scrollIntoView({ block: 'nearest' });
    }
  }

  input.addEventListener('input', () => {
    if (!isOpen) openDropdown();
    else renderDropdown(input.value);
    if (config.onInput) config.onInput(input.value);
  });

  input.addEventListener('focus', () => openDropdown());

  input.addEventListener('keydown', (e) => {
    const lis = dropdown.querySelectorAll('li[data-index]');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) openDropdown();
      highlightedIndex = Math.min(highlightedIndex + 1, lis.length - 1);
      highlightItem(highlightedIndex);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlightedIndex = Math.max(highlightedIndex - 1, 0);
      highlightItem(highlightedIndex);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightedIndex >= 0 && lis[highlightedIndex]) {
        const filtered = getFilteredItems(input.value);
        selectItem(filtered[highlightedIndex]);
      }
    } else if (e.key === 'Escape') {
      closeDropdown();
    }
  });

  if (toggle) {
    toggle.addEventListener('click', () => {
      if (isOpen) closeDropdown();
      else { input.focus(); openDropdown(); }
    });
  }

  document.addEventListener('click', (e) => {
    if (!input.closest('.combobox-wrapper').contains(e.target)) {
      closeDropdown();
    }
  });

  return {
    openDropdown,
    closeDropdown,
    renderDropdown,
    getFilteredItems,
    setItems(items) { comboState.items = items; },
    setExcludeIds(ids) { comboState.excludeIds = ids; }
  };
}

function isStaffGroup(groupId) {
  return /STAFF/i.test(String(groupId || ''));
}

function isStaffParticipant(p) {
  return !!(p && isStaffGroup(p.group_id));
}

/** Login dropdown: numbered groups only. Staff type their own id. */
function getLoginMenuParticipants() {
  return state.participants.filter(p => !isStaffParticipant(p));
}

function findParticipantById(participantId) {
  const id = normalizeId(participantId);
  if (!id) return null;
  return state.participants.find(p => normalizeId(p.participant_id) === id) || null;
}

let loginCombobox = null;
let sendCombobox = null;
let selectedReceiverId = null;

function initLoginCombobox() {
  loginCombobox = createCombobox({
    input: DOM.loginParticipant,
    dropdown: DOM.loginDropdown,
    toggle: DOM.loginComboboxToggle,
    items: getLoginMenuParticipants(),
    getLabel: (item) => item.participant_id,
    onInput: (value) => {
      const isAdmin = isAdminLogin(value);
      DOM.loginComboboxToggle.classList.toggle('hidden', isAdmin);
      if (isAdmin) {
        loginCombobox.closeDropdown();
        DOM.loginNoMatch.classList.add('hidden');
        return;
      }
      const filtered = loginCombobox.getFilteredItems(value);
      // Staff (and any known id) may type freely even though they are not listed.
      const known = !!findParticipantById(value);
      DOM.loginNoMatch.classList.toggle(
        'hidden',
        !value.trim() || filtered.length > 0 || known
      );
    },
    onSelect: (item) => {
      DOM.loginParticipant.value = item.participant_id;
      DOM.loginNoMatch.classList.add('hidden');
    }
  });
}

function initSendCombobox() {
  const exclude = [state.participantId, CONFIG.ADMIN_ID];
  sendCombobox = createCombobox({
    input: DOM.sendReceiver,
    dropdown: DOM.sendDropdown,
    toggle: DOM.sendComboboxToggle,
    items: state.participants,
    excludeIds: exclude,
    getLabel: (item) => item.participant_id,
    onSelect: (item) => {
      selectedReceiverId = item.participant_id;
      DOM.sendReceiver.value = item.participant_id;
    }
  });
}

function refreshComboboxItems() {
  if (loginCombobox) loginCombobox.setItems(getLoginMenuParticipants());
  if (sendCombobox) {
    sendCombobox.setItems(state.participants);
    sendCombobox.setExcludeIds([state.participantId, CONFIG.ADMIN_ID]);
  }
}

// ─── Login ──────────────────────────────────────────────────────────────────

async function bootstrapApp() {
  const cached = getParticipantsCache();
  if (cached) {
    state.participants = cached;
    initLoginCombobox();
  }

  try {
    state.participants = await loadStaticParticipants();
    setParticipantsCache(state.participants);

    if (!loginCombobox) initLoginCombobox();
    else refreshComboboxItems();
  } catch (err) {
    if (!state.participants.length) {
      showToast('無法載入參加者名單：' + err.message, 'error');
    }
  }
}

function updateLoginStatusBanner() {
  if (!state.messagingOpen) {
    DOM.loginStatusBanner.textContent = '留言功能目前已關閉';
    DOM.loginStatusBanner.className = 'status-banner status-banner-warning';
    DOM.loginStatusBanner.classList.remove('hidden');
  } else {
    DOM.loginStatusBanner.classList.add('hidden');
  }
}

function isLoginNativeNumpad() {
  return DOM.loginPhone && DOM.loginPhone.inputMode === 'numeric';
}

/**
 * Toggle the system numeric keyboard via inputmode. Always focus the password
 * field when enabling so Staff do not need to tap the text field first.
 */
function setLoginNativeNumpad(enabled) {
  if (!DOM.loginPhone || !DOM.loginNumpadToggle) return;
  const nextMode = enabled ? 'numeric' : 'text';

  DOM.loginPhone.inputMode = nextMode;
  DOM.loginNumpadToggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
  DOM.loginNumpadToggle.setAttribute(
    'aria-label',
    enabled ? '切換文字鍵盤' : '開啟數字鍵盤'
  );
  DOM.loginNumpadToggle.classList.toggle('is-active', enabled);
  DOM.loginNumpadToggle.title = enabled ? '切換文字鍵盤' : '開啟數字鍵盤';

  if (!enabled) return;

  // Mobile browsers only show / rebuild the keyboard after a focus cycle.
  // Blur first, then focus on the next ticks so a cold tap on the button
  // still pops the numpad without touching the text field.
  DOM.loginPhone.blur();
  requestAnimationFrame(() => {
    DOM.loginPhone.focus({ preventScroll: true });
    setTimeout(() => {
      if (document.activeElement !== DOM.loginPhone) {
        DOM.loginPhone.focus({ preventScroll: true });
      }
    }, 30);
  });
}

function toggleLoginNativeNumpad() {
  setLoginNativeNumpad(!isLoginNativeNumpad());
}

async function handleLogin(e) {
  e.preventDefault();
  const rawId = DOM.loginParticipant.value.trim();
  const password = String(DOM.loginPhone.value || '').trim();

  if (!rawId) { showToast('請輸入參加者編號', 'error'); return; }
  if (!password) { showToast('請輸入密碼', 'error'); return; }

  const isAdmin = isAdminLogin(rawId);
  const participantId = isAdmin ? CONFIG.ADMIN_ID : normalizeId(rawId);

  await runProgressButton(DOM.loginSubmit, (async () => {
    try {
      // Firebase checks the password. Numbered seats type their own id; Staff
      // still use their phone. Short ids are expanded inside signIn to meet
      // Auth's 6-character minimum.
      await data.signIn(participantId, password);
    } catch (err) {
      showToast(data.describeAuthError(err), 'error');
      return;
    }

    state.participantId = participantId;
    state.isAdmin = isAdmin;
    saveSession(participantId, isAdmin);

    if (isAdmin) {
      await enterAdminDashboard();
    } else {
      await enterParticipantDashboard();
    }
  })());
}

function saveSession(participantId, isAdmin) {
  try {
    sessionStorage.setItem(CONFIG.SESSION_KEY, JSON.stringify({
      participantId,
      isAdmin: !!isAdmin,
      savedAt: Date.now()
    }));
  } catch (_) { /* private mode / quota — Firebase session is still enough */ }
}

function clearSession() {
  try {
    sessionStorage.removeItem(CONFIG.SESSION_KEY);
  } catch (_) { /* ignore */ }
}

function readSession() {
  try {
    const raw = sessionStorage.getItem(CONFIG.SESSION_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !data.participantId) return null;
    return {
      participantId: normalizeId(data.participantId),
      isAdmin: !!data.isAdmin
    };
  } catch (_) {
    return null;
  }
}

/**
 * After a reload, Firebase Auth restores the tab session and we re-enter the
 * matching dashboard. Returns true if the user was signed back in.
 */
async function tryRestoreSession() {
  const user = await data.waitForAuth();
  if (!user) {
    clearSession();
    return false;
  }

  const fromAuth = data.identityFromUser(user);
  if (!fromAuth) {
    clearSession();
    await data.signOutUser().catch(() => {});
    return false;
  }

  const stored = readSession();
  // Prefer the tab-stored id when it matches the signed-in account; otherwise
  // trust Firebase and refresh the tab copy.
  if (stored && stored.participantId === fromAuth.participantId) {
    state.participantId = stored.participantId;
    state.isAdmin = stored.isAdmin || fromAuth.isAdmin;
  } else {
    state.participantId = fromAuth.participantId;
    state.isAdmin = fromAuth.isAdmin;
    saveSession(state.participantId, state.isAdmin);
  }

  if (state.isAdmin) {
    await enterAdminDashboard();
  } else {
    await enterParticipantDashboard();
  }
  return true;
}

/**
 * Opens a listener and resolves once its first snapshot has been applied, so
 * the loading screen can wait for real data without polling for it.
 */
function subscribeAndWait(subscribe, handle, label) {
  return new Promise((resolve, reject) => {
    let settled = false;
    track(subscribe(
      (...args) => {
        handle(...args);
        if (!settled) {
          settled = true;
          resolve();
        }
      },
      err => {
        if (!settled) {
          settled = true;
          reject(err);
          return;
        }
        reportSubscriptionError(label)(err);
      }
    ));
  });
}

async function startParticipantSubscriptions() {
  const pid = state.participantId;

  await Promise.all([
    subscribeAndWait(
      (cb, err) => data.subscribeMessagingStatus(cb, err),
      status => {
        const wasOpen = state.messagingOpen;
        state.messagingOpen = status === 'OPEN';
        updateSendFormState();
        updateCharCounter();
        if (messagingStatusPrimed && wasOpen !== state.messagingOpen) {
          showToast(
            state.messagingOpen ? '留言功能已重新開放' : '留言功能已關閉',
            state.messagingOpen ? 'success' : 'info'
          );
        }
        messagingStatusPrimed = true;
      },
      '留言開關'
    ),
    subscribeAndWait(
      (cb, err) => data.subscribeInbox(pid, cb, err),
      messages => {
        state.inboxMessages = messages;
        renderInbox();
        renderProfile();
      },
      '收件箱'
    ),
    subscribeAndWait(
      (cb, err) => data.subscribeSent(pid, cb, err),
      messages => {
        state.sentMessages = messages;
        renderSent();
        renderProfile();
      },
      '已發送列表'
    ),
    subscribeAndWait(
      (cb, err) => data.subscribeVotingConfig(cb, err),
      config => {
        const prevStatus = state.trophy.votingStatus;
        state.votingConfig = config;
        state.trophy.votingStatus = config.voting_status;
        state.trophy.trophyRevision = config.published_at || config.calculated_at || config.voting_status;
        recalcTrophyPermissions();
        ensureResultSubscription();
        updateTrophyStatusBanner();
        renderParticipantTrophyResults();
        renderTrophyTeammates();
        renderProfile();
        if (votingStatusPrimed && prevStatus !== config.voting_status) {
          notifyVotingStatusChange(config.voting_status);
        }
        votingStatusPrimed = true;
      },
      '投票狀態'
    ),
    subscribeAndWait(
      (cb, err) => data.subscribeMySubmission(pid, cb, err),
      submission => {
        state.trophy.submissionStatus = submission ? submission.status : 'draft';
        state.trophy.assignments = enforceUniqueTrophyAssignments(
          submission ? data.pairingsToAssignments(submission.pairings) : {}
        );
        state.trophy.loaded = true;
        recalcTrophyPermissions();
        recalcTrophyProgress();
        renderTrophyTeammates();
        updateTrophyStatusBanner();
        renderProfile();
      },
      '投票紀錄'
    )
  ]);
}

/**
 * Results are unreadable until they are published, and a listener that gets
 * refused is dead for good. So the listener is opened only once publishing has
 * happened, and closed again if the admin reopens voting.
 */
function ensureResultSubscription() {
  const published = state.votingConfig.voting_status === 'PUBLISHED';

  if (!published) {
    if (resultUnsubscribe) {
      resultUnsubscribe();
      resultUnsubscribe = null;
    }
    state.trophy.myAwards = [];
    return;
  }
  if (resultUnsubscribe) return;

  resultUnsubscribe = track(data.subscribeMyResult(
    state.participantId,
    result => {
      state.trophy.myAwards = result
        ? (result.awards || []).filter(a => a.award_source !== 'fallback')
        : [];
      renderParticipantTrophyResults();
      maybeShowPublishedModal(true);
    },
    reportSubscriptionError('得獎結果')
  ));
}

/** Whether this participant may still change their ballot right now. */
function recalcTrophyPermissions() {
  const open = state.votingConfig.voting_status === 'VOTING_OPEN';
  const submitted = state.trophy.submissionStatus === 'submitted';
  state.trophy.editable = open && (!submitted || state.votingConfig.allow_resubmit);
  state.trophy.readonly = !state.trophy.editable;
  state.trophy.showResults = state.votingConfig.voting_status === 'PUBLISHED';
}

async function enterParticipantDashboard() {
  showScreen('participant');
  updateParticipantGreeting();
  initSendCombobox();
  updateSendFormState();
  updateCharCounter();
  switchParticipantView('home');

  try {
    showLoading(true, 10);
    state.trophy.trophies = filterValidTrophies(await data.fetchTrophies());
    state.trophy.teammates = data.getTeammates(state.participantId, state.participants);
    setLoadingPercent(45);
    await startParticipantSubscriptions();
    setLoadingPercent(95);
    await startPresenceHeartbeat();
    recalcTrophyProgress();
    renderTrophyTeammates();
    renderProfile();
  } catch (err) {
    showToast('載入資料失敗：' + err.message, 'error');
  } finally {
    finishLoading();
  }
}

function updateParticipantGreeting() {
  if (!DOM.participantGreeting) return;
  DOM.participantGreeting.innerHTML = '你好，' + escapeHtml(state.participantId || '') + ' ' + appIcon('wave', 'inline-icon');
  if (DOM.participantSubgreeting) {
    DOM.participantSubgreeting.innerHTML = 'Just For You ' + appIcon('heart', 'inline-icon');
  }
}

function renderProfile() {
  if (!DOM.profileStats) return;
  const p = state.participants.find(x => x.participant_id === state.participantId) || {};
  if (DOM.profileAvatar) DOM.profileAvatar.textContent = (state.participantId || '?').slice(0, 2);
  if (DOM.profileName) DOM.profileName.textContent = state.participantId || '—';
  if (DOM.profileGroup) DOM.profileGroup.textContent = p.group_id || '未分組';

  const sentCount = state.sentMessages.filter(m => m.status === 'active').length;
  const receivedCount = state.inboxMessages.length;
  const votingLabel = state.trophy.submissionStatus === 'submitted' ? '已提交' :
    (state.trophy.editable ? '進行中' : VOTING_STATUS_LABELS[state.trophy.votingStatus] || '—');

  DOM.profileStats.innerHTML = `
    <div class="profile-stat"><div class="profile-stat-value">${sentCount}</div><div class="profile-stat-label">已發留言</div></div>
    <div class="profile-stat"><div class="profile-stat-value">${receivedCount}</div><div class="profile-stat-label">收到留言</div></div>
    <div class="profile-stat"><div class="profile-stat-value">${escapeHtml(p.group_id || '—')}</div><div class="profile-stat-label">分組</div></div>
    <div class="profile-stat"><div class="profile-stat-value">${votingLabel}</div><div class="profile-stat-label">投票狀態</div></div>
  `;
}

/**
 * Recomputes every trophy view the admin sees. Cheap enough to run on each
 * snapshot: the whole event is fifty people and a few hundred votes.
 */
function refreshAdminTrophyViews() {
  const trophies = state.adminTrophy.trophies;
  const submissions = state.adminTrophy.submissions;

  state.adminTrophy.overview = buildTrophyOverview(submissions, trophies);
  state.adminTrophy.auditVotes = buildAuditVotes(submissions, trophies);

  const projection = data.computeResults(state.participants, trophies, submissions);
  state.adminTrophy.trophySummary = projection.trophySummary;

  // Once results have been calculated the stored awards are what counts;
  // before that, show what calculating now would produce.
  const stored = state.adminTrophy.results;
  state.adminTrophy.profiles = stored.length > 0
    ? stored
      .map(r => {
        const trophies = (r.awards || []).filter(a => a.award_source !== 'fallback');
        return {
          participant_id: r.participant_id,
          trophies,
          vote_count: trophies.reduce((sum, a) => sum + (a.vote_count || 0), 0)
        };
      })
      .sort((a, b) => a.participant_id.localeCompare(b.participant_id))
    : projection.profiles;

  renderAdminTrophyStats();
  renderAdminPendingVoters();
  renderAuditTable();
  renderProfiles();
  renderTrophySummary();
  populateAuditTrophyFilter();
  updateAdminVotingButtons();
  updateVotingStepper();
  renderAdminDashboard();
}

async function startAdminSubscriptions() {
  await Promise.all([
    subscribeAndWait(
      (cb, err) => data.subscribeMessagingStatus(cb, err),
      status => {
        state.messagingOpen = status === 'OPEN';
        renderAdminDashboard();
      },
      '留言開關'
    ),
    subscribeAndWait(
      (cb, err) => data.subscribeAllMessages(cb, err),
      messages => {
        state.monitorMessages = messages;
        // First snapshot: mark everything known so the whole history does not
        // flash as "new". Later snapshots keep knownMessageIds so brand-new
        // rows can highlight when we actually render them.
        if (!state.adminMessagesBootstrapped) {
          state.knownMessageIds = new Set(messages.map(m => m.message_id));
          state.adminMessagesBootstrapped = true;
        }
        // While the admin is reading mid-list, keep data fresh but do not
        // rebuild the DOM (that jumps the scroll and steals 撤回 taps).
        if (shouldHoldAdminMessageRender()) {
          state.adminMsgPendingRender = true;
          updateAdminMessagePauseUi();
        } else {
          renderAdminMessages();
        }
        renderAdminDashboard();
        renderAdminLiveLoad();
      },
      '留言監控'
    ),
    subscribeAndWait(
      (cb, err) => data.subscribeVotingConfig(cb, err),
      config => {
        state.votingConfig = config;
        refreshAdminTrophyViews();
      },
      '投票狀態'
    ),
    subscribeAndWait(
      (cb, err) => data.subscribeAllSubmissions(cb, err),
      submissions => {
        state.adminTrophy.submissions = submissions;
        refreshAdminTrophyViews();
        renderAdminLiveLoad();
      },
      '投票紀錄'
    ),
    subscribeAndWait(
      (cb, err) => data.subscribeAllResults(cb, err),
      results => {
        state.adminTrophy.results = results;
        refreshAdminTrophyViews();
      },
      '得獎結果'
    )
  ]);

  // Presence is additive. If the new rules are not published yet, the rest of
  // the admin console must still open instead of failing the whole login.
  track(data.subscribePresence(
    rows => {
      state.presence = rows;
      renderAdminLoginStatus();
      renderAdminLiveLoad();
    },
    err => {
      console.warn('登入狀況 listener error:', err && err.message);
      state.presence = [];
      renderAdminLoginStatus();
      if (err && err.code === 'permission-denied') {
        showToast('登入狀況未啟用：請發布最新 firestore.rules', 'info');
      }
    }
  ));
}

async function enterAdminDashboard() {
  showScreen('admin');

  try {
    showLoading(true, 10);
    state.adminTrophy.trophies = filterValidTrophies(await data.fetchTrophies());
    setLoadingPercent(40);
    await startAdminSubscriptions();
    setLoadingPercent(95);
    switchAdminTab('dashboard');
  } catch (err) {
    showToast('載入管理員資料失敗：' + err.message, 'error');
    switchAdminTab('dashboard');
  } finally {
    finishLoading();
  }
}

function renderAdminDashboard(fetchData) {
  const msgCount = fetchData?.messages ? fetchData.messages.length : state.monitorMessages.length;
  const activeCount = state.monitorMessages.filter(m => m.status === 'active').length;

  if (DOM.adminDashboardStats) {
    DOM.adminDashboardStats.innerHTML = `
      <div class="stat-card"><div class="stat-value">${state.participants.length || '—'}</div><div class="stat-label">參加者</div></div>
      <div class="stat-card"><div class="stat-value">${msgCount}</div><div class="stat-label">留言</div></div>
      <div class="stat-card"><div class="stat-value">${activeCount}</div><div class="stat-label">有效留言</div></div>
      <div class="stat-card"><div class="stat-value">${state.messagingOpen ? '開啟' : '關閉'}</div><div class="stat-label">留言狀態</div></div>
    `;
  }

  if (DOM.adminDashboardStatus) {
    const votingLabel = state.adminTrophy.overview
      ? (VOTING_STATUS_LABELS[state.adminTrophy.overview.voting_status] || '—')
      : '—';
    DOM.adminDashboardStatus.innerHTML = `
      <div class="status-item"><span>留言功能</span><span>${state.messagingOpen ? appIcon('dot-green') + ' 開啟' : appIcon('dot-red') + ' 關閉'}</span></div>
      <div class="status-item"><span>投票狀態</span><span>${votingLabel}</span></div>
    `;
  }

  if (DOM.adminRecentActivity) {
    const recent = state.monitorMessages.slice(0, 5);
    DOM.adminRecentActivity.innerHTML = recent.length === 0
      ? '<p class="form-hint">暫無最近活動</p>'
      : recent.map(m => `
        <div class="activity-item">
          <span>${escapeHtml(m.sender_id)} → ${escapeHtml(m.receiver_id)}</span>
          <time>${formatDateTime(m.created_at)}</time>
        </div>
      `).join('');
  }

  if (DOM.adminVersion) DOM.adminVersion.textContent = 'Firestore';
  if (DOM.adminParticipantCount) DOM.adminParticipantCount.textContent = String(state.participants.length || '—');
  renderAdminLoginStatus();
}

function handleLogout() {
  const leavingId = state.participantId;
  const wasAdmin = state.isAdmin;
  stopAllSubscriptions();
  if (leavingId && !wasAdmin) {
    data.markPresenceOffline(leavingId).catch(() => { /* best-effort */ });
  }
  data.signOutUser().catch(() => { /* the local session is gone either way */ });
  clearSession();
  state.participantId = null;
  state.isAdmin = false;
  state.inboxMessages = [];
  state.sentMessages = [];
  state.monitorMessages = [];
  state.presence = [];
  state.adminTrophy.matrixModal = null;
  state.knownMessageIds = new Set();
  state.adminMessagesBootstrapped = false;
  state.adminMsgScrollPaused = false;
  state.adminMsgPendingRender = false;
  clearTimeout(state.adminMsgScrollIdleTimer);
  state.adminMsgScrollIdleTimer = null;
  state.monitorViewFilter = 'all';
  state.monitorGroupFilter = '';
  hideTrophyResultsModal();
  state.trophy = {
    loaded: false,
    loading: false,
    votingStatus: 'DRAFT',
    trophies: [],
    teammates: [],
    assignments: {},
    readonly: false,
    editable: false,
    submissionStatus: 'draft',
    progress: { assigned: 0, total: 0 },
    myAwards: [],
    showResults: false,
    trophyRevision: '',
    resultsModalRevision: ''
  };
  DOM.loginParticipant.value = '';
  DOM.loginPhone.value = '';
  setLoginNativeNumpad(false);
  showScreen('login');
  updateLoginStatusBanner();
  bootstrapApp();
}

// ─── Messaging — Send ─────────────────────────────────────────────────────────

function updateSendFormState() {
  const closed = !state.messagingOpen;
  if (DOM.sendClosedBanner) {
    DOM.sendClosedBanner.textContent = '留言功能目前已關閉，請稍後再試';
    DOM.sendClosedBanner.classList.toggle('hidden', !closed);
  }
  if (DOM.sendClosedState) DOM.sendClosedState.classList.toggle('hidden', !closed);
  if (DOM.sendForm) {
    DOM.sendForm.classList.toggle('hidden', closed);
    DOM.sendForm.classList.toggle('disabled', closed);
  }
  if (DOM.sendSubmit) DOM.sendSubmit.disabled = closed;
}

function updateCharCounter() {
  const len = DOM.sendContent.value.length;
  DOM.charCounter.textContent = len + '/' + CONFIG.MAX_MESSAGE_LENGTH;
  DOM.charCounter.classList.toggle('warn', len >= CONFIG.CHAR_WARN_THRESHOLD && len <= CONFIG.MAX_MESSAGE_LENGTH);
  DOM.charCounter.classList.toggle('over', len > CONFIG.MAX_MESSAGE_LENGTH);

  const hasBad = containsBadWords(DOM.sendContent.value);
  DOM.badWordsWarning.classList.toggle('hidden', !hasBad);
  const empty = !DOM.sendContent.value.trim();
  DOM.sendSubmit.disabled = hasBad || !state.messagingOpen || empty;
}

async function handleSendMessage(e) {
  e.preventDefault();
  if (!state.messagingOpen) {
    showToast('留言功能目前已關閉', 'error');
    return;
  }

  const receiverId = selectedReceiverId || normalizeId(DOM.sendReceiver.value);
  const content = DOM.sendContent.value.trim();

  if (!receiverId) { showToast('請選擇接收者', 'error'); return; }
  if (!content) { showToast('請輸入留言內容', 'error'); return; }
  if (containsBadWords(content)) { showToast('內容包含不適當用語', 'error'); return; }

  DOM.sendContent.value = '';
  DOM.sendReceiver.value = '';
  selectedReceiverId = null;
  updateCharCounter();
  switchParticipantView('sent');

  // The write lands in the local cache first, so the listener has already put
  // the message on screen by the time this returns. If the network is down the
  // SDK holds the write and sends it on reconnect, which is why there is no
  // spinner and no retry button any more.
  data.sendMessage(state.participantId, receiverId, content).catch(err => {
    showToast('留言傳送失敗：' + err.message, 'error');
  });
  showToast('留言已發送', 'success');
}

// ─── Messaging — Inbox ────────────────────────────────────────────────────────

function renderInbox() {
  const messages = state.inboxMessages;
  const readIds = new Set(getReadMessageIds(state.participantId));
  DOM.inboxEmpty.classList.toggle('hidden', messages.length > 0);
  DOM.inboxList.innerHTML = '';

  messages.forEach(msg => {
    const isUnread = !readIds.has(msg.message_id);
    const card = document.createElement('div');
    card.className = 'message-card' + (isUnread ? ' unread' : '');
    card.innerHTML = `
      <div class="message-meta">
        <span class="message-anon-badge">${appIcon('lock')} 匿名留言</span>
        <div style="display:flex;align-items:center;gap:6px">
          ${isUnread ? '<span class="unread-dot" aria-label="未讀"></span>' : ''}
          <time datetime="${escapeHtml(msg.created_at)}">${formatDateTime(msg.created_at)}</time>
        </div>
      </div>
      <div class="message-content">${escapeHtml(msg.content)}</div>
    `;
    card.addEventListener('click', () => {
      if (isUnread) {
        const ids = getReadMessageIds(state.participantId);
        if (!ids.includes(msg.message_id)) {
          ids.push(msg.message_id);
          saveReadMessageIds(state.participantId, ids);
        }
        card.classList.remove('unread');
        card.classList.add('read-animation');
        card.querySelector('.unread-dot')?.remove();
        updateInboxBadge();
      }
    });
    DOM.inboxList.appendChild(card);
  });

  updateInboxBadge();
}

/**
 * A live listener already keeps this current. The button stays because people
 * expect one, and pressing it should visibly confirm that nothing is missing.
 */
async function refreshInbox() {
  await runProgressButton(DOM.inboxRefresh, (async () => {
    renderInbox();
    showToast('收件箱已是最新', 'success');
  })());
}

// ─── Messaging — Sent ─────────────────────────────────────────────────────────

function sentStatusBadge(msg, isDeleted) {
  if (isDeleted) return '';
  if (msg.pending) {
    return '<span class="badge badge-pending" style="margin-top:8px">傳送中…</span>';
  }
  return '<span class="badge badge-pill" style="margin-top:8px">正常</span>';
}

function renderSent() {
  const messages = state.sentMessages;
  DOM.sentEmpty.classList.toggle('hidden', messages.length > 0);
  DOM.sentList.innerHTML = '';

  messages.forEach(msg => {
    const isDeleted = msg.status === 'deleted';
    const card = document.createElement('div');
    card.className = 'message-card' +
      (isDeleted ? ' deleted' : '') +
      (msg.pending ? ' message-pending' : '');
    card.dataset.messageId = msg.message_id;

    let deletedHtml = '';
    if (isDeleted) {
      deletedHtml = `
        <div class="message-deleted-info">
          <span class="badge badge-deleted">管理員已撤回</span>
          ${msg.deleted_reason ? '<br>' + escapeHtml(msg.deleted_reason) : ''}
          ${msg.deleted_at ? '<br><time>' + formatDateTime(msg.deleted_at) + '</time>' : ''}
        </div>
      `;
    }

    card.innerHTML = `
      <div class="message-meta">
        <span class="message-receiver">→ ${escapeHtml(msg.receiver_id)}</span>
        <time datetime="${escapeHtml(msg.created_at)}">${formatDateTime(msg.created_at)}</time>
      </div>
      <div class="message-content">${escapeHtml(msg.content)}</div>
      ${sentStatusBadge(msg, isDeleted)}
      ${deletedHtml}
    `;
    DOM.sentList.appendChild(card);
  });
}

async function refreshSent() {
  await runProgressButton(DOM.sentRefresh, (async () => {
    renderSent();
    showToast('已發送列表已是最新', 'success');
  })());
}

// ─── Admin Monitor ────────────────────────────────────────────────────────────

function isAdminMessagesTabActive() {
  return !!DOM.adminMessagesPanel && !DOM.adminMessagesPanel.classList.contains('hidden');
}

function setMonitorViewFilter(filter) {
  state.monitorViewFilter = filter;
  document.querySelectorAll('.chip-filter').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });
}

function getParticipantGroupMap() {
  const map = new Map();
  state.participants.forEach(p => {
    map.set(String(p.participant_id || '').toUpperCase(), p.group_id || '未分組');
  });
  return map;
}

function populateAdminMsgGroupFilter() {
  const select = DOM.adminMsgGroupFilter;
  if (!select) return;
  const groups = [...new Set(state.participants.map(p => p.group_id || '未分組'))]
    .sort(compareGroupLabels);
  const signature = groups.join('\0');
  if (select.dataset.groupsSignature === signature) {
    // Keep the user's current choice without rebuilding the <select>.
    state.monitorGroupFilter = select.value || '';
    return;
  }
  select.dataset.groupsSignature = signature;
  const prev = state.monitorGroupFilter || select.value || '';
  select.innerHTML = '<option value="">全部組別</option>' + groups.map(g =>
    `<option value="${escapeHtml(g)}">${escapeHtml(formatGroupLabel(g))}</option>`
  ).join('');
  select.value = groups.includes(prev) ? prev : '';
  state.monitorGroupFilter = select.value;
}

function updateAdminMessagePauseUi() {
  if (DOM.adminLiveBadge) {
    if (state.adminMsgScrollPaused) {
      DOM.adminLiveBadge.classList.add('badge-paused');
      DOM.adminLiveBadge.innerHTML = '<span class="live-dot"></span> 暫停';
    } else {
      DOM.adminLiveBadge.classList.remove('badge-paused');
      DOM.adminLiveBadge.innerHTML = '<span class="live-dot"></span> 即時';
    }
  }
  if (DOM.adminSyncTime) {
    if (state.adminMsgScrollPaused) {
      DOM.adminSyncTime.textContent = state.adminMsgPendingRender
        ? '滾動暫停中：有新留言，停 3 秒或撤回後繼續'
        : '滾動暫停中：停 3 秒或撤回後繼續更新';
    } else {
      DOM.adminSyncTime.textContent = '上次同步：' + formatDateTime(new Date().toISOString());
    }
  }
}

/** True when the message list is scrolled away from the top. */
function isAdminMessageListScrolled() {
  return !!(DOM.adminMain && DOM.adminMain.scrollTop > 12);
}

function pauseAdminMessageRender() {
  if (!isAdminMessagesTabActive()) return;
  state.adminMsgScrollPaused = true;
  updateAdminMessagePauseUi();
  clearTimeout(state.adminMsgScrollIdleTimer);
  state.adminMsgScrollIdleTimer = setTimeout(() => {
    // Only resume if they are still idle near the same spot for 3s; if they
    // scrolled again the timer was already reset.
    resumeAdminMessageRender();
  }, CONFIG.ADMIN_MSG_SCROLL_RESUME_MS);
}

/**
 * Hold live list rebuilds while the admin is mid-scroll OR has scrolled away
 * from the top (so a missed scroll event cannot yank the list under their finger).
 */
function shouldHoldAdminMessageRender() {
  if (!isAdminMessagesTabActive()) return false;
  if (state.adminMsgScrollPaused) return true;
  if (isAdminMessageListScrolled()) {
    pauseAdminMessageRender();
    return true;
  }
  return false;
}

function resumeAdminMessageRender() {
  clearTimeout(state.adminMsgScrollIdleTimer);
  state.adminMsgScrollIdleTimer = null;
  const wasPaused = state.adminMsgScrollPaused;
  const hadPending = state.adminMsgPendingRender;
  state.adminMsgScrollPaused = false;
  state.adminMsgPendingRender = false;
  updateAdminMessagePauseUi();
  if (wasPaused && hadPending && isAdminMessagesTabActive()) {
    renderAdminMessages();
  }
}

function clearAdminMessagePause({ render = false } = {}) {
  clearTimeout(state.adminMsgScrollIdleTimer);
  state.adminMsgScrollIdleTimer = null;
  state.adminMsgScrollPaused = false;
  state.adminMsgPendingRender = false;
  updateAdminMessagePauseUi();
  if (render && isAdminMessagesTabActive()) renderAdminMessages();
}

function initAdminMessageScrollPause() {
  if (!DOM.adminMain || DOM.adminMain.dataset.scrollPauseBound === '1') return;
  DOM.adminMain.dataset.scrollPauseBound = '1';
  const onInteract = () => {
    if (!state.isAdmin || !isAdminMessagesTabActive()) return;
    pauseAdminMessageRender();
  };
  DOM.adminMain.addEventListener('scroll', onInteract, { passive: true });
  // Mobile browsers sometimes deliver touch / wheel before scrollTop updates.
  DOM.adminMain.addEventListener('touchmove', onInteract, { passive: true });
  DOM.adminMain.addEventListener('wheel', onInteract, { passive: true });
}

function getFilteredAdminMessages() {
  const filter = state.monitorViewFilter;
  const search = (DOM.adminMsgSearch?.value || '').trim().toUpperCase();
  let messages = state.monitorMessages;
  if (filter === 'active') messages = messages.filter(m => m.status === 'active');
  else if (filter === 'deleted') messages = messages.filter(m => m.status === 'deleted');

  if (state.monitorGroupFilter) {
    const groupMap = getParticipantGroupMap();
    const target = state.monitorGroupFilter;
    messages = messages.filter(m => {
      const sg = groupMap.get(String(m.sender_id || '').toUpperCase());
      const rg = groupMap.get(String(m.receiver_id || '').toUpperCase());
      return sg === target || rg === target;
    });
  }

  if (search) {
    messages = messages.filter(m =>
      m.sender_id.toUpperCase().includes(search) ||
      m.receiver_id.toUpperCase().includes(search) ||
      m.content.toUpperCase().includes(search)
    );
  }
  return messages;
}

function renderAdminMessages() {
  populateAdminMsgGroupFilter();
  const messages = getFilteredAdminMessages();
  const scrollTop = DOM.adminMain ? DOM.adminMain.scrollTop : 0;
  DOM.adminMsgEmpty.classList.toggle('hidden', messages.length > 0);
  const shown = messages.length;
  const total = state.monitorMessages.length;
  DOM.adminMsgCount.textContent = shown === total
    ? '共 ' + total + ' 則'
    : '顯示 ' + shown + ' / ' + total + ' 則';
  updateAdminMessagePauseUi();

  DOM.adminMessageList.innerHTML = '';

  messages.forEach(msg => {
    const isDeleted = msg.status === 'deleted';
    const isNew = !state.knownMessageIds.has(msg.message_id);
    const card = document.createElement('div');
    card.className = 'admin-msg-card' +
      (isDeleted ? ' deleted' : '') +
      (isNew ? ' new-highlight' : '');

    let deleteBtn = '';
    if (!isDeleted) {
      deleteBtn = `<button type="button" class="btn btn-danger btn-sm admin-delete-btn" data-id="${escapeHtml(msg.message_id)}">撤回</button>`;
    } else {
      deleteBtn = `<button type="button" class="btn btn-secondary btn-sm admin-restore-btn" data-id="${escapeHtml(msg.message_id)}">取消撤回</button>`;
    }

    card.innerHTML = `
      <div class="admin-msg-header">
        <time datetime="${escapeHtml(msg.created_at || '')}">${formatMessageTime(msg.created_at)}</time>
        <span class="admin-msg-route">${escapeHtml(msg.sender_id)}<span class="arrow">→</span>${escapeHtml(msg.receiver_id)}</span>
        ${isDeleted ? '<span class="badge badge-deleted">已撤回</span>' : ''}
      </div>
      <div class="admin-msg-body">
        <div class="admin-msg-content">${escapeHtml(msg.content)}</div>
        <div class="admin-msg-action">${deleteBtn}</div>
      </div>
    `;
    DOM.adminMessageList.appendChild(card);
    state.knownMessageIds.add(msg.message_id);
  });

  DOM.adminMessageList.querySelectorAll('.admin-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => handleAdminDelete(btn.dataset.id, btn));
  });
  DOM.adminMessageList.querySelectorAll('.admin-restore-btn').forEach(btn => {
    btn.addEventListener('click', () => handleAdminRestore(btn.dataset.id, btn));
  });

  // Keep the admin's place if we rendered while they were mid-list (e.g. after 撤回).
  if (DOM.adminMain && scrollTop > 0) {
    DOM.adminMain.scrollTop = scrollTop;
  }
}

/**
 * There is no queue to report any more, so this panel now answers the question
 * the admin actually has during the event: is anything happening right now.
 */
function renderAdminLiveLoad() {
  const recentCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const recent = state.monitorMessages.filter(
    m => m.status === 'active' && m.created_at > recentCutoff
  ).length;
  const voted = state.adminTrophy.submissions.filter(s => s.status === 'submitted').length;
  const onlineCutoff = Date.now() - CONFIG.PRESENCE_ONLINE_MS;
  const online = state.presence.filter(p => {
    if (!p.last_seen) return false;
    return new Date(p.last_seen).getTime() >= onlineCutoff && p.online !== false;
  }).length;
  const loggedIn = state.presence.filter(p => !!p.first_seen).length;

  if (DOM.adminQueuePill) {
    DOM.adminQueuePill.textContent = '在線 ' + online;
    DOM.adminQueuePill.classList.toggle('hidden', online === 0);
    DOM.adminQueuePill.classList.toggle('badge-queue-busy', online > 30);
  }

  if (DOM.adminLiveLoad) {
    DOM.adminLiveLoad.innerHTML = `
      <div class="stat-card"><div class="stat-value">${loggedIn}/${state.participants.length}</div><div class="stat-label">已登入</div></div>
      <div class="stat-card"><div class="stat-value">${online}</div><div class="stat-label">現正線上</div></div>
      <div class="stat-card"><div class="stat-value">${voted}/${state.participants.length}</div><div class="stat-label">已完成投票</div></div>
      <div class="stat-card"><div class="stat-value">${recent}</div><div class="stat-label">近 5 分鐘留言</div></div>
    `;
  }
}

async function handleAdminDelete(messageId, btn) {
  if (!window.confirm('確定要撤回此留言嗎？接收者將不會收到此訊息。')) return;

  await runProgressButton(btn, (async () => {
    try {
      await data.retractMessage(messageId);
      const msg = state.monitorMessages.find(m => m.message_id === messageId);
      if (msg) {
        msg.status = 'deleted';
        msg.deleted_at = new Date().toISOString();
      }
      // Jump to the withdrawn list so the admin can confirm the action, and
      // resume live updates immediately (scroll pause is done).
      setMonitorViewFilter('deleted');
      clearAdminMessagePause({ render: true });
      showToast('留言已撤回', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  })());
}

async function handleAdminRestore(messageId, btn) {
  if (!window.confirm('確定要取消撤回？留言會重新出現喺接收者收件箱。')) return;

  await runProgressButton(btn, (async () => {
    try {
      await data.restoreMessage(messageId);
      const msg = state.monitorMessages.find(m => m.message_id === messageId);
      if (msg) {
        msg.status = 'active';
        msg.deleted_at = '';
      }
      setMonitorViewFilter('active');
      clearAdminMessagePause({ render: true });
      showToast('已取消撤回，留言已恢復', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  })());
}

async function handleSetMessagingStatus(status, btn) {
  await runProgressButton(btn, (async () => {
    try {
      await data.setMessagingStatus(status);
      showToast(status === 'OPEN' ? '留言功能已開啟' : '留言功能已關閉', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  })());
}

// ─── 獎項 (Participant) ─────────────────────────────────────────────────────

const VOTING_STATUS_LABELS = {
  DRAFT: '投票尚未開始',
  VOTING_OPEN: '投票進行中',
  VOTING_CLOSED: '投票已關閉',
  CALCULATED: '結果已計算',
  PUBLISHED: '結果已公布'
};

function filterValidTrophies(trophies) {
  return (trophies || []).filter(t => /^T\d+$/i.test(String(t.trophy_id || '').trim()));
}

function buildAwardsHtml(awards) {
  if (!awards || awards.length === 0) {
    return '<p class="trophy-results-empty">暫未獲得獎項，請稍後再查看</p>';
  }
  return awards.map(a => `
    <div class="trophy-result-item">
      <div class="trophy-result-name">${escapeHtml(a.trophy_name)}</div>
    </div>
  `).join('');
}

function showTrophyResultsModal(awards) {
  if (!DOM.trophyResultsModal) return;
  DOM.trophyResultsModalList.innerHTML = buildAwardsHtml(awards);
  DOM.trophyResultsModal.classList.remove('hidden');
  document.body.classList.add('modal-open');
  state.trophy.resultsModalRevision = state.trophy.trophyRevision;
  launchConfetti();
}

function hideTrophyResultsModal() {
  if (!DOM.trophyResultsModal) return;
  DOM.trophyResultsModal.classList.add('hidden');
  document.body.classList.remove('modal-open');
}

function maybeShowPublishedModal(isNewPublish) {
  if (state.trophy.votingStatus !== 'PUBLISHED') return;
  if (state.trophy.resultsModalRevision === state.trophy.trophyRevision) return;
  showTrophyResultsModal(state.trophy.myAwards);
  if (isNewPublish) {
    showToast('獎項結果已公布！', 'success');
    updateTrophyTabBadge(true);
  }
}

function updateTrophyTabBadge(show) {
  const trophyNav = document.querySelector('.bottom-nav-item[data-tab="trophy"]');
  if (!trophyNav) return;
  let badge = trophyNav.querySelector('.bottom-nav-badge-results');
  if (show && state.trophy.votingStatus === 'PUBLISHED') {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'bottom-nav-badge bottom-nav-badge-results';
      badge.textContent = '!';
      badge.title = '結果已公布';
      trophyNav.appendChild(badge);
    }
  } else if (badge) {
    badge.remove();
  }
}

function renderParticipantTrophyResults() {
  const { votingStatus, myAwards } = state.trophy;
  const isPublished = votingStatus === 'PUBLISHED';

  DOM.trophyResultsPanel.classList.toggle('hidden', !isPublished);
  if (isPublished) {
    DOM.trophyResultsTitle.textContent = '你的獎項結果';
    DOM.trophyResultsList.innerHTML = buildAwardsHtml(myAwards);
    DOM.trophyResultsPanel.classList.add('trophy-results-live');
  } else {
    DOM.trophyResultsPanel.classList.remove('trophy-results-live');
  }

  // Voting-section visibility belongs to updateTrophyStatusBanner; flipping it
  // here undid "closed" / "submitted" hides and left a disabled form on screen.
  updateTrophyTabBadge(isPublished);
}

const TROPHY_IDLE_COPY = {
  DRAFT: {
    title: '投票尚未開始',
    body: '管理員開放投票後，你可以為隊友配對獎項'
  }
};

function notifyVotingStatusChange(status) {
  const messages = {
    VOTING_OPEN: '投票已開放，可以開始配對獎項',
    VOTING_CLOSED: '投票已關閉；你仍可查看自己投咗咩',
    CALCULATED: '結果已計算，即將公布',
    PUBLISHED: '獎項結果已公布！',
    DRAFT: '投票已重設為尚未開始'
  };
  const text = messages[status];
  if (!text) return;
  showToast(text, status === 'PUBLISHED' || status === 'VOTING_OPEN' ? 'success' : 'info');
  if (status === 'PUBLISHED' || status === 'VOTING_CLOSED') {
    updateTrophyTabBadge(status === 'PUBLISHED');
  }
}

function updateTrophyStatusBanner() {
  const status = state.trophy.votingStatus;
  const label = VOTING_STATUS_LABELS[status] || status;
  const isDraft = status === 'DRAFT';
  const isPublished = status === 'PUBLISHED';
  // Once voting has started, keep the ballot visible (readonly when locked)
  // so participants can always review what they cast.
  const showVoting = !isDraft;
  const idle = TROPHY_IDLE_COPY[status];
  const showIdle = isDraft && !!idle;

  if (DOM.trophyNotOpen) {
    DOM.trophyNotOpen.classList.toggle('hidden', !showIdle);
    if (showIdle) {
      const title = DOM.trophyNotOpen.querySelector('h3');
      const body = DOM.trophyNotOpen.querySelector('p');
      if (title) title.textContent = idle.title;
      if (body) body.textContent = idle.body;
    }
  }
  if (DOM.trophyVotingSection) {
    DOM.trophyVotingSection.classList.toggle('hidden', !showVoting);
    DOM.trophyVotingSection.classList.toggle('is-readonly', showVoting && !state.trophy.editable);
  }
  if (DOM.trophyActions) {
    DOM.trophyActions.classList.toggle(
      'hidden',
      !state.trophy.editable || state.trophy.teammates.length === 0
    );
  }

  if (DOM.trophyStatusBanner) {
    DOM.trophyStatusBanner.textContent = label;
    DOM.trophyStatusBanner.className = 'status-banner';
    if (status === 'VOTING_OPEN') DOM.trophyStatusBanner.classList.add('status-banner-success');
    else if (status === 'VOTING_CLOSED' || status === 'CALCULATED') DOM.trophyStatusBanner.classList.add('status-banner-warning');
    else if (status === 'PUBLISHED') DOM.trophyStatusBanner.classList.add('status-banner-success');
    DOM.trophyStatusBanner.classList.toggle('hidden', isDraft);
  }
}

function updateTrophyProgress() {
  const { assigned, total } = state.trophy.progress;
  DOM.trophyProgressText.textContent = assigned + '/' + total;
  const pct = total > 0 ? Math.round((assigned / total) * 100) : 0;
  DOM.trophyProgressFill.style.width = pct + '%';
  const bar = DOM.trophyProgressFill.parentElement;
  bar.setAttribute('aria-valuenow', pct);
}

function recalcTrophyProgress() {
  const teammates = state.trophy.teammates;
  let assigned = 0;
  teammates.forEach(t => {
    const ids = state.trophy.assignments[t.participant_id];
    if (ids && ids.length > 0) assigned++;
  });
  state.trophy.progress = { assigned, total: teammates.length };
  updateTrophyProgress();
}

/** Each trophy may be paired to at most one teammate. */
function findTrophyHolder(trophyId, exceptTeammateId) {
  const assignments = state.trophy.assignments || {};
  for (const [receiverId, ids] of Object.entries(assignments)) {
    if (exceptTeammateId && receiverId === exceptTeammateId) continue;
    if ((ids || []).includes(trophyId)) return receiverId;
  }
  return null;
}

function enforceUniqueTrophyAssignments(assignments) {
  const cleaned = {};
  const seen = new Set();
  Object.keys(assignments || {}).sort().forEach(receiverId => {
    cleaned[receiverId] = [];
    (assignments[receiverId] || []).forEach(trophyId => {
      if (!trophyId || seen.has(trophyId)) return;
      seen.add(trophyId);
      cleaned[receiverId].push(trophyId);
    });
  });
  return cleaned;
}

function trophyNameById(trophyId) {
  const trophy = (state.trophy.trophies || []).find(t => t.trophy_id === trophyId);
  return trophy ? trophy.trophy_name : trophyId;
}

function toggleTrophyAssignment(teammateId, trophyId) {
  if (!state.trophy.editable) return;
  const assignments = state.trophy.assignments;
  if (!assignments[teammateId]) assignments[teammateId] = [];

  const idx = assignments[teammateId].indexOf(trophyId);
  if (idx >= 0) {
    assignments[teammateId].splice(idx, 1);
  } else {
    const holder = findTrophyHolder(trophyId, teammateId);
    if (holder) {
      showToast(
        '「' + trophyNameById(trophyId) + '」已配對畀 ' + holder + '，請先取消再改',
        'error'
      );
      return;
    }
    assignments[teammateId].push(trophyId);
  }
  recalcTrophyProgress();
  renderTrophyTeammates();
}

function renderTrophyTeammates() {
  const { teammates, trophies, assignments, editable } = state.trophy;
  const validTrophies = filterValidTrophies(trophies);
  DOM.trophyEmpty.classList.toggle('hidden', teammates.length > 0);
  DOM.trophyActions.classList.toggle('hidden', teammates.length === 0 || !state.trophy.editable);
  DOM.trophyTeammates.innerHTML = '';

  teammates.forEach(teammate => {
    const tid = teammate.participant_id;
    const selected = assignments[tid] || [];
    const card = document.createElement('div');
    card.className = 'trophy-card';

    const chips = validTrophies.map(trophy => {
      const isSelected = selected.includes(trophy.trophy_id);
      const holder = findTrophyHolder(trophy.trophy_id, tid);
      const isTaken = !!holder && !isSelected;
      const classes = 'trophy-chip'
        + (isSelected ? ' selected' : '')
        + (isTaken ? ' taken' : '');
      const disabled = !editable || isTaken;
      const title = isTaken
        ? ('已配對畀 ' + holder)
        : escapeHtml(trophy.trophy_name);
      return `<button type="button" class="${classes}"
        data-teammate="${escapeHtml(tid)}" data-trophy="${escapeHtml(trophy.trophy_id)}"
        title="${title}"
        ${disabled ? 'disabled' : ''}>${escapeHtml(trophy.trophy_name)}</button>`;
    }).join('');

    const initials = tid.slice(0, 2);
    // Short seat ids (e.g. 1B) match the avatar text — don't print them twice.
    const nameLabel = tid.length > 2
      ? escapeHtml(tid)
      : '';
    card.innerHTML = `
      <div class="trophy-card-header">
        <div class="trophy-card-name">
          <span class="trophy-card-avatar">${escapeHtml(initials)}</span>
          ${nameLabel}
        </div>
        ${selected.length > 0 ? `<span class="assigned-count">${selected.length} 個獎項</span>` : ''}
      </div>
      <div class="trophy-chips">${chips}</div>
    `;
    DOM.trophyTeammates.appendChild(card);
  });

  DOM.trophyTeammates.querySelectorAll('.trophy-chip:not(:disabled)').forEach(chip => {
    chip.addEventListener('click', () => {
      toggleTrophyAssignment(chip.dataset.teammate, chip.dataset.trophy);
    });
  });
}

async function handleTrophySaveDraft() {
  const pairings = buildPairingsFromAssignments(state.trophy.assignments);
  await runProgressButton(DOM.trophySaveDraft, (async () => {
    try {
      await data.saveSubmission(state.participantId, pairings, false);
      showToast('草稿已儲存', 'success');
    } catch (err) {
      showToast('草稿儲存失敗：' + err.message, 'error');
    }
  })());
}

async function handleTrophySubmitAll() {
  const teammates = state.trophy.teammates;
  const trophies = filterValidTrophies(state.trophy.trophies);

  if (trophies.length < teammates.length) {
    showToast('獎項數量少於隊友人數，無法為每位隊友各配至少一個', 'error');
    return;
  }

  const incomplete = teammates.filter(t => {
    const ids = state.trophy.assignments[t.participant_id];
    return !ids || ids.length === 0;
  });

  if (incomplete.length > 0) {
    showToast('請為每位隊友至少配對一個獎項', 'error');
    return;
  }

  const used = new Set();
  for (const ids of Object.values(state.trophy.assignments)) {
    for (const trophyId of ids || []) {
      if (used.has(trophyId)) {
        showToast('每個獎項只能配對一位隊友', 'error');
        return;
      }
      used.add(trophyId);
    }
  }

  const pairings = buildPairingsFromAssignments(state.trophy.assignments);
  await runProgressButton(DOM.trophySubmitAll, (async () => {
    try {
      await data.saveSubmission(state.participantId, pairings, true);
      switchParticipantView('trophy-submitted');
      showToast('投票已提交', 'success');
    } catch (err) {
      showToast('投票提交失敗，請再試一次：' + err.message, 'error');
      switchParticipantView('trophy');
    }
  })());
}

// ─── 獎項 (Admin) ───────────────────────────────────────────────────────────


function renderAdminTrophyStats() {
  const stats = state.adminTrophy.overview?.stats || {};
  const votingStatus = state.adminTrophy.overview?.voting_status || 'DRAFT';
  DOM.adminTrophyStats.innerHTML = `
    <div class="stat-card"><div class="stat-value">${stats.completed_voters || 0}/${stats.total_participants || 0}</div><div class="stat-label">已完成投票</div></div>
    <div class="stat-card"><div class="stat-value">${stats.total_votes || 0}</div><div class="stat-label">總投票數</div></div>
    <div class="stat-card"><div class="stat-value">${stats.trophy_count || 0}</div><div class="stat-label">獎項種類</div></div>
    <div class="stat-card"><div class="stat-value">${VOTING_STATUS_LABELS[votingStatus] || votingStatus}</div><div class="stat-label">投票狀態</div></div>
  `;
}

/**
 * Shared group cards used by voting progress and login status on the dashboard.
 * doneKey marks members who are "complete" (voted / logged in).
 * Member lists stay always expanded; when voteMatrix is true (voting panel),
 * heading / member taps open a popup matrix card.
 */
function renderGroupStatusCards(options) {
  const {
    container,
    title,
    groups,
    doneKey,
    doneLabel,
    pendingLabel,
    emptyAllDone,
    emptyPendingTitle,
    voteMatrix = false
  } = options;

  if (!container) return;

  const pending = [];
  groups.forEach(g => {
    g.members.forEach(m => {
      if (!m[doneKey]) pending.push(m.participant_id);
    });
  });

  if (groups.length === 0) {
    container.innerHTML = pending.length === 0
      ? `<p>${emptyAllDone}</p>`
      : `<h4>${emptyPendingTitle}（${pending.length} 人）</h4><ul>${pending.map(p => '<li>' + escapeHtml(p) + '</li>').join('')}</ul>`;
    return;
  }

  const modal = voteMatrix ? state.adminTrophy.matrixModal : null;

  const cards = groups.map(group => {
    const doneCount = group.members.filter(m => m[doneKey]).length;
    const label = group.group_label;
    const heading = group.display_label || formatGroupLabel(label);
    const isStaff = /STAFF/i.test(label);
    const focusId = modal && modal.groupLabel === label ? modal.focusId : null;

    const membersHtml = group.members.map(m => {
      const classes = `voter-member ${m[doneKey] ? 'voter-done' : 'voter-pending'}${focusId === m.participant_id ? ' is-focus' : ''}`;
      const inner = `
        <span class="voter-check ${m[doneKey] ? 'app-icon app-icon-check' : 'voter-check-empty'}" aria-hidden="true">${m[doneKey] ? '' : '○'}</span>
        <span class="voter-id">${escapeHtml(m.participant_id)}</span>
        <span class="voter-status-label">${m[doneKey] ? doneLabel : pendingLabel}</span>
      `;
      if (!voteMatrix) {
        return `<div class="${classes}">${inner}</div>`;
      }
      return `<button type="button" class="${classes}" data-member-id="${escapeHtml(m.participant_id)}" title="睇獨立選票">${inner}</button>`;
    }).join('');

    const header = voteMatrix
      ? `<button type="button" class="group-voter-header" title="睇組別投票總覽">
          <h4>${escapeHtml(heading)}</h4>
          <span class="group-voter-count">${doneCount}/${group.members.length}</span>
        </button>`
      : `<div class="group-voter-header">
          <h4>${escapeHtml(heading)}</h4>
          <span class="group-voter-count">${doneCount}/${group.members.length}</span>
        </div>`;

    return `
      <div class="group-voter-card${isStaff ? ' is-staff' : ''}" data-group="${escapeHtml(label)}">
        ${header}
        <div class="group-voter-body">
          <div class="group-voter-members">${membersHtml}</div>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <h4 class="admin-pending-title">${title}${pending.length > 0 ? ` · 尚餘 ${pending.length} 人` : ''}</h4>
    <div class="group-voter-grid">${cards}</div>
  `;

  if (voteMatrix) {
    container.querySelectorAll('.group-voter-header').forEach(btn => {
      btn.addEventListener('click', () => {
        const groupLabel = btn.closest('.group-voter-card')?.dataset.group;
        if (!groupLabel) return;
        openVoteMatrixModal(groupLabel, null);
      });
    });

    container.querySelectorAll('.voter-member[data-member-id]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const groupLabel = btn.closest('.group-voter-card')?.dataset.group;
        if (!groupLabel) return;
        openVoteMatrixModal(groupLabel, btn.dataset.memberId);
      });
    });
  }
}

function findAdminVotingGroup(groupLabel) {
  const groups = state.adminTrophy.overview?.group_voting_status || [];
  return groups.find(g => g.group_label === groupLabel) || null;
}

function openVoteMatrixModal(groupLabel, focusId) {
  state.adminTrophy.matrixModal = {
    groupLabel,
    focusId: focusId || null
  };
  renderVoteMatrixModal();
  // Sync focus highlight on member chips without rebuilding the whole grid.
  if (DOM.adminPendingVoters) {
    DOM.adminPendingVoters.querySelectorAll('.voter-member[data-member-id]').forEach(btn => {
      const card = btn.closest('.group-voter-card');
      const on = card?.dataset.group === groupLabel && btn.dataset.memberId === focusId;
      btn.classList.toggle('is-focus', !!on);
    });
  }
}

function closeVoteMatrixModal() {
  state.adminTrophy.matrixModal = null;
  if (DOM.voteMatrixModal) {
    DOM.voteMatrixModal.classList.add('hidden');
  }
  document.body.classList.remove('modal-open');
  if (DOM.adminPendingVoters) {
    DOM.adminPendingVoters.querySelectorAll('.voter-member.is-focus').forEach(btn => {
      btn.classList.remove('is-focus');
    });
  }
}

function renderVoteMatrixModal() {
  const modal = state.adminTrophy.matrixModal;
  if (!modal || !DOM.voteMatrixModal) return;

  const group = findAdminVotingGroup(modal.groupLabel);
  if (!group) {
    closeVoteMatrixModal();
    return;
  }

  const heading = group.display_label || formatGroupLabel(group.group_label);
  const focusId = modal.focusId;

  if (DOM.voteMatrixModalTitle) {
    DOM.voteMatrixModalTitle.textContent = focusId
      ? heading + ' · ' + focusId
      : heading + ' · 投票總覽';
  }
  if (DOM.voteMatrixModalSubtitle) {
    DOM.voteMatrixModalSubtitle.textContent = focusId
      ? '列／欄＝參加者，格內＝獎項（邊個投邊個）'
      : '列＝獎項，欄＝參加者，格內＝獲提名次數';
  }
  if (DOM.voteMatrixModalToolbar) {
    DOM.voteMatrixModalToolbar.classList.toggle('hidden', !focusId);
  }
  if (DOM.voteMatrixModalBody) {
    DOM.voteMatrixModalBody.innerHTML = focusId
      ? buildGroupBallotMatrixHtml(group, focusId)
      : buildGroupNominationMatrixHtml(group);

    DOM.voteMatrixModalBody.querySelectorAll('.matrix-person-btn[data-member-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        openVoteMatrixModal(modal.groupLabel, btn.dataset.memberId);
      });
    });
  }

  DOM.voteMatrixModal.classList.remove('hidden');
  document.body.classList.add('modal-open');
}

/** How many submitted/draft nominations each member received per trophy. */
function buildNominationCountMap(memberIds) {
  const members = new Set(memberIds);
  const counts = new Map();
  state.adminTrophy.submissions.forEach(submission => {
    (submission.pairings || []).forEach(pair => {
      if (!members.has(pair.receiver_id)) return;
      const key = pair.trophy_id + '\0' + pair.receiver_id;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
  });
  return counts;
}

/** sender → receiver → trophy for members in one group. */
function buildBallotMap(memberIds) {
  const members = new Set(memberIds);
  const map = new Map();
  state.adminTrophy.submissions.forEach(submission => {
    const sender = submission.participant_id;
    if (!members.has(sender)) return;
    (submission.pairings || []).forEach(pair => {
      if (!members.has(pair.receiver_id)) return;
      if (!map.has(sender)) map.set(sender, new Map());
      map.get(sender).set(pair.receiver_id, pair.trophy_id);
    });
  });
  return map;
}

/**
 * Paint the whole matrix as one bitmap so mobile pan/zoom cannot desync
 * sticky header / first-column cells the way HTML tables do.
 */
function renderVoteMatrixImage(options) {
  const {
    corner = '',
    columns = [],
    rows = [],
    values = [],
    hot = [],
    selfCell = [],
    focusRow = -1,
    focusCol = -1
  } = options;

  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const colW = Math.max(40, ...columns.map(c => String(c).length * 9 + 16), 40);
  const labelW = Math.max(52, ...rows.map(r => String(r).length * 9 + 16), String(corner).length * 8 + 12);
  const rowH = 34;
  const pad = 10;
  const width = labelW + columns.length * colW + pad * 2;
  const height = rowH * (rows.length + 1) + pad * 2;

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * dpr);
  canvas.height = Math.ceil(height * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#FFFCF7';
  ctx.fillRect(0, 0, width, height);

  const drawCell = (x, y, w, h, bg, text, opts = {}) => {
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#EFE4D2';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    if (!text) return;
    ctx.fillStyle = opts.muted ? '#A89888' : (opts.strong ? '#4A403A' : '#7A6E64');
    ctx.font = `${opts.bold ? '700' : '600'} ${opts.size || 11}px "Canva Handwriting Style TC", "PingFang TC", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(text), x + w / 2, y + h / 2 + 0.5);
  };

  // Corner + column headers
  drawCell(pad, pad, labelW, rowH, '#F5EDE3', corner, { bold: true, size: 10, muted: true });
  columns.forEach((label, c) => {
    const focused = c === focusCol;
    drawCell(
      pad + labelW + c * colW,
      pad,
      colW,
      rowH,
      focused ? '#F5E6C0' : '#F5EDE3',
      label,
      { bold: true, size: 11, strong: focused }
    );
  });

  rows.forEach((label, r) => {
    const rowFocused = r === focusRow;
    drawCell(
      pad,
      pad + rowH + r * rowH,
      labelW,
      rowH,
      rowFocused ? '#F5E6C0' : '#FFFCF7',
      label,
      { bold: true, size: 11, strong: true }
    );
    columns.forEach((_, c) => {
      const isSelf = !!(selfCell[r] && selfCell[r][c]);
      const isHot = !!(hot[r] && hot[r][c]);
      const val = (values[r] && values[r][c]) || '';
      let bg = '#FFFCF7';
      if (isSelf) bg = '#EFE4D2';
      else if (rowFocused || c === focusCol) bg = 'rgba(233, 196, 106, 0.22)';
      else if (isHot) bg = 'rgba(233, 196, 106, 0.18)';
      drawCell(
        pad + labelW + c * colW,
        pad + rowH + r * rowH,
        colW,
        rowH,
        bg,
        isSelf ? '—' : val,
        {
          bold: isHot && !isSelf,
          strong: isHot && !isSelf,
          muted: isSelf || !val,
          size: String(val).length > 3 ? 10 : 11
        }
      );
    });
  });

  // Outer border
  ctx.strokeStyle = '#EFE4D2';
  ctx.lineWidth = 1;
  ctx.strokeRect(pad + 0.5, pad + 0.5, width - pad * 2 - 1, height - pad * 2 - 1);

  return canvas.toDataURL('image/png');
}

function buildMatrixPeopleBarHtml(members, focusId) {
  return `
    <div class="vote-matrix-people" role="group" aria-label="選擇參加者">
      ${members.map(id => `
        <button type="button" class="matrix-person-btn${focusId === id ? ' is-active' : ''}"
          data-member-id="${escapeHtml(id)}">${escapeHtml(id)}</button>
      `).join('')}
    </div>
  `;
}

/**
 * Below the matrix: who is currently winning which trophies in this group
 * (same per-group highest-vote rules as formal calculate).
 */
function buildGroupWinnersHtml(group) {
  const memberIds = group.members.map(m => m.participant_id);
  if (!memberIds.length) return '';

  const profilesById = new Map(
    (state.adminTrophy.profiles || []).map(p => [p.participant_id, p])
  );

  const rows = memberIds.map(id => {
    const awards = (profilesById.get(id)?.trophies || []).filter(a => (a.vote_count || 0) > 0);
    const trophiesHtml = awards.length
      ? awards.map(a => {
          const votes = a.vote_count || 0;
          return `<span class="vote-matrix-winner-trophy">${escapeHtml(a.trophy_name)}（${votes}票）</span>`;
        }).join('')
      : '<span class="vote-matrix-winner-empty">暫未勝出</span>';
    return `
      <div class="vote-matrix-winner-row">
        <span class="vote-matrix-winner-id">${escapeHtml(id)}</span>
        <span class="vote-matrix-winner-trophies">${trophiesHtml}</span>
      </div>
    `;
  }).join('');

  return `
    <div class="vote-matrix-winners">
      <h3 class="vote-matrix-winners-title">勝出結果</h3>
      <p class="vote-matrix-winners-note">按組內最高票；平票可多人同時勝出；未達最高票者不會得獎</p>
      <div class="vote-matrix-winners-list">${rows}</div>
    </div>
  `;
}

function buildGroupNominationMatrixHtml(group) {
  const members = group.members.map(m => m.participant_id);
  const trophies = state.adminTrophy.trophies || [];
  if (!members.length) return '<p class="group-vote-matrix-empty">此組沒有參加者</p>';
  if (!trophies.length) return '<p class="group-vote-matrix-empty">尚未載入獎項清單</p>';

  const counts = buildNominationCountMap(members);
  const values = trophies.map(t => members.map(id => {
    const n = counts.get(t.trophy_id + '\0' + id) || 0;
    return n ? String(n) : '';
  }));
  const hot = values.map(row => row.map(v => !!v));
  const src = renderVoteMatrixImage({
    corner: '',
    columns: members,
    rows: trophies.map(t => t.trophy_id),
    values,
    hot
  });

  return `
    ${buildMatrixPeopleBarHtml(members, null)}
    <p class="group-vote-matrix-hint">撳人名睇獨立選票 · 下圖已縮入框內一次睇晒</p>
    <div class="vote-matrix-image-wrap">
      <img class="vote-matrix-image" src="${src}" alt="組別提名總覽" draggable="false">
    </div>
    ${buildGroupWinnersHtml(group)}
  `;
}

function buildGroupBallotMatrixHtml(group, focusId) {
  const members = group.members.map(m => m.participant_id);
  if (!members.length) return '<p class="group-vote-matrix-empty">此組沒有參加者</p>';

  const ballots = buildBallotMap(members);
  const values = members.map(sender => {
    const rowMap = ballots.get(sender) || new Map();
    return members.map(receiver => {
      if (sender === receiver) return '';
      return rowMap.get(receiver) || '';
    });
  });
  const hot = values.map(row => row.map(v => !!v));
  const selfCell = members.map((sender, r) => members.map((receiver, c) => r === c));
  const focusRow = members.indexOf(focusId);
  const src = renderVoteMatrixImage({
    corner: '投\\被',
    columns: members,
    rows: members,
    values,
    hot,
    selfCell,
    focusRow,
    focusCol: focusRow
  });

  return `
    ${buildMatrixPeopleBarHtml(members, focusId)}
    <p class="group-vote-matrix-hint">撳人名切換焦點 · 下圖已縮入框內一次睇晒</p>
    <div class="vote-matrix-image-wrap">
      <img class="vote-matrix-image" src="${src}" alt="${escapeHtml(focusId)} 的選票矩陣" draggable="false">
    </div>
    ${buildGroupWinnersHtml(group)}
  `;
}

function renderAdminPendingVoters() {
  renderGroupStatusCards({
    container: DOM.adminPendingVoters,
    title: '投票進度（按組別）',
    groups: state.adminTrophy.overview?.group_voting_status || [],
    doneKey: 'voted',
    doneLabel: '已投',
    pendingLabel: '未投',
    emptyAllDone: '所有參加者均已完成投票',
    emptyPendingTitle: '尚未完成投票',
    voteMatrix: true
  });
  if (state.adminTrophy.matrixModal) renderVoteMatrixModal();
}

function buildLoginStatusGroups() {
  const loggedIn = new Set(
    state.presence.filter(p => !!p.first_seen).map(p => p.participant_id)
  );
  const onlineCutoff = Date.now() - CONFIG.PRESENCE_ONLINE_MS;
  const online = new Set(
    state.presence.filter(p => {
      if (!p.last_seen) return false;
      return new Date(p.last_seen).getTime() >= onlineCutoff && p.online !== false;
    }).map(p => p.participant_id)
  );

  const byGroup = new Map();
  state.participants.forEach(p => {
    const group = p.group_id || '未分組';
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group).push({
      participant_id: p.participant_id,
      logged_in: loggedIn.has(p.participant_id),
      online: online.has(p.participant_id)
    });
  });

  return [...byGroup.entries()]
    .sort((a, b) => compareGroupLabels(a[0], b[0]))
    .map(([group_label, members]) => ({
      group_label,
      display_label: formatGroupLabel(group_label),
      members
    }));
}

function renderAdminLoginStatus() {
  renderGroupStatusCards({
    container: DOM.adminLoginStatus,
    title: '登入狀況（按組別）',
    groups: buildLoginStatusGroups(),
    doneKey: 'logged_in',
    doneLabel: '已登入',
    pendingLabel: '未登入',
    emptyAllDone: '所有參加者均已登入',
    emptyPendingTitle: '尚未登入'
  });
}

function populateAuditTrophyFilter() {
  const trophies = new Map();
  state.adminTrophy.auditVotes.forEach(v => {
    trophies.set(v.trophy_id, v.trophy_name);
  });
  DOM.auditTrophyFilter.innerHTML = '<option value="">全部獎項</option>';
  trophies.forEach((name, id) => {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = name;
    DOM.auditTrophyFilter.appendChild(opt);
  });
}

function renderAuditTable() {
  const search = (DOM.auditSearch?.value || '').trim().toUpperCase();
  const trophyFilter = DOM.auditTrophyFilter?.value || '';

  const filtered = state.adminTrophy.auditVotes.filter(v => {
    if (trophyFilter && v.trophy_id !== trophyFilter) return false;
    if (search) {
      return v.sender_id.toUpperCase().includes(search) ||
        v.receiver_id.toUpperCase().includes(search);
    }
    return true;
  });

  DOM.auditTableBody.innerHTML = filtered.map(v => `
    <tr>
      <td>${escapeHtml(v.sender_id)}</td>
      <td>${escapeHtml(v.receiver_id)}</td>
      <td>${escapeHtml(v.trophy_name)}</td>
    </tr>
  `).join('');

  if (DOM.auditCards) {
    DOM.auditCards.innerHTML = filtered.length === 0
      ? '<p class="form-hint">暫無投票紀錄</p>'
      : filtered.map(v => `
        <div class="audit-card">
          <div class="audit-card-route">${escapeHtml(v.sender_id)} → ${escapeHtml(v.receiver_id)}</div>
          <div class="audit-card-trophy">${appIcon('trophy')}${escapeHtml(v.trophy_name)}</div>
          ${v.submitted_at ? `<div class="audit-card-time">${formatDateTime(v.submitted_at)}</div>` : ''}
        </div>
      `).join('');
  }
}

function renderProfiles() {
  DOM.profilesList.innerHTML = state.adminTrophy.profiles.map(profile => {
    const trophies = (profile.trophies || []).map(t => {
      return `<li class="profile-trophy-item">
        <span>${escapeHtml(t.trophy_name)} (${t.vote_count} 票)</span>
      </li>`;
    }).join('');

    return `<div class="profile-card">
      <div class="profile-card-header">
        <span>${escapeHtml(profile.participant_id)}</span>
        <span class="chip chip-secondary">${profile.vote_count || 0} 票</span>
      </div>
      <ul class="profile-trophy-list">${trophies || '<li>尚未獲得獎項</li>'}</ul>
    </div>`;
  }).join('');
}

function renderTrophySummary() {
  DOM.summaryList.innerHTML = state.adminTrophy.trophySummary.map((item, i) => {
    const winners = (item.winners || []);
    const winnerHtml = winners.map(w =>
      `<div class="summary-winner">${escapeHtml(w.participant_id)} · ${w.vote_count || 0} 票</div>`
    ).join('');
    const tieNote = item.is_tie ? '<div class="summary-tie">' + appIcon('warning') + ' 平票</div>' : '';
    const ranking = (item.top_ranking || []).slice(0, 3).map((r, idx) =>
      `<div>${idx + 1}. ${escapeHtml(r.participant_id)} (${r.vote_count} 票)</div>`
    ).join('');

    return `<div class="summary-item" data-idx="${i}">
      <button type="button" class="summary-item-header">${escapeHtml(item.trophy_name)}</button>
      <div class="summary-item-body">
        ${tieNote}
        ${winnerHtml || '<p>暫無得主</p>'}
        ${ranking ? '<div style="margin-top:8px;font-weight:600">Top 3</div>' + ranking : ''}
      </div>
    </div>`;
  }).join('');

  DOM.summaryList.querySelectorAll('.summary-item-header').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.closest('.summary-item').classList.toggle('open');
    });
  });
}

function updateVotingStepper() {
  const status = state.adminTrophy.overview?.voting_status || 'DRAFT';
  const steps = ['DRAFT', 'VOTING_OPEN', 'VOTING_CLOSED', 'CALCULATED', 'PUBLISHED'];
  const currentIdx = steps.indexOf(status);

  if (DOM.adminVotingStatusBadge) {
    DOM.adminVotingStatusBadge.textContent = VOTING_STATUS_LABELS[status] || status;
  }

  document.querySelectorAll('.stepper-step').forEach(el => {
    const step = el.dataset.step;
    const idx = steps.indexOf(step);
    el.classList.toggle('active', step === status);
    el.classList.toggle('done', idx >= 0 && idx < currentIdx);
  });

  document.querySelectorAll('.stepper-line').forEach((line, i) => {
    line.classList.toggle('done', i < currentIdx);
  });
}

function updateAdminVotingButtons() {
  const status = state.adminTrophy.overview?.voting_status || 'DRAFT';
  const buttons = [
    { el: DOM.adminOpenVoting, active: status === 'VOTING_OPEN' },
    { el: DOM.adminCloseVoting, active: status === 'VOTING_CLOSED' },
    { el: DOM.adminCalculate, active: status === 'CALCULATED' },
    { el: DOM.adminPublish, active: status === 'PUBLISHED' }
  ];
  buttons.forEach(({ el, active }) => {
    if (!el) return;
    el.classList.toggle('btn-active-state', active);
    el.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

async function handleAdminVotingAction(status, btn) {
  const confirmMessages = {
    VOTING_OPEN: '確定要開放投票嗎？若先前已公布結果，將清除公布狀態並允許重新提交。',
    VOTING_CLOSED: '確定要關閉投票嗎？參加者將無法再提交。',
    PUBLISHED: '確定要公布結果嗎？'
  };
  if (confirmMessages[status] && !window.confirm(confirmMessages[status])) return;

  await runProgressButton(btn, (async () => {
    try {
      await data.setVotingStatus(status);
      showToast('投票狀態已更新：' + (VOTING_STATUS_LABELS[status] || status), 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  })());
}

async function handleAdminCalculate(btn) {
  await runProgressButton(btn, (async () => {
    try {
      // The tally runs here rather than on a server, using the submissions the
      // admin is already subscribed to, then writes one result per participant.
      const outcome = data.computeResults(
        state.participants, state.adminTrophy.trophies, state.adminTrophy.submissions
      );
      await data.writeResults(outcome.awarded);
      showToast('結果計算完成', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  })());
}

// ─── Admin Participant Management ─────────────────────────────────────────────

function initAdminParticipantCombobox() {
  if (adminParticipantCombobox) {
    adminParticipantCombobox.setItems(state.participants);
    return;
  }
  adminParticipantCombobox = createCombobox({
    input: DOM.adminParticipantSelect,
    dropdown: DOM.adminParticipantDropdown,
    toggle: DOM.adminParticipantToggle,
    items: state.participants,
    getLabel: (item) => item.participant_id,
    onSelect: (item) => {
      selectAdminParticipant(item.participant_id);
    }
  });
}

/** Everything here comes from listeners the admin already has open. */
function buildParticipantDetail(participantId, phoneNumber) {
  const person = state.participants.find(p => p.participant_id === participantId) || {};
  const submission = state.adminTrophy.submissions.find(s => s.participant_id === participantId);
  const result = state.adminTrophy.results.find(r => r.participant_id === participantId);
  const sent = state.monitorMessages.filter(m => m.sender_id === participantId);

  return {
    participant: {
      participant_id: participantId,
      group_id: person.group_id || '',
      phone_number: phoneNumber
    },
    stats: {
      sent_active: sent.filter(m => m.status === 'active').length,
      sent_deleted: sent.filter(m => m.status === 'deleted').length,
      received_active: state.monitorMessages.filter(
        m => m.receiver_id === participantId && m.status === 'active'
      ).length,
      trophy_votes: submission ? submission.pairings.length : 0,
      submission_status: submission ? submission.status : 'draft',
      trophy_awards: result
        ? (result.awards || []).filter(a => a.award_source !== 'fallback').length
        : 0
    }
  };
}

async function selectAdminParticipant(participantId) {
  state.adminParticipant.selectedId = participantId;
  DOM.adminParticipantSelect.value = participantId;
  DOM.adminParticipantDetail.classList.remove('hidden');

  try {
    showLoading(true, 30);
    const phone = await data.fetchContact(participantId);
    setLoadingPercent(90);
    state.adminParticipant.detail = buildParticipantDetail(participantId, phone);
    renderAdminParticipantDetail(state.adminParticipant.detail);
  } catch (err) {
    showToast('載入參加者資料失敗：' + err.message, 'error');
  } finally {
    finishLoading();
  }
}

function renderAdminParticipantDetail(detail) {
  const p = detail.participant || {};
  const stats = detail.stats || {};

  DOM.adminEditPhone.value = p.phone_number || '';
  // The phone number is this person's Firebase password, and a browser cannot
  // change someone else's password. set_participant_phone.py does that.
  DOM.adminEditPhone.readOnly = true;
  DOM.adminEditPhone.title = '電話號碼即登入密碼，需在電腦執行 set_participant_phone.py 更改';
  DOM.adminEditGroup.value = p.group_id || '';

  DOM.adminParticipantStats.innerHTML = `
    <div class="stat-card"><div class="stat-value">${stats.sent_active || 0}</div><div class="stat-label">有效已發留言</div></div>
    <div class="stat-card"><div class="stat-value">${stats.sent_deleted || 0}</div><div class="stat-label">已撤回留言</div></div>
    <div class="stat-card"><div class="stat-value">${stats.received_active || 0}</div><div class="stat-label">收件箱留言</div></div>
    <div class="stat-card"><div class="stat-value">${stats.trophy_votes || 0}</div><div class="stat-label">獎項投票數</div></div>
    <div class="stat-card"><div class="stat-value">${stats.submission_status === 'submitted' ? '已提交' : '草稿'}</div><div class="stat-label">投票狀態</div></div>
    <div class="stat-card"><div class="stat-value">${stats.trophy_awards || 0}</div><div class="stat-label">獲得獎項</div></div>
  `;
}

async function refreshAdminParticipantDetail() {
  if (!state.adminParticipant.selectedId) return;
  await selectAdminParticipant(state.adminParticipant.selectedId);
}

function deriveGroupId(participantId) {
  const match = String(participantId || '').match(/^(\d)[A-F]$/i);
  return match ? 'GROUP_' + match[1] : 'GROUP_STAFF';
}

async function handleAdminSaveParticipant() {
  const pid = state.adminParticipant.selectedId;
  if (!pid) { showToast('請先選擇參加者', 'error'); return; }

  const groupId = DOM.adminEditGroup.value.trim();
  if (!groupId) { showToast('分組不能為空', 'error'); return; }

  await runProgressButton(DOM.adminSaveParticipant, (async () => {
    try {
      await data.updateParticipantGroup(pid, groupId);
      const person = state.participants.find(p => p.participant_id === pid);
      if (person) person.group_id = groupId;
      setParticipantsCache(state.participants);
      showToast('分組已更新', 'success');
      await refreshAdminParticipantDetail();
    } catch (err) {
      showToast(err.message, 'error');
    }
  })());
}

async function handleAdminDeleteMessages() {
  const pid = state.adminParticipant.selectedId;
  if (!pid) return;
  if (!window.confirm('確定要刪除 ' + pid + ' 的所有已發留言嗎？')) return;

  await runProgressButton(DOM.adminDeleteMessages, (async () => {
    try {
      const removed = await data.clearParticipantRecords(pid, {
        deleteMessages: true, deleteTrophy: false, deleteResults: false
      });
      showToast('已刪除 ' + removed + ' 則留言', 'success');
      await refreshAdminParticipantDetail();
    } catch (err) {
      showToast(err.message, 'error');
    }
  })());
}

async function handleAdminResetTrophy() {
  const pid = state.adminParticipant.selectedId;
  if (!pid) return;
  if (!window.confirm('確定要重置 ' + pid + ' 的獎項投票嗎？')) return;

  await runProgressButton(DOM.adminResetTrophy, (async () => {
    try {
      await data.resetParticipantVote(pid);
      showToast('獎項投票已重置', 'success');
      await refreshAdminParticipantDetail();
    } catch (err) {
      showToast(err.message, 'error');
    }
  })());
}

async function handleAdminDeleteAllRecords() {
  const pid = state.adminParticipant.selectedId;
  if (!pid) return;
  if (!window.confirm('確定要刪除 ' + pid + ' 的所有紀錄嗎？\n包括：已發留言、獎項投票、結果。\n此操作無法復原！')) return;

  await runProgressButton(DOM.adminDeleteAllRecords, (async () => {
    try {
      const removed = await data.clearParticipantRecords(pid, {
        deleteMessages: true, deleteTrophy: true, deleteResults: true
      });
      showToast('已刪除 ' + removed + ' 項紀錄', 'success');
      await refreshAdminParticipantDetail();
    } catch (err) {
      showToast(err.message, 'error');
    }
  })());
}

async function handleAdminBulkAutoGroup() {
  if (!window.confirm('確定要依參加者編號自動修正全部分組嗎？\n（例如 1A→GROUP_1、其他→GROUP_STAFF）')) return;

  await runProgressButton(DOM.adminBulkAutoGroup, (async () => {
    try {
      const assignments = {};
      state.participants.forEach(p => {
        assignments[p.participant_id] = deriveGroupId(p.participant_id);
      });
      const updated = await data.bulkSetGroups(assignments);
      state.participants.forEach(p => { p.group_id = assignments[p.participant_id]; });
      setParticipantsCache(state.participants);
      showToast('已修正 ' + updated + ' 位參加者', 'success');
      await afterBulkGroupChange();
    } catch (err) {
      showToast(err.message, 'error');
    }
  })());
}

async function handleAdminBulkApplyGroup() {
  const groupId = (DOM.adminBulkGroup.value || DOM.adminEditGroup.value || '').trim();
  if (!groupId) {
    showToast('請在「統一分組」欄位輸入 group_id', 'error');
    return;
  }
  if (!window.confirm('確定要將分組「' + groupId + '」套用到全部 ' + state.participants.length + ' 位參加者嗎？')) return;

  await runProgressButton(DOM.adminBulkApplyGroup, (async () => {
    try {
      const assignments = {};
      state.participants.forEach(p => { assignments[p.participant_id] = groupId; });
      const updated = await data.bulkSetGroups(assignments);
      state.participants.forEach(p => { p.group_id = groupId; });
      setParticipantsCache(state.participants);
      showToast('已套用到 ' + updated + ' 位參加者', 'success');
      await afterBulkGroupChange();
    } catch (err) {
      showToast(err.message, 'error');
    }
  })());
}

async function handleAdminBulkDeleteAll() {
  const count = state.participants.length;
  if (!window.confirm('確定要刪除全部 ' + count + ' 位參加者的所有紀錄嗎？\n包括：已發留言、獎項投票、結果。\n此操作無法復原！')) return;
  if (!window.confirm('再次確認：真的要清除所有參加者的全部紀錄嗎？')) return;

  await runProgressButton(DOM.adminBulkDeleteAll, (async () => {
    try {
      const removed = await data.clearAllRecords();
      showToast('已清除 ' + removed + ' 項紀錄，投票狀態已重設', 'success');
      await refreshAdminParticipantDetail();
    } catch (err) {
      showToast(err.message, 'error');
    }
  })());
}

async function afterBulkGroupChange() {
  initAdminParticipantCombobox();
  refreshAdminTrophyViews();
  if (state.adminParticipant.selectedId) {
    await refreshAdminParticipantDetail();
  }
}

function initAdminParticipantsPanel() {
  initAdminParticipantCombobox();
  if (state.adminParticipant.selectedId) {
    refreshAdminParticipantDetail();
  }
}

// ─── Navigation ───────────────────────────────────────────────────────────

const BOTTOM_NAV_TABS = ['home', 'inbox', 'trophy', 'profile'];

function switchParticipantView(viewName) {
  document.querySelectorAll('#screen-participant .app-view').forEach(view => {
    const isActive = view.dataset.view === viewName;
    view.classList.toggle('active', isActive);
    view.classList.toggle('hidden', !isActive);
  });

  const isBottomTab = BOTTOM_NAV_TABS.includes(viewName);
  document.querySelectorAll('#screen-participant .bottom-nav-item').forEach(btn => {
    const tab = btn.dataset.tab;
    const isActive = isBottomTab && tab === viewName;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive);
  });

  if (viewName === 'inbox') {
    markAllInboxRead();
  } else if (viewName === 'trophy') {
    renderTrophyTeammates();
    updateTrophyStatusBanner();
  } else if (viewName === 'profile') {
    renderProfile();
  }
}

function switchAdminTab(tabName) {
  document.querySelectorAll('.admin-bottom-nav .bottom-nav-item').forEach(btn => {
    const isActive = btn.dataset.adminTab === tabName;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive);
  });

  const panels = {
    dashboard: DOM.adminDashboardPanel,
    messages: DOM.adminMessagesPanel,
    voting: DOM.adminTrophyPanel,
    results: DOM.adminResultsPanel,
    settings: DOM.adminParticipantsPanel
  };
  Object.entries(panels).forEach(([key, panel]) => {
    if (!panel) return;
    panel.classList.toggle('active', key === tabName);
    panel.classList.toggle('hidden', key !== tabName);
  });

  // Every panel is fed by listeners that stay open for the whole session, so
  // switching tabs only needs to draw what is already in memory.
  if (tabName === 'messages') {
    clearAdminMessagePause();
    populateAdminMsgGroupFilter();
    renderAdminMessages();
  } else if (tabName === 'voting' || tabName === 'results') {
    refreshAdminTrophyViews();
  } else if (tabName === 'settings') {
    initAdminParticipantsPanel();
    if (DOM.adminParticipantCount) {
      DOM.adminParticipantCount.textContent = String(state.participants.length);
    }
  } else if (tabName === 'dashboard') {
    renderAdminDashboard();
    renderAdminLiveLoad();
  }
}

function switchResultTab(tabName) {
  document.querySelectorAll('.sub-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.resultTab === tabName);
  });
  document.getElementById('result-audit').classList.toggle('active', tabName === 'audit');
  document.getElementById('result-audit').classList.toggle('hidden', tabName !== 'audit');
  document.getElementById('result-profiles').classList.toggle('active', tabName === 'profiles');
  document.getElementById('result-profiles').classList.toggle('hidden', tabName !== 'profiles');
  document.getElementById('result-summary').classList.toggle('active', tabName === 'summary');
  document.getElementById('result-summary').classList.toggle('hidden', tabName !== 'summary');
}

// ─── Event Binding ────────────────────────────────────────────────────────────

function bindEvents() {
  DOM.loginForm.addEventListener('submit', handleLogin);
  DOM.participantLogout.addEventListener('click', handleLogout);
  DOM.adminLogout.addEventListener('click', handleLogout);

  // Allow alphanumeric passwords (seat id). Digits-only stripping is only for
  // the admin phone editor.
  DOM.loginPhone.addEventListener('input', () => {
    DOM.loginPhone.value = String(DOM.loginPhone.value || '').toUpperCase();
  });

  if (DOM.loginNumpadToggle) {
    // Keep the button from stealing focus on touch; otherwise iOS may never
    // open the keyboard until the user taps the text field separately.
    DOM.loginNumpadToggle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
    });
    DOM.loginNumpadToggle.addEventListener('click', (e) => {
      e.preventDefault();
      // If already on numpad, still re-focus so the keyboard pops without
      // tapping the field. Second intentional toggle-off: press again while
      // focused after a short path — use toggle for mode switch.
      if (!isLoginNativeNumpad()) {
        setLoginNativeNumpad(true);
      } else if (document.activeElement === DOM.loginPhone) {
        setLoginNativeNumpad(false);
      } else {
        setLoginNativeNumpad(true);
      }
    });
  }

  DOM.sendForm.addEventListener('submit', handleSendMessage);
  DOM.sendContent.addEventListener('input', updateCharCounter);

  DOM.inboxRefresh.addEventListener('click', refreshInbox);
  DOM.sentRefresh.addEventListener('click', refreshSent);

  DOM.trophySaveDraft.addEventListener('click', handleTrophySaveDraft);
  DOM.trophySubmitAll.addEventListener('click', handleTrophySubmitAll);
  DOM.trophyResultsModalClose.addEventListener('click', hideTrophyResultsModal);
  DOM.trophyResultsModal.addEventListener('click', (e) => {
    if (e.target === DOM.trophyResultsModal) hideTrophyResultsModal();
  });

  if (DOM.voteMatrixModalClose) {
    DOM.voteMatrixModalClose.addEventListener('click', closeVoteMatrixModal);
  }
  if (DOM.voteMatrixModalBack) {
    DOM.voteMatrixModalBack.addEventListener('click', () => {
      const modal = state.adminTrophy.matrixModal;
      if (!modal) return;
      openVoteMatrixModal(modal.groupLabel, null);
    });
  }
  if (DOM.voteMatrixModal) {
    DOM.voteMatrixModal.addEventListener('click', (e) => {
      if (e.target === DOM.voteMatrixModal) closeVoteMatrixModal();
    });
  }

  if (DOM.trophySubmittedHome) {
    DOM.trophySubmittedHome.addEventListener('click', () => switchParticipantView('home'));
  }

  document.querySelectorAll('#screen-participant .bottom-nav-item').forEach(btn => {
    btn.addEventListener('click', () => switchParticipantView(btn.dataset.tab));
  });

  document.querySelectorAll('#screen-participant .home-card').forEach(card => {
    card.addEventListener('click', () => switchParticipantView(card.dataset.nav));
  });

  bindIconPopTargets('#screen-participant .home-card');
  bindIconPopTargets('#screen-participant .bottom-nav-item');
  bindIconPopTargets('.admin-bottom-nav .bottom-nav-item');

  document.querySelectorAll('#screen-participant .back-btn').forEach(btn => {
    btn.addEventListener('click', () => switchParticipantView(btn.dataset.back || 'home'));
  });

  document.querySelectorAll('.admin-bottom-nav .bottom-nav-item').forEach(btn => {
    btn.addEventListener('click', () => switchAdminTab(btn.dataset.adminTab));
  });

  document.querySelectorAll('.sub-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchResultTab(btn.dataset.resultTab));
  });

  document.querySelectorAll('.chip-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      setMonitorViewFilter(btn.dataset.filter);
      // Changing filter counts as intentional interaction — flush any paused updates.
      clearAdminMessagePause({ render: true });
    });
  });

  if (DOM.adminMsgSearch) {
    DOM.adminMsgSearch.addEventListener('input', () => {
      if (state.adminMsgScrollPaused) {
        // Searching should refresh the visible list from the latest data.
        clearAdminMessagePause({ render: true });
      } else {
        renderAdminMessages();
      }
    });
  }

  if (DOM.adminMsgGroupFilter) {
    DOM.adminMsgGroupFilter.addEventListener('change', () => {
      state.monitorGroupFilter = DOM.adminMsgGroupFilter.value || '';
      clearAdminMessagePause({ render: true });
    });
  }

  DOM.adminEnableMsg.addEventListener('click', () => handleSetMessagingStatus('OPEN', DOM.adminEnableMsg));
  DOM.adminDisableMsg.addEventListener('click', () => handleSetMessagingStatus('CLOSE', DOM.adminDisableMsg));

  DOM.adminOpenVoting.addEventListener('click', () => handleAdminVotingAction('VOTING_OPEN', DOM.adminOpenVoting));
  DOM.adminCloseVoting.addEventListener('click', () => handleAdminVotingAction('VOTING_CLOSED', DOM.adminCloseVoting));
  DOM.adminCalculate.addEventListener('click', () => handleAdminCalculate(DOM.adminCalculate));
  DOM.adminPublish.addEventListener('click', () => handleAdminVotingAction('PUBLISHED', DOM.adminPublish));

  DOM.adminSaveParticipant.addEventListener('click', handleAdminSaveParticipant);
  DOM.adminDeleteMessages.addEventListener('click', handleAdminDeleteMessages);
  DOM.adminResetTrophy.addEventListener('click', handleAdminResetTrophy);
  DOM.adminDeleteAllRecords.addEventListener('click', handleAdminDeleteAllRecords);
  DOM.adminBulkAutoGroup.addEventListener('click', handleAdminBulkAutoGroup);
  DOM.adminBulkApplyGroup.addEventListener('click', handleAdminBulkApplyGroup);
  DOM.adminBulkDeleteAll.addEventListener('click', handleAdminBulkDeleteAll);

  DOM.auditSearch.addEventListener('input', renderAuditTable);
  DOM.auditTrophyFilter.addEventListener('change', renderAuditTable);

}

// ─── Init ─────────────────────────────────────────────────────────────────────

function init() {
  cacheDOM();
  bindEvents();
  initAdminMessageScrollPause();
  startApp();
}

async function startApp() {
  const splashDone = runSplashAnimation();
  try {
    await bootstrapApp();
  } catch (_) { /* bootstrapApp already toasts hard failures */ }

  let restored = false;
  try {
    restored = await tryRestoreSession();
  } catch (err) {
    clearSession();
    console.warn('無法恢復登入狀態:', err && err.message);
  }

  await splashDone;
  if (!restored) {
    showScreen('login');
    updateLoginStatusBanner();
  }
}

document.addEventListener('DOMContentLoaded', init);

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * OPERATIONS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Backend: Firebase project tnit-6c48d (Firestore + Email/Password auth).
 * Collections: participants, contacts, trophies, messages, submissions,
 * results, config/messaging, config/voting.
 *
 * Participants log in with their id and phone number, which maps to
 * 1A -> 1a@tnit.local. Access is enforced by firestore.rules, not by this file.
 *
 * Scripts, all run from the repo root with the service account key:
 *   migrate_to_firestore.py    push the sheet roster into Firebase
 *   set_participant_phone.py   change one person's phone, i.e. their password
 *   sync_participants.py       regenerate the public participants.json
 *   deploy_firestore_rules.py  publish firestore.rules
 *   test_firestore_rules.py    verify the rules still block what they should
 *
 * Admin login: participant_id = admin, phone = 23082026
 * ═══════════════════════════════════════════════════════════════════════════
 */
