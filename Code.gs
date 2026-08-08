/**
 * HKCYSTINTJustForYou — Google Apps Script Backend
 * SCRIPT_VERSION = 15
 *
 * Spreadsheet:
 * https://docs.google.com/spreadsheets/d/1xFLUikp5TEk4e5pd0B7VNbE7vPoZ-iViioomTjbB3RU/edit
 *
 * Deployment:
 * 1. Open the spreadsheet → Extensions > Apps Script → paste this file
 * 2. Deploy as Web App: Execute as Me, Access: Anyone
 * 3. Copy deployment URL to app.js → API_URL
 */

const SCRIPT_VERSION = 17;
const SPREADSHEET_ID = '1xFLUikp5TEk4e5pd0B7VNbE7vPoZ-iViioomTjbB3RU';
const ADMIN_ID = 'ADMIN';
const ADMIN_PHONE = '23082026';
const LEGACY_ADMIN_PASSWORD = 'TNIT23082026';
const MAX_MESSAGE_LENGTH = 300;

// ─── Entry Points ───────────────────────────────────────────────────────────

function doGet(e) {
  try {
    const action = (e.parameter.action || e.parameter.fetch_type || '').toLowerCase();
    const params = e.parameter;

    switch (action) {
      case 'bootstrap':
        return jsonResponse(bootstrap());
      case 'list_participants':
        return jsonResponse({ status: 'success', participants: getParticipantsList() });
      case 'get_messaging_status':
        return handleGetMessagingStatus(params);
      case 'inbox':
        return jsonResponse(fetchInbox(params));
      case 'sent':
        return jsonResponse(fetchSent(params));
      case 'admin':
        return jsonResponse(fetchAdminDashboard(params));
      case 'admin_list_messages':
        return jsonResponse(adminListMessages(params));
      case 'admin_watch_messages':
        return jsonResponse(adminWatchMessages(params));
      case 'watch_sent_messages':
        return jsonResponse(watchSentMessages(params));
      case 'admin_delete_message':
        return jsonResponse(adminDeleteMessage(params));
      case 'set_messaging_status':
        return jsonResponse(setMessagingStatus(params));
      case 'trophy_bootstrap':
        return jsonResponse(trophyBootstrap(params));
      case 'watch_trophy_status':
        return jsonResponse(watchTrophyStatus(params));
      case 'admin_trophy_overview':
        return jsonResponse(adminTrophyOverview(params));
      case 'admin_trophy_audit':
        return jsonResponse(adminTrophyAudit(params));
      case 'admin_trophy_results':
        return jsonResponse(adminTrophyResults(params));
      case 'admin_set_voting_status':
        return jsonResponse(adminSetVotingStatus(params));
      case 'admin_calculate_trophy_results':
        return jsonResponse(adminCalculateTrophyResults(params));
      case 'admin_reset_participant_vote':
        return jsonResponse(adminResetParticipantVote(params));
      case 'admin_participant_detail':
        return jsonResponse(adminParticipantDetail(params));
      case 'admin_update_participant':
        return jsonResponse(adminUpdateParticipant(params));
      case 'admin_delete_participant_records':
        return jsonResponse(adminDeleteParticipantRecords(params));
      case 'admin_bulk_update_participants':
        return jsonResponse(adminBulkUpdateParticipants(params));
      case 'admin_bulk_delete_all_records':
        return jsonResponse(adminBulkDeleteAllRecords(params));
      default:
        if (!action) {
          return jsonResponse({
            status: 'success',
            service: 'HKCYS TINT Just For You API',
            version: SCRIPT_VERSION,
            hint: '前端請使用 ?action=bootstrap 等參數；直接開啟此網址屬正常現象'
          });
        }
        return jsonResponse({ status: 'error', message: '未知的操作：' + action });
    }
  } catch (err) {
    return jsonResponse({ status: 'error', message: String(err.message || err) });
  }
}

function doPost(e) {
  try {
    const body = parsePostBody(e);
    const action = (body.action || '').toLowerCase();

    switch (action) {
      case 'trophy_save_draft':
        return jsonResponse(trophySaveDraft(body));
      case 'trophy_submit':
        return jsonResponse(trophySubmit(body));
      case 'admin_delete_message':
        return jsonResponse(adminDeleteMessage(body));
      case 'set_messaging_status':
        return jsonResponse(setMessagingStatus(body));
      case 'admin_set_voting_status':
        return jsonResponse(adminSetVotingStatus(body));
      case 'admin_calculate_trophy_results':
        return jsonResponse(adminCalculateTrophyResults(body));
      case 'admin_reset_participant_vote':
        return jsonResponse(adminResetParticipantVote(body));
      case 'admin_update_participant':
        return jsonResponse(adminUpdateParticipant(body));
      case 'admin_delete_participant_records':
        return jsonResponse(adminDeleteParticipantRecords(body));
      case 'admin_bulk_update_participants':
        return jsonResponse(adminBulkUpdateParticipants(body));
      case 'admin_bulk_delete_all_records':
        return jsonResponse(adminBulkDeleteAllRecords(body));
      case 'send_message':
        return jsonResponse(sendMessage(body));
      default:
        if (!action && body.sender_id && body.receiver_id && body.content !== undefined) {
          return jsonResponse(sendMessage(body));
        }
        if (!action) {
          return jsonResponse({
            status: 'success',
            service: 'HKCYS TINT Just For You API',
            version: SCRIPT_VERSION,
            hint: 'POST 請在 body 加入 action 欄位'
          });
        }
        return jsonResponse({ status: 'error', message: '未知的 POST 操作：' + action });
    }
  } catch (err) {
    return jsonResponse({ status: 'error', message: String(err.message || err) });
  }
}

// ─── Response Helpers ───────────────────────────────────────────────────────

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function parsePostBody(e) {
  if (!e || !e.postData || !e.postData.contents) return {};
  try {
    return JSON.parse(e.postData.contents);
  } catch (_) {
    return {};
  }
}

function successResponse(extra) {
  return Object.assign({ status: 'success' }, extra || {});
}

function errorResponse(message) {
  return { status: 'error', message: message };
}

// ─── Cache ──────────────────────────────────────────────────────────────────

/**
 * Polling endpoints used to read whole sheets just to answer "did anything
 * change?". The script cache is shared by every caller, so one sheet read now
 * serves all clients polling inside the TTL window instead of one read each.
 *
 * Writes clear the affected keys, so the TTLs are only a backstop against a
 * missed invalidation rather than the normal path to freshness.
 */
const CACHE_TTL_PARTICIPANTS = 900;
const CACHE_TTL_REVISION = 15;
const CACHE_TTL_STATUS = 15;

const CACHE_KEY_PARTICIPANTS = 'participants_v17';
const CACHE_KEY_MESSAGES_REVISION = 'messages_revision_v17';
const CACHE_KEY_MESSAGING_STATUS = 'messaging_status_v17';
const CACHE_KEY_VOTING_CONFIG = 'voting_config_v17';
const CACHE_KEY_TROPHIES = 'trophies_v17';
const CACHE_KEY_TROPHY_RESULTS = 'trophy_results_v17';
const CACHE_KEY_QUEUE_PREFIX = 'queue_v17_';
const CACHE_TTL_PRESENCE = 40;

function scriptCache() {
  return CacheService.getScriptCache();
}

// A cache outage must degrade to a slow request, never to a failed one.
function cacheGetString(key) {
  try {
    return scriptCache().get(key);
  } catch (_) {
    return null;
  }
}

