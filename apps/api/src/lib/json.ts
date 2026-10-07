import type { Prisma } from '../generated/prisma/client.js';

/** Cast a Prisma `Json` column value (read side) to its domain type. */
export function jsonValue<T>(value: Prisma.JsonValue): T {
  return value as unknown as T;
}

function encodeStable(value: unknown, active: WeakSet<object>): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('Cannot serialize non-finite numbers');
      return JSON.stringify(value);
    case 'undefined':
      throw new TypeError('Cannot serialize undefined values');
    case 'function':
      throw new TypeError('Cannot serialize function values');
    case 'symbol':
      throw new TypeError('Cannot serialize symbol values');
    case 'bigint':
      throw new TypeError('Cannot serialize bigint values');
    case 'object':
      break;
  }

  const object = value as object;
  if (active.has(object)) throw new TypeError('Cannot serialize cyclic values');
  active.add(object);

  let result: string;
  if (Array.isArray(value)) {
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === 'symbol')
        throw new TypeError('Cannot serialize symbol-keyed array properties');
      if (key === 'length') continue;

      const index = Number(key);
      if (!Number.isInteger(index) || index < 0 || index >= value.length || String(index) !== key) {
        throw new TypeError('Cannot serialize non-index array own properties');
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor?.get !== undefined || descriptor?.set !== undefined) {
        throw new TypeError('Cannot serialize accessor properties');
      }
    }

    const entries: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index))
        throw new TypeError('Cannot serialize sparse arrays');
      entries.push(encodeStable(value[index], active));
    }
    result = `[${entries.join(',')}]`;
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Cannot serialize non-plain objects');
    }
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === 'symbol') throw new TypeError('Cannot serialize symbol-keyed properties');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor?.enumerable !== true)
        throw new TypeError('Cannot serialize non-enumerable properties');
      if (descriptor?.get !== undefined || descriptor?.set !== undefined) {
        throw new TypeError('Cannot serialize accessor properties');
      }
    }

    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${encodeStable(record[key], active)}`);
    result = `{${entries.join(',')}}`;
  }

  active.delete(object);
  return result;
}

export function stableSerialize(value: unknown): string {
  return encodeStable(value, new WeakSet<object>());
}

/**
 * 写入侧唯一边界（T5）：断言 value 能原样通过 JSON 存储，再以 Prisma 输入类型返回。
 * Throws unless the value survives JSON storage unchanged (no undefined members,
 * non-finite numbers, cycles, accessors, sparse arrays, or non-plain objects).
 *
 * 仅用于载荷可证明 JSON 安全的调用方（引擎产物、重建后的 PrizeConfig、participantSnapshot 等）。
 * 载荷来自未收窄外部输入（配置 loose 未知键、管理端 z.unknown() 请求体）的站点不得改用本函数：
 * Prisma 对非 JSON 安全值是静默容错（Infinity→null、undefined 键丢弃、Date→ISO 串、bigint→字符串），
 * 强行断言会把「写入 null」变成「请求/导入失败」，属行为变更——这些站点保留裸 cast 并注释原因。
 */
export function jsonWrite(value: unknown): Prisma.InputJsonValue {
  stableSerialize(value);
  return value as Prisma.InputJsonValue;
}
