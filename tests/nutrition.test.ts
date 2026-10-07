import { afterEach, it, expect, vi } from 'vitest';
import { searchFood } from '../functions/src/nutrition.js';
afterEach(() => vi.unstubAllGlobals());
it('서버키가 없으면 미구성 오류를 명시한다', async () => {
  await expect(searchFood('rice', 'usda', {})).rejects.toMatchObject({
    code: 'nutrition_not_configured',
  });
});
it('USDA의 Atwater 에너지와 100g 기준을 보존한다', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        foods: [
          {
            fdcId: 123,
            description: 'Fixture',
            foodNutrients: [
              { nutrientId: 2048, value: 150, unitName: 'KCAL' },
              { nutrientId: 1003, value: 5, unitName: 'G' },
            ],
          },
        ],
      }),
    })),
  );
  const r = await searchFood('fixture', 'usda', { usda: 'fixture-only' });
  expect(r.foods[0].item).toMatchObject({
    unit: 'g',
    basisAmount: 100,
    kcal: 150,
    protein: 5,
    carbs: null,
  });
});
it('식약처 총내용량을 1회 제공량이나 g으로 오인하지 않는다', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        I2790: {
          RESULT: { CODE: 'INFO-000' },
          row: [
            {
              FOOD_CD: 'fixture',
              DESC_KOR: 'Fixture drink',
              SERVING_SIZE: '1000',
              SERVING_UNIT: 'ml',
              NUTR_CONT1: '120',
              NUTR_CONT3: 'N/A',
            },
          ],
        },
      }),
    })),
  );
  const r = await searchFood('fixture', 'mfds', { mfds: 'fixture-only' });
  expect(r.foods[0].item).toMatchObject({
    unit: 'serving',
    quantity: 1,
    basisAmount: 1,
    kcal: 120,
    protein: null,
  });
  expect(r.foods[0].item.source.assumptions).toContain('1000 ml');
});
