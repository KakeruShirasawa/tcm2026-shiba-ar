/**
 * TCM 2026 芝公園 ARフォトフレーム — GASバックエンド
 *
 * 役割
 *  1. 利用ログ集計（open / start / found / capture / share…）→ スプレッドシート
 *  2. 撮影写真の保存（利用者の同意がある場合のみ）→ Googleドライブ
 *  3. LINE公式アカウント連携：保存した写真＋メッセージを本人のトークへプッシュ
 *
 * 初回のみ：エディタで setup() を実行 → スクリプトプロパティに LINE の値を設定 → ウェブアプリとしてデプロイ
 *
 * スクリプトプロパティ
 *  LINE_CHANNEL_ACCESS_TOKEN  : Messaging APIチャネル（TCM公式アカウント）の長期アクセストークン
 *  LINE_LOGIN_CHANNEL_ID      : LIFFを作成したLINEログインチャネルのチャネルID（IDトークン検証用）
 *  PUSH_MESSAGE               : 写真と一緒に送る文言（任意。改行可）
 *  SPREADSHEET_ID / PHOTO_FOLDER_ID : setup() が自動設定
 *  PHOTO_RETENTION_DAYS       : 写真の保存日数（既定 60）
 */

const PROPS = PropertiesService.getScriptProperties();
const LOG_HEADERS = ['timestamp', 'env', 'event', 'sessionId', 'inClient', 'lat', 'lng', 'detail', 'ua'];
const PHOTO_HEADERS = ['timestamp', 'env', 'sessionId', 'userHash', 'fileId', 'imageUrl', 'pushed', 'error'];

/* ---------------- 初期セットアップ ---------------- */
function setup() {
  let ssId = PROPS.getProperty('SPREADSHEET_ID');
  if (!ssId) {
    const ss = SpreadsheetApp.create('TCM2026_芝公園_ARフォト_集計');
    ssId = ss.getId();
    PROPS.setProperty('SPREADSHEET_ID', ssId);
  }
  const ss = SpreadsheetApp.openById(ssId);
  const logs = ensureSheet_(ss, 'logs', LOG_HEADERS);
  ensureSheet_(ss, 'photos', PHOTO_HEADERS);
  const sum = ensureSheet_(ss, 'summary', []);
  sum.clear();
  sum.getRange('A1').setValue('イベント別 件数（本番のみ）');
  sum.getRange('A2').setFormula("=QUERY(logs!A2:I,\"select C, count(C) where B='production' and C<>'' group by C label C 'event', count(C) '件数'\",0)");
  sum.getRange('D1').setValue('日別×イベント（本番のみ）');
  sum.getRange('D2').setFormula("=QUERY({ARRAYFORMULA(IF(logs!A2:A=\"\",,INT(logs!A2:A))),logs!B2:C},\"select Col1, count(Col3) where Col2='production' and Col3<>'' group by Col1 pivot Col3 label Col1 '日付'\",0)");
  sum.getRange('D3:D').setNumberFormat('yyyy/mm/dd');
  sum.getRange('A20').setValue('ユニーク利用（本番・session数）');
  sum.getRange('A21').setFormula("=COUNTUNIQUE(FILTER(logs!D2:D, logs!B2:B=\"production\"))");
  ss.getSheets().forEach(s => { if (s.getName() === 'シート1' || s.getName() === 'Sheet1') ss.deleteSheet(s); });
  logs.setFrozenRows(1);

  if (!PROPS.getProperty('PHOTO_FOLDER_ID')) {
    const folder = DriveApp.createFolder('TCM2026_芝公園_ARフォト_写真');
    PROPS.setProperty('PHOTO_FOLDER_ID', folder.getId());
  }
  if (!PROPS.getProperty('PUSH_MESSAGE')) {
    PROPS.setProperty('PUSH_MESSAGE', '東京クリスマスマーケット2026 in 芝公園\nARフォトの写真をお届けします🎄\n画像を長押しで保存できます。');
  }
  Logger.log('Spreadsheet: https://docs.google.com/spreadsheets/d/' + ssId);
  Logger.log('Photo folder: https://drive.google.com/drive/folders/' + PROPS.getProperty('PHOTO_FOLDER_ID'));
}

function ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (headers.length && sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  }
  return sh;
}

