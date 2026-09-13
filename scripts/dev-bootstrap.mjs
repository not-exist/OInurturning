#!/usr/bin/env node
/**
 * 受限网络环境（离线/沙箱）开发引导脚本。
 *
 * 目标：在 `binaries.prisma.sh` 等二进制 CDN 不可达、且无 docker 的环境里，
 * 仍能完成 `pnpm test` / `pnpm dev` 所需的全部准备：
 *
 *   1. Prisma 引擎：下载被墙时，本仓库改走 Rust-free 路线——
 *      queryCompiler(WASM) + @prisma/adapter-mariadb driver adapter，
 *      只需在 generate 时放置占位引擎文件绕过下载（占位文件不会被执行）。
 *   2. MySQL 服务器：无 docker 时，从 npm 拉取 MySQL 5.7 社区二进制 + 源码编译
 *      libaio，初始化本地 datadir 并启动（见 docs/, compose 生产仍为 mysql:8.4）。
 *   3. 初始化 oinur/oinur 账号并按 prisma/migrations 建好开发库。
 *
 * 正常网络环境下各步骤自动跳过（no-op）。用法：`node scripts/dev-bootstrap.mjs`
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = path.join(ROOT, 'apps/api');
const requireFromApi = createRequire(path.join(API, 'package.json'));
const MYSQL_HOME = process.env.OINUR_MYSQL_HOME || path.join(path.dirname(ROOT), 'dev-mysql');
const MYSQL_PORT = Number(process.env.OINUR_MYSQL_PORT || 3306);
const MYSQL_TGZ = 'mysql-server-5.7-lin-x64';
const LIBAIO_TGZ = 'https://codeload.github.com/crossbuild/libaio/tar.gz/refs/heads/master';

const log = (...m) => console.log('[bootstrap]', ...m);

function sh(cmd, opts = {}) {
  const r = spawnSync(cmd, { shell: true, stdio: 'inherit', cwd: ROOT, ...opts });
  if (r.status !== 0) throw new Error(`命令失败: ${cmd}`);
}

function tcpOpen(port, host = '127.0.0.1', timeout = 800) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host });
    const done = (ok) => (s.destroy(), resolve(ok));
    s.setTimeout(timeout, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

function httpsReachable(url, timeout = 5000) {
  return new Promise((resolve) => {
    try {
      const u = new URL(url);
      const mod = u.protocol === 'http:' ? await_import('node:http') : await_import('node:https');
      mod.then(({ request }) => {
        const req = request({ hostname: u.hostname, method: 'HEAD', timeout });
        const done = (ok) => (req.destroy(), resolve(ok));
        req.setTimeout(timeout, () => done(false));
        req.once('response', () => done(true));
        req.once('error', () => done(false));
        req.end();
      });
    } catch {
      resolve(false);
    }
  });
}
const await_import = (m) => import(m);

/** 1) Prisma：二进制 CDN 可达则按常规流程；不可达则布置占位文件并走 queryCompiler。 */
async function bootstrapPrisma() {
  const reach = await httpsReachable('https://binaries.prisma.sh/');
  if (reach) {
    log('binaries.prisma.sh 可达，使用常规 Prisma 流程（Rust library engine）');
    return false;
  }
  log('binaries.prisma.sh 不可达，切换 Rust-free queryCompiler + driver adapter 模式');
  // @prisma/engines 的缓存目录：放置空占位二进制后，fetch-engine 检测到 envVarPath 存在即跳过下载
  const requireFromPrisma = createRequire(requireFromApi.resolve('prisma/package.json'));
  let enginesDir;
  try {
    enginesDir = path.dirname(requireFromPrisma.resolve('@prisma/engines/package.json'));
  } catch {
    const globDir = path.join(ROOT, 'node_modules/.pnpm');
    const hit = fs
      .readdirSync(globDir)
      .find((d) => d.startsWith('@prisma+engines@'));
    if (!hit) throw new Error('未找到 @prisma/engines，请先 `pnpm install`');
    enginesDir = path.join(globDir, hit, 'node_modules/@prisma/engines');
  }
  const gpMod = await await_import(requireFromPrisma.resolve('@prisma/get-platform'));
  const gp = gpMod.default ?? gpMod;
  const target = await gp.getBinaryTargetForCurrentPlatform();
  const schemaEngine = path.join(enginesDir, `schema-engine-${target}`);
  const queryEngine = path.join(enginesDir, `libquery_engine-${target}.so.node`);
  for (const f of [schemaEngine, queryEngine]) {
    if (!fs.existsSync(f)) {
      fs.writeFileSync(f, '#!/bin/sh\necho prisma-engine-placeholder (never executed)\n');
      fs.chmodSync(f, 0o755);
      log('已布置占位引擎:', path.basename(f));
    }
  }
  const gen = spawnSync('pnpm', ['exec', 'prisma', 'generate'], {
    cwd: API,
    shell: true,
    stdio: 'inherit',
    env: {
      ...process.env,
      PRISMA_CLIENT_ENGINE_TYPE: 'client',
      PRISMA_SCHEMA_ENGINE_BINARY: schemaEngine,
      PRISMA_QUERY_ENGINE_LIBRARY: queryEngine,
    },
  });
  if (gen.status !== 0) throw new Error('prisma generate 失败');
  return true; // 需要 PRISMA_CLIENT_ENGINE_TYPE=client 运行时
}

