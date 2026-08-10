import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const projectRoot = path.resolve(appRoot, '..');

function git(args) {
  const result = spawnSync('git', args, { cwd: projectRoot, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  return result.stdout;
}

const errors = [];
const tracked = git(['-c', 'core.quotePath=false', 'ls-files', '-z']).split('\0').filter(Boolean);
const prohibited = [
  /^data\/(?!README\.md$)/,
  /^tools\/runtime\//,
  /^archive\/(?!README\.md$)/,
  /^assets\/stage-maps\/images\/(?!\.gitkeep$)/,
  /^app\/src\/weapon-catalog\.json$/,
  /(^|\/)node_modules\//,
  /(^|\/)\.env(?:\.|$)/,
  /\.(?:mp4|mov|mkv|avi|webm)$/i,
];

for (const file of tracked) {
  if (prohibited.some(pattern => pattern.test(file))) errors.push(`公開対象外ファイルが追跡されています: ${file}`);
  const absolute = path.join(projectRoot, file);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue;
  const size = fs.statSync(absolute).size;
  if (size > 5 * 1024 * 1024) errors.push(`5MBを超える追跡ファイルです: ${file}`);
  if (size > 2 * 1024 * 1024 || /\.(?:webp|png|jpe?g|gif|ico)$/i.test(file)) continue;
  const text = fs.readFileSync(absolute, 'utf8');
  const secretPatterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}\b/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bsk-[A-Za-z0-9_-]{24,}\b/,
    /OPENAI_API_KEY\s*[=:]\s*['"]?[A-Za-z0-9_-]{16,}/,
  ];
  if (secretPatterns.some(pattern => pattern.test(text))) errors.push(`秘密情報らしき文字列があります: ${file}`);
}

// Codex keeps tree-only refs for local work snapshots. They are not part of a
// normal branch/tag push, so audit only refs that can be published as history.
const publishableRefs = ['--branches', '--tags', '--remotes'];
const historyPaths = git(['rev-list', '--objects', ...publishableRefs]);
for (const forbidden of ['src/weapon-catalog.json', 'app/src/weapon-catalog.json']) {
  if (historyPaths.split(/\r?\n/).some(line => line.endsWith(` ${forbidden}`))) {
    errors.push(`第三者生成物がGit履歴に残っています: ${forbidden}`);
  }
}

const authorEmails = git(['log', ...publishableRefs, '--format=%ae%n%ce']).split(/\r?\n/).filter(Boolean);
for (const email of new Set(authorEmails)) {
  if (/@(?:gmail|googlemail|yahoo|outlook|hotmail|icloud)\./i.test(email)) {
    errors.push(`個人メールアドレスがGit履歴に残っています: ${email.replace(/^[^@]+/, '***')}`);
  }
}

for (const required of ['LICENSE', 'README.md', 'SECURITY.md', 'THIRD_PARTY_NOTICES.md']) {
  if (!tracked.includes(required)) errors.push(`公開に必要なファイルが未追跡です: ${required}`);
}

if (errors.length) {
  console.error('公開前チェックに失敗しました:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`OK: ${tracked.length} tracked files; public-release checks passed`);
