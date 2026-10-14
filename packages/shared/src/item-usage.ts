/**
 * 道具使用白名单与限额常量（**服务端与前端共用的唯一真源**）。
 *
 * 单独成模块且不 import zod：前端经 `@oinur/shared/item-usage` 子路径直接引用本文件，
 * 避免把 config 目录下的 zod schema 打进浏览器包（实测 +82KB）。
 *
 * 背景：前端曾自行维护一份「可用道具」硬编码白名单，漏掉 drumstick-bento，
 * 导致每关首通产出的稀缺食物在背包里显示「暂不可用」。白名单必须只有一处。
 */

/** POST /api/items/use 的每日/每人限额（数值权威：docs/systems/student.md §8） */
export const ITEM_USE_LIMITS = {
  /** 奶茶：每日 2 杯（04:00 日界） */
  milkTeaDaily: 2,
  /** 浓咖啡：每日 2 杯（04:00 日界） */
  coffeeDaily: 2,
  /** 体力药水：每日 1 瓶（04:00 日界） */
  staminaPotionDaily: 1,
  /** 心流引擎：每人 1 台 */
  focusEngineMaxUses: 1,
  /** 直用书：单学员 × 单属性 × 每周增益点数上限（不是「每周 N 本书」） */
  bookWeekCap: 10,
} as const;

/** 直接使用类书籍的科目（coding → code 列）；六维书是定向训练耗材，不可直用 */
export const DIRECT_BOOK_SUBJECTS = ['thinking', 'coding', 'setting'] as const;

/** 直用书档位：灰黄绿蓝紫（无彩档） */
export const DIRECT_BOOK_RARITIES = ['gray', 'yellow', 'green', 'blue', 'purple'] as const;

/**
 * 可通过 POST /api/items/use 直接使用的道具（81 件中 21 件）。
 * 不在表内的道具一律返回 400「该道具暂不可用」：
 * - vigor-drink（精力药剂）：energy_restore 属比赛场景，M1 无赛事；
 * - rename-card：改名走 POST /api/students/:id/rename；
 * - 其余 58 件（升阶石/洗练券/礼盒/徽章/tag 类/六维书等）留待后续里程碑。
 */
export const USABLE_ITEM_IDS: readonly string[] = [
  'calm-pill',
  'milk-tea',
  'stamina-potion',
  'drumstick-bento',
  'coffee',
  'focus-engine',
  ...DIRECT_BOOK_SUBJECTS.flatMap((subject) =>
    DIRECT_BOOK_RARITIES.map((rarity) => `book-${subject}-${rarity}`),
  ),
];

export const USABLE_ITEM_ID_SET: ReadonlySet<string> = new Set(USABLE_ITEM_IDS);
