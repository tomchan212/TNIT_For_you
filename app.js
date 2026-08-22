/* ═══════════════════════════════════════════════════════════════════════════
   HKCYSTINTJustForYou — Frontend Application
   Sections: Configuration, State, DOM, Utilities, Data, Combobox,
             Messaging, Admin Monitor, 獎項, Init
   ═══════════════════════════════════════════════════════════════════════════ */

import * as data from './firebase-data.js?v=f6ec941';

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
  "小你老母", "吊你老母", "小你老味", "你老味", "你老母", "老.母", "老 母", "老母係街市賣鴨蛋",
  "含能", "臭化西", "臭西", "傻西", "凸你", "屌.你", "屌 你", "屌你", "吊你", "小你", "賓州",
  "九兩菜", "收皮啦", "收皮", "把撚", "條撚", "賓周", "賓.周", "仆街", "仆.街", "卜街", "POP街",
  "diu 9", "sub 9", "sub9", "chi lan sin", "撚樣", "能樣", "柒頭", "笨七", "鳩登", "膠登",
  "契弟", "ass hole", "asshole", "A S S", "on lun 7 7", "臭爛袋", "挑那星", "陷家剷", "陷家",
  "吊夠", "吊 夠", "戇尻尻", "戇尻", "戇-尻", "戇 尻", "on 99", "ON 九", "on 9", "on.9", "on9",
  "ｏｎ ９９", "戇鳩", "戇.鳩", "撚屌鳩", "d i u", "DIU", "fxxk", "fuxk", "fxck", "suck", "bitch",
  "fuck", "f u c k", "dllm", "D l l m", "DLLM", "戇尻膠", "Penis",
  "onL9", "ass", "shit", "shitting", "C8", "バカ", "8卡", "Vagina",
  "撚", "屌", "尻", "鳩", "柒", "仆", "𨳒", "𨳊", "𨳍", "冚家剷", "食屎狗", "屎", "蛋散", "On nine dog", "閪",
  "CNM", "傻逼", "CLS", "7頭皮", "Weed", "Smoke", "D I U", "D iu", "Di u", "尸口巾", "Seven head boy", 
  "吊梨老尾", "幹你娘", "含L", "碌7啦", "pk", "Nigger", "c 8", "馬鹿やろ", "nigga", "米田共", "乜9",
  "&#23628;", "&#x5C4C;", "&#x5C3B;", "&#23611;", "&#x649A;", "&#25754;"
];

// ─── State ──────────────────────────────────────────────────────────────────

const state = {
  participantId: null,
  sessionStartedAt: 0,
  handledForceLogoutRev: 0,
  isLoggingOut: false,
  participants: [],
  // group_id -> { display_name, messaging_status, voting_status, ... }
  groupMeta: {},
  inboxMessages: [],
  sentMessages: [],
  messagingOpen: true,
  isAdmin: false,
  monitorMessages: [],
  monitorViewFilter: 'all',
  monitorGroupFilter: '',
  staffMonitorMessages: [],
  staffMonitorBootstrapped: false,
  staffKnownMessageIds: new Set(),
  staffTrophy: {
    overview: null,
    auditVotes: [],
    profiles: [],
    trophySummary: [],
    trophies: [],
    submissions: [],
    results: []
  },
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
    submissionStatus: '',
    progress: { assigned: 0, total: 0 },
    myAwards: [],
    showResults: false,
    trophyRevision: '',
    resultsModalRevision: '',
    reviewSubmitted: false
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
  adminForceLogoutTarget: null,
  presence: [],
  staffGroup: {
    submissions: [],
    results: []
  }
};

let adminParticipantCombobox = null;

// Every open Firestore listener, so signing out can close all of them.
let subscriptions = [];
let resultUnsubscribe = null;
// Status toasts only after login listeners settle — first snapshots are baseline,
// not "open/close just happened".
let statusChangeNoticesReady = false;
let lastNotifiedVotingStatus = null;
let lastNotifiedMessagingOpen = null;
let presenceHeartbeatTimer = null;
let adminLoginStatusRefreshTimer = null;

const ONBOARDING_STEPS = {
  participant: [
    {
      target: '[data-tour="participant-greeting"]',
      prepare: 'home',
      title: '你好',
      body: '登入後會見你嘅名字。下面功能卡同底部導航就係主要入口；右上角「？」可重睇本頁說明。'
    },
    {
      target: '[data-tour="home-unassigned"]',
      prepare: 'home',
      title: '尚未分組',
      body: '如果仲未分配組別，會見到呢個提示。分組完成前唔可以留言同投票，請等工作人員安排。'
    },
    {
      target: '#screen-participant .home-card[data-nav="send"]',
      prepare: 'home',
      title: '匿名留言',
      body: '撳呢個框開始寫鼓勵說話畀隊友。對方只會見到內容，唔知邊個 send。'
    },
    {
      target: '#screen-participant .home-card[data-nav="inbox"]',
      prepare: 'home',
      title: '收件箱',
      body: '睇收到嘅匿名留言。有新訊息時呢度同底部 Inbox 會有提示。'
    },
    {
      target: '#screen-participant .home-card[data-nav="trophy"]',
      prepare: 'home',
      skipIfStaff: true,
      title: '獎項配對',
      body: '投票開放後，喺呢度為每位隊友配對獎項；亦可睇「獎項摘要」了解每個獎嘅意思。'
    },
    {
      target: '#screen-participant .home-card[data-nav="sent"]',
      prepare: 'home',
      title: '已發送',
      body: '睇返自己已經 send 出嘅留言。'
    },
    {
      target: '#home-staff-card',
      prepare: 'home',
      title: '本組管理',
      body: 'Staff 負責人才會見呢個框：監控本組留言、改組名、控制本組投票同睇本組結果。'
    },
    {
      target: '#screen-participant .bottom-nav-item[data-tab="home"]',
      prepare: 'home',
      title: '底部・首頁',
      body: '隨時返到首頁功能卡。'
    },
    {
      target: '#screen-participant .bottom-nav-item[data-tab="inbox"]',
      prepare: 'home',
      title: '底部・Inbox',
      body: '快捷入口去收件箱；有未讀會顯示數字。'
    },
    {
      target: '#screen-participant .bottom-nav-item[data-tab="trophy"]',
      prepare: 'home',
      skipIfStaff: true,
      title: '底部・獎項',
      body: '快捷入口去投票、獎項摘要同睇得獎結果。'
    },
    {
      target: '#screen-participant .bottom-nav-item[data-tab="profile"]',
      prepare: 'home',
      title: '底部・我的',
      body: '個人資料、改顯示名稱、改密碼同登出都喺呢度。'
    },
    {
      target: '[data-tour="send-guide"]',
      prepare: 'send',
      title: '寫多啲',
      body: '盡量寫具體：你欣賞對方咩、邊件事令你記得。寫唔出就即刻搵 TNIT Staff 幫手。'
    },
    {
      target: '[data-tour="send-receiver"]',
      prepare: 'send',
      title: '揀接收者',
      body: '輸入或展開選單，只可以揀自己組嘅隊友。'
    },
    {
      target: '[data-tour="send-content"]',
      prepare: 'send',
      title: '留言內容',
      body: '最多 300 字。唔好得一句「加油」，講多啲感受同原因。'
    },
    {
      target: '[data-tour="send-submit"]',
      prepare: 'send',
      title: '發送留言',
      body: '寫好就撳呢度送出。送出後會去「已發送」。'
    },
    {
      target: '[data-tour="inbox-toolbar"]',
      prepare: 'inbox',
      title: '收件箱頁面',
      body: '呢度列出所有收到嘅留言；右邊掣可以手動重新整理。對方唔會見到你係邊個。'
    },
    {
      target: '[data-tour="inbox-list"], [data-tour="inbox-empty"]',
      prepare: 'inbox',
      title: '留言列表',
      body: '有留言會一則一則顯示；暫時冇就會見空狀態提示。收件箱只顯示內容，唔顯示邊個寄。'
    },
    {
      target: '[data-tour="sent-toolbar"]',
      prepare: 'sent',
      title: '已發送頁面',
      body: '左邊返回首頁，右邊可重新整理已發清單。'
    },
    {
      target: '[data-tour="sent-list"], [data-tour="sent-empty"]',
      prepare: 'sent',
      title: '已發列表',
      body: '睇自己 send 過嘅內容同時間。'
    },
    {
      target: '[data-tour="trophy-guide"]',
      prepare: 'trophy',
      skipIfStaff: true,
      title: '獎項摘要',
      body: '投票未關閉時可撳呢度，左右滑睇每個獎項嘅貼圖同說明，再決定點樣配對。'
    },
    {
      target: '[data-tour="trophy-voting"], [data-tour="trophy-not-open"], [data-tour="trophy-results"]',
      prepare: 'trophy',
      skipIfStaff: true,
      title: '獎項頁面',
      body: '投票未開始會見提示；開放後喺呢度配對；提交後可「查看我的配對」；公布後可睇你嘅得獎。'
    },
    {
      target: '[data-tour="trophy-progress"]',
      prepare: 'trophy',
      skipIfStaff: true,
      title: '配對進度',
      body: '顯示你已經為幾多位隊友配咗獎項。'
    },
    {
      target: '[data-tour="trophy-teammates"]',
      prepare: 'trophy',
      skipIfStaff: true,
      title: '隊友清單',
      body: '每位隊友下面有獎項掣，揀一個配對（每位至少一個；每個獎項只能配一位）。'
    },
    {
      target: '[data-tour="trophy-actions"]',
      prepare: 'trophy',
      skipIfStaff: true,
      title: '提交投票',
      body: '配對完成後撳「提交投票」正式交卷（提交後不可再改，除非管理員重開）；「清除全部投票」可以一次清空重揀。'
    },
    {
      target: '[data-tour="profile-header"]',
      prepare: 'profile',
      title: '個人資料卡',
      body: '顯示名稱、組別同登入編號。'
    },
    {
      target: '[data-tour="profile-rename"]',
      prepare: 'profile',
      title: '改顯示名稱',
      body: '改名會出現喺名單同留言顯示；登入仍然用原本編號。'
    },
    {
      target: '[data-tour="profile-password"]',
      prepare: 'profile',
      title: '修改密碼',
      body: '可以喺呢度改登入密碼；改完之後請用新密碼再登入。'
    },
    {
      target: '[data-tour="profile-push"]',
      prepare: 'profile',
      title: '推送通知',
      body: '請保持 App 開住（可以收埋去背景，唔好完全關掉），先至收到通知。'
    },
    {
      target: '[data-tour="profile-stats"]',
      prepare: 'profile',
      title: '個人統計',
      body: '已發／收到留言數量、組別同投票狀態。'
    },
    {
      target: '[data-tour="profile-logout"]',
      prepare: 'profile',
      title: '登出',
      body: '活動完或換機時撳呢度登出。'
    },
    {
      target: '[data-tour="staff-toolbar"]',
      prepare: 'staff',
      staffSection: 'dashboard',
      title: 'Staff 頁面',
      body: '同 Admin 控制台類似：上面切換 Dashboard、Messages、Voting、Results，只係範圍限於你負責嗰組。'
    },
    {
      target: '[data-tour="staff-group-card"]',
      prepare: 'staff',
      staffSection: 'dashboard',
      title: '負責組別',
      body: '可以睇目前負責邊一組，同埋改呢組顯示名稱。'
    },
    {
      target: '[data-tour="staff-stats"]',
      prepare: 'staff',
      staffSection: 'dashboard',
      title: '本組數字',
      body: '組員人數、留言同投票狀態會即時更新。'
    },
    {
      target: '[data-tour="staff-login-status"]',
      prepare: 'staff',
      staffSection: 'dashboard',
      title: '登入狀況',
      body: '睇本組成員邊個已登入。可以強制登出個別參加者，或一次過登出全組。'
    },
    {
      target: '[data-tour="staff-live-load"]',
      prepare: 'staff',
      staffSection: 'dashboard',
      title: '即時負載',
      body: '本組近幾分鐘留言同投票進度。'
    },
    {
      target: '[data-tour="staff-message-controls"]',
      prepare: 'staff',
      staffSection: 'messages',
      title: '本組留言控制',
      body: '只會影響你負責嗰組；Admin 全域關閉時仍然會全部停用。'
    },
    {
      target: '[data-tour="staff-monitor"]',
      prepare: 'staff',
      staffSection: 'messages',
      title: '組內留言監控',
      body: '即時睇同組成員之間嘅留言（含發送／接收者），亦可撤回或取消撤回。參加者自己嘅收件箱仍然匿名。'
    },
    {
      target: '[data-tour="staff-voting-controls"]',
      prepare: 'staff',
      staffSection: 'voting',
      title: '本組投票狀態',
      body: '顯示呢組投票而家停喺邊一步；可能係跟隨全域，亦可能係本組獨立控制。'
    },
    {
      target: '[data-tour="staff-voting-stepper"]',
      prepare: 'staff',
      staffSection: 'voting',
      title: '流程進度',
      body: '由開放投票 → 關閉 → 計算 → 公布，清楚見到而家去到邊。'
    },
    {
      target: '[data-tour="staff-voting-stats"]',
      prepare: 'staff',
      staffSection: 'voting',
      title: '本組投票統計',
      body: '本組提交進度、已投／未投等人數摘要。'
    },
    {
      target: '[data-tour="staff-voting-actions"]',
      prepare: 'staff',
      staffSection: 'voting',
      title: '本組投票操作',
      body: '可以幫自己負責嗰組開放、關閉、計算結果同公布結果。'
    },
    {
      target: '[data-tour="staff-follow-global"]',
      prepare: 'staff',
      staffSection: 'voting',
      title: '恢復跟隨全域',
      body: '如果本組曾經獨立改過投票狀態，可以撳呢度改返跟隨 Admin 全域設定。'
    },
    {
      target: '[data-tour="staff-pending-voters"]',
      prepare: 'staff',
      staffSection: 'voting',
      title: '本組投票詳情',
      body: '睇邊個未交票；亦可打開投票總覽矩陣，核對組內配對情況。'
    },
    {
      target: '[data-tour="staff-result-tabs"]',
      prepare: 'staff',
      staffSection: 'results',
      staffResultTab: 'audit',
      title: '本組結果分頁',
      body: '三個分頁：投票審計、個人檔案、獎項摘要，只顯示你負責嗰組。'
    },
    {
      target: '[data-tour="staff-audit-cards"]',
      prepare: 'staff',
      staffSection: 'results',
      staffResultTab: 'audit',
      title: '本組投票審計',
      body: '核對本組每票邊個投邊個、投咗咩獎。'
    },
    {
      target: '[data-tour="staff-profiles"]',
      prepare: 'staff',
      staffSection: 'results',
      staffResultTab: 'profiles',
      title: '本組個人檔案',
      body: '睇本組每位參加者攞到邊啲獎、得幾多票。'
    },
    {
      target: '[data-tour="staff-summary"]',
      prepare: 'staff',
      staffSection: 'results',
      staffResultTab: 'summary',
      title: '本組獎項摘要',
      body: '展開可睇每個獎項說明同本組得主／排行。改名同改描述只可以由 Admin 做。'
    }
  ],
  admin: [
    {
      target: '[data-tour="admin-header"]',
      prepare: 'dashboard',
      title: '管理員控制台',
      body: '呢度係現場控制室：分組、監控留言、推動投票、睇結果同改設定。右上角「？」可重睇本頁說明。'
    },
    {
      target: '[data-tour="admin-live-badge"]',
      prepare: 'dashboard',
      title: '即時同步',
      body: '資料會自動更新，唔使手動 refresh。'
    },
    {
      target: '[data-tour="admin-logout"]',
      prepare: 'dashboard',
      title: '登出',
      body: '右上角可以登出管理員帳號。'
    },
    {
      target: '[data-tour="admin-stats"]',
      prepare: 'dashboard',
      title: '總覽數字',
      body: '參加者人數、留言總數、有效留言同留言開關狀態。'
    },
    {
      target: '[data-tour="admin-roster-board"]',
      prepare: 'dashboard',
      title: '分組管理',
      body: '拖曳參加者／Staff 到各組後，一定要撳「確認變更」先會寫入；「取消變更」可還原草稿。撳組名旁「改名」可自訂顯示名稱；「新增」可加座位／人員。未分配組唔參與留言／投票。'
    },
    {
      target: '[data-tour="admin-login-status"]',
      prepare: 'dashboard',
      title: '登入狀況',
      body: '邊個已上線／未登入。可以強制登出個別參加者，或一次過全部強制登出（Staff／Admin 不受影響）。'
    },
    {
      target: '[data-tour="admin-live-load"]',
      prepare: 'dashboard',
      title: '即時負載',
      body: '近幾分鐘留言同投票節奏，掌握場內氣氛。'
    },
    {
      target: '[data-tour="admin-system-status"]',
      prepare: 'dashboard',
      title: '系統狀態',
      body: '全域留言同投票而家開到邊一步。'
    },
    {
      target: '[data-tour="admin-recent-activity"]',
      prepare: 'dashboard',
      title: '最近活動',
      body: '最新幾則留言往來，方便快速掃一眼。'
    },
    {
      target: '.admin-bottom-nav .bottom-nav-item[data-admin-tab="dashboard"]',
      prepare: 'dashboard',
      title: '導航・Dashboard',
      body: '底部呢五個掣切換各大功能。'
    },
    {
      target: '.admin-bottom-nav .bottom-nav-item[data-admin-tab="messages"]',
      prepare: 'messages',
      title: '導航・Messages',
      body: '進入留言監控。'
    },
    {
      target: '[data-tour="admin-msg-filters"]',
      prepare: 'messages',
      title: '搜尋同組別',
      body: '用關鍵字搜留言，或者只睇某一組。'
    },
    {
      target: '[data-tour="admin-msg-controls"]',
      prepare: 'messages',
      title: '狀態篩選',
      body: '切換全部／有效／已撤回，右邊係同步時間同則數。'
    },
    {
      target: '[data-tour="admin-msg-list"], #admin-msg-empty',
      prepare: 'messages',
      title: '留言列表',
      body: '每則可撤回或取消撤回。內容會即時更新。'
    },
    {
      target: '.admin-bottom-nav .bottom-nav-item[data-admin-tab="voting"]',
      prepare: 'voting',
      title: '導航・Voting',
      body: '進入投票流程控制。'
    },
    {
      target: '[data-tour="admin-voting-badge"]',
      prepare: 'voting',
      title: '投票狀態',
      body: '而家全域投票停喺邊一步（開放／關閉／計算／公布）。'
    },
    {
      target: '[data-tour="admin-voting-stepper"]',
      prepare: 'voting',
      title: '流程進度條',
      body: '由開放投票一路到公布，清楚見到而家去到邊。'
    },
    {
      target: '[data-tour="admin-voting-stats"]',
      prepare: 'voting',
      title: '投票統計',
      body: '提交進度、已投／未投等人數摘要。'
    },
    {
      target: '[data-tour="admin-voting-controls"]',
      prepare: 'voting',
      title: '操作掣',
      body: '開放 → 關閉 → 計算結果 → 公布結果。按場次節奏逐個撳。'
    },
    {
      target: '[data-tour="admin-pending-voters"]',
      prepare: 'voting',
      title: '各组投票詳情',
      body: '睇每組邊個未交；亦可打開投票總覽矩陣，逐組核對配對同勝出情況。'
    },
    {
      target: '.admin-bottom-nav .bottom-nav-item[data-admin-tab="results"]',
      prepare: 'results',
      resultTab: 'audit',
      title: '導航・Results',
      body: '進入結果：審計、個人檔案、獎項摘要。'
    },
    {
      target: '[data-tour="admin-result-tabs"]',
      prepare: 'results',
      resultTab: 'audit',
      title: '結果分頁',
      body: '三個分頁：投票審計、個人檔案、獎項摘要。'
    },
    {
      target: '[data-tour="admin-audit-filters"]',
      prepare: 'results',
      resultTab: 'audit',
      title: '審計篩選',
      body: '搜參加者或揀某個獎項嚟睇票。'
    },
    {
      target: '[data-tour="admin-audit-cards"]',
      prepare: 'results',
      resultTab: 'audit',
      title: '投票審計',
      body: '每票邊個投邊個、投咗咩獎，方便核對。'
    },
    {
      target: '[data-tour="admin-profiles"]',
      prepare: 'results',
      resultTab: 'profiles',
      title: '個人檔案',
      body: '每位參加者攞到邊啲獎、得幾多票。'
    },
    {
      target: '[data-tour="admin-summary"]',
      prepare: 'results',
      resultTab: 'summary',
      title: '獎項摘要',
      body: '每個獎項嘅說明、得主同排行。展開後可以改獎項名稱同描述，會即時套用到投票畫面同參加者獎項摘要。'
    },
    {
      target: '.admin-bottom-nav .bottom-nav-item[data-admin-tab="settings"]',
      prepare: 'settings',
      title: '導航・Settings',
      body: '進入設定同參加者管理。'
    },
    {
      target: '[data-tour="admin-msg-toggle"]',
      prepare: 'settings',
      title: '全域留言開關',
      body: '一鍵開／關全部組留言。Staff 仍可覆寫自己負責嗰組。'
    },
    {
      target: '[data-tour="admin-push-config"]',
      prepare: 'settings',
      title: '推送通知設定',
      body: '免費方案唔使填。只有升級 Blaze 並部署 Cloud Functions 之後，先至可以喺 App 完全關閉時仍然推送。'
    },
    {
      target: '[data-tour="admin-group-overrides"]',
      prepare: 'settings',
      title: '各組狀態',
      body: '改組名、查看 Staff 覆寫，並可獨立控制該組留言／投票。將 Staff 分到 GROUP_1…6 後，對方即可監控同控場。'
    },
    {
      target: '[data-tour="admin-bulk-actions"]',
      prepare: 'settings',
      title: '批量操作',
      body: '重置全部投票或刪除全部紀錄——活動重設先用，要小心。'
    },
    {
      target: '[data-tour="admin-pick-participant"]',
      prepare: 'settings',
      title: '揀參加者',
      body: '揀一位之後可以改密碼、組別，撤回其留言、重置其投票，或刪除其全部紀錄。'
    },
    {
      target: '#admin-system-info',
      prepare: 'settings',
      title: '系統資訊',
      body: '後端版本同參加者總人數。'
    }
  ]
};

const onboardingState = {
  role: null,
  page: null,
  steps: [],
  step: 0,
  targetEl: null,
  repositionBound: null,
  skipDirection: 1
};

const ONBOARDING_SEEN_KEY = 'tnit_onboarding_seen_v4';
let deferredA2HSPrompt = null;
let serviceWorkerRegistration = null;
let pushForegroundUnsub = null;
let knownInboxIds = new Set();
let inboxHydrated = false;
let pushEnabledLocally = false;
let a2hsQueued = false;

// ─── DOM References ─────────────────────────────────────────────────────────

const DOM = {};

