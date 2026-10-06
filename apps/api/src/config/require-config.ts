import { getConfig, type ConfigBundle } from './loader.js';

/**
 * 模块级 CONFIG 守卫唯一实现（R4 收口：原 5 份同名私有副本与散落内联守卫合并）。
 * `module` 仅作错误前缀（如 requireConfig('talents')）。
 * 字段级检查（economy.onboarding / economy.lecture 等可选分区）由调用方在守卫之后自行补充。
 */
export function requireConfig(module: string): Readonly<ConfigBundle> {
  const config = getConfig();
  if (!config) {
    throw new Error(`[${module}] CONFIG 未加载：importConfigs() 必须先于游戏逻辑执行`);
  }
  return config;
}