function cachePutString(key, value, ttlSeconds) {
  try {
    scriptCache().put(key, value, ttlSeconds);
  } catch (_) { /* ignore */ }
}

function cacheGetJson(key) {
  const raw = cacheGetString(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function cachePutJson(key, value, ttlSeconds) {
  try {
    cachePutString(key, JSON.stringify(value), ttlSeconds);
  } catch (_) { /* ignore */ }
}

function cacheRemove(keys) {
  try {
    scriptCache().removeAll(keys);
  } catch (_) { /* ignore */ }
}

// ─── Sheet Access ───────────────────────────────────────────────────────────

function getSpreadsheet() {
  if (SPREADSHEET_ID) {
    return SpreadsheetApp.openById(SPREADSHEET_ID);
  }
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getSheet(name) {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    initSheetHeaders(name, sheet);
  }
  return sheet;
}

function initSheetHeaders(name, sheet) {
  const headers = {
    Participants: ['participant_id', 'phone_number', 'group_id'],
    Messages: ['message_id', 'sender_id', 'receiver_id', 'content', 'created_at', 'status', 'deleted_at'],
    Trophy: ['Trophy_id', 'Trophy_name'],
    Trophy_log: ['Tmessage_id', 'sender_id', 'receiver_id', 'Trophy_id'],
    Trophy_draft: ['Tmessage_id', 'sender_id', 'receiver_id', 'Trophy_id'],
    Trophy_submissions: ['participant_id', 'submission_status', 'submitted_at', 'updated_at'],
    Trophy_results: ['participant_id', 'Trophy_id', 'award_source', 'calculated_at']
  };
  if (headers[name]) {
    sheet.getRange(1, 1, 1, headers[name].length).setValues([headers[name]]);
  }
  if (name === 'Open') {
    sheet.getRange('A1').setValue('messaging_status');
    sheet.getRange('A2').setValue('OPEN');
  }
  if (name === 'Voting') {
    sheet.getRange('A1').setValue('voting_status');
    sheet.getRange('B1').setValue('allow_resubmit');
    sheet.getRange('C1').setValue('calculated_at');
    sheet.getRange('D1').setValue('published_at');
    sheet.getRange('A2').setValue('DRAFT');
    sheet.getRange('B2').setValue('FALSE');
  }
}

function getSheetData(sheet, hasHeader) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return [];
  const headerRow = hasHeader !== false;
  if (headerRow && lastRow < 2) return [];
  const startRow = headerRow ? 2 : 1;
  const numRows = lastRow - startRow + 1;
  const values = sheet.getRange(startRow, 1, numRows, lastCol).getValues();
  const headers = headerRow
    ? sheet.getRange(1, 1, 1, lastCol).getValues()[0]
    : null;
  return values.map(function (row) {
    if (!headers) return row;
    const obj = {};
    headers.forEach(function (h, i) {
      obj[String(h)] = row[i] !== undefined && row[i] !== null ? String(row[i]) : '';
    });
    return obj;
  });
}

// ─── Normalization ──────────────────────────────────────────────────────────

function normalizeParticipantId(id) {
  if (!id) return '';
  const s = String(id).trim().toUpperCase();
  if (s === 'ADMIN' || s === 'admin'.toUpperCase()) return ADMIN_ID;
  return s;
}

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function nowIso() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
}

function generateMessageId() {
  const ts = Date.now();
  const rand = Math.floor(Math.random() * 100000).toString().padStart(5, '0');
  return 'MSG-' + ts + '-' + rand;
}

function generateTMessageId() {
  const ts = Date.now();
  const rand = Math.floor(Math.random() * 100000).toString().padStart(5, '0');
  return 'TMSG-' + ts + '-' + rand;
}

// ─── Auth ───────────────────────────────────────────────────────────────────

function isAdminCredentials(participantId, phone) {
  return normalizeParticipantId(participantId) === ADMIN_ID &&
    normalizePhone(phone) === ADMIN_PHONE;
}

function verifyParticipant(participantId, phone) {
  const pid = normalizeParticipantId(participantId);
  const ph = normalizePhone(phone);
  if (isAdminCredentials(pid, ph)) {
    return { valid: true, participant_id: ADMIN_ID, isAdmin: true };
  }
  const participants = getParticipantsList();
  const match = participants.find(function (p) {
    return p.participant_id === pid && normalizePhone(p.phone_number) === ph;
  });
  if (match) {
    return { valid: true, participant_id: pid, isAdmin: false, group_id: match.group_id || '' };
  }
  return { valid: false };
}

function requireAuth(params) {
  const pid = normalizeParticipantId(params.participant_id || params.sender_id);
  const phone = normalizePhone(params.phone_number || params.phone);
  const auth = verifyParticipant(pid, phone);
  if (!auth.valid) {
    throw new Error('登入驗證失敗，請確認參加者編號與電話號碼');
  }
  recordClientQueueDepth(auth, params.q);
  return auth;
}

/**
 * Clients report how much work they still have queued by attaching it to
 * requests they were already making, which lets the admin dashboard show live
 * load without anyone spending an extra execution on reporting it.
 */
function recordClientQueueDepth(auth, reported) {
  if (!auth || auth.isAdmin || reported === undefined || reported === null) return;
  const depth = parseInt(reported, 10);
  if (isNaN(depth) || depth < 0) return;
  cachePutString(CACHE_KEY_QUEUE_PREFIX + auth.participant_id, String(depth), CACHE_TTL_PRESENCE);
}

function getQueueSnapshot() {
  const participants = getParticipantsList();
  const keys = participants.map(function (p) {
    return CACHE_KEY_QUEUE_PREFIX + p.participant_id;
  });

  let entries = {};
  try {
    entries = scriptCache().getAll(keys) || {};
  } catch (_) {
    entries = {};
  }

  const active = Object.keys(entries);
  let queued = 0;
  active.forEach(function (key) {
    queued += parseInt(entries[key], 10) || 0;
  });

  return { queued: queued, online: active.length, total: participants.length };
}

function requireAdmin(params) {
  const auth = requireAuth(params);
  if (!auth.isAdmin) {
    throw new Error('需要管理員權限');
  }
  return auth;
}

// ─── Participants ───────────────────────────────────────────────────────────

// Memoized for the lifetime of one request; Apps Script gives each doGet/doPost
// a fresh script context, so this never serves data across requests.
let participantsMemo = null;

function invalidateParticipantsMemo() {
  participantsMemo = null;
  cacheRemove([CACHE_KEY_PARTICIPANTS]);
}

function getParticipantsList() {
  if (participantsMemo) return participantsMemo;

  // Every authenticated request resolves credentials against this list, so
  // caching it removes one full sheet read from the entire API surface.
  const cached = cacheGetJson(CACHE_KEY_PARTICIPANTS);
  if (cached) {
    participantsMemo = cached;
    return participantsMemo;
  }

  const sheet = getSheet('Participants');
  const rows = getSheetData(sheet);
  participantsMemo = rows
    .filter(function (r) { return r.participant_id; })
    .map(function (r) {
      return {
        participant_id: normalizeParticipantId(r.participant_id),
        phone_number: normalizePhone(r.phone_number),
        group_id: String(r.group_id || '').trim()
      };
    })
    .filter(function (p) { return p.participant_id !== ADMIN_ID; });

  cachePutJson(CACHE_KEY_PARTICIPANTS, participantsMemo, CACHE_TTL_PARTICIPANTS);
  return participantsMemo;
}

