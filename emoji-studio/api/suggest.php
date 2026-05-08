<?php
/**
 * EMOJI STUDIO - AI動き提案 API (Phase 3)
 *
 * 受け取った画像を Claude Vision に渡し、
 * 動きのアニメーションを 3 案提案する。
 *
 * Request  : POST application/json
 *   { "image": "data:image/png;base64,....", "mode": "sticker" | "emoji" }
 * Response : application/json
 *   { "suggestions": [
 *       { "preset", "durationMs", "intensity", "fps", "reason" }, x3
 *     ] }
 */

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

/* ---------- 設定読み込み ---------- */
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

/* ---------- 入力 ---------- */
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

/* ---------- プロンプト ---------- */
$prompt = <<<EOT
この画像はLINE「{$modeLabel}」用の1コマです。
画像の被写体（キャラクター・表情・ポーズ・小物など）を読み取り、
表現にマッチするアニメーションの動きを **ちょうど3案** 提案してください。

利用可能なプリセット:
- bounce  : 上下にぴょこぴょこ跳ねる
- shake   : 小刻みに震える
- pulse   : 拍動するように軽く拡縮
- rotate  : 一定方向にくるくる回転
- fade    : 透明度の明滅
- slide-x : 左右にスライド
- zoom    : ズームイン/アウトを繰り返す

各案は次のJSONフォーマットで返してください。**JSON以外の文字は一切出力しないでください**。

{
  "suggestions": [
    {
      "preset": "<上記プリセット名>",
      "durationMs": <200..3000の整数。1サイクルの長さ>,
      "intensity": <20..200の整数。標準は100>,
      "fps": <6..30の整数。標準は12>,
      "reason": "<日本語40字以内で、なぜこの動きが合うか>"
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

/* JSON 部分のみ取り出し（前後の余計な文字対策） */
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

/* ---------- バリデーション/正規化 ---------- */
$ALLOWED = ['bounce', 'shake', 'pulse', 'rotate', 'fade', 'slide-x', 'zoom'];
$out     = [];
foreach ($parsed['suggestions'] as $s) {
    if (!is_array($s)) continue;
    $preset = in_array($s['preset'] ?? '', $ALLOWED, true) ? $s['preset'] : 'bounce';
    $dur    = max(200, min(3000, (int)($s['durationMs'] ?? 800)));
    $inten  = max(20, min(200, (int)($s['intensity'] ?? 100)));
    $fps    = max(6, min(30, (int)($s['fps'] ?? 12)));
    $reason = (string)($s['reason'] ?? '');
    if (function_exists('mb_substr')) {
        $reason = mb_substr($reason, 0, 80);
    } else {
        $reason = substr($reason, 0, 240);
    }
    $out[] = [
        'preset'     => $preset,
        'durationMs' => $dur,
        'intensity'  => $inten,
        'fps'        => $fps,
        'reason'     => $reason,
    ];
    if (count($out) >= 3) break;
}

if (count($out) === 0) {
    http_response_code(502);
    echo json_encode(['error' => 'empty_suggestions']);
    exit;
}

echo json_encode(['suggestions' => $out], JSON_UNESCAPED_UNICODE);
