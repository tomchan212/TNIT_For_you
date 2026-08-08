/**
 * Verifies the admin participant settings panel against live Firestore rules.
 *
 * The contacts collection is admin-only; if the rules publish failed or lagged,
 * this is the first place a human would notice. The test also exercises a real
 * group edit and puts it back afterwards.
 *
 *   node e2e_admin_settings_test.mjs
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const ORIGIN = 'http://127.0.0.1:8123';
const TARGET = '1A';
const results = [];

function check(label, passed, detail = '') {
  results.push(passed);
  console.log(`  [${passed ? '通過' : '**失敗**'}] ${label}${detail ? ' — ' + detail : ''}`);
}

async function login(page, id, phone) {
  await page.goto(ORIGIN, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#screen-login:not(.hidden)', { timeout: 20000 });
  await page.fill('#login-participant', id);
  await page.fill('#login-phone', phone);
  await page.click('#login-submit');
}

async function run() {
  const phones = JSON.parse(await readFile('.test-phones.json', 'utf8'));
  const server = spawn('python3', ['-m', 'http.server', '8123', '--bind', '127.0.0.1'], {
    stdio: 'ignore'
  });
  await new Promise(r => setTimeout(r, 1200));

  const browser = await chromium.launch({ channel: 'chrome' });
  const errors = [];
  let originalGroup = '';

  try {
    const page = await browser.newPage();
    page.on('pageerror', e => errors.push(String(e)));

    console.log('管理員參加者管理：');
    await login(page, 'admin', '23082026');
    await page.waitForSelector('#screen-admin:not(.hidden)', { timeout: 30000 });
    await page.click('.bottom-nav-item[data-admin-tab="settings"]');
    await page.waitForSelector('#admin-participants-panel:not(.hidden)', { timeout: 10000 });

    check(
      '有「重置全部參加者投票」掣',
      await page.locator('#admin-bulk-reset-votes').count() === 1
    );
    check(
      '有「刪除全部參加者紀錄」掣',
      await page.locator('#admin-bulk-delete-all').count() === 1
    );

    // Drive the same entry point the combobox uses, without depending on
    // dropdown timing.
    await page.evaluate((id) => {
      const input = document.getElementById('admin-participant-select');
      input.value = id;
      // selectAdminParticipant is module-scoped; click a rendered option instead.
      const event = new Event('focus', { bubbles: true });
      input.dispatchEvent(event);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, TARGET);
    await page.waitForSelector('#admin-participant-dropdown:not(.hidden) [role="option"]', {
      timeout: 10000
    });
    await page.click(`#admin-participant-dropdown [role="option"]`);

    // The detail panel is shown before fetchContact returns, so wait for the
    // phone field itself rather than the empty shell of the panel.
    await page.waitForFunction(
      (expected) => document.getElementById('admin-edit-phone')?.value === expected,
      phones[TARGET],
      { timeout: 20000 }
    );
    check('選中參加者後顯示詳情', true);

    const phoneValue = await page.inputValue('#admin-edit-phone');
    check('管理員可以讀到電話號碼', phoneValue === phones[TARGET], phoneValue || '(空)');

    const phoneReadonly = await page.evaluate(
      () => document.getElementById('admin-edit-phone').readOnly
    );
    check('電話欄位為唯讀', phoneReadonly === true);

    const isSelect = await page.evaluate(
      () => document.getElementById('admin-edit-group')?.tagName === 'SELECT'
    );
    check('分組欄位為下拉選單', isSelect === true);

    const bulkIsSelect = await page.evaluate(
      () => document.getElementById('admin-bulk-group')?.tagName === 'SELECT'
    );
    check('統一分組欄位為下拉選單', bulkIsSelect === true);

    originalGroup = await page.inputValue('#admin-edit-group');
    check('讀到現有分組', !!originalGroup, originalGroup);

    const optionValues = await page.$$eval('#admin-edit-group option', opts =>
      opts.map(o => o.value).filter(Boolean)
    );
    check(
      '分組下拉有標準選項',
      ['GROUP_1', 'GROUP_2', 'GROUP_STAFF'].every(g => optionValues.includes(g)),
      optionValues.slice(0, 8).join(', ')
    );

    const probeGroup = originalGroup === 'GROUP_1' ? 'GROUP_2' : 'GROUP_1';
    await page.selectOption('#admin-edit-group', probeGroup);
    await page.click('#admin-save-participant');
    await page.waitForSelector('.toast', { timeout: 15000 });
    const toast = (await page.textContent('.toast')).trim();
    check('儲存分組成功', toast.includes('分組已更新') || toast.includes('已更新'), toast);

    await page.waitForFunction(
      (expected) => document.getElementById('admin-edit-group')?.value === expected,
      probeGroup,
      { timeout: 15000 }
    );
    check('分組欄位反映新值', true, probeGroup);

    // Put it back so the live roster is not left dirty.
    await page.waitForSelector('#loading-overlay.hidden', { timeout: 10000 }).catch(() => {});
    await page.selectOption('#admin-edit-group', originalGroup);
    await page.click('#admin-save-participant');
    await page.waitForSelector('.toast:has-text("分組已更新")', { timeout: 15000 });
    await page.waitForFunction(
      (expected) => {
        const overlayHidden = document.getElementById('loading-overlay')?.classList.contains('hidden');
        const value = document.getElementById('admin-edit-group')?.value;
        return overlayHidden && value === expected;
      },
      originalGroup,
      { timeout: 20000 }
    );
    check('分組已還原', true, originalGroup);

    const stats = await page.textContent('#admin-participant-stats');
    check('統計卡有內容', /\d/.test(stats || ''), (stats || '').replace(/\s+/g, ' ').slice(0, 80));

    const realErrors = errors.filter(e => !/favicon|404/i.test(e));
    check('冇 JavaScript 錯誤', realErrors.length === 0, realErrors.slice(0, 2).join(' | '));
  } finally {
    // Always put the roster back, even if the UI restore path failed mid-run.
    try {
      const { spawnSync } = await import('node:child_process');
      spawnSync('.venv/bin/python', ['-c', `
import firebase_admin
from firebase_admin import credentials, firestore
try:
    firebase_admin.get_app()
except ValueError:
    firebase_admin.initialize_app(credentials.Certificate(
        "/Users/waiwaichan212/Downloads/tnit-6c48d-firebase-adminsdk-fbsvc-4caec585e5.json"))
db = firestore.client()
db.collection("participants").document("${TARGET}").set(
    {"participant_id": "${TARGET}", "group_id": "GROUP_1"}, merge=True)
print("restored")
`], { cwd: process.cwd(), encoding: 'utf8' });
    } catch (_) { /* best effort */ }
    await browser.close();
    server.kill();
  }

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} 項通過`);
  if (passed !== results.length) process.exitCode = 1;
}

run().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
