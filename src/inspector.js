const CONTROLS = [
  { path: ['platforms', 'initialWorldSpeed'], label: 'Начальная скорость платформ', min: 0, max: 300, step: 0.1 },
  { path: ['platforms', 'targetWorldSpeedTime'], label: 'Время до максимальной скорости', min: 10, max: 900, step: 1 },
  { path: ['platforms', 'maxWorldSpeed'], label: 'Максимальная скорость платформ', min: 1, max: 300, step: 0.5 },
  { path: ['platforms', 'minGap'], label: 'Минимальный зазор', min: 0, max: 100, step: 1 },
  { path: ['platforms', 'maxGap'], label: 'Максимальный зазор', min: 0, max: 120, step: 1 },
  { path: ['platforms', 'minWidth'], label: 'Минимальный размер одиночной платформы', min: 8, max: 120, step: 1 },
  { path: ['platforms', 'maxWidth'], label: 'Максимальный размер одиночной платформы', min: 8, max: 120, step: 1 },
  { path: ['platforms', 'earlySingleMinWidth'], label: 'Начальный минимальный размер платформы', min: 8, max: 120, step: 1 },
  { path: ['platforms', 'earlySingleMaxWidth'], label: 'Начальный максимальный размер платформы', min: 8, max: 120, step: 1 },
  { path: ['platforms', 'platformProgressionDuration'], label: 'Время перехода к стандартному размеру', min: 10, max: 600, step: 1 },
  { path: ['player', 'maxHorizontalSpeed'], label: 'Скорость игрока', min: 1, max: 200, step: 1 },
  { path: ['player', 'acceleration'], label: 'Ускорение игрока', min: 1, max: 2000, step: 1 },
  { path: ['player', 'braking'], label: 'Торможение игрока', min: 1, max: 2000, step: 1 },
  { path: ['player', 'gravity'], label: 'Гравитация', min: 1, max: 2000, step: 1 },
];
const STORAGE_KEY = 'd-pressed-inspector-settings';
const PRESETS_KEY = 'd-pressed-flow-presets';

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
    if (typeof saved['platforms.enablePairedPlatforms'] === 'boolean') config.platforms.enablePairedPlatforms = saved['platforms.enablePairedPlatforms'];
  } catch {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      for (const definition of CONTROLS) {
        const value = saved[definition.path.join('.')];
        if (Number.isFinite(value)) write(config, definition.path, value);
      }
      if (typeof saved['player.showHitbox'] === 'boolean') config.player.showHitbox = saved['player.showHitbox'];
      if (typeof saved['platforms.enablePairedPlatforms'] === 'boolean') config.platforms.enablePairedPlatforms = saved['platforms.enablePairedPlatforms'];
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
    this.restartTimer = null;
    this.root = document.createElement('aside');
    this.root.className = 'inspector';
    this.root.hidden = true;
    this.root.innerHTML = '<div class="inspector__header"><strong>Инспектор</strong><button type="button" data-close>×</button></div><p class="inspector__hint">Состояние потока настраивается в логических единицах мира.</p><details open><summary>Состояние потока</summary><label class="inspector__check"><input type="checkbox" data-paired>Использовать двойные платформы</label><label class="inspector__check"><input type="checkbox" data-hitbox>Показывать hitbox</label><div class="inspector__controls"></div></details><details open><summary>Пресеты</summary><div class="inspector__preset"><input type="text" data-preset-name placeholder="Название пресета"><button type="button" data-preset-save>Сохранить</button></div><div class="inspector__preset"><select data-preset-list></select><button type="button" data-preset-load>Применить</button><button type="button" data-preset-delete>Удалить</button></div></details><div class="inspector__actions"><button type="button" data-save>Сохранить настройки</button><span data-status></span></div><dl class="inspector__telemetry"></dl>';
    document.body.append(this.root);

    const controls = this.root.querySelector('.inspector__controls');
    const hitbox = this.root.querySelector('[data-hitbox]');
    const paired = this.root.querySelector('[data-paired]');
    const presetName = this.root.querySelector('[data-preset-name]');
    const presetList = this.root.querySelector('[data-preset-list]');
    hitbox.checked = config.player.showHitbox;
    paired.checked = config.platforms.enablePairedPlatforms;
    paired.addEventListener('change', () => {
      config.platforms.enablePairedPlatforms = paired.checked;
      game.restart(true);
    });
    this.presets = this.readPresets();
    this.renderPresetList();
    this.root.querySelector('[data-preset-save]').addEventListener('click', () => {
      const name = presetName.value.trim();
      if (!name) return;
      this.presets[name] = this.captureSettings();
      this.writePresets();
      this.renderPresetList();
      presetList.value = name;
      presetName.value = '';
    });
    this.root.querySelector('[data-preset-load]').addEventListener('click', () => {
      const values = this.presets[presetList.value];
      if (values) this.applySettings(values);
    });
    this.root.querySelector('[data-preset-delete]').addEventListener('click', () => {
      if (!presetList.value) return;
      delete this.presets[presetList.value];
      this.writePresets();
      this.renderPresetList();
    });
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
        if (definition.path[0] === 'platforms' && ['minWidth', 'maxWidth', 'minGap', 'maxGap'].includes(definition.path[1])) {
          this.schedulePlatformRegeneration();
        }
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
    values['platforms.enablePairedPlatforms'] = this.root.querySelector('[data-paired]').checked;
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

  captureSettings() {
    return {
      ...Object.fromEntries(this.rows.map(({ input, definition }) => [definition.path.join('.'), Number(input.value)])),
      'platforms.enablePairedPlatforms': this.root.querySelector('[data-paired]').checked,
    };
  }

  schedulePlatformRegeneration() {
    window.clearTimeout(this.restartTimer);
    this.restartTimer = window.setTimeout(() => this.game.restart(true), 180);
  }

  applySettings(values) {
    for (const row of this.rows) {
      const value = values[row.definition.path.join('.')];
      if (!Number.isFinite(value)) continue;
      write(this.config, row.definition.path, value);
      row.input.value = value;
    }
    if (typeof values['platforms.enablePairedPlatforms'] === 'boolean') {
      this.config.platforms.enablePairedPlatforms = values['platforms.enablePairedPlatforms'];
      this.root.querySelector('[data-paired]').checked = this.config.platforms.enablePairedPlatforms;
    }
    this.game.restart(true);
  }

  readPresets() {
    try {
      const value = JSON.parse(localStorage.getItem(PRESETS_KEY) || '{}');
      return value && typeof value === 'object' ? value : {};
    } catch {
      return {};
    }
  }

  writePresets() {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(this.presets));
  }

  renderPresetList() {
    const list = this.root.querySelector('[data-preset-list]');
    list.innerHTML = '<option value="">Выберите пресет</option>';
    for (const name of Object.keys(this.presets).sort()) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      list.append(option);
    }
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