/* ---------------- エンドポイント ---------------- */
function doGet() {
  return json_({ ok: true, service: 'tcm2026-ar', time: new Date().toISOString() });
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad_json' }); }
  try {
    if (body.action === 'log') return json_(handleLog_(body));
    if (body.action === 'upload') return json_(handleUpload_(body));
    return json_({ ok: false, error: 'unknown_action' });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: String(err.message || err) });
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------------- 1. ログ ---------------- */
const ALLOWED_EVENTS = ['open', 'start', 'found', 'capture', 'share_tap', 'share_done', 'camera_error', 'send', 'flip'];
function handleLog_(b) {
  if (ALLOWED_EVENTS.indexOf(b.event) < 0) return { ok: false, error: 'bad_event' };
  const detail = {};
  ['dist', 'viaSensor', 'color', 'pose', 'via', 'motionOk', 'msg'].forEach(k => { if (b[k] !== undefined) detail[k] = b[k]; });
  appendRow_('logs', [
    new Date(), s_(b.env, 12), b.event, s_(b.sessionId, 40), !!b.inClient,
    num_(b.lat), num_(b.lng), JSON.stringify(detail), s_(b.ua, 180)
  ]);
  return { ok: true };
}

/* ---------------- 2&3. 写真保存＋LINE送信 ---------------- */
function handleUpload_(b) {
  if (!b.idToken) return { ok: false, error: 'no_token' };
  if (!b.image || b.image.length > 9 * 1024 * 1024) return { ok: false, error: 'bad_image' };

  const userId = verifyIdToken_(b.idToken); // なりすまし防止：LINEでIDトークンを検証
  const userHash = Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, userId)).slice(0, 22);

  const folder = dayFolder_();
  const name = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd_HHmmss') + '_' + userHash.slice(0, 8) + '.jpg';
  const blob = Utilities.newBlob(Utilities.base64Decode(b.image), 'image/jpeg', name);
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const imageUrl = 'https://lh3.googleusercontent.com/d/' + file.getId();

  let pushed = false, error = '';
  try { pushToLine_(userId, imageUrl); pushed = true; }
  catch (err) { error = String(err.message || err).slice(0, 300); }

  appendRow_('photos', [new Date(), s_(b.env, 12), s_(b.sessionId, 40), userHash, file.getId(), imageUrl, pushed, error]);
  appendRow_('logs', [new Date(), s_(b.env, 12), 'send', s_(b.sessionId, 40), true, '', '', JSON.stringify({ pushed }), '']);
  return pushed ? { ok: true, imageUrl } : { ok: false, error: 'push_failed', imageUrl };
}

function verifyIdToken_(idToken) {
  const clientId = PROPS.getProperty('LINE_LOGIN_CHANNEL_ID');
  if (!clientId) throw new Error('LINE_LOGIN_CHANNEL_ID 未設定');
  const res = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'post', payload: { id_token: idToken, client_id: clientId }, muteHttpExceptions: true
  });
  const j = JSON.parse(res.getContentText());
  if (res.getResponseCode() !== 200 || !j.sub) throw new Error('invalid_id_token');
  return j.sub;
}

function pushToLine_(userId, imageUrl) {
  const token = PROPS.getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN 未設定');
  const messages = [{ type: 'image', originalContentUrl: imageUrl, previewImageUrl: imageUrl }];
  const text = PROPS.getProperty('PUSH_MESSAGE');
  if (text) messages.push({ type: 'text', text: text });
  const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token, 'X-Line-Retry-Key': Utilities.getUuid() },
    payload: JSON.stringify({ to: userId, messages: messages })
  });
  if (res.getResponseCode() !== 200) throw new Error('push ' + res.getResponseCode() + ' ' + res.getContentText());
}

/* ---------------- 保守 ---------------- */
// 時間主導トリガー（1日1回）で実行：保存期限を過ぎた写真をゴミ箱へ
function purgeOldPhotos() {
  const days = Number(PROPS.getProperty('PHOTO_RETENTION_DAYS') || 60);
  const limit = new Date(Date.now() - days * 864e5);
  const root = DriveApp.getFolderById(PROPS.getProperty('PHOTO_FOLDER_ID'));
  const it = root.getFolders();
  while (it.hasNext()) {
    const f = it.next();
    if (f.getDateCreated() < limit) f.setTrashed(true);
  }
}
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('purgeOldPhotos').timeBased().everyDays(1).atHour(4).create();
}

/* ---------------- helpers ---------------- */
function dayFolder_() {
  const root = DriveApp.getFolderById(PROPS.getProperty('PHOTO_FOLDER_ID'));
  const name = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  const it = root.getFoldersByName(name);
  return it.hasNext() ? it.next() : root.createFolder(name);
}
function appendRow_(sheet, row) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { SpreadsheetApp.openById(PROPS.getProperty('SPREADSHEET_ID')).getSheetByName(sheet).appendRow(row); }
  finally { lock.releaseLock(); }
}
function s_(v, n) { return v == null ? '' : String(v).slice(0, n); }
function num_(v) { return typeof v === 'number' && isFinite(v) ? v : ''; }
