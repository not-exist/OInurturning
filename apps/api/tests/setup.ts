/**
 * Vitest setupFiles：在每个测试文件执行前运行（同进程内）
 * - 统一设置测试环境变量默认值
 * - 确保 prisma 在测试结束后正确关闭（由 globalSetup 负责建库，此处负责连接复用）
 */

process.env.VITEST = 'true';
process.env.NODE_ENV ||= 'test';
process.env.JWT_SECRET ||= 'test-secret-test-secret-test-secret-32';
process.env.DATABASE_URL ||= 'mysql://oinur:oinur@127.0.0.1:3306/oinur_test';

// 抑制 pino 在测试中的 info 日志，保留 warn/error
process.env.LOG_LEVEL ||= 'warn';
