export class ThreeInspector {
  constructor(config, game) {
    this.config = config;
    this.game = game;
    this.root = document.createElement('aside');
    this.root.className = 'inspector';
    this.root.hidden = true;
    this.root.innerHTML = '<div class="inspector__header"><strong>Three Inspector</strong><button type="button" data-close>×</button></div><p class="inspector__hint">Runtime-настройки Three.js. Нажмите I, чтобы открыть.</p><label class="inspector__check"><input type="checkbox" data-paired>Двойные платформы</label><label class="inspector__check"><input type="checkbox" data-portals>Порталы в хаб</label><div data-controls></div><div class="inspector__actions"><button type="button" data-save>Сохранить на сервер</button><span data-status></span></div><details open><summary>Пресеты</summary><div class="inspector__preset"><input type="text" data-preset-name placeholder="Имя нового пресета"><button type="button" data-preset-save>Сохранить</button></div><div class="inspector__preset"><select data-preset-list></select><button type="button" data-preset-apply>Применить</button><button type="button" data-preset-overwrite>Перезаписать</button></div></details><dl class="inspector__telemetry"></dl>';
    document.body.append(this.root);
    this.controls = this.root.querySelector('[data-controls]');
    this.telemetry = this.root.querySelector('.inspector__telemetry');
    this.presets = {};
    this.lastTelemetryAt = 0;
    this.root.querySelector('[data-paired]').checked = config.platforms.enablePairedPlatforms;
    this.root.querySelector('[data-portals]').checked = config.platforms.hubPortal.enabled;
    this.root.querySelector('[data-paired]').addEventListener('change', (event) => { config.platforms.enablePairedPlatforms = event.target.checked; game.restart(true, false); });
    this.root.querySelector('[data-portals]').addEventListener('change', (event) => { config.platforms.hubPortal.enabled = event.target.checked; game.restart(true, false); });
    const definitions = [
      ['platforms.initialWorldSpeed', 'Начальная скорость', 1, 120],
      ['platforms.minGap', 'Минимальный зазор', 8, 80],
      ['platforms.maxGap', 'Максимальный зазор', 8, 100],
      ['platforms.minWidth', 'Минимальная ширина', 10, 100],
      ['platforms.maxWidth', 'Максимальная ширина', 10, 110],
      ['platforms.hubPortal.everyPatterns', 'Портал каждые паттерны', 1, 200, 1],
      ['platforms.hubPortal.platformWidthRatio', 'Ширина платформ портала', 0.2, 0.49, 0.01],
      ['player.maxHorizontalSpeed', 'Скорость игрока', 1, 120],
      ['player.acceleration', 'Ускорение', 1, 2000],
      ['player.braking', 'Торможение', 1, 2000],
      ['player.gravity', 'Гравитация', 1, 2000],
      ['camera.fov', 'Камера FOV', 35, 80, 1],
      ['camera.tiltDegrees', 'Наклон камеры', 0, 35, 1],
      ['camera.distanceMultiplier', 'Дистанция камеры', 0.7, 1.6, 0.01],
      ['camera.centerOffset', 'Центр камеры', -40, 40, 1],
    ];
    definitions.forEach((definition) => this.addControl(...definition));
    this.root.querySelector('[data-close]').addEventListener('click', () => { this.root.hidden = true; });
    this.root.querySelector('[data-save]').addEventListener('click', () => this.save());
    this.root.querySelector('[data-preset-save]').addEventListener('click', () => this.savePreset());
    this.root.querySelector('[data-preset-apply]').addEventListener('click', () => this.applyPreset());
    this.root.querySelector('[data-preset-overwrite]').addEventListener('click', () => this.overwritePreset());
    this.loadPresets();
    window.addEventListener('keydown', (event) => { if (event.code === 'KeyI' && !event.repeat) { event.preventDefault(); this.root.hidden = !this.root.hidden; } });
  }

  read(path) { return path.split('.').reduce((value, key) => value?.[key], this.config); }
  write(path, value) { const keys = path.split('.'); const target = keys.slice(0, -1).reduce((value, key) => value[key], this.config); target[keys.at(-1)] = value; }

  addControl(path, label, min, max, step = 1) {
    const row = document.createElement('label');
    row.className = 'inspector__row';
    row.dataset.path = path;
    row.innerHTML = `<span>${label}</span><input type="number" min="${min}" max="${max}" step="${step}"><input type="range" min="${min}" max="${max}" step="${step}">`;
    const number = row.querySelector('input[type=number]');
    const range = row.querySelector('input[type=range]');
    const update = (source, target) => { const value = Math.max(min, Math.min(max, Number(source.value))); this.write(path, value); source.value = value; target.value = value; this.game.resize(); this.game.restart(true, false); };
    number.value = this.read(path);
    range.value = this.read(path);
    number.addEventListener('input', () => update(number, range));
    range.addEventListener('input', () => update(range, number));
    this.controls.append(row);
  }

  captureSettings() {
    const payload = Object.fromEntries([...this.controls.querySelectorAll('.inspector__row')].map((row) => [row.dataset.path, Number(row.querySelector('input[type=number]').value)]));
    payload['platforms.enablePairedPlatforms'] = this.config.platforms.enablePairedPlatforms;
    payload['platforms.hubPortal.enabled'] = this.config.platforms.hubPortal.enabled;
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
    for (const row of this.controls.querySelectorAll('.inspector__row')) {
      const value = values[row.dataset.path];
      if (!Number.isFinite(value)) continue;
      this.write(row.dataset.path, value);
      row.querySelector('input[type=number]').value = value;
      row.querySelector('input[type=range]').value = value;
    }
    if (typeof values['platforms.enablePairedPlatforms'] === 'boolean') {
      this.config.platforms.enablePairedPlatforms = values['platforms.enablePairedPlatforms'];
      this.root.querySelector('[data-paired]').checked = values['platforms.enablePairedPlatforms'];
    }
    if (typeof values['platforms.hubPortal.enabled'] === 'boolean') {
      this.config.platforms.hubPortal.enabled = values['platforms.hubPortal.enabled'];
      this.root.querySelector('[data-portals]').checked = values['platforms.hubPortal.enabled'];
    }
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
