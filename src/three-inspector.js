import { RUN_CARDS } from './run-cards.js';
import { CLIFF_LIMITS, FOLIAGE_WIND_LIMITS, SUPPORT_SCALE_LIMITS } from './config.js';

const TAB_DEFINITIONS = [
  ['flow', 'Поток'],
  ['player', 'Игрок'],
  ['character', 'Персонаж'],
  ['cards', 'Карточки'],
  ['camera', 'Камера'],
  ['lighting', 'Свет'],
  ['world', 'Мир'],
  ['cliffs', 'Скалы'],
  ['presets', 'Пресеты'],
  ['debug', 'Диагностика'],
];

const asColorInput = (color) => `#${Math.round(Math.max(0, Math.min(0xffffff, color))).toString(16).padStart(6, '0')}`;

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
          <label class="inspector__check"><input type="checkbox" data-increase-world-speed>Ускорять мир</label>
          <label class="inspector__check"><input type="checkbox" data-flow-progression>Плавная прогрессия скорости</label>
          <p class="inspector__hint">При плавной прогрессии используются целевая скорость и время до неё. Ручное ускорение работает, когда прогрессия отключена.</p>
          <div data-controls="flow"></div>
        </section>
        <section class="inspector__panel" id="inspector-panel-player" data-panel="player" role="tabpanel" tabindex="0">
          <div data-controls="player"></div>
        </section>
        <section class="inspector__panel" id="inspector-panel-character" data-panel="character" role="tabpanel" tabindex="0">
          <div data-controls="character"></div>
        </section>
        <section class="inspector__panel" id="inspector-panel-cards" data-panel="cards" role="tabpanel" tabindex="0">
          <div data-controls="cards"></div>
        </section>
        <section class="inspector__panel" id="inspector-panel-camera" data-panel="camera" role="tabpanel" tabindex="0">
          <div data-controls="camera"></div>
        </section>
        <section class="inspector__panel" id="inspector-panel-lighting" data-panel="lighting" role="tabpanel" tabindex="0">
          <label class="inspector__check"><input type="checkbox" data-shadows>Тени</label>
          <div data-controls="lighting"></div>
        </section>
        <section class="inspector__panel" id="inspector-panel-world" data-panel="world" role="tabpanel" tabindex="0">
          <strong>Небо</strong>
          <div data-controls="sky"></div>
          <strong>Дымка на фоновых скалах</strong>
          <p class="inspector__hint">Плотность задаёт, насколько цвет дымки смешивается с цветом скал.</p>
          <div data-controls="atmosphere-near"></div>
          <div data-controls="atmosphere-far"></div>
          <strong>Ветер в растениях</strong>
          <label class="inspector__check"><input type="checkbox" data-foliage-wind>Покачивание растений</label>
          <div data-controls="foliage-wind"></div>
        </section>
        <section class="inspector__panel" id="inspector-panel-cliffs" data-panel="cliffs" role="tabpanel" tabindex="0">
          <p class="inspector__hint">Глубина ниже нуля подаёт скалы вперёд. Скорость 1 — как у платформ, 0 — без прокрутки.</p>
          <div data-controls="cliffs"></div>
          <strong>Скалы под платформами</strong>
          <label class="inspector__check"><input type="checkbox" data-procedural-cliffs>Генеративные скалы</label>
          <div data-controls="procedural-cliffs"></div>
          <div data-controls="supports"></div>
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
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'inspector__tooltip';
    this.tooltip.hidden = true;
    document.body.append(this.tooltip);
    this.controls = this.root.querySelector('[data-controls-root]');
    this.telemetry = this.root.querySelector('.inspector__telemetry');
    this.presets = {};
    this.lastTelemetryAt = 0;
    this.pairedInput = this.root.querySelector('[data-paired]');
    this.portalsInput = this.root.querySelector('[data-portals]');
    this.increaseWorldSpeedInput = this.root.querySelector('[data-increase-world-speed]');
    this.flowProgressionInput = this.root.querySelector('[data-flow-progression]');
    this.shadowsInput = this.root.querySelector('[data-shadows]');
    this.foliageWindInput = this.root.querySelector('[data-foliage-wind]');
    this.proceduralCliffsInput = this.root.querySelector('[data-procedural-cliffs]');
    this.proceduralCliffsInput.checked = config.platformSupports.procedural;
    this.proceduralCliffsInput.addEventListener('change', () => {
      config.platformSupports.procedural = this.proceduralCliffsInput.checked;
      this.refreshSupportControls();
      game.applyProceduralCliffSettings();
    });
    this.panels = Object.fromEntries([...this.root.querySelectorAll('[data-panel]')].map((panel) => [panel.dataset.panel, panel]));

    this.bindTooltip(this.pairedInput.closest('.inspector__check'), 'Разрешает генератору создавать две платформы на одной высоте, если это допускает текущая прогрессия.');
    this.bindTooltip(this.portalsInput.closest('.inspector__check'), 'Включает появление парных порталов, через которые можно вернуться в хаб.');
    this.bindTooltip(this.increaseWorldSpeedInput.closest('.inspector__check'), 'В ручном режиме постепенно увеличивает скорость подъёма платформ.');
    this.bindTooltip(this.flowProgressionInput.closest('.inspector__check'), 'Включает плавный переход от начальной скорости к целевой за заданное время. Этот режим имеет приоритет над ручным ускорением.');
    this.bindTooltip(this.shadowsInput.closest('.inspector__check'), 'Включает или отключает отбрасывание теней объектами сцены.');
    this.bindTooltip(this.root.querySelector('[data-close]'), 'Закрыть инспектор. Открыть его снова можно клавишей I.');
    this.bindTooltip(this.root.querySelector('[data-save]'), 'Сохранить текущие значения в настройки игры.');
    this.bindTooltip(this.root.querySelector('[data-preset-save]'), 'Сохранить текущие значения как новый пресет.');
    this.bindTooltip(this.root.querySelector('[data-preset-apply]'), 'Применить выбранный пресет и сохранить его значения как текущие настройки.');
    this.bindTooltip(this.root.querySelector('[data-preset-overwrite]'), 'Перезаписать выбранный пресет текущими значениями инспектора.');
    const tabDescriptions = {
      flow: 'Скорость мира, зазоры, размеры платформ и порталы.',
      player: 'Скорость и физические параметры игрока.',
      character: 'Масштаб визуальной модели и скорость её анимации.',
      camera: 'Поле зрения, наклон, дистанция и вертикальный центр камеры.',
      lighting: 'Интенсивность, положение света и параметры теней.',
      world: 'Цвет неба, дымка на фоновых слоях и ветер в растениях.',
      cliffs: 'Настройки фоновых скал и опор платформ.',
      presets: 'Сохранение, применение и перезапись наборов настроек.',
      debug: 'Текущий режим игры, скорость потока и счётчики прогрессии.',
    };
    this.root.querySelectorAll('[data-tab]').forEach((tab) => this.bindTooltip(tab, tabDescriptions[tab.dataset.tab]));

    this.pairedInput.checked = config.platforms.enablePairedPlatforms;
    this.portalsInput.checked = config.platforms.hubPortal.enabled;
    this.increaseWorldSpeedInput.checked = config.platforms.increaseWorldSpeed;
    this.flowProgressionInput.checked = config.platforms.useFlowProgression;
    this.shadowsInput.checked = config.lighting?.shadowsEnabled !== false;
    this.foliageWindInput.checked = config.foliageWind.enabled;
    this.pairedInput.addEventListener('change', (event) => {
      config.platforms.enablePairedPlatforms = event.target.checked;
      game.restart(true, false);
    });
    this.portalsInput.addEventListener('change', (event) => {
      config.platforms.hubPortal.enabled = event.target.checked;
      game.restart(true, false);
    });
    this.increaseWorldSpeedInput.addEventListener('change', (event) => {
      config.platforms.increaseWorldSpeed = event.target.checked;
      game.restart(true, false);
    });
    this.flowProgressionInput.addEventListener('change', (event) => {
      config.platforms.useFlowProgression = event.target.checked;
      game.restart(true, false);
    });
    this.shadowsInput.addEventListener('change', (event) => {
      config.lighting.shadowsEnabled = event.target.checked;
      game.applyLighting();
    });
    this.foliageWindInput.addEventListener('change', (event) => {
      config.foliageWind.enabled = event.target.checked;
      game.applyFoliageWindSettings();
    });

    const colors = [
      ['atmosphere.skyTop', 'Небо сверху', 'sky', 'Цвет верхней части градиента за фоновыми скалами.'],
      ['atmosphere.skyBottom', 'Небо снизу', 'sky', 'Цвет нижней части градиента за фоновыми скалами.'],
      ['atmosphere.nearHazeColor', 'Цвет ближней дымки', 'atmosphere-near', 'Оттенок дымки на ближнем фоновом слое.'],
      ['atmosphere.farHazeColor', 'Цвет дальней дымки', 'atmosphere-far', 'Оттенок дымки на дальнем фоновом слое.'],
    ];
    colors.forEach((color) => this.addColorControl(...color));
    const definitions = [
      ['platforms.initialWorldSpeed', 'Начальная скорость', 1, 120, 1, 'flow', 'Скорость подъёма платформ в начале забега.'],
      ['platforms.worldSpeedIncrease', 'Ускорение мира', 0, 10, 0.01, 'flow', 'Сколько мировых единиц в секунду добавляется к скорости в ручном режиме.'],
      ['platforms.maxWorldSpeed', 'Максимум скорости (ручной режим)', 1, 200, 1, 'flow', 'Предел скорости при ручном ускорении. В режиме плавной прогрессии используется целевая скорость.'],
      ['platforms.targetWorldSpeedTime', 'Время до целевой скорости', 1, 1800, 1, 'flow', 'За сколько секунд плавная прогрессия доводит мир от начальной до целевой скорости.'],
      ['platforms.targetWorldSpeed', 'Целевая скорость мира', 1, 200, 1, 'flow', 'Скорость, к которой мир постепенно приходит при включённой плавной прогрессии.'],
      ['platforms.doublePlatformsDuration', 'Время двойных платформ', 0, 600, 1, 'flow', 'Через сколько секунд после старта забега генератор перестаёт создавать двойные платформы.'],
      ['platforms.platformProgressionDuration', 'Время прогрессии платформ', 0, 600, 1, 'flow', 'Сколько секунд генератор использует ранние широкие размеры платформ.'],
      ['platforms.minGap', 'Минимальный зазор', 8, 80, 1, 'flow', 'Минимальное вертикальное расстояние между соседними платформами.'],
      ['platforms.maxGap', 'Максимальный зазор', 8, 100, 1, 'flow', 'Максимальное вертикальное расстояние между соседними платформами.'],
      ['platforms.minWidth', 'Минимальная ширина', 10, 100, 1, 'flow', 'Минимальная ширина обычной платформы после начальной прогрессии.'],
      ['platforms.maxWidth', 'Максимальная ширина', 10, 110, 1, 'flow', 'Максимальная ширина обычной платформы после начальной прогрессии.'],
      ['platforms.hubPortal.everyPatterns', 'Портал каждые паттерны', 1, 200, 1, 'flow', 'Через сколько сгенерированных паттернов появляется пара порталов в хаб.'],
      ['platforms.hubPortal.platformWidthRatio', 'Ширина платформ портала', 0.2, 0.49, 0.01, 'flow', 'Доля ширины мира, которую занимает каждая платформа у порталов.'],
      ['player.maxHorizontalSpeed', 'Скорость игрока', 1, 120, 1, 'player', 'Максимальная горизонтальная скорость игрока.'],
      ['player.attacksPerSecond', 'Ударов в секунду', 0.5, 20, 0.25, 'player', 'Общий темп атак игрока, включая удары по разным врагам.'],
      ['player.acceleration', 'Ускорение', 1, 2000, 1, 'player', 'Как быстро игрок набирает заданную горизонтальную скорость.'],
      ['player.braking', 'Торможение', 1, 2000, 1, 'player', 'Как быстро игрок меняет направление и гасит текущую скорость.'],
      ['player.gravity', 'Гравитация', 1, 2000, 1, 'player', 'Сила падения игрока после прыжка и при отсутствии платформы под ним.'],
      ['player.visualScale', 'Масштаб персонажа', 0.5, 2.5, 0.01, 'character', 'Размер визуальной модели относительно текущего размера. Hitbox игрока при этом не меняется.'],
      ['player.animationSpeed', 'Скорость анимации', 0.1, 3, 0.05, 'character', 'Множитель скорости проигрывания анимации бега. На физическую скорость игрока не влияет.'],
      ['camera.fov', 'Камера FOV', 35, 80, 1, 'camera', 'Угол обзора камеры. Большое значение показывает больше мира и сильнее искажает перспективу.'],
      ['camera.tiltDegrees', 'Наклон камеры', 0, 35, 1, 'camera', 'Наклон камеры по вертикали относительно плоскости игры.'],
      ['camera.distanceMultiplier', 'Дистанция камеры', 0.7, 1.6, 0.01, 'camera', 'Масштаб расстояния камеры до игрового мира. Большое значение отдаляет камеру.'],
      ['camera.centerOffset', 'Центр камеры', -40, 40, 1, 'camera', 'Вертикальное смещение точки, вокруг которой камера показывает мир.'],
      ['lighting.ambientIntensity', 'Общий свет', 0, 4, 0.05, 'lighting', 'Базовая равномерная подсветка сцены без направленных теней.'],
      ['lighting.keyIntensity', 'Основной свет', 0, 8, 0.05, 'lighting', 'Интенсивность основного направленного света, который создаёт тени.'],
      ['lighting.keyPositionX', 'Основной свет X', -240, 240, 1, 'lighting', 'Горизонтальная позиция основного источника света.'],
      ['lighting.keyPositionY', 'Основной свет Y', -240, 360, 1, 'lighting', 'Вертикальная позиция основного источника света.'],
      ['lighting.keyPositionZ', 'Основной свет Z', -240, 360, 1, 'lighting', 'Позиция основного света по глубине сцены.'],
      ['lighting.shadowBias', 'Смещение тени (Bias)', -0.01, 0.01, 0.0001, 'lighting', 'Малое смещение глубины, которое помогает убрать полосы и самозатенение.'],
      ['lighting.shadowNormalBias', 'Смещение по нормали', 0, 0.2, 0.001, 'lighting', 'Смещение тени вдоль нормали поверхности. Помогает бороться с артефактами на краях.'],
      ['lighting.fillIntensity', 'Заполняющий свет', 0, 500, 1, 'lighting', 'Интенсивность дополнительного света, который смягчает слишком тёмные стороны.'],
      ['lighting.fillDistance', 'Дальность заполняющего', 20, 600, 1, 'lighting', 'Расстояние действия дополнительного света.'],
      ['lighting.fillPositionX', 'Заполняющий свет X', -240, 240, 1, 'lighting', 'Горизонтальная позиция дополнительного света.'],
      ['lighting.fillPositionY', 'Заполняющий свет Y', -240, 360, 1, 'lighting', 'Вертикальная позиция дополнительного света.'],
      ['lighting.fillPositionZ', 'Заполняющий свет Z', -240, 360, 1, 'lighting', 'Позиция дополнительного света по глубине сцены.'],
      ['atmosphere.nearHazeAmount', 'Плотность ближней дымки', 0, 1, 0.01, 'atmosphere-near', '0 сохраняет исходные оттенки скал, 1 полностью окрашивает слой выбранным цветом.'],
      ['atmosphere.farHazeAmount', 'Плотность дальней дымки', 0, 1, 0.01, 'atmosphere-far', 'Чем выше значение, тем ближе дальние скалы по цвету к выбранной дымке.'],
      ['foliageWind.strength', 'Сила ветра', 0, FOLIAGE_WIND_LIMITS.maxStrength, 0.1, 'foliage-wind', 'Как далеко сгибаются кончики травы, цветов и лиан.'],
      ['foliageWind.speed', 'Скорость ветра', 0, FOLIAGE_WIND_LIMITS.maxSpeed, 0.05, 'foliage-wind', 'Частота покачивания в циклах в секунду. Ноль фиксирует текущий наклон.'],
      ['foliageWind.sway', 'Размах покачивания', 0, 1, 0.05, 'foliage-wind', 'Насколько широко растения качаются и во время порывов, и между ними.'],
      ['foliageWind.gustiness', 'Порывистость', 0, 1, 0.05, 'foliage-wind', 'Насколько сильно порывы усиливают постоянное покачивание.'],
      ['cliffs.nearScale', 'Масштаб ближних', CLIFF_LIMITS.minScale, CLIFF_LIMITS.maxScale, 0.01, 'cliffs', 'Размер ближних скал. 1 — исходный масштаб.'],
      ['cliffs.nearGap', 'Глубина ближних', CLIFF_LIMITS.minGap, CLIFF_LIMITS.maxGap, 0.5, 'cliffs', 'Уменьшите глубину ниже нуля, чтобы ближние скалы зашли под заднюю часть платформ.'],
      ['cliffs.nearSpeed', 'Скорость ближних', 0, CLIFF_LIMITS.maxSpeed, 0.01, 'cliffs', 'Скорость прокрутки ближних скал относительно платформ.'],
      ['cliffs.farScale', 'Масштаб дальних', CLIFF_LIMITS.minScale, CLIFF_LIMITS.maxScale, 0.01, 'cliffs', 'Размер дальних скал. 1 — исходный масштаб.'],
      ['cliffs.farGap', 'Глубина дальних', CLIFF_LIMITS.minGap, CLIFF_LIMITS.maxGap, 0.5, 'cliffs', 'Меньше — ближе к платформам, больше — дальше в фон.'],
      ['cliffs.farSpeed', 'Скорость дальних', 0, CLIFF_LIMITS.maxSpeed, 0.01, 'cliffs', 'Скорость прокрутки дальних скал относительно платформ.'],
      ['platformSupports.widthScale', 'Ширина опор', SUPPORT_SCALE_LIMITS.min, SUPPORT_SCALE_LIMITS.max, 0.05, 'supports', 'Горизонтальный масштаб скал, к которым прикреплены платформы.'],
      ['platformSupports.heightScale', 'Высота опор', SUPPORT_SCALE_LIMITS.min, SUPPORT_SCALE_LIMITS.max, 0.05, 'supports', 'Вертикальный масштаб опор. Точка крепления остаётся у платформы.'],
      ['platformSupports.rockCoverage', 'Ширина скалы', 0.25, 0.95, 0.01, 'procedural-cliffs', 'Ширина участка породы за платформами. Больше — меньше фона по бокам.'],
      ['platformSupports.openingSize', 'Ширина проёма', 0.15, 0.68, 0.01, 'procedural-cliffs', 'Размер сквозного проёма внутри участка породы.'],
      ['platformSupports.facetSize', 'Размер граней', 16, 34, 1, 'procedural-cliffs', 'Расстояние между крупными изломами в игровых единицах.'],
      ['platformSupports.facetStretch', 'Вытянутость граней', 0.9, 1.8, 0.05, 'procedural-cliffs', 'Удлиняет крупные плоскости вдоль скалы.'],
      ['platformSupports.fractureStrength', 'Резкость изломов', 0, 1, 0.05, 'procedural-cliffs', 'Меняет неровность проёма, рельеф граней и повороты стенок в глубине.'],
      ['platformSupports.recessDepth', 'Глубина загиба', 0.6, 1.4, 0.05, 'procedural-cliffs', 'Масштаб глубины стенок внутри проёма.'],
      ['platformSupports.mountBlend', 'Адаптация к платформам', 0.65, 1.4, 0.05, 'procedural-cliffs', 'Задаёт, насколько далеко от точки крепления меняется скала.'],
    ];
    definitions.forEach((definition) => this.addControl(...definition));
    this.refreshSupportControls();
    const cardControls = this.root.querySelector('[data-controls="cards"]');
    for (const card of RUN_CARDS) {
      const controls = [
        ['enabled', card.name],
        ['grantImmediately', 'Выдать игроку сразу'],
      ];
      for (const [key, text] of controls) {
        const path = `cards.${card.id}.${key}`;
        const label = document.createElement('label');
        label.className = 'inspector__check';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.dataset.cardSetting = path;
        checkbox.checked = this.read(path);
        checkbox.addEventListener('change', () => {
          this.write(path, checkbox.checked);
          if (key === 'enabled' && game.choosingCard) game.openCardChoice();
        });
        label.append(checkbox, text);
        cardControls.append(label);
      }
      const step = card.bonusStep ?? 1;
      this.addControl(`cards.${card.id}.bonus`, 'Бонус за уровень', step, 50, step, 'cards', card.description(card.bonus));
    }
    this.root.querySelectorAll('[data-tab]').forEach((tab) => tab.addEventListener('click', () => this.activateTab(tab.dataset.tab)));
    this.root.querySelector('[data-close]').addEventListener('click', () => {
      this.root.hidden = true;
      this.tooltip.hidden = true;
    });
    this.root.querySelector('[data-save]').addEventListener('click', () => this.save());
    this.root.querySelector('[data-preset-save]').addEventListener('click', () => this.savePreset());
    this.root.querySelector('[data-preset-apply]').addEventListener('click', () => this.applyPreset());
    this.root.querySelector('[data-preset-overwrite]').addEventListener('click', () => this.overwritePreset());
    this.loadPresets();
    window.addEventListener('keydown', (event) => {
      if (event.code !== 'KeyI' || event.repeat) return;
      event.preventDefault();
      this.root.hidden = !this.root.hidden;
      if (this.root.hidden) this.tooltip.hidden = true;
      if (!this.root.hidden) this.root.querySelector('.inspector__tab.is-active')?.focus();
    });
    window.addEventListener('resize', () => { this.tooltip.hidden = true; });
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

  bindTooltip(element, text) {
    if (!element || !text) return;
    element.setAttribute('aria-description', text);
    const show = () => {
      this.tooltip.textContent = text;
      this.tooltip.hidden = false;
      const rect = element.getBoundingClientRect();
      const margin = 8;
      const maxWidth = Math.min(280, window.innerWidth - margin * 2);
      this.tooltip.style.maxWidth = `${maxWidth}px`;
      let left = rect.left;
      let top = rect.bottom + margin;
      const tooltipRect = this.tooltip.getBoundingClientRect();
      if (left + tooltipRect.width > window.innerWidth - margin) left = window.innerWidth - tooltipRect.width - margin;
      if (top + tooltipRect.height > window.innerHeight - margin) top = rect.top - tooltipRect.height - margin;
      this.tooltip.style.left = `${Math.max(margin, left)}px`;
      this.tooltip.style.top = `${Math.max(margin, top)}px`;
    };
    const hide = () => { this.tooltip.hidden = true; };
    element.addEventListener('pointerenter', show);
    element.addEventListener('pointerleave', hide);
    element.addEventListener('focusin', show);
    element.addEventListener('focusout', hide);
  }

  read(path) { return path.split('.').reduce((value, key) => value?.[key], this.config); }

  write(path, value) {
    const keys = path.split('.');
    const target = keys.slice(0, -1).reduce((value, key) => value[key], this.config);
    target[keys.at(-1)] = value;
  }

  addColorControl(path, label, category, description) {
    const row = document.createElement('label');
    row.className = 'inspector__row';
    row.innerHTML = `<span>${label}</span><input type="color" aria-label="${label}">`;
    const input = row.querySelector('input');
    input.dataset.colorSetting = path;
    input.value = asColorInput(this.read(path));
    input.addEventListener('input', () => {
      this.write(path, Number.parseInt(input.value.slice(1), 16));
      this.game.applyAtmosphereSettings();
    });
    this.bindTooltip(row, description);
    this.root.querySelector(`[data-controls="${category}"]`).append(row);
  }

  addControl(path, label, min, max, step = 1, category = 'flow', description = '') {
    const row = document.createElement('label');
    row.className = 'inspector__row';
    row.dataset.path = path;
    row.innerHTML = `<span>${label}</span><input type="number" min="${min}" max="${max}" step="${step}" aria-label="${label}"><input type="range" min="${min}" max="${max}" step="${step}" aria-label="${label}">`;
    this.bindTooltip(row, description);
    const number = row.querySelector('input[type=number]');
    const range = row.querySelector('input[type=range]');
    const update = (source, target) => {
      const value = Math.max(min, Math.min(max, Number(source.value)));
      this.write(path, value);
      source.value = value;
      target.value = value;
      if (path === 'player.attacksPerSecond') return;
      if (category === 'cards') {
        if (this.game.choosingCard) this.game.openCardChoice();
        return;
      }
      if (path.startsWith('lighting.')) {
        this.game.applyLighting();
        return;
      }
      if (path.startsWith('atmosphere.')) {
        this.game.applyAtmosphereSettings();
        return;
      }
      if (category === 'foliage-wind') {
        this.game.applyFoliageWindSettings();
        return;
      }
      if (category === 'cliffs') {
        this.game.applyCliffSettings();
        return;
      }
      if (category === 'procedural-cliffs') {
        this.game.applyProceduralCliffSettings();
        return;
      }
      if (category === 'supports') {
        this.game.applyPlatformSupportSettings();
        return;
      }
      if (path === 'player.visualScale' || path === 'player.animationSpeed') {
        this.game.applyPlayerVisualSettings();
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
    const payload = Object.fromEntries([...this.root.querySelectorAll('.inspector__row[data-path]')].map((row) => [row.dataset.path, Number(row.querySelector('input[type=number]').value)]));
    for (const input of this.root.querySelectorAll('[data-color-setting]')) {
      payload[input.dataset.colorSetting] = Number.parseInt(input.value.slice(1), 16);
    }
    payload['platforms.enablePairedPlatforms'] = this.pairedInput.checked;
    payload['platforms.hubPortal.enabled'] = this.portalsInput.checked;
    payload['platforms.increaseWorldSpeed'] = this.increaseWorldSpeedInput.checked;
    payload['platforms.useFlowProgression'] = this.flowProgressionInput.checked;
    payload['lighting.shadowsEnabled'] = this.shadowsInput.checked;
    payload['foliageWind.enabled'] = this.foliageWindInput.checked;
    payload['platformSupports.procedural'] = this.proceduralCliffsInput.checked;
    for (const checkbox of this.root.querySelectorAll('[data-card-setting]')) {
      payload[checkbox.dataset.cardSetting] = checkbox.checked;
    }
    return payload;
  }

  refreshSupportControls() {
    this.root.querySelector('[data-controls="procedural-cliffs"]').hidden = !this.proceduralCliffsInput.checked;
    this.root.querySelector('[data-controls="supports"]').hidden = this.proceduralCliffsInput.checked;
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
    for (const checkbox of this.root.querySelectorAll('[data-card-setting]')) {
      const path = checkbox.dataset.cardSetting;
      if (typeof values[path] !== 'boolean') continue;
      this.write(path, values[path]);
      checkbox.checked = values[path];
    }
    for (const input of this.root.querySelectorAll('[data-color-setting]')) {
      const value = values[input.dataset.colorSetting];
      if (!Number.isInteger(value) || value < 0 || value > 0xffffff) continue;
      this.write(input.dataset.colorSetting, value);
      input.value = asColorInput(value);
    }
    for (const row of this.root.querySelectorAll('.inspector__row[data-path]')) {
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
    if (typeof values['platforms.increaseWorldSpeed'] === 'boolean') {
      this.config.platforms.increaseWorldSpeed = values['platforms.increaseWorldSpeed'];
      this.increaseWorldSpeedInput.checked = values['platforms.increaseWorldSpeed'];
    }
    if (typeof values['platforms.useFlowProgression'] === 'boolean') {
      this.config.platforms.useFlowProgression = values['platforms.useFlowProgression'];
      this.flowProgressionInput.checked = values['platforms.useFlowProgression'];
    }
    if (typeof values['lighting.shadowsEnabled'] === 'boolean') {
      this.config.lighting.shadowsEnabled = values['lighting.shadowsEnabled'];
      this.shadowsInput.checked = values['lighting.shadowsEnabled'];
    }
    if (typeof values['foliageWind.enabled'] === 'boolean') {
      this.config.foliageWind.enabled = values['foliageWind.enabled'];
      this.foliageWindInput.checked = values['foliageWind.enabled'];
    }
    if (typeof values['platformSupports.procedural'] === 'boolean') {
      this.config.platformSupports.procedural = values['platformSupports.procedural'];
      this.proceduralCliffsInput.checked = values['platformSupports.procedural'];
      this.refreshSupportControls();
    }
    this.game.applyLighting();
    this.game.applyAtmosphereSettings();
    this.game.applyFoliageWindSettings();
    this.game.applyPlayerVisualSettings();
    this.game.applyPlatformSupportSettings();
    this.game.applyProceduralCliffSettings();
    this.game.resize();
    this.game.restart(true, false);
  }

  update() {
    const now = performance.now();
    if (now - this.lastTelemetryAt < 100) return;
    this.lastTelemetryAt = now;
    const lastBuild = this.game.proceduralCliffs.lastBuild;
    const rockStats = lastBuild
      ? `<dt>Сборка секции скалы</dt><dd>${lastBuild.ms.toFixed(2)} мс</dd><dt>Вершины секции</dt><dd>${lastBuild.vertices}</dd><dt>Треугольники секции</dt><dd>${lastBuild.triangles}</dd>`
      : '';
    this.telemetry.innerHTML = `<dt>Режим</dt><dd>${this.game.mode}</dd><dt>Скорость потока</dt><dd>${this.game.worldSpeed.toFixed(1)}</dd><dt>Паттерны</dt><dd>${this.game.patternCount}</dd><dt>Кристаллы</dt><dd>${this.game.crystalCount}</dd>${rockStats}`;
  }
}
