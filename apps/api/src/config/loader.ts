import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';
import type { Prisma } from '@prisma/client';
import {
  economyConfigSchema,
  itemsFileSchema,
  problemConfigSchema,
  stagesConfigSchema,
  talentsFileSchema,
  type EconomyConfig,
  type ItemDef,
  type ProblemConfig,
  type ProblemTemplate,
  type ProblemTrait,
  type StageConfig,
  type StagesConfig,
  type TalentDef,
} from '@oinur/shared';
import { env } from './env.js';
import { runSemanticChecks, type SemanticIssue } from './semantic.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';

const FILES = ['talents', 'items', 'economy', 'problems', 'stages'] as const;
type ConfigFile = (typeof FILES)[number];

export interface ConfigBundle {
  talents: Record<string, TalentDef>;
  items: Record<string, ItemDef>;
  problems: Record<string, ProblemTemplate>;
  problemTraits: Record<string, ProblemTrait>;
  problemConventions: ProblemConfig['conventions'];
  stages: Record<string, StageConfig>;
  stageDefaults: StagesConfig['defaults'];
  fullClear: StagesConfig['full_clear'];
  ngPlus: StagesConfig['ng_plus'];
  economy: EconomyConfig;
  sourceHash: string;
}

/** 模块级只读内存缓存：游戏逻辑读 CONFIG 纯内存操作，不查库（TECH-DESIGN §4） */
export let CONFIG: Readonly<ConfigBundle> | undefined;

export function getConfig(): Readonly<ConfigBundle> | undefined {
  return CONFIG;
}

export function getProblemTemplate(id: string): ProblemTemplate | undefined {
  return CONFIG?.problems[id];
}

export function getStageConfig(stageKey: string): StageConfig | undefined {
  return CONFIG?.stages[stageKey];
}

/** 配置校验失败即致命：测试环境抛出供断言，其余环境在打印错误表后退出进程 */
export class FatalStartupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FatalStartupError';
  }
}

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

/** 相对路径先按 cwd 解析（pnpm -C 场景），再按仓库根回退（容错） */
export function resolveConfigDir(override?: string): string {
  const dir = override ?? env.CONFIG_DIR;
  if (path.isAbsolute(dir)) return dir;
  const fromCwd = path.resolve(process.cwd(), dir);
  if (existsSync(fromCwd)) return fromCwd;
  return path.resolve(MODULE_DIR, '../../../..', dir);
}

interface RawFile {
  file: ConfigFile;
  text: string;
  data: unknown;
}

interface LoadError {
  file: string;
  path: string;
  message: string;
}

function readYamlFiles(dir: string): { raws: RawFile[]; errors: LoadError[] } {
  const raws: RawFile[] = [];
  const errors: LoadError[] = [];
  for (const file of FILES) {
    const full = path.join(dir, `${file}.yaml`);
    let text: string;
    try {
      text = readFileSync(full, 'utf8');
    } catch {
      errors.push({ file, path: `${file}.yaml`, message: `文件不可读：${full}` });
      continue;
    }
    const doc = parseDocument(text);
    if (doc.errors.length > 0) {
      for (const e of doc.errors) {
        const line = e.linePos?.[0]?.line;
        errors.push({
          file,
          path: `${file}.yaml${line ? ` (line ${line})` : ''}`,
          message: `YAML 语法错误：${e.message.split('\n')[0]}`,
        });
      }
      continue;
    }
    raws.push({ file, text, data: doc.toJS() });
  }
  return { raws, errors };
}

/** 「文件 / 路径 / 问题」三列表格文本（同时打印到 stderr 并作为异常消息） */
function formatErrorTable(errors: LoadError[]): string {
  const rows = errors.map((e) => `  ${e.file.padEnd(10)} ${e.path.padEnd(40)} ${e.message}`);
  return `[config] 配置校验失败，共 ${errors.length} 处错误：\n  文件        路径                                      问题\n${rows.join('\n')}`;
}