function cacheDOM() {
  DOM.loadingOverlay = document.getElementById('loading-overlay');
  DOM.loadingPercent = document.getElementById('loading-percent');
  DOM.loadingBarFill = document.getElementById('loading-bar-fill');
  DOM.splashPercent = document.getElementById('splash-percent');
  DOM.splashBarFill = document.getElementById('splash-bar-fill');
  DOM.splashStatus = document.getElementById('splash-status');
  DOM.toastContainer = document.getElementById('toast-container');
  DOM.alertBanner = document.getElementById('alert-banner');
  DOM.alertBannerMain = document.getElementById('alert-banner-main');
  DOM.alertBannerTitle = document.getElementById('alert-banner-title');
  DOM.alertBannerBody = document.getElementById('alert-banner-body');
  DOM.alertBannerClose = document.getElementById('alert-banner-close');
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
  DOM.sendGuide = document.querySelector('.send-guide');
  DOM.sendReceiver = document.getElementById('send-receiver');
  DOM.sendDropdown = document.getElementById('send-dropdown');
  DOM.sendComboboxToggle = document.getElementById('send-combobox-toggle');
  DOM.sendContent = document.getElementById('send-content');
  DOM.sendSubmit = document.getElementById('send-submit');
  DOM.sendClosedBanner = document.getElementById('send-closed-banner');
  DOM.sendClosedState = document.getElementById('send-closed-state');
  DOM.charCounter = document.getElementById('char-counter');
  DOM.badWordsWarning = document.getElementById('bad-words-warning');
  DOM.emojiWarning = document.getElementById('emoji-warning');

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
  DOM.onboardingCoach = document.getElementById('onboarding-coach');
  DOM.onboardingDim = document.getElementById('onboarding-dim');
  DOM.onboardingSpotlight = document.getElementById('onboarding-spotlight');
  DOM.onboardingTip = document.getElementById('onboarding-tip');
  DOM.onboardingStepLabel = document.getElementById('onboarding-step-label');
  DOM.onboardingTitle = document.getElementById('onboarding-title');
  DOM.onboardingBody = document.getElementById('onboarding-body');
  DOM.onboardingPrev = document.getElementById('onboarding-prev');
  DOM.onboardingNext = document.getElementById('onboarding-next');
  DOM.onboardingSkip = document.getElementById('onboarding-skip');
  DOM.a2hsModal = document.getElementById('a2hs-modal');
  DOM.a2hsSubtitle = document.getElementById('a2hs-subtitle');
  DOM.a2hsSteps = document.getElementById('a2hs-steps');
  DOM.a2hsLater = document.getElementById('a2hs-later');
  DOM.a2hsInstall = document.getElementById('a2hs-install');
  DOM.loginA2hsBanner = document.getElementById('login-a2hs-banner');
  DOM.loginAddHome = document.getElementById('login-add-home');

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
  DOM.forceLogoutModal = document.getElementById('force-logout-modal');
  DOM.forceLogoutBody = document.getElementById('force-logout-body');
  DOM.forceLogoutCancel = document.getElementById('force-logout-cancel');
  DOM.forceLogoutConfirm = document.getElementById('force-logout-confirm');
  DOM.forceLogoutAllModal = document.getElementById('force-logout-all-modal');
  DOM.forceLogoutAllCancel = document.getElementById('force-logout-all-cancel');
  DOM.forceLogoutAllConfirm = document.getElementById('force-logout-all-confirm');
  DOM.confirmModal = document.getElementById('confirm-modal');
  DOM.confirmModalTitle = document.getElementById('confirm-modal-title');
  DOM.confirmModalBody = document.getElementById('confirm-modal-body');
  DOM.confirmModalCancel = document.getElementById('confirm-modal-cancel');
  DOM.confirmModalOk = document.getElementById('confirm-modal-ok');
  DOM.confirmModalOkLabel = document.querySelector('#confirm-modal-ok .btn-label');
  DOM.trophyProgressText = document.getElementById('trophy-progress-text');
  DOM.trophyProgressFill = document.getElementById('trophy-progress-fill');
  DOM.trophyTeammates = document.getElementById('trophy-teammates');
  DOM.trophyEmpty = document.getElementById('trophy-empty');
  DOM.trophyActions = document.getElementById('trophy-actions');
  DOM.trophyClearAll = document.getElementById('trophy-clear-all');
  DOM.trophySubmitAll = document.getElementById('trophy-submit-all');
  DOM.trophySubmittedHome = document.getElementById('trophy-submitted-home');
  DOM.trophySubmittedView = document.getElementById('trophy-submitted-view');
  DOM.trophyGuideBar = document.getElementById('trophy-guide-bar');
  DOM.trophyGuideOpen = document.getElementById('trophy-guide-open');
  DOM.trophyGuideModal = document.getElementById('trophy-guide-modal');
  DOM.trophyGuideClose = document.getElementById('trophy-guide-close');
  DOM.trophyDeckStack = document.getElementById('trophy-deck-stack');
  DOM.trophyDeckPrev = document.getElementById('trophy-deck-prev');
  DOM.trophyDeckNext = document.getElementById('trophy-deck-next');
  DOM.trophyDeckIndex = document.getElementById('trophy-deck-index');
  DOM.trophyDeckExportPdf = document.getElementById('trophy-deck-export-pdf');

  DOM.profileAvatar = document.getElementById('profile-avatar');
  DOM.profileName = document.getElementById('profile-name');
  DOM.profileGroup = document.getElementById('profile-group');
  DOM.profileLoginId = document.getElementById('profile-login-id');
  DOM.profileDisplayName = document.getElementById('profile-display-name');
  DOM.profileSaveName = document.getElementById('profile-save-name');
  DOM.profilePassword = document.getElementById('profile-password');
  DOM.profileSavePassword = document.getElementById('profile-save-password');
  DOM.profilePushStatus = document.getElementById('profile-push-status');
  DOM.profilePushEnable = document.getElementById('profile-push-enable');
  DOM.profilePushDisable = document.getElementById('profile-push-disable');
  DOM.profilePushTest = document.getElementById('profile-push-test');
  DOM.profileStats = document.getElementById('profile-stats');
  DOM.homeStaffCard = document.getElementById('home-staff-card');
  DOM.staffFacilitatorPanel = document.getElementById('staff-facilitator-panel');
  DOM.staffGroupTitle = document.getElementById('staff-group-title');
  DOM.staffGroupStatus = document.getElementById('staff-group-status');
  DOM.staffGroupNameInput = document.getElementById('staff-group-name');
  DOM.staffSaveGroupName = document.getElementById('staff-save-group-name');
  DOM.staffEnableMsg = document.getElementById('staff-enable-msg');
  DOM.staffDisableMsg = document.getElementById('staff-disable-msg');
  DOM.staffVotingBadge = document.getElementById('staff-voting-badge');
  DOM.staffVotingSource = document.getElementById('staff-voting-source');
  DOM.staffFollowGlobalVoting = document.getElementById('staff-follow-global-voting');
  DOM.staffOpenVoting = document.getElementById('staff-open-voting');
  DOM.staffCloseVoting = document.getElementById('staff-close-voting');
  DOM.staffCalculate = document.getElementById('staff-calculate');
  DOM.staffPublish = document.getElementById('staff-publish');
  DOM.staffMessageList = document.getElementById('staff-message-list');
  DOM.staffMsgEmpty = document.getElementById('staff-msg-empty');
  DOM.staffMsgCount = document.getElementById('staff-msg-count');
  DOM.staffDashboardStats = document.getElementById('staff-dashboard-stats');
  DOM.staffLoginStatus = document.getElementById('staff-login-status');
  DOM.staffLiveLoad = document.getElementById('staff-live-load');
  DOM.staffTrophyStats = document.getElementById('staff-trophy-stats');
  DOM.staffPendingVoters = document.getElementById('staff-pending-voters');
  DOM.staffAuditCards = document.getElementById('staff-audit-cards');
  DOM.staffProfilesList = document.getElementById('staff-profiles-list');
  DOM.staffSummaryList = document.getElementById('staff-summary-list');
  DOM.adminGroupOverrides = document.getElementById('admin-group-overrides');

  DOM.adminLogout = document.getElementById('admin-logout');
  DOM.adminDashboardPanel = document.getElementById('admin-dashboard-panel');
  DOM.adminDashboardStats = document.getElementById('admin-dashboard-stats');
  DOM.adminDashboardStatus = document.getElementById('admin-dashboard-status');
  DOM.adminRosterBoard = document.getElementById('admin-roster-board');
  DOM.adminRosterAdd = document.getElementById('admin-roster-add');
  DOM.adminRosterConfirm = document.getElementById('admin-roster-confirm');
  DOM.adminRosterDiscard = document.getElementById('admin-roster-discard');
  DOM.adminRosterPendingHint = document.getElementById('admin-roster-pending-hint');
  DOM.groupRenameModal = document.getElementById('group-rename-modal');
  DOM.groupRenameSubtitle = document.getElementById('group-rename-subtitle');
  DOM.groupRenameInput = document.getElementById('group-rename-input');
  DOM.groupRenameCancel = document.getElementById('group-rename-cancel');
  DOM.groupRenameSave = document.getElementById('group-rename-save');
  DOM.rosterEditModal = document.getElementById('roster-edit-modal');
  DOM.rosterEditTitle = document.getElementById('roster-edit-title');
  DOM.rosterEditSubtitle = document.getElementById('roster-edit-subtitle');
  DOM.rosterEditId = document.getElementById('roster-edit-id');
  DOM.rosterEditName = document.getElementById('roster-edit-name');
  DOM.rosterEditPassword = document.getElementById('roster-edit-password');
  DOM.rosterEditGroup = document.getElementById('roster-edit-group');
  DOM.rosterEditSave = document.getElementById('roster-edit-save');
  DOM.rosterEditCancel = document.getElementById('roster-edit-cancel');
  DOM.rosterEditDelete = document.getElementById('roster-edit-delete');
  DOM.rosterAddModal = document.getElementById('roster-add-modal');
  DOM.rosterAddKind = document.getElementById('roster-add-kind');
  DOM.rosterAddIdWrap = document.getElementById('roster-add-id-wrap');
  DOM.rosterAddId = document.getElementById('roster-add-id');
  DOM.rosterAddName = document.getElementById('roster-add-name');
  DOM.rosterAddPassword = document.getElementById('roster-add-password');
  DOM.rosterAddGroup = document.getElementById('roster-add-group');
  DOM.rosterAddSave = document.getElementById('roster-add-save');
  DOM.rosterAddCancel = document.getElementById('roster-add-cancel');
  DOM.homeUnassignedBanner = document.getElementById('home-unassigned-banner');
  DOM.trophySubmittedBanner = document.getElementById('trophy-submitted-banner');
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
  DOM.adminVapidKey = document.getElementById('admin-vapid-key');
  DOM.adminSaveVapid = document.getElementById('admin-save-vapid');
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
  DOM.adminBulkResetVotes = document.getElementById('admin-bulk-reset-votes');
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

let splashActive = true;

function showScreen(name) {
  if (DOM.screenSplash && !splashActive) DOM.screenSplash.classList.add('hidden');
  DOM.screenLogin.classList.toggle('hidden', name !== 'login');
  DOM.screenParticipant.classList.toggle('hidden', name !== 'participant');
  DOM.screenAdmin.classList.toggle('hidden', name !== 'admin');
  document.body.classList.toggle('participant-active', name === 'participant');
  document.body.classList.toggle('admin-active', name === 'admin');
  if (name !== 'login') setLoginNativeNumpad(false);
  if (name === 'login') {
    replayEnterAnimation(document.querySelector('#screen-login .login-inner'), 'page-enter');
  } else if (name === 'participant') {
    replayEnterAnimation(DOM.screenParticipant, 'screen-enter');
  } else if (name === 'admin') {
    replayEnterAnimation(DOM.screenAdmin, 'screen-enter');
  }
  if (name === 'login') {
    maybeShowAddToHomePrompt();
  } else {
    closeAddToHomePrompt({ resumeOnboarding: false });
  }
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

function setSplashStatus(message) {
  if (DOM.splashStatus) DOM.splashStatus.textContent = message;
}

function beginSplash() {
  if (!DOM.screenSplash) return;
  splashActive = true;
  DOM.screenSplash.classList.remove('hidden', 'splash-exit', 'splash-font-ready');
  DOM.screenSplash.setAttribute('aria-busy', 'true');
  DOM.screenLogin.classList.add('hidden');
  if (DOM.screenParticipant) DOM.screenParticipant.classList.add('hidden');
  if (DOM.screenAdmin) DOM.screenAdmin.classList.add('hidden');
  setSplashPercent(0);
  setSplashStatus('準備啟動…');
  if (splashTickTimer) clearInterval(splashTickTimer);
  splashTickTimer = setInterval(() => {
    const current = parseInt(DOM.splashPercent?.textContent || '0', 10) || 0;
    if (current < 88) setSplashPercent(current + 1);
  }, 70);
}

function endSplash() {
  return new Promise(resolve => {
    if (!DOM.screenSplash) {
      splashActive = false;
      resolve();
      return;
    }
    if (splashTickTimer) {
      clearInterval(splashTickTimer);
      splashTickTimer = null;
    }
    setSplashPercent(100);
    setSplashStatus('準備進入…');
    splashActive = false;
    DOM.screenSplash.setAttribute('aria-busy', 'false');
    DOM.screenSplash.classList.add('splash-exit');
    setTimeout(() => {
      DOM.screenSplash.classList.add('hidden');
      resolve();
    }, 420);
  });
}

const APP_FONT_FAMILY = '"Canva Handwriting Style TC"';
const APP_FONT_TIMEOUT_MS = 10000;

function waitForAppFont() {
  if (!document.fonts || typeof document.fonts.load !== 'function') {
    return Promise.resolve(false);
  }
  const loads = [
    document.fonts.load('400 16px ' + APP_FONT_FAMILY),
    document.fonts.load('700 16px ' + APP_FONT_FAMILY),
    document.fonts.load('400 28px ' + APP_FONT_FAMILY)
  ];
  return Promise.race([
    Promise.all(loads).then(() => document.fonts.ready).then(() => {
      try {
        return document.fonts.check('16px ' + APP_FONT_FAMILY);
      } catch (_) {
        return true;
      }
    }),
    new Promise(resolve => setTimeout(() => resolve(false), APP_FONT_TIMEOUT_MS))
  ]).catch(() => false);
}

function replayEnterAnimation(el, className = 'view-enter') {
  if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  el.classList.remove(className);
  // Force reflow so the enter animation can replay on every navigation.
  void el.offsetWidth;
  el.classList.add(className);
  // Drop the class after the stagger finishes — fill-mode:both + leftover
  // transform would trap combobox dropdowns under later siblings.
  clearTimeout(el._enterAnimTimer);
  el._enterAnimTimer = setTimeout(() => {
    el.classList.remove(className);
    el._enterAnimTimer = null;
  }, 700);
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

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = 'toast ' + resolveToastClass(type);
  toast.setAttribute('role', 'alert');
  toast.textContent = message;
  DOM.toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), CONFIG.TOAST_DURATION);
}

