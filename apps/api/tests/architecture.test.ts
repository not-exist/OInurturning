import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ABILITY_COLUMNS,
  ACQUIRED_VIAS,
  ADVENTURE_STATUSES,
  CONFIG_DIMENSIONS,
  DIMENSION_CONFIG,
  MATCH_STATUSES,
  normalizeConfigDimension,
  QUALITY_TIERS,
  ROLES,
  STUDENT_STATUSES,
  TOURNAMENT_STATUSES,
} from '@oinur/shared';
import type { CandidatePublicView, ContestFormat, ContestRecordType } from '@oinur/shared';
import type { CandidatePayload } from '../src/modules/academy/recruit-gen.js';

/**
 * R6-T1 架构守卫套件（DB-free，不连任何数据库）。
 *
 * 目的：把 R4/R5 收口后的单源化成果机械化——手抄副本、绕过单点的写法、
 * Prisma 枚举与 shared 常量的漂移，一律在 unit 门禁当场变红。
 * 全部守卫在提交时点的 HEAD 上为绿；每条守卫的失败模式都做过 RED 自证
 * （守卫 2/3/9 实测注入违规后复红，其余见提交说明的推理记录）。
 *
 * 扫描范围：apps/api/src、apps/web/src、packages/shared/src 的 .ts/.tsx
 * （排除 node_modules、src/generated、tests/fixtures；api 的 src/scripts 在
 * src 范围内一并覆盖——仓库不存在 apps/api/scripts 顶层目录）。
 *
 * 已知盲区（如实声明，非修复承诺——修复属未来批次）：
 * - g2 只认 `function NAME` 声明形式，`const NAME = () =>` 箭头重实现不计。
 * - g6 不防 `badges as unknown as string[]` 双重 cast。
 * - g5 元组指纹只认单引号形态。
 * - g7 不查动态 import(...) 与 export-from 运行时再导出。
 * - g8 见证为单向（view ⊆ Omit(payload)）；view 添额外字段与 payload 增可选字段不拦。
 * - 仓库根 scripts/（sim-economy.ts、balance-regression.ts、*.mjs）不在扫描根内。
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = dirname(here); // apps/api
const repoRoot = dirname(dirname(apiRoot)); // 仓库根
const apiSrc = join(apiRoot, 'src');
const webSrc = resolve(repoRoot, 'apps/web/src');
const sharedSrc = resolve(repoRoot, 'packages/shared/src');
const schemaText = readFileSync(join(apiRoot, 'prisma', 'schema.prisma'), 'utf8');

/** 行锁（FOR UPDATE）唯一落点（R4-T2 收口） */
const ROW_LOCK_FILE = join(apiSrc, 'lib', 'row-lock.ts');
/** badges Json 列读/写收口（R4-T6）；裸 cast 仅允许在此文件 */
const JSON_LIB_FILE = join(apiSrc, 'lib', 'json.ts');
/** 大写维度元组与 DS→ds 桥的仅有的两个权威住址 */
const BRIDGE_HOMES = [join(sharedSrc, 'enums.ts'), join(sharedSrc, 'config', 'problems.ts')];

/** R4 收口为单点的函数：apps 与 packages 的全部 src 内恰好一个定义 */
const SINGLE_SOURCE_FUNCTIONS = [
  'clamp',
  'clampInt',
  'weightedPick',
  'jsonValue',
  'readBadgeList',
  'stableSerialize',
  'jsonWrite',
  'requireConfig',
  'readYaml',
  'parseYamlText',
  'aggregateTeam',
] as const;

// --- 扫描基础设施 -----------------------------------------------------------

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, '');
}

function listTsFiles(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const entry of entries) {
      // generated（prisma client）不参与守卫：它是生成物，不是人写的源码
      if (entry.name === 'node_modules' || entry.name === 'generated' || entry.name === 'fixtures') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
  };
  visit(root);
  return out;
}

const allSourceFiles = [...listTsFiles(apiSrc), ...listTsFiles(webSrc), ...listTsFiles(sharedSrc)];
const fileContents = new Map(allSourceFiles.map((file) => [file, readFileSync(file, 'utf8')]));
const rel = (file: string): string => relative(repoRoot, file);

/** 解析 schema.prisma 的顶层 enum 块：剥 // 注释后逐行取首个标识符（无逗号分隔体） */
function parsePrismaEnums(text: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const lines = text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim());
  let current: { name: string; values: string[] } | null = null;
  for (const line of lines) {
    const start = /^enum\s+(\w+)\s*\{$/.exec(line);
    if (start) {
      current = { name: start[1]!, values: [] };
      continue;
    }
    if (current === null) continue;
    if (line === '}') {
      result.set(current.name, current.values);
      current = null;
    } else if (line !== '') {
      current.values.push(line.split(/\s+/)[0]!);
    }
  }
  return result;
}