/** 2) MySQL：有 docker 走 compose（略，见 pnpm db:up）；否则用 npm 上的社区二进制。 */
async function bootstrapMysql(rustFree) {
  if (await tcpOpen(MYSQL_PORT)) {
    log(`MySQL 已在 127.0.0.1:${MYSQL_PORT} 运行`);
  } else {
    if (fs.existsSync(path.join(MYSQL_HOME, 'package/server/mysqld'))) {
      log('复用已下载的 MySQL 二进制');
    } else {
      log(`下载并安装 MySQL 5.7 社区二进制到 ${MYSQL_HOME}`);
      fs.mkdirSync(MYSQL_HOME, { recursive: true });
      const tgz = spawnSync('npm', ['pack', MYSQL_TGZ, '--pack-destination', MYSQL_HOME], {
        cwd: MYSQL_HOME,
        encoding: 'utf8',
      });
      if (tgz.status !== 0) throw new Error('MySQL 二进制下载失败（需要 npm registry 可达）');
      const name = tgz.stdout.trim().split('\n').pop();
      sh(`tar xzf "${name}" -C "${MYSQL_HOME}"`, { cwd: MYSQL_HOME });
      fs.rmSync(path.join(MYSQL_HOME, name), { force: true });
      // mysqld 需要 libaio.so.1；源码编译（仅需 cc+make）
      const src = path.join(MYSQL_HOME, 'libaio-src');
      sh(`mkdir -p "${src}" && curl -sL ${LIBAIO_TGZ} | tar xz -C "${src}" --strip-components=1`);
      sh(`make -s -C "${src}"`);
      fs.mkdirSync(path.join(MYSQL_HOME, 'lib'), { recursive: true });
      fs.copyFileSync(path.join(src, 'src/libaio.so.1.0.1'), path.join(MYSQL_HOME, 'lib/libaio.so.1'));
      // 初始化 datadir
      fs.mkdirSync(path.join(MYSQL_HOME, 'data'), { recursive: true });
      fs.mkdirSync(path.join(MYSQL_HOME, 'files'), { recursive: true });
      mysqld(['--initialize-insecure', '--explicit_defaults_for_timestamp'], true);
      log('MySQL datadir 初始化完成');
    }
    log('启动 mysqld（后台常驻）');
    const child = spawn(
      process.execPath === 'node' ? 'mysqld' : 'mysqld',
      [
        `--basedir=${MYSQL_HOME}/package/server`,
        `--datadir=${MYSQL_HOME}/data`,
        '--bind-address=127.0.0.1',
        `--port=${MYSQL_PORT}`,
        '--socket=/tmp/oinur-mysql.sock',
        '--skip-name-resolve',
        `--secure-file-priv=${MYSQL_HOME}/files`,
        `--log-error=${MYSQL_HOME}/mysqld.err`,
      ],
      {
        cwd: MYSQL_HOME,
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, LD_LIBRARY_PATH: `${MYSQL_HOME}/lib` },
      },
    );
    child.unref();
    for (let i = 0; i < 60; i++) {
      if (await tcpOpen(MYSQL_PORT)) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!(await tcpOpen(MYSQL_PORT))) throw new Error(`mysqld 未能在端口 ${MYSQL_PORT} 就绪，查看 ${MYSQL_HOME}/mysqld.err`);
  }
  await initUsersAndDatabases();
}

