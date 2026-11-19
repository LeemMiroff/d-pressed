export const CARD_PRICE = 25;
export const CARD_PRICE_MULTIPLIER = 1.2;
export const REROLL_PRICE = 2;

export const RUN_CARDS = Object.freeze([
  { id: 'magnet', name: 'Магнит', description: (bonus) => `+${bonus} к дальности подбора.`, bonus: 4 },
  { id: 'damage', name: 'Сильный удар', description: (bonus) => `+${bonus} к урону по врагам.`, bonus: 1 },
  { id: 'bounty', name: 'Награда за победу', description: (bonus) => `+${bonus} крист. за победу над врагом.`, bonus: 1 },
  { id: 'stomp', name: 'Тяжёлое приземление', description: (bonus) => `+${bonus} к урону при прыжке на голову.`, bonus: 1 },
  { id: 'speed', name: 'Быстрые ноги', description: (bonus) => `+${bonus} к скорости бега.`, bonus: 5 },
  { id: 'attackSpeed', name: 'Быстрые удары', description: (bonus) => `+${bonus.toLocaleString('ru-RU')} к числу ударов в секунду.`, bonus: 0.25, bonusStep: 0.25 },
]);

export function drawRunCards(random, previous = [], settings = {}) {
  const pool = RUN_CARDS.filter(({ id }) => settings[id]?.enabled !== false);
  const offers = Array.from({ length: Math.min(3, pool.length) }, () => pool.splice(Math.floor(random() * pool.length), 1)[0]);
  if (pool.length && offers.every((card) => previous.includes(card))) {
    offers[Math.floor(random() * offers.length)] = pool[Math.floor(random() * pool.length)];
  }
  return offers;
}