function participantExists(participantId) {
  const pid = normalizeParticipantId(participantId);
  if (pid === ADMIN_ID) return true;
  return getParticipantsList().some(function (p) { return p.participant_id === pid; });
}

function deriveGroupIdFromParticipantId(participantId) {
  const pid = normalizeParticipantId(participantId);
  const m = pid.match(/^(\d)[A-H]$/);
  if (m) return 'GROUP_' + m[1];
  return 'GROUP_STAFF';
}

function resolveEffectiveGroupId(participant, allParticipants) {
  const groupId = String(participant.group_id || '').trim();
  const phone = normalizePhone(participant.phone_number);
  const derived = deriveGroupIdFromParticipantId(participant.participant_id);

  if (!groupId || groupId === phone || normalizePhone(groupId) === phone) {
    return derived;
  }

  const all = allParticipants || getParticipantsList();
  const othersInGroup = all.filter(function (p) {
    return p.participant_id !== participant.participant_id &&
      String(p.group_id || '').trim() === groupId;
  });
  if (othersInGroup.length === 0) {
    return derived;
  }

  return groupId;
}

function getParticipantGroup(participantId) {
  const pid = normalizeParticipantId(participantId);
  const all = getParticipantsList();
  const p = all.find(function (x) { return x.participant_id === pid; });
  if (!p) return '';
  return resolveEffectiveGroupId(p, all);
}

function getTeammates(participantId) {
  const pid = normalizeParticipantId(participantId);
  const groupId = getParticipantGroup(pid);
  const all = getParticipantsList();
  if (!groupId) {
    return all.filter(function (p) { return p.participant_id !== pid; });
  }
  return all.filter(function (p) {
    return resolveEffectiveGroupId(p, all) === groupId && p.participant_id !== pid;
  });
}

// ─── Messaging Status ─────────────────────────────────────────────────────────

function getMessagingStatus() {
  const cached = cacheGetString(CACHE_KEY_MESSAGING_STATUS);
  if (cached) return cached;

  const sheet = getSheet('Open');
  const raw = String(sheet.getRange('A2').getValue() || 'OPEN').trim().toUpperCase();
  const val = raw === 'CLOSE' ? 'CLOSE' : 'OPEN';
  cachePutString(CACHE_KEY_MESSAGING_STATUS, val, CACHE_TTL_STATUS);
  return val;
}

function setMessagingStatusValue(status) {
  const sheet = getSheet('Open');
  const val = String(status).trim().toUpperCase() === 'CLOSE' ? 'CLOSE' : 'OPEN';
  sheet.getRange('A2').setValue(val);
  cachePutString(CACHE_KEY_MESSAGING_STATUS, val, CACHE_TTL_STATUS);
  return val;
}

function handleGetMessagingStatus(params) {
  const status = getMessagingStatus();
  const adminParam = params.admin;
  if (adminParam) {
    requireAdmin({
      participant_id: ADMIN_ID,
      phone_number: params.phone_number || params.phone || (adminParam === LEGACY_ADMIN_PASSWORD ? ADMIN_PHONE : adminParam)
    });
    if (params.sub_action === 'list_messages') {
      return jsonResponse(adminListMessages(params));
    }
  }
  return jsonResponse(successResponse({ messaging_status: status, version: SCRIPT_VERSION }));
}

function setMessagingStatus(params) {
  requireAdmin(params);
  const newStatus = setMessagingStatusValue(params.messaging_status || params.status);
  return successResponse({ messaging_status: newStatus });
}

// ─── Messages CRUD ──────────────────────────────────────────────────────────

function getAllMessages() {
  const sheet = getSheet('Messages');
  const rows = getSheetData(sheet);
  return rows.map(formatMessageRow).filter(function (m) {
    return m.message_id && m.message_id.indexOf('MSG-') === 0;
  });
}

function formatMessageRow(r) {
  return {
    message_id: String(r.message_id || ''),
    sender_id: normalizeParticipantId(r.sender_id),
    receiver_id: normalizeParticipantId(r.receiver_id),
    content: String(r.content || ''),
    created_at: String(r.created_at || ''),
    status: String(r.status || 'active').toLowerCase() === 'deleted' ? 'deleted' : 'active',
    deleted_at: String(r.deleted_at || ''),
    deleted_reason: String(r.status || '').toLowerCase() === 'deleted'
      ? '此留言已被管理員撤回，未能送達接收者（管理員決定）'
      : ''
  };
}

/**
 * Answers "did anything change?" without touching the Messages sheet. This is
 * the hot path: every client polls it on a timer, and before caching each poll
 * cost a full sheet read.
 */
function getCachedMessagesRevision() {
  const cached = cacheGetString(CACHE_KEY_MESSAGES_REVISION);
  if (cached) return cached;
  return rememberMessagesRevision(getMessagesRevision(getAllMessages()));
}

function rememberMessagesRevision(revision) {
  cachePutString(CACHE_KEY_MESSAGES_REVISION, revision, CACHE_TTL_REVISION);
  return revision;
}

function invalidateMessagesCache() {
  cacheRemove([CACHE_KEY_MESSAGES_REVISION]);
}

function getMessagesRevision(messages) {
  const body = messages.map(function (m) { return m.message_id + ':' + m.status; }).sort().join('\u0001');
  const hash = computeMD5(body);
  return messages.length + '-' + hash;
}

