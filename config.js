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
    // ---- 文章：Gemini作成（2026/10/06）→ Claudeで文字数・仕様に合わせ微調整 ----
    startLead: '東京タワーをカメラにかざすと、<br>冬の特別な仲間たちに会えるかも。',
    startButton: 'まほうのカメラを開く',
    startNote: 'カメラ・位置情報・センサーの利用を許可してください。<br>位置情報はタワーの方角を探すためだけに使用します。',
    hintSearch: '東京タワーをカメラでのぞいてみてください',
    hintTurnLeft: 'もう少し左をのぞいてみて',
    hintTurnRight: 'もう少し右をのぞいてみて',
    hintUp: 'もっと上を見上げてみて',
    hintDown: 'もう少しカメラを下げてみて',
    hintAlmost: 'あと少し……見つかりそうです！',
    hintFound: '見つけた！冬の仲間と一緒に写真を撮ろう',
    hintFar: '会場の芝公園で東京タワーを映してみてね',
    hintNoSensor: '画面の色を頼りに仲間たちを探してみてね',
    toastFound: 'あらわれました！好きな角度で撮影できます',
    resultSaveNote: '画像を長押しするとスマートフォンに保存できます',
    consentLabel: '写真のLINEトークへの送信と、主催者による一定期間の保管に同意します',
    sendButton: 'LINEに送る',
    shareButton: 'シェア・保存する',
    retakeButton: 'もう一度撮る',
    sendOk: 'LINEに写真を届けました！',
    sendNeedFriend: '公式アカウントを友だち追加して写真を受け取ろう',
    sendNeedConsent: '同意にチェックを入れて進んでね',
    shareFallback: '画像を長押しして「写真に追加」を選んでね',
    toastSelfie: '自撮りモード：仲間たちと一緒に写ろう',
    toastBack: '通常カメラにもどりました'
  }
};