function mysqld(args, capture = false) {
  const r = spawnSync(
    `${MYSQL_HOME}/package/server/mysqld`,
    args,
    {
      cwd: MYSQL_HOME,
      encoding: 'utf8',
      env: { ...process.env, LD_LIBRARY_PATH: `${MYSQL_HOME}/lib` },
      ...(capture ? { stdio: ['ignore', 'pipe', 'pipe'] } : { stdio: 'inherit' }),
    },
  );
  if (r.status !== 0) throw new Error(`mysqld ${args.join(' ')} 失败:\n${r.stdout}${r.stderr}`);
  return r.stdout;
}

async function initUsersAndDatabases() {
  const mariadb = requireFromApi('mariadb');
  // 全新 datadir 只有 root@localhost（空密码，socket 登录）
  const admin = await mariadb.createConnection({ socketPath: '/tmp/oinur-mysql.sock', user: 'root' });
  await admin.query("CREATE USER IF NOT EXISTS 'oinur'@'%' IDENTIFIED BY 'oinur'");
  await admin.query("GRANT ALL PRIVILEGES ON *.* TO 'oinur'@'%'");
  await admin.query('FLUSH PRIVILEGES');
  await admin.end();
  await applyMigrations(mariadb, 'oinur');
  log('开发库 oinur 就绪（测试库 oinur_test 由 vitest global-setup 每次重建）');
}

async function applyMigrations(mariadb, database) {
  const admin = await mariadb.createConnection({
    host: '127.0.0.1',
    port: MYSQL_PORT,
    user: 'oinur',
    password: 'oinur',
    multipleStatements: true,
  });
  await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await admin.query(`USE \`${database}\``);
  const dir = path.join(API, 'prisma/migrations');
  for (const d of fs.readdirSync(dir).sort()) {
    const f = path.join(dir, d, 'migration.sql');
    if (!fs.existsSync(f)) continue;
    let sql = fs.readFileSync(f, 'utf8');
    // MySQL 8.0.13+ 才支持 JSON 列表达式默认值；Prisma 客户端 INSERT 总是显式写默认值，
    // 旧服务器（本地 5.7 测试实例）剥离即可对齐结构。生产/开发 compose 仍为 mysql:8.4。
    sql = sql.replace(/(`\w+` JSON (?:NOT )?NULL) DEFAULT \([^)]*\)/g, '$1');
    await admin.query(sql);
  }
  await admin.end();
}

/** 3) 本地 .env（gitignored）：受限网络下固定 client 引擎模式。 */
function ensureEnv(rustFree) {
  if (!rustFree) return;
  for (const p of [path.join(ROOT, '.env'), path.join(API, '.env')]) {
    if (fs.existsSync(p)) continue;
    const secret = 'bootstrap-local-dev-secret-0123456789abcdef';
    fs.writeFileSync(
      p,
      [
        '# 由 scripts/dev-bootstrap.mjs 生成（gitignored）。受限网络环境配置。',
        'MYSQL_DATABASE=oinur',
        'MYSQL_USER=oinur',
        'MYSQL_PASSWORD=oinur',
        'MYSQL_ROOT_PASSWORD=change-me-root',
        `DATABASE_URL="mysql://oinur:oinur@127.0.0.1:${MYSQL_PORT}/oinur"`,
        `JWT_SECRET=${secret}`,
        'BCRYPT_COST=12',
        'PORT=3000',
        'NODE_ENV=development',
        'LOG_LEVEL=info',
        'PRISMA_CLIENT_ENGINE_TYPE=client',
        '',
      ].join('\n'),
    );
    log('已生成', path.relative(ROOT, p));
  }
}

const rustFree = await bootstrapPrisma();
await bootstrapMysql(rustFree);
await ensureEnv(rustFree);
log(`完成 ✅  （node ${process.version}, ${os.platform()} ${os.arch()}）`);