/** 解析指定 model 块的体行（已剥注释、去空行） */
function prismaModelLines(text: string, model: string): string[] {
  const lines = text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''));
  const header = new RegExp('^model\\s+' + model + '\\s*\\{');
  const start = lines.findIndex((line) => header.test(line.trim()));
  if (start < 0) return [];
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim();
    if (/^}/.test(trimmed)) break;
    if (trimmed !== '') body.push(trimmed);
  }
  return body;
}

/** 值与顺序都一致的序列比较（undefined 视为未找到） */
function sameSequence(actual: readonly string[] | undefined, expected: readonly string[]): boolean {
  return actual !== undefined && actual.length === expected.length && expected.every((v, i) => actual[i] === v);
}

// --- 守卫本体 ---------------------------------------------------------------

describe('architecture guards (R6-T1)', () => {
  describe('guard 1: row-lock single point', () => {
    it('FOR UPDATE appears exactly 6 times, all inside lib/row-lock.ts', () => {
      const stray = allSourceFiles
        .filter((file) => file !== ROW_LOCK_FILE)
        .map((file) => ({
          file: rel(file),
          hits: (stripComments(fileContents.get(file)!).match(/FOR UPDATE/g) ?? []).length,
        }))
        .filter((entry) => entry.hits > 0);
      expect(stray).toEqual([]);
      const rowLockHits = (stripComments(fileContents.get(ROW_LOCK_FILE)!).match(/FOR UPDATE/g) ?? []).length;
      expect(rowLockHits).toBe(6);
    });

    it('$queryRawUnsafe / $executeRawUnsafe are absent from api src', () => {
      const rawUnsafe = new RegExp('\\$queryRaw' + 'Unsafe|\\$executeRaw' + 'Unsafe');
      const offenders = allSourceFiles
        .filter((file) => file.startsWith(apiSrc))
        .filter((file) => rawUnsafe.test(stripComments(fileContents.get(file)!)))
        .map(rel);
      expect(offenders).toEqual([]);
    });
  });

  describe('guard 2: single-source definition count == 1', () => {
    it('each consolidated helper is defined exactly once across apps/*/src + packages/shared/src', () => {
      const dupes = SINGLE_SOURCE_FUNCTIONS.map((name) => {
        const definition = new RegExp('\\bfunction\\s+' + name + '\\b');
        return {
          name,
          sites: allSourceFiles.filter((file) => definition.test(stripComments(fileContents.get(file)!))).map(rel),
        };
      }).filter((entry) => entry.sites.length !== 1);
      expect(dupes).toEqual([]);
    });
  });

  describe('guard 3: prisma enum ↔ shared alignment', () => {
    const prismaEnums = parsePrismaEnums(schemaText);

    it('runtime arrays match prisma values AND order', () => {
      const aligned: readonly (readonly [string, readonly string[]])[] = [
        ['Role', ROLES],
        ['AdventureStatus', ADVENTURE_STATUSES],
        ['TournamentStatus', TOURNAMENT_STATUSES],
        ['MatchStatus', MATCH_STATUSES],
        ['AcquiredVia', ACQUIRED_VIAS],
        ['QualityTier', QUALITY_TIERS],
        ['StudentStatus', STUDENT_STATUSES],
      ];
      const mismatches = aligned
        .filter(([name, shared]) => !sameSequence(prismaEnums.get(name), shared))
        .map(([name, shared]) => ({ enum: name, prisma: prismaEnums.get(name), shared: [...shared] }));
      expect(mismatches).toEqual([]);
    });

    it('bare union mirrors (ContestFormat / ContestRecordType) match prisma values AND order', () => {
      // ContestFormat（contest.ts）与 ContestRecordType（story.ts）是裸字面量联合，
      // 无运行时数组——用类型见证把期望值钉进类型域：schema 侧改名/增值会让下面的
      // 字面量赋值先在 tsc 报错；schema 侧删值则由本运行时断言变红。
      const expectedContestFormat: readonly ContestFormat[] = ['RANKING', 'DUEL'];
      const expectedContestType: readonly ContestRecordType[] = ['STORY', 'PVP', 'ADVENTURE'];
      expect(sameSequence(prismaEnums.get('ContestFormat'), expectedContestFormat)).toBe(true);
      expect(sameSequence(prismaEnums.get('ContestType'), expectedContestType)).toBe(true);
    });
    it('bare unions are closed: no member beyond the prisma vocabulary', () => {
      // 反向封闭见证：上面的字面量赋值只证明『prisma 值 ⊆ shared 联合』，
      // 反向（shared 侧单面加一个 schema 没有的值）会从它手里逃逸——任何字面量
      // 都是合法成员，extra 不报错。这里反过来要求 Exclude<union, 词表> 为空，
      // 让 shared 侧单面增值在 tsc 变红。两个方向合起来才钉住『相等』而非『包含』。
      type ContestFormatClosed = Exclude<ContestFormat, 'RANKING' | 'DUEL'> extends never ? true : never;
      type ContestRecordTypeClosed = Exclude<ContestRecordType, 'STORY' | 'PVP' | 'ADVENTURE'> extends never
        ? true
        : never;
      const contestFormatClosed: ContestFormatClosed = true;
      const contestRecordTypeClosed: ContestRecordTypeClosed = true;
      expect(contestFormatClosed).toBe(true);
      expect(contestRecordTypeClosed).toBe(true);
    });

    it('TrainingKind stays deliberately unfolded (prisma uppercase vs wire lowercase)', () => {
      // 刻意不对齐：Prisma TrainingKind（BASIC/DIRECTED/SPECIALIZED）与 shared 的
      // 小写 wire 名（basic/directed/specialized）是两个域，api 内由映射表双向翻译
      // （R4-T9 结论）。此用例只锁定 schema 侧词表本身，防无声明漂移。
      expect(sameSequence(prismaEnums.get('TrainingKind'), ['BASIC', 'DIRECTED', 'SPECIALIZED'])).toBe(true);
    });
  });

  describe('guard 4: ability columns and dimension config', () => {
    it('every ABILITY_COLUMNS value is a Student model column', () => {
      const columns = new Set(prismaModelLines(schemaText, 'Student').map((line) => line.split(/\s+/)[0]!));
      const missing = ABILITY_COLUMNS.filter((column) => !columns.has(column));
      expect(missing).toEqual([]);
    });

    it('DIMENSION_CONFIG values == CONFIG_DIMENSIONS and normalizeConfigDimension round-trips', () => {
      expect([...Object.values(DIMENSION_CONFIG)].sort()).toEqual([...CONFIG_DIMENSIONS].sort());
      for (const [key, wire] of Object.entries(DIMENSION_CONFIG)) {
        expect(normalizeConfigDimension(wire)).toBe(key);
      }
    });
  });

  describe('guard 5: anti-hand-copy greps', () => {
    // 手抄副本的两个指纹：大写维度元组、DS→ds 桥记录。唯一合法住址是
    // shared/enums.ts 与 shared/config/problems.ts（R4-T9 双命名空间裁决）。
    const uppercaseTuple = /\['DS'\s*,\s*'DP'/;
    const bridgeRecord =
      /^[ \t]*(DS|DP|MATH|GRAPH|GREEDY|STRING)[ \t]*:[ \t]*'(ds|dp|math|graph|greedy|string|str)'/m;

    it('dimension bridge fingerprints appear only in the authoritative homes', () => {
      const offenders = allSourceFiles
        .filter((file) => !BRIDGE_HOMES.includes(file))
        .filter(
          (file) =>
            uppercaseTuple.test(stripComments(fileContents.get(file)!)) ||
            bridgeRecord.test(stripComments(fileContents.get(file)!)),
        )
        .map(rel);
      expect(offenders).toEqual([]);
    });
  });

  describe('guard 6: badges cast ban', () => {
    it('badges raw casts / Array.isArray(badges) stay inside lib/json.ts only', () => {
      const offenders = allSourceFiles
        .filter((file) => file !== JSON_LIB_FILE)
        .filter((file) => /badges as string\[\]|Array\.isArray\(badges\)/.test(stripComments(fileContents.get(file)!)))
        .map(rel);
      expect(offenders).toEqual([]);
    });
  });

  describe('guard 7: views.ts is type-only', () => {
    it('every import in shared/domain/views.ts is `import type`', () => {
      const views = fileContents.get(join(sharedSrc, 'domain', 'views.ts')) ?? '';
      const nonTypeImports = views
        .split('\n')
        .filter((line) => /^import /.test(line) && !/^import type /.test(line));
      expect(nonTypeImports).toEqual([]);
    });
  });

  describe('guard 8: CandidatePublicView binding', () => {
    // 类型见证：CandidatePublicView 必须仍是 CandidatePayload 掐掉 qualityTier/talents
    // 的子集（R5-T1 裁决）。shared 侧字段漂移会让 _Pv 变 never，tsc 直接红。
    type _Pv = CandidatePublicView extends Omit<CandidatePayload, 'qualityTier' | 'talents'> ? true : never;
    const _pv: _Pv = true;

    it('CandidatePublicView is bound to CandidatePayload minus qualityTier/talents', () => {
      expect(_pv).toBe(true);
    });
  });

  describe('guard 9: web View declaration ban', () => {
    it('apps/web/src declares no local `export interface *View`', () => {
      // 只匹配 interface 声明；`export type X = ...View` 类别名 re-export 不算违规。
      const offenders = allSourceFiles
        .filter((file) => file.startsWith(webSrc))
        .filter((file) => /export\s+interface\s+\w+View\b/.test(stripComments(fileContents.get(file)!)))
        .map(rel);
      expect(offenders).toEqual([]);
    });
  });
});
