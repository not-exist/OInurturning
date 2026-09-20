import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mariadb from 'mariadb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 优化后的 globalSetup
 * - 支持 VITEST_REUSE_DB=1 跳过重建，加速本地迭代
 * - 禁用外键检查批量应用迁移，提升速度
 * - 迁移文件按需读取与缓存，避免重复 IO
 * - 详细耗时日志，便于 CI 诊断
 */
export default async function setup(): Promise<void> {
  const started = Date.now();
  process.env.VITEST = 'true';
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET ||= 'test-secret-test-secret-test-secret-32';
  process.env.DATABASE_URL ||= 'mysql://oinur:oinur@127.0.0.1:3306/oinur_test';

  const reuse = process.env.VITEST_REUSE_DB === '1';
  const url = new URL(process.env.DATABASE_URL);
  const database = url.pathname.replace(/^\//, '');
  if (!database) {
    throw new Error(`[global-setup] DATABASE_URL 缺少库名: ${process.env.DATABASE_URL}`);
  }

  const admin = await mariadb.createConnection({
    host: url.hostname,
    port: Number(url.port) || 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    multipleStatements: true,
    allowPublicKeyRetrieval: true,
    // 连接超时与查询超时收紧，避免 CI 挂死
    connectTimeout: 10_000,
    socketTimeout: 30_000,
  });

  try {
    if (reuse) {
      // 快速路径：检查库是否存在，存在则跳过重建
      const rows = await admin.query(`SHOW DATABASES LIKE '${database}'`);
      if (rows.length > 0) {
        console.log(`[global-setup] VITEST_REUSE_DB=1 → 复用已存在库 ${database}，跳过重建 (${Date.now() - started}ms)`);
        return;
      }
      console.log(`[global-setup] VITEST_REUSE_DB=1 但库 ${database} 不存在，执行完整重建`);
    }

    console.log(`[global-setup] 重建测试库 ${database}...`);
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await admin.query(`USE \`${database}\``);

    // 禁用外键检查以加速 DDL 批量执行
    await admin.query('SET FOREIGN_KEY_CHECKS=0');

    const migrationsDir = path.resolve(__dirname, '../prisma/migrations');
    const migrations = fs
      .readdirSync(migrationsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();

    let applied = 0;
    for (const name of migrations) {
      const file = path.join(migrationsDir, name, 'migration.sql');
      if (!fs.existsSync(file)) continue;
      let sql = fs.readFileSync(file, 'utf8');
      // MySQL 8.0.13+ 才支持 JSON 列表达式默认值，旧实例剥离以兼容
      sql = sql.replace(/(`\w+` JSON (?:NOT )?NULL) DEFAULT \([^)]*\)/g, '$1');
      if (!sql.trim()) continue;
      await admin.query(sql);
      applied += 1;
    }

    await admin.query('SET FOREIGN_KEY_CHECKS=1');

    console.log(`[global-setup] 完成：${applied} 个迁移已应用，耗时 ${Date.now() - started}ms`);
  } catch (err) {
    console.error('[global-setup] 失败:', err);
    throw err;
  } finally {
    await admin.end();
  }
}

export async function teardown(): Promise<void> {
  // 可选：测试结束后关闭连接池，当前由 prisma 单例管理，无需额外操作
  // 保留此钩子供未来扩展（如清理临时库）
}