function computeMD5(str) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, str, Utilities.Charset.UTF_8);
  return digest.map(function (b) {
    const v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

function sendMessage(body) {
  if (getMessagingStatus() !== 'OPEN') {
    return errorResponse('留言功能目前已關閉');
  }
  const auth = requireAuth(body);
  const senderId = auth.participant_id;
  const receiverId = normalizeParticipantId(body.receiver_id);
  const content = String(body.content || '').trim();

  if (!receiverId) return errorResponse('請選擇接收者');
  if (senderId === receiverId) return errorResponse('不能發送訊息給自己');
  if (!participantExists(receiverId)) return errorResponse('接收者不存在');
  if (!content) return errorResponse('訊息內容不能為空');
  if (content.length > MAX_MESSAGE_LENGTH) return errorResponse('訊息內容不能超過 ' + MAX_MESSAGE_LENGTH + ' 字');

  const messageId = generateMessageId();
  const createdAt = nowIso();
  const sheet = getSheet('Messages');
  sheet.appendRow([messageId, senderId, receiverId, content, createdAt, 'active', '']);
  invalidateMessagesCache();

  return successResponse({
    message_id: messageId,
    created_at: createdAt,
    messaging_status: getMessagingStatus()
  });
}

function fetchInbox(params) {
  const auth = requireAuth(params);
  const pid = auth.participant_id;
  const messages = getAllMessages()
    .filter(function (m) {
      return m.receiver_id === pid && m.status === 'active';
    })
    .map(function (m) {
      return {
        message_id: m.message_id,
        content: m.content,
        created_at: m.created_at
      };
    })
    .sort(function (a, b) { return b.created_at.localeCompare(a.created_at); });

  return successResponse({
    messages: messages,
    messaging_status: getMessagingStatus()
  });
}

function fetchSent(params) {
  const auth = requireAuth(params);
  const pid = auth.participant_id;
  const messages = getAllMessages()
    .filter(function (m) { return m.sender_id === pid; })
    .map(function (m) {
      return {
        message_id: m.message_id,
        receiver_id: m.receiver_id,
        content: m.content,
        created_at: m.created_at,
        status: m.status,
        deleted_at: m.deleted_at,
        deleted_reason: m.deleted_reason
      };
    })
    .sort(function (a, b) { return b.created_at.localeCompare(a.created_at); });

  const revision = getMessagesRevision(getAllMessages());
  return successResponse({
    sent_messages: messages,
    revision: revision,
    messaging_status: getMessagingStatus()
  });
}

function watchSentMessages(params) {
  const auth = requireAuth(params);
  const pid = auth.participant_id;
  const clientRevision = String(params.revision || '');

  if (clientRevision && getCachedMessagesRevision() === clientRevision) {
    return successResponse({
      changed: false,
      revision: clientRevision,
      messaging_status: getMessagingStatus()
    });
  }

  const allMessages = getAllMessages();
  const sentMessages = allMessages
    .filter(function (m) { return m.sender_id === pid; })
    .map(function (m) {
      return {
        message_id: m.message_id,
        receiver_id: m.receiver_id,
        content: m.content,
        created_at: m.created_at,
        status: m.status,
        deleted_at: m.deleted_at,
        deleted_reason: m.deleted_reason
      };
    })
    .sort(function (a, b) { return b.created_at.localeCompare(a.created_at); });

  const revision = rememberMessagesRevision(getMessagesRevision(allMessages));
  const changed = revision !== clientRevision;

  return successResponse({
    changed: changed,
    revision: revision,
    message_count: sentMessages.length,
    sent_messages: changed ? sentMessages : [],
    messaging_status: getMessagingStatus()
  });
}

function fetchAdminDashboard(params) {
  requireAdmin(params);
  const messages = getAllMessages().sort(function (a, b) {
    return b.created_at.localeCompare(a.created_at);
  });
  const revision = rememberMessagesRevision(getMessagesRevision(messages));
  return successResponse({
    role: 'admin',
    queue: getQueueSnapshot(),
    messages: messages,
    revision: revision,
    messaging_status: getMessagingStatus(),
    voting_status: getVotingStatus()
  });
}

function adminListMessages(params) {
  requireAdmin(params);
  const messages = getAllMessages().sort(function (a, b) {
    return b.created_at.localeCompare(a.created_at);
  });
  return successResponse({
    messages: messages,
    revision: getMessagesRevision(messages)
  });
}

function adminWatchMessages(params) {
  requireAdmin(params);
  const clientRevision = String(params.revision || '');

  if (clientRevision && getCachedMessagesRevision() === clientRevision) {
    return successResponse({
      changed: false,
      revision: clientRevision,
      messaging_status: getMessagingStatus(),
      queue: getQueueSnapshot()
    });
  }

  const messages = getAllMessages().sort(function (a, b) {
    return b.created_at.localeCompare(a.created_at);
  });
  const revision = rememberMessagesRevision(getMessagesRevision(messages));
  const changed = revision !== clientRevision;

  return successResponse({
    changed: changed,
    revision: revision,
    message_count: messages.length,
    messages: changed ? messages : [],
    messaging_status: getMessagingStatus(),
    queue: getQueueSnapshot()
  });
}

function adminDeleteMessage(params) {
  requireAdmin(params);
  const messageId = String(params.message_id || '');
  if (!messageId) return errorResponse('缺少 message_id');

  const sheet = getSheet('Messages');
  const rows = getSheetData(sheet);
  let found = false;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].message_id === messageId) {
      const rowNum = i + 2;
      sheet.getRange(rowNum, 6).setValue('deleted');
      sheet.getRange(rowNum, 7).setValue(nowIso());
      found = true;
      break;
    }
  }
  if (!found) return errorResponse('找不到該訊息');
  invalidateMessagesCache();
  return successResponse({ message_id: messageId });
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

function bootstrap() {
  return successResponse({
    participants: getParticipantsList(),
    messaging_status: getMessagingStatus(),
    version: SCRIPT_VERSION
  });
}

// ─── Voting Status ──────────────────────────────────────────────────────────

function getVotingConfig() {
  const cached = cacheGetJson(CACHE_KEY_VOTING_CONFIG);
  if (cached) return cached;

  // Read as one range: four separate getValue() calls were four round trips on
  // a path that the trophy poll hits constantly.
  const row = getSheet('Voting').getRange('A2:D2').getValues()[0];
  const rawStatus = String(row[0] || 'DRAFT').trim().toUpperCase();
  const valid = ['DRAFT', 'VOTING_OPEN', 'VOTING_CLOSED', 'CALCULATED', 'PUBLISHED'];
  const config = {
    voting_status: valid.indexOf(rawStatus) >= 0 ? rawStatus : 'DRAFT',
    allow_resubmit: String(row[1] || 'FALSE').trim().toUpperCase() === 'TRUE',
    calculated_at: String(row[2] || ''),
    published_at: String(row[3] || '')
  };
  cachePutJson(CACHE_KEY_VOTING_CONFIG, config, CACHE_TTL_STATUS);
  return config;
}

function getVotingStatus() {
  return getVotingConfig().voting_status;
}

function setVotingConfig(updates) {
  const sheet = getSheet('Voting');
  if (updates.voting_status !== undefined) {
    sheet.getRange('A2').setValue(String(updates.voting_status).trim().toUpperCase());
  }
  if (updates.allow_resubmit !== undefined) {
    sheet.getRange('B2').setValue(updates.allow_resubmit ? 'TRUE' : 'FALSE');
  }
  if (updates.calculated_at !== undefined) {
    sheet.getRange('C2').setValue(updates.calculated_at);
  }
  if (updates.published_at !== undefined) {
    sheet.getRange('D2').setValue(updates.published_at);
  }
  cacheRemove([CACHE_KEY_VOTING_CONFIG]);
  return getVotingConfig();
}

// ─── Trophy Data ──────────────────────────────────────────────────────────────

function getTrophies() {
  const cached = cacheGetJson(CACHE_KEY_TROPHIES);
  if (cached) return cached;

  const rows = getSheetData(getSheet('Trophy'));
  const trophies = rows
    .filter(function (r) {
      const id = String(r.Trophy_id || '').trim();
      return id && /^T\d+$/i.test(id);
    })
    .map(function (r) {
      return {
        trophy_id: String(r.Trophy_id).trim(),
        trophy_name: String(r.Trophy_name || r.Trophy_id).trim()
      };
    });
  cachePutJson(CACHE_KEY_TROPHIES, trophies, CACHE_TTL_PARTICIPANTS);
  return trophies;
}

function formatGroupLabel(groupId) {
  if (groupId === 'GROUP_STAFF') return '工作人員組';
  const m = String(groupId).match(/^GROUP_(\d+)$/);
  if (m) return '第 ' + m[1] + ' 組';
  return groupId;
}

function sortGroupIds(a, b) {
  if (a === 'GROUP_STAFF') return 1;
  if (b === 'GROUP_STAFF') return -1;
  const ma = String(a).match(/^GROUP_(\d+)$/);
  const mb = String(b).match(/^GROUP_(\d+)$/);
  if (ma && mb) return parseInt(ma[1], 10) - parseInt(mb[1], 10);
  return String(a).localeCompare(String(b));
}

