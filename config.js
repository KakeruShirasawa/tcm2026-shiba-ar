/* =========================================================
 * TCM 2026 芝公園 ARフォトフレーム — 設定ファイル
 * 本番/テストの切替や各種IDはここだけを書き換えます。
 * ========================================================= */
window.TCM_CONFIG = {
  // 'test' | 'production'
  ENV: 'test',

  // LINE Developers で発行した LIFF ID（未設定ならLINE外の通常ブラウザとして動作）
  LIFF_ID: '',

  // GAS Webアプリ（/exec）のURL（未設定ならログ送信・写真送信は行わない）
  GAS_URL: '',

  // TCM LINE公式アカウントの友だち追加URL（例: https://lin.ee/xxxxx）
  OA_ADD_FRIEND_URL: '',

  // 東京タワー（メインデッキ中心付近）
  TOWER: { lat: 35.658581, lng: 139.745433, height: 333 },

  // GPSが取れない時に使う基準地点（芝公園会場付近・要現地確認）
  FALLBACK_POS: { lat: 35.6595, lng: 139.7500 },

  // 判定パラメータ
  DETECT: {
    headingTolerance: 28,   // 方位の許容誤差（度）
    elevMargin: 10,         // 仰角の許容マージン（度）
    holdSeconds: 0.9,       // この秒数かざし続けると出現
    maxDistance: 12000,     // これ以上離れていたら案内表示（m）
    colorWeight: 0.25       // 画像（色）判定の重み 0〜1
  },

  // 文言（Geminiで最終化した文章をここに差し替え）
  COPY: {
    hintSearch: '東京タワーの方へスマホを向けてね',
    hintTurnLeft: 'もう少し左かな…',
    hintTurnRight: 'もう少し右かな…',
    hintUp: 'タワーのてっぺんを見上げて！',
    hintDown: 'ちょっと下げてみて',
    hintAlmost: 'みつかりそう…！',
    hintFound: 'みつけた！ 一緒に写真を撮ろう',
    hintFar: '芝公園の会場で東京タワーをさがしてね',
    hintNoSensor: 'センサーが使えないため、画面のタワーの色で判定します',
    toastFound: '✨ 森の仲間たちがあらわれた！',
    sendOk: 'LINEのトークに写真を送りました！',
    sendNeedFriend: '公式アカウントを友だち追加すると写真が届きます',
    sendNeedConsent: '送信するにはチェックを入れてください',
    shareFallback: '画像を長押しして保存してね'
  }
};
