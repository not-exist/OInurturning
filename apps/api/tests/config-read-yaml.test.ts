import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readYaml } from '../src/config/read-yaml.js';

// ---------------------------------------------------------------------------
// 临时目录（沿用 config-import.test.ts 的 mkdtemp + afterAll 清理惯例）
// ---------------------------------------------------------------------------

const tmpDirs: string[] = [];

afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

function writeFixture(name: string, text: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'oinur-readyaml-'));
  tmpDirs.push(dir);
  const pathname = path.join(dir, name);
  writeFileSync(pathname, text, 'utf8');
  return pathname;
}

/** 路径进 RegExp 前转义（tmp 目录名理论上可含正则元字符） */
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------------------------------------------------------------------------
// readYaml：读文件 + 语法错误直接抛出（区别于 parseYamlText 的收集语义）
// ---------------------------------------------------------------------------

describe('readYaml', () => {
  it('returns parsed data for a valid yaml file', () => {
    const p = writeFixture('fixture.yaml', 'a: 1\nb:\n  - x\n  - y\n');
    expect(readYaml(p)).toEqual({ a: 1, b: ['x', 'y'] });
  });

  it('returns null for an empty file (empty document)', () => {
    const p = writeFixture('empty.yaml', '');
    expect(readYaml(p)).toBeNull();
  });

  it('throws with "pathname:line" prefix on the first syntax error', () => {
    // tab 缩进恰好产生单条错误且行号确定为 2
    const p = writeFixture('fixture.yaml', 'a:\n\t- x\n');
    expect(() => readYaml(p)).toThrowError(
      new RegExp(`^${escapeRe(p)}:2: YAML 语法错误：Tabs are not allowed as indentation`),
    );
  });
});
