import { execSync } from 'node:child_process';

export default async function setup(): Promise<void> {
  process.env.VITEST = 'true';
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET ||= 'test-secret-test-secret-test-secret-32';
  process.env.DATABASE_URL ||= 'mysql://oinur:oinur@127.0.0.1:3306/oinur_test';
  // 测试库结构对齐开发库迁移（幂等：先重建库再套用全量 diff）
  const sql = execSync(
    'pnpm -C apps/api exec prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script',
    { cwd: '../../', encoding: 'utf8' },
  );
  const escaped = sql.replace(/"/g, '\\"').replace(/`/g, '\\`');
  execSync(
    'mysql -h127.0.0.1 -uoinur -poinur -e "DROP DATABASE IF EXISTS oinur_test; CREATE DATABASE oinur_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"',
    { cwd: '../../', stdio: 'pipe' },
  );
  execSync(
    `mysql -h127.0.0.1 -uoinur -poinur oinur_test -e "${escaped}"`,
    { cwd: '../../', stdio: 'pipe' },
  );
}
