# TCM2026 芝公園 ARフォトフレーム（LINEミニアプリ / LIFF）

東京タワーにスマホを向けると、妖精（空を飛ぶ）とトナカイ（地面寄り）が現れ、
「TOKYO CHRISTMAS MARKET 2026 in 芝公園」フレームで撮影できるWebアプリ。

## 構成
| パス | 役割 |
|---|---|
| `site/` | GitHub Pages で公開する本体（index.html / app.js / style.css / config.js / キャラ画像） |
| `gas/` | Google Apps Script（ログ集計・写真保存・LINEへ写真送信） |

## 東京タワー検知のしくみ
1. GPSで現在地 → 東京タワーの方位・仰角を計算
2. 方位センサー/傾きセンサーでカメラの向きを取得し、タワー方向±約14°・仰角範囲内なら加点
3. カメラ映像上部の「タワーらしい暖色（赤・橙）」の割合で補助判定（重み25%）
4. 約0.9秒かざし続けると出現。以後は向きに合わせてキャラが追従（疑似AR）
- センサーが無い端末は色判定のみ。テスト環境では「テスト：出現させる」ボタンあり
- `?debug=1` を付けるとセンサー値を画面表示

## テスト → 本番の流れ
1. **テスト**：`config.js` の `ENV: 'test'` のまま GitHub Pages URL で確認
2. **LINE**：LINE Developers で TCM公式アカウントと同じプロバイダーに「LINEログインチャネル」を作成
   - LIFFアプリ追加：サイズ Full / エンドポイントURL＝公開URL / スコープ `openid` `profile` / 友だち追加オプション On(Aggressive)
   - 発行された LIFF ID を `config.js` の `LIFF_ID` に設定
3. **GAS**：`gas/` を新規プロジェクトに貼付 → `setup()` 実行 → スクリプトプロパティ設定
   - `LINE_CHANNEL_ACCESS_TOKEN`（Messaging APIチャネルの長期トークン）
   - `LINE_LOGIN_CHANNEL_ID`（LIFFを作ったLINEログインチャネルのID）
   - ウェブアプリとしてデプロイ（実行ユーザー：自分 / アクセス：全員）→ `/exec` URL を `config.js` の `GAS_URL` に
   - `installTriggers()` を1回実行（写真の自動削除：既定60日）
4. **本番**：`ENV: 'production'` に変更、独自ドメイン取得後に Pages の Custom domain 設定 → LIFFのエンドポイントURLも更新

## 注意
- 写真のLINE送信は Messaging API のプッシュ通知を使うため、公式アカウントの月間メッセージ通数を消費します（1回=1通）。
- 写真保存は利用者が同意チェックした場合のみ。Driveの写真は「リンクを知っている全員が閲覧可」になります（LINEへ画像を届けるため）。
- 位置情報は約100m単位に丸めてログ化。端末のユーザーIDはハッシュ化して記録。
