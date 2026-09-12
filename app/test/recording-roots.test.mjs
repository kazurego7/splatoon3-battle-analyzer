import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { obsRecordingRootFromProfile } from '../src/recording-roots.mjs';

test('OBS詳細出力の録画先をプロファイルから読み取る', () => {
  const root = obsRecordingRootFromProfile([
    '[Output]',
    'Mode=Advanced',
    '[SimpleOutput]',
    'FilePath=C:\\\\Simple',
    '[AdvOut]',
    'RecFilePath=C:\\\\Users\\\\kazur\\\\Videos',
  ].join('\n'));
  assert.equal(root, path.resolve('C:\\Users\\kazur\\Videos'));
});

test('OBS基本出力ではSimpleOutputの録画先を使う', () => {
  const root = obsRecordingRootFromProfile([
    '[Output]',
    'Mode=Simple',
    '[SimpleOutput]',
    'FilePath=D:\\\\Capture',
  ].join('\n'));
  assert.equal(root, path.resolve('D:\\Capture'));
});