function buildGroupVotingStatus(participants, submittedIds) {
  const submittedSet = {};
  submittedIds.forEach(function (id) { submittedSet[id] = true; });

  const groupMap = {};
  participants.forEach(function (p) {
    const gid = resolveEffectiveGroupId(p, participants);
    if (!groupMap[gid]) {
      groupMap[gid] = {
        group_id: gid,
        group_label: formatGroupLabel(gid),
        members: []
      };
    }
    groupMap[gid].members.push({
      participant_id: p.participant_id,
      voted: !!submittedSet[p.participant_id]
    });
  });

  Object.keys(groupMap).forEach(function (gid) {
    groupMap[gid].members.sort(function (a, b) {
      return a.participant_id.localeCompare(b.participant_id);
    });
  });

  return Object.keys(groupMap).sort(sortGroupIds).map(function (gid) {
    return groupMap[gid];
  });
}

/**
 * Once results are published every client polls for its own awards at the same
 * time, so the results table is cached whole and filtered per participant.
 */
function getAllTrophyResults() {
  const cached = cacheGetJson(CACHE_KEY_TROPHY_RESULTS);
  if (cached) return cached;

  const rows = getSheetData(getSheet('Trophy_results')).map(function (r) {
    return {
      participant_id: normalizeParticipantId(r.participant_id),
      trophy_id: String(r.Trophy_id),
      award_source: String(r.award_source || 'round1')
    };
  });
  cachePutJson(CACHE_KEY_TROPHY_RESULTS, rows, CACHE_TTL_STATUS);
  return rows;
}

function invalidateTrophyResultsCache() {
  cacheRemove([CACHE_KEY_TROPHY_RESULTS]);
}

function getParticipantAwards(participantId) {
  const pid = normalizeParticipantId(participantId);
  const trophyMap = {};
  getTrophies().forEach(function (t) { trophyMap[t.trophy_id] = t.trophy_name; });

  return getAllTrophyResults()
    .filter(function (r) { return r.participant_id === pid; })
    .map(function (r) {
      return {
        trophy_id: r.trophy_id,
        trophy_name: trophyMap[r.trophy_id] || r.trophy_id,
        award_source: r.award_source
      };
    });
}

function getTrophyDrafts(participantId) {
  const sheet = getSheet('Trophy_draft');
  const rows = getSheetData(sheet);
  const pid = normalizeParticipantId(participantId);
  return rows.filter(function (r) { return normalizeParticipantId(r.sender_id) === pid; });
}

function getTrophyLogs(participantId) {
  const sheet = getSheet('Trophy_log');
  const rows = getSheetData(sheet);
  if (participantId) {
    const pid = normalizeParticipantId(participantId);
    return rows.filter(function (r) { return normalizeParticipantId(r.sender_id) === pid; });
  }
  return rows;
}

function getSubmissionStatus(participantId) {
  const sheet = getSheet('Trophy_submissions');
  const rows = getSheetData(sheet);
  const pid = normalizeParticipantId(participantId);
  const row = rows.find(function (r) { return normalizeParticipantId(r.participant_id) === pid; });
  if (!row) return { submission_status: 'draft', submitted_at: '', updated_at: '' };
  return {
    submission_status: String(row.submission_status || 'draft').toLowerCase(),
    submitted_at: String(row.submitted_at || ''),
    updated_at: String(row.updated_at || '')
  };
}

function upsertSubmission(participantId, status) {
  const sheet = getSheet('Trophy_submissions');
  const rows = getSheetData(sheet);
  const pid = normalizeParticipantId(participantId);
  const now = nowIso();
  let found = false;
  for (let i = 0; i < rows.length; i++) {
    if (normalizeParticipantId(rows[i].participant_id) === pid) {
      const rowNum = i + 2;
      sheet.getRange(rowNum, 2).setValue(status);
      if (status === 'submitted') {
        sheet.getRange(rowNum, 3).setValue(now);
      }
      sheet.getRange(rowNum, 4).setValue(now);
      found = true;
      break;
    }
  }
  if (!found) {
    sheet.appendRow([pid, status, status === 'submitted' ? now : '', now]);
  }
}

function clearTrophyDrafts(participantId) {
  const sheet = getSheet('Trophy_draft');
  const rows = getSheetData(sheet);
  const pid = normalizeParticipantId(participantId);
  for (let i = rows.length - 1; i >= 0; i--) {
    if (normalizeParticipantId(rows[i].sender_id) === pid) {
      sheet.deleteRow(i + 2);
    }
  }
}

function clearTrophyLogs(participantId) {
  const sheet = getSheet('Trophy_log');
  const rows = getSheetData(sheet);
  const pid = normalizeParticipantId(participantId);
  for (let i = rows.length - 1; i >= 0; i--) {
    if (normalizeParticipantId(rows[i].sender_id) === pid) {
      sheet.deleteRow(i + 2);
    }
  }
}

function savePairingsToSheet(sheetName, participantId, pairings) {
  const sheet = getSheet(sheetName);
  const pid = normalizeParticipantId(participantId);

  // Remove existing rows for this participant
  const rows = getSheetData(sheet);
  for (let i = rows.length - 1; i >= 0; i--) {
    if (normalizeParticipantId(rows[i].sender_id) === pid) {
      sheet.deleteRow(i + 2);
    }
  }

  pairings.forEach(function (p) {
    sheet.appendRow([
      p.tmessage_id || generateTMessageId(),
      pid,
      normalizeParticipantId(p.receiver_id),
      String(p.trophy_id)
    ]);
  });
}

function buildAssignmentsFromRows(rows) {
  const assignments = {};
  rows.forEach(function (r) {
    const rid = normalizeParticipantId(r.receiver_id);
    const tid = String(r.Trophy_id || r.trophy_id);
    if (!assignments[rid]) assignments[rid] = [];
    if (assignments[rid].indexOf(tid) === -1) {
      assignments[rid].push(tid);
    }
  });
  return assignments;
}

function trophyBootstrap(params) {
  const auth = requireAuth(params);
  const pid = auth.participant_id;
  const config = getVotingConfig();
  const teammates = getTeammates(pid);
  const trophies = getTrophies();
  const submission = getSubmissionStatus(pid);

  let sourceRows;
  if (submission.submission_status === 'submitted') {
    sourceRows = getTrophyLogs(pid);
  } else {
    sourceRows = getTrophyDrafts(pid);
    if (sourceRows.length === 0) {
      sourceRows = getTrophyLogs(pid);
    }
  }

  const assignments = buildAssignmentsFromRows(sourceRows);
  const assignedCount = teammates.filter(function (t) {
    const ids = assignments[t.participant_id];
    return ids && ids.length > 0;
  }).length;

  const readonly = submission.submission_status === 'submitted' &&
    !config.allow_resubmit;

  const editable = config.voting_status === 'VOTING_OPEN' && !readonly;
  const showResults = config.voting_status === 'PUBLISHED' || config.voting_status === 'CALCULATED';
  const myAwards = showResults ? getParticipantAwards(pid) : [];
  const revision = buildTrophyWatchRevision(config.voting_status, myAwards, config.published_at);

  return successResponse({
    trophies: trophies,
    teammates: teammates,
    assignments: assignments,
    pairings: sourceRows.map(function (r) {
      return {
        tmessage_id: r.Tmessage_id,
        sender_id: normalizeParticipantId(r.sender_id),
        receiver_id: normalizeParticipantId(r.receiver_id),
        trophy_id: String(r.Trophy_id)
      };
    }),
    voting_status: config.voting_status,
    allow_resubmit: config.allow_resubmit,
    submission_status: submission.submission_status,
    submitted_at: submission.submitted_at,
    progress: {
      assigned: assignedCount,
      total: teammates.length
    },
    readonly: readonly,
    editable: editable,
    show_results: showResults,
    my_awards: myAwards,
    revision: revision,
    published_at: config.published_at,
    messaging_status: getMessagingStatus()
  });
}

