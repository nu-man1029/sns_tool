<?php
/**
 * EMOJI STUDIO - APIキー / 設定
 *
 * このファイルを config.php にコピーして実APIキーを設定してください。
 *   cp config.example.php config.php
 * config.php は .gitignore 対象なのでコミットされません。
 */

// Claude API
define('CLAUDE_API_KEY', 'your-api-key-here');
define('CLAUDE_MODEL',   'claude-sonnet-4-6');
define('CLAUDE_API_URL', 'https://api.anthropic.com/v1/messages');

// データ保存ディレクトリ (絶対パス)
define('DATA_DIR',    __DIR__ . '/../data');
define('UPLOAD_DIR',  __DIR__ . '/../uploads');

// さくら共通: エラー表示OFF (Phase 1 から徹底)
@ini_set('display_errors', '0');
error_reporting(0);