/** Map success/error/info, messaging OPEN/CLOSE, or voting statuses onto status tones. */
function resolveToastClass(type) {
  const raw = String(type || 'info').trim();
  switch (raw) {
    case 'VOTING_OPEN':
    case 'OPEN':
    case 'success':
    case 'tone-open':
      return 'toast-tone-open';
    case 'VOTING_CLOSED':
    case 'CLOSE':
    case 'error':
    case 'tone-closed':
      return 'toast-tone-closed';
    case 'CALCULATED':
    case 'warning':
    case 'tone-calculated':
      return 'toast-tone-calculated';
    case 'PUBLISHED':
    case 'tone-published':
      return 'toast-tone-published';
    case 'DRAFT':
    case 'info':
    case 'tone-draft':
    default:
      return 'toast-tone-draft';
  }
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

const EMOJI_WARNING_TEXT = '內容包含 emoji，請移除後再提交';

function containsEmoji(text) {
  const raw = String(text || '');
  if (!raw) return false;
  try {
    if (/\p{Extended_Pictographic}/u.test(raw)) return true;
  } catch (_) { /* older engines */ }
  return /(?:[\u2600-\u27BF]|[\u203C-\u3299]|\uD83C[\uDDE6-\uDDFF]|\uD83D[\uDC00-\uDFFF]|\uD83E[\uDD00-\uDFFF])/.test(raw);
}

function textInputBlocked(text, { checkBadWords = false } = {}) {
  const hasEmoji = containsEmoji(text);
  const hasBadWords = checkBadWords && containsBadWords(text);
  return { hasEmoji, hasBadWords, blocked: hasEmoji || hasBadWords };
}

function rejectIfTextBlocked(text, { checkBadWords = false } = {}) {
  const { hasEmoji, hasBadWords } = textInputBlocked(text, { checkBadWords });
  if (hasEmoji) {
    showToast(EMOJI_WARNING_TEXT, 'error');
    return true;
  }
  if (hasBadWords) {
    showToast('內容包含不適當用語，請修改後再發送', 'error');
    return true;
  }
  return false;
}

function ensureEmojiWarningEl(field) {
  const group = field.closest('.form-group') || field.parentElement;
  if (!group) return null;
  let el = group.querySelector('.text-guard-emoji-warning');
  if (!el) {
    el = document.createElement('p');
    el.className = 'form-hint form-hint-danger text-guard-emoji-warning hidden';
    el.textContent = EMOJI_WARNING_TEXT;
    field.insertAdjacentElement('afterend', el);
  }
  return el;
}

function attachTextInputGuard(field, { checkBadWords = false, submitBtn = null, extraDisabled = null } = {}) {
  if (!field || field.dataset.textGuardBound === '1') return;
  field.dataset.textGuardBound = '1';
  const emojiWarn = ensureEmojiWarningEl(field);
  const badWarn = checkBadWords ? field.closest('.form-group')?.querySelector('#bad-words-warning') : null;
  const refresh = () => {
    const { hasEmoji, hasBadWords, blocked } = textInputBlocked(field.value, { checkBadWords });
    if (emojiWarn) emojiWarn.classList.toggle('hidden', !hasEmoji);
    if (badWarn) badWarn.classList.toggle('hidden', !hasBadWords);
    if (submitBtn) {
      const extra = typeof extraDisabled === 'function' ? extraDisabled() : !!extraDisabled;
      submitBtn.disabled = blocked || extra;
    }
  };
  field.addEventListener('input', refresh);
  refresh();
}

function attachTextGuardGroup(fields, { submitBtn = null } = {}) {
  const list = [...fields].filter(Boolean);
  if (!list.length) return;
  const emojiWarn = ensureEmojiWarningEl(list[0]);
  const refresh = () => {
    const blocked = list.some(f => containsEmoji(f.value));
    if (emojiWarn) emojiWarn.classList.toggle('hidden', !blocked);
    if (submitBtn) submitBtn.disabled = blocked;
  };
  list.forEach(field => {
    if (field.dataset.textGuardBound === '1') return;
    field.dataset.textGuardBound = '1';
    field.addEventListener('input', refresh);
  });
  refresh();
}

function initStaticTextInputGuards() {
  if (DOM.profileDisplayName && DOM.profileSaveName) {
    attachTextInputGuard(DOM.profileDisplayName, { submitBtn: DOM.profileSaveName });
  }
  if (DOM.staffGroupNameInput && DOM.staffSaveGroupName) {
    attachTextInputGuard(DOM.staffGroupNameInput, { submitBtn: DOM.staffSaveGroupName });
  }
  if (DOM.groupRenameInput && DOM.groupRenameSave) {
    attachTextInputGuard(DOM.groupRenameInput, { submitBtn: DOM.groupRenameSave });
  }
  if (DOM.rosterEditName && DOM.rosterEditSave) {
    attachTextInputGuard(DOM.rosterEditName, { submitBtn: DOM.rosterEditSave });
  }
  if (DOM.rosterAddName && DOM.rosterAddSave) {
    attachTextInputGuard(DOM.rosterAddName, { submitBtn: DOM.rosterAddSave });
  }
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
  stopAdminLoginStatusRefresh();
  subscriptions.forEach(stop => {
    try {
      stop();
    } catch (_) { /* already closed */ }
  });
  subscriptions = [];
  resultUnsubscribe = null;
  statusChangeNoticesReady = false;
  lastNotifiedVotingStatus = null;
  lastNotifiedMessagingOpen = null;
}

function syncStatusChangeBaselines() {
  lastNotifiedVotingStatus = effectiveVotingConfigForMe().voting_status;
  lastNotifiedMessagingOpen = isMessagingOpenForMe();
}

function enableStatusChangeNotices() {
  syncStatusChangeBaselines();
  statusChangeNoticesReady = true;
}

function maybeNotifyVotingStatusChange() {
  const next = state.trophy.votingStatus;
  if (!statusChangeNoticesReady) return;
  if (lastNotifiedVotingStatus === next) return;
  lastNotifiedVotingStatus = next;
  notifyVotingStatusChange(next);
  if (next === 'PUBLISHED') {
    maybeShowPublishedModal(true);
    showLocalPushNotification(
      '獎項結果出咗喇',
      '入獎項頁睇你嘅結果。',
      'tnit-trophy-local',
      { toast: false }
    );
  }
}

function maybeNotifyMessagingOpenChange() {
  const nowOpen = isMessagingOpenForMe();
  if (!statusChangeNoticesReady) return;
  if (lastNotifiedMessagingOpen === nowOpen) return;
  lastNotifiedMessagingOpen = nowOpen;
  showToast(
    nowOpen ? '留言功能已重新開放' : '留言功能已關閉',
    nowOpen ? 'OPEN' : 'CLOSE'
  );
}

async function startPresenceHeartbeat() {
  if (!state.participantId || state.isAdmin) return;
  stopPresenceHeartbeat();
  const pulse = () => {
    // Skip if a force-logout is already being applied — otherwise the next
    // heartbeat can recreate the presence doc and the admin panel flaps back.
    if (state.handledForceLogoutRev || state.isLoggingOut) return;
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

/** GROUP_UNASSIGNED first, then GROUP_1… then GROUP_STAFF / everything else. */
function compareGroupLabels(a, b) {
  const rank = label => {
    if (data.isUnassignedGroup(label) || label === data.GROUP_UNASSIGNED) return -1;
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
  if (data.isUnassignedGroup(label) || label === data.GROUP_UNASSIGNED) return '未分配';
  const meta = state.groupMeta[label];
  if (meta && meta.display_name) return meta.display_name;
  const m = String(label || '').match(/^GROUP_(\d+)$/i);
  if (m) return 'Group ' + m[1];
  if (/STAFF/i.test(label)) return 'Staff';
  return label || '未分配';
}

function canRenameGroup(groupId) {
  const g = normalizeRosterGroupId(groupId);
  if (!g || data.isUnassignedGroup(g) || g === data.GROUP_UNASSIGNED) return false;
  return data.isNumberedGroupId(g) || g === data.GROUP_STAFF || /STAFF/i.test(g);
}

function defaultGroupLabel(groupId) {
  const g = String(groupId || '').trim();
  if (data.isUnassignedGroup(g) || g === data.GROUP_UNASSIGNED) return '未分配';
  const m = g.match(/^GROUP_(\d+)$/i);
  if (m) return 'Group ' + m[1];
  if (/STAFF/i.test(g)) return 'Staff';
  return g || '未分配';
}

function openGroupRenameModal(groupId) {
  const g = normalizeRosterGroupId(groupId);
  if (!canRenameGroup(g) || !DOM.groupRenameModal) return;
  DOM.groupRenameModal.dataset.groupId = g;
  if (DOM.groupRenameSubtitle) {
    DOM.groupRenameSubtitle.textContent = `${g} · 預設顯示「${defaultGroupLabel(g)}」`;
  }
  if (DOM.groupRenameInput) {
    const meta = state.groupMeta[g] || {};
    DOM.groupRenameInput.value = meta.display_name || '';
  }
  DOM.groupRenameModal.classList.remove('hidden');
  setTimeout(() => DOM.groupRenameInput?.focus(), 0);
}

function closeGroupRenameModal() {
  if (DOM.groupRenameModal) {
    DOM.groupRenameModal.classList.add('hidden');
    delete DOM.groupRenameModal.dataset.groupId;
  }
}

async function handleGroupRenameSave() {
  const groupId = DOM.groupRenameModal?.dataset.groupId;
  if (!groupId || !canRenameGroup(groupId)) return;
  const name = String(DOM.groupRenameInput?.value || '').trim();
  if (name.length > 40) {
    showToast('組名最多 40 字', 'error');
    return;
  }
  if (rejectIfTextBlocked(name)) return;
  await runProgressButton(DOM.groupRenameSave, (async () => {
    try {
      await data.setGroupDisplayName(groupId, name);
      if (!state.groupMeta[groupId]) {
        state.groupMeta[groupId] = {
          group_id: groupId,
          display_name: name,
          messaging_status: 'OPEN',
          voting_status: '',
          allow_resubmit: false
        };
      } else {
        state.groupMeta[groupId] = { ...state.groupMeta[groupId], display_name: name };
      }
      closeGroupRenameModal();
      renderAdminRosterBoard();
      renderAdminGroupOverrides();
      populateAdminMsgGroupFilter();
      refreshComboboxItems();
      showToast(name ? `「${name}」組名已更新` : '已還原預設組名', 'success');
    } catch (err) {
      showToast(data.describeFirestoreError(err, err.message || '儲存組名失敗'), 'error');
    }
  })());
}

function getFacilitatorGroupMembers(groupId = getFacilitatorGroupId()) {
  if (!groupId) return [];
  return state.participants.filter(p => p.group_id === groupId);
}

function applyStaffParticipantChrome() {
  const hideForStaff = isStaffPerson(state.participantId);
  document.querySelectorAll('[data-staff-hide]').forEach(el => {
    el.classList.toggle('hidden', hideForStaff);
  });
  if (DOM.screenParticipant) {
    DOM.screenParticipant.classList.toggle('is-staff-facilitator', hideForStaff);
  }
}

/** Seat ids are 1A…6H. Named people (WILL, …) are Staff. */
function isSeatParticipantId(participantId) {
  return /^[0-9][A-H]$/i.test(String(participantId || '').trim());
}

function isStaffPerson(pOrId) {
  const id = typeof pOrId === 'string'
    ? pOrId
    : (pOrId && pOrId.participant_id) || '';
  return !!id && !isSeatParticipantId(id) && !isAdminLogin(id);
}

function isNumberedGroupId(groupId) {
  return /^GROUP_\d+$/i.test(String(groupId || '').trim());
}

/** Staff who have been moved into a numbered group facilitate that group. */
function getFacilitatorGroupId(participantId = state.participantId) {
  if (!isStaffPerson(participantId)) return '';
  const p = findParticipantById(participantId);
  const groupId = p ? p.group_id : '';
  return isNumberedGroupId(groupId) ? groupId : '';
}

function isGroupFacilitator(participantId = state.participantId) {
  return !!getFacilitatorGroupId(participantId);
}

function displayNameOf(pOrId) {
  const p = typeof pOrId === 'string' ? findParticipantById(pOrId) : pOrId;
  if (!p) return typeof pOrId === 'string' ? pOrId : '';
  return (p.display_name || '').trim() || p.participant_id || '';
}

/** Shown in lists: "小明（1A）" so login ids stay discoverable. */
function displayLabelOf(pOrId) {
  const p = typeof pOrId === 'string' ? findParticipantById(pOrId) : pOrId;
  if (!p) return typeof pOrId === 'string' ? pOrId : '';
  const id = p.participant_id || '';
  const name = (p.display_name || '').trim();
  return name && name !== id ? `${name}（${id}）` : id;
}

function myGroupId() {
  const p = findParticipantById(state.participantId);
  return (p && p.group_id) || '';
}

function groupMessagingOpen(groupId) {
  const meta = state.groupMeta[groupId];
  if (!meta) return true;
  return meta.messaging_status !== 'CLOSE';
}

/** Global CLOSE is a master kill-switch; group CLOSE is a local override. */
function isMessagingOpenForGroup(groupId) {
  return !!state.messagingOpen && groupMessagingOpen(groupId);
}

function isMessagingOpenForMe() {
  if (isStaffPerson(state.participantId)) return !!state.messagingOpen;
  const groupId = myGroupId();
  if (data.isUnassignedGroup(groupId) || !data.isNumberedGroupId(groupId)) return false;
  return isMessagingOpenForGroup(groupId);
}

function getSendRecipientLabel(p) {
  const label = displayLabelOf(p);
  if (isStaffPerson(state.participantId) && data.isNumberedGroupId(p.group_id)) {
    return `${label} · ${formatGroupLabel(p.group_id)}`;
  }
  return label;
}

function updateSendReceiverPlaceholder() {
  if (!DOM.sendReceiver) return;
  DOM.sendReceiver.placeholder = isStaffPerson(state.participantId)
    ? '搜尋全域接收者'
    : '搜尋同組接收者';
}

function effectiveVotingConfigForGroup(groupId) {
  const meta = state.groupMeta[groupId];
  if (meta && meta.voting_status) {
    return {
      voting_status: meta.voting_status,
      allow_resubmit: !!meta.allow_resubmit,
      calculated_at: meta.calculated_at || '',
      published_at: meta.published_at || ''
    };
  }
  return state.votingConfig;
}

function effectiveVotingConfigForMe() {
  return effectiveVotingConfigForGroup(myGroupId());
}

/** Optimistic group voting writes that must survive stale groups snapshots. */
const pendingGroupVotingWrites = new Map(); // groupId -> { status, at }
const PENDING_GROUP_VOTING_GRACE_MS = 3000;

function applyGroupsSnapshot(map) {
  const next = { ...(map || {}) };
  const now = Date.now();
  pendingGroupVotingWrites.forEach((pending, groupId) => {
    const pendingStatus = pending.status;
    const serverStatus = next[groupId]?.voting_status || '';
    if (serverStatus === pendingStatus) {
      pendingGroupVotingWrites.delete(groupId);
      return;
    }
    // Drop stale optimism (e.g. Admin already wiped overrides worldwide).
    if (now - pending.at > PENDING_GROUP_VOTING_GRACE_MS) {
      pendingGroupVotingWrites.delete(groupId);
      return;
    }
    if (!next[groupId]) {
      next[groupId] = {
        group_id: groupId,
        display_name: '',
        messaging_status: 'OPEN',
        voting_status: pendingStatus,
        allow_resubmit: pendingStatus === 'VOTING_OPEN' ? false : !!next[groupId]?.allow_resubmit,
        calculated_at: '',
        published_at: ''
      };
      return;
    }
    next[groupId] = {
      ...next[groupId],
      voting_status: pendingStatus,
      allow_resubmit: pendingStatus === 'VOTING_OPEN'
        ? false
        : (pendingStatus ? !!next[groupId].allow_resubmit : false)
    };
  });
  state.groupMeta = next;
}

function rememberPendingGroupVoting(groupId, status) {
  const nextStatus = status || '';
  pendingGroupVotingWrites.set(groupId, { status: nextStatus, at: Date.now() });
  if (!state.groupMeta[groupId]) {
    state.groupMeta[groupId] = {
      group_id: groupId,
      display_name: '',
      messaging_status: 'OPEN',
      voting_status: '',
      allow_resubmit: false,
      calculated_at: '',
      published_at: ''
    };
  }
  state.groupMeta[groupId] = {
    ...state.groupMeta[groupId],
    voting_status: nextStatus,
    allow_resubmit: nextStatus === 'VOTING_OPEN'
      ? false
      : (nextStatus ? !!state.groupMeta[groupId].allow_resubmit : false)
  };
}

/** Admin global voting changes wipe every local group override in memory. */
function clearLocalGroupVotingOverrides() {
  pendingGroupVotingWrites.clear();
  Object.keys(state.groupMeta).forEach(groupId => {
    state.groupMeta[groupId] = {
      ...state.groupMeta[groupId],
      voting_status: '',
      allow_resubmit: false,
      calculated_at: '',
      published_at: ''
    };
  });
}

function groupVotingOverrideInfo(groupId) {
  const meta = state.groupMeta[groupId] || {};
  const overridden = !!(meta.voting_status);
  const voting = effectiveVotingConfigForGroup(groupId);
  const globalStatus = state.votingConfig.voting_status || 'DRAFT';
  return {
    status: voting.voting_status || 'DRAFT',
    overridden,
    globalStatus,
    sourceLabel: overridden ? '本組覆寫' : '跟隨全域'
  };
}

/**
 * The old backend assembled these summaries server side. Firestore has no
 * server to run code on, but the admin already holds every submission through
 * a listener, so the same numbers are derived here for free.
 */
function getVotingParticipants(list = state.participants) {
  return (list || []).filter(p => isSeatParticipantId(p.participant_id));
}

function buildTrophyOverview(submissions, trophies, participants = state.participants, votingStatus = state.votingConfig.voting_status) {
  const roster = getVotingParticipants(participants);
  const rosterIds = new Set(roster.map(p => p.participant_id));
  const submitted = new Set(
    submissions
      .filter(s => s.status === 'submitted' && rosterIds.has(s.participant_id))
      .map(s => s.participant_id)
  );
  const totalVotes = submissions
    .filter(s => s.status === 'submitted' && rosterIds.has(s.participant_id))
    .reduce((sum, s) => sum + s.pairings.length, 0);

  const byGroup = new Map();
  roster.forEach(p => {
    const group = data.normalizeGroupId(p.group_id);
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group).push({
      participant_id: p.participant_id,
      voted: submitted.has(p.participant_id)
    });
  });

  return {
    voting_status: votingStatus,
    stats: {
      completed_voters: submitted.size,
      total_participants: roster.length,
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
    pending_participants: roster
      .filter(p => !submitted.has(p.participant_id))
      .map(p => p.participant_id)
  };
}

function buildAuditVotes(submissions, trophies) {
  const names = new Map(trophies.map(t => [t.trophy_id, t.trophy_name]));
  const rows = [];
  submissions.forEach(submission => {
    if (submission.status !== 'submitted') return;
    if (!isSeatParticipantId(submission.participant_id)) return;
    submission.pairings.forEach(pair => {
      if (!isSeatParticipantId(pair.receiver_id)) return;
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
  const wrapper = input.closest('.combobox-wrapper');

  let highlightedIndex = -1;
  let isOpen = false;

  function getFilteredItems(query) {
    const q = (query || '').trim().toUpperCase();
    const excluded = new Set(
      (comboState.excludeIds || []).map(id => normalizeId(id)).filter(Boolean)
    );
    return comboState.items.filter(item => {
      const id = typeof item === 'string' ? item : item.participant_id;
      if (excluded.has(normalizeId(id))) return false;
      if (!q) return true;
      const label = getLabel(item).toUpperCase();
      const name = typeof item === 'string' ? '' : String(item.display_name || '').toUpperCase();
      return id.toUpperCase().includes(q) || label.includes(q) || (name && name.includes(q));
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
    if (wrapper) wrapper.classList.add('is-open');
    dropdown.classList.remove('hidden');
    renderDropdown(input.value);
  }

  function closeDropdown() {
    isOpen = false;
    input.setAttribute('aria-expanded', 'false');
    if (wrapper) wrapper.classList.remove('is-open');
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
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) openDropdown();
      const lis = dropdown.querySelectorAll('li[data-index]');
      highlightedIndex = Math.min(highlightedIndex + 1, Math.max(lis.length - 1, 0));
      highlightItem(highlightedIndex);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const lis = dropdown.querySelectorAll('li[data-index]');
      highlightedIndex = Math.max(highlightedIndex - 1, 0);
      highlightItem(highlightedIndex);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const lis = dropdown.querySelectorAll('li[data-index]');
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
    if (!wrapper || !wrapper.contains(e.target)) {
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
  // Prefer identity (named Staff) over current group, so facilitators moved
  // into GROUP_1…6 still type their id at login instead of appearing in the list.
  return !!(p && (isStaffPerson(p) || isStaffGroup(p.group_id)));
}

/** Login dropdown: seat roster only. Staff type their own id. */
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
  const recipients = data.getMessageRecipients(state.participantId, state.participants);
  const exclude = [state.participantId, CONFIG.ADMIN_ID];
  if (sendCombobox) {
    sendCombobox.setItems(recipients);
    sendCombobox.setExcludeIds(exclude);
    return;
  }
  sendCombobox = createCombobox({
    input: DOM.sendReceiver,
    dropdown: DOM.sendDropdown,
    toggle: DOM.sendComboboxToggle,
    items: recipients,
    excludeIds: exclude,
    getLabel: (item) => getSendRecipientLabel(item),
    onSelect: (item) => {
      selectedReceiverId = item.participant_id;
      DOM.sendReceiver.value = getSendRecipientLabel(item);
    }
  });
}

function refreshComboboxItems() {
  if (loginCombobox) loginCombobox.setItems(getLoginMenuParticipants());
  if (sendCombobox) {
    sendCombobox.setItems(data.getMessageRecipients(state.participantId, state.participants));
    sendCombobox.setExcludeIds([state.participantId, CONFIG.ADMIN_ID]);
    if (selectedReceiverId) {
      const stillValid = data.getMessageRecipients(state.participantId, state.participants)
        .some(p => p.participant_id === selectedReceiverId);
      if (!stillValid) {
        selectedReceiverId = null;
        if (DOM.sendReceiver) DOM.sendReceiver.value = '';
      }
    }
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
      showToast('無法載入參加者名單：' + data.describeFirestoreError(err, '請稍後再試'), 'error');
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

// ─── Soft-keyboard avoidance (native numpad / text keyboard) ─────────────────

const KEYBOARD_OPEN_THRESHOLD = 120;
let keyboardAvoidanceRaf = 0;
let ensureFieldTimer = 0;

function isTextEntryElement(el) {
  if (!el || el === document.body || el === document.documentElement) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return !el.readOnly && !el.disabled;
  if (tag === 'INPUT') {
    if (el.readOnly || el.disabled) return false;
    const type = String(el.type || 'text').toLowerCase();
    return ![
      'button', 'submit', 'reset', 'checkbox', 'radio',
      'file', 'hidden', 'image', 'range', 'color',
    ].includes(type);
  }
  return !!el.isContentEditable;
}

function getScrollParent(el) {
  let node = el && el.parentElement;
  while (node && node !== document.body && node !== document.documentElement) {
    const style = window.getComputedStyle(node);
    const oy = style.overflowY;
    if (
      (oy === 'auto' || oy === 'scroll' || oy === 'overlay') &&
      node.scrollHeight > node.clientHeight + 1
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return document.scrollingElement || document.documentElement;
}

function getKeyboardInset() {
  const vv = window.visualViewport;
  if (!vv) return 0;
  return Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
}

function adjustScrollBy(el, delta) {
  if (!el || Math.abs(delta) < 4) return;
  const scroller = getScrollParent(el);
  // Instant scroll — smooth + browser focus-scroll + layout inset = mobile jitter.
  if (
    scroller === document.scrollingElement ||
    scroller === document.documentElement ||
    scroller === document.body
  ) {
    window.scrollBy(0, delta);
    return;
  }
  scroller.scrollTop += delta;
}

/**
 * Nudge the focused field just enough to clear the soft keyboard.
 * Avoid centering (that overshoots and feels like a double bounce).
 */
function ensureActiveFieldVisible() {
  const el = document.activeElement;
  if (!isTextEntryElement(el)) return;

  const vv = window.visualViewport;
  if (!vv) return;

  const inset = getKeyboardInset();
  if (inset < KEYBOARD_OPEN_THRESHOLD) return;

  const margin = 16;
  const visibleTop = vv.offsetTop + margin;
  const visibleBottom = vv.offsetTop + vv.height - margin;
  const rect = el.getBoundingClientRect();
  const group = el.closest('.form-group');
  const topEdge = group ? group.getBoundingClientRect().top : rect.top;

  let delta = 0;
  if (rect.bottom > visibleBottom) {
    delta = rect.bottom - visibleBottom;
  } else if (topEdge < visibleTop) {
    delta = topEdge - visibleTop;
  }
  adjustScrollBy(el, delta);
}

function scheduleEnsureActiveFieldVisible(delay = 140) {
  if (ensureFieldTimer) clearTimeout(ensureFieldTimer);
  ensureFieldTimer = setTimeout(() => {
    ensureFieldTimer = 0;
    ensureActiveFieldVisible();
  }, delay);
}

function updateKeyboardAvoidance() {
  const inset = getKeyboardInset();
  document.documentElement.style.setProperty('--keyboard-inset', `${inset}px`);
  document.documentElement.classList.toggle('keyboard-open', inset >= KEYBOARD_OPEN_THRESHOLD);
}

function scheduleKeyboardAvoidance() {
  if (keyboardAvoidanceRaf) cancelAnimationFrame(keyboardAvoidanceRaf);
  keyboardAvoidanceRaf = requestAnimationFrame(() => {
    keyboardAvoidanceRaf = 0;
    updateKeyboardAvoidance();
    // Debounce the scroll nudge until viewport resize bursts settle.
    if (isTextEntryElement(document.activeElement)) {
      scheduleEnsureActiveFieldVisible(140);
    }
  });
}

function initKeyboardAvoidance() {
  const vv = window.visualViewport;
  if (vv) {
    vv.addEventListener('resize', scheduleKeyboardAvoidance);
    vv.addEventListener('scroll', scheduleKeyboardAvoidance);
  }
  window.addEventListener('resize', scheduleKeyboardAvoidance);

  document.addEventListener('focusin', (e) => {
    if (!isTextEntryElement(e.target)) return;
    updateKeyboardAvoidance();
    // Wait for the keyboard animation instead of fighting the browser's own focus scroll.
    scheduleEnsureActiveFieldVisible(360);
  });

  document.addEventListener('focusout', () => {
    setTimeout(() => {
      if (!isTextEntryElement(document.activeElement)) {
        if (ensureFieldTimer) {
          clearTimeout(ensureFieldTimer);
          ensureFieldTimer = 0;
        }
        scheduleKeyboardAvoidance();
      }
    }, 80);
  });

  updateKeyboardAvoidance();
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
      updateKeyboardAvoidance();
      scheduleEnsureActiveFieldVisible(360);
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
  const savedAt = Date.now();
  state.sessionStartedAt = savedAt;
  try {
    sessionStorage.setItem(CONFIG.SESSION_KEY, JSON.stringify({
      participantId,
      isAdmin: !!isAdmin,
      savedAt
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
      isAdmin: !!data.isAdmin,
      savedAt: Number(data.savedAt || 0) || 0
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
    state.sessionStartedAt = stored.savedAt || Date.now();
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

function applyEffectiveVotingToTrophyState() {
  const config = effectiveVotingConfigForMe();
  state.trophy.votingStatus = config.voting_status;
  state.trophy.trophyRevision = config.published_at || config.calculated_at || config.voting_status;
  if (config.voting_status !== 'PUBLISHED') {
    hideTrophyResultsModal();
  }
  recalcTrophyPermissions();
  ensureResultSubscription();
  updateTrophyStatusBanner();
  renderParticipantTrophyResults();
  renderTrophyTeammates();
  renderProfile();
  renderStaffFacilitatorPanel();
  maybeNotifyVotingStatusChange();
}

async function startParticipantSubscriptions() {
  const pid = state.participantId;

  await Promise.all([
    subscribeAndWait(
      (cb, err) => data.subscribeParticipants(cb, err),
      rows => {
        state.participants = rows;
        maybeHandleForcedLogout(rows);
        setParticipantsCache(rows);
        state.trophy.teammates = data.getTeammates(pid, state.participants);
        refreshComboboxItems();
        updateParticipantGreeting();
        renderProfile();
        renderStaffFacilitatorPanel();
        renderTrophyTeammates();
        applyEffectiveVotingToTrophyState();
      },
      '參加者名單'
    ),
    subscribeAndWait(
      (cb, err) => data.subscribeMessagingStatus(cb, err),
      status => {
        state.messagingOpen = status === 'OPEN';
        updateSendFormState();
        updateCharCounter();
        maybeNotifyMessagingOpenChange();
        renderStaffFacilitatorPanel();
      },
      '留言開關'
    ),
    subscribeAndWait(
      (cb, err) => data.subscribeInbox(pid, cb, err),
      messages => {
        const ids = new Set((messages || []).map(m => m.message_id));
        if (inboxHydrated) {
          const fresh = (messages || []).filter(m => m.message_id && !knownInboxIds.has(m.message_id));
          if (fresh.length) {
            showLocalPushNotification(
              '你有新嘅匿名留言',
              '入 Inbox 睇下對方寫咗咩。',
              'tnit-message-local',
              { toast: true }
            );
          }
        }
        inboxHydrated = true;
        knownInboxIds = ids;
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
        const prevStatus = state.votingConfig.voting_status;
        state.votingConfig = config;
        if (prevStatus !== config.voting_status) {
          clearLocalGroupVotingOverrides();
        }
        applyEffectiveVotingToTrophyState();
      },
      '投票狀態'
    ),
    subscribeAndWait(
      (cb, err) => data.subscribeMySubmission(pid, cb, err),
      submission => {
        state.trophy.submissionStatus = submission ? submission.status : '';
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

  // Groups overrides are additive. Wait for the first snapshot (or a short
  // timeout) before enabling open/close toasts so login baselines do not look
  // like live status changes.
  await new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    track(data.subscribeGroups(
      map => {
        applyGroupsSnapshot(map);
        updateSendFormState();
        updateCharCounter();
        applyEffectiveVotingToTrophyState();
        maybeNotifyMessagingOpenChange();
        renderStaffFacilitatorPanel();
        refreshStaffTrophyViews();
        renderProfile();
        finish();
      },
      err => {
        console.warn('組別設定 listener error:', err && err.message);
        applyGroupsSnapshot({});
        finish();
      }
    ));
    setTimeout(finish, 3000);
  });

  enableStatusChangeNotices();

  const facilitateGroup = getFacilitatorGroupId(pid);
  if (facilitateGroup) {
    applyStaffParticipantChrome();
    state.staffTrophy.trophies = filterValidTrophies(
      state.trophy.trophies.length ? state.trophy.trophies : []
    );
    const memberIds = () => getFacilitatorGroupMembers(facilitateGroup).map(p => p.participant_id);
    const voterIds = () => getVotingParticipants(getFacilitatorGroupMembers(facilitateGroup))
      .map(p => p.participant_id);
    track(data.subscribeGroupThreadMessages(
      facilitateGroup,
      messages => {
        state.staffMonitorMessages = messages;
        if (!state.staffMonitorBootstrapped) {
          state.staffKnownMessageIds = new Set(messages.map(m => m.message_id));
          state.staffMonitorBootstrapped = true;
        }
        renderStaffGroupMessages();
        renderStaffFacilitatorPanel();
      },
      err => {
        console.warn('組內留言監控 listener error:', err && err.message);
        state.staffMonitorMessages = [];
      }
    ));
    track(data.subscribePresenceForParticipants(
      memberIds(),
      rows => {
        state.presence = rows;
        renderStaffLoginStatus();
        renderStaffLiveLoad();
      },
      err => {
        console.warn('本組登入狀況 listener error:', err && err.message);
        state.presence = [];
      }
    ));
    track(data.subscribeSubmissionsForParticipants(
      voterIds(),
      submissions => {
        state.staffTrophy.submissions = submissions;
        refreshStaffTrophyViews();
      },
      err => {
        console.warn('本組投票紀錄 listener error:', err && err.message);
      }
    ));
    track(data.subscribeResultsForParticipants(
      voterIds(),
      results => {
        state.staffTrophy.results = results;
        refreshStaffTrophyViews();
      },
      err => {
        console.warn('本組得獎結果 listener error:', err && err.message);
      }
    ));
  } else {
    applyStaffParticipantChrome();
  }
}

/**
 * Results are unreadable until they are published, and a listener that gets
 * refused is dead for good. So the listener is opened only once publishing has
 * happened, and closed again if the admin reopens voting.
 */
function ensureResultSubscription() {
  const published = effectiveVotingConfigForMe().voting_status === 'PUBLISHED';

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
      // Auto modal only when voting status freshly becomes PUBLISHED.
    },
    reportSubscriptionError('得獎結果')
  ));
}

/** Whether this participant may still change their ballot right now. */
function recalcTrophyPermissions() {
  const config = effectiveVotingConfigForMe();
  const open = config.voting_status === 'VOTING_OPEN';
  const submitted = state.trophy.submissionStatus === 'submitted';
  // Default: once submitted, locked. allow_resubmit is an explicit admin override.
  state.trophy.editable = open && (!submitted || !!config.allow_resubmit);
  state.trophy.readonly = !state.trophy.editable;
  state.trophy.showResults = config.voting_status === 'PUBLISHED';
}

function isParticipantUnassigned() {
  if (state.isAdmin || isStaffPerson(state.participantId)) return false;
  return data.isUnassignedGroup(myGroupId());
}

function applyUnassignedChrome() {
  const blocked = isParticipantUnassigned();
  if (DOM.homeUnassignedBanner) {
    DOM.homeUnassignedBanner.classList.toggle('hidden', !blocked);
  }
  document.querySelectorAll('#screen-participant .home-cards .home-card').forEach(card => {
    const nav = card.dataset.nav;
    if (nav === 'profile' || nav === 'staff') return;
    card.classList.toggle('is-disabled', blocked);
    card.toggleAttribute('disabled', blocked);
    card.setAttribute('aria-disabled', blocked ? 'true' : 'false');
  });
  document.querySelectorAll('#screen-participant .bottom-nav-item').forEach(btn => {
    const tab = btn.dataset.tab;
    if (tab === 'home' || tab === 'profile') return;
    btn.classList.toggle('is-disabled', blocked);
    btn.toggleAttribute('disabled', blocked);
  });
}

async function enterParticipantDashboard() {
  showScreen('participant');
  updateParticipantGreeting();
  initSendCombobox();
  updateSendFormState();
  updateCharCounter();
  applyStaffParticipantChrome();
  applyUnassignedChrome();
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
    renderPushStatus();
    applyLaunchDeepLink();
  } catch (err) {
    showToast('載入資料失敗：' + data.describeFirestoreError(err, '請稍後再試'), 'error');
  } finally {
    finishLoading();
  }
  maybePromptPushOnLogin().catch(() => {});
}

function updateParticipantGreeting() {
  if (!DOM.participantGreeting) return;
  const name = displayNameOf(state.participantId) || state.participantId || '';
  DOM.participantGreeting.innerHTML = '你好，' + escapeHtml(name) + ' ' + appIcon('wave', 'inline-icon');
  if (DOM.participantSubgreeting) {
    DOM.participantSubgreeting.innerHTML = 'Just For You ' + appIcon('heart', 'inline-icon');
  }
}

function renderProfile() {
  if (!DOM.profileStats) return;
  const p = state.participants.find(x => x.participant_id === state.participantId) || {};
  const name = displayNameOf(p) || state.participantId || '—';
  if (DOM.profileAvatar) DOM.profileAvatar.textContent = name.slice(0, 2);
  if (DOM.profileName) DOM.profileName.textContent = name;
  if (DOM.profileGroup) DOM.profileGroup.textContent = formatGroupLabel(p.group_id || '未分組');
  if (DOM.profileLoginId) DOM.profileLoginId.textContent = '登入編號：' + (state.participantId || '—');
  if (DOM.profileDisplayName && document.activeElement !== DOM.profileDisplayName) {
    DOM.profileDisplayName.value = (p.display_name || '').trim();
  }

  const sentCount = state.sentMessages.filter(m => m.status === 'active').length;
  const receivedCount = state.inboxMessages.length;
  const votingLabel = isStaffPerson(state.participantId) ? '不適用' :
    state.trophy.submissionStatus === 'submitted' ? '已提交' :
    (state.trophy.editable ? '進行中' : VOTING_STATUS_LABELS[state.trophy.votingStatus] || '—');

  DOM.profileStats.innerHTML = `
    <div class="profile-stat"><div class="profile-stat-value">${sentCount}</div><div class="profile-stat-label">已發留言</div></div>
    <div class="profile-stat"><div class="profile-stat-value">${receivedCount}</div><div class="profile-stat-label">收到留言</div></div>
    <div class="profile-stat"><div class="profile-stat-value">${escapeHtml(formatGroupLabel(p.group_id || '—'))}</div><div class="profile-stat-label">分組</div></div>
    <div class="profile-stat"><div class="profile-stat-value">${votingLabel}</div><div class="profile-stat-label">投票狀態</div></div>
  `;
  renderPushStatus();
  renderStaffFacilitatorPanel();
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
  const stored = state.adminTrophy.results.filter(r => isSeatParticipantId(r.participant_id));
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

function refreshStaffTrophyViews() {
  const groupId = getFacilitatorGroupId();
  const members = getVotingParticipants(getFacilitatorGroupMembers(groupId));
  const trophies = state.staffTrophy.trophies.length
    ? state.staffTrophy.trophies
    : filterValidTrophies(state.trophy.trophies);
  state.staffTrophy.trophies = trophies;
  const submissions = state.staffTrophy.submissions;
  const voting = effectiveVotingConfigForGroup(groupId);

  state.staffTrophy.overview = buildTrophyOverview(submissions, trophies, members, voting.voting_status);
  state.staffTrophy.auditVotes = buildAuditVotes(submissions, trophies);

  const projection = data.computeResults(members, trophies, submissions);
  state.staffTrophy.trophySummary = projection.trophySummary;

  const stored = state.staffTrophy.results.filter(r => members.some(p => p.participant_id === r.participant_id));
  state.staffTrophy.profiles = stored.length > 0
    ? stored
      .map(r => {
        const awards = (r.awards || []).filter(a => a.award_source !== 'fallback');
        return {
          participant_id: r.participant_id,
          trophies: awards,
          vote_count: awards.reduce((sum, a) => sum + (a.vote_count || 0), 0)
        };
      })
      .sort((a, b) => a.participant_id.localeCompare(b.participant_id))
    : projection.profiles.filter(p => members.some(m => m.participant_id === p.participant_id));

  renderStaffTrophyStats();
  renderStaffPendingVoters();
  renderStaffResults();
  renderStaffLiveLoad();
  if (state.adminTrophy.matrixModal) renderVoteMatrixModal();
}

async function startAdminSubscriptions() {
  await Promise.all([
    subscribeAndWait(
      (cb, err) => data.subscribeParticipants(cb, err),
      rows => {
        state.participants = rows;
        setParticipantsCache(rows);
        initAdminParticipantCombobox();
        refreshAdminTrophyViews();
        renderAdminDashboard();
        renderAdminLoginStatus();
        renderAdminGroupOverrides();
      },
      '參加者名單'
    ),
    subscribeAndWait(
      (cb, err) => data.subscribeMessagingStatus(cb, err),
      status => {
        state.messagingOpen = status === 'OPEN';
        renderAdminDashboard();
        renderAdminGroupOverrides();
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
        const prevStatus = state.votingConfig.voting_status;
        state.votingConfig = config;
        if (prevStatus !== config.voting_status) {
          clearLocalGroupVotingOverrides();
          renderAdminGroupOverrides();
        }
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

  // Groups overrides are additive. If rules lag behind the client, the rest of
  // the admin console must still open instead of failing the whole login.
  track(data.subscribeGroups(
    map => {
      applyGroupsSnapshot(map);
      refreshAdminTrophyViews();
      renderAdminDashboard();
      renderAdminGroupOverrides();
      populateAdminMsgGroupFilter();
      if (isAdminMessagesTabActive()) renderAdminMessages();
    },
    err => {
      console.warn('組別設定 listener error:', err && err.message);
      applyGroupsSnapshot({});
      renderAdminGroupOverrides();
    }
  ));

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
  startAdminLoginStatusRefresh();
}

function startAdminLoginStatusRefresh() {
  stopAdminLoginStatusRefresh();
  // Presence docs only push when they change; stale heartbeats need a local tick
  // so「已登入」flips after PRESENCE_ONLINE_MS without a new snapshot.
  adminLoginStatusRefreshTimer = setInterval(() => {
    if (!state.isAdmin) return;
    renderAdminLoginStatus();
    renderAdminLiveLoad();
  }, 15000);
}

function stopAdminLoginStatusRefresh() {
  if (adminLoginStatusRefreshTimer) {
    clearInterval(adminLoginStatusRefreshTimer);
    adminLoginStatusRefreshTimer = null;
  }
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
    showToast('載入管理員資料失敗：' + data.describeFirestoreError(err, '請稍後再試'), 'error');
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
      <div class="status-item"><span>全域留言</span><span>${state.messagingOpen ? appIcon('dot-green') + ' 開啟' : appIcon('dot-red') + ' 關閉'}</span></div>
      <div class="status-item"><span>全域投票</span><span>${votingLabel}</span></div>
    `;
  }

  if (DOM.adminRecentActivity) {
    const recent = state.monitorMessages.slice(0, 5);
    DOM.adminRecentActivity.innerHTML = recent.length === 0
      ? '<p class="form-hint">暫無最近活動</p>'
      : recent.map(m => `
        <div class="activity-item">
          <span>${escapeHtml(displayLabelOf(m.sender_id))} → ${escapeHtml(displayLabelOf(m.receiver_id))}</span>
          <time>${formatDateTime(m.created_at)}</time>
        </div>
      `).join('');
  }
  renderAdminGroupOverrides();
  renderAdminRosterBoard();

  if (DOM.adminVersion) DOM.adminVersion.textContent = 'Firestore';
  if (DOM.adminParticipantCount) DOM.adminParticipantCount.textContent = String(state.participants.length || '—');
  renderAdminLoginStatus();
}

async function handleLogout() {
  const leavingId = state.participantId;
  const wasAdmin = state.isAdmin;
  state.isLoggingOut = true;
  stopAllSubscriptions();
  if (leavingId && !wasAdmin) {
    try {
      await data.markPresenceOffline(leavingId);
      // A heartbeat can race with logout right around the 45s interval.
      // Delete once more after a short beat so the stale write cannot linger.
      await new Promise(resolve => setTimeout(resolve, 250));
      await data.markPresenceOffline(leavingId);
    } catch (_) { /* best-effort */ }
  }
  await data.signOutUser().catch(() => { /* the local session is gone either way */ });
  clearSession();
  state.participantId = null;
  state.sessionStartedAt = 0;
  state.handledForceLogoutRev = 0;
  state.isLoggingOut = false;
  state.isAdmin = false;
  state.inboxMessages = [];
  state.sentMessages = [];
  knownInboxIds = new Set();
  inboxHydrated = false;
  pushEnabledLocally = false;
  if (pushForegroundUnsub) {
    try { pushForegroundUnsub(); } catch (_) { /* ignore */ }
    pushForegroundUnsub = null;
  }
  state.monitorMessages = [];
  state.staffMonitorMessages = [];
  state.staffMonitorBootstrapped = false;
  state.staffKnownMessageIds = new Set();
  state.staffTrophy = {
    overview: null,
    auditVotes: [],
    profiles: [],
    trophySummary: [],
    trophies: [],
    submissions: [],
    results: []
  };
  state.groupMeta = {};
  pendingGroupVotingWrites.clear();
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
  closeForceLogoutModal();
  closeForceLogoutAllModal();
  closeConfirmModal(false);
  closeTrophyGuideModal();
  hideOnboarding();
  state.trophy = {
    loaded: false,
    loading: false,
    votingStatus: 'DRAFT',
    trophies: [],
    teammates: [],
    assignments: {},
    readonly: false,
    editable: false,
    submissionStatus: '',
    progress: { assigned: 0, total: 0 },
    myAwards: [],
    showResults: false,
    trophyRevision: '',
    resultsModalRevision: '',
    reviewSubmitted: false
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
  const staffGlobal = isStaffPerson(state.participantId);
  const closed = !isMessagingOpenForMe();
  const groupClosed = !staffGlobal && state.messagingOpen && !groupMessagingOpen(myGroupId());
  updateSendReceiverPlaceholder();
  if (DOM.sendClosedBanner) {
    DOM.sendClosedBanner.textContent = groupClosed
      ? '本組留言功能目前已關閉，請稍後再試'
      : '留言功能目前已關閉，請稍後再試';
    DOM.sendClosedBanner.classList.toggle('hidden', !closed);
  }
  if (DOM.sendClosedState) DOM.sendClosedState.classList.toggle('hidden', !closed);
  if (DOM.sendForm) {
    DOM.sendForm.classList.toggle('hidden', closed);
    DOM.sendForm.classList.toggle('disabled', closed);
  }
  if (DOM.sendGuide) DOM.sendGuide.classList.toggle('hidden', closed);
  if (DOM.sendSubmit) {
    if (closed) DOM.sendSubmit.disabled = true;
    else updateCharCounter();
  }
}

function updateCharCounter() {
  const len = DOM.sendContent.value.length;
  DOM.charCounter.textContent = len + '/' + CONFIG.MAX_MESSAGE_LENGTH;
  DOM.charCounter.classList.toggle('warn', len >= CONFIG.CHAR_WARN_THRESHOLD && len <= CONFIG.MAX_MESSAGE_LENGTH);
  DOM.charCounter.classList.toggle('over', len > CONFIG.MAX_MESSAGE_LENGTH);

  const { hasEmoji, hasBadWords } = textInputBlocked(DOM.sendContent.value, { checkBadWords: true });
  DOM.badWordsWarning.classList.toggle('hidden', !hasBadWords);
  if (DOM.emojiWarning) DOM.emojiWarning.classList.toggle('hidden', !hasEmoji);
  const empty = !DOM.sendContent.value.trim();
  const messagingOpen = isMessagingOpenForMe();
  DOM.sendSubmit.disabled = hasBadWords || hasEmoji || !messagingOpen || empty;
}

async function handleSendMessage(e) {
  e.preventDefault();
  if (!isMessagingOpenForMe()) {
    showToast('留言功能目前已關閉', 'error');
    return;
  }

  const receiverId = selectedReceiverId || normalizeId(DOM.sendReceiver.value);
  const content = DOM.sendContent.value.trim();

  if (!receiverId) { showToast('請選擇接收者', 'error'); return; }
  if (!content) { showToast('請輸入留言內容', 'error'); return; }
  if (rejectIfTextBlocked(content, { checkBadWords: true })) return;

  const sender = findParticipantById(state.participantId);
  const receiver = findParticipantById(receiverId);
  const allowed = data.getMessageRecipients(state.participantId, state.participants)
    .some(p => p.participant_id === receiverId);
  if (!receiver || !allowed) {
    showToast(
      isStaffPerson(state.participantId) ? '請選擇有效接收者' : '只可以留言俾自己組嘅隊友',
      'error'
    );
    return;
  }

  DOM.sendContent.value = '';
  DOM.sendReceiver.value = '';
  selectedReceiverId = null;
  updateCharCounter();
  switchParticipantView('sent');

  // The write lands in the local cache first, so the listener has already put
  // the message on screen by the time this returns. If the network is down the
  // SDK holds the write and sends it on reconnect, which is why there is no
  // spinner and no retry button any more.
  data.sendMessage(state.participantId, receiverId, content, {
    senderGroupId: (sender && sender.group_id) || '',
    receiverGroupId: (receiver && receiver.group_id) || ''
  }).catch(err => {
    showToast('留言傳送失敗：' + data.describeFirestoreError(err, '請稍後再試'), 'error');
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
        <span class="admin-msg-route">${escapeHtml(displayLabelOf(msg.sender_id))}<span class="arrow">→</span>${escapeHtml(displayLabelOf(msg.receiver_id))}</span>
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
  const voted = state.adminTrophy.submissions.filter(
    s => s.status === 'submitted' && isSeatParticipantId(s.participant_id)
  ).length;
  const voterCount = getVotingParticipants().length;
  const online = state.presence.filter(p => isPresenceCurrentlyLoggedIn(p)).length;
  const loggedIn = online;

  if (DOM.adminQueuePill) {
    DOM.adminQueuePill.textContent = '在線 ' + online;
    DOM.adminQueuePill.classList.toggle('hidden', online === 0);
    DOM.adminQueuePill.classList.toggle('badge-queue-busy', online > 30);
  }

  if (DOM.adminLiveLoad) {
    DOM.adminLiveLoad.innerHTML = `
      <div class="stat-card"><div class="stat-value">${loggedIn}/${state.participants.length}</div><div class="stat-label">已登入</div></div>
      <div class="stat-card"><div class="stat-value">${online}</div><div class="stat-label">現正線上</div></div>
      <div class="stat-card"><div class="stat-value">${voted}/${voterCount}</div><div class="stat-label">已完成投票</div></div>
      <div class="stat-card"><div class="stat-value">${recent}</div><div class="stat-label">近 5 分鐘留言</div></div>
    `;
  }
}

async function handleAdminDelete(messageId, btn) {
  if (!(await showConfirmCard({
    title: '撤回留言',
    body: '確定要撤回此留言嗎？接收者將不會收到此訊息。',
    confirmLabel: '撤回',
    danger: true
  }))) return;

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
      showToast(data.describeFirestoreError(err), 'error');
    }
  })());
}

async function handleAdminRestore(messageId, btn) {
  if (!(await showConfirmCard({
    title: '取消撤回',
    body: '確定要取消撤回？留言會重新出現喺接收者收件箱。',
    confirmLabel: '取消撤回'
  }))) return;

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
      showToast(data.describeFirestoreError(err), 'error');
    }
  })());
}

async function handleSetMessagingStatus(status, btn) {
  await runProgressButton(btn, (async () => {
    try {
      await data.setMessagingStatus(status);
      showToast(status === 'OPEN' ? '留言功能已開啟' : '留言功能已關閉', status);
    } catch (err) {
      showToast(data.describeFirestoreError(err), 'error');
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

/** CSS tone class for voting-status cards / badge. */
function votingStatusToneClass(status) {
  switch (status) {
    case 'VOTING_OPEN': return 'tone-open';
    case 'VOTING_CLOSED': return 'tone-closed';
    case 'CALCULATED': return 'tone-calculated';
    case 'PUBLISHED': return 'tone-published';
    default: return 'tone-draft';
  }
}

function filterValidTrophies(trophies) {
  return (trophies || []).filter(t => /^T\d+$/i.test(String(t.trophy_id || '').trim()));
}

/** Fixed defaults for award guide (Admin can override name/description in Firestore). */
const TROPHY_META = {
  T01: {
    en: 'Pump Up Man',
    color: '#E85D75',
    colorLabel: '粉紅',
    description: '最經常為他人打氣／鼓勵他人'
  },
  T02: {
    en: 'Icebreaker',
    color: '#4A7FD4',
    colorLabel: '藍色',
    description: '勇於為團隊付出 — 願意做第一個破冰'
  },
  T03: {
    en: 'Wor C Lo',
    color: '#F5F0E8',
    colorLabel: '白色',
    description: '發生僵局或者爭執的時候勇敢站出'
  },
  T04: {
    en: 'Real Good Guy',
    color: '#5BAF7A',
    colorLabel: '綠色',
    description: '樂於助人 — 經常幫助隊友'
  },
  T05: {
    en: 'Senior Jojo',
    color: '#8B6BCF',
    colorLabel: '紫色',
    description: '數人數，唔比其他人漏底，幫助組爸媽 — 團體意識'
  },
  T06: {
    en: 'Very Important People',
    color: '#F0C94A',
    colorLabel: '黃色',
    description: '帶成組贏，力挽狂瀾 — 付出自己的力量為團隊付出'
  },
  T07: {
    en: 'Stalker',
    color: '#3A3A3A',
    colorLabel: '黑色',
    description: '最觀察入微的人'
  },
  T08: {
    en: 'Head Head Is Road',
    color: '#E8913A',
    colorLabel: '橙色',
    description: '全程投入參與'
  }
};

function normalizeTrophyId(trophyId) {
  const raw = String(trophyId || '').trim().toUpperCase();
  const m = raw.match(/^T0*(\d+)$/);
  if (!m) return raw;
  return 'T' + String(m[1]).padStart(2, '0');
}

function getTrophyMeta(trophyId, trophyName = '') {
  const id = normalizeTrophyId(trophyId);
  if (TROPHY_META[id]) return { id, ...TROPHY_META[id] };
  const name = String(trophyName || '').trim();
  const nameMap = {
    '氣球人': 'T01',
    '破冰人': 'T02',
    '和事佬': 'T03',
    '真好人': 'T04',
    '組爸媽繼承人': 'T05',
    '關鍵人物': 'T06',
    '潛行者': 'T07',
    '頭頭是道': 'T08'
  };
  const mapped = nameMap[name];
  if (mapped && TROPHY_META[mapped]) return { id: mapped, ...TROPHY_META[mapped] };
  return {
    id,
    en: '',
    color: '#C4A574',
    colorLabel: '',
    description: ''
  };
}

/** Old built-in copy superseded by TROPHY_META — ignore if still stored in Firestore. */
const LEGACY_TROPHY_DESCRIPTIONS = {
  T07: ['紀錄全組的活動，用手機影相']
};

function isLegacyTrophyDescription(trophyId, description) {
  const id = normalizeTrophyId(trophyId);
  const text = String(description || '').trim();
  if (!text) return true;
  const legacy = LEGACY_TROPHY_DESCRIPTIONS[id];
  return Array.isArray(legacy) && legacy.includes(text);
}

/** Prefer Firestore description; fall back to built-in guide copy. */
function resolveTrophyDescription(trophyOrId, trophyName = '') {
  if (trophyOrId && typeof trophyOrId === 'object') {
    const stored = String(trophyOrId.description || '').trim();
    const meta = getTrophyMeta(trophyOrId.trophy_id, trophyOrId.trophy_name || trophyName);
    if (stored && !isLegacyTrophyDescription(meta.id || trophyOrId.trophy_id, stored)) {
      return stored;
    }
    return meta.description || '';
  }
  const id = trophyOrId;
  const pools = [
    state.adminTrophy?.trophies,
    state.staffTrophy?.trophies,
    state.trophy?.trophies
  ];
  for (const list of pools) {
    const hit = (list || []).find(t => t && t.trophy_id === id);
    if (hit) {
      const stored = String(hit.description || '').trim();
      if (stored && !isLegacyTrophyDescription(id, stored)) return stored;
      break;
    }
  }
  return getTrophyMeta(id, trophyName).description || '';
}

function trophyGuideImageSrc(trophyId) {
  const id = normalizeTrophyId(trophyId).toLowerCase();
  return `assets/trophies/${id}.png`;
}

function trophyIconHtml(trophyId, trophyName = '', className = 'trophy-icon') {
  const src = trophyGuideImageSrc(trophyId);
  const alt = String(trophyName || trophyId || '').trim() || '獎項';
  return `<img class="${escapeHtml(className)}" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" onerror="this.onerror=null;this.src='assets/trophy.png'">`;
}

function buildAwardsHtml(awards) {
  if (!awards || awards.length === 0) {
    return '<p class="trophy-results-empty">暫未獲得獎項，請稍後再查看</p>';
  }
  return awards.map(a => `
    <div class="trophy-result-item">
      ${trophyIconHtml(a.trophy_id, a.trophy_name, 'trophy-icon trophy-icon-lg')}
      <div class="trophy-result-name">${escapeHtml(a.trophy_name)}</div>
    </div>
  `).join('');
}

function showTrophyResultsModal(awards) {
  if (!DOM.trophyResultsModal) return;
  DOM.trophyResultsModalList.innerHTML = buildAwardsHtml(awards);
  DOM.trophyResultsModal.classList.remove('hidden');
  syncBodyModalOpen();
  state.trophy.resultsModalRevision = state.trophy.trophyRevision;
  launchConfetti();
}

function hideTrophyResultsModal() {
  if (!DOM.trophyResultsModal) return;
  DOM.trophyResultsModal.classList.add('hidden');
  syncBodyModalOpen();
}

function syncBodyModalOpen() {
  const anyOpen = [
    DOM.trophyResultsModal,
    DOM.voteMatrixModal,
    DOM.forceLogoutModal,
    DOM.forceLogoutAllModal,
    DOM.a2hsModal,
    DOM.confirmModal,
    DOM.groupRenameModal,
    DOM.rosterEditModal,
    DOM.rosterAddModal,
    DOM.trophyGuideModal
  ].some(el => el && !el.classList.contains('hidden'));
  document.body.classList.toggle('modal-open', anyOpen);
}

let confirmModalResolver = null;

/** In-app card confirm — replaces browser window.confirm popups. */
function showConfirmCard({
  title = '確認',
  body = '',
  confirmLabel = '確定',
  cancelLabel = '取消',
  danger = false
} = {}) {
  return new Promise(resolve => {
    if (!DOM.confirmModal) {
      resolve(false);
      return;
    }
    if (confirmModalResolver) {
      const prev = confirmModalResolver;
      confirmModalResolver = null;
      prev(false);
    }
    confirmModalResolver = resolve;
    if (DOM.confirmModalTitle) DOM.confirmModalTitle.textContent = title;
    if (DOM.confirmModalBody) DOM.confirmModalBody.textContent = body;
    if (DOM.confirmModalCancel) DOM.confirmModalCancel.textContent = cancelLabel;
    if (DOM.confirmModalOkLabel) DOM.confirmModalOkLabel.textContent = confirmLabel;
    else if (DOM.confirmModalOk) DOM.confirmModalOk.textContent = confirmLabel;
    if (DOM.confirmModalOk) {
      DOM.confirmModalOk.classList.toggle('btn-danger', !!danger);
      DOM.confirmModalOk.classList.toggle('btn-primary', !danger);
    }
    DOM.confirmModal.classList.remove('hidden');
    syncBodyModalOpen();
    setTimeout(() => DOM.confirmModalOk?.focus(), 0);
  });
}

function closeConfirmModal(result) {
  if (DOM.confirmModal) DOM.confirmModal.classList.add('hidden');
  syncBodyModalOpen();
  const resolve = confirmModalResolver;
  confirmModalResolver = null;
  if (resolve) resolve(!!result);
}

function clearOnboardingTarget() {
  if (onboardingState.targetEl) {
    onboardingState.targetEl.classList.remove('onboarding-target');
    onboardingState.targetEl = null;
  }
}

function detachOnboardingReposition() {
  if (!onboardingState.repositionBound) return;
  window.removeEventListener('resize', onboardingState.repositionBound);
  window.removeEventListener('scroll', onboardingState.repositionBound, true);
  onboardingState.repositionBound = null;
}

function readSeenOnboardingPages() {
  try {
    const raw = localStorage.getItem(ONBOARDING_SEEN_KEY);
    const data = raw ? JSON.parse(raw) : {};
    return data && typeof data === 'object' ? data : {};
  } catch (_) {
    return {};
  }
}

function hasSeenPageOnboarding(role, page) {
  return !!readSeenOnboardingPages()[role + ':' + page];
}

function markPageOnboardingSeen(role, page) {
  if (!role || !page) return;
  try {
    const seen = readSeenOnboardingPages();
    seen[role + ':' + page] = true;
    localStorage.setItem(ONBOARDING_SEEN_KEY, JSON.stringify(seen));
  } catch (_) { /* private mode / quota */ }
}

function getCurrentOnboardingContext() {
  if (state.isAdmin && DOM.screenAdmin && !DOM.screenAdmin.classList.contains('hidden')) {
    const active = document.querySelector('.admin-bottom-nav .bottom-nav-item.active');
    return { role: 'admin', page: active?.dataset.adminTab || 'dashboard' };
  }
  if (DOM.screenParticipant && !DOM.screenParticipant.classList.contains('hidden')) {
    const view = document.querySelector('#screen-participant .app-view.active');
    const viewName = view?.dataset.view || 'home';
    // Submitted success screen is transient — wait until they open Trophy again.
    if (viewName === 'trophy-submitted') return null;
    if (viewName === 'staff') {
      const section = document.querySelector('.staff-module-nav .bottom-nav-item.active')?.dataset.staffSection || 'dashboard';
      return { role: 'participant', page: 'staff:' + section };
    }
    return { role: 'participant', page: viewName };
  }
  return null;
}

function stepMatchesOnboardingPage(step, page) {
  if (!step || !page) return false;
  if (page.startsWith('staff:')) {
    return step.prepare === 'staff' && step.staffSection === page.slice(6);
  }
  return step.prepare === page;
}

function getOnboardingStepsForPage(role, page) {
  return (ONBOARDING_STEPS[role] || []).filter(step => {
    if (!stepMatchesOnboardingPage(step, page)) return false;
    if (step.skipIfStaff && isStaffPerson(state.participantId)) return false;
    return true;
  });
}

/** Within a page tour, only switch in-page sub-tabs — never jump to another page. */
function prepareOnboardingStep(step) {
  if (!step) return;
  if (onboardingState.role === 'admin') {
    if (step.resultTab) switchResultTab(step.resultTab);
  } else if (step.staffResultTab) {
    switchStaffResultTab(step.staffResultTab);
  }
}

function isOnboardingTargetVisible(el) {
  if (!el) return false;
  if (el.classList.contains('hidden')) return false;
  if (el.closest('.app-view.hidden, .admin-panel.hidden, .result-panel.hidden, .staff-section.hidden, .screen.hidden')) {
    return false;
  }
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
    return false;
  }
  const rect = el.getBoundingClientRect();
  return rect.width >= 2 && rect.height >= 2;
}

function findOnboardingTarget(step) {
  if (!step || !step.target) return null;
  const nodes = document.querySelectorAll(step.target);
  for (const el of nodes) {
    if (isOnboardingTargetVisible(el)) return el;
  }
  return null;
}

function resolveOnboardingTarget() {
  const steps = onboardingState.steps || [];
  const direction = onboardingState.skipDirection >= 0 ? 1 : -1;
  let guard = steps.length + 1;
  while (guard-- > 0) {
    const step = steps[onboardingState.step];
    if (!step) return null;
    prepareOnboardingStep(step);
    const target = findOnboardingTarget(step);
    if (target) return target;
    const next = onboardingState.step + direction;
    if (next < 0 || next >= steps.length) return null;
    onboardingState.step = next;
  }
  return null;
}

function positionOnboardingAround(target) {
  if (!DOM.onboardingSpotlight || !DOM.onboardingTip || !target) return;

  const pad = 6;
  const rect = target.getBoundingClientRect();
  const spotTop = Math.max(8, rect.top - pad);
  const spotLeft = Math.max(8, rect.left - pad);
  const spotWidth = Math.min(window.innerWidth - spotLeft - 8, rect.width + pad * 2);
  const spotHeight = Math.min(window.innerHeight - spotTop - 8, rect.height + pad * 2);

  DOM.onboardingSpotlight.style.top = spotTop + 'px';
  DOM.onboardingSpotlight.style.left = spotLeft + 'px';
  DOM.onboardingSpotlight.style.width = spotWidth + 'px';
  DOM.onboardingSpotlight.style.height = spotHeight + 'px';

  const tip = DOM.onboardingTip;
  tip.style.visibility = 'hidden';
  tip.style.top = '0px';
  tip.style.left = '0px';
  const tipWidth = tip.offsetWidth || 280;
  const tipHeight = tip.offsetHeight || 160;
  const gap = 10;
  const margin = 12;

  let top = rect.bottom + gap;
  let placeBelow = true;
  if (top + tipHeight > window.innerHeight - margin && rect.top - gap - tipHeight > margin) {
    top = rect.top - gap - tipHeight;
    placeBelow = false;
  }
  top = Math.max(margin, Math.min(top, window.innerHeight - tipHeight - margin));

  let left = rect.left + (rect.width - tipWidth) / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - tipWidth - margin));

  if (placeBelow && top < rect.bottom) top = Math.min(rect.bottom + gap, window.innerHeight - tipHeight - margin);
  if (!placeBelow && top + tipHeight > rect.top) top = Math.max(margin, rect.top - gap - tipHeight);

  tip.style.top = top + 'px';
  tip.style.left = left + 'px';
  tip.style.visibility = 'visible';
}

function renderOnboardingStep() {
  const steps = onboardingState.steps || [];
  if (!DOM.onboardingCoach || !steps.length) return;

  clearOnboardingTarget();
  const target = resolveOnboardingTarget();
  const step = steps[onboardingState.step];
  if (!target || !step) {
    finishOnboarding();
    return;
  }

  onboardingState.targetEl = target;
  target.classList.add('onboarding-target');
  try {
    target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  } catch (_) { /* older browsers */ }

  DOM.onboardingStepLabel.textContent = `${onboardingState.step + 1} / ${steps.length}`;
  DOM.onboardingTitle.textContent = step.title;
  DOM.onboardingBody.textContent = step.body;

  if (DOM.onboardingPrev) {
    DOM.onboardingPrev.classList.toggle('hidden', onboardingState.step === 0);
  }
  if (DOM.onboardingNext) {
    DOM.onboardingNext.textContent = onboardingState.step >= steps.length - 1 ? '知道了' : '下一步';
  }

  requestAnimationFrame(() => {
    positionOnboardingAround(target);
    requestAnimationFrame(() => positionOnboardingAround(target));
  });
}

function showOnboardingForPage(role, page, { force = false } = {}) {
  if (!DOM.onboardingCoach || (role !== 'participant' && role !== 'admin') || !page) return;
  const steps = getOnboardingStepsForPage(role, page);
  if (!steps.length) return;
  if (!force && hasSeenPageOnboarding(role, page)) return;

  onboardingState.role = role;
  onboardingState.page = page;
  onboardingState.steps = steps;
  onboardingState.step = 0;
  onboardingState.skipDirection = 1;

  DOM.onboardingCoach.classList.remove('hidden');
  DOM.onboardingCoach.setAttribute('aria-hidden', 'false');
  if (DOM.onboardingDim) DOM.onboardingDim.style.display = '';

  detachOnboardingReposition();
  onboardingState.repositionBound = () => {
    if (!onboardingState.targetEl) return;
    positionOnboardingAround(onboardingState.targetEl);
  };
  window.addEventListener('resize', onboardingState.repositionBound);
  window.addEventListener('scroll', onboardingState.repositionBound, true);

  renderOnboardingStep();
  DOM.onboardingNext?.focus();
}

function hideOnboarding() {
  if (!DOM.onboardingCoach) return;
  DOM.onboardingCoach.classList.add('hidden');
  DOM.onboardingCoach.setAttribute('aria-hidden', 'true');
  clearOnboardingTarget();
  detachOnboardingReposition();
  onboardingState.role = null;
  onboardingState.page = null;
  onboardingState.steps = [];
  onboardingState.step = 0;
  onboardingState.skipDirection = 1;
}

function finishOnboarding() {
  if (onboardingState.role && onboardingState.page) {
    markPageOnboardingSeen(onboardingState.role, onboardingState.page);
  }
  hideOnboarding();
}

function isOnboardingOpen() {
  return !!(DOM.onboardingCoach && !DOM.onboardingCoach.classList.contains('hidden'));
}

function isStandaloneApp() {
  if (window.navigator.standalone === true) return true;
  try {
    return window.matchMedia('(display-mode: standalone)').matches
      && !window.matchMedia('(display-mode: browser)').matches;
  } catch (_) {
    return false;
  }
}

function isIosDevice() {
  const ua = String(navigator.userAgent || '');
  return /iPhone|iPad|iPod/i.test(ua)
    || (navigator.platform === 'MacIntel' && Number(navigator.maxTouchPoints || 0) > 1);
}

function isAddToHomeOpen() {
  return !!(DOM.a2hsModal && !DOM.a2hsModal.classList.contains('hidden'));
}

function fillAddToHomeCopy() {
  const canInstall = !!deferredA2HSPrompt;
  const ios = isIosDevice();
  if (DOM.a2hsSubtitle) {
    DOM.a2hsSubtitle.textContent = canInstall
      ? '撳下面掣，就可以加到主畫面，之後全螢幕開啟會更清楚。'
      : '加到主畫面之後全螢幕開啟，唔使瀏覽器工具列擋住。';
  }
  if (DOM.a2hsSteps) {
    if (canInstall) {
      DOM.a2hsSteps.innerHTML = '';
      DOM.a2hsSteps.classList.add('hidden');
    } else if (ios) {
      DOM.a2hsSteps.classList.remove('hidden');
      DOM.a2hsSteps.innerHTML = `
        <li>用 <strong>Safari</strong> 開啟呢個網站</li>
        <li>撳底欄中間嘅 <strong>分享</strong> 按鈕</li>
        <li>向下滑，揀 <strong>加入主畫面</strong></li>
        <li>撳右上角 <strong>加入</strong></li>`;
    } else {
      DOM.a2hsSteps.classList.remove('hidden');
      DOM.a2hsSteps.innerHTML = `
        <li>撳瀏覽器右上角 <strong>⋮</strong> 選單</li>
        <li>揀 <strong>加入主畫面</strong> 或 <strong>安裝應用程式</strong></li>
        <li>之後喺主畫面撳 TNIT 圖示開啟</li>`;
    }
  }
  if (DOM.a2hsInstall) {
    DOM.a2hsInstall.textContent = canInstall ? '加入主畫面' : '知道了';
  }
}

function openAddToHomePrompt({ force = false } = {}) {
  const modal = DOM.a2hsModal || document.getElementById('a2hs-modal');
  if (!modal) return;
  DOM.a2hsModal = modal;
  if (isStandaloneApp()) {
    a2hsQueued = false;
    if (force) showToast('你已經喺主畫面版本開啟', 'info');
    return;
  }
  a2hsQueued = false;
  if (modal.parentNode !== document.body) {
    document.body.appendChild(modal);
  }
  fillAddToHomeCopy();
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
  modal.style.zIndex = '10050';
  syncBodyModalOpen();
  (deferredA2HSPrompt ? DOM.a2hsInstall : DOM.a2hsLater)?.focus();
}

function closeAddToHomePrompt({ resumeOnboarding = true } = {}) {
  if (!DOM.a2hsModal) return;
  DOM.a2hsModal.classList.add('hidden');
  DOM.a2hsModal.style.removeProperty('display');
  a2hsQueued = false;
  syncBodyModalOpen();
  if (resumeOnboarding) maybeShowPageOnboarding();
}

async function handleAddToHomeInstall() {
  if (deferredA2HSPrompt) {
    const promptEvent = deferredA2HSPrompt;
    deferredA2HSPrompt = null;
    try {
      promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice && choice.outcome === 'accepted') {
        showToast('已加入主畫面', 'success');
      }
    } catch (_) { /* user dismissed the native sheet */ }
    closeAddToHomePrompt();
    return;
  }
  closeAddToHomePrompt();
}

function maybeShowAddToHomePrompt() {
  const onLogin = DOM.screenLogin && !DOM.screenLogin.classList.contains('hidden');
  if (!onLogin || isStandaloneApp()) {
    a2hsQueued = false;
    if (DOM.loginA2hsBanner) DOM.loginA2hsBanner.classList.add('hidden');
    return;
  }
  if (DOM.loginA2hsBanner) DOM.loginA2hsBanner.classList.remove('hidden');
  if (isAddToHomeOpen()) return;
  a2hsQueued = true;
  openAddToHomePrompt();
}

function initAddToHome() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredA2HSPrompt = event;
    fillAddToHomeCopy();
  });
  window.addEventListener('appinstalled', () => {
    deferredA2HSPrompt = null;
    a2hsQueued = false;
    if (isAddToHomeOpen()) closeAddToHomePrompt({ resumeOnboarding: false });
  });
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js', { scope: './' })
      .then(reg => { serviceWorkerRegistration = reg; })
      .catch(() => {});
  }
}

function pushStatusLabel() {
  const perm = data.getNotificationPermission();
  if (perm === 'unsupported') return '此裝置／瀏覽器唔支援推送通知';
  if (perm === 'denied') return '狀態：已封鎖（請到系統設定重新允許）';
  if (hasPushOptOut()) return '狀態：已關閉';
  if (pushEnabledLocally && perm === 'granted') return '狀態：已開啟';
  if (perm === 'granted') return '狀態：瀏覽器已允許，撳開啟即可使用';
  return '狀態：未開啟';
}

function renderPushStatus() {
  if (DOM.profilePushStatus) DOM.profilePushStatus.textContent = pushStatusLabel();
  const canUse = data.getNotificationPermission() !== 'unsupported';
  if (DOM.profilePushEnable) DOM.profilePushEnable.disabled = !canUse;
  if (DOM.profilePushDisable) DOM.profilePushDisable.disabled = !canUse;
}

function notificationIconUrl() {
  try {
    return new URL('assets/heart.png', location.href).href;
  } catch (_) {
    return 'assets/heart.png';
  }
}

function hideAlertBanner() {
  if (DOM.alertBanner) DOM.alertBanner.classList.add('hidden');
}

function showAlertBanner(title, body, tag = 'tnit-local') {
  if (!DOM.alertBanner) return;
  if (DOM.alertBannerTitle) DOM.alertBannerTitle.textContent = title;
  if (DOM.alertBannerBody) DOM.alertBannerBody.textContent = body || '';
  DOM.alertBanner.dataset.tag = tag;
  DOM.alertBanner.classList.remove('hidden');
  clearTimeout(showAlertBanner._timer);
  showAlertBanner._timer = setTimeout(hideAlertBanner, 14000);
}

function openAlertBannerTarget() {
  const tag = String((DOM.alertBanner && DOM.alertBanner.dataset.tag) || '');
  hideAlertBanner();
  if (tag.includes('trophy')) switchParticipantView('trophy');
  else switchParticipantView('inbox');
}

function showLocalPushNotification(title, body, tag = 'tnit-local', { toast = true } = {}) {
  showAlertBanner(title, body, tag);
  if (toast) {
    showToast(body ? `${title}：${body}` : title, String(tag).includes('trophy') ? 'PUBLISHED' : 'info');
  }
  if (hasPushOptOut()) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

  const url = String(tag).includes('trophy') ? './#trophy' : './#inbox';
  const icon = notificationIconUrl();
  const options = {
    body,
    icon,
    badge: icon,
    tag,
    renotify: true,
    data: { url, tag }
  };

  const viaSw = (reg) => {
    if (reg && typeof reg.showNotification === 'function') {
      return reg.showNotification(title, options);
    }
    throw new Error('no-sw');
  };

  const fallback = () => {
    try {
      const n = new Notification(title, options);
      n.onclick = () => {
        window.focus();
        if (String(tag).includes('trophy')) switchParticipantView('trophy');
        else switchParticipantView('inbox');
        n.close();
      };
    } catch (_) { /* ignore */ }
  };

  try {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'tnit-notify',
        title,
        body,
        tag,
        url,
        icon
      });
    }
  } catch (_) { /* ignore */ }

  if (serviceWorkerRegistration) {
    Promise.resolve(viaSw(serviceWorkerRegistration)).catch(fallback);
    return;
  }
  if (navigator.serviceWorker) {
    navigator.serviceWorker.ready.then(viaSw).catch(fallback);
    return;
  }
  fallback();
}

function pushOptOutKey() {
  return 'tnit_push_opt_out:' + String(state.participantId || '').toUpperCase();
}

function hasPushOptOut() {
  try {
    return localStorage.getItem(pushOptOutKey()) === '1';
  } catch (_) {
    return false;
  }
}

function setPushOptOut(off) {
  try {
    if (off) localStorage.setItem(pushOptOutKey(), '1');
    else localStorage.removeItem(pushOptOutKey());
  } catch (_) { /* ignore */ }
}

async function applyPushEnableResult(result, { toast = true } = {}) {
  if (result.ok) {
    setPushOptOut(false);
    pushEnabledLocally = true;
    if (toast) showToast('推送通知已開啟', 'success');
    await setupPushAfterLogin();
    renderPushStatus();
    return true;
  }
  pushEnabledLocally = false;
  if (!toast) return false;
  if (result.reason === 'denied') {
    showToast('通知已被封鎖，請到系統設定開啟', 'error');
  } else if (result.reason === 'unsupported') {
    showToast('此裝置唔支援推送通知', 'info');
  } else if (result.reason === 'dismissed') {
    showToast('未開啟通知，可稍後喺「我的」再開', 'info');
  } else {
    showToast('未能開啟通知', 'error');
  }
  renderPushStatus();
  return false;
}

async function requestEnablePush({ toast = true } = {}) {
  const result = await data.enablePushNotifications(
    state.participantId,
    serviceWorkerRegistration || (navigator.serviceWorker && await navigator.serviceWorker.ready)
  );
  return applyPushEnableResult(result, { toast });
}

async function maybePromptPushOnLogin() {
  if (!state.participantId || state.isAdmin) return;
  if (!data.isNotificationApiSupported()) {
    renderPushStatus();
    return;
  }
  await setupPushAfterLogin();
  if (pushEnabledLocally) return;
  const perm = data.getNotificationPermission();
  if (perm === 'denied' || perm === 'unsupported') return;
  if (hasPushOptOut()) return;

  const ok = await showConfirmCard({
    title: '開啟推送通知',
      body: '建議開啟。請保持 App 開住（可以收埋去背景，唔好完全關掉），先至收到通知。',
    confirmLabel: '開啟',
    cancelLabel: '稍後'
  });
  if (!ok) return;
  await requestEnablePush({ toast: true });
}

async function setupPushAfterLogin() {
  renderPushStatus();
  if (!data.isNotificationApiSupported()) return;
  if (hasPushOptOut()) {
    pushEnabledLocally = false;
    renderPushStatus();
    return;
  }
  if (data.getNotificationPermission() === 'granted') {
    pushEnabledLocally = true;
  }
  renderPushStatus();
}

async function handleEnablePush() {
  if (!DOM.profilePushEnable) return;
  await runProgressButton(DOM.profilePushEnable, (async () => {
    try {
      await requestEnablePush({ toast: true });
    } catch (err) {
      showToast(data.describeFirestoreError(err), 'error');
      renderPushStatus();
    }
  })());
}

async function handleDisablePush() {
  if (!DOM.profilePushDisable) return;
  await runProgressButton(DOM.profilePushDisable, (async () => {
    try {
      await data.disablePushNotifications(state.participantId);
      pushEnabledLocally = false;
      setPushOptOut(true);
      if (pushForegroundUnsub) {
        try { pushForegroundUnsub(); } catch (_) { /* ignore */ }
        pushForegroundUnsub = null;
      }
      showToast('已關閉推送通知', 'info');
    } catch (err) {
      showToast(data.describeFirestoreError(err), 'error');
    } finally {
      renderPushStatus();
    }
  })());
}

async function handleTestPush() {
  if (data.getNotificationPermission() !== 'granted') {
    await requestEnablePush({ toast: true });
  }
  if (data.getNotificationPermission() !== 'granted') return;
  setPushOptOut(false);
  pushEnabledLocally = true;
  renderPushStatus();
  showLocalPushNotification(
    '測試通知',
    '如果你見到呢條，通知已經得。',
    'tnit-test-local',
    { toast: true }
  );
}

async function loadAdminPushConfig() {
  if (!DOM.adminVapidKey) return;
  try {
    const key = await data.fetchPushVapidKey();
    if (document.activeElement !== DOM.adminVapidKey) {
      DOM.adminVapidKey.value = key || '';
    }
  } catch (_) { /* ignore */ }
}

async function handleAdminSaveVapid() {
  if (!DOM.adminSaveVapid || !DOM.adminVapidKey) return;
  const key = String(DOM.adminVapidKey.value || '').trim();
  if (!key) {
    showToast('請貼上 VAPID 金鑰', 'error');
    return;
  }
  await runProgressButton(DOM.adminSaveVapid, (async () => {
    try {
      await data.setPushVapidKey(key);
      showToast('推送金鑰已儲存', 'success');
    } catch (err) {
      showToast(err.message || data.describeFirestoreError(err), 'error');
    }
  })());
}

function applyLaunchDeepLink() {
  const hash = String(location.hash || '').replace(/^#/, '').toLowerCase();
  if (!hash) return;
  if (hash === 'inbox') switchParticipantView('inbox');
  else if (hash === 'trophy' || hash === 'trophy-results') switchParticipantView('trophy');
  else if (hash === 'profile') switchParticipantView('profile');
  else if (hash === 'send') switchParticipantView('send');
}

function maybeShowPageOnboarding({ force = false } = {}) {
  const ctx = getCurrentOnboardingContext();
  if (!ctx) return;

  if (isOnboardingOpen()) {
    if (onboardingState.role === ctx.role && onboardingState.page === ctx.page) {
      if (!force) return;
      hideOnboarding();
    } else {
      // Left mid-tour for another page — don't mark the unfinished page as seen.
      hideOnboarding();
    }
  }

  // Wait a frame so the newly shown view/panel has layout for spotlight math.
  requestAnimationFrame(() => {
    const latest = getCurrentOnboardingContext();
    if (!latest || latest.role !== ctx.role || latest.page !== ctx.page) return;
    showOnboardingForPage(latest.role, latest.page, { force });
  });
}

function handlePageHelpClick() {
  maybeShowPageOnboarding({ force: true });
}

function handleOnboardingNext() {
  const steps = onboardingState.steps || [];
  if (onboardingState.step >= steps.length - 1) {
    finishOnboarding();
    return;
  }
  onboardingState.skipDirection = 1;
  onboardingState.step += 1;
  renderOnboardingStep();
}

function handleOnboardingPrev() {
  if (onboardingState.step <= 0) return;
  onboardingState.skipDirection = -1;
  onboardingState.step -= 1;
  renderOnboardingStep();
}

function maybeShowPublishedModal(isNewPublish) {
  if (!isNewPublish) return;
  if (isStaffPerson(state.participantId)) return;
  if (state.trophy.votingStatus !== 'PUBLISHED') return;
  if (state.trophy.resultsModalRevision === state.trophy.trophyRevision) return;
  showTrophyResultsModal(state.trophy.myAwards);
  updateTrophyTabBadge(true);
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
    title: '投票通道尚未開啟',
    body: '管理員開放投票後，你可以為隊友配對獎項'
  },
  VOTING_CLOSED: {
    title: '投票已關閉，請等候管理員開啟',
    body: '投票開放後，你可以為隊友配對獎項'
  },
  CALCULATED: {
    title: '投票計算中',
    body: '結果計算中，請稍候管理員公布'
  }
};

function notifyVotingStatusChange(status) {
  if (isStaffPerson(state.participantId)) return;
  const messages = {
    VOTING_OPEN: '投票已開放，可以開始配對獎項',
    VOTING_CLOSED: '投票已關閉',
    CALCULATED: '結果已計算，即將公布',
    PUBLISHED: '獎項結果已公布！',
    DRAFT: '投票已重設為尚未開始'
  };
  const text = messages[status];
  if (!text) return;
  showToast(text, status);
  if (status === 'PUBLISHED' || status === 'VOTING_CLOSED') {
    updateTrophyTabBadge(status === 'PUBLISHED');
  }
}

function updateTrophyStatusBanner() {
  const status = state.trophy.votingStatus;
  const label = VOTING_STATUS_LABELS[status] || status;
  const isPublished = status === 'PUBLISHED';
  const submitted = state.trophy.submissionStatus === 'submitted';
  // Open ballot while voting is open; after submit, "查看我的配對" can force a
  // readonly review even if voting later closes.
  const showSubmittedReview = submitted && !!state.trophy.reviewSubmitted && !isPublished;
  const showVoting = status === 'VOTING_OPEN' || showSubmittedReview;
  const idle = TROPHY_IDLE_COPY[status];
  const showIdle = !showVoting && !isPublished;

  if (DOM.trophyNotOpen) {
    DOM.trophyNotOpen.classList.toggle('hidden', !showIdle);
    if (showIdle) {
      const copy = idle || TROPHY_IDLE_COPY.DRAFT;
      const title = DOM.trophyNotOpen.querySelector('h3');
      const body = DOM.trophyNotOpen.querySelector('p');
      if (title) title.textContent = copy.title;
      if (body) body.textContent = copy.body;
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
  if (DOM.trophySubmittedBanner) {
    const showSubmitted = submitted && showVoting;
    DOM.trophySubmittedBanner.classList.toggle('hidden', !showSubmitted);
  }

  if (DOM.trophyStatusBanner) {
    DOM.trophyStatusBanner.textContent = label;
    DOM.trophyStatusBanner.className = 'status-banner';
    if (status === 'VOTING_OPEN') DOM.trophyStatusBanner.classList.add('status-banner-success');
    else if (status === 'VOTING_CLOSED' || status === 'CALCULATED') DOM.trophyStatusBanner.classList.add('status-banner-warning');
    else if (status === 'PUBLISHED') DOM.trophyStatusBanner.classList.add('status-banner-success');
    // Idle empty-state pages stay clean — no status strip above the message.
    // Submitted review also hides the strip so the green submitted banner leads.
    DOM.trophyStatusBanner.classList.toggle('hidden', showIdle || isPublished || (submitted && showVoting));
  }

  if (DOM.trophyGuideBar) {
    const showGuide = status === 'VOTING_OPEN';
    DOM.trophyGuideBar.classList.toggle('hidden', !showGuide);
    if (!showGuide && DOM.trophyGuideModal && !DOM.trophyGuideModal.classList.contains('hidden')) {
      closeTrophyGuideModal();
    }
  }
}

function openSubmittedBallotReview() {
  if (state.trophy.submissionStatus !== 'submitted') {
    showToast('尚未提交投票', 'info');
    return;
  }
  state.trophy.reviewSubmitted = true;
  switchParticipantView('trophy');
  updateTrophyStatusBanner();
  renderTrophyTeammates();
}

const trophyDeckState = {
  index: 0,
  items: [],
  dragX: 0,
  startX: 0,
  dragging: false
};

function getTrophyGuideItems() {
  const live = filterValidTrophies(state.trophy.trophies);
  if (live.length) {
    return live.map(t => {
      const meta = getTrophyMeta(t.trophy_id, t.trophy_name);
      return {
        trophy_id: meta.id || t.trophy_id,
        trophy_name: t.trophy_name || meta.id,
        en: meta.en,
        color: meta.color,
        colorLabel: meta.colorLabel,
        description: resolveTrophyDescription(t)
      };
    });
  }
  return Object.keys(TROPHY_META).sort().map(id => {
    const meta = TROPHY_META[id];
    const nameMap = {
      T01: '氣球人', T02: '破冰人', T03: '和事佬', T04: '真好人',
      T05: '組爸媽繼承人', T06: '關鍵人物', T07: '潛行者', T08: '頭頭是道'
    };
    return {
      trophy_id: id,
      trophy_name: nameMap[id] || id,
      en: meta.en,
      color: meta.color,
      colorLabel: meta.colorLabel,
      description: meta.description
    };
  });
}

function renderTrophyDeckCard() {
  if (!DOM.trophyDeckStack) return;
  const items = trophyDeckState.items;
  if (!items.length) {
    DOM.trophyDeckStack.innerHTML = '<p class="form-hint">暫無獎項資料</p>';
    if (DOM.trophyDeckIndex) DOM.trophyDeckIndex.textContent = '0 / 0';
    return;
  }
  const idx = ((trophyDeckState.index % items.length) + items.length) % items.length;
  trophyDeckState.index = idx;
  const item = items[idx];
  const next = items[(idx + 1) % items.length];
  const img = trophyGuideImageSrc(item.trophy_id);
  DOM.trophyDeckStack.innerHTML = `
    ${items.length > 1 ? `<div class="trophy-deck-card is-back" aria-hidden="true" style="--trophy-accent:${escapeHtml(next.color)}">
      <div class="trophy-deck-art"><img src="${escapeHtml(trophyGuideImageSrc(next.trophy_id))}" alt="" onerror="this.src='assets/trophy.png'"></div>
    </div>` : ''}
    <div class="trophy-deck-card is-front" id="trophy-deck-front" style="--trophy-accent:${escapeHtml(item.color)}" data-trophy-id="${escapeHtml(item.trophy_id)}">
      <div class="trophy-deck-art">
        <img src="${escapeHtml(img)}" alt="${escapeHtml(item.trophy_name)}" onerror="this.src='assets/trophy.png'">
      </div>
      <div class="trophy-deck-copy">
        <h3 class="trophy-deck-name">${escapeHtml(item.trophy_name)}</h3>
        ${item.en ? `<p class="trophy-deck-en">${escapeHtml(item.en)}</p>` : ''}
        <p class="trophy-deck-desc">${escapeHtml(item.description || '')}</p>
      </div>
    </div>
  `;
  if (DOM.trophyDeckIndex) {
    DOM.trophyDeckIndex.textContent = `${idx + 1} / ${items.length}`;
  }
  bindTrophyDeckFrontGestures();
}

function stepTrophyDeck(delta) {
  if (!trophyDeckState.items.length) return;
  trophyDeckState.index += delta;
  renderTrophyDeckCard();
}

function bindTrophyDeckFrontGestures() {
  const card = document.getElementById('trophy-deck-front');
  if (!card || card.dataset.bound === '1') return;
  card.dataset.bound = '1';

  const reset = () => {
    trophyDeckState.dragging = false;
    trophyDeckState.dragX = 0;
    card.style.transition = 'transform 0.25s ease, opacity 0.25s ease';
    card.style.transform = '';
    card.style.opacity = '';
  };

  const onPointerDown = (e) => {
    trophyDeckState.dragging = true;
    trophyDeckState.startX = e.clientX ?? (e.touches && e.touches[0]?.clientX) ?? 0;
    trophyDeckState.dragX = 0;
    card.style.transition = 'none';
    card.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!trophyDeckState.dragging) return;
    const x = e.clientX ?? (e.touches && e.touches[0]?.clientX) ?? trophyDeckState.startX;
    trophyDeckState.dragX = x - trophyDeckState.startX;
    const rot = trophyDeckState.dragX / 18;
    card.style.transform = `translateX(${trophyDeckState.dragX}px) rotate(${rot}deg)`;
    card.style.opacity = String(Math.max(0.45, 1 - Math.abs(trophyDeckState.dragX) / 280));
  };
  const onPointerUp = () => {
    if (!trophyDeckState.dragging) return;
    const dx = trophyDeckState.dragX;
    if (Math.abs(dx) > 80) {
      const dir = dx > 0 ? 1 : -1;
      card.style.transition = 'transform 0.22s ease, opacity 0.22s ease';
      card.style.transform = `translateX(${dir * 420}px) rotate(${dir * 18}deg)`;
      card.style.opacity = '0';
      setTimeout(() => {
        stepTrophyDeck(dir);
      }, 180);
      trophyDeckState.dragging = false;
      return;
    }
    reset();
  };

  card.addEventListener('pointerdown', onPointerDown);
  card.addEventListener('pointermove', onPointerMove);
  card.addEventListener('pointerup', onPointerUp);
  card.addEventListener('pointercancel', reset);
}

function openTrophyGuideModal() {
  if (!DOM.trophyGuideModal) return;
  trophyDeckState.items = getTrophyGuideItems();
  trophyDeckState.index = 0;
  renderTrophyDeckCard();
  DOM.trophyGuideModal.classList.remove('hidden');
  syncBodyModalOpen();
}

function closeTrophyGuideModal() {
  if (!DOM.trophyGuideModal) return;
  DOM.trophyGuideModal.classList.add('hidden');
  syncBodyModalOpen();
}

/** Poker card: 2.5" × 3.5" — render at 450 DPI for print-ready PDF pages. */
const POKER_CARD_MM = { w: 63.5, h: 88.9 };
const POKER_CARD_PX = { w: 1125, h: 1575 };

function loadExternalScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === '1') return resolve();
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('腳本載入失敗')), { once: true });
      return;
    }
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.dataset.src = src;
    el.addEventListener('load', () => {
      el.dataset.loaded = '1';
      resolve();
    }, { once: true });
    el.addEventListener('error', () => reject(new Error('無法載入 PDF 元件')), { once: true });
    document.head.appendChild(el);
  });
}

async function ensureJsPdf() {
  if (window.jspdf?.jsPDF) return window.jspdf.jsPDF;
  await loadExternalScript('https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js');
  if (!window.jspdf?.jsPDF) throw new Error('PDF 元件未就緒');
  return window.jspdf.jsPDF;
}

function loadTrophyArtImage(src) {
  return new Promise(resolve => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => {
      const fb = new Image();
      fb.onload = () => resolve(fb);
      fb.onerror = () => resolve(null);
      fb.src = 'assets/trophy.png';
    };
    img.src = src;
  });
}

function roundRectPath(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function wrapCanvasText(ctx, text, maxWidth, maxLines) {
  const chars = [...String(text || '').trim()];
  if (!chars.length) return [];
  const lines = [];
  let line = '';
  for (const ch of chars) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = ch;
      if (lines.length >= maxLines) break;
    } else {
      line = test;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (chars.join('').length && lines.length >= maxLines) {
    const joined = lines.join('');
    const remaining = chars.join('').slice(joined.length);
    if (remaining) {
      let last = lines[maxLines - 1];
      while (last.length && ctx.measureText(last + '…').width > maxWidth) {
        last = last.slice(0, -1);
      }
      lines[maxLines - 1] = last + '…';
    }
  }
  return lines.slice(0, maxLines);
}

function mixHex(hex, whitePct) {
  const raw = String(hex || '#C4A574').replace('#', '');
  if (raw.length !== 6) return '#FFF8EF';
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  const t = Math.max(0, Math.min(1, whitePct));
  const mix = (c) => Math.round(c + (255 - c) * t);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

async function renderPokerCardCanvas(item) {
  const { w, h } = POKER_CARD_PX;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const accent = item.color || '#C4A574';
  const pad = Math.round(w * 0.07);
  const radius = Math.round(w * 0.08);

  try {
    await document.fonts.load('700 72px "Canva Handwriting Style TC"');
    await document.fonts.ready;
  } catch (_) { /* fallback fonts ok */ }

  const fontFamily = '"Canva Handwriting Style TC", "PingFang TC", "Microsoft JhengHei", sans-serif';

  // Card face
  roundRectPath(ctx, 0, 0, w, h, radius);
  ctx.save();
  ctx.clip();
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#FFFAF3');
  bg.addColorStop(0.55, '#FFFFFF');
  bg.addColorStop(1, mixHex(accent, 0.92));
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Accent wash behind art
  const artBottom = Math.round(h * 0.58);
  const wash = ctx.createRadialGradient(w / 2, artBottom * 0.38, 20, w / 2, artBottom * 0.35, w * 0.55);
  wash.addColorStop(0, mixHex(accent, 0.55));
  wash.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, w, artBottom);

  // Art
  const art = await loadTrophyArtImage(trophyGuideImageSrc(item.trophy_id));
  if (art) {
    const maxArtW = w * 0.72;
    const maxArtH = artBottom - pad * 1.4;
    const scale = Math.min(maxArtW / art.width, maxArtH / art.height);
    const aw = art.width * scale;
    const ah = art.height * scale;
    const ax = (w - aw) / 2;
    const ay = pad * 0.85 + (maxArtH - ah) / 2;
    ctx.shadowColor = 'rgba(0,0,0,0.16)';
    ctx.shadowBlur = 28;
    ctx.shadowOffsetY = 12;
    ctx.drawImage(art, ax, ay, aw, ah);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  }

  // Copy block
  let y = artBottom + Math.round(h * 0.02);
  ctx.fillStyle = mixHex(accent, 0.25);
  ctx.font = `700 ${Math.round(w * 0.042)}px ${fontFamily}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  if (item.colorLabel) {
    ctx.fillText(String(item.colorLabel), pad, y);
    y += Math.round(h * 0.035);
  }

  ctx.fillStyle = '#2A2118';
  ctx.font = `700 ${Math.round(w * 0.095)}px ${fontFamily}`;
  const nameLines = wrapCanvasText(ctx, item.trophy_name || item.trophy_id, w - pad * 2, 2);
  nameLines.forEach((ln, i) => {
    ctx.fillText(ln, pad, y + i * Math.round(h * 0.07));
  });
  y += nameLines.length * Math.round(h * 0.07) + Math.round(h * 0.012);

  if (item.en) {
    ctx.fillStyle = '#8A7A68';
    ctx.font = `600 ${Math.round(w * 0.042)}px ${fontFamily}`;
    const enLines = wrapCanvasText(ctx, item.en, w - pad * 2, 2);
    enLines.forEach((ln, i) => {
      ctx.fillText(ln, pad, y + i * Math.round(h * 0.038));
    });
    y += enLines.length * Math.round(h * 0.038) + Math.round(h * 0.018);
  }

  ctx.fillStyle = '#4A3F34';
  ctx.font = `600 ${Math.round(w * 0.048)}px ${fontFamily}`;
  const descLines = wrapCanvasText(ctx, item.description || '', w - pad * 2, 5);
  descLines.forEach((ln, i) => {
    ctx.fillText(ln, pad, y + i * Math.round(h * 0.042));
  });

  // Corner id
  ctx.fillStyle = 'rgba(42, 33, 24, 0.35)';
  ctx.font = `700 ${Math.round(w * 0.036)}px ${fontFamily}`;
  ctx.textAlign = 'right';
  ctx.fillText(String(item.trophy_id || ''), w - pad, pad * 0.55);

  ctx.restore();

  // Outer card stroke
  roundRectPath(ctx, 1.5, 1.5, w - 3, h - 3, radius);
  ctx.strokeStyle = 'rgba(0,0,0,0.14)';
  ctx.lineWidth = 3;
  ctx.stroke();
  roundRectPath(ctx, 10, 10, w - 20, h - 20, Math.max(8, radius - 8));
  ctx.strokeStyle = mixHex(accent, 0.45);
  ctx.lineWidth = 2.5;
  ctx.stroke();

  return canvas;
}

async function exportTrophyGuidePokerPdf() {
  const items = trophyDeckState.items.length
    ? trophyDeckState.items
    : getTrophyGuideItems();
  if (!items.length) {
    showToast('暫無獎項可匯出', 'info');
    return;
  }

  const JsPDF = await ensureJsPdf();
  const pdf = new JsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [POKER_CARD_MM.w, POKER_CARD_MM.h],
    compress: true
  });

  for (let i = 0; i < items.length; i++) {
    if (i > 0) pdf.addPage([POKER_CARD_MM.w, POKER_CARD_MM.h], 'portrait');
    const canvas = await renderPokerCardCanvas(items[i]);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.94);
    pdf.addImage(dataUrl, 'JPEG', 0, 0, POKER_CARD_MM.w, POKER_CARD_MM.h, undefined, 'FAST');
  }

  const stamp = new Date().toISOString().slice(0, 10);
  pdf.save(`TNIT-獎項摘要撲克卡-${stamp}.pdf`);
}

async function handleTrophyDeckExportPdf() {
  if (!DOM.trophyDeckExportPdf) return;
  await runProgressButton(DOM.trophyDeckExportPdf, (async () => {
    try {
      showToast('正在產生高清撲克卡 PDF…', 'info');
      await exportTrophyGuidePokerPdf();
      showToast('PDF 已下載', 'success');
    } catch (err) {
      showToast(err?.message || '匯出失敗', 'error');
    }
  })());
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
        '「' + trophyNameById(trophyId) + '」已配對畀 ' + displayLabelOf(holder) + '，請先取消再改',
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
        ? ('已配對畀 ' + displayLabelOf(holder))
        : escapeHtml(trophy.trophy_name);
      return `<button type="button" class="${classes}"
        data-teammate="${escapeHtml(tid)}" data-trophy="${escapeHtml(trophy.trophy_id)}"
        title="${title}"
        ${disabled ? 'disabled' : ''}>${escapeHtml(trophy.trophy_name)}</button>`;
    }).join('');

    const label = displayLabelOf(teammate);
    const initials = displayNameOf(teammate).slice(0, 2);
    const nameLabel = label === tid && tid.length <= 2
      ? ''
      : escapeHtml(label);
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

async function handleTrophyClearAll() {
  if (isStaffPerson(state.participantId)) {
    showToast('Staff 不參與投票', 'info');
    return;
  }
  if (!state.trophy.editable) {
    showToast('而家唔可以改投票', 'info');
    return;
  }
  const hasLocal = Object.values(state.trophy.assignments || {}).some(ids => (ids || []).length > 0);
  const hasSubmitted = state.trophy.submissionStatus === 'submitted';
  if (!hasLocal && !hasSubmitted) {
    showToast('未有投票可以清除', 'info');
    return;
  }
  if (!(await showConfirmCard({
    title: '清除投票',
    body: '確定要清除全部投票嗎？',
    confirmLabel: '清除',
    danger: true
  }))) return;

  await runProgressButton(DOM.trophyClearAll, (async () => {
    try {
      await data.clearMySubmission(state.participantId);
      state.trophy.assignments = {};
      state.trophy.submissionStatus = '';
      recalcTrophyPermissions();
      recalcTrophyProgress();
      renderTrophyTeammates();
      updateTrophyStatusBanner();
      renderProfile();
      showToast('已清除全部投票', 'success');
    } catch (err) {
      if (String(err && err.code || '').includes('not-found') || /not.?found/i.test(String(err && err.message || ''))) {
        state.trophy.assignments = {};
        state.trophy.submissionStatus = '';
        recalcTrophyPermissions();
        recalcTrophyProgress();
        renderTrophyTeammates();
        updateTrophyStatusBanner();
        renderProfile();
        showToast('已清除全部投票', 'success');
        return;
      }
      showToast('清除失敗：' + data.describeFirestoreError(err, '請再試一次'), 'error');
    }
  })());
}

async function handleTrophySubmitAll() {
  if (isStaffPerson(state.participantId)) {
    showToast('Staff 不參與投票', 'info');
    return;
  }
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

  if (!(await showConfirmCard({
    title: '提交投票',
    body: '確定要提交投票嗎？提交後不可再修改。',
    confirmLabel: '提交'
  }))) return;

  const pairings = buildPairingsFromAssignments(state.trophy.assignments);
  await runProgressButton(DOM.trophySubmitAll, (async () => {
    try {
      await data.saveSubmission(state.participantId, pairings, true, {
        allowResubmit: !!effectiveVotingConfigForMe().allow_resubmit
      });
      state.trophy.submissionStatus = 'submitted';
      recalcTrophyPermissions();
      switchParticipantView('trophy-submitted');
      showToast('投票已提交', 'success');
    } catch (err) {
      if (err && err.code === 'already-submitted') {
        showToast('你已經投過票，不能重複提交', 'error');
        state.trophy.submissionStatus = 'submitted';
        recalcTrophyPermissions();
        updateTrophyStatusBanner();
        renderTrophyTeammates();
        return;
      }
      showToast('投票提交失敗：' + data.describeFirestoreError(err, '請再試一次'), 'error');
      switchParticipantView('trophy');
    }
  })());
}

// ─── 獎項 (Admin) ───────────────────────────────────────────────────────────


function renderAdminTrophyStats() {
  const stats = state.adminTrophy.overview?.stats || {};
  const votingStatus = state.adminTrophy.overview?.voting_status || 'DRAFT';
  const statusTone = votingStatusToneClass(votingStatus);
  DOM.adminTrophyStats.innerHTML = `
    <div class="stat-card"><div class="stat-value">${stats.completed_voters || 0}/${stats.total_participants || 0}</div><div class="stat-label">已完成投票</div></div>
    <div class="stat-card"><div class="stat-value">${stats.total_votes || 0}</div><div class="stat-label">總投票數</div></div>
    <div class="stat-card"><div class="stat-value">${stats.trophy_count || 0}</div><div class="stat-label">獎項種類</div></div>
    <div class="stat-card voting-status-card ${statusTone}"><div class="stat-value">${VOTING_STATUS_LABELS[votingStatus] || votingStatus}</div><div class="stat-label">投票狀態</div></div>
  `;
}

/**
 * Shared group cards used by voting progress and login status on the dashboard.
 * doneKey marks members who are "complete" (voted / logged in).
 * Cards always show member lists expanded.
 * When voteMatrix is true (voting panel), heading / member taps open a popup
 * matrix card instead of embedding the table in the group card.
 */
function loginStatusLegendHtml() {
  return `
    <div class="status-legend" role="note" aria-label="登入狀態圖例">
      <span class="status-legend-item"><span class="voter-switch is-on" aria-hidden="true"></span></span>
      <span class="status-legend-item"><span class="voter-switch" aria-hidden="true"></span></span>
    </div>
  `;
}

function renderGroupStatusCards(options) {
  const {
    container,
    title,
    groups,
    doneKey,
    doneLabel,
    pendingLabel,
    doneStatusText = '',
    pendingStatusText = '',
    emptyAllDone,
    emptyPendingTitle,
    voteMatrix = false,
    titleActionHtml = '',
    statusLegendHtml = '',
    onMemberClick = null,
    canMemberClick = null,
    afterRender = null
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
      const memberClickable = voteMatrix || (!!onMemberClick && m[doneKey] && (!canMemberClick || canMemberClick(m)));
      const statusText = m[doneKey]
        ? (doneStatusText || doneLabel)
        : (pendingStatusText || pendingLabel);
      const statusAttr = escapeHtml(String(statusText).replace(/<[^>]*>/g, ''));
      const statusMark = voteMatrix
        ? `<span class="voter-check ${m[doneKey] ? 'app-icon app-icon-check' : 'voter-check-empty'}" aria-hidden="true">${m[doneKey] ? '' : '○'}</span>`
        : `<span class="voter-switch ${m[doneKey] ? 'is-on' : ''}" aria-hidden="true"></span>`;
      const labelHtml = (m[doneKey] ? doneLabel : pendingLabel)
        ? `<span class="voter-status-label" title="${statusAttr}" aria-label="${statusAttr}">${m[doneKey] ? doneLabel : pendingLabel}</span>`
        : '';
      const inner = `
        ${statusMark}
        <span class="voter-id">${escapeHtml(displayLabelOf(m.participant_id))}</span>
        ${labelHtml}
      `;
      if (!memberClickable) {
        return `<div class="${classes}"${statusAttr ? ` aria-label="${statusAttr}"` : ''}>${inner}</div>`;
      }
      const titleText = voteMatrix ? '睇獨立選票' : (statusAttr || '管理登入');
      return `<button type="button" class="${classes}" data-member-id="${escapeHtml(m.participant_id)}" title="${titleText}" aria-label="${escapeHtml(displayLabelOf(m.participant_id))}${statusAttr ? '，' + statusAttr : ''}">${inner}</button>`;
    }).join('');

    const headerHtml = voteMatrix
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
        ${headerHtml}
        <div class="group-voter-body">
          <div class="group-voter-members">${membersHtml}</div>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div class="admin-pending-title-row">
      <h4 class="admin-pending-title">${title}${pending.length > 0 ? ` · 尚餘 ${pending.length} 人` : ''}</h4>
      ${titleActionHtml}
    </div>
    ${statusLegendHtml}
    <div class="group-voter-grid">${cards}</div>
  `;

  if (voteMatrix || onMemberClick) {
    container.querySelectorAll('.group-voter-header').forEach(btn => {
      if (!voteMatrix) return;
      btn.addEventListener('click', () => {
        const card = btn.closest('.group-voter-card');
        const groupLabel = card?.dataset.group;
        if (!groupLabel) return;
        openVoteMatrixModal(groupLabel, null);
      });
    });

    container.querySelectorAll('.voter-member[data-member-id]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (voteMatrix) {
          const card = btn.closest('.group-voter-card');
          const groupLabel = card?.dataset.group;
          if (!groupLabel) return;
          openVoteMatrixModal(groupLabel, btn.dataset.memberId);
          return;
        }
        if (onMemberClick) onMemberClick(btn.dataset.memberId, btn);
      });
    });
  }
  if (afterRender) afterRender(container);
}

function trophyStore() {
  return state.isAdmin ? state.adminTrophy : state.staffTrophy;
}

function findAdminVotingGroup(groupLabel) {
  const groups = trophyStore().overview?.group_voting_status || [];
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
  syncBodyModalOpen();
  if (DOM.adminPendingVoters) {
    DOM.adminPendingVoters.querySelectorAll('.voter-member.is-focus').forEach(btn => {
      btn.classList.remove('is-focus');
    });
  }
}

function openForceLogoutModal(participantId) {
  const pid = normalizeId(participantId);
  if (!pid || !DOM.forceLogoutModal) return;
  state.adminForceLogoutTarget = pid;
  if (DOM.forceLogoutBody) {
    DOM.forceLogoutBody.textContent = `確定要強制登出 ${pid} 嗎？`;
  }
  DOM.forceLogoutModal.classList.remove('hidden');
  syncBodyModalOpen();
  DOM.forceLogoutConfirm?.focus();
}

function closeForceLogoutModal() {
  state.adminForceLogoutTarget = null;
  if (DOM.forceLogoutModal) {
    DOM.forceLogoutModal.classList.add('hidden');
  }
  syncBodyModalOpen();
}

function openForceLogoutAllModal() {
  if (!DOM.forceLogoutAllModal) return;
  DOM.forceLogoutAllModal.classList.remove('hidden');
  syncBodyModalOpen();
}

function closeForceLogoutAllModal() {
  if (DOM.forceLogoutAllModal) {
    DOM.forceLogoutAllModal.classList.add('hidden');
  }
  syncBodyModalOpen();
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
  syncBodyModalOpen();
}

/** How many submitted nominations each member received per trophy. */
function buildNominationCountMap(memberIds) {
  const members = new Set(memberIds);
  const counts = new Map();
  trophyStore().submissions.forEach(submission => {
    if (submission.status !== 'submitted') return;
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
  trophyStore().submissions.forEach(submission => {
    if (submission.status !== 'submitted') return;
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
    (trophyStore().profiles || []).map(p => [p.participant_id, p])
  );

  const rows = memberIds.map(id => {
    const awards = (profilesById.get(id)?.trophies || []).filter(a => (a.vote_count || 0) > 0);
    const trophiesHtml = awards.length
      ? awards.map(a => {
          const votes = a.vote_count || 0;
          return `<span class="vote-matrix-winner-trophy">${trophyIconHtml(a.trophy_id, a.trophy_name, 'trophy-icon trophy-icon-xs')}${escapeHtml(a.trophy_name)}（${votes}票）</span>`;
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
  const trophies = trophyStore().trophies || [];
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

/** Current session: recent heartbeat and not explicitly marked offline. */
function isPresenceCurrentlyLoggedIn(presence) {
  if (!presence || presence.online === false) return false;
  // During the first moment after a write, `last_seen` can still be
  // unresolved in some browser caches. Fall back to `first_seen` so
  // 「已登入」shows quickly after a fresh login.
  const seenAtRaw = presence.last_seen || presence.first_seen || '';
  if (!seenAtRaw) return false;
  const seenAt = new Date(seenAtRaw).getTime();
  if (!Number.isFinite(seenAt)) return false;
  return seenAt >= Date.now() - CONFIG.PRESENCE_ONLINE_MS;
}

function buildLoginStatusGroups() {
  const presenceById = new Map(
    state.presence.map(p => [p.participant_id, p])
  );

  const byGroup = new Map();
  state.participants.forEach(p => {
    const group = data.normalizeGroupId(p.group_id);
    if (!byGroup.has(group)) byGroup.set(group, []);
    const presence = presenceById.get(p.participant_id);
    const loggedIn = isPresenceCurrentlyLoggedIn(presence);
    byGroup.get(group).push({
      participant_id: p.participant_id,
      logged_in: loggedIn,
      online: loggedIn,
      force_logout_rev: Number(p.force_logout_rev || 0) || 0
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

function removeLocalPresence(participantIds) {
  const remove = new Set(
    (participantIds || []).map(id => normalizeId(id)).filter(Boolean)
  );
  if (!remove.size) return;
  state.presence = state.presence.filter(p => !remove.has(normalizeId(p.participant_id)));
  renderAdminLoginStatus();
  renderAdminLiveLoad();
  renderStaffLoginStatus();
  renderStaffLiveLoad();
}

function maybeHandleForcedLogout(rows) {
  if (state.isAdmin || !state.participantId) return;
  const me = (rows || []).find(p => p.participant_id === state.participantId);
  if (!me) return;
  const rev = Number(me.force_logout_rev || 0) || 0;
  if (!rev) return;
  const sessionStartedAt = Number(state.sessionStartedAt || 0) || 0;
  if (rev <= sessionStartedAt || rev === state.handledForceLogoutRev) return;
  state.handledForceLogoutRev = rev;
  stopPresenceHeartbeat();
  setTimeout(() => handleLogout(), 50);
}

function renderAdminLoginStatus() {
  renderGroupStatusCards({
    container: DOM.adminLoginStatus,
    title: '登入狀況（按組別）',
    groups: buildLoginStatusGroups(),
    doneKey: 'logged_in',
    doneLabel: '',
    pendingLabel: '',
    doneStatusText: '已登入',
    pendingStatusText: '未登入',
    emptyAllDone: '所有參加者均已登入',
    emptyPendingTitle: '尚未登入',
    statusLegendHtml: loginStatusLegendHtml(),
    titleActionHtml: `
      <div class="admin-login-actions">
        <button type="button" id="admin-refresh-login-status" class="btn btn-secondary btn-sm btn-progress">
          <span class="btn-label">手動刷新</span>
          <span class="btn-progress-bar" aria-hidden="true"></span>
        </button>
        <button type="button" id="admin-force-logout-all" class="btn btn-danger btn-sm">全部強制登出</button>
      </div>
    `,
    onMemberClick: participantId => openForceLogoutModal(participantId),
    canMemberClick: member => isSeatParticipantId(member.participant_id),
    afterRender: container => {
      const refreshBtn = container.querySelector('#admin-refresh-login-status');
      if (refreshBtn) {
        refreshBtn.addEventListener('click', () => handleAdminRefreshLoginStatus(refreshBtn));
      }
      const allBtn = container.querySelector('#admin-force-logout-all');
      if (allBtn) {
        allBtn.addEventListener('click', openForceLogoutAllModal);
      }
    }
  });
}

async function handleAdminRefreshLoginStatus(btn) {
  const action = async () => {
    state.presence = await data.fetchPresence();
    renderAdminLoginStatus();
    renderAdminLiveLoad();
  };
  try {
    if (btn) {
      await runProgressButton(btn, action());
    } else {
      await action();
    }
  } catch (err) {
    showToast(data.describeFirestoreError(err), 'error');
  }
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
          <div class="audit-card-trophy">${trophyIconHtml(v.trophy_id, v.trophy_name, 'trophy-icon trophy-icon-sm')}${escapeHtml(v.trophy_name)}</div>
          ${v.submitted_at ? `<div class="audit-card-time">${formatDateTime(v.submitted_at)}</div>` : ''}
        </div>
      `).join('');
  }
}

function renderProfiles() {
  DOM.profilesList.innerHTML = state.adminTrophy.profiles.map(profile => {
    const trophies = (profile.trophies || []).map(t => {
      return `<li class="profile-trophy-item">
        ${trophyIconHtml(t.trophy_id, t.trophy_name, 'trophy-icon trophy-icon-sm')}
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

function renderTrophySummaryInto(container, items, options = {}) {
  if (!container) return;
  const { allowRename = false, idPrefix = 'summary', onRename = null } = options;
  const list = items || [];
  const openIds = new Set(
    [...container.querySelectorAll('.summary-item.open')]
      .map(el => el.dataset.trophyId)
      .filter(Boolean)
  );

  if (list.length === 0) {
    container.innerHTML = '<p class="form-hint">暫無獎項摘要</p>';
    return;
  }

  container.innerHTML = list.map((item, i) => {
    const winners = (item.winners || []);
    const winnerHtml = winners.map(w =>
      `<div class="summary-winner">${escapeHtml(displayLabelOf(w.participant_id))} · ${w.vote_count || 0} 票</div>`
    ).join('');
    const tieNote = item.is_tie ? '<div class="summary-tie">' + appIcon('warning') + ' 平票</div>' : '';
    const ranking = (item.top_ranking || []).slice(0, 3).map((r, idx) =>
      `<div>${idx + 1}. ${escapeHtml(displayLabelOf(r.participant_id))} (${r.vote_count} 票)</div>`
    ).join('');
    const isOpen = openIds.has(item.trophy_id);
    const nameFieldId = `${idPrefix}-name-${escapeHtml(item.trophy_id)}`;
    const descFieldId = `${idPrefix}-desc-${escapeHtml(item.trophy_id)}`;
    const meta = getTrophyMeta(item.trophy_id, item.trophy_name);
    const description = resolveTrophyDescription(item, item.trophy_name);
    const descHtml = (!allowRename && description)
      ? `<p class="summary-trophy-desc">${escapeHtml(description)}</p>
         ${meta.en ? `<p class="form-hint summary-trophy-meta">${escapeHtml(meta.en)}</p>` : ''}`
      : (!allowRename ? '' : (meta.en ? `<p class="form-hint summary-trophy-meta">${escapeHtml(meta.en)}</p>` : ''));
    const renameHtml = allowRename ? `
        <div class="summary-rename">
          <label class="summary-rename-label" for="${nameFieldId}">獎項名稱</label>
          <input type="text" id="${nameFieldId}"
            class="input-field summary-rename-input" maxlength="40"
            data-trophy-id="${escapeHtml(item.trophy_id)}"
            value="${escapeHtml(item.trophy_name)}"
            autocomplete="off">
          <label class="summary-rename-label" for="${descFieldId}">獎項描述</label>
          <textarea id="${descFieldId}"
            class="input-field summary-desc-input" maxlength="160" rows="3"
            data-trophy-id="${escapeHtml(item.trophy_id)}"
            placeholder="參加者喺獎項摘要會睇到呢段說明">${escapeHtml(description)}</textarea>
          <div class="summary-rename-row summary-rename-actions">
            <button type="button" class="btn btn-primary btn-sm btn-progress summary-rename-save"
              data-trophy-id="${escapeHtml(item.trophy_id)}">
              <span class="btn-label">儲存</span>
              <span class="btn-progress-bar" aria-hidden="true"></span>
            </button>
          </div>
          <p class="form-hint">編號 ${escapeHtml(item.trophy_id)}；名稱同描述只可喺 Admin 改，會即時套用到投票畫面、獎項摘要同已計算結果。</p>
        </div>` : '';

    return `<div class="summary-item${isOpen ? ' open' : ''}" data-idx="${i}" data-trophy-id="${escapeHtml(item.trophy_id)}">
      <div class="summary-item-top">
        ${trophyIconHtml(item.trophy_id, item.trophy_name, 'trophy-icon trophy-icon-md')}
        <button type="button" class="summary-item-header">
          <span>${escapeHtml(item.trophy_name)}</span>
        </button>
      </div>
      <div class="summary-item-body">
        ${descHtml}
        ${renameHtml}
        ${tieNote}
        ${winnerHtml || '<p>暫無得主</p>'}
        ${ranking ? '<div style="margin-top:8px;font-weight:600">Top 3</div>' + ranking : ''}
      </div>
    </div>`;
  }).join('');

  container.querySelectorAll('.summary-item-header').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.closest('.summary-item').classList.toggle('open');
    });
  });

  if (allowRename && onRename) {
    container.querySelectorAll('.summary-rename-save').forEach(btn => {
      btn.addEventListener('click', () => onRename(btn));
    });
    container.querySelectorAll('.summary-rename').forEach(block => {
      const fields = block.querySelectorAll('.summary-rename-input, .summary-desc-input');
      const saveBtn = block.querySelector('.summary-rename-save');
      attachTextGuardGroup(fields, { submitBtn: saveBtn });
    });
  }
}

function renderTrophySummary() {
  renderTrophySummaryInto(DOM.summaryList, state.adminTrophy.trophySummary, {
    allowRename: true,
    idPrefix: 'summary',
    onRename: handleAdminSaveTrophyMeta
  });
}

function applyLocalTrophyMeta(trophyId, { trophy_name: trophyName, description }) {
  const patch = list => {
    (list || []).forEach(t => {
      if (!t || t.trophy_id !== trophyId) return;
      if (trophyName !== undefined) t.trophy_name = trophyName;
      if (description !== undefined) t.description = description;
    });
  };
  patch(state.adminTrophy.trophies);
  patch(state.staffTrophy.trophies);
  patch(state.trophy.trophies);
  patch(state.adminTrophy.trophySummary);
  patch(state.staffTrophy.trophySummary);
  const patchResults = results => {
    (results || []).forEach(result => {
      (result.awards || []).forEach(award => {
        if (award && award.trophy_id === trophyId && trophyName !== undefined) {
          award.trophy_name = trophyName;
        }
      });
    });
  };
  patchResults(state.adminTrophy.results);
  patchResults(state.staffTrophy.results);
}

async function handleAdminSaveTrophyMeta(btn) {
  const trophyId = btn?.dataset?.trophyId;
  if (!trophyId) return;
  if (!state.isAdmin) {
    showToast('獎項內容由管理員管理', 'info');
    return;
  }
  const item = btn.closest('.summary-item');
  const nameInput = item?.querySelector(
    `.summary-rename-input[data-trophy-id="${CSS.escape(trophyId)}"]`
  );
  const descInput = item?.querySelector(
    `.summary-desc-input[data-trophy-id="${CSS.escape(trophyId)}"]`
  );
  const nextName = String(nameInput?.value || '').trim();
  const nextDesc = String(descInput?.value || '').trim();
  const current = (state.adminTrophy.trophies || state.trophy.trophies || [])
    .find(t => t.trophy_id === trophyId);
  const currentDesc = resolveTrophyDescription(current || { trophy_id: trophyId, description: '' }, nextName);
  if (!nextName) {
    showToast('獎項名稱不可空白', 'error');
    return;
  }
  if (!nextDesc) {
    showToast('獎項描述不可空白', 'error');
    return;
  }
  if (rejectIfTextBlocked(nextName) || rejectIfTextBlocked(nextDesc)) return;
  if (current && current.trophy_name === nextName && currentDesc === nextDesc) {
    showToast('沒有變更', 'info');
    return;
  }

  await runProgressButton(btn, (async () => {
    try {
      const saved = await data.updateTrophyMeta(trophyId, {
        trophyName: nextName,
        description: nextDesc
      });
      applyLocalTrophyMeta(trophyId, saved);
      refreshAdminTrophyViews();
      refreshStaffTrophyViews();
      showToast('獎項已更新', 'success');
    } catch (err) {
      showToast(err.message || data.describeFirestoreError(err), 'error');
    }
  })());
}

function updateVotingStepper() {
  const status = state.adminTrophy.overview?.voting_status || 'DRAFT';
  const steps = ['VOTING_OPEN', 'VOTING_CLOSED', 'CALCULATED', 'PUBLISHED'];
  const currentIdx = steps.indexOf(status);
  const root = document.querySelector('#admin-trophy-panel .voting-stepper');

  if (DOM.adminVotingStatusBadge) {
    DOM.adminVotingStatusBadge.textContent = VOTING_STATUS_LABELS[status] || status;
    DOM.adminVotingStatusBadge.className = 'voting-status-badge ' + votingStatusToneClass(status);
  }

  if (!root) return;

  root.querySelectorAll('.stepper-step').forEach(el => {
    const step = el.dataset.step;
    const idx = steps.indexOf(step);
    el.classList.toggle('active', step === status);
    el.classList.toggle('done', idx >= 0 && idx < currentIdx);
  });

  root.querySelectorAll('.stepper-line').forEach((line, i) => {
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
    VOTING_OPEN: {
      title: '開放投票',
      body: '確定要開放投票嗎？會覆蓋所有組別的投票覆寫，令全場跟隨全域。每人只可提交一次，提交後不能再改。'
    },
    VOTING_CLOSED: {
      title: '關閉投票',
      body: '確定要關閉投票嗎？會覆蓋所有組別的投票覆寫；參加者將無法再提交。'
    },
    PUBLISHED: {
      title: '公布結果',
      body: '確定要公布結果嗎？會覆蓋所有組別的投票覆寫，令全場跟隨全域。'
    }
  };
  const confirmCfg = confirmMessages[status];
  if (confirmCfg && !(await showConfirmCard({
    ...confirmCfg,
    confirmLabel: '確定',
    danger: status === 'VOTING_CLOSED'
  }))) return;

  await runProgressButton(btn, (async () => {
    try {
      await data.setVotingStatus(status);
      clearLocalGroupVotingOverrides();
      state.votingConfig = {
        ...state.votingConfig,
        voting_status: status,
        allow_resubmit: status === 'VOTING_OPEN' ? false : !!state.votingConfig.allow_resubmit
      };
      applyEffectiveVotingToTrophyState();
      refreshAdminTrophyViews();
      renderAdminGroupOverrides();
      showToast('全域投票已更新（已覆蓋各組覆寫）：' + (VOTING_STATUS_LABELS[status] || status), status);
    } catch (err) {
      showToast(data.describeFirestoreError(err), 'error');
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
      clearLocalGroupVotingOverrides();
      state.votingConfig = {
        ...state.votingConfig,
        voting_status: 'CALCULATED'
      };
      applyEffectiveVotingToTrophyState();
      refreshAdminTrophyViews();
      renderAdminGroupOverrides();
      showToast('結果計算完成（已覆蓋各組覆寫）', 'CALCULATED');
    } catch (err) {
      showToast(data.describeFirestoreError(err), 'error');
    }
  })());
}

// ─── Display names + Staff group facilitation ────────────────────────────────

async function handleSaveDisplayName() {
  const pid = state.participantId;
  if (!pid) return;
  const name = String(DOM.profileDisplayName?.value || '').trim();
  if (name.length > 40) {
    showToast('顯示名稱最多 40 字', 'error');
    return;
  }
  if (rejectIfTextBlocked(name)) return;
  await runProgressButton(DOM.profileSaveName, (async () => {
    try {
      await data.updateParticipantDisplayName(pid, name);
      const person = findParticipantById(pid);
      if (person) person.display_name = name;
      showToast(name ? '顯示名稱已更新' : '已清除顯示名稱', 'success');
      updateParticipantGreeting();
      renderProfile();
      refreshComboboxItems();
    } catch (err) {
      showToast(data.describeFirestoreError(err), 'error');
    }
  })());
}

async function handleSavePassword() {
  const pid = state.participantId;
  if (!pid) return;
  const newPassword = String(DOM.profilePassword?.value || '').trim();
  if (!newPassword) {
    showToast('請輸入新密碼', 'error');
    return;
  }
  await runProgressButton(DOM.profileSavePassword, (async () => {
    try {
      await data.updateMyPassword(newPassword);
      if (DOM.profilePassword) DOM.profilePassword.value = '';
      showToast('密碼已成功更新，下次登入請使用新密碼', 'success');
    } catch (err) {
      showToast(data.describeFirestoreError(err, '密碼更新失敗，請再試一次'), 'error');
    }
  })());
}

function renderStaffFacilitatorPanel() {
  const panel = DOM.staffFacilitatorPanel;
  if (!panel) return;
  const groupId = getFacilitatorGroupId();
  const show = !!groupId && !state.isAdmin;
  panel.classList.toggle('hidden', !show);
  if (DOM.homeStaffCard) DOM.homeStaffCard.classList.toggle('hidden', !show);
  applyStaffParticipantChrome();
  if (!show) return;

  const members = getFacilitatorGroupMembers(groupId);
  const meta = state.groupMeta[groupId] || {};
  const votingInfo = groupVotingOverrideInfo(groupId);
  const msgOpen = isMessagingOpenForGroup(groupId);
  if (DOM.staffGroupTitle) {
    DOM.staffGroupTitle.textContent = formatGroupLabel(groupId);
  }
  if (DOM.staffGroupNameInput && document.activeElement !== DOM.staffGroupNameInput) {
    DOM.staffGroupNameInput.value = meta.display_name || '';
  }
  if (DOM.staffGroupStatus) {
    DOM.staffGroupStatus.innerHTML = `
      <div class="status-item"><span>本組留言</span><span>${msgOpen ? appIcon('dot-green') + ' 開啟' : appIcon('dot-red') + ' 關閉'}</span></div>
      <div class="status-item"><span>本組投票</span><span>${escapeHtml(VOTING_STATUS_LABELS[votingInfo.status] || votingInfo.status)}（${escapeHtml(votingInfo.sourceLabel)}）</span></div>
      <div class="status-item"><span>組內留言</span><span>${state.staffMonitorMessages.length} 則</span></div>
    `;
  }
  if (DOM.staffDashboardStats) {
    const activeCount = state.staffMonitorMessages.filter(m => m.status === 'active').length;
    DOM.staffDashboardStats.innerHTML = `
      <div class="stat-card"><div class="stat-value">${members.length || '—'}</div><div class="stat-label">本組成員</div></div>
      <div class="stat-card"><div class="stat-value">${state.staffMonitorMessages.length}</div><div class="stat-label">留言</div></div>
      <div class="stat-card"><div class="stat-value">${activeCount}</div><div class="stat-label">有效留言</div></div>
      <div class="stat-card"><div class="stat-value">${msgOpen ? '開啟' : '關閉'}</div><div class="stat-label">留言狀態</div></div>
    `;
  }
  syncStaffVotingControls(groupId);
  renderStaffLoginStatus();
  renderStaffLiveLoad();
  renderStaffTrophyStats();
  renderStaffPendingVoters();
  renderStaffResults();
}

function syncStaffVotingControls(groupId = getFacilitatorGroupId()) {
  if (!groupId) return;
  const info = groupVotingOverrideInfo(groupId);
  if (DOM.staffVotingBadge) {
    DOM.staffVotingBadge.textContent = VOTING_STATUS_LABELS[info.status] || info.status;
    DOM.staffVotingBadge.className = 'voting-status-badge ' + votingStatusToneClass(info.status);
  }
  if (DOM.staffVotingSource) {
    DOM.staffVotingSource.textContent = info.overridden
      ? `目前為本組覆寫（全域：${VOTING_STATUS_LABELS[info.globalStatus] || info.globalStatus}）。Admin 再改全域會覆蓋本組。`
      : `目前跟隨全域（${VOTING_STATUS_LABELS[info.globalStatus] || info.globalStatus}）。撳下面掣可改為本組覆寫。`;
  }
  if (DOM.staffFollowGlobalVoting) {
    DOM.staffFollowGlobalVoting.classList.toggle('hidden', !info.overridden);
  }
  updateStaffVotingStepper(info.status);
  updateStaffVotingButtons(info.status);
}

function updateStaffVotingStepper(status) {
  const steps = ['VOTING_OPEN', 'VOTING_CLOSED', 'CALCULATED', 'PUBLISHED'];
  const idx = steps.indexOf(status);
  const root = document.getElementById('staff-voting-stepper');
  if (!root) return;
  root.querySelectorAll('.stepper-step').forEach(step => {
    const stepIdx = steps.indexOf(step.dataset.step);
    step.classList.toggle('active', stepIdx === idx);
    step.classList.toggle('done', stepIdx >= 0 && stepIdx < idx);
  });
  root.querySelectorAll('.stepper-line').forEach((line, i) => {
    line.classList.toggle('done', i < idx);
  });
}

function updateStaffVotingButtons(status) {
  const buttons = [
    { el: DOM.staffOpenVoting, active: status === 'VOTING_OPEN' },
    { el: DOM.staffCloseVoting, active: status === 'VOTING_CLOSED' },
    { el: DOM.staffCalculate, active: status === 'CALCULATED' },
    { el: DOM.staffPublish, active: status === 'PUBLISHED' }
  ];
  buttons.forEach(({ el, active }) => {
    if (!el) return;
    el.classList.toggle('btn-active-state', active);
    el.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function renderStaffTrophyStats() {
  if (!DOM.staffTrophyStats) return;
  const stats = state.staffTrophy.overview?.stats || {};
  // Always use live group/global status — overview can lag until the next refresh.
  const votingStatus = effectiveVotingConfigForGroup(getFacilitatorGroupId()).voting_status || 'DRAFT';
  const statusTone = votingStatusToneClass(votingStatus);
  DOM.staffTrophyStats.innerHTML = `
    <div class="stat-card"><div class="stat-value">${stats.completed_voters || 0}/${stats.total_participants || 0}</div><div class="stat-label">已完成投票</div></div>
    <div class="stat-card"><div class="stat-value">${stats.total_votes || 0}</div><div class="stat-label">總投票數</div></div>
    <div class="stat-card"><div class="stat-value">${stats.trophy_count || 0}</div><div class="stat-label">獎項種類</div></div>
    <div class="stat-card voting-status-card ${statusTone}"><div class="stat-value">${VOTING_STATUS_LABELS[votingStatus] || votingStatus}</div><div class="stat-label">投票狀態</div></div>
  `;
}

function renderStaffPendingVoters() {
  renderGroupStatusCards({
    container: DOM.staffPendingVoters,
    title: '投票進度（按組別）',
    groups: state.staffTrophy.overview?.group_voting_status || [],
    doneKey: 'voted',
    doneLabel: '已投',
    pendingLabel: '未投',
    emptyAllDone: '本組參加者均已完成投票',
    emptyPendingTitle: '尚未完成投票',
    voteMatrix: true
  });
  if (state.adminTrophy.matrixModal) renderVoteMatrixModal();
}

function renderStaffLoginStatus() {
  const groupId = getFacilitatorGroupId();
  const groups = buildLoginStatusGroups().filter(g => g.group_label === groupId);
  renderGroupStatusCards({
    container: DOM.staffLoginStatus,
    title: '登入狀況（按組別）',
    groups,
    doneKey: 'logged_in',
    doneLabel: '',
    pendingLabel: '',
    doneStatusText: '已登入',
    pendingStatusText: '未登入',
    emptyAllDone: '本組參加者均已登入',
    emptyPendingTitle: '尚未登入',
    statusLegendHtml: loginStatusLegendHtml(),
    titleActionHtml: `
      <div class="admin-login-actions">
        <button type="button" id="staff-refresh-login-status" class="btn btn-secondary btn-sm btn-progress">
          <span class="btn-label">手動刷新</span>
          <span class="btn-progress-bar" aria-hidden="true"></span>
        </button>
        <button type="button" id="staff-force-logout-group" class="btn btn-danger btn-sm">全部強制登出</button>
      </div>
    `,
    onMemberClick: participantId => openForceLogoutModal(participantId),
    canMemberClick: member => isSeatParticipantId(member.participant_id),
    afterRender: container => {
      const refreshBtn = container.querySelector('#staff-refresh-login-status');
      if (refreshBtn) {
        refreshBtn.addEventListener('click', () => handleStaffRefreshLoginStatus(refreshBtn));
      }
      const allBtn = container.querySelector('#staff-force-logout-group');
      if (allBtn) {
        allBtn.addEventListener('click', handleStaffForceLogoutGroup);
      }
    }
  });
}

function renderStaffLiveLoad() {
  if (!DOM.staffLiveLoad) return;
  const members = getFacilitatorGroupMembers();
  const memberIds = new Set(members.map(p => p.participant_id));
  const recentCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const recent = state.staffMonitorMessages.filter(
    m => m.status === 'active' && m.created_at > recentCutoff
  ).length;
  const voters = getVotingParticipants(members);
  const voterIds = new Set(voters.map(p => p.participant_id));
  const voted = state.staffTrophy.submissions.filter(
    s => s.status === 'submitted' && voterIds.has(s.participant_id)
  ).length;
  const online = state.presence.filter(p => memberIds.has(p.participant_id) && isPresenceCurrentlyLoggedIn(p)).length;
  DOM.staffLiveLoad.innerHTML = `
    <div class="stat-card"><div class="stat-value">${online}/${members.length || 0}</div><div class="stat-label">已登入</div></div>
    <div class="stat-card"><div class="stat-value">${online}</div><div class="stat-label">現正線上</div></div>
    <div class="stat-card"><div class="stat-value">${voted}/${voters.length || 0}</div><div class="stat-label">已完成投票</div></div>
    <div class="stat-card"><div class="stat-value">${recent}</div><div class="stat-label">近 5 分鐘留言</div></div>
  `;
}

function renderStaffResults() {
  const audit = state.staffTrophy.auditVotes || [];
  if (DOM.staffAuditCards) {
    DOM.staffAuditCards.innerHTML = audit.length === 0
      ? '<p class="form-hint">暫無投票紀錄</p>'
      : audit.map(v => `
        <div class="audit-card">
          <div class="audit-card-route">${escapeHtml(displayLabelOf(v.sender_id))} → ${escapeHtml(displayLabelOf(v.receiver_id))}</div>
          <div class="audit-card-trophy">${trophyIconHtml(v.trophy_id, v.trophy_name, 'trophy-icon trophy-icon-sm')}${escapeHtml(v.trophy_name)}</div>
          ${v.submitted_at ? `<div class="audit-card-time">${formatDateTime(v.submitted_at)}</div>` : ''}
        </div>
      `).join('');
  }
  if (DOM.staffProfilesList) {
    const profiles = state.staffTrophy.profiles || [];
    DOM.staffProfilesList.innerHTML = profiles.length === 0
      ? '<p class="form-hint">暫無個人檔案</p>'
      : profiles.map(profile => {
        const trophies = (profile.trophies || []).map(t => `
          <li class="profile-trophy-item">
            ${trophyIconHtml(t.trophy_id, t.trophy_name, 'trophy-icon trophy-icon-sm')}
            <span>${escapeHtml(t.trophy_name)} (${t.vote_count} 票)</span>
          </li>
        `).join('');
        return `<div class="profile-card">
          <div class="profile-card-header">
            <span>${escapeHtml(displayLabelOf(profile.participant_id))}</span>
            <span class="chip chip-secondary">${profile.vote_count || 0} 票</span>
          </div>
          <ul class="profile-trophy-list">${trophies || '<li>尚未獲得獎項</li>'}</ul>
        </div>`;
      }).join('');
  }
  renderTrophySummaryInto(DOM.staffSummaryList, state.staffTrophy.trophySummary, {
    allowRename: false,
    idPrefix: 'staff-summary'
  });
}

function switchStaffSection(sectionName) {
  const name = sectionName || 'dashboard';
  document.querySelectorAll('.staff-module-nav .bottom-nav-item').forEach(btn => {
    const on = btn.dataset.staffSection === name;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', on);
  });
  document.querySelectorAll('.staff-section').forEach(panel => {
    const on = panel.dataset.staffSection === name;
    panel.classList.toggle('active', on);
    panel.classList.toggle('hidden', !on);
    if (on) replayEnterAnimation(panel, 'view-enter');
  });
  maybeShowPageOnboarding();
}

function switchStaffResultTab(tabName) {
  document.querySelectorAll('.staff-result-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.staffResultTab === tabName);
  });
  ['audit', 'profiles', 'summary'].forEach(name => {
    const panel = document.getElementById('staff-result-' + name);
    if (!panel) return;
    const on = name === tabName;
    panel.classList.toggle('active', on);
    panel.classList.toggle('hidden', !on);
  });
}

async function handleStaffRefreshLoginStatus(btn) {
  const action = async () => {
    const ids = getFacilitatorGroupMembers().map(p => p.participant_id);
    state.presence = await data.fetchPresenceForParticipants(ids);
    renderStaffLoginStatus();
    renderStaffLiveLoad();
  };
  try {
    if (btn) await runProgressButton(btn, action());
    else await action();
  } catch (err) {
    showToast(data.describeFirestoreError(err), 'error');
  }
}

async function handleStaffForceLogoutGroup() {
  const ids = getFacilitatorGroupMembers()
    .map(p => normalizeId(p.participant_id))
    .filter(id => !!id && isSeatParticipantId(id));
  const loggedIn = ids.filter(id => {
    const presence = state.presence.find(p => p.participant_id === id);
    return isPresenceCurrentlyLoggedIn(presence);
  });
  if (!loggedIn.length) {
    showToast('本組目前沒有已登入參加者', 'info');
    return;
  }
  if (!(await showConfirmCard({
    title: '強制登出本組',
    body: '確定要強制登出本組 ' + loggedIn.length + ' 位已登入參加者嗎？Staff 不受影響。',
    confirmLabel: '全部登出',
    danger: true
  }))) return;
  try {
    await data.forceLogoutParticipants(loggedIn);
    removeLocalPresence(loggedIn);
    showToast('已強制登出本組參加者', 'success');
  } catch (err) {
    showToast(data.describeFirestoreError(err), 'error');
  }
}

function renderStaffGroupMessages() {
  const list = DOM.staffMessageList;
  if (!list) return;
  const messages = state.staffMonitorMessages;
  if (DOM.staffMsgEmpty) DOM.staffMsgEmpty.classList.toggle('hidden', messages.length > 0);
  if (DOM.staffMsgCount) DOM.staffMsgCount.textContent = '共 ' + messages.length + ' 則';
  list.innerHTML = '';
  messages.forEach(msg => {
    const isDeleted = msg.status === 'deleted';
    const isNew = !state.staffKnownMessageIds.has(msg.message_id);
    const card = document.createElement('div');
    card.className = 'admin-msg-card' + (isDeleted ? ' deleted' : '') + (isNew ? ' new-highlight' : '');
    const action = !isDeleted
      ? `<button type="button" class="btn btn-danger btn-sm staff-delete-btn" data-id="${escapeHtml(msg.message_id)}">撤回</button>`
      : `<button type="button" class="btn btn-secondary btn-sm staff-restore-btn" data-id="${escapeHtml(msg.message_id)}">取消撤回</button>`;
    card.innerHTML = `
      <div class="admin-msg-header">
        <time datetime="${escapeHtml(msg.created_at || '')}">${formatMessageTime(msg.created_at)}</time>
        <span class="admin-msg-route">${escapeHtml(displayLabelOf(msg.sender_id))}<span class="arrow">→</span>${escapeHtml(displayLabelOf(msg.receiver_id))}</span>
        ${isDeleted ? '<span class="badge badge-deleted">已撤回</span>' : ''}
      </div>
      <div class="admin-msg-body">
        <div class="admin-msg-content">${escapeHtml(msg.content)}</div>
        <div class="admin-msg-action">${action}</div>
      </div>
    `;
    list.appendChild(card);
    state.staffKnownMessageIds.add(msg.message_id);
  });
  list.querySelectorAll('.staff-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await data.retractMessage(btn.dataset.id);
        showToast('已撤回', 'success');
      } catch (err) {
        showToast(data.describeFirestoreError(err), 'error');
      }
    });
  });
  list.querySelectorAll('.staff-restore-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await data.restoreMessage(btn.dataset.id);
        showToast('已取消撤回', 'success');
      } catch (err) {
        showToast(data.describeFirestoreError(err), 'error');
      }
    });
  });
}

async function handleStaffSaveGroupName() {
  const groupId = getFacilitatorGroupId();
  if (!groupId) return;
  const name = String(DOM.staffGroupNameInput?.value || '').trim();
  if (name.length > 40) {
    showToast('組名最多 40 字', 'error');
    return;
  }
  if (rejectIfTextBlocked(name)) return;
  await runProgressButton(DOM.staffSaveGroupName, (async () => {
    try {
      await data.setGroupDisplayName(groupId, name);
      showToast(name ? '組名已更新' : '已清除自訂組名', 'success');
      renderStaffFacilitatorPanel();
    } catch (err) {
      showToast(data.describeFirestoreError(err), 'error');
    }
  })());
}

async function handleStaffMessaging(status, btn) {
  const groupId = getFacilitatorGroupId();
  if (!groupId) return;
  await runProgressButton(btn, (async () => {
    try {
      await data.setGroupMessagingStatus(groupId, status);
      showToast(status === 'OPEN' ? '本組留言已開啟' : '本組留言已關閉', status);
    } catch (err) {
      showToast(data.describeFirestoreError(err), 'error');
    }
  })());
}

async function handleStaffVotingAction(status, btn) {
  const groupId = getFacilitatorGroupId();
  if (!groupId) return;
  const confirmMessages = {
    VOTING_OPEN: {
      title: '開放本組投票',
      body: '確定要為本組開放投票嗎？這會寫入本組覆寫，不再跟隨全域。'
    },
    VOTING_CLOSED: {
      title: '關閉本組投票',
      body: '確定要為本組關閉投票嗎？這會寫入本組覆寫，不再跟隨全域。'
    },
    PUBLISHED: {
      title: '公布本組結果',
      body: '確定要為本組公布結果嗎？這會寫入本組覆寫，不再跟隨全域。'
    }
  };
  const confirmCfg = confirmMessages[status];
  if (confirmCfg && !(await showConfirmCard({
    ...confirmCfg,
    confirmLabel: '確定',
    danger: status === 'VOTING_CLOSED'
  }))) return;
  await runProgressButton(btn, (async () => {
    try {
      await data.setGroupVotingStatus(groupId, status);
      rememberPendingGroupVoting(groupId, status);
      applyEffectiveVotingToTrophyState();
      renderStaffFacilitatorPanel();
      refreshStaffTrophyViews();
      showToast('本組覆寫：' + (VOTING_STATUS_LABELS[status] || status), status);
    } catch (err) {
      showToast(data.describeFirestoreError(err), 'error');
    }
  })());
}

async function handleStaffFollowGlobalVoting(btn) {
  const groupId = getFacilitatorGroupId();
  if (!groupId) return;
  if (!(await showConfirmCard({
    title: '恢復跟隨全域',
    body: '確定清除本組投票覆寫，改為跟隨全域嗎？',
    confirmLabel: '恢復'
  }))) return;
  await runProgressButton(btn, (async () => {
    try {
      await data.clearGroupVotingStatus(groupId);
      rememberPendingGroupVoting(groupId, '');
      applyEffectiveVotingToTrophyState();
      renderStaffFacilitatorPanel();
      refreshStaffTrophyViews();
      showToast('已恢復跟隨全域投票', state.votingConfig.voting_status || 'DRAFT');
    } catch (err) {
      showToast(data.describeFirestoreError(err), 'error');
    }
  })());
}

async function handleStaffCalculate(btn) {
  const groupId = getFacilitatorGroupId();
  if (!groupId) return;
  await runProgressButton(btn, (async () => {
    try {
      const members = getVotingParticipants(
        state.participants.filter(p => p.group_id === groupId)
      );
      const memberIds = members.map(p => p.participant_id);
      const submissions = await data.fetchSubmissionsForParticipants(memberIds);
      const trophies = filterValidTrophies(
        state.trophy.trophies.length ? state.trophy.trophies : await data.fetchTrophies()
      );
      const outcome = data.computeResults(members, trophies, submissions);
      await data.writeResults(outcome.awarded, { groupId });
      rememberPendingGroupVoting(groupId, 'CALCULATED');
      state.staffTrophy.submissions = submissions;
      applyEffectiveVotingToTrophyState();
      renderStaffFacilitatorPanel();
      refreshStaffTrophyViews();
      showToast('本組結果計算完成（本組覆寫）', 'CALCULATED');
    } catch (err) {
      showToast(data.describeFirestoreError(err), 'error');
    }
  })());
}

function renderAdminGroupOverrides() {
  const host = DOM.adminGroupOverrides;
  if (!host) return;
  const groups = [...new Set(state.participants.map(p => p.group_id).filter(isNumberedGroupId))]
    .sort(compareGroupLabels);
  if (groups.length === 0) {
    host.innerHTML = '<p class="form-hint">尚未有編號組別</p>';
    return;
  }
  host.innerHTML = groups.map(groupId => {
    const meta = state.groupMeta[groupId] || {};
    const voting = effectiveVotingConfigForGroup(groupId);
    const msgOpen = isMessagingOpenForGroup(groupId);
    const facilitators = state.participants
      .filter(p => p.group_id === groupId && isStaffPerson(p))
      .map(p => displayLabelOf(p));
    const hasVotingOverride = !!meta.voting_status;
    const hasMsgOverride = !!meta.messaging_status;
    const hasOverride = hasVotingOverride || hasMsgOverride;

    return `
      <div class="admin-group-override-card" data-group-id="${escapeHtml(groupId)}">
        <div class="admin-group-override-head">
          <div>
            <strong>${escapeHtml(formatGroupLabel(groupId))}</strong>
            <span class="form-hint">${escapeHtml(groupId)}</span>
          </div>
          <div class="admin-group-override-head-actions">
            <button type="button" class="btn btn-ghost btn-sm admin-rename-group" data-group="${escapeHtml(groupId)}">改名</button>
            <span class="chip ${hasOverride ? 'chip-warning' : 'chip-secondary'}">${hasOverride ? '組別覆寫中' : '跟隨全域'}</span>
          </div>
        </div>
        <div class="admin-group-override-meta">
          <span>留言：${msgOpen ? '開啟' : '關閉'}${hasMsgOverride ? '（組別覆寫）' : '（跟隨全域）'}</span>
          <span>投票：${escapeHtml(VOTING_STATUS_LABELS[voting.voting_status] || voting.voting_status)}${hasVotingOverride ? '（組別覆寫）' : '（跟隨全域）'}</span>
        </div>
        <div class="form-hint">負責 Staff：${facilitators.length ? escapeHtml(facilitators.join('、')) : '未指派'}</div>
        <div class="admin-group-actions" style="margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap;">
          <button type="button" class="btn btn-secondary btn-sm admin-toggle-group-msg" data-group="${escapeHtml(groupId)}" data-action="${msgOpen ? 'CLOSE' : 'OPEN'}">
            ${msgOpen ? '關閉本組留言' : '開啟本組留言'}
          </button>
          <button type="button" class="btn btn-secondary btn-sm admin-toggle-group-voting" data-group="${escapeHtml(groupId)}" data-action="${voting.voting_status === 'VOTING_OPEN' ? 'VOTING_CLOSED' : 'VOTING_OPEN'}">
            ${voting.voting_status === 'VOTING_OPEN' ? '關閉本組投票' : '開放本組投票'}
          </button>
          ${hasOverride ? `
            <button type="button" class="btn btn-ghost btn-sm admin-clear-group-override" data-group="${escapeHtml(groupId)}">
              恢復跟隨全域
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
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
    getLabel: (item) => displayLabelOf(item),
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
      submission_status: submission && submission.status === 'submitted' ? 'submitted' : 'none',
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
    showToast('載入參加者資料失敗：' + data.describeFirestoreError(err, '請稍後再試'), 'error');
  } finally {
    finishLoading();
  }
}

function renderAdminParticipantDetail(detail) {
  const p = detail.participant || {};
  const stats = detail.stats || {};

  DOM.adminEditPhone.value = p.phone_number || '';
  DOM.adminEditPhone.readOnly = false;
  DOM.adminEditPhone.title = '登入密碼';
  populateAdminEditGroupSelect(p.group_id || '');

  const submissionTone = stats.submission_status === 'submitted' ? 'tone-published' : 'tone-draft';
  DOM.adminParticipantStats.innerHTML = `
    <div class="stat-card"><div class="stat-value">${stats.sent_active || 0}</div><div class="stat-label">有效已發留言</div></div>
    <div class="stat-card"><div class="stat-value">${stats.sent_deleted || 0}</div><div class="stat-label">已撤回留言</div></div>
    <div class="stat-card"><div class="stat-value">${stats.received_active || 0}</div><div class="stat-label">收件箱留言</div></div>
    <div class="stat-card"><div class="stat-value">${stats.trophy_votes || 0}</div><div class="stat-label">獎項投票數</div></div>
    <div class="stat-card voting-status-card ${submissionTone}"><div class="stat-value">${stats.submission_status === 'submitted' ? '已提交' : '未提交'}</div><div class="stat-label">投票狀態</div></div>
    <div class="stat-card"><div class="stat-value">${stats.trophy_awards || 0}</div><div class="stat-label">獲得獎項</div></div>
  `;
}

async function refreshAdminParticipantDetail() {
  if (!state.adminParticipant.selectedId) return;
  await selectAdminParticipant(state.adminParticipant.selectedId);
}

function rosterBoardColumns() {
  return [
    data.GROUP_UNASSIGNED,
    'GROUP_1', 'GROUP_2', 'GROUP_3', 'GROUP_4', 'GROUP_5', 'GROUP_6',
    data.GROUP_STAFF
  ];
}

function normalizeRosterGroupId(groupId) {
  return data.normalizeGroupId(groupId);
}

/** Draft group moves from drag-drop; applied only after confirm. pid → target group. */
const rosterPendingMoves = new Map();
let rosterDraftApplying = false;

function pruneRosterPendingMoves() {
  const liveIds = new Set(state.participants.map(p => p.participant_id));
  for (const pid of [...rosterPendingMoves.keys()]) {
    if (!liveIds.has(pid)) {
      rosterPendingMoves.delete(pid);
      continue;
    }
    const person = state.participants.find(p => p.participant_id === pid);
    if (!person) {
      rosterPendingMoves.delete(pid);
      continue;
    }
    if (normalizeRosterGroupId(person.group_id) === rosterPendingMoves.get(pid)) {
      rosterPendingMoves.delete(pid);
    }
  }
}

function getRosterDraftParticipants() {
  pruneRosterPendingMoves();
  return state.participants.map(p => {
    const pending = rosterPendingMoves.get(p.participant_id);
    if (!pending) return p;
    return { ...p, group_id: pending };
  });
}

function syncRosterDraftActions() {
  pruneRosterPendingMoves();
  const pending = rosterPendingMoves.size > 0;
  if (DOM.adminRosterConfirm) {
    DOM.adminRosterConfirm.classList.toggle('hidden', !pending);
    DOM.adminRosterConfirm.disabled = !pending || rosterDraftApplying;
  }
  if (DOM.adminRosterDiscard) {
    DOM.adminRosterDiscard.classList.toggle('hidden', !pending);
    DOM.adminRosterDiscard.disabled = !pending || rosterDraftApplying;
  }
  if (DOM.adminRosterPendingHint) {
    DOM.adminRosterPendingHint.classList.toggle('hidden', !pending);
    if (pending) {
      DOM.adminRosterPendingHint.textContent =
        `有 ${rosterPendingMoves.size} 項未儲存嘅分組變更 — 撳「確認變更」先會生效`;
    }
  }
  if (DOM.adminRosterBoard) {
    DOM.adminRosterBoard.classList.toggle('has-roster-draft', pending);
  }
}

function clearRosterPendingMoves() {
  rosterPendingMoves.clear();
  syncRosterDraftActions();
}

function renderAdminRosterBoard() {
  if (!DOM.adminRosterBoard) return;
  const columns = rosterBoardColumns();
  const byGroup = new Map(columns.map(g => [g, []]));
  getRosterDraftParticipants().forEach(p => {
    const g = normalizeRosterGroupId(p.group_id);
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(p);
  });

  DOM.adminRosterBoard.innerHTML = columns.map(groupId => {
    const members = (byGroup.get(groupId) || []).slice().sort((a, b) =>
      a.participant_id.localeCompare(b.participant_id)
    );
    const cards = members.map(p => {
      const id = p.participant_id;
      const name = (p.display_name || '').trim();
      const staff = isStaffPerson(id);
      const pending = rosterPendingMoves.has(id);
      return `<button type="button" class="roster-chip${staff ? ' is-staff' : ''}${pending ? ' is-pending' : ''}"
        draggable="true" data-participant-id="${escapeHtml(id)}" data-group-id="${escapeHtml(groupId)}">
        <span class="roster-chip-id">${escapeHtml(id)}</span>
        ${name ? `<span class="roster-chip-name">${escapeHtml(name)}</span>` : ''}
      </button>`;
    }).join('');
    return `<section class="roster-column" data-drop-group="${escapeHtml(groupId)}">
      <header class="roster-column-header">
        <div class="roster-column-title-wrap">
          <strong class="roster-column-title">${escapeHtml(formatGroupLabel(groupId))}</strong>
          ${canRenameGroup(groupId) ? `<button type="button" class="btn btn-ghost btn-sm roster-column-rename" data-group-id="${escapeHtml(groupId)}" title="改組名" aria-label="改組名 ${escapeHtml(formatGroupLabel(groupId))}">改名</button>` : ''}
        </div>
        <span class="roster-column-count">${members.length}</span>
      </header>
      <div class="roster-column-body">${cards || '<p class="roster-empty">尚未有人</p>'}</div>
    </section>`;
  }).join('');
  syncRosterDraftActions();
}

let rosterDragPid = '';

function queueRosterDraftMove(pid, targetGroup) {
  const person = state.participants.find(p => p.participant_id === pid);
  if (!person) return false;
  const liveGroup = normalizeRosterGroupId(person.group_id);
  if (liveGroup === targetGroup) {
    rosterPendingMoves.delete(pid);
  } else {
    rosterPendingMoves.set(pid, targetGroup);
  }
  renderAdminRosterBoard();
  return true;
}

async function confirmRosterPendingMoves() {
  pruneRosterPendingMoves();
  if (!rosterPendingMoves.size || rosterDraftApplying) return;

  const draft = getRosterDraftParticipants();
  for (const groupId of rosterBoardColumns()) {
    if (!data.isNumberedGroupId(groupId)) continue;
    const seats = draft.filter(p =>
      normalizeRosterGroupId(p.group_id) === groupId && data.isSeatParticipantId(p.participant_id)
    );
    if (seats.length > data.SEAT_LETTERS.length) {
      showToast(`${formatGroupLabel(groupId)} 超過 ${data.SEAT_LETTERS.length} 個座位，請先調整`, 'error');
      return;
    }
  }

  const voting = state.votingConfig?.voting_status || '';
  if (voting === 'VOTING_OPEN' || voting === 'CALCULATED' || voting === 'PUBLISHED') {
    if (!(await showConfirmCard({
      title: '確認分組變更',
      body: '目前投票狀態為「' + (VOTING_STATUS_LABELS[voting] || voting) + '」。改組／重編號可能影響已投票或結果，確定繼續？',
      confirmLabel: '繼續',
      danger: true
    }))) {
      return;
    }
  }

  const desired = Object.fromEntries(rosterPendingMoves.entries());
  const moveCount = rosterPendingMoves.size;
  rosterDraftApplying = true;
  syncRosterDraftActions();

  await runProgressButton(DOM.adminRosterConfirm, (async () => {
    try {
      showToast(`正在套用 ${moveCount} 項分組變更…`, 'info');
      const { results, participants } = await data.applyRosterGroupDraft(desired, state.participants);
      state.participants = participants;
      setParticipantsCache(participants);
      clearRosterPendingMoves();
      renderAdminRosterBoard();
      const renamed = results.filter(r => r.renamed).length;
      showToast(
        renamed
          ? `已確認 ${results.length} 項變更（其中 ${renamed} 人已重編號）`
          : `已確認 ${results.length} 項分組變更`,
        'success'
      );
    } catch (err) {
      showToast(data.describeFirestoreError(err, err.message || '確認分組失敗'), 'error');
      renderAdminRosterBoard();
      throw err;
    } finally {
      rosterDraftApplying = false;
      syncRosterDraftActions();
    }
  })());
}

function discardRosterPendingMoves() {
  if (rosterDraftApplying) return;
  if (!rosterPendingMoves.size) return;
  clearRosterPendingMoves();
  renderAdminRosterBoard();
  showToast('已取消未儲存嘅分組變更', 'info');
}

function bindAdminRosterBoardEvents() {
  if (!DOM.adminRosterBoard || DOM.adminRosterBoard.dataset.bound === '1') return;
  DOM.adminRosterBoard.dataset.bound = '1';

  DOM.adminRosterBoard.addEventListener('dragstart', e => {
    if (rosterDraftApplying) {
      e.preventDefault();
      return;
    }
    const chip = e.target.closest('.roster-chip');
    if (!chip) return;
    rosterDragPid = chip.dataset.participantId || '';
    chip.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', rosterDragPid);
  });
  DOM.adminRosterBoard.addEventListener('dragend', e => {
    const chip = e.target.closest('.roster-chip');
    if (chip) chip.classList.remove('is-dragging');
    rosterDragPid = '';
    DOM.adminRosterBoard.querySelectorAll('.roster-column.is-drop-target').forEach(col => {
      col.classList.remove('is-drop-target');
    });
  });
  DOM.adminRosterBoard.addEventListener('dragover', e => {
    if (rosterDraftApplying) return;
    const col = e.target.closest('.roster-column');
    if (!col) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    DOM.adminRosterBoard.querySelectorAll('.roster-column.is-drop-target').forEach(c => {
      if (c !== col) c.classList.remove('is-drop-target');
    });
    col.classList.add('is-drop-target');
  });
  DOM.adminRosterBoard.addEventListener('dragleave', e => {
    const col = e.target.closest('.roster-column');
    if (col && !col.contains(e.relatedTarget)) col.classList.remove('is-drop-target');
  });
  DOM.adminRosterBoard.addEventListener('drop', e => {
    const col = e.target.closest('.roster-column');
    if (!col) return;
    e.preventDefault();
    col.classList.remove('is-drop-target');
    if (rosterDraftApplying) return;
    const pid = rosterDragPid || e.dataTransfer.getData('text/plain');
    const targetGroup = col.dataset.dropGroup;
    if (!pid || !targetGroup) return;
    const draftPerson = getRosterDraftParticipants().find(p => p.participant_id === pid);
    if (!draftPerson) return;
    if (normalizeRosterGroupId(draftPerson.group_id) === targetGroup) return;
    queueRosterDraftMove(pid, targetGroup);
  });

  DOM.adminRosterBoard.addEventListener('click', e => {
    const renameBtn = e.target.closest('.roster-column-rename');
    if (renameBtn) {
      e.preventDefault();
      e.stopPropagation();
      openGroupRenameModal(renameBtn.dataset.groupId);
      return;
    }
    const chip = e.target.closest('.roster-chip');
    if (!chip) return;
    if (rosterPendingMoves.size > 0) {
      showToast('請先確認或取消分組變更，再編輯參加者', 'info');
      return;
    }
    openRosterEditModal(chip.dataset.participantId);
  });
}

function populateRosterGroupSelect(selectEl, selectedId) {
  populateGroupSelect(selectEl, selectedId || data.GROUP_UNASSIGNED);
}

async function openRosterEditModal(participantId) {
  const pid = normalizeId(participantId);
  const person = state.participants.find(p => p.participant_id === pid);
  if (!person || !DOM.rosterEditModal) return;

  DOM.rosterEditModal.dataset.editingId = pid;
  if (DOM.rosterEditTitle) DOM.rosterEditTitle.textContent = '編輯 ' + pid;
  if (DOM.rosterEditSubtitle) {
    DOM.rosterEditSubtitle.textContent = isStaffPerson(pid)
      ? 'Staff 編號改動會同步 Auth 帳戶；改組唔會自動重編號。'
      : '座位參加者改組會自動重編號；亦可手動改編號。';
  }
  if (DOM.rosterEditId) {
    DOM.rosterEditId.value = pid;
    // Seat renumber is supported; Staff login ids stay stable (rename Auth email is fragile).
    DOM.rosterEditId.readOnly = isStaffPerson(pid);
  }
  if (DOM.rosterEditName) DOM.rosterEditName.value = person.display_name || '';
  if (DOM.rosterEditPassword) {
    DOM.rosterEditPassword.value = await data.fetchContact(pid);
  }
  populateRosterGroupSelect(DOM.rosterEditGroup, normalizeRosterGroupId(person.group_id));
  DOM.rosterEditModal.classList.remove('hidden');
}

function closeRosterEditModal() {
  if (DOM.rosterEditModal) DOM.rosterEditModal.classList.add('hidden');
}

function openRosterAddModal() {
  if (!DOM.rosterAddModal) return;
  if (rosterPendingMoves.size > 0) {
    showToast('請先確認或取消分組變更，再新增參加者', 'info');
    return;
  }
  if (DOM.rosterAddKind) DOM.rosterAddKind.value = 'seat';
  if (DOM.rosterAddId) DOM.rosterAddId.value = '';
  if (DOM.rosterAddName) DOM.rosterAddName.value = '';
  if (DOM.rosterAddPassword) DOM.rosterAddPassword.value = '';
  populateRosterGroupSelect(DOM.rosterAddGroup, data.GROUP_UNASSIGNED);
  syncRosterAddKindUi();
  DOM.rosterAddModal.classList.remove('hidden');
}

function closeRosterAddModal() {
  if (DOM.rosterAddModal) DOM.rosterAddModal.classList.add('hidden');
}

function syncRosterAddKindUi() {
  const staff = DOM.rosterAddKind && DOM.rosterAddKind.value === 'staff';
  if (DOM.rosterAddIdWrap) DOM.rosterAddIdWrap.classList.toggle('hidden', !staff);
}

async function handleRosterEditSave() {
  const oldId = DOM.rosterEditModal?.dataset.editingId;
  if (!oldId) return;
  const newId = normalizeId(DOM.rosterEditId?.value || '');
  const name = (DOM.rosterEditName?.value || '').trim();
  const password = (DOM.rosterEditPassword?.value || '').trim();
  const groupId = (DOM.rosterEditGroup?.value || '').trim() || data.GROUP_UNASSIGNED;
  if (rejectIfTextBlocked(name)) return;

  await runProgressButton(DOM.rosterEditSave, (async () => {
    try {
      let finalId = oldId;
      if (newId && newId !== oldId) {
        if (!(isSeatParticipantId(oldId) && isSeatParticipantId(newId))) {
          throw new Error('只支援座位編號重命名（例如 3E → 1F）');
        }
        finalId = await data.renameParticipantId(oldId, newId, {
          groupId,
          displayName: name,
          password: password || undefined
        });
      } else {
        const person = state.participants.find(p => p.participant_id === oldId);
        const currentGroup = normalizeRosterGroupId(person?.group_id);
        if (groupId !== currentGroup) {
          const result = await data.assignParticipantToGroup(oldId, groupId, state.participants);
          finalId = result.participantId;
        }
        if (name !== (person?.display_name || '').trim()) {
          await data.updateParticipantDisplayName(finalId, name);
        }
        if (password) {
          await data.updateParticipantContact(finalId, password);
          await data.forceLogoutParticipant(finalId).catch(() => {});
        }
      }

      // If renamed path already set name/password/group; still sync leftovers.
      if (newId && newId !== oldId) {
        if (name) await data.updateParticipantDisplayName(finalId, name).catch(() => {});
        if (password) {
          await data.updateParticipantContact(finalId, password);
          await data.forceLogoutParticipant(finalId).catch(() => {});
        }
      }

      closeRosterEditModal();
      showToast(password ? ('已更新 ' + finalId + '，新密碼已即時生效') : ('已更新 ' + finalId), 'success');
    } catch (err) {
      showToast(data.describeFirestoreError(err, err.message || '儲存失敗'), 'error');
    }
  })());
}

async function handleRosterEditDelete() {
  const pid = DOM.rosterEditModal?.dataset.editingId;
  if (!pid) return;
  if (!(await showConfirmCard({
    title: '刪除參加者',
    body: `確定刪除 ${pid}？\n會刪除 Auth 帳戶、留言、投票同結果，無法復原。`,
    confirmLabel: '刪除',
    danger: true
  }))) return;
  try {
    await data.deleteParticipantCompletely(pid, state.participants);
    closeRosterEditModal();
    showToast('已刪除 ' + pid, 'success');
  } catch (err) {
    showToast(data.describeFirestoreError(err, err.message || '刪除失敗'), 'error');
  }
}

async function handleRosterAddSave() {
  const kind = DOM.rosterAddKind?.value || 'seat';
  const groupId = (DOM.rosterAddGroup?.value || '').trim() || data.GROUP_UNASSIGNED;
  const password = (DOM.rosterAddPassword?.value || '').trim();
  const name = (DOM.rosterAddName?.value || '').trim();
  let pid = '';

  if (kind === 'staff') {
    pid = normalizeId(DOM.rosterAddId?.value || '');
    if (!pid || isSeatParticipantId(pid) || isAdminLogin(pid)) {
      showToast('請輸入有效 Staff 編號（例如 WILL）', 'error');
      return;
    }
  } else if (data.isNumberedGroupId(groupId)) {
    pid = data.nextSeatIdForGroup(groupId, state.participants);
    if (!pid) {
      showToast(formatGroupLabel(groupId) + ' 座位已滿', 'error');
      return;
    }
  } else {
    pid = data.nextGlobalSeatId(state.participants);
    if (!pid) {
      showToast('冇剩餘座位編號可用', 'error');
      return;
    }
  }

  if (!password) {
    showToast('請輸入密碼', 'error');
    return;
  }
  if (rejectIfTextBlocked(name)) return;

  await runProgressButton(DOM.rosterAddSave, (async () => {
    try {
      await data.createParticipant({
        participantId: pid,
        groupId,
        password,
        displayName: name
      });
      closeRosterAddModal();
      showToast('已新增 ' + pid, 'success');
    } catch (err) {
      showToast(data.describeFirestoreError(err, err.message || '新增失敗'), 'error');
    }
  })());
}

/** Standard group options for settings dropdowns, plus any live extras. */
function listEditableGroupIds(selectedId) {
  const groups = new Set([
    data.GROUP_UNASSIGNED,
    'GROUP_1', 'GROUP_2', 'GROUP_3', 'GROUP_4', 'GROUP_5', 'GROUP_6', data.GROUP_STAFF
  ]);
  state.participants.forEach(p => {
    if (p.group_id) groups.add(normalizeRosterGroupId(p.group_id));
  });
  if (selectedId) groups.add(selectedId);
  return [...groups].sort(compareGroupLabels);
}

function populateGroupSelect(selectEl, selectedId) {
  if (!selectEl) return;
  const groups = listEditableGroupIds(selectedId);
  const prev = selectedId || selectEl.value || '';
  selectEl.innerHTML = groups.map(g =>
    `<option value="${escapeHtml(g)}">${escapeHtml(formatGroupLabel(g))}</option>`
  ).join('');
  if (prev && groups.includes(prev)) {
    selectEl.value = prev;
  } else if (groups.length) {
    selectEl.value = groups[0];
  }
}

function populateAdminEditGroupSelect(selectedId) {
  populateGroupSelect(DOM.adminEditGroup, selectedId);
}

async function handleAdminSaveParticipant() {
  const pid = state.adminParticipant.selectedId;
  if (!pid) { showToast('請先選擇參加者', 'error'); return; }

  const groupId = DOM.adminEditGroup.value.trim();
  if (!groupId) { showToast('分組不能為空', 'error'); return; }
  const newPassword = (DOM.adminEditPhone?.value || '').trim();

  await runProgressButton(DOM.adminSaveParticipant, (async () => {
    try {
      await data.updateParticipantGroup(pid, groupId);
      const person = state.participants.find(p => p.participant_id === pid);
      if (person) person.group_id = groupId;

      if (newPassword) {
        await data.updateParticipantContact(pid, newPassword);
        await data.forceLogoutParticipant(pid).catch(() => {});
        if (state.adminParticipant.detail?.participant) {
          state.adminParticipant.detail.participant.phone_number = newPassword;
        }
      }

      setParticipantsCache(state.participants);
      showToast(newPassword ? '參加者資料已更新，新密碼已即時生效' : '參加者資料已更新', 'success');
      await refreshAdminParticipantDetail();
      refreshAdminTrophyViews();
      renderAdminGroupOverrides();
    } catch (err) {
      showToast(data.describeFirestoreError(err), 'error');
    }
  })());
}

async function handleAdminForceLogoutParticipant(participantId, btn) {
  const pid = normalizeId(participantId);
  if (!pid) return;

  const action = async () => {
    await data.forceLogoutParticipant(pid);
    removeLocalPresence([pid]);
    closeForceLogoutModal();
  };

  if (btn) {
    try {
      await runProgressButton(btn, action());
    } catch (err) {
      showToast(data.describeFirestoreError(err), 'error');
    }
  } else {
    try {
      await action();
    } catch (err) {
      showToast(data.describeFirestoreError(err), 'error');
    }
  }
}

async function handleAdminForceLogoutAll() {
  const ids = state.presence
    .filter(p => isPresenceCurrentlyLoggedIn(p))
    .map(p => normalizeId(p.participant_id))
    .filter(id => !!id && isSeatParticipantId(id));
  if (!ids.length) {
    showToast('目前沒有已登入參加者', 'info');
    return;
  }
  try {
    await data.forceLogoutParticipants(ids);
    removeLocalPresence(ids);
    closeForceLogoutAllModal();
    showToast('已強制登出全部參加者', 'success');
  } catch (err) {
    showToast(data.describeFirestoreError(err), 'error');
  }
}

async function handleAdminDeleteMessages() {
  const pid = state.adminParticipant.selectedId;
  if (!pid) return;
  if (!(await showConfirmCard({
    title: '刪除留言',
    body: '確定要刪除 ' + pid + ' 的所有已發留言嗎？',
    confirmLabel: '刪除',
    danger: true
  }))) return;

  await runProgressButton(DOM.adminDeleteMessages, (async () => {
    try {
      const removed = await data.clearParticipantRecords(pid, {
        deleteMessages: true, deleteTrophy: false, deleteResults: false
      });
      showToast('已刪除 ' + removed + ' 則留言', 'success');
      await refreshAdminParticipantDetail();
    } catch (err) {
      showToast(data.describeFirestoreError(err), 'error');
    }
  })());
}

async function handleAdminResetTrophy() {
  const pid = state.adminParticipant.selectedId;
  if (!pid) return;
  if (!(await showConfirmCard({
    title: '重置投票',
    body: '確定要重置 ' + pid + ' 的獎項投票嗎？',
    confirmLabel: '重置',
    danger: true
  }))) return;

  await runProgressButton(DOM.adminResetTrophy, (async () => {
    try {
      await data.resetParticipantVote(pid);
      showToast('獎項投票已重置', 'success');
      await refreshAdminParticipantDetail();
    } catch (err) {
      showToast(data.describeFirestoreError(err), 'error');
    }
  })());
}

async function handleAdminDeleteAllRecords() {
  const pid = state.adminParticipant.selectedId;
  if (!pid) return;
  if (!(await showConfirmCard({
    title: '刪除全部紀錄',
    body: '確定要刪除 ' + pid + ' 的所有紀錄嗎？\n包括：已發留言、獎項投票、結果。\n此操作無法復原！',
    confirmLabel: '刪除',
    danger: true
  }))) return;

  await runProgressButton(DOM.adminDeleteAllRecords, (async () => {
    try {
      const removed = await data.clearParticipantRecords(pid, {
        deleteMessages: true, deleteTrophy: true, deleteResults: true
      });
      showToast('已刪除 ' + removed + ' 項紀錄', 'success');
      await refreshAdminParticipantDetail();
    } catch (err) {
      showToast(data.describeFirestoreError(err), 'error');
    }
  })());
}

async function handleAdminBulkResetVotes() {
  const count = state.participants.length;
  if (!(await showConfirmCard({
    title: '重置全部投票',
    body: '確定要重置全部 ' + count + ' 位參加者的獎項投票嗎？\n包括：已提交選票、計算結果。\n留言不會被刪除。\n此操作無法復原！',
    confirmLabel: '重置全部',
    danger: true
  }))) return;

  await runProgressButton(DOM.adminBulkResetVotes, (async () => {
    try {
      const removed = await data.resetAllVotes();
      showToast('已重置 ' + removed + ' 項投票紀錄', 'success');
      await refreshAdminParticipantDetail();
      refreshAdminTrophyViews();
    } catch (err) {
      showToast(data.describeFirestoreError(err), 'error');
    }
  })());
}

async function handleAdminBulkDeleteAll() {
  const count = state.participants.length;
  if (!(await showConfirmCard({
    title: '刪除全部紀錄',
    body: '確定要刪除全部 ' + count + ' 位參加者的所有紀錄嗎？\n包括：已發留言、獎項投票、結果。\n此操作無法復原！',
    confirmLabel: '全部刪除',
    danger: true
  }))) return;

  await runProgressButton(DOM.adminBulkDeleteAll, (async () => {
    try {
      const removed = await data.clearAllRecords();
      showToast('已清除 ' + removed + ' 項紀錄，投票狀態已重設', 'success');
      await refreshAdminParticipantDetail();
      refreshAdminTrophyViews();
    } catch (err) {
      showToast(data.describeFirestoreError(err), 'error');
    }
  })());
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
  if (isParticipantUnassigned() && viewName !== 'home' && viewName !== 'profile') {
    showToast('你尚未分配組別，暫未能使用此功能', 'info');
    viewName = 'home';
  }
  if (isStaffPerson(state.participantId) && (viewName === 'trophy' || viewName === 'trophy-submitted')) {
    showToast('Staff 不參與投票', 'info');
    viewName = isGroupFacilitator() ? 'staff' : 'home';
  }
  if (viewName !== 'trophy' && viewName !== 'trophy-submitted') {
    state.trophy.reviewSubmitted = false;
  }
  document.querySelectorAll('#screen-participant .app-view').forEach(view => {
    const isActive = view.dataset.view === viewName;
    view.classList.toggle('active', isActive);
    view.classList.toggle('hidden', !isActive);
    if (isActive) replayEnterAnimation(view, 'view-enter');
  });

  const isBottomTab = BOTTOM_NAV_TABS.includes(viewName);
  document.querySelectorAll('#screen-participant .bottom-nav-item').forEach(btn => {
    const tab = btn.dataset.tab;
    const isActive = isBottomTab && tab === viewName;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive);
  });

  if (viewName === 'home') {
    applyUnassignedChrome();
  } else if (viewName === 'inbox') {
    markAllInboxRead();
  } else if (viewName === 'trophy') {
    renderTrophyTeammates();
    updateTrophyStatusBanner();
  } else if (viewName === 'profile') {
    renderProfile();
  } else if (viewName === 'staff') {
    renderStaffFacilitatorPanel();
    renderStaffGroupMessages();
  }
  maybeShowPageOnboarding();
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
    const on = key === tabName;
    panel.classList.toggle('active', on);
    panel.classList.toggle('hidden', !on);
    if (on) replayEnterAnimation(panel, 'view-enter');
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
    loadAdminPushConfig();
    if (DOM.adminParticipantCount) {
      DOM.adminParticipantCount.textContent = String(state.participants.length);
    }
  } else if (tabName === 'dashboard') {
    renderAdminDashboard();
    renderAdminLiveLoad();
  }
  maybeShowPageOnboarding();
}

function switchResultTab(tabName) {
  document.querySelectorAll('#admin-results-panel .sub-tab-btn').forEach(btn => {
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
  initStaticTextInputGuards();

  DOM.inboxRefresh.addEventListener('click', refreshInbox);
  DOM.sentRefresh.addEventListener('click', refreshSent);

  if (DOM.trophyClearAll) {
    DOM.trophyClearAll.addEventListener('click', handleTrophyClearAll);
  }
  DOM.trophySubmitAll.addEventListener('click', handleTrophySubmitAll);
  DOM.trophyResultsModalClose.addEventListener('click', hideTrophyResultsModal);
  DOM.trophyResultsModal.addEventListener('click', (e) => {
    if (e.target === DOM.trophyResultsModal) hideTrophyResultsModal();
  });

  if (DOM.onboardingNext) {
    DOM.onboardingNext.addEventListener('click', handleOnboardingNext);
  }
  if (DOM.onboardingPrev) {
    DOM.onboardingPrev.addEventListener('click', handleOnboardingPrev);
  }
  if (DOM.onboardingSkip) {
    DOM.onboardingSkip.addEventListener('click', finishOnboarding);
  }
  if (DOM.onboardingDim) {
    DOM.onboardingDim.addEventListener('click', finishOnboarding);
  }
  if (DOM.a2hsLater) {
    DOM.a2hsLater.addEventListener('click', () => closeAddToHomePrompt());
  }
  if (DOM.a2hsInstall) {
    DOM.a2hsInstall.addEventListener('click', () => handleAddToHomeInstall());
  }
  if (DOM.a2hsModal) {
    DOM.a2hsModal.addEventListener('click', (e) => {
      if (e.target === DOM.a2hsModal) closeAddToHomePrompt();
    });
  }
  if (DOM.loginAddHome) {
    DOM.loginAddHome.addEventListener('click', () => openAddToHomePrompt({ force: true }));
  }
  document.querySelectorAll('.page-help-btn').forEach(btn => {
    btn.addEventListener('click', handlePageHelpClick);
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
  if (DOM.forceLogoutCancel) {
    DOM.forceLogoutCancel.addEventListener('click', closeForceLogoutModal);
  }
  if (DOM.forceLogoutConfirm) {
    DOM.forceLogoutConfirm.addEventListener('click', () => {
      if (!state.adminForceLogoutTarget) return;
      handleAdminForceLogoutParticipant(state.adminForceLogoutTarget, DOM.forceLogoutConfirm);
    });
  }
  if (DOM.forceLogoutModal) {
    DOM.forceLogoutModal.addEventListener('click', (e) => {
      if (e.target === DOM.forceLogoutModal) closeForceLogoutModal();
    });
  }
  if (DOM.forceLogoutAllCancel) {
    DOM.forceLogoutAllCancel.addEventListener('click', closeForceLogoutAllModal);
  }
  if (DOM.forceLogoutAllConfirm) {
    DOM.forceLogoutAllConfirm.addEventListener('click', () => handleAdminForceLogoutAll());
  }
  if (DOM.forceLogoutAllModal) {
    DOM.forceLogoutAllModal.addEventListener('click', (e) => {
      if (e.target === DOM.forceLogoutAllModal) closeForceLogoutAllModal();
    });
  }
  if (DOM.confirmModalCancel) {
    DOM.confirmModalCancel.addEventListener('click', () => closeConfirmModal(false));
  }
  if (DOM.confirmModalOk) {
    DOM.confirmModalOk.addEventListener('click', () => closeConfirmModal(true));
  }
  if (DOM.confirmModal) {
    DOM.confirmModal.addEventListener('click', (e) => {
      if (e.target === DOM.confirmModal) closeConfirmModal(false);
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (DOM.confirmModal && !DOM.confirmModal.classList.contains('hidden')) {
      closeConfirmModal(false);
      return;
    }
    if (DOM.trophyGuideModal && !DOM.trophyGuideModal.classList.contains('hidden')) {
      closeTrophyGuideModal();
    }
  });

  if (DOM.trophySubmittedHome) {
    DOM.trophySubmittedHome.addEventListener('click', () => switchParticipantView('home'));
  }
  if (DOM.trophySubmittedView) {
    DOM.trophySubmittedView.addEventListener('click', openSubmittedBallotReview);
  }
  if (DOM.trophyGuideOpen) {
    DOM.trophyGuideOpen.addEventListener('click', openTrophyGuideModal);
  }
  if (DOM.trophyGuideClose) {
    DOM.trophyGuideClose.addEventListener('click', closeTrophyGuideModal);
  }
  if (DOM.trophyGuideModal) {
    DOM.trophyGuideModal.addEventListener('click', (e) => {
      if (e.target === DOM.trophyGuideModal) closeTrophyGuideModal();
    });
  }
  if (DOM.trophyDeckPrev) {
    DOM.trophyDeckPrev.addEventListener('click', () => stepTrophyDeck(-1));
  }
  if (DOM.trophyDeckNext) {
    DOM.trophyDeckNext.addEventListener('click', () => stepTrophyDeck(1));
  }
  if (DOM.trophyDeckExportPdf) {
    DOM.trophyDeckExportPdf.addEventListener('click', handleTrophyDeckExportPdf);
  }

  document.querySelectorAll('#screen-participant .bottom-nav .bottom-nav-item').forEach(btn => {
    btn.addEventListener('click', () => switchParticipantView(btn.dataset.tab));
  });

  document.querySelectorAll('.staff-module-nav .bottom-nav-item').forEach(btn => {
    btn.addEventListener('click', () => switchStaffSection(btn.dataset.staffSection));
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

  if (DOM.profileSaveName) {
    DOM.profileSaveName.addEventListener('click', handleSaveDisplayName);
  }
  if (DOM.profileSavePassword) {
    DOM.profileSavePassword.addEventListener('click', handleSavePassword);
  }
  if (DOM.profilePushEnable) {
    DOM.profilePushEnable.addEventListener('click', handleEnablePush);
  }
  if (DOM.profilePushDisable) {
    DOM.profilePushDisable.addEventListener('click', handleDisablePush);
  }
  if (DOM.profilePushTest) {
    DOM.profilePushTest.addEventListener('click', handleTestPush);
  }
  if (DOM.alertBannerMain) {
    DOM.alertBannerMain.addEventListener('click', openAlertBannerTarget);
  }
  if (DOM.alertBannerClose) {
    DOM.alertBannerClose.addEventListener('click', hideAlertBanner);
  }
  document.querySelectorAll('.staff-result-tab').forEach(btn => {
    btn.addEventListener('click', () => switchStaffResultTab(btn.dataset.staffResultTab));
  });

  if (DOM.staffSaveGroupName) {
    DOM.staffSaveGroupName.addEventListener('click', handleStaffSaveGroupName);
  }
  if (DOM.staffEnableMsg) {
    DOM.staffEnableMsg.addEventListener('click', () => handleStaffMessaging('OPEN', DOM.staffEnableMsg));
  }
  if (DOM.staffDisableMsg) {
    DOM.staffDisableMsg.addEventListener('click', () => handleStaffMessaging('CLOSE', DOM.staffDisableMsg));
  }
  if (DOM.staffOpenVoting) {
    DOM.staffOpenVoting.addEventListener('click', () => handleStaffVotingAction('VOTING_OPEN', DOM.staffOpenVoting));
  }
  if (DOM.staffCloseVoting) {
    DOM.staffCloseVoting.addEventListener('click', () => handleStaffVotingAction('VOTING_CLOSED', DOM.staffCloseVoting));
  }
  if (DOM.staffCalculate) {
    DOM.staffCalculate.addEventListener('click', () => handleStaffCalculate(DOM.staffCalculate));
  }
  if (DOM.staffPublish) {
    DOM.staffPublish.addEventListener('click', () => handleStaffVotingAction('PUBLISHED', DOM.staffPublish));
  }
  if (DOM.staffFollowGlobalVoting) {
    DOM.staffFollowGlobalVoting.addEventListener('click', () =>
      handleStaffFollowGlobalVoting(DOM.staffFollowGlobalVoting));
  }

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
  if (DOM.adminSaveVapid) {
    DOM.adminSaveVapid.addEventListener('click', handleAdminSaveVapid);
  }

  DOM.adminOpenVoting.addEventListener('click', () => handleAdminVotingAction('VOTING_OPEN', DOM.adminOpenVoting));
  DOM.adminCloseVoting.addEventListener('click', () => handleAdminVotingAction('VOTING_CLOSED', DOM.adminCloseVoting));
  DOM.adminCalculate.addEventListener('click', () => handleAdminCalculate(DOM.adminCalculate));
  DOM.adminPublish.addEventListener('click', () => handleAdminVotingAction('PUBLISHED', DOM.adminPublish));

  DOM.adminSaveParticipant.addEventListener('click', handleAdminSaveParticipant);
  DOM.adminDeleteMessages.addEventListener('click', handleAdminDeleteMessages);
  DOM.adminResetTrophy.addEventListener('click', handleAdminResetTrophy);
  DOM.adminDeleteAllRecords.addEventListener('click', handleAdminDeleteAllRecords);
  DOM.adminBulkResetVotes.addEventListener('click', handleAdminBulkResetVotes);
  DOM.adminBulkDeleteAll.addEventListener('click', handleAdminBulkDeleteAll);

  bindAdminRosterBoardEvents();
  if (DOM.adminRosterAdd) DOM.adminRosterAdd.addEventListener('click', openRosterAddModal);
  if (DOM.adminRosterConfirm) DOM.adminRosterConfirm.addEventListener('click', confirmRosterPendingMoves);
  if (DOM.adminRosterDiscard) DOM.adminRosterDiscard.addEventListener('click', discardRosterPendingMoves);
  if (DOM.rosterEditCancel) DOM.rosterEditCancel.addEventListener('click', closeRosterEditModal);
  if (DOM.rosterEditSave) DOM.rosterEditSave.addEventListener('click', handleRosterEditSave);
  if (DOM.rosterEditDelete) DOM.rosterEditDelete.addEventListener('click', handleRosterEditDelete);
  if (DOM.rosterAddCancel) DOM.rosterAddCancel.addEventListener('click', closeRosterAddModal);
  if (DOM.rosterAddSave) DOM.rosterAddSave.addEventListener('click', handleRosterAddSave);
  if (DOM.rosterAddKind) DOM.rosterAddKind.addEventListener('change', syncRosterAddKindUi);
  if (DOM.rosterEditModal) {
    DOM.rosterEditModal.addEventListener('click', e => {
      if (e.target === DOM.rosterEditModal) closeRosterEditModal();
    });
  }
  if (DOM.rosterAddModal) {
    DOM.rosterAddModal.addEventListener('click', e => {
      if (e.target === DOM.rosterAddModal) closeRosterAddModal();
    });
  }
  if (DOM.groupRenameCancel) DOM.groupRenameCancel.addEventListener('click', closeGroupRenameModal);
  if (DOM.groupRenameSave) DOM.groupRenameSave.addEventListener('click', handleGroupRenameSave);
  if (DOM.groupRenameModal) {
    DOM.groupRenameModal.addEventListener('click', e => {
      if (e.target === DOM.groupRenameModal) closeGroupRenameModal();
    });
  }
  if (DOM.groupRenameInput) {
    DOM.groupRenameInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleGroupRenameSave();
      }
    });
  }

  DOM.auditSearch.addEventListener('input', renderAuditTable);
  DOM.auditTrophyFilter.addEventListener('change', renderAuditTable);

  if (DOM.adminGroupOverrides) {
    DOM.adminGroupOverrides.addEventListener('click', async (e) => {
      const renameBtn = e.target.closest('.admin-rename-group');
      if (renameBtn) {
        openGroupRenameModal(renameBtn.dataset.group);
        return;
      }

      const clearBtn = e.target.closest('.admin-clear-group-override');
      if (clearBtn) {
        const groupId = clearBtn.dataset.group;
        if (!groupId) return;
        await runProgressButton(clearBtn, (async () => {
          try {
            await data.clearGroupAllOverrides(groupId);
            renderAdminGroupOverrides();
            showToast(`${formatGroupLabel(groupId)} 已清除覆寫，恢復跟隨全域`, 'info');
          } catch (err) {
            showToast(data.describeFirestoreError(err), 'error');
          }
        })());
        return;
      }

      const msgBtn = e.target.closest('.admin-toggle-group-msg');
      if (msgBtn) {
        const groupId = msgBtn.dataset.group;
        const newStatus = msgBtn.dataset.action;
        if (!groupId || !newStatus) return;
        await runProgressButton(msgBtn, (async () => {
          try {
            await data.setGroupMessagingStatus(groupId, newStatus);
            renderAdminGroupOverrides();
            showToast(`${formatGroupLabel(groupId)} 留言已${newStatus === 'OPEN' ? '開啟' : '關閉'}（組別覆寫）`, 'success');
          } catch (err) {
            showToast(data.describeFirestoreError(err), 'error');
          }
        })());
        return;
      }

      const votingBtn = e.target.closest('.admin-toggle-group-voting');
      if (votingBtn) {
        const groupId = votingBtn.dataset.group;
        const newStatus = votingBtn.dataset.action;
        if (!groupId || !newStatus) return;
        await runProgressButton(votingBtn, (async () => {
          try {
            await data.setGroupVotingStatus(groupId, newStatus);
            renderAdminGroupOverrides();
            showToast(`${formatGroupLabel(groupId)} 投票已${newStatus === 'VOTING_OPEN' ? '開放' : '關閉'}（組別覆寫）`, newStatus);
          } catch (err) {
            showToast(data.describeFirestoreError(err), 'error');
          }
        })());
        return;
      }
    });
  }

}

// ─── Init ─────────────────────────────────────────────────────────────────────

/** Block accidental double-tap / double-click zoom without disabling pinch zoom. */
function initPreventDoubleTapZoom() {
  document.addEventListener('dblclick', (e) => {
    e.preventDefault();
  }, { capture: true });

  let lastTouchEnd = 0;
  document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 350) {
      const editable = e.target && e.target.closest
        ? e.target.closest('input, textarea, select, [contenteditable="true"]')
        : null;
      if (!editable) e.preventDefault();
    }
    lastTouchEnd = now;
  }, { passive: false, capture: true });
}

function init() {
  cacheDOM();
  bindEvents();
  initAddToHome();
  initPreventDoubleTapZoom();
  initKeyboardAvoidance();
  initAdminMessageScrollPause();
  startApp();
}

async function startApp() {
  beginSplash();

  setSplashStatus('載入手寫字體…');
  setSplashPercent(12);
  const fontOk = await waitForAppFont();
  if (fontOk && DOM.screenSplash) {
    DOM.screenSplash.classList.add('splash-font-ready');
    setSplashStatus('手寫字體已就緒');
  } else {
    setSplashStatus('字體逾時，改用系統字體繼續');
  }
  setSplashPercent(40);

  try {
    setSplashStatus('載入活動設定同參加者名單…');
    await bootstrapApp();
    setSplashPercent(72);
  } catch (_) {
    setSplashStatus('活動資料載入失敗，稍後可重試');
  }

  let restored = false;
  try {
    setSplashStatus('檢查登入狀態…');
    restored = await tryRestoreSession();
    setSplashPercent(92);
  } catch (err) {
    clearSession();
    console.warn('無法恢復登入狀態:', err && err.message);
    setSplashStatus('登入狀態檢查完成');
  }

  if (restored) {
    setSplashStatus('歡迎回來，正在進入…');
  } else {
    setSplashStatus('進入登入頁…');
  }

  await endSplash();
  if (!restored) {
    showScreen('login');
    updateLoginStatusBanner();
    const loginInner = document.querySelector('#screen-login .login-inner');
    replayEnterAnimation(loginInner, 'page-enter');
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
 * results, groups, config/messaging, config/voting.
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