function buildTrophyWatchRevision(votingStatus, myAwards, publishedAt) {
  const awardsKey = (myAwards || []).map(function (a) {
    return a.trophy_id + ':' + a.award_source;
  }).sort().join('|');
  return votingStatus + '\u0001' + awardsKey + '\u0001' + String(publishedAt || '');
}

function watchTrophyStatus(params) {
  const auth = requireAuth(params);
  const pid = auth.participant_id;
  const config = getVotingConfig();
  const clientRevision = String(params.revision || '');
  const showResults = config.voting_status === 'PUBLISHED' || config.voting_status === 'CALCULATED';
  const myAwards = showResults ? getParticipantAwards(pid) : [];
  const revision = buildTrophyWatchRevision(config.voting_status, myAwards, config.published_at);
  const changed = revision !== clientRevision;

  return successResponse({
    changed: changed,
    revision: revision,
    voting_status: config.voting_status,
    show_results: showResults,
    my_awards: changed ? myAwards : [],
    published_at: config.published_at
  });
}

function validatePairings(participantId, pairings, requireComplete) {
  const teammates = getTeammates(participantId);
  const teammateIds = teammates.map(function (t) { return t.participant_id; });
  const trophies = getTrophies();
  const trophyIds = trophies.map(function (t) { return t.trophy_id; });

  const byReceiver = {};
  pairings.forEach(function (p) {
    const rid = normalizeParticipantId(p.receiver_id);
    const tid = String(p.trophy_id);
    if (teammateIds.indexOf(rid) === -1) {
      throw new Error('無效的隊友：' + rid);
    }
    if (trophyIds.indexOf(tid) === -1) {
      throw new Error('無效的 Trophy：' + tid);
    }
    if (!byReceiver[rid]) byReceiver[rid] = [];
    if (byReceiver[rid].indexOf(tid) === -1) {
      byReceiver[rid].push(tid);
    }
  });

  if (requireComplete) {
    teammates.forEach(function (t) {
      if (!byReceiver[t.participant_id] || byReceiver[t.participant_id].length === 0) {
        throw new Error('請為每位隊友至少分配一個 Trophy');
      }
    });
  }

  return pairings.map(function (p) {
    return {
      receiver_id: normalizeParticipantId(p.receiver_id),
      trophy_id: String(p.trophy_id),
      tmessage_id: p.tmessage_id || generateTMessageId()
    };
  });
}

function trophySaveDraft(body) {
  const auth = requireAuth(body);
  const pid = auth.participant_id;
  const config = getVotingConfig();

  if (config.voting_status !== 'VOTING_OPEN') {
    return errorResponse('投票尚未開放');
  }

  const submission = getSubmissionStatus(pid);
  if (submission.submission_status === 'submitted' && !config.allow_resubmit) {
    return errorResponse('已提交，無法修改');
  }

  const pairings = validatePairings(pid, body.pairings || [], false);
  savePairingsToSheet('Trophy_draft', pid, pairings);
  upsertSubmission(pid, 'draft');

  return successResponse({ saved: true });
}

function trophySubmit(body) {
  const auth = requireAuth(body);
  const pid = auth.participant_id;
  const config = getVotingConfig();

  if (config.voting_status !== 'VOTING_OPEN') {
    return errorResponse('投票尚未開放');
  }

  const submission = getSubmissionStatus(pid);
  if (submission.submission_status === 'submitted' && !config.allow_resubmit) {
    return errorResponse('已提交，無法重複提交');
  }

  const pairings = validatePairings(pid, body.pairings || [], true);
  savePairingsToSheet('Trophy_log', pid, pairings);
  clearTrophyDrafts(pid);
  upsertSubmission(pid, 'submitted');

  return successResponse({ submitted: true });
}

// ─── Admin Trophy ─────────────────────────────────────────────────────────────

function adminTrophyOverview(params) {
  requireAdmin(params);
  const config = getVotingConfig();
  const participants = getParticipantsList();
  const allLogs = getTrophyLogs();
  const submissions = getSheetData(getSheet('Trophy_submissions'));
  const trophies = getTrophies();

  const submittedIds = submissions
    .filter(function (s) { return String(s.submission_status).toLowerCase() === 'submitted'; })
    .map(function (s) { return normalizeParticipantId(s.participant_id); });

  const pending = participants
    .filter(function (p) { return submittedIds.indexOf(p.participant_id) === -1; })
    .map(function (p) { return p.participant_id; });

  const groupVotingStatus = buildGroupVotingStatus(participants, submittedIds);

  const receiversWithTrophy = {};
  allLogs.forEach(function (r) {
    receiversWithTrophy[normalizeParticipantId(r.receiver_id)] = true;
  });

  return successResponse({
    stats: {
      total_participants: participants.length,
      completed_voters: submittedIds.length,
      total_votes: allLogs.length,
      trophy_count: trophies.length,
      participants_with_trophy: Object.keys(receiversWithTrophy).length
    },
    pending_participants: pending,
    group_voting_status: groupVotingStatus,
    voting_status: config.voting_status,
    allow_resubmit: config.allow_resubmit,
    calculated_at: config.calculated_at,
    published_at: config.published_at
  });
}

function adminTrophyAudit(params) {
  requireAdmin(params);
  const rows = getTrophyLogs();
  const trophies = getTrophies();
  const trophyMap = {};
  trophies.forEach(function (t) { trophyMap[t.trophy_id] = t.trophy_name; });

  const votes = rows.map(function (r) {
    const tid = String(r.Trophy_id);
    return {
      tmessage_id: r.Tmessage_id,
      sender_id: normalizeParticipantId(r.sender_id),
      receiver_id: normalizeParticipantId(r.receiver_id),
      trophy_id: tid,
      trophy_name: trophyMap[tid] || tid
    };
  });

  return successResponse({ votes: votes });
}

function adminTrophyResults(params) {
  requireAdmin(params);
  const sheet = getSheet('Trophy_results');
  const rows = getSheetData(sheet);
  const trophies = getTrophies();
  const participants = getParticipantsList();
  const trophyMap = {};
  trophies.forEach(function (t) { trophyMap[t.trophy_id] = t.trophy_name; });

  const allLogs = getTrophyLogs();
  const voteCountMap = {};
  allLogs.forEach(function (v) {
    const key = normalizeParticipantId(v.receiver_id) + '|' + String(v.Trophy_id);
    voteCountMap[key] = (voteCountMap[key] || 0) + 1;
  });

  let fallbackActivated = false;
  const profileMap = {};
  participants.forEach(function (p) {
    profileMap[p.participant_id] = { participant_id: p.participant_id, trophies: [] };
  });

  rows.forEach(function (r) {
    const pid = normalizeParticipantId(r.participant_id);
    const tid = String(r.Trophy_id);
    const source = String(r.award_source || 'round1');
    if (source === 'fallback') fallbackActivated = true;
    if (!profileMap[pid]) {
      profileMap[pid] = { participant_id: pid, trophies: [] };
    }
    const voteCount = voteCountMap[pid + '|' + tid] || 0;
    profileMap[pid].trophies.push({
      trophy_id: tid,
      trophy_name: trophyMap[tid] || tid,
      vote_count: voteCount,
      award_source: source
    });
  });

  const trophySummary = {};
  rows.forEach(function (r) {
    const tid = String(r.Trophy_id);
    if (!trophySummary[tid]) {
      trophySummary[tid] = {
        trophy_id: tid,
        trophy_name: trophyMap[tid] || tid,
        winners: []
      };
    }
    trophySummary[tid].winners.push({
      participant_id: normalizeParticipantId(r.participant_id),
      award_source: String(r.award_source || 'round1')
    });
  });

  return successResponse({
    profiles: Object.values(profileMap),
    trophy_summary: Object.values(trophySummary),
    fallback_activated: fallbackActivated,
    voting_status: getVotingStatus()
  });
}

