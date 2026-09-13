import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mariadb from 'mariadb';

export default async function setup(): Promise<void> {
  process.env.VITEST = 'true';
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET ||= 'test-secret-test-secret-test-secret-32';
  process.env.DATABASE_URL ||= 'mysql://oinur:oinur@127.0.0.1:3306/oinur_test';

  const url = new URL(process.env.DATABASE_URL);
  const database = url.pathname.replace(/^\//, '');
  if (!database) {
    throw new Error(`[global-setup] DATABASE_URL 缺少库名: ${process.env.DATABASE_URL}`);
  }

  // 测试库结构对齐开发库迁移（幂等：先重建库，再按序套用全量迁移 SQL）。
  // 纯 JS 驱动执行，不依赖 mysql CLI，也不依赖 prisma schema-engine 二进制下载。
  const admin = await mariadb.createConnection({
    host: url.hostname,
    port: Number(url.port) || 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    multipleStatements: true, // 迁移 SQL 为多语句脚本
  });
  try {
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await admin.query(
      `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    await admin.query(`USE \`${database}\``);

    const migrationsDir = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../prisma/migrations',
    );
    const migrations = fs
      .readdirSync(migrationsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    for (const name of migrations) {
      const file = path.join(migrationsDir, name, 'migration.sql');
      if (!fs.existsSync(file)) continue; // 无 SQL 的占位迁移目录
      let sql = fs.readFileSync(file, 'utf8');
      // MySQL 8.0.13+ 才支持 JSON 列表达式默认值 DEFAULT ('…')。
      // Prisma 客户端在 INSERT 时总是显式写入 @default 值，不依赖 DB 端默认，
      // 故在 <8.0 的本地测试实例上剥离表达式默认值即可对齐结构。
      sql = sql.replace(/(`\w+` JSON (?:NOT )?NULL) DEFAULT \([^)]*\)/g, '$1');
      // mariadb 驱动的 query() 会按引号/注释安全切分多语句
      await admin.query(sql);
    }
  } finally {
    await admin.end();
  }
}
