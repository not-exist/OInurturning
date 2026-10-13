import { Prisma } from '../generated/prisma/client.js';

/**
 * 写路径行锁（FOR UPDATE）的唯一落点：所有行锁 `$queryRaw` 集中在本文件，模块内不再内联。
 * Prisma 查询 API 无 FOR UPDATE 原语，`$queryRaw` 是唯一途径（`$queryRawUnsafe` 被禁用），
 * 仅限模板字符串参数化绑定——禁止字符串拼接 id。
 * 必须传入事务内的 tx 客户端：传入根 prisma 客户端会编译通过，但锁在 autocommit 下即刻释放
 * （Prisma.TransactionClient 结构上兼容根客户端）。
 *
 * 加锁顺序（防死锁）不属于本文件：每个 helper 只锁一张表的一行/一批行，
 * 流程内多张表的加锁次序由调用点保持（如 pvp 为 Tournament → User → Student），
 * 调用点在加锁前对批量 id 去重并升序，保证并发流程以相同顺序排队。
 */

/** 锁 users 行：写事务内串行化同一用户的并发写路径。 */
export async function lockUser(tx: Prisma.TransactionClient, userId: number): Promise<void> {
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
}

/** 锁单个学员行。 */
export async function lockStudent(tx: Prisma.TransactionClient, studentId: number): Promise<void> {
  await tx.$queryRaw`SELECT id FROM Student WHERE id = ${studentId} FOR UPDATE`;
}

/**
 * 批量锁学员行（整支队伍一次性上锁）。lockedIds 必须已去重并按 id 升序（本函数不排序不
 * 去重，顺序语义留在调用点）；空数组时 Prisma.join 直接抛 TypeError，不会生成 SQL，
 * 调用点的 roster 校验已使其不可达。
 */
export async function lockStudentsByIds(
  tx: Prisma.TransactionClient,
  lockedIds: readonly number[],
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM Student WHERE id IN (${Prisma.join(lockedIds)}) FOR UPDATE`;
}

/** 锦标赛行：pvp 流程的加锁起点（Tournament → User → Student）。 */
export async function lockPvpTournament(
  tx: Prisma.TransactionClient,
  tournamentId: number,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM PvpTournament WHERE id = ${tournamentId} FOR UPDATE`;
}

/** 锁招募池行（键列即 userId，非 id）；行不存在时不产生锁。 */
export async function lockRecruitPool(tx: Prisma.TransactionClient, userId: number): Promise<void> {
  await tx.$queryRaw`SELECT userId FROM RecruitPool WHERE userId = ${userId} FOR UPDATE`;
}

/** 锁历练日志行（chooseAdventure：users 行之后加锁）。 */
export async function lockAdventureLog(
  tx: Prisma.TransactionClient,
  adventureId: number,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM AdventureLog WHERE id = ${adventureId} FOR UPDATE`;
}
