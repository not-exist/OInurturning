import { describe, expect, it } from 'vitest';
import { eventConfigSchema, type EventConfig } from '@oinur/shared';
import { getEventConfig, importConfigs } from '../src/config/loader.js';
import {
  drawAdventureEvent,
  listEligibleAdventureEvents,
  type AdventureEventDrawContext,
} from '../src/modules/adventure/extractor.js';

const baseEvent: EventConfig = {
  id: 'evt-test-gray',
  code: 'G1',
  name: '测试事件',
  category: 'trial',
  rarity: 'gray',
  stamina_cost: 1,
  repeatable: true,
  cooldown_days: 0,
  weight: 100,
  requirements: null,
  description: '测试用事件。',
  choices: [{ text: '开始', outcomes: [{ weight: 100, type: 'fixed', rewards: {} }] }],
};

function makeEvent(overrides: Partial<EventConfig>): EventConfig {
  return eventConfigSchema.parse({ ...baseEvent, ...overrides });
}

function context(overrides: Partial<AdventureEventDrawContext> = {}): AdventureEventDrawContext {
  return {
    availableStamina: 5,
    investment: 1,
    reputation: 0,
    sixMax: 1,
    now: new Date('2026-09-02T12:00:00.000Z'),
    rng: () => 0,
    ...overrides,
  };
}

describe('M3 event configuration', () => {
  it('imports all 40 events into the frozen config bundle', async () => {
    const bundle = await importConfigs();

    expect(Object.keys(bundle.events)).toHaveLength(40);
    expect(getEventConfig('evt-g1-signin-warmup')).toMatchObject({
      code: 'G1',
      stamina_cost: 1,
      rarity: 'gray',
    });
    expect(Object.isFrozen(bundle.events)).toBe(true);
    expect(Object.isFrozen(bundle.events['evt-g1-signin-warmup'])).toBe(true);
    expect(Object.isFrozen(bundle.events['evt-g1-signin-warmup']?.choices)).toBe(true);
  });
});

describe('adventure event extractor', () => {
  it('filters exact investment layer, requirements, cooldown and limits', () => {
    const events = [
      baseEvent,
      makeEvent({ id: 'evt-test-cost-two', code: 'Y1', stamina_cost: 2, rarity: 'yellow' }),
      makeEvent({
        id: 'evt-test-reputation',
        code: 'Y2',
        rarity: 'yellow',
        requirements: { min_reputation: 50 },
      }),
      makeEvent({
        id: 'evt-test-cooldown',
        code: 'Y3',
        rarity: 'yellow',
        cooldown_days: 1,
      }),
      makeEvent({
        id: 'evt-test-once',
        code: 'Y4',
        rarity: 'yellow',
        once_per_student: true,
        repeatable: false,
      }),
      makeEvent({
        id: 'evt-test-weekly',
        code: 'Y5',
        rarity: 'yellow',
        repeatable: false,
        server_weekly_limit: 2,
      }),
    ];
    const eligible = listEligibleAdventureEvents(
      events,
      context({
        reputation: 10,
        lastTriggeredAtByEvent: new Map([
          ['evt-test-cooldown', new Date('2026-09-02T12:00:00.000Z')],
        ]),
        oncePerStudentEventIds: new Set(['evt-test-once']),
        weeklyUsageByEvent: new Map([['evt-test-weekly', 2]]),
      }),
    );

    expect(eligible.map((event) => event.id)).toEqual(['evt-test-gray']);
  });

  it('re-normalizes to an available rarity when the preferred group is filtered out', () => {
    const events = [
      makeEvent({ id: 'evt-test-gray', code: 'G1', rarity: 'gray', cooldown_days: 1 }),
      makeEvent({ id: 'evt-test-yellow', code: 'Y1', rarity: 'yellow' }),
    ];
    const selected = drawAdventureEvent(
      events,
      context({
        lastTriggeredAtByEvent: new Map([
          ['evt-test-gray', new Date('2026-09-02T11:00:00.000Z')],
        ]),
      }),
    );

    expect(selected?.id).toBe('evt-test-yellow');
  });

  it('uses stable id ordering for equal weights and honors the invested layer', () => {
    const events = [
      makeEvent({ id: 'evt-test-z', code: 'G2', weight: 50 }),
      makeEvent({ id: 'evt-test-a', code: 'G3', weight: 50 }),
      makeEvent({ id: 'evt-test-cost-two', code: 'Y1', stamina_cost: 2, rarity: 'yellow' }),
    ];

    const selected = drawAdventureEvent(events, context({ availableStamina: 5, investment: 1 }));
    expect(selected?.id).toBe('evt-test-a');
    expect(
      listEligibleAdventureEvents(events, context({ availableStamina: 1, investment: 2 })),
    ).toEqual([]);
  });

  it('rejects an investment that the student cannot afford', () => {
    const selected = drawAdventureEvent(
      [baseEvent],
      context({ availableStamina: 0, investment: 1 }),
    );
    expect(selected).toBeNull();
  });
});
