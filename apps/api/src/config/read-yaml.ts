import { readFileSync } from 'node:fs';
import { parseDocument } from 'yaml';

export interface YamlIssue {
  /** 首个出错行号（缺失时为 undefined） */
  line?: number;
  /** 单行错误消息 */
  message: string;
}

export interface ParsedYaml {
  /** errors 非空时为 undefined */
  data: unknown;
  errors: YamlIssue[];
}

/**
 * 解析 yaml 文本：语法错误逐条返回（不抛）。
 * importConfigs 需要收集全部文件的错误后一次性报全，故低层不做 fail-fast。
 */
export function parseYamlText(text: string): ParsedYaml {
  const doc = parseDocument(text);
  if (doc.errors.length === 0) return { data: doc.toJS(), errors: [] };
  return {
    data: undefined,
    errors: doc.errors.map((e) => ({
      line: e.linePos?.[0]?.line,
      message: e.message.split('\n')[0],
    })),
  };
}

/** 读 yaml 文件：语法错误直接抛出（脚本与测试无汇总需求） */
export function readYaml(pathname: string): unknown {
  const text = readFileSync(pathname, 'utf8');
  const { data, errors } = parseYamlText(text);
  if (errors.length > 0) {
    const first = errors[0];
    throw new Error(
      `${pathname}${first.line !== undefined ? `:${first.line}` : ''}: YAML 语法错误：${first.message}`,
    );
  }
  return data;
}