function failFast(errors: LoadError[]): never {
  const table = formatErrorTable(errors);
  console.error(table);
  if (env.NODE_ENV === 'test') throw new FatalStartupError(table);
  process.exit(1);
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** zod 校验后的配置定义即 JSON 安全结构；passthrough 输出类型无索引签名，此处一次性收口 */
function toJsonPayload(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

/** 递归冻结：CONFIG 为多模块共享的只读缓存，嵌套结构同样不可改写（F-3） */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

async function loadBundleFromDb(
  sourceHash: string,
  problemsConfig: ProblemConfig,
  stagesConfig: StagesConfig,
): Promise<ConfigBundle> {
  const [talents, items, problems, stages, economy] = await Promise.all([
    prisma.configTalent.findMany({ where: { deprecated: false } }),
    prisma.configItem.findMany({ where: { deprecated: false } }),
    prisma.configProblem.findMany({ where: { deprecated: false } }),
    prisma.configStage.findMany({ where: { deprecated: false } }),
    prisma.configEconomy.findUniqueOrThrow({ where: { id: 'active' } }),
  ]);
  const bundle: ConfigBundle = {
    talents: Object.fromEntries(talents.map((r) => [r.id, r.payload as unknown as TalentDef])),
    items: Object.fromEntries(items.map((r) => [r.id, r.payload as unknown as ItemDef])),
    problems: Object.fromEntries(
      problems.map((r) => [r.id, r.payload as unknown as ProblemTemplate]),
    ),
    problemTraits: Object.fromEntries(problemsConfig.traits.map((trait) => [trait.id, trait])),
    problemConventions: problemsConfig.conventions,
    stages: Object.fromEntries(stages.map((r) => [r.id, r.payload as unknown as StageConfig])),
    stageDefaults: stagesConfig.defaults,
    fullClear: stagesConfig.full_clear,
    ngPlus: stagesConfig.ng_plus,
    economy: economy.payload as unknown as EconomyConfig,
    sourceHash,
  };
  return deepFreeze(bundle);
}

/**
 * 将 DB 调和到与本批 yaml 完全一致：本批条目逐条 upsert（恢复 payload、置 deprecated:false，
 * 即回滚场景下被弃用条目复活、被改写 payload 回滚），本批缺失的活跃条目软弃用。
 * 完整导入与幂等跳过两条路径共用（F-1/F-2）。
 */
async function reconcileTables(
  tx: Prisma.TransactionClient,
  batch: {
    talents: TalentDef[];
    items: ItemDef[];
    problems: ProblemConfig;
    stages: StagesConfig;
    economy: EconomyConfig;
    sourceHash: string;
  },
): Promise<void> {
  const { talents, items, problems, stages, economy, sourceHash } = batch;
  for (const t of talents) {
    await tx.configTalent.upsert({
      where: { id: t.id },
      create: { id: t.id, sourceHash, payload: toJsonPayload(t) },
      update: { sourceHash, payload: toJsonPayload(t), deprecated: false },
    });
  }
  for (const it of items) {
    await tx.configItem.upsert({
      where: { id: it.id },
      create: { id: it.id, sourceHash, payload: toJsonPayload(it) },
      update: { sourceHash, payload: toJsonPayload(it), deprecated: false },
    });
  }
  for (const problem of problems.templates) {
    await tx.configProblem.upsert({
      where: { id: problem.id },
      create: { id: problem.id, sourceHash, payload: toJsonPayload(problem) },
      update: { sourceHash, payload: toJsonPayload(problem), deprecated: false },
    });
  }
  for (const stage of stages.stages) {
    const id = `${stage.chapter}:${stage.stage_index}`;
    await tx.configStage.upsert({
      where: { id },
      create: { id, sourceHash, payload: toJsonPayload(stage) },
      update: { sourceHash, payload: toJsonPayload(stage), deprecated: false },
    });
  }
  await tx.configEconomy.upsert({
    where: { id: 'active' },
    create: { id: 'active', sourceHash, payload: toJsonPayload(economy) },
    update: { sourceHash, payload: toJsonPayload(economy), deprecated: false },
  });
  await tx.configTalent.updateMany({
    where: { deprecated: false, id: { notIn: talents.map((t) => t.id) } },
    data: { deprecated: true, sourceHash },
  });
  await tx.configItem.updateMany({
    where: { deprecated: false, id: { notIn: items.map((i) => i.id) } },
    data: { deprecated: true, sourceHash },
  });
  await tx.configProblem.updateMany({
    where: { deprecated: false, id: { notIn: problems.templates.map((problem) => problem.id) } },
    data: { deprecated: true, sourceHash },
  });
  await tx.configStage.updateMany({
    where: {
      deprecated: false,
      id: { notIn: stages.stages.map((stage) => `${stage.chapter}:${stage.stage_index}`) },
    },
    data: { deprecated: true, sourceHash },
  });
}

export interface ImportConfigsOptions {
  /** 覆盖 env.CONFIG_DIR（测试用 fixtures/临时目录） */
  configDir?: string;
}

/**
 * 配置即数据管线（TECH-DESIGN §4.2 的 M1 三文件版）：
 * 读 yaml → zod 校验 → 语义检查 → sourceHash 幂等判断 → 单事务 upsert + 软弃用 → 冻结内存缓存。
 */
export async function importConfigs(opts: ImportConfigsOptions = {}): Promise<ConfigBundle> {
  const dir = resolveConfigDir(opts.configDir);

  // 1. 加载与解析（YAML 语法错误同样汇总进错误表，带行号）
  const { raws, errors } = readYamlFiles(dir);

  // 2. 结构校验：收集所有文件的所有错误，一次性报全
  let talents: TalentDef[] = [];
  let items: ItemDef[] = [];
  let economy: EconomyConfig | undefined;
  let problems: ProblemConfig | undefined;
  let stages: StagesConfig | undefined;
  for (const raw of raws) {
    if (raw.file === 'talents') {
      const r = talentsFileSchema.safeParse(raw.data);
      if (r.success) talents = r.data.talents;
      else
        errors.push(
          ...r.error.issues.map((i) => ({
            file: raw.file,
            path: i.path.join('.'),
            message: i.message,
          })),
        );
    } else if (raw.file === 'items') {
      const r = itemsFileSchema.safeParse(raw.data);
      if (r.success) items = r.data.items;
      else
        errors.push(
          ...r.error.issues.map((i) => ({
            file: raw.file,
            path: i.path.join('.'),
            message: i.message,
          })),
        );
    } else if (raw.file === 'economy') {
      const r = economyConfigSchema.safeParse(raw.data);
      if (r.success) economy = r.data;
      else
        errors.push(
          ...r.error.issues.map((i) => ({
            file: raw.file,
            path: i.path.join('.'),
            message: i.message,
          })),
        );
    } else if (raw.file === 'problems') {
      const r = problemConfigSchema.safeParse(raw.data);
      if (r.success) problems = r.data;
      else
        errors.push(
          ...r.error.issues.map((i) => ({
            file: raw.file,
            path: i.path.join('.'),
            message: i.message,
          })),
        );
    } else {
      const r = stagesConfigSchema.safeParse(raw.data);
      if (r.success) stages = r.data;
      else
        errors.push(
          ...r.error.issues.map((i) => ({
            file: raw.file,
            path: i.path.join('.'),
            message: i.message,
          })),
        );
    }
  }
  if (errors.length > 0) failFast(errors);

  // 3. 语义交叉校验（引用完整性 / 升阶链合法性 / 经济四档），同样收集全部错误
  const semanticIssues: SemanticIssue[] = runSemanticChecks({
    talents,
    items,
    economy: economy!,
    problems: problems!,
    stages: stages!,
  });
  if (semanticIssues.length > 0) {
    failFast(semanticIssues.map((i) => ({ file: i.file, path: i.path, message: i.message })));
  }

  // 4. 版本指纹与幂等判断：sha256(五文件原文拼接)
  const byFile = new Map(raws.map((r) => [r.file, r.text]));
  const sourceHash = sha256(FILES.map((f) => byFile.get(f) ?? '').join('\n'));
  const done = await prisma.configImport.findFirst({ where: { sourceHash, ok: true } });
  if (done) {
    // 幂等跳过仍需先调和 DB（F-1/F-2）：回滚到旧 hash 时，被后续批次软弃用的条目复活、
    // 被改写的 payload 回滚，保证任何进程启动后 CONFIG 必然等于其自身 CONFIG_DIR 的 yaml；
    // 不新增 configImport 行，保留审计幂等语义。
    await prisma.$transaction(
      (tx) =>
        reconcileTables(tx, {
          talents,
          items,
          problems: problems!,
          stages: stages!,
          economy: economy!,
          sourceHash,
        }),
      { timeout: 20_000 },
    );
    CONFIG = await loadBundleFromDb(sourceHash, problems!, stages!);
    logger.info({ sourceHash, dir }, '[config] 同 hash 已导入，调和 DB 后幂等跳过');
    return CONFIG;
  }

  // 5. 事务性导入：整体要么全量生效、要么保持旧版；本批缺失的历史条目软弃用
  const manifest = FILES.map((f) => ({
    file: `${f}.yaml`,
    bytes: Buffer.byteLength(byFile.get(f) ?? ''),
    entities:
      f === 'talents'
        ? talents.length
        : f === 'items'
          ? items.length
          : f === 'problems'
            ? problems!.templates.length
            : f === 'stages'
              ? stages!.stages.length
              : 1,
  }));
  await prisma.$transaction(
    async (tx) => {
      await reconcileTables(tx, {
        talents,
        items,
        problems: problems!,
        stages: stages!,
        economy: economy!,
        sourceHash,
      });
      await tx.configImport.create({ data: { sourceHash, manifest, ok: true } });
    },
    { timeout: 20_000 },
  );

  CONFIG = await loadBundleFromDb(sourceHash, problems!, stages!);
  logger.info(
    {
      sourceHash,
      talents: talents.length,
      items: items.length,
      problems: problems!.templates.length,
      stages: stages!.stages.length,
    },
    '[config] 配置导入完成并冻结进内存缓存',
  );
  return CONFIG;
}
