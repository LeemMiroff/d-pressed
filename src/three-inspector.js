const TAB_DEFINITIONS = [
  ['flow', 'Поток'],
  ['player', 'Игрок'],
  ['camera', 'Камера'],
  ['lighting', 'Свет'],
  ['presets', 'Пресеты'],
  ['debug', 'Диагностика'],
];

export class ThreeInspector {
  constructor(config, game) {
    this.config = config;
    this.game = game;
    this.root = document.createElement('aside');
    this.root.className = 'inspector';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="inspector__header">
        <strong>Three Inspector</strong>
        <button type="button" data-close aria-label="Закрыть Inspector">×</button>
      </div>
      <p class="inspector__hint">Runtime-настройки Three.js. Нажмите I, чтобы открыть.</p>
      <nav class="inspector__tabs" role="tablist" aria-label="Разделы Inspector">
        ${TAB_DEFINITIONS.map(([id, label], index) => `<button type="button" class="inspector__tab${index === 0 ? ' is-active' : ''}" data-tab="${id}" role="tab" aria-selected="${index === 0}" aria-controls="inspector-panel-${id}">${label}</button>`).join('')}
      </nav>
      <div class="inspector__panels" data-controls-root>
        <section class="inspector__panel is-active" id="inspector-panel-flow" data-panel="flow" role="tabpanel" tabindex="0">
          <label class="inspector__check"><input type="checkbox" data-paired>Двойные платформы</label>
          <label class="inspector__check"><input type="checkbox" data-portals>Порталы в хаб</label>
          <div data-controls="flow"></div>
        </section>
        <section class="inspector__panel" id="inspector-panel-player" data-panel="player" role="tabpanel" tabindex="0">
          <div data-controls="player"></div>
        </section>
        <section class="inspector__panel" id="inspector-panel-camera" data-panel="camera" role="tabpanel" tabindex="0">
          <div data-controls="camera"></div>
        </section>
        <section class="inspector__panel" id="inspector-panel-lighting" data-panel="lighting" role="tabpanel" tabindex="0">
          <label class="inspector__check"><input type="checkbox" data-shadows>Тени</label>
          <div data-controls="lighting"></div>
        </section>
        <section class="inspector__panel" id="inspector-panel-presets" data-panel="presets" role="tabpanel" tabindex="0">
          <div class="inspector__preset">
            <input type="text" data-preset-name placeholder="Имя нового пресета" aria-label="Имя нового пресета">
            <button type="button" data-preset-save>Сохранить</button>
          </div>
          <div class="inspector__preset">
            <select data-preset-list aria-label="Выбранный пресет"></select>
            <button type="button" data-preset-apply>Применить</button>
            <button type="button" data-preset-overwrite>Перезаписать</button>
          </div>
        </section>
        <section class="inspector__panel" id="inspector-panel-debug" data-panel="debug" role="tabpanel" tabindex="0">
          <dl class="inspector__telemetry"></dl>
        </section>
      </div>
      <div class="inspector__actions">
        <button type="button" data-save>Сохранить настройки</button>
        <span data-status aria-live="polite"></span>
      </div>
    `;
    document.body.append(this.root);
    this.controls = this.root.querySelector('[data-controls-root]');
    this.telemetry = this.root.querySelector('.inspector__telemetry');
    this.presets = {};
    this.lastTelemetryAt = 0;
    this.pairedInput = this.root.querySelector('[data-paired]');
    this.portalsInput = this.root.querySelector('[data-portals]');
    this.shadowsInput = this.root.querySelector('[data-shadows]');
    this.panels = Object.fromEntries([...this.root.querySelectorAll('[data-panel]')].map((panel) => [panel.dataset.panel, panel]));

    this.pairedInput.checked = config.platforms.enablePairedPlatforms;
    this.portalsInput.checked = config.platforms.hubPortal.enabled;
    this.shadowsInput.checked = config.lighting?.shadowsEnabled !== false;
    this.pairedInput.addEventListener('change', (event) => {
      config.platforms.enablePairedPlatforms = event.target.checked;
      game.restart(true, false);
    });
    this.portalsInput.addEventListener('change', (event) => {
      config.platforms.hubPortal.enabled = event.target.checked;
      game.restart(true, false);
    });
    this.shadowsInput.addEventListener('change', (event) => {
      config.lighting.shadowsEnabled = event.target.checked;
      game.applyLighting();
    });

    const definitions = [
      ['platforms.initialWorldSpeed', 'Начальная скорость', 1, 120, 1, 'flow'],
      ['platforms.minGap', 'Минимальный зазор', 8, 80, 1, 'flow'],
      ['platforms.maxGap', 'Максимальный зазор', 8, 100, 1, 'flow'],
      ['platforms.minWidth', 'Минимальная ширина', 10, 100, 1, 'flow'],
      ['platforms.maxWidth', 'Максимальная ширина', 10, 110, 1, 'flow'],
      ['platforms.hubPortal.everyPatterns', 'Портал каждые паттерны', 1, 200, 1, 'flow'],
      ['platforms.hubPortal.platformWidthRatio', 'Ширина платформ портала', 0.2, 0.49, 0.01, 'flow'],
      ['player.maxHorizontalSpeed', 'Скорость игрока', 1, 120, 1, 'player'],
      ['player.acceleration', 'Ускорение', 1, 2000, 1, 'player'],
      ['player.braking', 'Торможение', 1, 2000, 1, 'player'],
      ['player.gravity', 'Гравитация', 1, 2000, 1, 'player'],
      ['camera.fov', 'Камера FOV', 35, 80, 1, 'camera'],
      ['camera.tiltDegrees', 'Наклон камеры', 0, 35, 1, 'camera'],
      ['camera.distanceMultiplier', 'Дистанция камеры', 0.7, 1.6, 0.01, 'camera'],
      ['camera.centerOffset', 'Центр камеры', -40, 40, 1, 'camera'],
      ['lighting.ambientIntensity', 'Общий свет', 0, 4, 0.05, 'lighting'],
      ['lighting.keyIntensity', 'Основной свет', 0, 8, 0.05, 'lighting'],
      ['lighting.keyPositionX', 'Основной свет X', -240, 240, 1, 'lighting'],
      ['lighting.keyPositionY', 'Основной свет Y', -240, 360, 1, 'lighting'],
      ['lighting.keyPositionZ', 'Основной свет Z', -240, 360, 1, 'lighting'],
      ['lighting.fillIntensity', 'Заполняющий свет', 0, 500, 1, 'lighting'],
      ['lighting.fillDistance', 'Дальность заполняющего', 20, 600, 1, 'lighting'],
      ['lighting.fillPositionX', 'Заполняющий свет X', -240, 240, 1, 'lighting'],
      ['lighting.fillPositionY', 'Заполняющий свет Y', -240, 360, 1, 'lighting'],
      ['lighting.fillPositionZ', 'Заполняющий свет Z', -240, 360, 1, 'lighting'],
    ];
    definitions.forEach((definition) => this.addControl(...definition));
    this.root.querySelectorAll('[data-tab]').forEach((tab) => tab.addEventListener('click', () => this.activateTab(tab.dataset.tab)));
    this.root.querySelector('[data-close]').addEventListener('click', () => { this.root.hidden = true; });
    this.root.querySelector('[data-save]').addEventListener('click', () => this.save());
    this.root.querySelector('[data-preset-save]').addEventListener('click', () => this.savePreset());
    this.root.querySelector('[data-preset-apply]').addEventListener('click', () => this.applyPreset());
    this.root.querySelector('[data-preset-overwrite]').addEventListener('click', () => this.overwritePreset());
    this.loadPresets();
    window.addEventListener('keydown', (event) => {
      if (event.code !== 'KeyI' || event.repeat) return;
      event.preventDefault();
      this.root.hidden = !this.root.hidden;
      if (!this.root.hidden) this.root.querySelector('.inspector__tab.is-active')?.focus();
    });
  }

  activateTab(tabId) {
    if (!this.panels[tabId]) return;
    this.root.querySelectorAll('[data-tab]').forEach((tab) => {
      const active = tab.dataset.tab === tabId;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    Object.entries(this.panels).forEach(([id, panel]) => panel.classList.toggle('is-active', id === tabId));
  }

  read(path) { return path.split('.').reduce((value, key) => value?.[key], this.config); }

  write(path, value) {
    const keys = path.split('.');
    const target = keys.slice(0, -1).reduce((value, key) => value[key], this.config);
    target[keys.at(-1)] = value;
  }

  addControl(path, label, min, max, step = 1, category = 'flow') {
    const row = document.createElement('label');
    row.className = 'inspector__row';
    row.dataset.path = path;
    row.innerHTML = `<span>${label}</span><input type="number" min="${min}" max="${max}" step="${step}" aria-label="${label}"><input type="range" min="${min}" max="${max}" step="${step}" aria-label="${label}">`;
    const number = row.querySelector('input[type=number]');
    const range = row.querySelector('input[type=range]');
    const update = (source, target) => {
      const value = Math.max(min, Math.min(max, Number(source.value)));
      this.write(path, value);
      source.value = value;
      target.value = value;
      if (path.startsWith('lighting.')) {
        this.game.applyLighting();
        return;
      }
      this.game.resize();
      this.game.restart(true, false);
    };
    number.value = this.read(path);
    range.value = this.read(path);
    number.addEventListener('input', () => update(number, range));
    range.addEventListener('input', () => update(range, number));
    this.root.querySelector(`[data-controls="${category}"]`).append(row);
  }

  captureSettings() {
    const payload = Object.fromEntries([...this.root.querySelectorAll('.inspector__row')].map((row) => [row.dataset.path, Number(row.querySelector('input[type=number]').value)]));
    payload['platforms.enablePairedPlatforms'] = this.pairedInput.checked;
    payload['platforms.hubPortal.enabled'] = this.portalsInput.checked;
    payload['lighting.shadowsEnabled'] = this.shadowsInput.checked;
    return payload;
  }

  async save() {
    const button = this.root.querySelector('[data-save]');
    button.disabled = true;
    const payload = this.captureSettings();
    try { await this.persistSettings(payload); } finally { button.disabled = false; }
  }

  async persistSettings(payload, status = 'Сохранено для всех устройств') {
    const stampedPayload = { ...payload, _savedAt: Date.now() };
    try { localStorage.setItem('d-pressed-inspector-settings', JSON.stringify(stampedPayload)); } catch { /* storage may be unavailable */ }
    try {
      const response = await fetch('/__dpressed/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(stampedPayload) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const verify = await fetch(`./settings.json?verify=${Date.now()}`, { cache: 'no-store' });
      const saved = verify.ok ? await verify.json() : null;
      const matches = saved && Object.entries(stampedPayload).every(([key, value]) => saved[key] === value);
      if (!matches) throw new Error('settings verification failed');
      this.root.querySelector('[data-status]').textContent = status;
    } catch {
      this.root.querySelector('[data-status]').textContent = 'Сохранено только локально: сервер недоступен';
    }
  }

  async loadPresets() {
    try {
      const response = await fetch('/__dpressed/presets', { cache: 'no-store' });
      this.presets = response.ok ? await response.json() : {};
    } catch {
      this.presets = {};
    }
    this.renderPresetList();
  }

  renderPresetList() {
    const list = this.root.querySelector('[data-preset-list]');
    list.innerHTML = Object.keys(this.presets).sort().map((name) => `<option value="${name.replaceAll('"', '&quot;')}">${name}</option>`).join('');
  }

