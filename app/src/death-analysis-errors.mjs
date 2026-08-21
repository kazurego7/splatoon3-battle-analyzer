export function deathAnalysisFailure(error) {
  const detail = String(error?.codexDetail || error?.message || '').trim();
  if (error?.code === 'CODEX_AUTH') return {
    error: 'Codexへログインしていないため、AI分析を開始できませんでした。',
    guidance: 'ChatGPTアカウントでCodexへログインしてから「分析を再開する」を押してください。', retryable: true,
  };
  if (error?.code === 'CODEX_LIMIT') return {
    error: 'Codexから利用上限またはリクエスト上限のエラーが返されました。',
    guidance: 'ChatGPTの利用上限が回復してから「分析を再開する」を押してください。完成済みのデス分析は保持されています。', retryable: true,
  };
  if (error?.code === 'CODEX_NETWORK') return {
    error: 'Codexから通信エラーが返されました。',
    guidance: 'インターネット接続を確認して「分析を再開する」を押してください。完成済みの結果から続行します。', retryable: true,
  };
  if (error?.code === 'CODEX_INVALID_OUTPUT') return {
    error: 'Codexの分析結果を正しく読み取れませんでした。',
    guidance: '「分析を再開する」を押してください。繰り返す場合はCodexを更新してから再実行してください。', retryable: true,
  };
  if (error?.code === 'CODEX_LAUNCH') return {
    error: 'Codexを起動できませんでした。',
    guidance: 'アプリを再起動してから「分析を再開する」を押してください。', retryable: true,
  };
  if (error?.code === 'CODEX_TIMEOUT') return {
    error: '設定された待ち時間に達したため、Codex分析を停止しました。',
    guidance: '固定タイムアウトは既定で無効です。CODEX_DEATH_TIMEOUT_MSを設定している場合は解除してから再実行してください。', retryable: true,
  };
  return {
    error: `Codexから分析エラーが返されました${detail ? `: ${detail.slice(0, 500)}` : '。'}`,
    guidance: '「分析を再開する」を押してください。完成済みの結果がある場合はそこから続行します。', retryable: true,
  };
}
