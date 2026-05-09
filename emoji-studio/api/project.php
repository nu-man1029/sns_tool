<?php
/**
 * EMOJI STUDIO - Phase 5: プロジェクト保存/復元 API
 *
 * Endpoints:
 *   POST /api/project.php?action=new
 *     -> { id, savedAt }
 *   GET  /api/project.php?id=XXXXXXXXXX
 *     -> { id, data, savedAt }
 *   POST /api/project.php?id=XXXXXXXXXX  (PUT も可)
 *     リクエストボディ: { mode, slots, ... }
 *     -> { id, savedAt }
 *
 * 保存先: DATA_DIR/{id}.json
 * data/ ディレクトリは .htaccess で外部アクセス禁止 → PHP 経由でのみ読み書き
 */

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$configPath = __DIR__ . '/config.php';
if (!is_file($configPath)) {
    http_response_code(500);
    echo json_encode(['error' => 'config_missing']);
    exit;
}
require_once $configPath;

$dataDir = DATA_DIR;
if (!is_dir($dataDir)) {
    if (!@mkdir($dataDir, 0755, true)) {
        http_response_code(500);
        echo json_encode(['error' => 'cannot_create_data_dir']);
        exit;
    }
}

/* ---------- ヘルパ ---------- */
function ok(array $data): void {
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}
function fail(int $code, string $msg, array $extra = []): void {
    http_response_code($code);
    echo json_encode(array_merge(['error' => $msg], $extra));
    exit;
}

/** 紛らわしい文字 (0/O, 1/I/L) を除いた 10 桁の ID を生成 */
function generateProjectId(): string {
    $chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    $len = strlen($chars);
    $id  = '';
    for ($i = 0; $i < 10; $i++) {
        $id .= $chars[random_int(0, $len - 1)];
    }
    return $id;
}

function isValidId($id): bool {
    return is_string($id) && (bool)preg_match('/^[A-Z0-9]{8,12}$/', $id);
}

function projectPath(string $dataDir, string $id): string {
    return $dataDir . '/' . $id . '.json';
}

/* ---------- ルーティング ---------- */
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = $_GET['action'] ?? '';
$id     = $_GET['id'] ?? '';

/* === 新規作成 === */
if ($method === 'POST' && $action === 'new') {
    // 衝突対策: 5回まで再生成
    for ($try = 0; $try < 5; $try++) {
        $newId = generateProjectId();
        $path  = projectPath($dataDir, $newId);
        if (!file_exists($path)) break;
        if ($try === 4) fail(500, 'id_collision');
    }
    $now = time();
    $payload = [
        'id'        => $newId,
        'createdAt' => $now,
        'savedAt'   => $now,
        'mode'      => null,
        'slots'     => [],
    ];
    if (!@file_put_contents($path, json_encode($payload, JSON_UNESCAPED_UNICODE), LOCK_EX)) {
        fail(500, 'write_failed');
    }
    ok(['id' => $newId, 'savedAt' => $now]);
}

/* === 復元 === */
if ($method === 'GET' && isValidId($id)) {
    $path = projectPath($dataDir, $id);
    if (!file_exists($path)) fail(404, 'project_not_found');
    $raw = @file_get_contents($path);
    if ($raw === false) fail(500, 'read_failed');
    $data = json_decode($raw, true);
    if (!is_array($data)) fail(500, 'corrupt_data');
    ok([
        'id'      => $id,
        'data'    => $data,
        'savedAt' => @filemtime($path) ?: 0,
    ]);
}

/* === 上書き保存 === */
if (($method === 'POST' || $method === 'PUT') && isValidId($id)) {
    $raw = file_get_contents('php://input');
    if ($raw === false) fail(400, 'no_body');
    if (strlen($raw) > 60 * 1024 * 1024) fail(413, 'payload_too_large');

    $body = json_decode($raw, true);
    if (!is_array($body)) fail(400, 'invalid_json');

    $path = projectPath($dataDir, $id);
    if (!file_exists($path)) fail(404, 'project_not_found');

    $body['id']      = $id;
    $body['savedAt'] = time();
    if (!isset($body['createdAt'])) {
        $existing = json_decode(@file_get_contents($path), true) ?: [];
        $body['createdAt'] = $existing['createdAt'] ?? time();
    }

    $tmp = $path . '.tmp.' . bin2hex(random_bytes(4));
    $written = @file_put_contents(
        $tmp,
        json_encode($body, JSON_UNESCAPED_UNICODE),
        LOCK_EX
    );
    if ($written === false) fail(500, 'write_failed');
    if (!@rename($tmp, $path)) {
        @unlink($tmp);
        fail(500, 'rename_failed');
    }

    ok(['id' => $id, 'savedAt' => $body['savedAt']]);
}

fail(400, 'bad_request');
