/**
 * dsh-nanokvm — the settings card and the right-sidebar panel.
 *
 * The card is a list of devices, one complete configuration per box (address,
 * login, TLS, note) — a box is identified by its own settings, not by a shared
 * default. Writing goes through the settings form service, so nothing here
 * touches the YAML itself.
 *
 * The panel shows the frame the box is capturing and the few actions worth
 * having one click away: power, reset, Enter, typing text, and an HDMI reset for
 * the case when the screen simply does not come.
 */
window.__ModuleLoader__.load({
  id: 'dsh-nanokvm',
  factory: (require) => {
    const module = { exports: {} };
    try {
      return build(require, module);
    } catch (error) {
      // A client bundle that throws while building must not take the whole app
      // down: the renderer treats an un-materialized entry as a failed boot and
      // refuses to start. Degrade to an inert plugin and leave the reason in the
      // console — the settings card and the panel simply do not appear.
      console.error('[dsh-nanokvm] client failed to initialise — the plugin stays inert:', error);
      return { apply() {}, inject: [] };
    }
  },
});

function build(require, module) {
  const React = require('react');
  const { jsx, jsxs } = require('react/jsx-runtime');
  const { Button, Checkbox, Input } = require('@deepseek-ai/dsh-client-ui-primitives');

    const NAMESPACE = 'nanokvm';
    const LOCALE_NS = 'dsh-nanokvm-ui';
    const TAB_ID = 'dsh-nanokvm/panel';
    const TAB_KIND = 'nanokvm-panel';
    const PANEL_BASE = '/dsh-nanokvm';
    const STYLE_ID = 'dsh-nanokvm-styles';
    const STATE_POLL_MS = 5000;
    const DEFAULT_FPS = 1;

    const DICTIONARIES = {
      en: {
        section: 'NanoKVM',
        title: 'NanoKVM devices',
        intro:
          'Add each NanoKVM box once: its address and web login. The agent reaches the same boxes through the nanokvm_* tools, and the right sidebar shows the screen.',
        statusReady: 'Settings connected — changes are written to the config file.',
        statusReadOnly: 'This profile is read-only: the settings cannot be changed here.',
        statusUnavailable: 'The settings service is unavailable in this composition.',
        statusLoading: 'Loading settings…',
        reset: 'Reset',
        overridden: 'set in a layer',
        saved: 'Saved.',
        saveFailed: 'The change was rejected.',
        'devices.title': 'Devices',
        'devices.add': 'Add device',
        'devices.addTitle': 'Add a NanoKVM',
        'devices.editTitle': 'Edit {name}',
        'devices.empty': 'No device yet — add the first one.',
        'devices.name': 'Name',
        'devices.nameHint': 'The `device` argument of the tools. Letters, digits and dashes.',
        'devices.baseUrl': 'Address',
        'devices.baseUrlHint': 'e.g. 192.168.2.57 or https://kvm.lan',
        'devices.username': 'User',
        'devices.password': 'Password',
        'devices.passwordHint': 'The box web password. It is stored in the profile and never shown back.',
        'devices.passwordKeep': 'leave empty to keep the stored password',
        'devices.passwordRequired': 'a new device needs the box web password — an empty one is refused by the box',
        'devices.keyStored': 'password stored',
        'devices.keyMissing': 'no password',
        'devices.test': 'Test',
        'devices.testing': 'Testing…',
        'devices.testOk': 'login works',
        'devices.testFailed': 'login failed: {message}',
        'devices.insecureTls': 'Skip TLS check',
        'devices.description': 'Note',
        'devices.descriptionHint': 'Anything worth remembering about the attached machine.',
        'devices.defaultBadge': 'default',
        'devices.makeDefault': 'Make default',
        'devices.edit': 'Edit',
        'devices.remove': 'Remove',
        'devices.confirmRemove': 'Click again to remove',
        'devices.save': 'Save',
        'devices.cancel': 'Cancel',
        'devices.required': 'Name and address are required.',
        'devices.duplicate': 'There is already a device named {name}.',
        'devices.global': 'Global settings',
        'field.requestTimeoutMs': 'Request timeout',
        'field.requestTimeoutMsHint': 'Milliseconds a box call may take (default 15000).',
        'field.injectInput': 'Expose input tools',
        'field.injectInputHint': 'Lets the agent type and click through the box (default on).',
        'field.viewAutoOpen': 'Open the panel after an action',
        'field.viewAutoOpenHint': 'Opens the right sidebar tab when a tool touches a box (default off).',
        'field.viewFps': 'Panel frame rate',
        'field.viewFpsHint': 'Frames per second in the panel, 1–4 (default 1).',
        'tab.title': 'NanoKVM',
        'tab.guide': 'See and drive the machine plugged into a NanoKVM box.',
        'pane.device': 'Device',
        'pane.power': 'Power',
        'pane.on': 'On',
        'pane.off': 'Off',
        'pane.press': 'Press',
        'pane.reset': 'Reset',
        'pane.enter': 'Enter',
        'pane.hdmiReset': 'Reset HDMI',
        'pane.noFrame': 'No frame — the target may be off, or its HDMI asleep.',
        'pane.inputOff': 'Input injection is off: click and drag are disabled in the plugin settings.',
        'pane.powered': 'Powered',
        'pane.down': 'Off',
        'pane.unknown': 'Unknown',
        'pane.refresh': 'Refresh',
        'pane.updated': 'updated {time}',
        'pane.failed': 'Failed: {message}',
        'pane.paste': 'Type text',
        'pane.pasteHint': 'Sent through the box as keystrokes.',
        'pane.send': 'Send',
      },
      ru: {
        section: 'NanoKVM',
        title: 'Устройства NanoKVM',
        intro:
          'Добавьте каждый блок NanoKVM один раз: адрес и вход в веб-интерфейс. Агент работает с теми же блоками через инструменты nanokvm_*, а правая панель показывает экран.',
        statusReady: 'Настройки подключены — изменения пишутся в файл конфигурации.',
        statusReadOnly: 'Профиль только для чтения: настройки здесь изменить нельзя.',
        statusUnavailable: 'Сервис настроек недоступен в этой композиции.',
        statusLoading: 'Загрузка настроек…',
        reset: 'Сбросить',
        overridden: 'задано в слое',
        saved: 'Сохранено.',
        saveFailed: 'Изменение отклонено.',
        'devices.title': 'Устройства',
        'devices.add': 'Добавить устройство',
        'devices.addTitle': 'Добавить NanoKVM',
        'devices.editTitle': 'Изменить {name}',
        'devices.empty': 'Устройств нет — добавьте первое.',
        'devices.name': 'Имя',
        'devices.nameHint': 'Аргумент `device` инструментов. Буквы, цифры и дефисы.',
        'devices.baseUrl': 'Адрес',
        'devices.baseUrlHint': 'например 192.168.2.57 или https://kvm.lan',
        'devices.username': 'Пользователь',
        'devices.password': 'Пароль',
        'devices.passwordHint': 'Пароль веб-интерфейса. Хранится в профиле и обратно не показывается.',
        'devices.passwordKeep': 'оставьте пустым, чтобы сохранить текущий пароль',
        'devices.passwordRequired': 'новому устройству нужен пароль веб-интерфейса — с пустым паролем коробка не пускает',
        'devices.keyStored': 'пароль сохранён',
        'devices.keyMissing': 'нет пароля',
        'devices.test': 'Проверить',
        'devices.testing': 'Проверка…',
        'devices.testOk': 'вход выполнен',
        'devices.testFailed': 'вход не выполнен: {message}',
        'devices.insecureTls': 'Не проверять TLS',
        'devices.description': 'Заметка',
        'devices.descriptionHint': 'Всё, что стоит помнить о подключённой машине.',
        'devices.defaultBadge': 'по умолчанию',
        'devices.makeDefault': 'Сделать основной',
        'devices.edit': 'Изменить',
        'devices.remove': 'Удалить',
        'devices.confirmRemove': 'Нажмите ещё раз, чтобы удалить',
        'devices.save': 'Сохранить',
        'devices.cancel': 'Отмена',
        'devices.required': 'Нужны имя и адрес.',
        'devices.duplicate': 'Устройство с именем {name} уже есть.',
        'devices.global': 'Общие настройки',
        'field.requestTimeoutMs': 'Таймаут запроса',
        'field.requestTimeoutMsHint': 'Сколько миллисекунд может длиться вызов блока (по умолчанию 15000).',
        'field.injectInput': 'Инструменты ввода',
        'field.injectInputHint': 'Разрешает агенту печатать и кликать через блок (по умолчанию включено).',
        'field.viewAutoOpen': 'Открывать панель после действия',
        'field.viewAutoOpenHint': 'Открывает вкладку правой панели, когда инструмент трогает блок (по умолчанию выключено).',
        'field.viewFps': 'Частота кадров панели',
        'field.viewFpsHint': 'Кадров в секунду в панели, 1–4 (по умолчанию 1).',
        'tab.title': 'NanoKVM',
        'tab.guide': 'Смотреть и управлять машиной, подключённой к блоку NanoKVM.',
        'pane.device': 'Устройство',
        'pane.power': 'Питание',
        'pane.on': 'Вкл',
        'pane.off': 'Выкл',
        'pane.press': 'Нажать',
        'pane.reset': 'Сброс',
        'pane.enter': 'Enter',
        'pane.hdmiReset': 'Сбросить HDMI',
        'pane.noFrame': 'Кадра нет — машина выключена или её HDMI спит.',
        'pane.inputOff': 'Ввод выключен: клики и перетаскивание запрещены в настройках плагина.',
        'pane.powered': 'Включено',
        'pane.down': 'Выключено',
        'pane.unknown': 'Неизвестно',
        'pane.refresh': 'Обновить',
        'pane.updated': 'обновлено {time}',
        'pane.failed': 'Ошибка: {message}',
        'pane.paste': 'Напечатать текст',
        'pane.pasteHint': 'Отправляется через блок как нажатия клавиш.',
        'pane.send': 'Отправить',
      },
      zh: {
        section: 'NanoKVM',
        title: 'NanoKVM 设备',
        intro:
          '每台 NanoKVM 添加一次：地址和网页登录。智能体通过 nanokvm_* 工具操作同一批设备，右侧边栏显示画面。',
        statusReady: '设置已连接——修改会写入配置文件。',
        statusReadOnly: '此配置只读，无法在此修改设置。',
        statusUnavailable: '此组合中没有设置服务。',
        statusLoading: '正在加载设置…',
        reset: '重置',
        overridden: '在层中设置',
        saved: '已保存。',
        saveFailed: '修改被拒绝。',
        'devices.title': '设备',
        'devices.add': '添加设备',
        'devices.addTitle': '添加 NanoKVM',
        'devices.editTitle': '编辑 {name}',
        'devices.empty': '还没有设备——先添加第一台。',
        'devices.name': '名称',
        'devices.nameHint': '工具的 `device` 参数。字母、数字和短横线。',
        'devices.baseUrl': '地址',
        'devices.baseUrlHint': '例如 192.168.2.57 或 https://kvm.lan',
        'devices.username': '用户',
        'devices.password': '密码',
        'devices.passwordHint': '设备网页密码。保存在 profile 里，不会再显示出来。',
        'devices.passwordKeep': '留空 —— 不修改已保存的密码',
        'devices.passwordRequired': '新设备必须填写网页密码 —— 空密码会被设备拒绝',
        'devices.keyStored': '已存密码',
        'devices.keyMissing': '没有密码',
        'devices.test': '测试',
        'devices.testing': '测试中…',
        'devices.testOk': '登录正常',
        'devices.testFailed': '登录失败：{message}',
        'devices.insecureTls': '跳过 TLS 校验',
        'devices.description': '备注',
        'devices.descriptionHint': '关于所连接机器的任何备注。',
        'devices.defaultBadge': '默认',
        'devices.makeDefault': '设为默认',
        'devices.edit': '编辑',
        'devices.remove': '删除',
        'devices.confirmRemove': '再点一次确认删除',
        'devices.save': '保存',
        'devices.cancel': '取消',
        'devices.required': '名称和地址必填。',
        'devices.duplicate': '已经有名为 {name} 的设备。',
        'devices.global': '全局设置',
        'field.requestTimeoutMs': '请求超时',
        'field.requestTimeoutMsHint': '单次设备调用的超时毫秒数（默认 15000）。',
        'field.injectInput': '启用输入工具',
        'field.injectInputHint': '允许智能体通过设备打字和点击（默认开启）。',
        'field.viewAutoOpen': '操作后打开面板',
        'field.viewAutoOpenHint': '工具操作设备时自动打开右侧边栏（默认关闭）。',
        'field.viewFps': '面板帧率',
        'field.viewFpsHint': '面板每秒帧数，1–4（默认 1）。',
        'tab.title': 'NanoKVM',
        'tab.guide': '查看和操作接在 NanoKVM 上的机器。',
        'pane.device': '设备',
        'pane.power': '电源',
        'pane.on': '开',
        'pane.off': '关',
        'pane.press': '按一下',
        'pane.reset': '重置',
        'pane.enter': '回车',
        'pane.hdmiReset': '重置 HDMI',
        'pane.noFrame': '没有画面——目标可能已关机，或 HDMI 已休眠。',
        'pane.inputOff': '输入注入已关闭：设置里禁止了点击和拖拽。',
        'pane.powered': '已开机',
        'pane.down': '已关机',
        'pane.unknown': '未知',
        'pane.refresh': '刷新',
        'pane.updated': '更新于 {time}',
        'pane.failed': '失败：{message}',
        'pane.paste': '输入文字',
        'pane.pasteHint': '通过设备以按键形式发送。',
        'pane.send': '发送',
      },
    };

    /** The fields of the device editor, in order. */
    const DEVICE_FIELDS = [
      { name: 'name', kind: 'text', labelKey: 'devices.name', hintKey: 'devices.nameHint' },
      { name: 'baseUrl', kind: 'text', labelKey: 'devices.baseUrl', hintKey: 'devices.baseUrlHint' },
      { name: 'username', kind: 'text', labelKey: 'devices.username' },
      { name: 'password', kind: 'password', labelKey: 'devices.password', hintKey: 'devices.passwordHint' },
      { name: 'insecureTls', kind: 'boolean', labelKey: 'devices.insecureTls' },
      { name: 'description', kind: 'text', labelKey: 'devices.description', hintKey: 'devices.descriptionHint' },
    ];

    /** Defaults applied to a new device. */
    const DEVICE_DEFAULTS = { username: 'admin', password: '', baseUrl: '', insecureTls: false, description: '' };

    /** The global fields, in order. */
    const FIELDS = [
      { name: 'requestTimeoutMs', kind: 'number', hintKey: 'field.requestTimeoutMsHint' },
      { name: 'injectInput', kind: 'boolean', hintKey: 'field.injectInputHint' },
      { name: 'viewAutoOpen', kind: 'boolean', hintKey: 'field.viewAutoOpenHint' },
      { name: 'viewFps', kind: 'number', hintKey: 'field.viewFpsHint' },
    ];

    /**
     * A name that is not taken yet.
     * @param {object[]} entries the devices.
     * @param {number} index the position the new device will take.
     * @returns {string} the name.
     */
    function deviceNameFor(entries, index) {
      const taken = new Set(entries.map((entry) => String(entry?.name ?? '')));
      let candidate = `kvm-${index + 1}`;
      let bump = 2;
      while (taken.has(candidate)) {
        candidate = `kvm-${index + 1}-${bump}`;
        bump += 1;
      }
      return candidate;
    }

    /**
     * The address line of a card.
     * @param {object} entry one device.
     * @returns {string} the address, without the scheme when plain http.
     */
    function deviceAddress(entry) {
      const base = String(entry?.baseUrl ?? '');
      return base.replace(/^https?:\/\//, '') || '(no address)';
    }

    /**
     * Settings values to input text.
     * @param {object} field one field.
     * @param {unknown} value the settings value.
     * @returns {string} the input text.
     */
    function toInput(field, value) {
      if (field.kind === 'boolean') return '';
      if (value === undefined || value === null) return '';
      return String(value);
    }

    /**
     * Input text to a settings value.
     * @param {object} field one field.
     * @param {string} text the input text.
     * @returns {unknown} the value, or undefined to write nothing.
     */
    function fromInput(field, text) {
      if (field.kind === 'number') {
        const value = Number(text);
        return Number.isFinite(value) ? value : undefined;
      }
      return text;
    }

    /** The settings card's styles, injected once. */
    function installStyles() {
      if (document.getElementById(STYLE_ID) !== null) return () => {};
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = `
.dsh-nk-section { display: flex; flex-direction: column; gap: 14px; }
.dsh-nk-title { margin: 0; font-size: 15px; font-weight: 600; }
.dsh-nk-intro { margin: 0; font-size: 13px; opacity: 0.72; line-height: 1.5; }
.dsh-nk-status { font-size: 12px; padding: 8px 10px; border-radius: 8px; background: rgba(127,127,127,0.12); }
.dsh-nk-status[data-tone="ok"] { color: #2f8f4e; background: rgba(47,143,78,0.12); }
.dsh-nk-status[data-tone="warn"] { color: #b07a13; background: rgba(176,122,19,0.12); }
.dsh-nk-group-title { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.6; }
.dsh-nk-devices { display: flex; flex-direction: column; gap: 10px; }
.dsh-nk-empty { font-size: 13px; opacity: 0.7; padding: 12px; border: 1px dashed rgba(127,127,127,0.35); border-radius: 10px; }
.dsh-nk-device { border: 1px solid rgba(127,127,127,0.25); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 6px; }
.dsh-nk-device[data-default="1"] { border-color: rgba(90,160,255,0.55); }
.dsh-nk-device-head { display: flex; align-items: center; gap: 8px; }
.dsh-nk-device-name { font-size: 14px; font-weight: 600; }
.dsh-nk-badge { font-size: 11px; padding: 1px 7px; border-radius: 999px; background: rgba(90,160,255,0.18); color: #5aa0ff; }
.dsh-nk-device-addr { font-size: 13px; opacity: 0.8; font-variant-numeric: tabular-nums; }
.dsh-nk-device-note { font-size: 12px; opacity: 0.65; }
.dsh-nk-device-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 2px; }
.dsh-nk-editor { display: flex; flex-direction: column; gap: 8px; border-top: 1px solid rgba(127,127,127,0.2); padding-top: 10px; }
.dsh-nk-edit-row { display: grid; grid-template-columns: minmax(160px, 220px) 1fr; gap: 8px 12px; align-items: center; }
.dsh-nk-edit-label { font-size: 13px; opacity: 0.85; }
.dsh-nk-error { font-size: 12px; color: #d05252; }
.dsh-nk-warn { font-size: 12px; color: #b58b2a; }
.dsh-nk-probe { font-size: 12px; color: #4f9d69; }
.dsh-nk-flash { font-size: 12px; opacity: 0.75; }
.dsh-nk-pane { display: flex; flex-direction: column; gap: 10px; padding: 10px; height: 100%; box-sizing: border-box; }
.dsh-nk-pane-head { display: flex; align-items: center; gap: 8px; }
.dsh-nk-select { font-size: 12px; padding: 4px 6px; border-radius: 6px; background: rgba(127,127,127,0.12); color: inherit; border: 1px solid rgba(127,127,127,0.3); }
.dsh-nk-stage { position: relative; background: #000; border-radius: 8px; overflow: hidden; min-height: 120px; display: flex; align-items: center; justify-content: center; }
.dsh-nk-stage img { display: block; width: 100%; height: auto; user-select: none; -webkit-user-drag: none; pointer-events: none; }
.dsh-nk-stage[data-input="1"] { cursor: crosshair; touch-action: none; overscroll-behavior: contain; }
.dsh-nk-stage-note { color: rgba(255,255,255,0.7); font-size: 12px; padding: 18px 12px; text-align: center; line-height: 1.5; }
.dsh-nk-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.dsh-nk-paste { display: flex; gap: 6px; }
.dsh-nk-paste input { flex: 1; }
.dsh-nk-meta { font-size: 11px; opacity: 0.6; display: flex; justify-content: space-between; gap: 8px; }
`;
      document.head.appendChild(style);
      return () => {
        style.remove();
      };
    }

    /**
     * POST one device action to the plugin's own route. The page never sends the
     * whole device list, so an existing password is not part of the exchange.
     * @param {string} action `save`, `remove`, `default` or `test`.
     * @param {object} body the request body.
     * @returns {Promise<object>} the answer.
     */
    async function callDevice(action, body) {
      const response = await fetch(`${PANEL_BASE}/device?action=${encodeURIComponent(action)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        cache: 'no-store',
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
      return payload;
    }

    /**
     * The device list plus its inline editor.
     * @param {{t:Function, instances:object[], defaultName:string, writable:boolean}} props the component props.
     */
    function DevicesBlock(props) {
      const t = props.t;
      const initial = Array.isArray(props.instances) ? props.instances : [];
      const [entries, setEntries] = React.useState(initial);
      const [editing, setEditing] = React.useState(null);
      const [error, setError] = React.useState(null);
      const [pendingRemove, setPendingRemove] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const [probe, setProbe] = React.useState(null);

      const defaultName = entries.find((entry) => entry.default === true)?.name ?? props.defaultName;

      const applyList = (payload) => {
        if (Array.isArray(payload?.devices)) setEntries(payload.devices);
      };

      const startAdd = () => {
        const draft = { ...DEVICE_DEFAULTS, name: deviceNameFor(entries, entries.length) };
        setEditing({ index: entries.length, isNew: true, draft });
        setError(null);
        setProbe(null);
      };
      const startEdit = (index) => {
        const entry = entries[index] ?? {};
        // The stored password is never shown back; an empty field means "keep it".
        setEditing({ index, isNew: false, draft: { ...DEVICE_DEFAULTS, ...entry, password: '' } });
        setError(null);
        setProbe(null);
      };
      const cancel = () => {
        setEditing(null);
        setError(null);
        setProbe(null);
      };
      const setField = (field, text) => {
        setEditing((current) => (current === null ? null : { ...current, draft: { ...current.draft, [field.name]: text } }));
      };

      const draftDevice = (draft) => ({
        name: String(draft.name ?? '').trim(),
        baseUrl: String(draft.baseUrl ?? '').trim(),
        username: String(draft.username ?? '').trim() === '' ? 'admin' : String(draft.username).trim(),
        insecureTls: draft.insecureTls === true,
        description: String(draft.description ?? ''),
      });

      const save = async () => {
        if (editing === null) return;
        const draft = editing.draft;
        const device = draftDevice(draft);
        if (device.name === '' || device.baseUrl === '') {
          setError(t('devices.required'));
          return;
        }
        const clash = entries.some((entry, index) => index !== editing.index && String(entry?.name ?? '').toLowerCase() === device.name.toLowerCase());
        if (clash) {
          setError(t('devices.duplicate', { name: device.name }));
          return;
        }
        const password = String(draft.password ?? '');
        if (editing.isNew === true && password === '') {
          setError(t('devices.passwordRequired'));
          return;
        }
        setBusy(true);
        setError(null);
        try {
          const payload = await callDevice('save', {
            device,
            password: password === '' ? undefined : password,
            makeDefault: entries.length === 0 ? true : undefined,
          });
          applyList(payload);
          setEditing(null);
        } catch (failure) {
          setError(String(failure?.message ?? failure));
        } finally {
          setBusy(false);
        }
      };

      const test = async (source) => {
        const draft = source ?? editing?.draft ?? {};
        const device = draftDevice(draft);
        if (device.baseUrl === '') {
          setProbe({ ok: false, name: device.name, text: t('devices.required') });
          return;
        }
        const password = String(draft.password ?? '');
        setBusy(true);
        try {
          const payload = await callDevice('test', { device, password: password === '' ? undefined : password });
          const info = payload?.test ?? {};
          setProbe({ ok: true, name: device.name, text: `${t('devices.testOk')}${info.application === undefined || info.application === '' ? '' : ` · ${info.application}`}` });
        } catch (failure) {
          setProbe({ ok: false, name: device.name, text: t('devices.testFailed', { message: String(failure?.message ?? failure) }) });
        } finally {
          setBusy(false);
        }
      };

      const remove = async (index) => {
        if (pendingRemove !== index) {
          setPendingRemove(index);
          return;
        }
        setPendingRemove(null);
        setBusy(true);
        try {
          applyList(await callDevice('remove', { device: { name: entries[index]?.name } }));
        } catch (failure) {
          setError(String(failure?.message ?? failure));
        } finally {
          setBusy(false);
        }
      };

      const makeDefault = async (index) => {
        setBusy(true);
        try {
          applyList(await callDevice('default', { device: { name: entries[index]?.name } }));
        } catch (failure) {
          setError(String(failure?.message ?? failure));
        } finally {
          setBusy(false);
        }
      };

      const editor = editing === null ? null : jsx('div', {
        className: 'dsh-nk-editor',
        children: jsxs('div', {
          children: [
            jsx('div', { className: 'dsh-nk-edit-row', children: jsx('span', { className: 'dsh-nk-edit-label', children: t(editing.isNew === true ? 'devices.addTitle' : 'devices.editTitle', { name: editing.isNew === true ? '' : String(entries[editing.index]?.name ?? '') }) }) }),
            ...DEVICE_FIELDS.map((field) =>
              jsxs(
                'div',
                {
                  className: 'dsh-nk-edit-row',
                  children: [
                    jsx('span', { className: 'dsh-nk-edit-label', children: t(field.labelKey) }),
                    field.kind === 'boolean'
                      ? jsx(Checkbox, {
                          checked: editing.draft[field.name] === true,
                          disabled: !props.writable || busy,
                          label: '',
                          onChange: (nextValue) => setField(field, nextValue),
                        })
                      : jsx('input', {
                          className: 'dsh-nk-input',
                          type: field.kind === 'password' ? 'password' : 'text',
                          value: typeof editing.draft[field.name] === 'string' ? editing.draft[field.name] : toInput(field, editing.draft[field.name]),
                          disabled: !props.writable || busy,
                          spellCheck: false,
                          autoComplete: field.kind === 'password' ? 'new-password' : undefined,
                          placeholder: field.kind === 'password' && editing.isNew !== true ? t('devices.passwordKeep') : field.hintKey === undefined ? '' : t(field.hintKey),
                          onChange: (event) => setField(field, event.target.value),
                        }),
                  ],
                },
                field.name,
              ),
            ),
            error === null ? null : jsx('div', { className: 'dsh-nk-error', children: error }),
            probe === null ? null : jsx('div', { className: probe.ok === true ? 'dsh-nk-probe' : 'dsh-nk-error', children: probe.text }),
            jsxs('div', {
              className: 'dsh-nk-device-actions',
              children: [
                jsx(Button, { variant: 'primary', size: 'sm', disabled: !props.writable || busy, onClick: save, children: t('devices.save') }),
                jsx(Button, { variant: 'secondary', size: 'sm', disabled: busy, onClick: () => test(null), children: busy ? t('devices.testing') : t('devices.test') }),
                jsx(Button, { variant: 'secondary', size: 'sm', disabled: busy, onClick: cancel, children: t('devices.cancel') }),
              ],
            }),
          ],
        }),
      });

      return jsxs('div', {
        className: 'dsh-nk-devices',
        children: [
          jsxs('div', {
            className: 'dsh-nk-device-head',
            children: [
              jsx('div', { className: 'dsh-nk-group-title', children: t('devices.title') }),
              jsx('span', { style: { flex: '1' } }),
              jsx(Button, { variant: 'primary', size: 'sm', disabled: !props.writable || editing !== null, onClick: startAdd, children: t('devices.add') }),
            ],
          }),
          entries.length === 0 && editing === null ? jsx('div', { className: 'dsh-nk-empty', children: t('devices.empty') }) : null,
          ...entries.map((entry, index) =>
            jsxs(
              'div',
              {
                className: 'dsh-nk-device',
                'data-default': entry.name === defaultName ? '1' : '0',
                children: [
                  jsxs('div', {
                    className: 'dsh-nk-device-head',
                    children: [
                      jsx('span', { className: 'dsh-nk-device-name', children: entry.name }),
                      entry.name === defaultName ? jsx('span', { className: 'dsh-nk-badge', children: t('devices.defaultBadge') }) : null,
                      jsx('span', { className: 'dsh-nk-badge', children: entry.hasPassword === false ? t('devices.keyMissing') : t('devices.keyStored') }),
                    ],
                  }),
                  jsx('div', { className: 'dsh-nk-device-addr', children: `${entry.username ?? 'admin'}@${deviceAddress(entry)}` }),
                  String(entry.description ?? '') === '' ? null : jsx('div', { className: 'dsh-nk-device-note', children: String(entry.description) }),
                  jsxs('div', {
                    className: 'dsh-nk-device-actions',
                    children: [
                      jsx(Button, { variant: 'secondary', size: 'sm', disabled: !props.writable || busy, onClick: () => test(entry), children: t('devices.test') }),
                      jsx(Button, { variant: 'secondary', size: 'sm', disabled: !props.writable || busy, onClick: () => startEdit(index), children: t('devices.edit') }),
                      jsx(Button, {
                        variant: 'secondary',
                        size: 'sm',
                        disabled: !props.writable || busy,
                        onClick: () => remove(index),
                        children: pendingRemove === index ? t('devices.confirmRemove') : t('devices.remove'),
                      }),
                      entry.name === defaultName
                        ? null
                        : jsx(Button, { variant: 'ghost', size: 'sm', disabled: !props.writable || busy, onClick: () => makeDefault(index), children: t('devices.makeDefault') }),
                    ],
                  }),
                ],
              },
              entry.name ?? index,
            ),
          ),
          probe === null || editing !== null ? null : jsx('div', { className: probe.ok === true ? 'dsh-nk-probe' : 'dsh-nk-error', children: probe.text }),
          editor,
        ],
      });
    }


    /**
     * The settings card.
     * @param {{ctx:object, t:Function}} props the slot props.
     */
    function NanokvmSection(props) {
      const t = props.t;
      const form = React.useMemo(() => props.ctx.configForms.get(NAMESPACE), [props.ctx]);
      const [snapshot, setSnapshot] = React.useState(() => form.getSnapshot());
      const [flash, setFlash] = React.useState(null);
      const [error, setError] = React.useState(null);

      React.useEffect(() => form.subscribe(() => setSnapshot(form.getSnapshot())), [form]);

      const value = snapshot?.value ?? {};
      const userLayer = snapshot?.user ?? {};
      const writable = snapshot?.writable === true && snapshot?.status === 'ready';
      const instances = Array.isArray(value.devices) ? value.devices : [];

      const statusTone =
        snapshot?.status === 'ready' ? 'ok' : snapshot?.status === 'readonly' || snapshot?.status === 'unavailable' ? 'warn' : undefined;
      const statusText =
        snapshot?.status === 'loading'
          ? t('statusLoading')
          : writable
            ? t('statusReady')
            : snapshot?.status === 'unavailable'
              ? t('statusUnavailable')
              : t('statusReadOnly');

      return jsxs('div', {
        className: 'dsh-nk-section',
        children: [
          jsx('div', { className: 'dsh-nk-title', children: t('title') }),
          jsx('div', { className: 'dsh-nk-intro', children: t('intro') }),
          jsx('div', { className: 'dsh-nk-status', 'data-tone': statusTone, children: statusText }),
          jsx(DevicesBlock, {
            t,
            instances,
            defaultName: String(value.defaultDevice ?? ''),
            writable,
          }),
          jsx('div', { className: 'dsh-nk-group-title', children: t('devices.global') }),
          ...FIELDS.map((field) =>
            jsxs(
              'div',
              {
                className: 'dsh-nk-edit-row',
                children: [
                  jsx('span', { className: 'dsh-nk-edit-label', children: t(`field.${field.name}`) }),
                  field.kind === 'boolean'
                    ? jsx(Checkbox, {
                        checked: value[field.name] === true,
                        disabled: !writable,
                        label: '',
                        onChange: async (next) => {
                          try {
                            if (!(await form.set(field.name, next))) throw new Error(t('saveFailed'));
                            setFlash(t('saved'));
                          } catch (failure) {
                            setError(String(failure?.message ?? failure));
                          }
                        },
                      })
                    : jsx(Input, {
                        value: toInput(field, value[field.name]),
                        disabled: !writable,
                        spellCheck: false,
                        inputMode: field.kind === 'number' ? 'numeric' : undefined,
                        onChange: (event) => {
                          const next = fromInput(field, event.target.value);
                          if (next === undefined) return;
                          form.set(field.name, next).then((accepted) => {
                            if (accepted) setFlash(t('saved'));
                          });
                        },
                      }),
                ],
              },
              field.name,
            ),
          ),
          error === null ? null : jsx('div', { className: 'dsh-nk-error', children: error }),
          flash === null ? null : jsx('div', { className: 'dsh-nk-flash', children: flash }),
        ],
      });
    }

    /**
     * The panel's title, in the tab strip.
     * @param {{useTabInfo?:Function, t?:Function}} props the slot props.
     */
    function PanelTitle(props) {
      const t = props.t;
      return jsx('span', { children: t('tab.title') });
    }

    /** Read the frame size from its headers. */
    function readFrameMeta(headers) {
      const raw = headers.get('x-nanokvm-resolution') ?? '';
      const [width, height] = raw.split('x').map((part) => Number(part));
      return {
        device: decodeURIComponent(headers.get('x-nanokvm-device') ?? ''),
        width: Number.isFinite(width) ? width : 0,
        height: Number.isFinite(height) ? height : 0,
        capturedAt: Number(headers.get('x-nanokvm-captured-at') ?? 0),
      };
    }

    /**
     * The right-sidebar panel.
     * @param {{t:Function, ctx:object, form:object, useTabInfo?:Function}} props the slot props.
     */
    function NanokvmPane(props) {
      const t = props.t;
      const form = props.form;
      const tab = typeof props.useTabInfo === 'function' ? props.useTabInfo() : null;
      const visible = tab?.tab?.visible !== false;

      const [settings, setSettings] = React.useState(() => form.getSnapshot()?.value ?? {});
      const [state, setState] = React.useState(null);
      const [devices, setDevices] = React.useState([]);
      // The user's pick. It wins over the server's answer: otherwise a poll for
      // the box that was just selected would snap the picker back to the previous
      // one whenever that box fails to answer.
      const [selected, setSelected] = React.useState(null);
      const [frame, setFrame] = React.useState(null);
      const [frameError, setFrameError] = React.useState(null);
      const [note, setNote] = React.useState(null);
      const [paste, setPaste] = React.useState('');
      const [busy, setBusy] = React.useState(false);
      const [tick, setTick] = React.useState(0);
      const frameUrl = React.useRef(null);
      const stageRef = React.useRef(null);
      const dragRef = React.useRef(null);
      const lastPointRef = React.useRef(null);
      const lastMoveRef = React.useRef(0);
      const pointerApiRef = React.useRef(null);

      React.useEffect(() => form.subscribe(() => setSettings(form.getSnapshot()?.value ?? {})), [form]);

      const fps = Math.min(4, Math.max(1, Number(settings?.viewFps ?? DEFAULT_FPS)));
      const deviceEff =
        selected ?? state?.device ?? (typeof settings?.defaultDevice === 'string' && settings.defaultDevice !== '' ? settings.defaultDevice : null) ?? devices.find((entry) => entry.default === true)?.name ?? devices[0]?.name ?? null;

      // The device list and its live state.
      React.useEffect(() => {
        if (!visible) return undefined;
        let cancelled = false;
        let timer;
        const poll = async () => {
          try {
            const query = selected === null ? '' : `?device=${encodeURIComponent(selected)}`;
            const response = await fetch(`${PANEL_BASE}/state${query}`, { headers: { accept: 'application/json' }, cache: 'no-store' });
            const body = await response.json().catch(() => ({}));
            if (cancelled) return;
            // The answer always carries the device list, even when the box itself
            // did not answer — that is what keeps the picker usable.
            if (Array.isArray(body?.devices)) setDevices(body.devices);
            setState(body);
            setNote(response.ok ? (body?.error ?? null) : (body?.error ?? `HTTP ${response.status}`));
          } catch (failure) {
            if (!cancelled) setNote(String(failure?.message ?? failure));
          } finally {
            if (!cancelled) timer = setTimeout(poll, STATE_POLL_MS);
          }
        };
        poll();
        return () => {
          cancelled = true;
          clearTimeout(timer);
        };
      }, [visible, selected]);

      // A switch must not leave the previous box's picture on screen while the
      // new one is being fetched.
      React.useEffect(() => {
        setFrame(null);
        setFrameError(null);
      }, [deviceEff]);

      // The frame stream: the next request only after the previous answer.
      React.useEffect(() => {
        if (!visible) return undefined;
        let cancelled = false;
        let timer;
        const step = async () => {
          const started = Date.now();
          try {
            const query = deviceEff === null ? '' : `?device=${encodeURIComponent(deviceEff)}`;
            const response = await fetch(`${PANEL_BASE}/frame${query}`, { cache: 'no-store' });
            if (!response.ok) {
              const body = await response.json().catch(() => ({}));
              throw new Error(body.error ?? `HTTP ${response.status}`);
            }
            const blob = await response.blob();
            if (cancelled) return;
            const next = URL.createObjectURL(blob);
            if (frameUrl.current !== null) URL.revokeObjectURL(frameUrl.current);
            frameUrl.current = next;
            setFrame({ url: next, meta: readFrameMeta(response.headers), bytes: blob.size, at: Date.now() });
            setFrameError(null);
          } catch (failure) {
            if (!cancelled) setFrameError(String(failure?.message ?? failure));
          } finally {
            if (!cancelled) {
              const wait = Math.max(200, Math.round(1000 / fps) - (Date.now() - started));
              timer = setTimeout(step, wait);
            }
          }
        };
        step();
        return () => {
          cancelled = true;
          clearTimeout(timer);
        };
      }, [visible, deviceEff, fps, tick]);

      React.useEffect(
        () => () => {
          if (frameUrl.current !== null) URL.revokeObjectURL(frameUrl.current);
        },
        [],
      );

      const act = async (action, body = {}) => {
        setBusy(true);
        setNote(null);
        try {
          const response = await fetch(`${PANEL_BASE}/action?action=${encodeURIComponent(action)}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            cache: 'no-store',
            body: JSON.stringify({ device: deviceEff, ...body }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
          setNote(null);
          setTick((value) => value + 1);
        } catch (failure) {
          setNote(t('pane.failed', { message: String(failure?.message ?? failure) }));
        } finally {
          setBusy(false);
        }
      };

      // Click and drag are absolute pointer reports on the frame: the press sends
      // the button mask, the moves keep it, the release sends 0. The server maps
      // pixels with the frame size and refuses when input injection is off.
      const inputOn = state?.injectInput !== false;

      const pointOf = (event) => {
        const node = stageRef.current;
        const meta = frame?.meta;
        if (node === null || !meta || !(meta.width > 0) || !(meta.height > 0)) return null;
        const rect = node.getBoundingClientRect();
        if (!(rect.width > 0) || !(rect.height > 0)) return null;
        return {
          x: Math.round(((event.clientX - rect.left) / rect.width) * meta.width),
          y: Math.round(((event.clientY - rect.top) / rect.height) * meta.height),
          width: meta.width,
          height: meta.height,
        };
      };

      const pushPointer = async (point, buttons, wheel = 0) => {
        try {
          await fetch(`${PANEL_BASE}/action?action=pointer`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            cache: 'no-store',
            body: JSON.stringify({ device: deviceEff, ...point, buttons, wheel }),
          });
        } catch {
          // A dropped move is harmless: the next report carries the position.
        }
      };

      React.useEffect(() => {
        pointerApiRef.current = { pointOf, pushPointer, inputOn };
      });

      React.useEffect(() => {
        const node = stageRef.current;
        if (node === null) return undefined;
        const onWheel = (event) => {
          const api = pointerApiRef.current;
          if (api === null || !api.inputOn) return;
          const point = api.pointOf(event);
          if (point === null) return;
          event.preventDefault();
          void api.pushPointer(point, 0, event.deltaY > 0 ? -1 : 1);
        };
        node.addEventListener('wheel', onWheel, { passive: false });
        return () => node.removeEventListener('wheel', onWheel);
      }, [frame === null]);

      const rightClick = async (point) => {
        await pushPointer(point, 2);
        await new Promise((resolve) => setTimeout(resolve, 40));
        await pushPointer(point, 0);
      };

      const stageInput = inputOn
        ? {
            'data-input': '1',
            onPointerDown: (event) => {
              const point = pointOf(event);
              if (point === null) return;
              event.preventDefault();
              const mask = event.button === 2 ? 2 : event.button === 1 ? 4 : 1;
              dragRef.current = mask;
              lastPointRef.current = point;
              try {
                event.currentTarget.setPointerCapture?.(event.pointerId);
              } catch {
                // Older engines without pointer capture: the release still lands.
              }
              void pushPointer(point, mask);
            },
            onPointerMove: (event) => {
              if (dragRef.current === null) return;
              const now = Date.now();
              if (now - lastMoveRef.current < 90) return;
              const point = pointOf(event);
              if (point === null) return;
              lastMoveRef.current = now;
              lastPointRef.current = point;
              void pushPointer(point, dragRef.current);
            },
            onPointerUp: (event) => {
              const was = dragRef.current;
              dragRef.current = null;
              const point = pointOf(event) ?? lastPointRef.current;
              if (was === null || point === null) return;
              void pushPointer(point, 0);
            },
            onPointerCancel: () => {
              const was = dragRef.current;
              dragRef.current = null;
              if (was === null || lastPointRef.current === null) return;
              void pushPointer(lastPointRef.current, 0);
            },
            onContextMenu: (event) => {
              event.preventDefault();
              const point = pointOf(event);
              if (point === null) return;
              void rightClick(point);
            },
          }
        : {};

      const gpio = state?.gpio ?? null;
      const powerKnown = typeof gpio?.pwr === 'boolean';
      const powered = powerKnown ? gpio.pwr : null;

      return jsxs('div', {
        className: 'dsh-nk-pane',
        children: [
          jsxs('div', {
            className: 'dsh-nk-pane-head',
            children: [
              devices.length > 1
                ? jsx('select', {
                    className: 'dsh-nk-select',
                    value: deviceEff ?? '',
                    onChange: (event) => {
                      setSelected(event.target.value === '' ? null : event.target.value);
                      setFrame(null);
                      setFrameError(null);
                      setNote(null);
                    },
                    children: devices.map((entry) =>
                      jsx('option', { value: entry.name, children: `${entry.name} · ${String(entry.baseUrl ?? '').replace(/^https?:\/\//, '')}` }, entry.name),
                    ),
                  })
                : jsx('span', { className: 'dsh-nk-device-name', children: deviceEff ?? t('tab.title') }),
              jsx('span', { style: { flex: '1' } }),
              jsx(Button, { variant: 'ghost', size: 'sm', disabled: busy, onClick: () => setTick((value) => value + 1), children: t('pane.refresh') }),
            ],
          }),
          jsx('div', {
            className: 'dsh-nk-stage',
            ref: stageRef,
            ...stageInput,
            children:
              frame === null
                ? jsx('div', { className: 'dsh-nk-stage-note', children: frameError ?? t('pane.noFrame') })
                : jsx('img', { src: frame.url, alt: '' }),
          }),
          jsxs('div', {
            className: 'dsh-nk-meta',
            children: [
              jsx('span', {
                children:
                  powered === null ? t('pane.unknown') : powered ? t('pane.powered') : t('pane.down'),
              }),
              jsx('span', {
                children:
                  frame === null
                    ? ''
                    : `${frame.meta.width}x${frame.meta.height} · ${t('pane.updated', { time: new Date(frame.at).toLocaleTimeString() })}`,
              }),
            ],
          }),
          inputOn ? null : jsx('div', { className: 'dsh-nk-warn', children: t('pane.inputOff') }),
          jsxs('div', {
            className: 'dsh-nk-actions',
            children: [
              jsx(Button, { variant: 'secondary', size: 'sm', disabled: busy, onClick: () => act('power', { mode: 'on' }), children: t('pane.on') }),
              jsx(Button, { variant: 'secondary', size: 'sm', disabled: busy, onClick: () => act('power', { mode: 'off' }), children: t('pane.off') }),
              jsx(Button, { variant: 'secondary', size: 'sm', disabled: busy, onClick: () => act('power', { mode: 'press' }), children: t('pane.press') }),
              jsx(Button, { variant: 'secondary', size: 'sm', disabled: busy, onClick: () => act('reset'), children: t('pane.reset') }),
              jsx(Button, { variant: 'secondary', size: 'sm', disabled: busy, onClick: () => act('key', { keys: ['enter'] }), children: t('pane.enter') }),
              jsx(Button, { variant: 'ghost', size: 'sm', disabled: busy, onClick: () => act('hdmi', { mode: 'reset' }), children: t('pane.hdmiReset') }),
            ],
          }),
          jsxs('div', {
            className: 'dsh-nk-paste',
            children: [
              jsx('input', {
                className: 'dsh-nk-input',
                value: paste,
                spellCheck: false,
                placeholder: t('pane.pasteHint'),
                onChange: (event) => setPaste(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter' && paste !== '') {
                    act('paste', { text: paste }).then(() => setPaste(''));
                  }
                },
              }),
              jsx(Button, {
                variant: 'secondary',
                size: 'sm',
                disabled: busy || paste === '',
                onClick: () => act('paste', { text: paste }).then(() => setPaste('')),
                children: t('pane.send'),
              }),
            ],
          }),
          note === null ? null : jsx('div', { className: 'dsh-nk-error', children: note }),
        ],
      });
    }

    /**
     * Attach the card and the panel.
     * @param {object} ctx the client context.
     */
    function apply(ctx) {
      ctx.effect(() => installStyles(), 'dsh-nanokvm: styles');
      ctx.effect(() => {
        const disposers = Object.entries(DICTIONARIES).map(([locale, dict]) => ctx.locale.register(LOCALE_NS, locale, dict));
        return () => {
          for (const dispose of disposers) dispose();
        };
      }, 'dsh-nanokvm: dictionaries');

      const translate = () => ctx.locale.bind(LOCALE_NS);
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: NAMESPACE,
            order: 31,
            label: () => translate()('section'),
            inject: () => ({ ctx, t: translate() }),
          },
          NanokvmSection,
        ),
      );

      ctx.inject(['sidebarRight', 'sidebarRightTabs'], (scoped) => {
        const disposers = [];
        const own = (dispose) => {
          if (typeof dispose === 'function') disposers.push(dispose);
        };
        own(
          scoped.sidebarRightTabs.register({
            id: TAB_ID,
            kind: TAB_KIND,
            title: () => translate()('tab.title'),
            guide: [
              {
                id: 'panel',
                order: 58,
                title: () => translate()('tab.title'),
                description: () => translate()('tab.guide'),
              },
            ],
          }),
        );
        const injectPane = () => ({ ctx, form: ctx.configForms.get(NAMESPACE) });
        own(
          scoped.slots.inject('sidebar.right.pane.tab', () =>
            scoped.slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID, locale: LOCALE_NS, inject: injectPane }, NanokvmPane),
          ),
        );
        own(
          scoped.slots.inject('sidebar.right.pane.tab.title', () =>
            scoped.slots.register({ name: 'sidebar.right.pane.tab.title', key: TAB_ID, locale: LOCALE_NS }, PanelTitle),
          ),
        );
        return () => {
          for (const dispose of disposers.reverse()) dispose();
        };
      });
    }

  module.exports.apply = apply;
  module.exports.inject = ['slots', 'locale', 'configForms'];
  return module.exports;
}