function adminSetVotingStatus(params) {
  requireAdmin(params);
  const newStatus = String(params.voting_status || params.status || '').trim().toUpperCase();
  const valid = ['DRAFT', 'VOTING_OPEN', 'VOTING_CLOSED', 'CALCULATED', 'PUBLISHED'];
  if (valid.indexOf(newStatus) === -1) {
    return errorResponse('無效的投票狀態');
  }

  const current = getVotingConfig();
  const updates = { voting_status: newStatus };

  if (params.allow_resubmit !== undefined) {
    updates.allow_resubmit = params.allow_resubmit === true ||
      String(params.allow_resubmit).toUpperCase() === 'TRUE';
  }

  if (newStatus === 'VOTING_OPEN') {
    updates.published_at = '';
    if (current.voting_status === 'PUBLISHED' ||
        current.voting_status === 'CALCULATED' ||
        current.voting_status === 'VOTING_CLOSED') {
      updates.calculated_at = '';
      if (params.allow_resubmit === undefined) {
        updates.allow_resubmit = true;
      }
    }
  }

  if (newStatus === 'DRAFT') {
    updates.published_at = '';
    updates.calculated_at = '';
    if (params.allow_resubmit === undefined) {
      updates.allow_resubmit = false;
    }
  }

  if (newStatus === 'VOTING_CLOSED') {
    updates.published_at = '';
  }

  if (newStatus === 'CALCULATED') {
    updates.calculated_at = nowIso();
    updates.published_at = '';
  }

  if (newStatus === 'PUBLISHED') {
    if (current.voting_status !== 'CALCULATED' && current.voting_status !== 'PUBLISHED') {
      return errorResponse('請先按「計算結果」再公布');
    }
    updates.published_at = nowIso();
  }

  const config = setVotingConfig(updates);
  return successResponse(config);
}

function adminResetParticipantVote(params) {
  requireAdmin(params);
  const pid = normalizeParticipantId(params.target_participant_id || params.participant_id);
  if (!pid || pid === ADMIN_ID) return errorResponse('無效的參加者');
  resetParticipantTrophyData(pid);
  return successResponse({ reset: true, participant_id: pid });
}

function resetParticipantTrophyData(participantId) {
  const pid = normalizeParticipantId(participantId);
  clearTrophyLogs(pid);
  clearTrophyDrafts(pid);
  const sheet = getSheet('Trophy_submissions');
  const rows = getSheetData(sheet);
  for (let i = rows.length - 1; i >= 0; i--) {
    if (normalizeParticipantId(rows[i].participant_id) === pid) {
      sheet.deleteRow(i + 2);
    }
  }
}

function clearTrophyResultsForParticipant(participantId) {
  const pid = normalizeParticipantId(participantId);
  const sheet = getSheet('Trophy_results');
  const rows = getSheetData(sheet);
  for (let i = rows.length - 1; i >= 0; i--) {
    if (normalizeParticipantId(rows[i].participant_id) === pid) {
      sheet.deleteRow(i + 2);
    }
  }
  invalidateTrophyResultsCache();
}

function deleteParticipantSentMessages(participantId) {
  const pid = normalizeParticipantId(participantId);
  const sheet = getSheet('Messages');
  const rows = getSheetData(sheet);
  let count = 0;
  const now = nowIso();
  for (let i = 0; i < rows.length; i++) {
    if (normalizeParticipantId(rows[i].sender_id) === pid &&
        String(rows[i].status || 'active').toLowerCase() !== 'deleted') {
      sheet.getRange(i + 2, 6).setValue('deleted');
      sheet.getRange(i + 2, 7).setValue(now);
      count++;
    }
  }
  if (count > 0) invalidateMessagesCache();
  return count;
}

function updateParticipantRecord(participantId, updates) {
  const pid = normalizeParticipantId(participantId);
  const sheet = getSheet('Participants');
  const rows = getSheetData(sheet);
  for (let i = 0; i < rows.length; i++) {
    if (normalizeParticipantId(rows[i].participant_id) === pid) {
      const rowNum = i + 2;
      if (updates.phone_number !== undefined) {
        sheet.getRange(rowNum, 2).setValue(normalizePhone(updates.phone_number));
      }
      if (updates.group_id !== undefined) {
        sheet.getRange(rowNum, 3).setValue(String(updates.group_id).trim());
      }
      invalidateParticipantsMemo();
      return true;
    }
  }
  return false;
}

function adminParticipantDetail(params) {
  requireAdmin(params);
  const pid = normalizeParticipantId(params.target_participant_id || params.participant_id);
  if (!pid || pid === ADMIN_ID) return errorResponse('無效的參加者');

  const participants = getParticipantsList();
  const participant = participants.find(function (p) { return p.participant_id === pid; });
  if (!participant) return errorResponse('找不到該參加者');

  const messages = getAllMessages();
  const sentAll = messages.filter(function (m) { return m.sender_id === pid; });
  const sentActive = sentAll.filter(function (m) { return m.status === 'active'; });
  const receivedActive = messages.filter(function (m) {
    return m.receiver_id === pid && m.status === 'active';
  });
  const trophyVotes = getTrophyLogs().filter(function (r) {
    return normalizeParticipantId(r.sender_id) === pid;
  }).length;
  const submission = getSubmissionStatus(pid);
  const awards = getParticipantAwards(pid);

  return successResponse({
    participant: {
      participant_id: participant.participant_id,
      phone_number: participant.phone_number,
      group_id: resolveEffectiveGroupId(participant)
    },
    stats: {
      sent_total: sentAll.length,
      sent_active: sentActive.length,
      sent_deleted: sentAll.length - sentActive.length,
      received_active: receivedActive.length,
      trophy_votes: trophyVotes,
      submission_status: submission.submission_status,
      trophy_awards: awards.length
    }
  });
}

function adminUpdateParticipant(params) {
  requireAdmin(params);
  const pid = normalizeParticipantId(params.target_participant_id || params.participant_id);
  if (!pid || pid === ADMIN_ID) return errorResponse('無效的參加者');

  const phone = params.new_phone_number !== undefined
    ? normalizePhone(params.new_phone_number) : undefined;
  const groupId = params.group_id !== undefined ? String(params.group_id).trim() : undefined;

  if (phone === undefined && groupId === undefined) {
    return errorResponse('請提供要更新的欄位');
  }
  if (phone !== undefined && !phone) {
    return errorResponse('電話號碼不能為空');
  }

  const updates = {};
  if (phone !== undefined) updates.phone_number = phone;
  if (groupId !== undefined) updates.group_id = groupId;

  if (!updateParticipantRecord(pid, updates)) {
    return errorResponse('找不到該參加者');
  }

  const updated = getParticipantsList().find(function (p) { return p.participant_id === pid; });
  return successResponse({
    participant: {
      participant_id: pid,
      phone_number: updated ? updated.phone_number : phone,
      group_id: updated ? resolveEffectiveGroupId(updated) : groupId
    }
  });
}

