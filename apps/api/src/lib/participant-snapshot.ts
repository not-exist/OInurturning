import type { ParticipantSnapshot } from '@oinur/shared';

/**
 * 学员参战快照（HOME 侧）的最小结构化输入：不依赖 Prisma 生成类型，任何含这些字段的行皆可传入。
 * talents 必填是编译期约束——漏 include 属编程错误，由 TS 拦截，而非运行时静默空数组或 TypeError；
 * 零天赋学员合法，产出 traits: []（快照契约允许空数组，NPC 快照亦为 []）。
 */
export interface ParticipantStudentInput {
  userId: number;
  id: number;
  name: string;
  ds: number;
  dp: number;
  math: number;
  graph: number;
  greedy: number;
  str: number;
  code: number;
  thinking: number;
  setting: number;
  mindset: number;
  focusCap: number;
  energy: number;
  energyMax: number;
  talents: readonly { talentId: string }[];
}

/**
 * adventure/story/pvp 三处学员参战快照的统一构造。字面键序仅对照 participantSnapshotSchema
 * 的字段顺序以便阅读；序列化（stableSerialize）先对键排序再哈希，golden pin 不依赖插入顺序。
 */
export function participantSnapshot(student: ParticipantStudentInput): ParticipantSnapshot {
  return {
    side: 'HOME',
    userId: student.userId,
    studentId: student.id,
    displayName: student.name,
    abilities: {
      DS: student.ds,
      DP: student.dp,
      MATH: student.math,
      GRAPH: student.graph,
      GREEDY: student.greedy,
      STRING: student.str,
      CODING: student.code,
      THINKING: student.thinking,
      PROBLEM: student.setting,
    },
    traits: student.talents.map((talent) => ({ traitId: talent.talentId })),
    mindset: student.mindset,
    focusCap: student.focusCap,
    energy: student.energy,
    energyMax: student.energyMax,
  };
}
