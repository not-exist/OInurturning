/**
 * 幂等键 → 响应的内存缓存（TTL 10 分钟）。
 *
 * 依据 `docs/TECH-DESIGN.md` §12 T8：高代价写端点接受 **可选** 的 `Idempotency-Key`
 * 请求头，服务端记录 key→响应，重放返回原响应而非重复执行；单实例部署下内存方案足够
 * （多实例部署需换成 Redis/DB，届时可只替换本文件）。
 *
 * 设计要点：
 * - **失败不入缓存**：只有成功结果才记录，否则一次 409/400 会把后续合法重试也变成重放。
 * - **键必须带请求指纹**：同样的 key 搭配不同的请求体应视为不同操作（见下方 scope 说明）。
 * - 淘汰策略：过期即删 + 超过容量删最久未用（LRU：命中即刷新 recency）。
 *
 * 并发合并：**同一个 key 的并发请求共享同一次执行**（in-flight 去重），副作用恰好一次；
 * 多实例部署时需在业务侧用 DB 唯一键兜底（如剧情的 `ContestRecord.idempotencyKey` 那样）。
 */

const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 1000;

interface Entry {
  expiresAt: number;
  value: unknown;
}

const store = new Map<string, Entry>();
/** 在途执行表：同 key 的并发请求合并到同一次 fn 执行上 */
const inFlight = new Map<string, Promise<unknown>>();

function evict(now: number): void {
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key);
  }
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next();
    if (oldest.done === true) break;
    store.delete(oldest.value);
  }
}

/**
 * 以 `key` 为幂等键执行 `fn`。
 *
 * **调用方必须把「操作指纹」拼进 key**（例如 `shop:buy:<userId>:<幂等键>:<itemId>:<数量>`），
 * 否则"同一个 key 换了个请求体"会被误判成重放。
 *
 * @param key 幂等键；不传表示不启用幂等（直接执行）
 * @param fn 真正执行的操作；仅在未命中缓存时调用
 */
export async function runIdempotent<T>(key: string | undefined, fn: () => Promise<T>): Promise<T> {
  if (key === undefined) return fn();
  const now = Date.now();
  const hit = store.get(key);
  if (hit !== undefined && hit.expiresAt > now) {
    // delete+set 刷新 recency：Map 按插入序迭代，命中即把该键移到最新，淘汰才是真 LRU
    store.delete(key);
    store.set(key, hit);
    return hit.value as T;
  }
  // 已有同 key 的执行在途：共享它，不重复执行（如重复扣款）
  const pending = inFlight.get(key);
  if (pending) return pending as Promise<T>;
  const exec: Promise<T> = fn()
    .then((value) => {
      // 成功才入缓存；失败不入缓存，各并发调用方收到同一 rejection
      store.set(key, { expiresAt: Date.now() + TTL_MS, value });
      evict(now);
      return value;
    })
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, exec);
  return exec;
}

/** 仅供测试使用：清空缓存与在途合并表（避免用例之间互相命中）。 */
export function resetIdempotencyStore(): void {
  store.clear();
  inFlight.clear();
}
