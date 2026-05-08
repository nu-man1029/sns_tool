# GitHub Actions Workflows

## deploy-emoji-studio.yml

`emoji-studio/` 配下のファイルが `main` ブランチに push されたときに、さくらインターネットの FTP サーバーへ自動デプロイします。手動実行（workflow_dispatch）にも対応しています。

### 必要な GitHub Secrets

リポジトリの **Settings → Secrets and variables → Actions → New repository secret** から以下の3つを登録してください。

| Secret 名 | 値 |
| --- | --- |
| `FTP_SERVER` | `censin.sakura.ne.jp` |
| `FTP_USERNAME` | `rs-kensin` |
| `FTP_PASSWORD` | （FTP パスワード） |

### デプロイ先

```
/home/rs-kensin/www/tools/emoji-studio/
```

ローカルの `emoji-studio/` ディレクトリ配下のファイルがそのままミラーリングされます。`.git*`, `node_modules`, `.DS_Store`, `Thumbs.db` は除外されます。

### 動作

- 差分のあるファイルのみ転送（`.ftp-deploy-sync-state.json` をサーバー側に保持）
- `dangerous-clean-slate: false` のため、サーバー側にだけ存在するファイルは削除されません。完全同期したい場合は `true` に変更してください。

### 手動実行

GitHub の **Actions** タブから `Deploy emoji-studio via FTP` を選択し、`Run workflow` を押すと任意のブランチからデプロイできます。
