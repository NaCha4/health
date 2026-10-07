import { z } from 'zod';
import type { FoodItem } from '../../shared/schema.js';
import { AppError } from './health.js';
export interface FoodResult {
  id: string;
  name: string;
  provider: string;
  item: FoodItem;
}
function value(v: unknown): number | null {
  const n = Number(v);
  return v != null && v !== '' && Number.isFinite(n) && n >= 0 ? n : null;
}
export async function searchFood(
  query: string,
  provider: 'usda' | 'mfds',
  keys: { usda?: string; mfds?: string },
): Promise<{ foods: FoodResult[]; provider: string }> {
  z.string().trim().min(2).max(120).parse(query);
  const key = provider === 'usda' ? keys.usda : keys.mfds;
  if (!key)
    throw new AppError(
      503,
      'nutrition_not_configured',
      '영양정보 검색 연결 전입니다. 제품 영양표나 확인한 출처로 직접 기록할 수 있습니다.',
    );
  let response: Response;
  if (provider === 'usda') {
    response = await fetch(
      'https://api.nal.usda.gov/fdc/v1/foods/search?api_key=' + encodeURIComponent(key),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          pageSize: 12,
          dataType: ['Foundation', 'SR Legacy', 'Branded', 'Survey (FNDDS)'],
        }),
        signal: AbortSignal.timeout(12000),
      },
    );
    if (!response.ok)
      throw new AppError(
        502,
        'nutrition_unavailable',
        '영양정보 제공처에 연결할 수 없습니다. 잠시 후 다시 시도하세요.',
      );
    const data = (await response.json()) as {
      foods?: Array<{
        fdcId: number;
        description: string;
        brandOwner?: string;
        foodNutrients?: Array<{ nutrientId: number; value: number; unitName: string }>;
      }>;
    };
    return {
      provider,
      foods: (data.foods ?? []).map((f) => {
        const n = (id: number, unit: string) =>
          value(
            f.foodNutrients?.find((n) => n.nutrientId === id && n.unitName.toLowerCase() === unit)
              ?.value,
          );
        const name = (f.brandOwner ? f.brandOwner + ' · ' : '') + f.description;
        return {
          id: String(f.fdcId),
          name,
          provider,
          item: {
            name,
            quantity: 100,
            unit: 'g',
            basisAmount: 100,
            kcal: n(1008, 'kcal') ?? n(2048, 'kcal') ?? n(2047, 'kcal'),
            protein: n(1003, 'g'),
            carbs: n(1005, 'g'),
            fat: n(1004, 'g'),
            source: {
              kind: 'database',
              title: 'USDA FoodData Central',
              referenceId: String(f.fdcId),
              url: 'https://fdc.nal.usda.gov/food-details/' + f.fdcId + '/nutrients',
              retrievedAt: new Date().toISOString(),
            },
          },
        };
      }),
    };
  }
  const url =
    'https://openapi.foodsafetykorea.go.kr/api/' +
    encodeURIComponent(key) +
    '/I2790/json/1/12/DESC_KOR=' +
    encodeURIComponent(query);
  response = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!response.ok)
    throw new AppError(502, 'nutrition_unavailable', '국내 영양정보 제공처에 연결할 수 없습니다.');
  const data = (await response.json()) as {
    I2790?: { row?: Array<Record<string, string>>; RESULT?: { CODE?: string } };
  };
  const result = data.I2790;
  if (result?.RESULT?.CODE && !['INFO-000', 'INFO-200'].includes(result.RESULT.CODE))
    throw new AppError(
      502,
      'nutrition_unavailable',
      '국내 영양정보 API 응답을 확인할 수 없습니다.',
    );
  return {
    provider,
    foods: (result?.row ?? []).map((f) => {
      // I2790 labels SERVING_SIZE as total package content, but nutrients as per serving.
      // Never silently treat package content as the nutrient denominator or convert ml to g.
      return {
        id: f.FOOD_CD,
        name: f.DESC_KOR,
        provider,
        item: {
          name: f.DESC_KOR,
          quantity: 1,
          unit: 'serving',
          basisAmount: 1,
          kcal: n(f.NUTR_CONT1),
          protein: n(f.NUTR_CONT3),
          carbs: n(f.NUTR_CONT2),
          fat: n(f.NUTR_CONT4),
          source: {
            kind: 'database',
            title: '식약처 식품영양성분 DB I2790',
            referenceId: f.FOOD_CD,
            url: 'https://various.foodsafetykorea.go.kr/nutrient/',
            retrievedAt: new Date().toISOString(),
            assumptions: `영양값은 API의 1회 제공량 기준. 실제 섭취한 제공량 수를 확인하세요. 총내용량 ${f.SERVING_SIZE || '미상'} ${f.SERVING_UNIT || ''}를 1회 제공량이나 g으로 자동 환산하지 않았습니다.`,
          },
        } as FoodItem,
      };
    }),
  };
}
const n = value;
