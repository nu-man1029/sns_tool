<?php
/**
 * EMOJI STUDIO - AI動き提案 API
 *
 * Phase 3 + 後続Update: 既存パターン選択ではなく、
 * 画像を見た「動きの方向性アドバイス（クリエイティブ提案文）」を 3 案返す。
 * ユーザーは読んで自分でパラメータを調整する。
 *
 * Request  : POST application/json
 *   {
 *     "image":       "data:image/png;base64,....",
 *     "mode":        "sticker" | "emoji",
 *     "instruction": "（任意）追加指示。例: 指だけを動かしたい"
 *   }
 * Response : application/json
 *   { "suggestions": [
 *       { "title", "description", "hint" }, x3
 *     ] }
 */

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$configPath = __DIR__ . '/config.php';
if (!is_file($configPath)) {
    http_response_code(500);
    echo json_encode(['error' => 'config_missing', 'message' => 'api/config.php が未設定です']);
    exit;
}
require_once $configPath;

if (!defined('CLAUDE_API_KEY') || CLAUDE_API_KEY === '' || CLAUDE_API_KEY === 'your-api-key-here') {
    http_response_code(500);
    echo json_encode(['error' => 'api_key_missing', 'message' => 'CLAUDE_API_KEY が設定されていません']);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'method_not_allowed']);
    exit;
}

$raw = file_get_contents('php://input');
$input = json_decode($raw, true);
if (!is_array($input) || empty($input['image'])) {
    http_response_code(400);
    echo json_encode(['error' => 'image_required']);
    exit;
}

$image = (string)$input['image'];
if (!preg_match('#^data:image/(png|jpeg|jpg|webp|gif);base64,(.+)$#', $image, $m)) {
    http_response_code(400);
    echo json_encode(['error' => 'invalid_image_format']);
    exit;
}
$mediaType = 'image/' . ($m[1] === 'jpg' ? 'jpeg' : $m[1]);
$base64    = $m[2];

if (strlen($base64) > 7 * 1024 * 1024) {
    http_response_code(413);
    echo json_encode(['error' => 'image_too_large']);
    exit;
}

$mode      = ($input['mode'] ?? 'sticker') === 'emoji' ? 'emoji' : 'sticker';
$modeLabel = $mode === 'emoji' ? 'アニメーション絵文字 (240x240)' : 'アニメーションスタンプ (320x270)';

/* 追加指示 (任意) */
$instruction = '';
if (isset($input['instruction']) && is_string($input['instruction'])) {
    $instruction = trim($input['instruction']);
    if (function_exists('mb_substr')) {
        $instruction = mb_substr($instruction, 0, 200);
    } else {
        $instruction = substr($instruction, 0, 600);
    }
}

/* ---------- プロンプト ---------- */
$instructionBlock = $instruction === ''
    ? ''
    : "\n\n【ユーザーからの追加指示】\n{$instruction}\n（この指示を最優先で反映してください）";

$prompt = <<<EOT
この画像はLINE「{$modeLabel}」用の1コマです。
画像の被写体（キャラクター・表情・ポーズ・小物・色味など）を読み取り、
**動きの方向性（クリエイティブな演出方針）を3案** 提案してください。

ユーザーは LINE 申請に向け、自分でパラメータ（プリセット種別 / 再生時間 /
強度 / fps）を調整します。あなたの仕事は「どの部位をどう動かすと表情が活きるか」
「どんなテンポやニュアンスが似合うか」を、人間が読んで参考にできる文章で示すことです。

利用できるパラメータの参考:
- プリセット: なし / バウンス / シェイク / パルス / 回転 / フェード / 横スライド / ズーム
- 再生時間: 200〜3000 ms (1サイクル)
- 強度: 20〜200 % (標準100)
- fps: 6〜30 (標準12){$instructionBlock}

出力は次のJSONのみ。**JSON以外は一切出力しないでください**。

{
  "suggestions": [
    {
      "title": "<10〜16字の見出し。例：指だけリズミカルに>",
      "description": "<60〜120字。なぜその動きが画像に合うか・どこをどう動かすか・狙う印象>",
      "hint": "<30字以内のパラメータ目安。例：シェイク 600ms / 強度60% / 18fps>"
    },
    { ... },
    { ... }
  ]
}
EOT;

$payload = [
    'model'      => CLAUDE_MODEL,
    'max_tokens' => 1024,
    'messages'   => [[
        'role'    => 'user',
        'content' => [
            [
                'type'   => 'image',
                'source' => [
                    'type'       => 'base64',
                    'media_type' => $mediaType,
                    'data'       => $base64,
                ],
            ],
            ['type' => 'text', 'text' => $prompt],
        ],
    ]],
];

/* ---------- Claude API 呼び出し ---------- */
$ch = curl_init(CLAUDE_API_URL);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => json_encode($payload, JSON_UNESCAPED_UNICODE),
    CURLOPT_HTTPHEADER     => [
        'x-api-key: ' . CLAUDE_API_KEY,
        'anthropic-version: 2023-06-01',
        'content-type: application/json',
    ],
    CURLOPT_TIMEOUT        => 60,
    CURLOPT_CONNECTTIMEOUT => 10,
]);
$res      = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlErr  = curl_error($ch);
curl_close($ch);

if ($res === false) {
    http_response_code(502);
    echo json_encode(['error' => 'upstream_failed', 'detail' => $curlErr]);
    exit;
}
if ($httpCode >= 400) {
    http_response_code(502);
    $upstream = json_decode($res, true);
    echo json_encode([
        'error'    => 'upstream_status',
        'status'   => $httpCode,
        'upstream' => $upstream ?: $res,
    ]);
    exit;
}

/* ---------- 応答テキスト抽出 ---------- */
$decoded = json_decode($res, true);
$text    = '';
if (isset($decoded['content']) && is_array($decoded['content'])) {
    foreach ($decoded['content'] as $block) {
        if (($block['type'] ?? '') === 'text') {
            $text .= $block['text'];
        }
    }
}

if (!preg_match('/\{[\s\S]*\}/', $text, $jm)) {
    http_response_code(502);
    echo json_encode(['error' => 'no_json_in_response', 'raw' => $text]);
    exit;
}
$parsed = json_decode($jm[0], true);
if (!is_array($parsed) || empty($parsed['suggestions']) || !is_array($parsed['suggestions'])) {
    http_response_code(502);
    echo json_encode(['error' => 'invalid_json', 'raw' => $text]);
    exit;
}

/* ---------- 正規化 ---------- */
function clamp_str($s, int $max): string {
    $s = (string)$s;
    if (function_exists('mb_substr')) return mb_substr($s, 0, $max);
    return substr($s, 0, $max * 3);
}

$out = [];
foreach ($parsed['suggestions'] as $s) {
    if (!is_array($s)) continue;
    $title = clamp_str($s['title']       ?? '', 40);
    $desc  = clamp_str($s['description'] ?? '', 200);
    $hint  = clamp_str($s['hint']        ?? '', 80);
    if ($title === '' && $desc === '') continue;
    $out[] = [
        'title'       => $title,
        'description' => $desc,
        'hint'        => $hint,
    ];
    if (count($out) >= 3) break;
}

if (count($out) === 0) {
    http_response_code(502);
    echo json_encode(['error' => 'empty_suggestions']);
    exit;
}

echo json_encode(['suggestions' => $out], JSON_UNESCAPED_UNICODE);
