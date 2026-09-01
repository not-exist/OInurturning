import {
  rankingReportSchema,
  type ContestSummary,
  type QuestionSnapshot,
  type RankingReport,
} from '@oinur/shared';

export const ENGINE_VERSION = 'ranking-v1' as const;
export const PASS_RANK_MAX = 8 as const;

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

export function stableHash(value: unknown): string {
  const serialized = stableSerialize(value);
  let hash = 0x811c9dc5;

  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function validateRankingReport(report: RankingReport): RankingReport {
  return rankingReportSchema.parse(report);
}

export function serializeRankingReport(report: RankingReport): string {
  return stableSerialize(validateRankingReport(report));
}

export function isPassingRank(rank: number): boolean {
  return Number.isInteger(rank) && rank >= 1 && rank <= PASS_RANK_MAX;
}

export function buildContestSummary(report: RankingReport): ContestSummary {
  const playerStanding = report.standings.find((standing) => standing.participantIndex === 0);
  if (playerStanding === undefined)
    throw new Error('Ranking report is missing the player standing');

  return {
    format: 'RANKING',
    rank: playerStanding.rank,
    participantCount: report.participants.length,
    totalScore: playerStanding.totalScore,
    rewards: report.rewards.map((reward) => ({ ...reward })),
    growth: report.growth.map((delta) => ({ ...delta })),
  };
}

export function cloneQuestionSnapshot(question: QuestionSnapshot): QuestionSnapshot {
  return {
    ...question,
    traits: question.traits.map((trait) => ({
      ...trait,
      hooks: trait.hooks.map((hook) => ({ ...hook })),
    })),
  };
}