  async persistPresets(status = 'Пресет сохранён в файл') {
    try {
      const response = await fetch('/__dpressed/presets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this.presets) });
      this.root.querySelector('[data-status]').textContent = response.ok ? status : 'Ошибка сохранения пресетов';
    } catch {
      this.root.querySelector('[data-status]').textContent = 'Файловые пресеты доступны в dev-сервере';
    }
  }

  async savePreset() {
    const nameInput = this.root.querySelector('[data-preset-name]');
    const name = nameInput.value.trim();
    if (!name) return;
    this.presets[name] = this.captureSettings();
    nameInput.value = '';
    this.renderPresetList();
    this.root.querySelector('[data-preset-list]').value = name;
    await this.persistPresets();
  }

  async applyPreset() {
    const name = this.root.querySelector('[data-preset-list]').value;
    const values = this.presets[name];
    if (!values) return;
    this.applySettings(values);
    await this.persistSettings(this.captureSettings(), `Применён и сохранён пресет ${name}`);
  }

  async overwritePreset() {
    const name = this.root.querySelector('[data-preset-list]').value;
    if (!name) return;
    this.presets[name] = this.captureSettings();
    await this.persistPresets('Пресет перезаписан в файле');
  }

  applySettings(values) {
    for (const row of this.root.querySelectorAll('.inspector__row')) {
      const value = values[row.dataset.path];
      if (!Number.isFinite(value)) continue;
      this.write(row.dataset.path, value);
      row.querySelector('input[type=number]').value = value;
      row.querySelector('input[type=range]').value = value;
    }
    if (typeof values['platforms.enablePairedPlatforms'] === 'boolean') {
      this.config.platforms.enablePairedPlatforms = values['platforms.enablePairedPlatforms'];
      this.pairedInput.checked = values['platforms.enablePairedPlatforms'];
    }
    if (typeof values['platforms.hubPortal.enabled'] === 'boolean') {
      this.config.platforms.hubPortal.enabled = values['platforms.hubPortal.enabled'];
      this.portalsInput.checked = values['platforms.hubPortal.enabled'];
    }
    if (typeof values['lighting.shadowsEnabled'] === 'boolean') {
      this.config.lighting.shadowsEnabled = values['lighting.shadowsEnabled'];
      this.shadowsInput.checked = values['lighting.shadowsEnabled'];
    }
    this.game.applyLighting();
    this.game.resize();
    this.game.restart(true, false);
  }

  update() {
    const now = performance.now();
    if (now - this.lastTelemetryAt < 100) return;
    this.lastTelemetryAt = now;
    this.telemetry.innerHTML = `<dt>Режим</dt><dd>${this.game.mode}</dd><dt>Скорость потока</dt><dd>${this.game.worldSpeed.toFixed(1)}</dd><dt>Паттерны</dt><dd>${this.game.patternCount}</dd><dt>Кристаллы</dt><dd>${this.game.crystalCount}</dd>`;
  }
}