function adminDeleteParticipantRecords(params) {
  requireAdmin(params);
  const pid = normalizeParticipantId(params.target_participant_id || params.participant_id);
  if (!pid || pid === ADMIN_ID) return errorResponse('無效的參加者');

  if (!participantExists(pid)) return errorResponse('找不到該參加者');

  const deleteMessages = params.delete_messages !== false && String(params.delete_messages).toUpperCase() !== 'FALSE';
  const deleteTrophy = params.delete_trophy !== false && String(params.delete_trophy).toUpperCase() !== 'FALSE';
  const deleteResults = params.delete_results !== false && String(params.delete_results).toUpperCase() !== 'FALSE';

  let messagesDeleted = 0;
  if (deleteMessages) {
    messagesDeleted = deleteParticipantSentMessages(pid);
  }
  if (deleteTrophy) {
    resetParticipantTrophyData(pid);
  }
  if (deleteResults) {
    clearTrophyResultsForParticipant(pid);
  }

  return successResponse({
    participant_id: pid,
    messages_deleted: messagesDeleted,
    trophy_reset: deleteTrophy,
    results_cleared: deleteResults
  });
}

function adminBulkUpdateParticipants(params) {
  requireAdmin(params);
  const mode = String(params.mode || '').toLowerCase();
  const participants = getParticipantsList();
  let updated = 0;

  if (mode === 'auto_group') {
    participants.forEach(function (p) {
      var gid = deriveGroupIdFromParticipantId(p.participant_id);
      if (updateParticipantRecord(p.participant_id, { group_id: gid })) {
        updated++;
      }
    });
    return successResponse({
      mode: mode,
      updated: updated,
      message: '已自動修正 ' + updated + ' 位參加者的分組'
    });
  }

  if (mode === 'set_group_id') {
    var groupId = String(params.group_id || '').trim();
    if (!groupId) return errorResponse('請提供分組 group_id');
    participants.forEach(function (p) {
      if (updateParticipantRecord(p.participant_id, { group_id: groupId })) {
        updated++;
      }
    });
    return successResponse({
      mode: mode,
      updated: updated,
      group_id: groupId,
      message: '已將分組套用到 ' + updated + ' 位參加者'
    });
  }

  return errorResponse('無效的批量模式');
}

function adminBulkDeleteAllRecords(params) {
  requireAdmin(params);
  var participants = getParticipantsList();
  var totalMessages = 0;

  participants.forEach(function (p) {
    totalMessages += deleteParticipantSentMessages(p.participant_id);
    resetParticipantTrophyData(p.participant_id);
    clearTrophyResultsForParticipant(p.participant_id);
  });

  return successResponse({
    participants_processed: participants.length,
    messages_deleted: totalMessages,
    message: '已清除 ' + participants.length + ' 位參加者的全部紀錄'
  });
}

// ─── Trophy Calculation ───────────────────────────────────────────────────────

function adminCalculateTrophyResults(params) {
  requireAdmin(params);
  calculateTrophyResults();
  setVotingConfig({ voting_status: 'CALCULATED', calculated_at: nowIso() });
  return successResponse({ calculated: true, voting_status: 'CALCULATED' });
}

function calculateTrophyResults() {
  const participants = getParticipantsList();
  const trophies = getTrophies();
  const allLogs = getTrophyLogs();
  const calculatedAt = nowIso();

  // Count votes: receiver_id + trophy_id -> count
  const voteCounts = {};
  allLogs.forEach(function (r) {
    const key = normalizeParticipantId(r.receiver_id) + '|' + String(r.Trophy_id);
    voteCounts[key] = (voteCounts[key] || 0) + 1;
  });

  const results = [];
  const participantTrophyCount = {};
  participants.forEach(function (p) {
    participantTrophyCount[p.participant_id] = 0;
  });

  // Round 1: Group-wide max votes per trophy
  trophies.forEach(function (trophy) {
    const tid = trophy.trophy_id;
    let maxCount = 0;
    participants.forEach(function (p) {
      const key = p.participant_id + '|' + tid;
      const count = voteCounts[key] || 0;
      if (count > maxCount) maxCount = count;
    });

    if (maxCount > 0) {
      participants.forEach(function (p) {
        const key = p.participant_id + '|' + tid;
        const count = voteCounts[key] || 0;
        if (count === maxCount) {
          results.push({
            participant_id: p.participant_id,
            trophy_id: tid,
            award_source: 'round1'
          });
          participantTrophyCount[p.participant_id]++;
        }
      });
    }
  });

  // Fallback: participants with zero trophies
  let fallbackActivated = false;
  participants.forEach(function (p) {
    if (participantTrophyCount[p.participant_id] > 0) return;

    fallbackActivated = true;
    let bestTrophy = null;
    let bestCount = -1;

    trophies.forEach(function (trophy) {
      const key = p.participant_id + '|' + trophy.trophy_id;
      const count = voteCounts[key] || 0;
      if (count > bestCount) {
        bestCount = count;
        bestTrophy = trophy.trophy_id;
      }
    });

    if (bestTrophy === null && trophies.length > 0) {
      bestTrophy = trophies[0].trophy_id;
      bestCount = 0;
    }

    if (bestTrophy !== null) {
      // Assign all trophies tied at personal max
      trophies.forEach(function (trophy) {
        const key = p.participant_id + '|' + trophy.trophy_id;
        const count = voteCounts[key] || 0;
        if (count === bestCount && count >= 0) {
          const already = results.some(function (r) {
            return r.participant_id === p.participant_id && r.trophy_id === trophy.trophy_id;
          });
          if (!already) {
            results.push({
              participant_id: p.participant_id,
              trophy_id: trophy.trophy_id,
              award_source: 'fallback'
            });
            participantTrophyCount[p.participant_id]++;
          }
        }
      });

      // Safety: if still zero (no votes at all), assign first trophy
      if (participantTrophyCount[p.participant_id] === 0 && trophies.length > 0) {
        results.push({
          participant_id: p.participant_id,
          trophy_id: trophies[0].trophy_id,
          award_source: 'fallback'
        });
        participantTrophyCount[p.participant_id]++;
      }
    }
  });

  // Safety net: assert everyone has at least one trophy
  participants.forEach(function (p) {
    if (participantTrophyCount[p.participant_id] === 0 && trophies.length > 0) {
      results.push({
        participant_id: p.participant_id,
        trophy_id: trophies[0].trophy_id,
        award_source: 'fallback'
      });
      fallbackActivated = true;
    }
  });

  // Write to Trophy_results sheet
  const sheet = getSheet('Trophy_results');
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 4).clearContent();
  }
  if (results.length > 0) {
    // One write for the whole table: appending row by row was hundreds of
    // round trips and put this close to the execution time limit.
    sheet.getRange(2, 1, results.length, 4).setValues(results.map(function (r) {
      return [r.participant_id, r.trophy_id, r.award_source, calculatedAt];
    }));
  }
  invalidateTrophyResultsCache();

  return { results: results, fallback_activated: fallbackActivated };
}
