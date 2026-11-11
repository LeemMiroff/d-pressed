const CONTROLS = [
  { path: ['platforms', 'initialWorldSpeed'], label: 'Начальная скорость платформ', min: 0, max: 300, step: 0.1 },
  { path: ['platforms', 'worldSpeedIncrease'], label: 'Ускорение мира', min: 0, max: 3, step: 0.01 },
  { path: ['platforms', 'maxWorldSpeed'], label: 'Максимальная скорость платформ', min: 1, max: 300, step: 0.5 },
  { path: ['platforms', 'minGap'], label: 'Минимальный зазор', min: 0, max: 100, step: 1 },
  { path: ['platforms', 'maxGap'], label: 'Максимальный зазор', min: 0, max: 120, step: 1 },
  { path: ['player', 'maxHorizontalSpeed'], label: 'Скорость игрока', min: 1, max: 200, step: 1 },
  { path: ['player', 'acceleration'], label: 'Ускорение игрока', min: 1, max: 2000, step: 1 },
  { path: ['player', 'braking'], label: 'Торможение игрока', min: 1, max: 2000, step: 1 },
  { path: ['player', 'gravity'], label: 'Гравитация', min: 1, max: 2000, step: 1 },
];
const STORAGE_KEY = 'd-pressed-inspector-settings';

function read(config, path) {
  return config[path[0]][path[1]];
}

function write(config, path, value) {
  config[path[0]][path[1]] = value;
}

export async function loadSavedConfig(config) {
  try {
    const response = await fetch('/settings.json', { cache: 'no-store' });
    const saved = response.ok ? await response.json() : {};
    for (const definition of CONTROLS) {
      const value = saved[definition.path.join('.')];
      if (Number.isFinite(value)) {
        write(config, definition.path, value);
      }
    }
    if (typeof saved['player.showHitbox'] === 'boolean') config.player.showHitbox = saved['player.showHitbox'];
  } catch {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      for (const definition of CONTROLS) {
        const value = saved[definition.path.join('.')];
        if (Number.isFinite(value)) write(config, definition.path, value);
      }
      if (typeof saved['player.showHitbox'] === 'boolean') config.player.showHitbox = saved['player.showHitbox'];
    } catch {
      // Повреждённые или недоступные настройки не должны мешать запуску игры.
    }
  }
}

export class Inspector {
  constructor(config, game) {
    this.config = config;
    this.game = game;
    this.rows = [];
    this.root = document.createElement('aside');
    this.root.className = 'inspector';
    this.root.hidden = true;
    this.root.innerHTML = '<div class="inspector__header"><strong>Инспектор</strong><button type="button" data-close>×</button></div><p class="inspector__hint">Значения указаны в логических единицах мира.</p><label class="inspector__check"><input type="checkbox" data-hitbox>Показывать hitbox</label><div class="inspector__controls"></div><div class="inspector__actions"><button type="button" data-save>Сохранить настройки</button><span data-status></span></div><dl class="inspector__telemetry"></dl>';
    document.body.append(this.root);

    const controls = this.root.querySelector('.inspector__controls');
    const hitbox = this.root.querySelector('[data-hitbox]');
    hitbox.checked = config.player.showHitbox;
    hitbox.addEventListener('change', () => game.setHitboxVisible(hitbox.checked));
    for (const definition of CONTROLS) {
      const row = document.createElement('label');
      row.className = 'inspector__row';
      row.innerHTML = `<span>${definition.label}</span><input class="inspector__number" type="number" min="${definition.min}" max="${definition.max}" step="${definition.step}"><input class="inspector__range" type="range" min="${definition.min}" max="${definition.max}" step="${definition.step}">`;
      const numberInput = row.querySelector('.inspector__number');
      const rangeInput = row.querySelector('.inspector__range');
      const initialValue = read(config, definition.path);
      numberInput.value = initialValue;
      rangeInput.value = initialValue;
      const updateValue = (source, target) => {
        const rawValue = Number(source.value);
        if (!Number.isFinite(rawValue)) return;
        const value = Math.max(definition.min, Math.min(definition.max, rawValue));
        write(config, definition.path, value);
        source.value = value;
        target.value = value;
      };
      rangeInput.addEventListener('input', () => updateValue(rangeInput, numberInput));
      numberInput.addEventListener('input', () => updateValue(numberInput, rangeInput));
      controls.append(row);
      this.rows.push({ input: numberInput, definition });
    }

    this.root.querySelector('[data-close]').addEventListener('click', () => this.hide());
    this.root.querySelector('[data-save]').addEventListener('click', () => this.save());
    window.addEventListener('keydown', (event) => {
      if (event.code === 'KeyI' && !event.repeat) {
        event.preventDefault();
        this.toggle();
      }
    });
  }

  toggle() {
    this.root.hidden = !this.root.hidden;
  }

  hide() {
    this.root.hidden = true;
  }

  async save() {
    const values = Object.fromEntries(this.rows.map(({ input, definition }) => [definition.path.join('.'), Number(input.value)]));
    values['player.showHitbox'] = this.root.querySelector('[data-hitbox]').checked;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
    const status = this.root.querySelector('[data-status]');
    try {
      const response = await fetch('/__dpressed/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      status.textContent = response.ok ? 'Сохранено для всех устройств' : 'Сохранено локально';
    } catch {
      status.textContent = 'Сохранено локально';
    }
    window.setTimeout(() => { status.textContent = ''; }, 2000);
  }

  update() {
    const player = this.game.player;
    const maxReach = this.config.player.maxHorizontalSpeed * Math.sqrt((2 * this.config.platforms.maxGap) / this.config.player.gravity) + 8;
    this.root.querySelector('.inspector__telemetry').innerHTML = `
      <dt>Скорость мира</dt><dd>${this.game.worldSpeed.toFixed(2)}</dd>
      <dt>Дальность при макс. зазоре</dt><dd>${maxReach.toFixed(1)}</dd>
      <dt>Игрок X / Y</dt><dd>${player.x.toFixed(1)} / ${player.y.toFixed(1)}</dd>
      <dt>Игрок VX / VY</dt><dd>${player.vx.toFixed(1)} / ${player.vy.toFixed(1)}</dd>`;
  }
}
