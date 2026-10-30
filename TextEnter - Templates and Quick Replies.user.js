// ==UserScript==
// @name         TextEnter - Templates and Quick Replies
// @namespace    https://textenter.local/
// @version      0.1
// @description  Message templates, tags, // menu, custom variables, tagged people profiles, backups, and isolated settings workspace
// @author       TextEnter Studio
// @license      MIT
// @match        *://*/*
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_openInTab
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

/* global GM_getValue, GM_setValue, GM_registerMenuCommand, GM_openInTab, GM_setClipboard */

(function () {
  "use strict";

  if (window.__textEnterLoaded) {
    return;
  }
  window.__textEnterLoaded = true;

  var DEFAULT_CONFIG = {
  "version": 3,
  "stamp": "4-1448",
  "typingDelay": 0,
  "triggerPrefix": "/",
  "attachImages": true,
  "folders": [
    "Общие",
    "Продажи",
    "Поддержка"
  ],
  "folderPreferences": [],
  "customVariables": [
    {
      "id": "var-promo",
      "name": "promo_word",
      "value": "скидка"
    },
    {
      "id": "var-deadline",
      "name": "deadline",
      "value": "{{date+3}}"
    },
    {
      "id": "var-today",
      "name": "today_date",
      "value": "{{datetoday}}"
    }
  ],
  "profile": {
    "name": "Иван",
    "surname": "Иванов",
    "email": "hello@example.com",
    "phone": "+7 999 000-00-00",
    "company": "TextEnter"
  },
  "profiles": [],
  "activeProfileId": "",
  "profileFields": [],
  "recordSets": [],
  "folderDomainModes": {},
  "folderIcons": {},
  "templates": [
    {
      "id": "tpl-hello",
      "name": "Приветствие клиента",
      "tag": "hi",
      "folder": "Продажи",
      "domains": [],
      "body": "[[Здравствуйте|Добрый день|Приветствую]], {{name}}!\nМеня зовут {{fullname}}, компания {{company}}. Чем могу помочь?",
      "images": [],
      "previewBeforeInsert": false
    },
    {
      "id": "tpl-price",
      "name": "Отправка прайса",
      "tag": "price",
      "folder": "Продажи",
      "domains": [],
      "body": "Отправляю актуальный прайс на {{date}}.\nЕсли нужны индивидуальные условия — напишите, подберём вариант.",
      "images": [],
      "previewBeforeInsert": false
    },
    {
      "id": "tpl-order",
      "name": "Уточнение заказа",
      "tag": "order",
      "folder": "Поддержка",
      "domains": [],
      "body": "Подскажите, пожалуйста, номер заказа и удобное время для связи.\nНаши контакты: {{phone}}, {{email}}.",
      "images": [],
      "previewBeforeInsert": false
    },
    {
      "id": "tpl-thanks",
      "name": "Благодарность",
      "tag": "ty",
      "folder": "Общие",
      "domains": [],
      "body": "[[Спасибо за обращение|Благодарю за ваше сообщение|Спасибо, что написали]]! Хорошего дня 🙂",
      "images": [],
      "previewBeforeInsert": false
    }
  ]
};
  var STORE_KEY = "textenter_config_v3";
  var SETTINGS_PARAM = "textenter_settings";
  // v0.1: проект переименован Formix -> TextEnter. Старые ключи читаем при миграции.
  var LEGACY_STORE_KEY = "formix_tm_config_v3";
  var BACKUP_INDEX_KEY = "textenter_backups_v3";
  var BACKUP_KEY_PREFIX = "textenter_backup_v3_";
  var LEGACY_BACKUP_INDEX_KEY = "formix_tm_backups_v3";
  var LEGACY_BACKUP_KEY_PREFIX = "formix_tm_backup_v3_";
  var MAX_BACKUPS = 10;
  var legacyLocalCleaned = false;
  var legacyKeysMigrated = false;
  var FIELD_SELECTOR =
    "textarea, input[type=text], input[type=search], input[type=email], input[type=url], input[type=tel], input:not([type]), [contenteditable=true], [contenteditable=plaintext-only]";

  var config = loadConfig();
  var menu = { open: false, items: [], index: 0, start: -1, field: null, mode: "none", folder: "", query: "" };
  var menuHost = null;
  var menuEl = null;
  var menuSearchEl = null;
  var previewHost = null;
  var previewEl = null;
  var previewState = null;

  registerCommands();
  hydrateConfigAsync();

  if (isSettingsMode()) {
    renderSettingsPage();
    return;
  }

  document.addEventListener("input", handleInput, true);
  document.addEventListener("keydown", handleKeydown, true);
  document.addEventListener("keydown", handleGlobalHotkeys, true);
  document.addEventListener("mousedown", handleOutsideClick, true);
  window.addEventListener("scroll", function () {
    closeMenu();
    closePreview();
  }, true);
  window.addEventListener("resize", function () {
    closeMenu();
    closePreview();
  }, true);

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function debugLog() {
    // v0.1: логирование только при явном включении: localStorage.textenter_debug = "1"
    // (или window.__textEnterDebug = true из консоли). Никаких данных не пишет.
    try {
      var debugFlag = window.localStorage.getItem("textenter_debug") === "1" ||
        window.localStorage.getItem("formix_tm_debug") === "1"; // старый флаг, для совместимости
      if (window.__textEnterDebug === true || debugFlag) {
        var args = ["[TextEnter]"].concat(Array.prototype.slice.call(arguments));
        console.debug.apply(console, args);
      }
    } catch (error) {
      /* ignore */
    }
  }

  function copyTextToClipboard(text, fallbackPromptTitle) {
    var done = function () {};
    try {
      if (typeof GM_setClipboard === "function") {
        GM_setClipboard(text);
        return true;
      }
    } catch (error) {
      /* ignore, try next method */
    }
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      navigator.clipboard.writeText(text).catch(function () {
        window.prompt(fallbackPromptTitle || "Скопируйте текст", text);
      });
      return true;
    }
    window.prompt(fallbackPromptTitle || "Скопируйте текст", text);
    return false;
  }

  function downloadJsonFile(filename, text) {
    try {
      var blob = new Blob([text], { type: "application/json;charset=utf-8" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
        a.download = filename || "textenter-config.json";
      document.documentElement.appendChild(a);
      a.click();
      window.setTimeout(function () {
        try {
          URL.revokeObjectURL(a.href);
        } catch (e) { /* ignore */ }
        if (a.parentNode) {
          a.parentNode.removeChild(a);
        }
      }, 1000);
      return true;
    } catch (error) {
      return false;
    }
  }

  function safeGet(key, fallback) {
    // v3.12.0: читаем только из GM-хранилища менеджера скриптов (Tampermonkey/ScriptCat).
    // localStorage хост-сайтов больше НЕ используется: конфиг содержит персональные
    // данные профилей, и его копия была доступна скриптам каждого сайта.
    // Fallback на localStorage остался только для менеджеров без sync GM_getValue.
    try {
      if (typeof GM_getValue === "function") {
        return GM_getValue(key, fallback);
      }
    } catch (error) {
      debugLog("safeGet: GM_getValue failed", error);
    }
    try {
      var local = window.localStorage.getItem(key);
      return local === null ? fallback : local;
    } catch (error) {
      return fallback;
    }
  }

  function gmSyncAvailable() {
    return typeof GM_setValue === "function" && typeof GM_getValue === "function";
  }

  function safeSet(key, value) {
    // v3.12.0: пишем только в GM-хранилище. localStorage — только если менеджер
    // скриптов вообще не дает sync GM API (тогда это единственный storage).
    if (gmSyncAvailable()) {
      try {
        GM_setValue(key, value);
        return;
      } catch (error) {
        debugLog("safeSet: GM_setValue failed", error);
      }
    }
    try {
      if (typeof GM !== "undefined" && GM && typeof GM.setValue === "function") {
        GM.setValue(key, value).catch(function () { /* ignore */ });
      }
    } catch (error) {
      debugLog("safeSet: GM.setValue failed", error);
    }
    if (!gmSyncAvailable()) {
      try {
        window.localStorage.setItem(key, value);
      } catch (error) {
        debugLog("safeSet: localStorage failed", error);
      }
    }
  }

  var configDirty = false;

  function hydrateConfigAsync() {
    // v3.12.0: подтягиваем актуальный конфиг из async GM.getValue (нужен менеджерам
    // без sync-чтения). Раньше безусловно перезаписывали config — это могло затереть
    // изменения, сделанные в этой вкладке после старта. Теперь применяем только если:
    // 1) локально конфиг не менялся (configDirty), и
    // 2) пришедший конфиг реально отличается от текущего.
    try {
      if (typeof GM !== "undefined" && GM && typeof GM.getValue === "function") {
        GM.getValue(STORE_KEY, "").then(function (raw) {
          if (!raw || configDirty) {
            return;
          }
          try {
            var parsed = normalize(JSON.parse(raw));
            if (JSON.stringify(parsed) !== JSON.stringify(config)) {
              debugLog("hydrateConfigAsync: applying newer config from GM storage");
              config = parsed;
            }
          } catch (error) {
            debugLog("hydrateConfigAsync: parse failed", error);
          }
        }).catch(function (error) {
          debugLog("hydrateConfigAsync: GM.getValue failed", error);
        });
      }
    } catch (error) {
      debugLog("hydrateConfigAsync: setup failed", error);
    }
  }

  function normalize(input) {
    var source = input && typeof input === "object" ? input : {};
    var list = Array.isArray(source.templates) ? source.templates : [];
    var profile = source.profile && typeof source.profile === "object" ? source.profile : {};
    var folders = Array.isArray(source.folders) ? source.folders : [];
    var folderPreferences = Array.isArray(source.folderPreferences) ? source.folderPreferences : [];
    var customVariables = Array.isArray(source.customVariables) ? source.customVariables : [];
    var rawProfiles = Array.isArray(source.profiles) ? source.profiles : [];

    var legacyProfile = {
      name: String(profile.name || ""),
      surname: String(profile.surname || ""),
      email: String(profile.email || ""),
      phone: String(profile.phone || ""),
      company: String(profile.company || ""),
      position: String(profile.position || "")
    };
    var rawProfileFields = Array.isArray(source.profileFields) ? source.profileFields : [];
    var rawFolderDomains = (source.folderDomains && typeof source.folderDomains === "object" && !Array.isArray(source.folderDomains)) ? source.folderDomains : {};
    var folderDomains = {};
    Object.keys(rawFolderDomains).forEach(function (k) {
      var name = String(k || "").trim();
      var cleaned = cleanDomainList(rawFolderDomains[k]);
      if (name && cleaned.length) {
        folderDomains[name] = cleaned;
      }
    });
    // v3.11.0: режимы доменов папки (all/only/except) и иконки.
    // Миграция: у папок с непустым списком был фактический whitelist -> only.
    var rawDomainModes = (source.folderDomainModes && typeof source.folderDomainModes === "object" && !Array.isArray(source.folderDomainModes)) ? source.folderDomainModes : {};
    var folderDomainModes = {};
    Object.keys(rawDomainModes).forEach(function (k) {
      var name = String(k || "").trim();
      var mode = String(rawDomainModes[k] || "").trim().toLowerCase();
      if (name && (mode === "only" || mode === "except" || mode === "all")) {
        folderDomainModes[name] = mode;
      }
    });
    Object.keys(folderDomains).forEach(function (name) {
      if (!folderDomainModes[name]) {
        folderDomainModes[name] = "only";
      }
    });
    var rawIcons = (source.folderIcons && typeof source.folderIcons === "object" && !Array.isArray(source.folderIcons)) ? source.folderIcons : {};
    var folderIcons = {};
    Object.keys(rawIcons).forEach(function (k) {
      var name = String(k || "").trim();
      var icon = Array.from(String(rawIcons[k] || "").trim()).slice(0, 4).join("");
      if (name && icon) {
        folderIcons[name] = icon;
      }
    });

    function cleanProfileFields(raw) {
      var out = {};
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        Object.keys(raw).forEach(function (k) {
          var key = sanitizeProfileFieldName(k);
          if (key) {
            out[key] = String(raw[k] == null ? "" : raw[k]);
          }
        });
      }
      return out;
    }

    var profiles = rawProfiles
      .filter(function (item) {
        return item && typeof item === "object";
      })
      .map(function (item, index) {
        return {
          id: String(item.id || "prof-" + index),
          tag: sanitizeTag(item.tag),
          name: String(item.name || ""),
          surname: String(item.surname || ""),
          email: String(item.email || ""),
          phone: String(item.phone || ""),
          company: String(item.company || ""),
          position: String(item.position || ""),
          fields: cleanProfileFields(item.fields)
        };
      });
    // v3.5.0: миграция одиночного profile в список людей.
    if (!profiles.length) {
      if (legacyProfile.name || legacyProfile.surname || legacyProfile.email ||
          legacyProfile.phone || legacyProfile.company || legacyProfile.position) {
        profiles.push({
          id: "prof-default",
          tag: "",
          name: legacyProfile.name,
          surname: legacyProfile.surname,
          email: legacyProfile.email,
          phone: legacyProfile.phone,
          company: legacyProfile.company,
          position: legacyProfile.position,
          fields: {}
        });
      } else {
        profiles.push({ id: "prof-default", tag: "", name: "", surname: "", email: "", phone: "", company: "", position: "", fields: {} });
      }
    }
    // v3.6.0: общие поля людей (одинаковые ключи у всех).
    var profileFields = rawProfileFields
      .filter(function (item) {
        return item && typeof item === "object";
      })
      .map(function (item, index) {
        return {
          id: String(item.id || "pf-" + index),
          name: sanitizeProfileFieldName(item.name)
        };
      })
      .filter(function (item) {
        return item.name.length > 0;
      });
    // Убираем дубли имен полей, builtin-имена запрещены.
    var seenFieldNames = {};
    profileFields = profileFields.filter(function (item) {
      if (seenFieldNames[item.name] || profileBuiltinFields().indexOf(item.name) !== -1) {
        return false;
      }
      seenFieldNames[item.name] = true;
      return true;
    });
    // v3.7.0: справочники — произвольные категории записей с тегами и полями.
    var rawSets = Array.isArray(source.recordSets) ? source.recordSets : [];
    var recordSets = rawSets
      .filter(function (item) {
        return item && typeof item === "object";
      })
      .map(function (item, si) {
        var setFields = (Array.isArray(item.fields) ? item.fields : [])
          .filter(function (f) {
            return f && typeof f === "object";
          })
          .map(function (f, fi) {
            return {
              id: String(f.id || ("rf-" + si + "-" + fi)),
              name: sanitizeProfileFieldName(f.name)
            };
          })
          .filter(function (f) {
            return f.name.length > 0;
          });
        var seenSetFields = {};
        setFields = setFields.filter(function (f) {
          if (seenSetFields[f.name]) {
            return false;
          }
          seenSetFields[f.name] = true;
          return true;
        });
        var records = (Array.isArray(item.records) ? item.records : [])
          .filter(function (r) {
            return r && typeof r === "object";
          })
          .map(function (r, ri) {
            var values = {};
            if (r.values && typeof r.values === "object" && !Array.isArray(r.values)) {
              Object.keys(r.values).forEach(function (k) {
                var key = sanitizeProfileFieldName(k);
                if (key) {
                  values[key] = String(r.values[k] == null ? "" : r.values[k]);
                }
              });
            }
            return {
              id: String(r.id || ("rec-" + si + "-" + ri)),
              tag: sanitizeTag(r.tag),
              values: values
            };
          });
        var activeRid = String(item.activeRecordId || "");
        if (!records.some(function (r) { return r.id === activeRid; })) {
          activeRid = records[0] ? records[0].id : "";
        }
        return {
          id: String(item.id || ("set-" + si)),
          name: String(item.name || "").trim() || ("Справочник " + (si + 1)),
          fields: setFields,
          records: records,
          activeRecordId: activeRid
        };
      });
    var activeProfileId = String(source.activeProfileId || "");
    if (!profiles.some(function (p) { return p.id === activeProfileId; })) {
      activeProfileId = profiles[0].id;
    }
    // profile оставляем синхронизированным с активным (обратная совместимость).
    var activeProf = profiles.filter(function (p) { return p.id === activeProfileId; })[0] || profiles[0];
    legacyProfile = {
      name: activeProf.name,
      surname: activeProf.surname,
      email: activeProf.email,
      phone: activeProf.phone,
      company: activeProf.company,
      position: activeProf.position
    };

    return {
      version: 3,
      stamp: typeof source.stamp === "string" ? source.stamp : "",
      typingDelay: Math.max(0, Number(source.typingDelay) || 0),
      triggerPrefix: typeof source.triggerPrefix === "string" && source.triggerPrefix ? source.triggerPrefix : "/",
      attachImages: source.attachImages !== false,
      profile: legacyProfile,
      profiles: profiles,
      activeProfileId: activeProfileId,
      profileFields: profileFields,
      folderDomains: folderDomains,
      folderDomainModes: folderDomainModes,
      folderIcons: folderIcons,
      recordSets: recordSets,
      folders: folders
        .map(function (folder) {
          return String(folder || "").trim();
        })
        .filter(Boolean),
      folderPreferences: folderPreferences
        .filter(function (item) {
          return item && typeof item === "object";
        })
        .map(function (item) {
          var mode = item.mode === "always_open" || item.mode === "always_collapsed" ? item.mode : "default";
          return {
            name: String(item.name || "").trim(),
            mode: mode
          };
        })
        .filter(function (item) {
          return item.name.length > 0;
        }),
      customVariables: customVariables
        .filter(function (item) {
          return item && typeof item === "object";
        })
        .map(function (item, index) {
          return {
            id: String(item.id || "var-" + index),
            name: String(item.name || "").trim(),
            value: String(item.value || "")
          };
        })
        .filter(function (item) {
          return item.name.length > 0;
        }),
      templates: list
        .filter(function (item) {
          return item && typeof item === "object";
        })
        .map(function (item, index) {
          return {
            id: String(item.id || "tpl-" + index),
            name: String(item.name || "No Name"),
            // v3.1.1: чистим мусор ("Привет!", "hi there", "HI" -> "hi").
            // Пусто оставляем пустым = шаблон без тега, только через //.
            tag: sanitizeTag(item.tag),
            folder: String(item.folder || "Общие"),
            domains: Array.isArray(item.domains)
              ? item.domains
                  .map(function (domain) {
                    return String(domain || "").trim().toLowerCase();
                  })
                  .filter(Boolean)
              : [],
            body: String(item.body || ""),
            previewBeforeInsert: item.previewBeforeInsert === true,
            images: Array.isArray(item.images)
              ? item.images
                  .map(function (url) {
                    return String(url || "").trim();
                  })
                  .filter(Boolean)
              : []
          };
        })
    };
  }

  function cleanupLegacyLocalStorage() {
    // v0.1: одноразовая чистка старого зеркала конфига в localStorage сайта
    // (v<=3.11 писало туда копию на каждом домене). Делаем только когда sync GM
    // доступен — иначе localStorage единственное хранилище.
    if (legacyLocalCleaned || !gmSyncAvailable()) {
      return;
    }
    legacyLocalCleaned = true;
    try {
      window.localStorage.removeItem(LEGACY_STORE_KEY);
    } catch (error) {
      /* ignore */
    }
  }

  function migrateLegacyStorage() {
    // v0.1: переименование TextEnter -> TextEnter. Переносим конфиг и бэкапы из старых
    // ключей textenter_* в новые textenter_*. Старые ключи НЕ удаляем — чтобы откат
    // на предыдущую версию скрипта не потерял данные.
    if (legacyKeysMigrated || !gmSyncAvailable()) {
      return;
    }
    legacyKeysMigrated = true;
    try {
      if (!GM_getValue(STORE_KEY, "")) {
        var oldConfig = GM_getValue(LEGACY_STORE_KEY, "");
        if (oldConfig) {
          GM_setValue(STORE_KEY, oldConfig);
          debugLog("migrateLegacyStorage: config migrated from", LEGACY_STORE_KEY);
        }
      }
      if (!GM_getValue(BACKUP_INDEX_KEY, "")) {
        var oldIndexRaw = GM_getValue(LEGACY_BACKUP_INDEX_KEY, "");
        if (oldIndexRaw && oldIndexRaw !== "[]") {
          var stamps = JSON.parse(oldIndexRaw);
          if (Array.isArray(stamps)) {
            stamps.forEach(function (stamp) {
              var entry = GM_getValue(LEGACY_BACKUP_KEY_PREFIX + stamp, "");
              if (entry) {
                GM_setValue(BACKUP_KEY_PREFIX + stamp, entry);
              }
            });
            GM_setValue(BACKUP_INDEX_KEY, oldIndexRaw);
            debugLog("migrateLegacyStorage:", stamps.length, "backups migrated");
          }
        }
      }
    } catch (error) {
      debugLog("migrateLegacyStorage: failed", error);
    }
  }

  function loadConfig() {
    migrateLegacyStorage();
    var raw = "";
    try {
      if (typeof GM_getValue === "function") {
        raw = GM_getValue(STORE_KEY, "");
      }
    } catch (error) {
      debugLog("loadConfig: GM_getValue failed", error);
    }
    if (!raw) {
      // Миграция со старой версии: забираем копию из localStorage (если была)
      // в GM-хранилище и удаляем её оттуда.
      var legacy = "";
      try {
        legacy = window.localStorage.getItem(LEGACY_STORE_KEY);
      } catch (error) {
        /* ignore */
      }
      if (legacy) {
        raw = legacy;
        if (gmSyncAvailable()) {
          try {
            GM_setValue(STORE_KEY, legacy);
            window.localStorage.removeItem(LEGACY_STORE_KEY);
          } catch (error) {
            debugLog("loadConfig: legacy migration failed", error);
          }
        }
      }
    }
    cleanupLegacyLocalStorage();
    if (raw) {
      try {
        return normalize(JSON.parse(raw));
      } catch (error) {
        debugLog("loadConfig: config parse failed", error);
      }
    }
    var fallback = normalize(DEFAULT_CONFIG);
    safeSet(STORE_KEY, JSON.stringify(fallback));
    return fallback;
  }

  function saveConfig() {
    configDirty = true; // v3.12.0: блокируем hydrateConfigAsync, чтобы не перезаписал
    safeSet(STORE_KEY, JSON.stringify(config));
  }

  // ---------- бэкапы конфига (общие для меню-импорта и страницы настроек) ----------

  function readBackupIndex() {
    try {
      var raw = safeGet(BACKUP_INDEX_KEY, "[]");
      var arr = JSON.parse(raw || "[]");
      return Array.isArray(arr) ? arr : [];
    } catch (error) {
      debugLog("readBackupIndex: failed", error);
      return [];
    }
  }

  function writeBackupIndex(arr) {
    safeSet(BACKUP_INDEX_KEY, JSON.stringify(arr));
  }

  function backupCurrentConfig() {
    // Кладем в историю ТЕКУЩИЙ сохраненный конфиг (до перезаписи).
    try {
      var stamp = new Date().toISOString().replace(/[:.]/g, "-");
      safeSet(BACKUP_KEY_PREFIX + stamp, JSON.stringify(config));
      var idx = readBackupIndex();
      idx.unshift(stamp);
      while (idx.length > MAX_BACKUPS) {
        var old = idx.pop();
        try {
          safeSet(BACKUP_KEY_PREFIX + old, "");
        } catch (e) { /* ignore */ }
      }
      writeBackupIndex(idx);
    } catch (error) {
      debugLog("backupCurrentConfig: failed", error);
    }
  }

  function listBackups() {
    return readBackupIndex();
  }

  function isSettingsMode() {
    var params = new URLSearchParams(window.location.search);
    return params.has(SETTINGS_PARAM);
  }

  function openSettingsPage() {
    var url = new URL(window.location.href);
    url.searchParams.set(SETTINGS_PARAM, "1");
    var finalUrl = url.toString();
    if (typeof GM_openInTab === "function") {
      GM_openInTab(finalUrl, { active: true, insert: true, setParent: true });
      return;
    }
    window.open(finalUrl, "_blank");
  }

  function registerCommands() {
    try {
      if (typeof GM_registerMenuCommand === "function") {
        GM_registerMenuCommand("TextEnter: Настройки расширения", openSettingsPage);
        GM_registerMenuCommand("TextEnter: Импорт JSON", importConfigPrompt);
        GM_registerMenuCommand("TextEnter: Экспорт JSON", exportConfigPrompt);
      }
    } catch (error) {
      /* ignore */
    }
  }

  function hostMatchesTemplate(template) {
    var host = String(window.location.hostname || "").toLowerCase();
    var own = Array.isArray(template.domains) ? template.domains : [];
    // v3.10.0: свои домены первичны; без них наследуем правило папки.
    // v3.11.0: правило папки = режим all/only/except.
    if (own.length) {
      return own.some(function (domainRaw) {
        var domain = String(domainRaw || "").trim().toLowerCase();
        if (!domain) {
          return false;
        }
        return host === domain || host.endsWith("." + domain);
      });
    }
    return folderDomainMatches(template.folder || "Общие", host, config);
  }

  function getFolderMode(folderName, sourceConfig) {
    var list = (sourceConfig || config).folderPreferences || [];
    for (var i = 0; i < list.length; i += 1) {
      if (list[i].name === folderName) {
        return list[i].mode;
      }
    }
    return "default";
  }

  // v3.11.0: иконка папки для дерева и // меню.
  function folderIcon(folderName, sourceConfig) {
    var cfg = sourceConfig || config;
    var map = (cfg && cfg.folderIcons && typeof cfg.folderIcons === "object") ? cfg.folderIcons : {};
    var icon = map[folderName];
    return icon ? String(icon) : "";
  }

  function folderDisplayName(folderName, sourceConfig) {
    var icon = folderIcon(folderName, sourceConfig);
    return (icon ? icon + " " : "") + String(folderName || "");
  }

  // v3.11.0: режим доменов папки: all (везде), only (только эти), except (все кроме этих).
  function getFolderDomainMode(folderName, sourceConfig) {
    var cfg = sourceConfig || config;
    var map = (cfg && cfg.folderDomainModes && typeof cfg.folderDomainModes === "object") ? cfg.folderDomainModes : {};
    var mode = map[folderName];
    if (mode === "only" || mode === "except" || mode === "all") {
      return mode;
    }
    var domains = (cfg && cfg.folderDomains && typeof cfg.folderDomains === "object") ? cfg.folderDomains[folderName] : null;
    return (domains && domains.length) ? "only" : "all";
  }

  function folderDomainMatches(folderName, host, sourceConfig) {
    var cfg = sourceConfig || config;
    var mode = getFolderDomainMode(folderName, cfg);
    if (mode === "all") {
      return true;
    }
    var list = (cfg && cfg.folderDomains && typeof cfg.folderDomains === "object") ? cfg.folderDomains[folderName] : null;
    var domains = Array.isArray(list) ? list : [];
    if (!domains.length) {
      return true;
    }
    var h = String(host || "").toLowerCase();
    var hit = domains.some(function (domainRaw) {
      var domain = String(domainRaw || "").trim().toLowerCase();
      if (!domain) {
        return false;
      }
      return h === domain || h.endsWith("." + domain);
    });
    return mode === "only" ? hit : !hit;
  }

  function exportConfigPrompt() {
    // v3.1.0: prompt обрезает большой JSON -> clipboard + скачивание файла.
    var text = JSON.stringify(config, null, 2);
    copyTextToClipboard(text, "Скопируйте JSON-конфиг TextEnter");
    downloadJsonFile("textenter-config.json", text);
    window.alert("Конфиг скопирован в буфер обмена и скачан как файл textenter-config.json");
  }

  function importConfigPrompt() {
    // v3.12.0: вместо window.prompt (обрезал большой JSON) — выбор файла.
    // Перед заменой текущий конфиг уходит в историю бэкапов.
    var input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.style.display = "none";
    var cleanup = function () {
      if (input.parentNode) {
        input.parentNode.removeChild(input);
      }
    };
    input.addEventListener("cancel", cleanup);
    input.addEventListener("change", function () {
      cleanup();
      var file = input.files && input.files[0];
      if (!file) {
        return;
      }
      try {
        var reader = new FileReader();
        reader.onload = function () {
          try {
            var parsed = normalize(JSON.parse(String(reader.result || "")));
            backupCurrentConfig();
            config = parsed;
            saveConfig();
            window.alert("Конфигурация обновлена. Предыдущая версия сохранена в бэкапах.");
          } catch (error) {
            window.alert("Неверный JSON: " + error);
          }
        };
        reader.onerror = function () {
          window.alert("Не удалось прочитать файл: " + file.name);
        };
        reader.readAsText(file);
      } catch (error) {
        window.alert("Не удалось прочитать файл: " + error);
      }
    });
    document.documentElement.appendChild(input);
    input.click();
  }

  function handleGlobalHotkeys(event) {
    // v3.1.0: Ctrl/Cmd+Shift+K = открыть/сфокусировать меню, Ctrl/Cmd+Shift+L = настройки.
    try {
      var mod = event.ctrlKey || event.metaKey;
      if (!mod || !event.shiftKey) {
        return;
      }
      var key = String(event.key || "").toLowerCase();
      if (key === "k" || key === "л") {
        var field = event.target;
        if (!isField(field)) {
          field = document.activeElement && isField(document.activeElement) ? document.activeElement : null;
        }
        if (field) {
          event.preventDefault();
          event.stopPropagation();
          openFolderMenu(field, "", caretPosition(field), "");
        }
      } else if (key === "l" || key === "д") {
        event.preventDefault();
        event.stopPropagation();
        openSettingsPage();
      }
    } catch (error) {
      /* ignore */
    }
  }

  function isField(node) {
    return Boolean(node && node.matches && node.matches(FIELD_SELECTOR));
  }

  function isInput(node) {
    return Boolean(node && (node.tagName === "TEXTAREA" || node.tagName === "INPUT"));
  }

  function readValue(field) {
    if (isInput(field)) {
      return field.value || "";
    }
    return field ? field.innerText || "" : "";
  }

  function caretPosition(field) {
    if (isInput(field)) {
      return typeof field.selectionStart === "number" ? field.selectionStart : readValue(field).length;
    }
    var selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return readValue(field).length;
    }
    var range = selection.getRangeAt(0).cloneRange();
    range.selectNodeContents(field);
    range.setEnd(selection.getRangeAt(0).endContainer, selection.getRangeAt(0).endOffset);
    return range.toString().length;
  }

  function textBeforeCaret(field) {
    if (isInput(field)) {
      return readValue(field).slice(0, caretPosition(field));
    }
    var selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return "";
    }
    var range = selection.getRangeAt(0).cloneRange();
    range.selectNodeContents(field);
    range.setEnd(selection.getRangeAt(0).endContainer, selection.getRangeAt(0).endOffset);
    return range.toString();
  }

  function setNativeValue(field, value) {
    var proto = field.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    var descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor && descriptor.set) {
      descriptor.set.call(field, value);
    } else {
      field.value = value;
    }
  }

  function dispatchInput(field, data) {
    var event;
    try {
      event = new InputEvent("input", { bubbles: true, cancelable: false, data: data || null, inputType: "insertText" });
    } catch (error) {
      event = new Event("input", { bubbles: true });
    }
    field.dispatchEvent(event);
  }

  function insertText(field, text) {
    if (!text) {
      return;
    }
    if (isInput(field)) {
      var start = caretPosition(field);
      var value = readValue(field);
      setNativeValue(field, value.slice(0, start) + text + value.slice(start));
      var next = start + text.length;
      field.setSelectionRange(next, next);
      dispatchInput(field, text);
      return;
    }
    field.focus();
    var ok = false;
    try {
      ok = document.execCommand("insertText", false, text);
    } catch (error) {
      ok = false;
    }
    if (!ok) {
      var selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        var range = selection.getRangeAt(0);
        range.deleteContents();
        var node = document.createTextNode(text);
        range.insertNode(node);
        range.setStartAfter(node);
        range.setEndAfter(node);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      dispatchInput(field, text);
    }
  }

  function deleteBackward(field, count) {
    if (!count || count <= 0) {
      return;
    }
    if (isInput(field)) {
      var start = caretPosition(field);
      var value = readValue(field);
      var from = Math.max(0, start - count);
      setNativeValue(field, value.slice(0, from) + value.slice(start));
      field.setSelectionRange(from, from);
      dispatchInput(field, null);
      return;
    }
    for (var i = 0; i < count; i += 1) {
      document.execCommand("delete", false, null);
    }
  }

  function typeText(field, text, done) {
    var delay = Math.max(0, Number(config.typingDelay) || 0);
    if (delay === 0) {
      insertText(field, text);
      if (done) {
        done();
      }
      return;
    }
    var index = 0;
    function step() {
      if (index >= text.length) {
        if (done) {
          done();
        }
        return;
      }
      insertText(field, text.charAt(index));
      index += 1;
      window.setTimeout(step, delay);
    }
    step();
  }

  function pad(value) {
    return value < 10 ? "0" + value : String(value);
  }

  function formatDateValue(raw) {
    var date = new Date(raw);
    if (isNaN(date.getTime())) {
      return String(raw || "");
    }
    return pad(date.getDate()) + "." + pad(date.getMonth() + 1) + "." + date.getFullYear();
  }

  function todayIso() {
    var now = new Date();
    return now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());
  }

  function parseShiftToken(token, baseName) {
    var match = String(token || "").trim().match(new RegExp("^" + baseName + "(?:\\s*([+-]\\d+))?$", "i"));
    if (!match) {
      return null;
    }
    return {
      shift: match[1] ? Number(match[1]) : 0
    };
  }

  // v3.1.3: индексированные даты/времена для НЕЗАВИСИМЫХ значений в одном шаблоне.
  // {{date}} / {{date+7}} / {{date1}} / {{date1+7}} = база №1
  // {{date2}} / {{date2+7}} = база №2, {{date3}} = база №3 ... (до 9).
  // Аналогично {{time}}, {{time2}}... {{datetoday}}/{{timetoday}} всегда фиксированные.
  // v3.1.4: опциональная подпись-лейбл: {{date("Дата начала договора")}}, {{date+7("Дата начала")}},
  // {{time("Время встречи")}}, {{date2("Выезд")}}. Лейбл = отдельная независимая база с этим именем.
  function parseLabelSuffix(rest) {
    var s = String(rest || "").trim();
    if (!s) {
      return { label: "", consumed: true };
    }
    var m = s.match(/^\(\s*(?:"([^"]+)"|'([^']+)'|([^()"']+?))\s*\)\s*$/);
    if (!m) {
      return null;
    }
    return { label: String(m[1] != null ? m[1] : (m[2] != null ? m[2] : m[3])).trim(), consumed: true };
  }

  function parseIndexedDateToken(token) {
    var s = String(token || "").trim();
    var m = s.match(/^date([1-9])?\s*([+-]\d+)?\s*(\(.*\))?\s*$/i);
    if (!m) {
      return null;
    }
    var label = "";
    if (m[3]) {
      var parsed = parseLabelSuffix(m[3]);
      if (!parsed) {
        return null;
      }
      label = parsed.label;
    }
    return { index: m[1] ? Number(m[1]) : 1, shift: m[2] ? Number(m[2]) : 0, label: label };
  }

  function parseIndexedTimeToken(token) {
    var s = String(token || "").trim();
    var m = s.match(/^time([1-9])?\s*([+-]\d+)?\s*(\(.*\))?\s*$/i);
    if (!m) {
      return null;
    }
    // Не путать с timetoday: "timetoday" начинается с "time", но дальше идет "today".
    if (/^timetoday/i.test(s)) {
      return null;
    }
    var label = "";
    if (m[3]) {
      var parsed = parseLabelSuffix(m[3]);
      if (!parsed) {
        return null;
      }
      label = parsed.label;
    }
    return { index: m[1] ? Number(m[1]) : 1, shift: m[2] ? Number(m[2]) : 0, label: label };
  }

  // v3.10.0: глобальный свободный ввод {{text}} / {{text2}} / {{text("Подпись")}}.
  // При вставке — поле для ввода с клавиатуры (обязательное). Вне вставки — пусто.
  function parseTextToken(token) {
    var s = String(token || "").trim();
    var m = s.match(/^text([1-9])?\s*(\(.*\))?\s*$/i);
    if (!m) {
      return null;
    }
    var label = "";
    if (m[2]) {
      var parsed = parseLabelSuffix(m[2]);
      if (!parsed) {
        return null;
      }
      label = parsed.label;
    }
    return { index: m[1] ? Number(m[1]) : 1, label: label, base: "text" + (m[1] || "") };
  }

  function parseLabeledTodayToken(token) {
    // {{datetoday("...")}} / {{datetoday+3}} / {{timetoday("...")}} — фиксированные, лейбл только для показа.
    var s = String(token || "").trim();
    var m = s.match(/^(datetoday|timetoday)\s*([+-]\d+)?\s*(\(.*\))?\s*$/i);
    if (!m) {
      return null;
    }
    var label = "";
    if (m[3]) {
      var parsed = parseLabelSuffix(m[3]);
      if (!parsed) {
        return null;
      }
      label = parsed.label;
    }
    return { kind: m[1].toLowerCase(), shift: m[2] ? Number(m[2]) : 0, label: label };
  }

  function parseLabeledCustomToken(token) {
    // {{myvar("Подсказка для ввода")}} — имя кастомной переменной + подпись для поля ввода.
    var s = String(token || "").trim();
    var m = s.match(/^([a-zA-Z_а-яА-ЯёЁ][a-zA-Z0-9_а-яА-ЯёЁ]*)\s*(\(.*\))?\s*$/);
    if (!m) {
      return null;
    }
    var name = m[1];
    var lowered = name.toLowerCase();
    // Зарезервированные семейства обрабатываются отдельно.
    if (lowered === "date" || lowered === "time" || lowered === "datetoday" || lowered === "timetoday" ||
        /^date[1-9]$/i.test(name) || /^time[1-9]$/i.test(name)) {
      return null;
    }
    var label = "";
    if (m[2]) {
      var parsed = parseLabelSuffix(m[2]);
      if (!parsed) {
        return null;
      }
      label = parsed.label;
    }
    return { name: name, label: label };
  }

  function dateBaseKey(parsed) {
    if (parsed.label) {
      return "label:" + parsed.label.trim().toLowerCase();
    }
    return "index:" + parsed.index;
  }

  function timeBaseKey(parsed) {
    if (parsed.label) {
      return "label:" + parsed.label.trim().toLowerCase();
    }
    return "index:" + parsed.index;
  }

  function dateBaseTitle(parsed) {
    if (parsed.label) {
      return parsed.label + (parsed.shift ? " (" + (parsed.shift > 0 ? "+" : "") + parsed.shift + " дн.)" : "");
    }
    if (parsed.index > 1) {
      return "Дата " + parsed.index;
    }
    return "Дата 1";
  }

  function timeBaseTitle(parsed) {
    if (parsed.label) {
      return parsed.label + (parsed.shift ? " (" + (parsed.shift > 0 ? "+" : "") + parsed.shift + " ч.)" : "");
    }
    if (parsed.index > 1) {
      return "Время " + parsed.index;
    }
    return "Время 1";
  }

  function collectDateBases(template) {
    var text = String((template && template.body) || "");
    var re = /\{\{\s*([^{}]+?)\s*\}\}/g;
    var map = {};
    var out = [];
    var m;
    while ((m = re.exec(text))) {
      var p = parseIndexedDateToken(m[1]);
      if (!p) {
        continue;
      }
      var key = dateBaseKey(p);
      if (!map[key]) {
        map[key] = true;
        out.push({ key: key, index: p.index, label: p.label || "" });
      }
    }
    return out;
  }

  function collectTimeBases(template) {
    var text = String((template && template.body) || "");
    var re = /\{\{\s*([^{}]+?)\s*\}\}/g;
    var map = {};
    var out = [];
    var m;
    while ((m = re.exec(text))) {
      var p = parseIndexedTimeToken(m[1]);
      if (!p) {
        continue;
      }
      var key = timeBaseKey(p);
      if (!map[key]) {
        map[key] = true;
        out.push({ key: key, index: p.index, label: p.label || "" });
      }
    }
    return out;
  }

  function collectDateIndices(template) {
    var text = String((template && template.body) || "");
    var re = /\{\{\s*([^{}]+?)\s*\}\}/g;
    var found = {};
    var out = [];
    var m;
    while ((m = re.exec(text))) {
      var p = parseIndexedDateToken(m[1]);
      if (p && !found[p.index]) {
        found[p.index] = true;
        out.push(p.index);
      }
    }
    return out.sort();
  }

  function collectTimeIndices(template) {
    var text = String((template && template.body) || "");
    var re = /\{\{\s*([^{}]+?)\s*\}\}/g;
    var found = {};
    var out = [];
    var m;
    while ((m = re.exec(text))) {
      var p = parseIndexedTimeToken(m[1]);
      if (p && !found[p.index]) {
        found[p.index] = true;
        out.push(p.index);
      }
    }
    return out.sort();
  }

  function shiftIsoDate(baseIso, days) {
    var base = new Date(baseIso + "T00:00:00");
    if (isNaN(base.getTime())) {
      base = new Date(todayIso() + "T00:00:00");
    }
    base.setDate(base.getDate() + days);
    return base.getFullYear() + "-" + pad(base.getMonth() + 1) + "-" + pad(base.getDate());
  }

  function currentTimeValue() {
    var now = new Date();
    return pad(now.getHours()) + ":" + pad(now.getMinutes());
  }

  function shiftClock(baseTime, hours) {
    var parsed = String(baseTime || "").trim().match(/^(\d{1,2}):(\d{2})$/);
    var h = 0;
    var m = 0;
    if (parsed) {
      h = Number(parsed[1]);
      m = Number(parsed[2]);
      if (h < 0 || h > 23 || m < 0 || m > 59) {
        h = 0;
        m = 0;
      }
    } else {
      var now = new Date();
      h = now.getHours();
      m = now.getMinutes();
    }
    var total = h * 60 + m + hours * 60;
    total = ((total % 1440) + 1440) % 1440;
    var outH = Math.floor(total / 60);
    var outM = total % 60;
    return pad(outH) + ":" + pad(outM);
  }

  function pickRandom(list) {
    if (!list || list.length === 0) {
      return "";
    }
    return list[Math.floor(Math.random() * list.length)];
  }

  function resolveCustomVariable(name, memory, overrides, depth) {
    var currentDepth = depth || 0;
    if (currentDepth > 5) {
      return "[var-loop]";
    }
    if (Object.prototype.hasOwnProperty.call(memory, name)) {
      return memory[name];
    }
    if (overrides && Object.prototype.hasOwnProperty.call(overrides, name)) {
      memory[name] = overrides[name];
      return overrides[name];
    }
    for (var i = 0; i < config.customVariables.length; i += 1) {
      var item = config.customVariables[i];
      if (item.name === name) {
        memory[name] = "[var-loop]";
        var result = resolveTokens(String(item.value || ""), overrides, currentDepth + 1);
        memory[name] = result;
        return result;
      }
    }
    return null;
  }

  function resolveFunctionExpression(expr) {
    var source = String(expr || "").trim();
    var splitIndex = source.indexOf(":");
    if (splitIndex <= 0) {
      return null;
    }
    var fn = source.slice(0, splitIndex).trim().toLowerCase();
    var arg = source.slice(splitIndex + 1).trim();

    if (fn === "date") {
      if (!arg) {
        return formatDateValue(todayIso());
      }
      return formatDateValue(arg);
    }
    if (fn === "pick") {
      return pickRandom(
        arg
          .split("|")
          .map(function (item) {
            return item.trim();
          })
          .filter(Boolean)
      );
    }
    if (fn === "upper") {
      return arg.toUpperCase();
    }
    if (fn === "lower") {
      return arg.toLowerCase();
    }
    if (fn === "calc" || fn === "math") {
      return evaluateMathExpression(arg);
    }
    return null;
  }

  function numericValueOfVariable(name) {
    for (var i = 0; i < config.customVariables.length; i += 1) {
      if (config.customVariables[i].name === name) {
        var parsed = Number(String(config.customVariables[i].value || "").replace(/,/g, "."));
        return isNaN(parsed) ? 0 : parsed;
      }
    }
    return null;
  }

  // Safe recursive-descent math parser: + - * / % ( ) and numbers only.
  function evaluateMathExpression(source) {
    var input = String(source || "").trim().replace(/,/g, ".");
    if (!input) {
      return "";
    }

    var pos = 0;

    function skipSpaces() {
      while (pos < input.length && input.charAt(pos) === " ") {
        pos += 1;
      }
    }

    function parseExpression() {
      var value = parseTerm();
      while (true) {
        skipSpaces();
        var char = input.charAt(pos);
        if (char === "+") {
          pos += 1;
          value += parseTerm();
        } else if (char === "-") {
          pos += 1;
          value -= parseTerm();
        } else {
          return value;
        }
      }
    }

    function parseTerm() {
      var value = parseFactor();
      while (true) {
        skipSpaces();
        var char = input.charAt(pos);
        if (char === "*") {
          pos += 1;
          value *= parseFactor();
        } else if (char === "/") {
          pos += 1;
          var divisor = parseFactor();
          if (divisor === 0) {
            throw new Error("division by zero");
          }
          value /= divisor;
        } else if (char === "%") {
          pos += 1;
          var modulo = parseFactor();
          if (modulo === 0) {
            throw new Error("modulo by zero");
          }
          value %= modulo;
        } else {
          return value;
        }
      }
    }

    function parseFactor() {
      skipSpaces();
      var char = input.charAt(pos);

      if (char === "+") {
        pos += 1;
        return parseFactor();
      }
      if (char === "-") {
        pos += 1;
        return -parseFactor();
      }
      if (char === "(") {
        pos += 1;
        var inner = parseExpression();
        skipSpaces();
        if (input.charAt(pos) !== ")") {
          throw new Error("missing closing bracket");
        }
        pos += 1;
        return inner;
      }

      var numberMatch = /^\d+(\.\d+)?/.exec(input.slice(pos));
      if (numberMatch) {
        pos += numberMatch[0].length;
        return Number(numberMatch[0]);
      }

      var nameMatch = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(input.slice(pos));
      if (nameMatch) {
        pos += nameMatch[0].length;
        var resolved = numericValueOfVariable(nameMatch[0]);
        if (resolved === null) {
          throw new Error("unknown variable: " + nameMatch[0]);
        }
        return resolved;
      }

      throw new Error("unexpected character: " + char);
    }

    try {
      var result = parseExpression();
      skipSpaces();
      if (pos !== input.length) {
        return "[math-error]";
      }
      if (typeof result !== "number" || !isFinite(result)) {
        return "[math-error]";
      }
      return String(Math.round(result * 1000000) / 1000000);
    } catch (error) {
      return "[math-error]";
    }
  }

  function randomizeTemplateText(raw) {
    return String(raw || "").replace(/\[\[([\s\S]*?)\]\]/g, function (_full, group) {
      return pickRandom(
        String(group)
          .split("|")
          .map(function (item) {
            return item.trim();
          })
          .filter(Boolean)
      );
    });
  }

  // v3.5.0: люди. Активный профиль — из настроек, разовый выбор при вставке — через overrides.__profile.
  function getActiveProfile() {
    var list = (config && Array.isArray(config.profiles) && config.profiles.length) ? config.profiles : null;
    if (list) {
      for (var i = 0; i < list.length; i += 1) {
        if (list[i].id === config.activeProfileId) {
          return list[i];
        }
      }
      return list[0];
    }
    return (config && config.profile) || { name: "", surname: "", email: "", phone: "", company: "", position: "" };
  }

  function profileDisplayName(p) {
    var full = ((p && p.name ? p.name : "") + " " + (p && p.surname ? p.surname : "")).trim();
    if (full) {
      return full + (p && p.company ? " — " + p.company : "");
    }
    return (p && p.company) || "Без имени";
  }

  function templateUsesProfileVars(template) {
    return /\{\{\s*(name|surname|fullname|company|email|phone|position)\s*\}\}/i.test(String((template && template.body) || ""));
  }

  function resolveTokens(text, overrides, depth) {
    var sourceText = String(text || "");
    var now = new Date();
    var currentDepth = depth || 0;
    var selectedDateIso = overrides && overrides.__date_base_iso ? overrides.__date_base_iso : todayIso();
    var selectedTime = overrides && overrides.__time_base ? overrides.__time_base : currentTimeValue();
    var dateBasesMap = overrides && overrides.__dateBases ? overrides.__dateBases : null;
    var timeBasesMap = overrides && overrides.__timeBases ? overrides.__timeBases : null;
    function baseDateIsoForParsed(parsed) {
      if (parsed.label && dateBasesMap && dateBasesMap[dateBaseKey(parsed)] != null) {
        return dateBasesMap[dateBaseKey(parsed)];
      }
      if (!parsed.label && dateBasesMap && dateBasesMap["index:" + parsed.index] != null) {
        return dateBasesMap["index:" + parsed.index];
      }
      if (!parsed.label && parsed.index === 1) {
        return selectedDateIso;
      }
      if (!parsed.label) {
        var legacyKey = "__date_base_iso" + parsed.index;
        if (overrides && overrides[legacyKey]) {
          return overrides[legacyKey];
        }
      }
      return todayIso();
    }
    function baseTimeForParsed(parsed) {
      if (parsed.label && timeBasesMap && timeBasesMap[timeBaseKey(parsed)] != null) {
        return timeBasesMap[timeBaseKey(parsed)];
      }
      if (!parsed.label && timeBasesMap && timeBasesMap["index:" + parsed.index] != null) {
        return timeBasesMap["index:" + parsed.index];
      }
      if (!parsed.label && parsed.index === 1) {
        return selectedTime;
      }
      if (!parsed.label) {
        var legacyKey = "__time_base" + parsed.index;
        if (overrides && overrides[legacyKey]) {
          return overrides[legacyKey];
        }
      }
      return currentTimeValue();
    }
    // v3.5.0: несколько людей. Активный — из настроек, разовый выбор при вставке — через overrides.__profile.
    var builtInProf = (overrides && overrides.__profile) ? overrides.__profile : getActiveProfile();
    var builtIn = {
      name: builtInProf.name || "",
      surname: builtInProf.surname || "",
      fullname: ((builtInProf.name || "") + " " + (builtInProf.surname || "")).trim(),
      email: builtInProf.email || "",
      phone: builtInProf.phone || "",
      company: builtInProf.company || "",
      position: builtInProf.position || "",
      timetoday: pad(now.getHours()) + ":" + pad(now.getMinutes()),
      datetoday: pad(now.getDate()) + "." + pad(now.getMonth() + 1) + "." + now.getFullYear()
    };

    var memory = {};
    return sourceText.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, function (full, token) {
      if (overrides && Object.prototype.hasOwnProperty.call(overrides, token)) {
        return overrides[token];
      }
      var indexedDate = parseIndexedDateToken(token);
      if (indexedDate) {
        return formatDateValue(shiftIsoDate(baseDateIsoForParsed(indexedDate), indexedDate.shift));
      }
      var labeledToday = parseLabeledTodayToken(token);
      if (labeledToday) {
        if (labeledToday.kind === "datetoday") {
          return formatDateValue(shiftIsoDate(todayIso(), labeledToday.shift));
        }
        return shiftClock(currentTimeValue(), labeledToday.shift);
      }
      var indexedTime = parseIndexedTimeToken(token);
      if (indexedTime) {
        return shiftClock(baseTimeForParsed(indexedTime), indexedTime.shift);
      }
      // v3.8.0: выбор значения при вставке {{поле:#}}.
      // Выбранное уже вернулось выше через точное совпадение в overrides.
      // Здесь — превью/дефолт. v3.9.0: группы {{поле:#группа}} — значение из выбранной записи.
      var choiceTok = parseChoiceToken(token);
      if (choiceTok) {
        if (choiceTok.group) {
          var gsel = overrides && overrides.__groupSels ? overrides.__groupSels[choiceTok.group] : null;
          var ghit = gsel ? lookupGroupRecord(gsel, config) : null;
          if (!ghit) {
            var cands = collectGroupCandidates(config);
            ghit = cands.length ? lookupGroupRecord(cands[0], config) : null;
          }
          if (ghit) {
            var gval = getAnyRecordFieldValue(ghit, choiceTok.field);
            if (String(gval).indexOf("{{") !== -1 && currentDepth < 5) {
              return resolveTokens(String(gval), overrides, currentDepth + 1);
            }
            return String(gval);
          }
          return "";
        }
        var choiceOpts = collectChoiceOptions(choiceTok.field, config);
        if (choiceOpts.length) {
          return choiceOpts[0];
        }
        return "";
      }
      // v3.6.0: адресное поле человека {{поле:тег}}; v3.7.0: обобщено — люди первичны, затем справочники.
      var profTok = parseProfileTagToken(token);
      if (profTok && isAddressableField(profTok.field, config)) {
        var hit = findAnyRecord(profTok.tag, config);
        if (hit) {
          var pval = getAnyRecordFieldValue(hit, profTok.field);
          if (String(pval).indexOf("{{") !== -1 && currentDepth < 5) {
            return resolveTokens(String(pval), overrides, currentDepth + 1);
          }
          return String(pval);
        }
        return full;
      }
      var functionValue = resolveFunctionExpression(token);
      if (functionValue !== null) {
        return functionValue;
      }
      if (Object.prototype.hasOwnProperty.call(builtIn, token)) {
        return builtIn[token];
      }
      // v3.1.4: кастомная переменная с подписью {{myvar("Подсказка")}} — значение по имени.
      var labeledCustom = parseLabeledCustomToken(token);
      if (labeledCustom && findCustomVariable(labeledCustom.name)) {
        var labeledVal = resolveCustomVariable(labeledCustom.name, memory, overrides, currentDepth);
        if (labeledVal !== null) {
          return labeledVal;
        }
      }
      var custom = resolveCustomVariable(token, memory, overrides, currentDepth);
      if (custom !== null) {
        return custom;
      }
      // v3.10.0: глобальный {{text}} без своей переменной — вне вставки пусто
      // (при вставке значение приходит через overrides из поля ввода).
      if (parseTextToken(token)) {
        return "";
      }
      // v3.6.0 fallback: свое поле без тега {{telegram}}.
      // v3.9.0: владелец поля определяет категорию: люди → активный человек
      // (или выбранный при вставке), поле справочника → его активная запись.
      // Обычная переменная шаблона — в приоритете (выше).
      if (token.indexOf(":") === -1 && token.indexOf("(") === -1) {
        var owner = getFieldOwnerCategory(token, config);
        if (owner) {
          var arec = getCategoryActiveRecord(owner, config, overrides);
          if (arec) {
            var aval = getCategoryFieldValue(owner, arec, token);
            if (String(aval).indexOf("{{") !== -1 && currentDepth < 5) {
              return resolveTokens(String(aval), overrides, currentDepth + 1);
            }
            return String(aval == null ? "" : aval);
          }
          return "";
        }
      }
      return full;
    });
  }

  function findCustomVariable(name) {
    for (var i = 0; i < config.customVariables.length; i += 1) {
      if (config.customVariables[i].name === name) {
        return config.customVariables[i];
      }
    }
    return null;
  }

  function templateUsesDateToken(template) {
    return /\{\{\s*date[1-9]?\s*([+-]\d+)?(\s*\(.*?\))?\s*\}\}/i.test(String((template && template.body) || ""));
  }

  function templateUsesTimeToken(template) {
    return /\{\{\s*time[1-9]?\s*([+-]\d+)?(\s*\(.*?\))?\s*\}\}/i.test(String((template && template.body) || ""));
  }

  function getEditableVariables(template) {
    // v3.1.2: одна база; v3.1.3: + date2/time2; v3.1.4: + подписи {{"..."}} — каждая подпись = своя база.
    // {{datetoday}}/{{timetoday}} всегда фиксированные, не редактируются.
    var text = String((template && template.body) || "");
    var regex = /\{\{\s*([^{}]+?)\s*\}\}/g;
    var found = {};
    var list = [];
    var match;
    collectDateBases(template).forEach(function (base) {
      list.push({
        id: "__base_date_" + base.key.replace(/[^a-z0-9]+/gi, "_"),
        name: "__base_date_" + base.key.replace(/[^a-z0-9]+/gi, "_"),
        type: "base_date",
        baseKey: base.key,
        baseLabel: base.label || "",
        dateIndex: base.index,
        value: todayIso()
      });
    });
    collectTimeBases(template).forEach(function (base) {
      list.push({
        id: "__base_time_" + base.key.replace(/[^a-z0-9]+/gi, "_"),
        name: "__base_time_" + base.key.replace(/[^a-z0-9]+/gi, "_"),
        type: "base_time",
        baseKey: base.key,
        baseLabel: base.label || "",
        timeIndex: base.index,
        value: currentTimeValue()
      });
    });
    while ((match = regex.exec(text))) {
      var token = String(match[1] || "").trim();
      if (!token) {
        continue;
      }
      if (found[token]) {
        continue;
      }
      // date/time-семейство (включая date2/time2 и подписи) резолвится через базы.
      if (parseIndexedDateToken(token) || parseIndexedTimeToken(token) || parseLabeledTodayToken(token)) {
        found[token] = true;
        continue;
      }
      // v3.6.0: адресные {{поле:тег}} берутся из stored-профилей — ввода не требуют.
      // Пропускаем только известные поля (чужое с ":" пусть валит в unknown-func/кастом).
      var profTagTok = parseProfileTagToken(token);
      if (profTagTok && isAddressableField(profTagTok.field, config)) {
        found[token] = true;
        continue;
      }
      // v3.8.0: выбор {{поле:#}} — выпадашка со всеми значениями. Нужен ДО фильтра по ":".
      // v3.9.0: группы {{поле:#группа}} — связанные выборки по одной записи.
      var choiceTok = parseChoiceToken(token);
      if (choiceTok) {
        found[token] = true;
        var choiceOpts = collectChoiceOptions(choiceTok.field, config);
        var choiceGroup = choiceTok.group || "";
        var hasGroupCands = Boolean(choiceGroup) && collectGroupCandidates(config).length > 0;
        if (choiceOpts.length || hasGroupCands) {
          list.push({
            id: "__choice__" + token,
            name: token,
            token: token,
            field: choiceTok.field,
            group: choiceGroup,
            type: "choice_token",
            options: choiceOpts,
            value: choiceOpts[0] || ""
          });
        }
        continue;
      }
      // v3.10.0: глобальный свободный ввод {{text}} / {{text2}} / {{text("Подпись")}}.
      // Своя переменная text/text2 — в приоритете (обычная кастомная логика ниже).
      var textTok = parseTextToken(token);
      if (textTok && !findCustomVariable(textTok.base)) {
        found[token] = true;
        list.push({
          id: "__text__" + token,
          name: textTok.base,
          token: token,
          label: textTok.label,
          type: "text_token",
          value: ""
        });
        continue;
      }
      var labeledCustom = parseLabeledCustomToken(token);
      if (labeledCustom && findCustomVariable(labeledCustom.name)) {
        found[token] = true;
        list.push({
          id: findCustomVariable(labeledCustom.name).id + "::" + token,
          name: labeledCustom.name,
          token: token,
          label: labeledCustom.label,
          type: "text_token",
          value: findCustomVariable(labeledCustom.name).value || ""
        });
        continue;
      }
      if (token.indexOf(":") !== -1) {
        continue;
      }
      // Кастомная переменная без подписи.
      var plainCustom = parseLabeledCustomToken(token);
      var varName = plainCustom ? plainCustom.name : token;
      var variable = findCustomVariable(varName);
      if (!variable) {
        continue;
      }
      found[token] = true;
      list.push({
        id: variable.id + "::" + token,
        name: variable.name,
        token: token,
        label: plainCustom && plainCustom.label ? plainCustom.label : "",
        type: "text_token",
        value: variable.value || ""
      });
    }
    return list;
  }

  function shouldPreviewBeforeInsert(template) {
    return template.previewBeforeInsert === true || getEditableVariables(template).length > 0;
  }

  function renderText(raw, overrides) {
    return resolveTokens(randomizeTemplateText(raw), overrides);
  }

  function applyTemplate(field, template, removeCount, readyText) {
    field.focus();
    deleteBackward(field, removeCount || 0);
    var message = typeof readyText === "string" ? readyText : renderText(template.body, null);
    // v3.10.0: картинки убраны — вставляется только текст.
    typeText(field, message);
  }

  function ensurePreview() {
    if (previewHost && document.documentElement.contains(previewHost)) {
      return;
    }

    previewHost = document.createElement("div");
    previewHost.style.position = "fixed";
    previewHost.style.left = "0";
    previewHost.style.top = "0";
    previewHost.style.width = "0";
    previewHost.style.height = "0";
    previewHost.style.zIndex = "2147483647";

    var shadow = previewHost.attachShadow({ mode: "open" });
    var style = document.createElement("style");
    style.textContent = [
      "* { box-sizing: border-box; font-family: Inter, Segoe UI, system-ui, sans-serif; }",
      ".pop { position: fixed; width: min(520px, calc(100vw - 16px)); border: 1px solid #2a2f3a; border-radius: 10px; background: #0f1117; color: #e5e7eb; box-shadow: 0 18px 40px rgba(0,0,0,.45); }",
      ".head { padding: 10px 12px; border-bottom: 1px solid #222734; font-size: 12px; color: #93a0b5; text-transform: uppercase; letter-spacing: .08em; }",
      ".body { padding: 10px 12px; display: grid; gap: 8px; max-height: 52vh; overflow: auto; }",
      ".line { display: grid; gap: 6px; }",
      ".line label { font-size: 11px; color: #93a0b5; }",
      ".field { width: 100%; border: 1px solid #2a2f3a; border-radius: 8px; padding: 8px 9px; background: #111827; color: #e5e7eb; font-size: 12px; }",
      ".preview { white-space: pre-wrap; background: #0b1220; border: 1px solid #2a2f3a; border-radius: 8px; padding: 9px; font-size: 12px; line-height: 1.5; }",
      ".actions { padding: 10px 12px; border-top: 1px solid #222734; display: flex; justify-content: flex-end; gap: 8px; }",
      ".btn { border: 1px solid #2a2f3a; background: #141b27; color: #dbeafe; border-radius: 8px; padding: 6px 10px; font-size: 12px; cursor: pointer; }",
      ".btn.primary { background: #4f46e5; border-color: #4f46e5; color: #fff; }"
    ].join("\n");

    previewEl = document.createElement("div");
    previewEl.className = "pop";
    shadow.appendChild(style);
    shadow.appendChild(previewEl);
    document.documentElement.appendChild(previewHost);
  }

  function closePreview() {
    previewState = null;
    if (previewHost && previewHost.parentNode) {
      previewHost.parentNode.removeChild(previewHost);
    }
    previewHost = null;
    previewEl = null;
  }

  function positionPreview(field) {
    if (!previewEl || !field) {
      return;
    }
    var rect = field.getBoundingClientRect();
    var estimatedHeight = 330;
    var hasSpaceBelow = window.innerHeight - rect.bottom > estimatedHeight;
    var top = hasSpaceBelow ? rect.bottom + 8 : Math.max(8, rect.top - estimatedHeight - 8);
    previewEl.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 528)) + "px";
    previewEl.style.top = top + "px";
  }

  function openInsertPreview(field, template, removeCount) {
    ensurePreview();

    var editable = getEditableVariables(template);
    var values = {};
    var touched = {};
    var errorNames = [];
    var sourceText = randomizeTemplateText(template.body);
    var editableMap = {};
    var wrappersMap = {};
    var finalValueNode = null;
    var errorLabelNode = null;
    var interactivePreviewNode = null;
    // v3.1.4: ВСЕ переменные заполняются ПРЯМО В ТЕКСТЕ, верхней панели баз больше нет.
    // Каждая подпись {{date("Заезд")}} = своя независимая база; повторы той же базы показывают вычисление.
    var baseDateByKey = {};
    var baseTimeByKey = {};
    var baseDateMeta = {};
    var baseTimeMeta = {};
    collectDateBases(template).forEach(function (base) {
      baseDateByKey[base.key] = todayIso();
      baseDateMeta[base.key] = base;
    });
    collectTimeBases(template).forEach(function (base) {
      baseTimeByKey[base.key] = currentTimeValue();
      baseTimeMeta[base.key] = base;
    });
    var derivedChips = [];
    var customInputsByName = {};
    // v3.8.0: селекты выбора {{поле:#}} (синхронизация повторов).
    var choiceSelectsByKey = {};
    // v3.9.0: связанные выборки {{поле:#группа}} — одна выбранная запись на группу.
    var choiceGroupSels = {};
    // v3.5.0: разовый выбор человека в окне вставки (по умолчанию — активный из настроек).
    var previewProfileId = config.activeProfileId;

    editable.forEach(function (item) {
      if (item.type === "base_date" || item.type === "base_time") {
        touched[item.name] = true;
        return;
      }
      if (item.token) {
        editableMap[item.token] = item;
      }
      // v3.8.0: выборки {{поле:#}} по умолчанию уже заполнены первым вариантом.
      // v3.9.0: групповые {{поле:#группа}} в values не кладем — резолвятся через __groupSels.
      if (item.type === "choice_token") {
        if (item.group) {
          touched[item.name] = true;
          return;
        }
        values[item.name] = item.value || "";
        touched[item.name] = true;
        return;
      }
      if (values[item.name] === undefined) {
        values[item.name] = "";
        touched[item.name] = false;
      }
    });

    // v3.9.0: дефолт связанных групп — первая запись-кандидат (люди первичны).
    editable.forEach(function (item) {
      if (item.type === "choice_token" && item.group && !(item.group in choiceGroupSels)) {
        var cands = collectGroupCandidates(config);
        choiceGroupSels[item.group] = cands.length
          ? { kind: cands[0].kind, id: cands[0].id, setId: cands[0].setId }
          : null;
      }
    });

    function buildOverrides() {
      var ov = { __dateBases: {}, __timeBases: {} };
      Object.keys(baseDateByKey).forEach(function (k) {
        ov.__dateBases[k] = baseDateByKey[k];
      });
      Object.keys(baseTimeByKey).forEach(function (k) {
        ov.__timeBases[k] = baseTimeByKey[k];
      });
      // v3.9.0: выбранные записи связанных групп.
      ov.__groupSels = {};
      Object.keys(choiceGroupSels).forEach(function (g) {
        if (choiceGroupSels[g]) {
          ov.__groupSels[g] = choiceGroupSels[g];
        }
      });
      // legacy для совместимости (неподписанные index:1)
      if (baseDateByKey["index:1"]) {
        ov.__date_base_iso = baseDateByKey["index:1"];
      }
      if (baseTimeByKey["index:1"]) {
        ov.__time_base = baseTimeByKey["index:1"];
      }
      Object.keys(values).forEach(function (k) {
        ov[k] = values[k];
      });
      // v3.5.0: разово выбранный человек.
      var profList = (config && Array.isArray(config.profiles)) ? config.profiles : [];
      for (var pi = 0; pi < profList.length; pi += 1) {
        if (profList[pi].id === previewProfileId) {
          ov.__profile = profList[pi];
          break;
        }
      }
      return ov;
    }

    function refreshInteractivePreview() {
      if (interactivePreviewNode) {
        renderInteractivePreview(interactivePreviewNode);
      }
    }

    function updateDerivedChips(kind, baseKey) {
      try {
        var ov = buildOverrides();
        derivedChips.forEach(function (chip) {
          if (chip.kind === kind && chip.baseKey === baseKey && chip.node && chip.node.parentNode) {
            chip.node.textContent = resolveTokens(chip.tokenFull, ov);
          }
        });
      } catch (error) {
        /* ignore */
      }
    }

    function readyText() {
      return resolveTokens(sourceText, buildOverrides());
    }

    function refreshFinalPreview() {
      if (finalValueNode) {
        finalValueNode.textContent = readyText();
      }
    }

    function paintErrors() {
      Object.keys(wrappersMap).forEach(function (key) {
        wrappersMap[key].forEach(function (node) {
          node.style.border = "1px solid " + (errorNames.indexOf(key) !== -1 ? "#ef4444" : "#f59e0b");
        });
      });
      if (errorLabelNode) {
        if (errorNames.length === 0) {
          errorLabelNode.textContent = "";
          errorLabelNode.style.display = "none";
        } else {
          errorLabelNode.style.display = "block";
          // v3.1.4: показываем подписи вместо сырого тега, если заданы.
          errorLabelNode.textContent =
            "Ошибка: заполните все обязательные переменные перед вставкой: " +
            errorNames.map(function (tokenKey) {
              var item = editableMap[tokenKey];
              if (item && item.label) {
                return item.label + " ({{" + tokenKey + "}})";
              }
              return "{{" + tokenKey + "}}";
            }).join(", ");
        }
      }
    }

    function inlineDateWrapper(parsed, baseKey, tokenFull) {
      var meta = baseDateMeta[baseKey] || { label: parsed.label || "", index: parsed.index };
      var title = meta.label ? meta.label : (parsed.index > 1 ? "Дата " + parsed.index : "Дата");
      var wrapper = document.createElement("span");
      wrapper.style.display = "inline-flex";
      wrapper.style.alignItems = "center";
      wrapper.style.gap = "4px";
      wrapper.style.padding = "2px 5px";
      wrapper.style.margin = "0 2px";
      wrapper.style.borderRadius = "6px";
      wrapper.style.border = "1px solid #4f46e5";
      wrapper.style.background = "#151b2e";
      var label = document.createElement("span");
      label.style.fontSize = "10px";
      label.style.color = "#c7d2fe";
      label.textContent = title;
      wrapper.appendChild(label);
      var dateInput = document.createElement("input");
      dateInput.type = "date";
      dateInput.className = "field";
      dateInput.style.width = "auto";
      dateInput.style.padding = "2px 6px";
      dateInput.style.fontSize = "11px";
      dateInput.value = baseDateByKey[baseKey];
      dateInput.title = tokenFull + " — меняется прямо здесь";
      dateInput.addEventListener("input", function () {
        if (dateInput.value) {
          baseDateByKey[baseKey] = dateInput.value;
        }
        errorNames = [];
        refreshFinalPreview();
        updateDerivedChips("date", baseKey);
        paintErrors();
      });
      wrapper.appendChild(dateInput);
      return wrapper;
    }

    function inlineTimeWrapper(parsed, baseKey, tokenFull) {
      var meta = baseTimeMeta[baseKey] || { label: parsed.label || "", index: parsed.index };
      var title = meta.label ? meta.label : (parsed.index > 1 ? "Время " + parsed.index : "Время");
      var wrapper = document.createElement("span");
      wrapper.style.display = "inline-flex";
      wrapper.style.alignItems = "center";
      wrapper.style.gap = "4px";
      wrapper.style.padding = "2px 5px";
      wrapper.style.margin = "0 2px";
      wrapper.style.borderRadius = "6px";
      wrapper.style.border = "1px solid #4f46e5";
      wrapper.style.background = "#151b2e";
      var label = document.createElement("span");
      label.style.fontSize = "10px";
      label.style.color = "#c7d2fe";
      label.textContent = title;
      wrapper.appendChild(label);
      var timeInput = document.createElement("input");
      timeInput.type = "time";
      timeInput.className = "field";
      timeInput.style.width = "auto";
      timeInput.style.padding = "2px 6px";
      timeInput.style.fontSize = "11px";
      timeInput.value = baseTimeByKey[baseKey];
      timeInput.title = tokenFull + " — меняется прямо здесь";
      timeInput.addEventListener("input", function () {
        if (timeInput.value) {
          baseTimeByKey[baseKey] = timeInput.value;
        }
        errorNames = [];
        refreshFinalPreview();
        updateDerivedChips("time", baseKey);
        paintErrors();
      });
      wrapper.appendChild(timeInput);
      return wrapper;
    }

    // v3.9.0: селект связанной группы — выбирается ЗАПИСЬ, все {{поле:#группа}} тянут поля из неё.
    function inlineGroupSelect(group, tokenFull) {
      var wrapper = document.createElement("span");
      wrapper.style.display = "inline-flex";
      wrapper.style.alignItems = "center";
      wrapper.style.gap = "4px";
      wrapper.style.padding = "2px 5px";
      wrapper.style.margin = "0 2px";
      wrapper.style.borderRadius = "6px";
      wrapper.style.border = "1px solid #10b981";
      wrapper.style.background = "#0b1f17";
      var groupFields = [];
      editable.forEach(function (it) {
        if (it.type === "choice_token" && it.group === group && groupFields.indexOf(it.field) === -1) {
          groupFields.push(it.field);
        }
      });
      var label = document.createElement("span");
      label.style.fontSize = "10px";
      label.style.color = "#6ee7b7";
      label.textContent = "🔗#" + group + (groupFields.length ? ": " + groupFields.join(", ") : "");
      label.title = "Связанная выборка: все поля группы берутся из выбранной записи";
      wrapper.appendChild(label);
      var cands = collectGroupCandidates(config);
      var sel = document.createElement("select");
      sel.className = "field";
      sel.style.width = "auto";
      sel.style.maxWidth = "240px";
      sel.style.padding = "2px 6px";
      sel.style.fontSize = "11px";
      sel.title = tokenFull + " — выбор записи для всей группы";
      cands.forEach(function (c, i) {
        var o = document.createElement("option");
        o.value = String(i);
        o.textContent = c.label;
        sel.appendChild(o);
      });
      function currentIndex() {
        var cur = choiceGroupSels[group];
        for (var i = 0; i < cands.length; i += 1) {
          if (cur && cands[i].kind === cur.kind && cands[i].id === cur.id &&
              (cands[i].kind !== "record" || cands[i].setId === cur.setId)) {
            return i;
          }
        }
        return 0;
      }
      sel.value = String(currentIndex());
      sel.addEventListener("change", function () {
        var c = cands[Number(sel.value)] || cands[0];
        if (c) {
          choiceGroupSels[group] = { kind: c.kind, id: c.id, setId: c.setId };
        }
        errorNames = [];
        refreshFinalPreview();
        updateDerivedChips("choicegroup", group);
        paintErrors();
      });
      wrapper.appendChild(sel);
      return wrapper;
    }

    function derivedChip(tokenFull, kind, baseKey) {      var node = document.createElement("span");
      node.style.display = "inline-block";
      node.style.padding = "1px 6px";
      node.style.margin = "0 2px";
      node.style.borderRadius = "6px";
      node.style.border = "1px dashed #4f46e5";
      node.style.background = "#151b2e";
      node.style.color = "#c7d2fe";
      node.style.fontSize = "11px";
      node.title = tokenFull + " — посчитано от базы, меняется там где ввод";
      node.textContent = resolveTokens(tokenFull, buildOverrides());
      derivedChips.push({ node: node, tokenFull: tokenFull, kind: kind, baseKey: baseKey });
      return node;
    }

    function renderInteractivePreview(previewNode) {
      previewNode.innerHTML = "";
      previewNode.style.display = "inline";
      derivedChips = [];
      wrappersMap = {};
      choiceSelectsByKey = {};
      var seenChoiceGroups = {};
      var seenDateBases = {};
      var seenTimeBases = {};
      var regex = /\{\{\s*([^{}]+?)\s*\}\}/g;
      var cursor = 0;
      var match;

      while ((match = regex.exec(sourceText))) {
        var tokenFull = match[0];
        var token = String(match[1] || "").trim();
        var textPart = sourceText.slice(cursor, match.index);
        if (textPart) {
          previewNode.appendChild(document.createTextNode(textPart));
        }

        // v3.1.4: ВСЁ инлайн. Первое вхождение базы = поле ввода, повторы = вычисление.
        var dateParsed = parseIndexedDateToken(token);
        var timeParsed = parseIndexedTimeToken(token);
        var todayParsed = (!dateParsed && !timeParsed) ? parseLabeledTodayToken(token) : null;
        if (dateParsed) {
          (function (parsed, full) {
            var key = dateBaseKey(parsed);
            if (!seenDateBases[key]) {
              seenDateBases[key] = true;
              previewNode.appendChild(inlineDateWrapper(parsed, key, full));
            } else {
              previewNode.appendChild(derivedChip(full, "date", key));
            }
          })(dateParsed, tokenFull);
        } else if (timeParsed) {
          (function (parsed, full) {
            var key = timeBaseKey(parsed);
            if (!seenTimeBases[key]) {
              seenTimeBases[key] = true;
              previewNode.appendChild(inlineTimeWrapper(parsed, key, full));
            } else {
              previewNode.appendChild(derivedChip(full, "time", key));
            }
          })(timeParsed, tokenFull);
        } else if (todayParsed) {
          var todayChip = document.createElement("span");
          todayChip.style.display = "inline-block";
          todayChip.style.padding = "1px 6px";
          todayChip.style.margin = "0 2px";
          todayChip.style.borderRadius = "6px";
          todayChip.style.border = "1px dashed #64748b";
          todayChip.style.background = "#111827";
          todayChip.style.color = "#94a3b8";
          todayChip.style.fontSize = "11px";
          todayChip.title = tokenFull + " — фиксировано (сегодня/сейчас)";
          todayChip.textContent = resolveTokens(tokenFull, buildOverrides());
          previewNode.appendChild(todayChip);
        } else if (editableMap[token] && editableMap[token].type === "choice_token") {
          (function (localToken, localItem, localKey, localFull) {
            // v3.9.0: связанная группа — один селект записей на первом вхождении, дальше чипы.
            if (localItem.group) {
              if (!seenChoiceGroups[localItem.group]) {
                seenChoiceGroups[localItem.group] = true;
                previewNode.appendChild(inlineGroupSelect(localItem.group, localFull));
              } else {
                previewNode.appendChild(derivedChip(localFull, "choicegroup", localItem.group));
              }
              return;
            }
            // v3.8.0: выпадашка выбора из всех значений поля (люди + справочники).
            var wrapper = document.createElement("span");
            wrapper.style.display = "inline-flex";
            wrapper.style.alignItems = "center";
            wrapper.style.gap = "4px";
            wrapper.style.padding = "2px 5px";
            wrapper.style.margin = "0 2px";
            wrapper.style.borderRadius = "6px";
            wrapper.style.border = "1px solid #10b981";
            wrapper.style.background = "#0b1f17";
            wrappersMap[localKey] = wrappersMap[localKey] || [];
            wrappersMap[localKey].push(wrapper);

            var label = document.createElement("span");
            label.style.fontSize = "10px";
            label.style.color = "#6ee7b7";
            label.textContent = "{{" + localItem.field + ":#}}";
            label.title = "Выбор из " + localItem.options.length + ": " + localItem.options.join(", ");
            wrapper.appendChild(label);

            var sel = document.createElement("select");
            sel.className = "field";
            sel.style.width = "auto";
            sel.style.maxWidth = "220px";
            sel.style.padding = "2px 6px";
            sel.style.fontSize = "11px";
            sel.title = "{{" + localToken + "}}";
            localItem.options.forEach(function (opt) {
              var o = document.createElement("option");
              o.value = opt;
              o.textContent = opt;
              sel.appendChild(o);
            });
            sel.value = values[localKey] || localItem.options[0];
            choiceSelectsByKey[localKey] = choiceSelectsByKey[localKey] || [];
            choiceSelectsByKey[localKey].push(sel);
            sel.addEventListener("change", function () {
              values[localKey] = sel.value;
              touched[localKey] = true;
              (choiceSelectsByKey[localKey] || []).forEach(function (other) {
                if (other !== sel && other.value !== sel.value) {
                  other.value = sel.value;
                }
              });
              errorNames = [];
              refreshFinalPreview();
              paintErrors();
            });
            // change тоже ловим через input на всякий случай (некоторые движки)
            sel.addEventListener("input", function () {
              values[localKey] = sel.value;
              touched[localKey] = true;
              errorNames = [];
              refreshFinalPreview();
              paintErrors();
            });
            wrapper.appendChild(sel);
            previewNode.appendChild(wrapper);
          })(token, editableMap[token], token, tokenFull);
        } else if (editableMap[token]) {
          (function (localToken, localItem) {
            var wrapper = document.createElement("span");
            wrapper.style.display = "inline-flex";
            wrapper.style.alignItems = "center";
            wrapper.style.gap = "4px";
            wrapper.style.padding = "2px 5px";
            wrapper.style.margin = "0 2px";
            wrapper.style.borderRadius = "6px";
            wrapper.style.border = "1px solid #f59e0b";
            wrapper.style.background = "#1a2233";
            wrappersMap[localToken] = wrappersMap[localToken] || [];
            wrappersMap[localToken].push(wrapper);

            var label = document.createElement("span");
            label.style.fontSize = "10px";
            label.style.color = "#fcd34d";
            // v3.1.4: вместо сырого {{var}} показываем подпись, если задана {{var("Подсказка")}}.
            label.textContent = localItem.label ? localItem.label : "{{" + localItem.name + "}}";
            label.title = "{{" + localToken + "}}";
            wrapper.appendChild(label);

            var inputText = document.createElement("input");
            inputText.className = "field";
            inputText.style.width = "auto";
            inputText.style.minWidth = "120px";
            inputText.style.padding = "2px 6px";
            inputText.style.fontSize = "11px";
            inputText.placeholder = localItem.label ? localItem.label : "Введите";
            inputText.title = "{{" + localToken + "}}";
            inputText.value = values[localItem.name] || "";
            customInputsByName[localItem.name] = customInputsByName[localItem.name] || [];
            customInputsByName[localItem.name].push(inputText);
            inputText.addEventListener("input", function () {
              values[localItem.name] = inputText.value;
              touched[localItem.name] = String(inputText.value || "").trim().length > 0;
              // Синхронизируем повторы той же переменной в тексте.
              (customInputsByName[localItem.name] || []).forEach(function (other) {
                if (other !== inputText && other.value !== inputText.value) {
                  other.value = inputText.value;
                }
              });
              errorNames = [];
              refreshFinalPreview();
              paintErrors();
            });
            wrapper.appendChild(inputText);
            previewNode.appendChild(wrapper);
          })(token, editableMap[token]);
        } else {
          var computed = resolveTokens(tokenFull, buildOverrides());
          previewNode.appendChild(document.createTextNode(computed));
        }
        cursor = match.index + tokenFull.length;
      }

      var rest = sourceText.slice(cursor);
      if (rest) {
        previewNode.appendChild(document.createTextNode(rest));
      }
    }

    function render() {
      previewEl.innerHTML = "";
      var head = document.createElement("div");
      head.className = "head";
      head.textContent = "Предпросмотр перед вставкой";
      previewEl.appendChild(head);

      var body = document.createElement("div");
      body.className = "body";

      // v3.1.4: верхней панели баз НЕТ — всё заполняется прямо в тексте ниже.
      var customCount = editable.filter(function (it) {
        return it.type === "text_token";
      }).length;
      var hasInlineDates = Object.keys(baseDateByKey).length > 0 || Object.keys(baseTimeByKey).length > 0;
      // v3.5.0: если шаблон использует данные человека и людей несколько — выбор прямо здесь.
      var peopleList = (config && Array.isArray(config.profiles)) ? config.profiles : [];
      var needsPerson = templateUsesProfileVars(template) && peopleList.length > 1;
      if (needsPerson) {
        var personLine = document.createElement("div");
        personLine.className = "line";
        var personLabel = document.createElement("label");
        personLabel.textContent = "От чьего имени вставить ({{name}}, {{phone}}…)?";
        personLine.appendChild(personLabel);
        var personRow = document.createElement("div");
        personRow.style.display = "flex";
        personRow.style.gap = "8px";
        var personSelect = document.createElement("select");
        personSelect.className = "field";
        personSelect.style.width = "auto";
        personSelect.style.minWidth = "220px";
        peopleList.forEach(function (p) {
          var o = document.createElement("option");
          o.value = p.id;
          o.textContent = profileDisplayName(p);
          if (p.id === previewProfileId) {
            o.selected = true;
          }
          personSelect.appendChild(o);
        });
        personSelect.addEventListener("change", function () {
          previewProfileId = personSelect.value;
          errorNames = [];
          refreshFinalPreview();
          refreshInteractivePreview();
          paintErrors();
        });
        personRow.appendChild(personSelect);
        personLine.appendChild(personRow);
        body.appendChild(personLine);
      }
      if (hasInlineDates || customCount > 0) {
        var hint = document.createElement("div");
        hint.className = "line";
        var hintText = document.createElement("label");
        hintText.textContent = "Заполняйте всё прямо в тексте ниже: даты/времена — календарями, остальное — полями. Пустые текстовые поля не дадут вставить шаблон.";
        hint.appendChild(hintText);
        body.appendChild(hint);
      }

      var preview = document.createElement("div");
      preview.className = "preview";
      interactivePreviewNode = preview;
      renderInteractivePreview(preview);
      body.appendChild(preview);

      var finalPreview = document.createElement("div");
      finalPreview.className = "line";
      var finalLabel = document.createElement("label");
      finalLabel.textContent = "Итоговый текст вставки:";
      var finalValue = document.createElement("div");
      finalValue.className = "preview";
      finalValue.textContent = readyText();
      finalValueNode = finalValue;
      finalPreview.appendChild(finalLabel);
      finalPreview.appendChild(finalValue);
      body.appendChild(finalPreview);

      var error = document.createElement("div");
      error.className = "line";
      var errorText = document.createElement("label");
      errorText.style.color = "#fca5a5";
      errorText.style.display = "none";
      error.appendChild(errorText);
      errorLabelNode = errorText;
      body.appendChild(error);

      previewEl.appendChild(body);

      var actions = document.createElement("div");
      actions.className = "actions";
      var cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "btn";
      cancel.textContent = "Отмена";
      cancel.addEventListener("click", closePreview);

      var ok = document.createElement("button");
      ok.type = "button";
      ok.className = "btn primary";
      ok.textContent = "Вставить";
      ok.addEventListener("click", function () {
        // v3.1.4: базы всегда заполнены (дефолт сегодня/сейчас), требуем только кастомные {{var}}.
        // errorNames = токены (для красной рамки), подпись подтянется в paintErrors.
        var seenNames = {};
        var missing = [];
        editable.forEach(function (item) {
          if (item.type !== "text_token") {
            return;
          }
          if (touched[item.name] && String(values[item.name] || "").trim().length > 0) {
            return;
          }
          if (seenNames[item.name]) {
            return;
          }
          seenNames[item.name] = true;
          missing.push(item.token || item.name);
        });
        if (missing.length > 0) {
          errorNames = missing;
          paintErrors();
          return;
        }
        applyTemplate(field, template, removeCount, readyText());
        closePreview();
      });

      actions.appendChild(cancel);
      actions.appendChild(ok);
      previewEl.appendChild(actions);
      positionPreview(field);
      paintErrors();

      previewEl.addEventListener("keydown", function (event) {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          ok.click();
        }
      });

      var firstControl = previewEl.querySelector("input, select, button");
      if (firstControl && typeof firstControl.focus === "function") {
        firstControl.focus();
      }
    }

    previewState = {
      field: field,
      template: template,
      removeCount: removeCount
    };
    render();
  }

  function startTemplateInsert(field, template, removeCount) {
    if (shouldPreviewBeforeInsert(template)) {
      openInsertPreview(field, template, removeCount || 0);
      return;
    }
    applyTemplate(field, template, removeCount || 0);
  }

  function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // v3.1.1: единый стандарт тега. Пусто = "без тега, только через //".
  // Разрешены буквы/цифры/дефис/подчеркивание (латиница + кириллица).
  function sanitizeTag(raw) {
    var s = String(raw == null ? "" : raw).trim().toLowerCase();
    s = s.replace(/\s+/g, "");
    s = s.replace(/[^a-zа-яё0-9_-]/gi, "");
    // Тег не должен начинаться с "/" (иначе конфликтует с // меню при префиксе "/").
    s = s.replace(/^\/+/, "");
    return s;
  }

  function isTagUsable(tag) {
    return /^[a-zа-яё0-9_-]+$/i.test(String(tag || "")) && String(tag).length >= 2;
  }

  function tagKey(tag) {
    return String(tag || "").trim().toLowerCase();
  }

  // v3.10.0: домены папки — дефолтная область видимости шаблонов без своих доменов.
  function cleanDomainList(raw) {
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw
      .map(function (d) {
        return String(d || "").trim().toLowerCase();
      })
      .filter(Boolean);
  }

  function effectiveFolderDomains(template, cfg) {
    try {
      var map = (cfg && cfg.folderDomains && typeof cfg.folderDomains === "object") ? cfg.folderDomains : {};
      var list = map[template.folder || "Общие"];
      return Array.isArray(list) ? list : [];
    } catch (error) {
      return [];
    }
  }

  // v3.6.0: адресные переменные {{поле:тег}} и кастомные поля людей.
  // ВАЖНО: именно function (не var) — страница настроек выходит через early return
  // раньше, чем выполнились бы присвоения var ниже по коду; function всплывают всегда.
  function profileBuiltinFields() {
    return ["name", "surname", "fullname", "company", "position", "email", "phone"];
  }

  function sanitizeProfileFieldName(raw) {
    var s = String(raw == null ? "" : raw).trim().toLowerCase().replace(/\s+/g, "_");
    s = s.replace(/[^a-z0-9_а-яё]/gi, "");
    return s;
  }

  function parseProfileTagToken(token) {
    var s = String(token || "").trim();
    var ci = s.indexOf(":");
    if (ci <= 0) {
      return null;
    }
    var field = s.slice(0, ci).trim().toLowerCase();
    var tag = s.slice(ci + 1).trim().toLowerCase();
    if (!/^[a-z_а-яё][a-z0-9_а-яё-]*$/i.test(field)) {
      return null;
    }
    if (!/^[a-z0-9_а-яё-]+$/i.test(tag)) {
      return null;
    }
    return { field: field, tag: tag };
  }

  // v3.8.0: выбор значения при вставке {{поле:#}} — список из всех: люди + справочники.
  // v3.9.0: именованная группа {{поле:#группа}} — связанные выборки по одной записи.
  function parseChoiceToken(token) {
    var s = String(token || "").trim();
    var m = s.match(/^([a-z_а-яё][a-z0-9_а-яё-]*)\s*:\s*#([a-z0-9_а-яё-]*)\s*$/i);
    if (!m) {
      return null;
    }
    return { field: m[1].toLowerCase(), group: (m[2] || "").toLowerCase() };
  }

  // v3.9.0: кандидаты-записи для связанных выборок: все люди, затем все записи справочников.
  function collectGroupCandidates(cfg) {
    var out = [];
    var people = (cfg && Array.isArray(cfg.profiles)) ? cfg.profiles : [];
    people.forEach(function (p) {
      out.push({ kind: "person", id: p.id, label: profileDisplayName(p) + " (Люди)" });
    });
    var sets = (cfg && Array.isArray(cfg.recordSets)) ? cfg.recordSets : [];
    sets.forEach(function (s) {
      (s.records || []).forEach(function (r) {
        if (String(r.tag || "").trim()) {
          out.push({ kind: "record", setId: s.id, id: r.id, label: "@" + r.tag + " (" + s.name + ")" });
        }
      });
    });
    return out;
  }

  function lookupGroupRecord(sel, cfg) {
    if (!sel) {
      return null;
    }
    if (sel.kind === "person") {
      var people = (cfg && Array.isArray(cfg.profiles)) ? cfg.profiles : [];
      for (var i = 0; i < people.length; i += 1) {
        if (people[i].id === sel.id) {
          return { kind: "person", person: people[i] };
        }
      }
      return null;
    }
    var sets = (cfg && Array.isArray(cfg.recordSets)) ? cfg.recordSets : [];
    for (var si = 0; si < sets.length; si += 1) {
      if (sets[si].id !== sel.setId) {
        continue;
      }
      var recs = Array.isArray(sets[si].records) ? sets[si].records : [];
      for (var ri = 0; ri < recs.length; ri += 1) {
        if (recs[ri].id === sel.id) {
          return { kind: "record", set: sets[si], record: recs[ri] };
        }
      }
    }
    return null;
  }

  function collectChoiceOptions(field, cfg) {
    var f = String(field || "").toLowerCase();
    var out = [];
    var seen = {};
    function add(v) {
      v = String(v == null ? "" : v).trim();
      if (v && !seen[v]) {
        seen[v] = true;
        out.push(v);
      }
    }
    var people = (cfg && Array.isArray(cfg.profiles)) ? cfg.profiles : [];
    people.forEach(function (p) {
      add(getProfileFieldValue(p, f));
    });
    var sets = (cfg && Array.isArray(cfg.recordSets)) ? cfg.recordSets : [];
    sets.forEach(function (s) {
      (s.records || []).forEach(function (r) {
        var vals = (r.values && typeof r.values === "object") ? r.values : {};
        Object.keys(vals).forEach(function (k) {
          if (String(k).toLowerCase() === f) {
            add(vals[k]);
          }
        });
      });
    });
    return out;
  }

  function isProfileFieldName(field, cfg) {
    var f = String(field || "").toLowerCase();
    if (profileBuiltinFields().indexOf(f) !== -1) {
      return true;
    }
    var list = (cfg && Array.isArray(cfg.profileFields)) ? cfg.profileFields : [];
    for (var i = 0; i < list.length; i += 1) {
      if (String(list[i].name || "").toLowerCase() === f) {
        return true;
      }
    }
    return false;
  }

  function findProfileByTag(tag, list) {
    var key = String(tag || "").trim().toLowerCase();
    if (!key) {
      return null;
    }
    var arr = Array.isArray(list) ? list : [];
    for (var i = 0; i < arr.length; i += 1) {
      if (String(arr[i].tag || "").trim().toLowerCase() === key) {
        return arr[i];
      }
    }
    return null;
  }

  function getProfileFieldValue(person, field) {
    var f = String(field || "").toLowerCase();
    if (!person) {
      return "";
    }
    if (f === "fullname") {
      return ((person.name || "") + " " + (person.surname || "")).trim();
    }
    if (f === "name" || f === "surname" || f === "email" || f === "phone" ||
        f === "company" || f === "position") {
      return String(person[f] == null ? "" : person[f]);
    }
    var fields = person.fields && typeof person.fields === "object" ? person.fields : {};
    if (Object.prototype.hasOwnProperty.call(fields, f)) {
      return String(fields[f] == null ? "" : fields[f]);
    }
    var keys = Object.keys(fields);
    for (var i = 0; i < keys.length; i += 1) {
      if (String(keys[i]).toLowerCase() === f) {
        return String(fields[keys[i]] == null ? "" : fields[keys[i]]);
      }
    }
    return "";
  }

  // v3.9.0: владелец поля для {{поле}} без тега: встроенные и поля людей → ЛЮДИ,
  // поле справочника → этот справочник. Активная запись владельца и подставляется.
  function getFieldOwnerCategory(field, cfg) {
    var f = String(field || "").toLowerCase();
    if (profileBuiltinFields().indexOf(f) !== -1) {
      return "people";
    }
    var pf = (cfg && Array.isArray(cfg.profileFields)) ? cfg.profileFields : [];
    for (var i = 0; i < pf.length; i += 1) {
      if (String(pf[i].name || "").toLowerCase() === f) {
        return "people";
      }
    }
    var sets = (cfg && Array.isArray(cfg.recordSets)) ? cfg.recordSets : [];
    for (var s = 0; s < sets.length; s += 1) {
      var fl = Array.isArray(sets[s].fields) ? sets[s].fields : [];
      for (var j = 0; j < fl.length; j += 1) {
        if (String(fl[j].name || "").toLowerCase() === f) {
          return sets[s].id;
        }
      }
    }
    return null;
  }

  function getCategoryActiveRecord(cat, cfg, overrides) {
    if (cat === "people") {
      return (overrides && overrides.__profile) || getActiveProfile();
    }
    var sets = (cfg && Array.isArray(cfg.recordSets)) ? cfg.recordSets : [];
    for (var i = 0; i < sets.length; i += 1) {
      if (sets[i].id !== cat) {
        continue;
      }
      var recs = Array.isArray(sets[i].records) ? sets[i].records : [];
      for (var j = 0; j < recs.length; j += 1) {
        if (recs[j].id === sets[i].activeRecordId) {
          return recs[j];
        }
      }
      return recs[0] || null;
    }
    return null;
  }

  function getCategoryFieldValue(cat, rec, field) {
    if (cat === "people") {
      return getProfileFieldValue(rec, field);
    }
    var f = String(field || "").toLowerCase();
    var vals = (rec && rec.values && typeof rec.values === "object") ? rec.values : {};
    if (Object.prototype.hasOwnProperty.call(vals, f)) {
      return String(vals[f] == null ? "" : vals[f]);
    }
    var keys = Object.keys(vals);
    for (var i = 0; i < keys.length; i += 1) {
      if (String(keys[i]).toLowerCase() === f) {
        return String(vals[keys[i]] == null ? "" : vals[keys[i]]);
      }
    }
    return "";
  }

  // v3.7.0: обобщенные записи — люди первичны (совместимость), затем справочники.
  function findAnyRecord(tag, cfg) {
    var key = String(tag || "").trim().toLowerCase();
    if (!key) {
      return null;
    }
    var people = (cfg && Array.isArray(cfg.profiles)) ? cfg.profiles : [];
    var person = findProfileByTag(key, people);
    if (person) {
      return { kind: "person", person: person };
    }
    var sets = (cfg && Array.isArray(cfg.recordSets)) ? cfg.recordSets : [];
    for (var i = 0; i < sets.length; i += 1) {
      var recs = Array.isArray(sets[i].records) ? sets[i].records : [];
      for (var j = 0; j < recs.length; j += 1) {
        if (String(recs[j].tag || "").trim().toLowerCase() === key && String(recs[j].tag || "").trim()) {
          return { kind: "record", set: sets[i], record: recs[j] };
        }
      }
    }
    return null;
  }

  function isAddressableField(field, cfg) {
    if (isProfileFieldName(field, cfg)) {
      return true;
    }
    var f = String(field || "").toLowerCase();
    var sets = (cfg && Array.isArray(cfg.recordSets)) ? cfg.recordSets : [];
    for (var i = 0; i < sets.length; i += 1) {
      var fields = Array.isArray(sets[i].fields) ? sets[i].fields : [];
      for (var j = 0; j < fields.length; j += 1) {
        if (String(fields[j].name || "").toLowerCase() === f) {
          return true;
        }
      }
    }
    return false;
  }

  function getAnyRecordFieldValue(hit, field) {
    if (!hit) {
      return "";
    }
    if (hit.kind === "person") {
      return getProfileFieldValue(hit.person, field);
    }
    var f = String(field || "").toLowerCase();
    var vals = (hit.record && hit.record.values && typeof hit.record.values === "object") ? hit.record.values : {};
    if (Object.prototype.hasOwnProperty.call(vals, f)) {
      return String(vals[f] == null ? "" : vals[f]);
    }
    var keys = Object.keys(vals);
    for (var i = 0; i < keys.length; i += 1) {
      if (String(keys[i]).toLowerCase() === f) {
        return String(vals[keys[i]] == null ? "" : vals[keys[i]]);
      }
    }
    return "";
  }

  function getTemplatesByTag(tag, onlyHostMatched) {
    var key = tagKey(tag);
    if (!key) {
      return [];
    }
    return config.templates.filter(function (tpl) {
      if (tagKey(tpl.tag) !== key) {
        return false;
      }
      if (onlyHostMatched && !hostMatchesTemplate(tpl)) {
        return false;
      }
      return true;
    });
  }

  function findDuplicateTagKeys(sourceConfig) {
    var cfg = sourceConfig || config;
    var counts = {};
    (cfg.templates || []).forEach(function (tpl) {
      var key = tagKey(tpl.tag);
      if (!key) {
        return;
      }
      counts[key] = (counts[key] || 0) + 1;
    });
    var dupes = {};
    Object.keys(counts).forEach(function (key) {
      if (counts[key] > 1) {
        dupes[key] = counts[key];
      }
    });
    return dupes;
  }

  function ensureUniqueTag(base, sourceConfig) {
    var cfg = sourceConfig || config;
    var taken = {};
    (cfg.templates || []).forEach(function (tpl) {
      taken[tagKey(tpl.tag)] = true;
    });
    var clean = sanitizeTag(base) || "tag";
    if (!taken[clean]) {
      return clean;
    }
    var i = 2;
    while (taken[clean + i]) {
      i += 1;
      if (i > 999) {
        break;
      }
    }
    return clean + i;
  }

  function ensureUniqueTagInList(base, list) {
    // v3.1.1: то же, но для черновика настроек (draft), чтобы "+ Шаблон" не плодил дубли.
    var taken = {};
    (list || []).forEach(function (tpl) {
      taken[tagKey(tpl.tag)] = true;
    });
    var clean = sanitizeTag(base) || "tag";
    if (!taken[clean]) {
      return clean;
    }
    var i = 2;
    while (taken[clean + i]) {
      i += 1;
      if (i > 999) {
        break;
      }
    }
    return clean + i;
  }

  function tryTagExpand(field) {
    var before = textBeforeCaret(field);
    var pattern = new RegExp("(?:^|\\s)(" + escapeRegex(config.triggerPrefix) + "([a-zA-Zа-яА-Я0-9_-]+))$");
    var match = before.match(pattern);
    if (!match) {
      return false;
    }
    var tag = sanitizeTag(match[2]);
    if (!tag) {
      return false;
    }
    var candidates = getTemplatesByTag(tag, true);
    if (candidates.length === 0) {
      return false;
    }
    // v3.1.1 FIX: была "странная" вставка первого дубля и молчание про остальные.
    // Если на текущем сайте 2+ шаблона с одним тегом — не гадаем, открываем выбор.
    if (candidates.length > 1) {
      openTagMenu(field, tag, caretPosition(field) - match[1].length);
      return true;
    }
    startTemplateInsert(field, candidates[0], match[1].length);
    return true;
  }

  function ensureMenu() {
    if (menuHost && document.documentElement.contains(menuHost)) {
      return;
    }

    menuHost = document.createElement("div");
    menuHost.style.position = "fixed";
    menuHost.style.left = "0";
    menuHost.style.top = "0";
    menuHost.style.width = "0";
    menuHost.style.height = "0";
    menuHost.style.zIndex = "2147483647";

    var shadow = menuHost.attachShadow({ mode: "open" });
    var style = document.createElement("style");
    style.textContent = [
      "* { box-sizing: border-box; font-family: Inter, Segoe UI, system-ui, sans-serif; }",
      ".box { position: fixed; min-width: 300px; max-width: 420px; max-height: 320px; display: grid; grid-template-rows: auto 1fr auto;",
      "  border-radius: 10px; border: 1px solid #2a2f3a; background: #0f1117; color: #e5e7eb;",
      "  box-shadow: 0 18px 40px rgba(0,0,0,.45); display: none; }",
      ".box.open { display: grid; }",
        ".head { padding: 7px 10px; border-bottom: 1px solid #222734; display: flex; align-items: center; }",
      ".search { width: 100%; border: 1px solid #2d3748; border-radius: 7px; background: #111827; color: #e5e7eb; padding: 5px 8px; font-size: 12px; outline: none; }",
      ".search:focus { border-color: #4f46e5; }",
      ".list { max-height: 224px; overflow: auto; }",
      ".row { display: block; width: 100%; border: 0; background: transparent; color: #e5e7eb; text-align: left; cursor: pointer; padding: 6px 10px; }",
      ".row:hover, .row.active { background: #1c2230; }",
      ".tag { color: #8ab4ff; font-family: ui-monospace, Menlo, Consolas, monospace; }",
      ".state { float: right; color: #94a3b8; font-size: 11px; }",
      ".meta { display: block; margin-top: 2px; color: #8b93a7; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
      ".empty { padding: 12px; color: #8b93a7; font-size: 12px; }",
      ".foot { padding: 7px 10px; border-top: 1px solid #222734; display: flex; align-items: center; justify-content: flex-start; font-size: 12px; color: #94a3b8; }"
    ].join("\n");

    menuEl = document.createElement("div");
    menuEl.className = "box";
    shadow.appendChild(style);
    shadow.appendChild(menuEl);
    document.documentElement.appendChild(menuHost);
  }

  function getMenuItems(query) {
    var q = String(query || "").trim().toLowerCase();
    var dupes = findDuplicateTagKeys(config);
    var filtered = config.templates.filter(function (template) {
      if (!hostMatchesTemplate(template)) {
        return false;
      }
      if (!q) {
        return true;
      }
      return (
        String(template.tag || "").toLowerCase().indexOf(q) !== -1 ||
        String(template.name || "").toLowerCase().indexOf(q) !== -1 ||
        String(template.folder || "").toLowerCase().indexOf(q) !== -1 ||
        String(template.body || "").toLowerCase().indexOf(q) !== -1
      );
    });
    // v3.1.1: точное совпадение тега — вверх; доменные (узкие) — выше общих; дубли помечаем.
    filtered.sort(function (a, b) {
      var aTag = tagKey(a.tag);
      var bTag = tagKey(b.tag);
      var aExact = aTag === q ? 0 : 1;
      var bExact = bTag === q ? 0 : 1;
      if (aExact !== bExact) {
        return aExact - bExact;
      }
      var aStarts = aTag.indexOf(q) === 0 ? 0 : 1;
      var bStarts = bTag.indexOf(q) === 0 ? 0 : 1;
      if (q && aStarts !== bStarts) {
        return aStarts - bStarts;
      }
      var aNarrow = a.domains && a.domains.length ? 0 : 1;
      var bNarrow = b.domains && b.domains.length ? 0 : 1;
      if (aNarrow !== bNarrow) {
        return aNarrow - bNarrow;
      }
      if (aTag < bTag) {
        return -1;
      }
      if (aTag > bTag) {
        return 1;
      }
      if (String(a.name) < String(b.name)) {
        return -1;
      }
      return 1;
    });
    return filtered.map(function (template) {
      var key = tagKey(template.tag);
      return {
        kind: "template",
        template: template,
        isDuplicate: Boolean(key && dupes[key] > 1),
        dupeCount: key && dupes[key] > 1 ? dupes[key] : 0
      };
    });
  }

  function getFolderRootItems(query) {
    var q = String(query || "").trim().toLowerCase();
    var set = {};
    config.templates.forEach(function (template) {
      if (!hostMatchesTemplate(template)) {
        return;
      }
      var folder = template.folder || "Общие";
      if (q && folder.toLowerCase().indexOf(q) === -1) {
        return;
      }
      set[folder] = true;
    });
    return Object.keys(set)
      .sort()
      .map(function (folder) {
        return { kind: "folder", folder: folder };
      });
  }

  function getFolderTemplates(folder, query) {
    var q = String(query || "").trim().toLowerCase();
    var list = config.templates.filter(function (template) {
      if (!hostMatchesTemplate(template)) {
        return false;
      }
      if ((template.folder || "Общие") !== folder) {
        return false;
      }
      if (!q) {
        return true;
      }
      return (
        template.tag.toLowerCase().indexOf(q) !== -1 ||
        template.name.toLowerCase().indexOf(q) !== -1 ||
        template.body.toLowerCase().indexOf(q) !== -1
      );
    });
    var items = [{ kind: "back" }];
    list.forEach(function (template) {
      items.push({ kind: "template", template: template });
    });
    return items;
  }

  function renderMenu() {
    // v3.1.0 FIX: не теряем фокус поиска при перерендере.
    // Определяем, был ли фокус в поиске (включая Shadow DOM).
    var searchHadFocus = false;
    var searchSelStart = -1;
    var searchSelEnd = -1;
    try {
      if (menuSearchEl && menuHost && menuHost.shadowRoot) {
        searchHadFocus = menuHost.shadowRoot.activeElement === menuSearchEl;
        if (searchHadFocus) {
          searchSelStart = menuSearchEl.selectionStart;
          searchSelEnd = menuSearchEl.selectionEnd;
        }
      }
    } catch (error) {
      /* ignore */
    }
    menuEl.innerHTML = "";
    var head = document.createElement("div");
    head.className = "head";
    var searchInput = document.createElement("input");
    searchInput.className = "search";
    searchInput.placeholder = "Поиск...";
    searchInput.value = menu.query || "";
    menuSearchEl = searchInput;
    searchInput.addEventListener("input", function () {
      menu.query = searchInput.value;
      if (menu.mode === "folders") {
        menu.items = menu.folder ? getFolderTemplates(menu.folder, menu.query) : getFolderRootItems(menu.query);
      } else {
        menu.items = getMenuItems(menu.query);
      }
      menu.index = 0;
      renderMenu();
    });
    // Клик по поиску не должен закрывать меню через handleOutsideClick.
    searchInput.addEventListener("mousedown", function (event) {
      event.stopPropagation();
    });
    searchInput.addEventListener("keydown", function (event) {
      // Стрелки/Enter в поиске управляют списком, а не полем ввода.
      if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === "Tab" || event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        handleKeydown({ target: menu.field, key: event.key, preventDefault: function () {}, stopPropagation: function () {} });
      }
    });
    head.appendChild(searchInput);
    menuEl.appendChild(head);

    var listWrap = document.createElement("div");
    listWrap.className = "list";
    menuEl.appendChild(listWrap);

    if (menu.items.length === 0) {
      var empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = menu.mode === "folders" ? "Ничего не найдено" : "Шаблоны не найдены";
      listWrap.appendChild(empty);
    } else {
      menu.items.forEach(function (entry, index) {
        var row = document.createElement("button");
        row.type = "button";
        row.className = index === menu.index ? "row active" : "row";
        var meta = document.createElement("span");
        meta.className = "meta";

        if (entry.kind === "folder") {
          // v3.11.0: иконка папки.
          row.textContent = folderDisplayName(entry.folder);
          var count = config.templates.filter(function (tpl) {
            return hostMatchesTemplate(tpl) && (tpl.folder || "Общие") === entry.folder;
          }).length;
          var state = document.createElement("span");
          state.className = "state";
          var mode = getFolderMode(entry.folder);
          state.textContent = mode === "always_open" ? "Всегда открывать" : mode === "always_collapsed" ? "Всегда сворачивать" : "";
          row.appendChild(state);
          meta.textContent = count + " шаблон(ов)";
          row.appendChild(meta);
        } else if (entry.kind === "back") {
          row.textContent = "<- Назад к папкам";
        } else {
          var template = entry.template;
          var tag = document.createElement("span");
          tag.className = "tag";
          // v3.1.1: пустой тег показываем как "без тега", дубли помечаем.
          tag.textContent = template.tag ? config.triggerPrefix + template.tag : "(без тега)";
          var title = document.createTextNode("  " + template.name + (entry.isDuplicate ? "  ⚠×" + entry.dupeCount : ""));
          if (entry.isDuplicate) {
            row.style.borderLeft = "3px solid #f59e0b";
            row.title = "Одинаковый тег у " + entry.dupeCount + " шаблонов. Переименуйте в Настройках.";
          }
          // v3.10.0: показываем откуда область видимости — свои домены или папки.
          // v3.11.0: режимы папки all/only/except.
          var ownDomains = template.domains && template.domains.length ? template.domains : [];
          var effDomains = ownDomains.length ? ownDomains : effectiveFolderDomains(template, config);
          var folderMode = ownDomains.length ? "" : getFolderDomainMode(template.folder || "Общие", config);
          var domainsMeta = ownDomains.length
            ? ownDomains.join(",")
            : (effDomains.length
              ? (folderMode === "except" ? "папка, кроме: " + effDomains.join(",") : "папка: " + effDomains.join(","))
              : "all domains");
          meta.textContent = template.folder + " - " + domainsMeta + " - " + String(template.body || "").slice(0, 52);
          row.appendChild(tag);
          row.appendChild(title);
          row.appendChild(meta);
        }

        row.addEventListener("mouseenter", function () {
          // v3.1.0 FIX: не перерендериваем все меню при наведении (терялся фокус + моргание).
          // Просто обновляем active-класс.
          menu.index = index;
          var rows = listWrap.querySelectorAll(".row");
          for (var r = 0; r < rows.length; r += 1) {
            rows[r].classList.toggle("active", r === index);
          }
        });
        row.addEventListener("mousedown", function (event) {
          event.preventDefault();
        });
        row.addEventListener("click", function () {
          commitMenuSelection(index);
        });
        listWrap.appendChild(row);
      });
    }

    var footer = document.createElement("div");
    footer.className = "foot";
    var hint = document.createElement("span");
    hint.textContent = "ESC — закрыть · Ctrl+Shift+K — меню · ↑↓ — выбор";
    footer.appendChild(hint);
    menuEl.appendChild(footer);

    // Возвращаем фокус в поиск, если он там был.
    if (searchHadFocus && menuSearchEl && typeof menuSearchEl.focus === "function") {
      try {
        menuSearchEl.focus();
        if (searchSelStart >= 0) {
          menuSearchEl.setSelectionRange(searchSelStart, searchSelEnd);
        }
      } catch (error) {
        /* ignore */
      }
    }
  }

  function renderMenuActiveOnly() {
    // v3.1.0: легкое обновление подсветки для стрелок без полного перерендера.
    try {
      if (!menuEl) {
        return;
      }
      var rows = menuEl.querySelectorAll(".row");
      for (var i = 0; i < rows.length; i += 1) {
        rows[i].classList.toggle("active", i === menu.index);
      }
    } catch (error) {
      /* ignore */
    }
  }

  function positionMenu(field) {
    var rect = field.getBoundingClientRect();
    var top = rect.bottom + 8;
    if (top > window.innerHeight - 240) {
      top = Math.max(8, rect.top - 266);
    }
    menuEl.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 300)) + "px";
    menuEl.style.top = top + "px";
  }

  function openTagMenu(field, query, start) {
    ensureMenu();
    menu.open = true;
    menu.mode = "tag";
    menu.folder = "";
    menu.field = field;
    menu.start = start;
    menu.query = query || "";
    menu.items = getMenuItems(query);
    if (menu.index >= menu.items.length) {
      menu.index = 0;
    }
    renderMenu();
    positionMenu(field);
    menuEl.classList.add("open");
  }

  function openFolderMenu(field, query, start, folder) {
    ensureMenu();
    menu.open = true;
    menu.mode = "folders";
    menu.field = field;
    menu.start = start;
    menu.query = query || "";
    menu.folder = folder || "";
    if (!menu.folder) {
      var rootItems = getFolderRootItems(query);
      if (rootItems.length === 1) {
        var onlyFolder = rootItems[0].folder;
        var mode = getFolderMode(onlyFolder);
        // v3.1.0: always_open раскрываем сразу; always_collapsed всегда показываем корень.
        if (mode === "always_open") {
          openFolderMenu(field, "", start, onlyFolder);
          return;
        }
      }
      menu.items = rootItems;
    } else {
      // v3.1.0: если папка в режиме always_collapsed и пользователь пришел через //,
      // показываем шаблоны, но помним что это свернутая по умолчанию папка (бейдж уже в списке).
      menu.items = getFolderTemplates(menu.folder, query);
    }
    if (menu.index >= menu.items.length) {
      menu.index = 0;
    }
    renderMenu();
    positionMenu(field);
    menuEl.classList.add("open");
  }

  function closeMenu() {
    menu.open = false;
    menu.items = [];
    menu.index = 0;
    menu.start = -1;
    menu.field = null;
    menu.mode = "none";
    menu.folder = "";
    menu.query = "";
    menuSearchEl = null;
    if (menuEl) {
      menuEl.classList.remove("open");
    }
  }

  function commitMenuSelection(index) {
    if (!menu.open || !menu.field || menu.items.length === 0) {
      closeMenu();
      return;
    }
    var entry = menu.items[typeof index === "number" ? index : menu.index];
    if (!entry) {
      closeMenu();
      return;
    }
    if (entry.kind === "folder") {
      openFolderMenu(menu.field, "", menu.start, entry.folder);
      return;
    }
    if (entry.kind === "back") {
      openFolderMenu(menu.field, menu.query, menu.start, "");
      return;
    }
    var removeCount = menu.start >= 0 ? caretPosition(menu.field) - menu.start : 0;
    startTemplateInsert(menu.field, entry.template, removeCount);
    closeMenu();
  }

  function handleInput(event) {
    var field = event.target;
    if (!isField(field)) {
      return;
    }
    var before = textBeforeCaret(field);
    // v3.1.0 FIX: // только в начале строки или после пробела, не внутри https://
    // Старый /\/\/([a-z...]*)$/ срабатывал при вводе URL.
    var doubleMatch = before.match(/(?:^|\s)\/\/(?!\/)([a-zA-Zа-яА-Я0-9_-]*)$/);
    // Дополнительная защита от "https://": символ перед // не должен быть ":".
    if (doubleMatch) {
      var fullLen = doubleMatch[0].length;
      var charBefore = before.charAt(before.length - fullLen - 1);
      if (charBefore !== ":") {
        var prefixSpaces = doubleMatch[0].match(/^\s/) ? 1 : 0;
        openFolderMenu(field, doubleMatch[1], caretPosition(field) - doubleMatch[0].length + prefixSpaces, "");
        return;
      }
    }

    // v3.1.0 FIX: используем настраиваемый triggerPrefix, а не захардкоженный "/".
    var prefixRe = escapeRegex(config.triggerPrefix || "/");
    // Если префикс "/" — одиночный "/" не должен конфликтовать с "//" (папки уже обработаны выше).
    var singleRe = new RegExp("(?:^|\\s)(" + prefixRe + "([a-zA-Zа-яА-Я0-9_-]*))$");
    var singleMatch = before.match(singleRe);
    if (singleMatch && singleMatch[2] && singleMatch[2].length >= 1) {
      // Для префикса "/" пропускаем случай "//xxx" (это папки).
      if (!((config.triggerPrefix || "/") === "/" && singleMatch[1].indexOf("//") === 0)) {
        openTagMenu(field, singleMatch[2], caretPosition(field) - singleMatch[1].length);
        return;
      }
    }

    closeMenu();
  }

  function handleKeydown(event) {
    var field = event.target;

    if (menu.open) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        menu.index = menu.items.length ? (menu.index + 1) % menu.items.length : 0;
        renderMenuActiveOnly();
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        menu.index = menu.items.length ? (menu.index - 1 + menu.items.length) % menu.items.length : 0;
        renderMenuActiveOnly();
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        commitMenuSelection();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu();
        return;
      }
    }

    if (previewState && event.key === "Escape") {
      closePreview();
      return;
    }

    if (!isField(field)) {
      return;
    }

    if (event.key === " " || event.key === "Tab" || event.key === "Enter") {
      if (tryTagExpand(field)) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
  }

  function handleOutsideClick(event) {
    var path = typeof event.composedPath === "function" ? event.composedPath() : [];
    if (menu.open && menuEl && menuHost && path.indexOf(menuEl) === -1 && path.indexOf(menuHost) === -1) {
      closeMenu();
    }
    if (previewState && previewEl && previewHost && path.indexOf(previewEl) === -1 && path.indexOf(previewHost) === -1) {
      closePreview();
    }
  }

  function renderSettingsPage() {
    // v3.2.0: делаем из вкладки "чистый лист": вырезаем ВСЕ хост-стили/шрифты/классы,
    // чтобы generic-классы настроек (.layout/.nav/.btn...) не перебивались сайтом.
    try {
      document.title = "TextEnter - Настройки";
    } catch (error) { /* ignore */ }
    try {
      if (document.documentElement) {
        document.documentElement.removeAttribute("class");
        document.documentElement.removeAttribute("style");
        document.documentElement.style.background = "#0a0c10";
      }
      if (document.head) {
        var hostStyles = document.head.querySelectorAll('style, link[rel="stylesheet"], link[rel*="icon"]');
        for (var hs = 0; hs < hostStyles.length; hs += 1) {
          if (hostStyles[hs] && hostStyles[hs].parentNode) {
            hostStyles[hs].parentNode.removeChild(hostStyles[hs]);
          }
        }
        if (!document.head.querySelector('meta[name="viewport"]')) {
          var vp = document.createElement("meta");
          vp.setAttribute("name", "viewport");
          vp.setAttribute("content", "width=device-width, initial-scale=1");
          document.head.appendChild(vp);
        }
      }
      if (!document.body) {
        var freshBody = document.createElement("body");
        document.documentElement.appendChild(freshBody);
      }
      document.body.removeAttribute("class");
      document.body.removeAttribute("style");
      document.body.style.margin = "0";
      document.body.style.background = "#0a0c10";
      document.body.innerHTML = "";
    } catch (error) {
      try {
        document.documentElement.innerHTML = "<head><title>TextEnter - Настройки</title></head><body></body>";
      } catch (e) { /* ignore */ }
    }

    var root = document.createElement("div");
    root.id = "textenter-settings";
    root.style.minHeight = "100vh";
    root.style.background = "#0a0c10";
    root.style.color = "#e5e7eb";
    root.style.fontFamily = "Inter, Segoe UI, system-ui, sans-serif";
    root.style.padding = "20px";
    document.body.appendChild(root);
    // v3.3.0: изолируем всё в Shadow DOM — ни хост-CSS внутрь, ни наш CSS наружу.
    var settingsShadow = null;
    var settingsRoot = root;
    try {
      if (root.attachShadow) {
        settingsShadow = root.attachShadow({ mode: "open" });
        settingsRoot = document.createElement("div");
        settingsRoot.id = "textenter-settings-inner";
        settingsShadow.appendChild(settingsRoot);
      }
    } catch (error) {
      settingsShadow = null;
      settingsRoot = root;
    }
    root = settingsRoot;
    // v3.2.0: drag-n-drop JSON anywhere + хоткеи (см. ниже).
    attachSettingsDrop(root);

    function settingsActiveElement() {
      // v3.3.0: фокус может жить внутри Shadow DOM — document.activeElement вернет хост.
      try {
        if (settingsShadow && settingsShadow.activeElement) {
          return settingsShadow.activeElement;
        }
      } catch (error) {
        /* ignore */
      }
      return document.activeElement;
    }

    var activeTab = "templates";
    var templateSearch = "";
    var templateFolderFilter = "";
    var selectedIds = {};
    var collapsedFolders = {};
    var draggedTemplateId = null;
    // v3.10.0: какая папка открыта в окне настроек (модалка).
    var folderSettingsFor = null;
    var draft = normalize(JSON.parse(JSON.stringify(config)));
    var selectedTemplateId = draft.templates[0] ? draft.templates[0].id : "";
    var selectedVariableId = draft.customVariables[0] ? draft.customVariables[0].id : "";
    // v3.9.0: единая База данных — выбранная категория и запись в ней.
    var dbCat = "people";
    var dbRecId = "";
    var dbRenamingCat = null;

    function folderListFrom(source) {
      var set = { "Общие": true };
      (source.folders || []).forEach(function (item) {
        if (item) {
          set[item] = true;
        }
      });
      (source.templates || []).forEach(function (tpl) {
        if (tpl.folder) {
          set[tpl.folder] = true;
        }
      });
      // v3.10.0: папки, у которых заданы только домены, тоже существуют.
      var fd = (source.folderDomains && typeof source.folderDomains === "object") ? source.folderDomains : {};
      Object.keys(fd).forEach(function (k) {
        if (String(k || "").trim()) {
          set[String(k).trim()] = true;
        }
      });
      return Object.keys(set).sort();
    }

    function selectedTemplate() {
      for (var i = 0; i < draft.templates.length; i += 1) {
        if (draft.templates[i].id === selectedTemplateId) {
          return draft.templates[i];
        }
      }
      return null;
    }

    function selectedVariable() {
      for (var i = 0; i < draft.customVariables.length; i += 1) {
        if (draft.customVariables[i].id === selectedVariableId) {
          return draft.customVariables[i];
        }
      }
      return null;
    }

    function persistDraftToConfig() {
      backupCurrentConfig();
      config = normalize(JSON.parse(JSON.stringify(draft)));
      saveConfig();
      draft = normalize(JSON.parse(JSON.stringify(config)));
    }

    // ---------- v3.2.0: бэкапы, файл-импорт, шаринг, валидация ----------
    // v3.12.0: readBackupIndex/writeBackupIndex/backupCurrentConfig/listBackups
    // вынесены на верхний уровень IIFE — их использует и меню-импорт, и эта страница.

    function restoreBackup(stamp) {
      try {
        var raw = safeGet(BACKUP_KEY_PREFIX + stamp, "");
        if (!raw) {
          window.alert("Бэкап не найден");
          return;
        }
        backupCurrentConfig();
        draft = normalize(JSON.parse(raw));
        selectedTemplateId = draft.templates[0] ? draft.templates[0].id : "";
        selectedVariableId = draft.customVariables[0] ? draft.customVariables[0].id : "";
        dbCat = "people";
        dbRecId = "";
        dbRenamingCat = null;
        window.alert("Бэкап " + stamp + " загружен в черновик. Нажмите Сохранить, чтобы применить.");
        renderLayout();
      } catch (error) {
        window.alert("Не удалось восстановить бэкап: " + error);
      }
    }

    function importToDraftRaw(raw) {
      if (!raw) {
        return;
      }
      try {
        draft = normalize(JSON.parse(raw));
        selectedTemplateId = draft.templates[0] ? draft.templates[0].id : "";
        selectedVariableId = draft.customVariables[0] ? draft.customVariables[0].id : "";
        dbCat = "people";
        dbRecId = "";
        dbRenamingCat = null;
        selectedIds = {};
        window.alert("JSON загружен в черновик. Нажмите Сохранить, чтобы применить.");
        renderLayout();
      } catch (error) {
        window.alert("Неверный JSON: " + error);
      }
    }

    function importFileViaInput() {
      var input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,application/json";
      input.addEventListener("change", function () {
        if (!input.files || !input.files[0]) {
          return;
        }
        var reader = new FileReader();
        reader.onload = function () {
          importToDraftRaw(String(reader.result || ""));
        };
        reader.readAsText(input.files[0]);
      });
      input.click();
    }

    function attachSettingsDrop(rootEl) {
      try {
        rootEl.addEventListener("dragover", function (event) {
          if (event.dataTransfer && event.dataTransfer.types && event.dataTransfer.types.indexOf("Files") !== -1) {
            event.preventDefault();
            rootEl.style.outline = "2px dashed #4f46e5";
          }
        });
        rootEl.addEventListener("dragleave", function () {
          rootEl.style.outline = "";
        });
        rootEl.addEventListener("drop", function (event) {
          rootEl.style.outline = "";
          if (!event.dataTransfer || !event.dataTransfer.files || !event.dataTransfer.files[0]) {
            return;
          }
          var file = event.dataTransfer.files[0];
          if (file.name && !/\.json$/i.test(file.name)) {
            return;
          }
          event.preventDefault();
          var reader = new FileReader();
          reader.onload = function () {
            importToDraftRaw(String(reader.result || ""));
          };
          reader.readAsText(file);
        });
      } catch (error) {
        /* ignore */
      }
    }

    function base64UrlEncode(text) {
      return btoa(unescape(encodeURIComponent(text))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }

    function base64UrlDecode(data) {
      var s = String(data || "").replace(/-/g, "+").replace(/_/g, "/");
      while (s.length % 4) {
        s += "=";
      }
      return decodeURIComponent(escape(atob(s)));
    }

    function exportShareLink() {
      var picked = draft.templates.filter(function (t) {
        return selectedIds[t.id];
      });
      var payload = picked.length > 0 ? picked : draft.templates;
      try {
        var code = base64UrlEncode(JSON.stringify(payload));
        var link = window.location.origin + window.location.pathname + "#textenter=" + code;
        copyTextToClipboard(link, "Скопируйте ссылку на шаблоны");
        window.alert("Ссылка на " + payload.length + " шаблон(ов) скопирована. Получатель: Настройки → Импорт JSON → вставить ссылку.");
      } catch (error) {
        window.alert("Не удалось создать ссылку: " + error);
      }
    }

    function importFromMaybeLink(raw) {
      var text = String(raw || "").trim();
      if (!text) {
        return;
      }
      // v0.1: новый префикс #textenter=; старые ссылки #formix= тоже принимаем.
      var hashPos = text.indexOf("#textenter=");
      var prefixLen = 11; // длина "#textenter="
      if (hashPos === -1) {
        hashPos = text.indexOf("#formix=");
        prefixLen = 8; // длина "#formix="
      }
      try {
        if (hashPos !== -1) {
          var items = JSON.parse(base64UrlDecode(text.slice(hashPos + prefixLen)));
          if (!Array.isArray(items)) {
            throw new Error("bad share payload");
          }
          var taken = {};
          draft.templates.forEach(function (t) {
            taken[tagKey(t.tag)] = true;
          });
          var added = 0;
          items.forEach(function (item) {
            var clean = normalize({ templates: [item], folders: [], folderPreferences: [], customVariables: [] }).templates[0];
            if (!clean) {
              return;
            }
            clean.id = "tpl-" + Date.now() + "-" + added;
            if (clean.tag && taken[tagKey(clean.tag)]) {
              var i = 2;
              while (taken[tagKey(clean.tag) + i]) {
                i += 1;
              }
              clean.tag = tagKey(clean.tag) + i;
            }
            if (clean.tag) {
              taken[tagKey(clean.tag)] = true;
            }
            draft.templates.unshift(clean);
            added += 1;
          });
          selectedTemplateId = draft.templates[0] ? draft.templates[0].id : "";
          window.alert("Импортировано шаблонов: " + added + ". Нажмите Сохранить.");
          renderLayout();
          return;
        }
        importToDraftRaw(text);
      } catch (error) {
        window.alert("Неверная ссылка или JSON: " + error);
      }
    }

    function analyzeTokenKind(token) {
      var t = String(token || "").trim();
      if (!t) {
        return { kind: "empty" };
      }
      if (parseIndexedDateToken(t) || parseIndexedTimeToken(t) || parseLabeledTodayToken(t)) {
        return { kind: "datetime" };
      }
      // v3.8.0: выбор {{поле:#}}.
      var choiceTok = parseChoiceToken(t);
      if (choiceTok) {
        if (collectChoiceOptions(choiceTok.field, draft).length) {
          return { kind: "choice" };
        }
        return { kind: "unknown-choice", field: choiceTok.field };
      }
      // v3.6.0: адресные поля {{поле:тег}}.
      var profTok = parseProfileTagToken(t);
      if (profTok && isAddressableField(profTok.field, draft)) {
        if (findAnyRecord(profTok.tag, draft)) {
          return { kind: "profile" };
        }
        return { kind: "unknown-person", tag: profTok.tag };
      }
      if (t.indexOf(":") !== -1) {
        var fn = t.slice(0, t.indexOf(":")).trim().toLowerCase();
        if (fn === "date" || fn === "pick" || fn === "upper" || fn === "lower" || fn === "calc" || fn === "math") {
          return { kind: "func", fn: fn, arg: t.slice(t.indexOf(":") + 1) };
        }
        return { kind: "unknown-func" };
      }
      if (Object.prototype.hasOwnProperty.call({
          name: 1, surname: 1, fullname: 1, email: 1, phone: 1, company: 1, position: 1,
          timetoday: 1, datetoday: 1
        }, t)) {
        return { kind: "builtin" };
      }
      var labeled = parseLabeledCustomToken(t);
      var varName = labeled ? labeled.name : t;
      for (var i = 0; i < draft.customVariables.length; i += 1) {
        if (draft.customVariables[i].name === varName) {
          return { kind: "custom", name: varName };
        }
      }
      // v3.6.0 fallback: свое поле без тега {{telegram}}.
      // v3.9.0: владелец поля определяет категорию (люди/справочник).
      // Обычная переменная шаблона — в приоритете (проверена выше).
      if (t.indexOf(":") === -1 && t.indexOf("(") === -1) {
        if (getFieldOwnerCategory(t, draft)) {
          return { kind: "profile" };
        }
      }
      // v3.10.0: глобальный свободный ввод {{text}} (своя переменная text — в приоритете, проверена выше).
      if (parseTextToken(t)) {
        return { kind: "textinput" };
      }
      return { kind: "unknown-var" };
    }

    function validateDraft(source) {
      var issues = [];
      var tagCounts = {};
      (source.templates || []).forEach(function (tpl) {
        var k = tagKey(tpl.tag);
        if (k) {
          tagCounts[k] = (tagCounts[k] || 0) + 1;
        }
      });
      (source.templates || []).forEach(function (tpl) {
        if (!String(tpl.body || "").trim()) {
          issues.push({ tplId: tpl.id, tplName: tpl.name, type: "empty", msg: "Пустое тело шаблона" });
        }
        var key = tagKey(tpl.tag);
        if (key && tagCounts[key] > 1) {
          issues.push({ tplId: tpl.id, tplName: tpl.name, type: "dup", msg: "Дубль тега «" + tpl.tag + "»" });
        } else if (key && !isTagUsable(tpl.tag)) {
          issues.push({ tplId: tpl.id, tplName: tpl.name, type: "short", msg: "Короткий тег «" + tpl.tag + "»" });
        }
        var re = /\{\{\s*([^{}]+?)\s*\}\}/g;
        var m;
        var seenUnknown = {};
        while ((m = re.exec(String(tpl.body || "")))) {
          var kind = analyzeTokenKind(m[1]);
          if (kind.kind === "unknown-var" && !seenUnknown[m[1]]) {
            seenUnknown[m[1]] = true;
            issues.push({ tplId: tpl.id, tplName: tpl.name, type: "unknown", msg: "Неизвестная переменная {{" + m[1].trim() + "}}" });
          } else if (kind.kind === "unknown-func" && !seenUnknown[m[1]]) {
            seenUnknown[m[1]] = true;
            issues.push({ tplId: tpl.id, tplName: tpl.name, type: "unknown", msg: "Неизвестная функция {{" + m[1].trim() + "}}" });
          } else if (kind.kind === "unknown-person" && !seenUnknown[m[1]]) {
            seenUnknown[m[1]] = true;
            issues.push({ tplId: tpl.id, tplName: tpl.name, type: "unknown", msg: "Нет человека с тегом «" + kind.tag + "» — проверьте {{поле:тег}}" });
          } else if (kind.kind === "unknown-choice" && !seenUnknown[m[1]]) {
            seenUnknown[m[1]] = true;
            issues.push({ tplId: tpl.id, tplName: tpl.name, type: "unknown", msg: "Не из чего выбирать {{" + kind.field + ":#}} — нет значений ни у людей, ни в справочниках" });
          }
        }
        // Пробный рендер: ловим [math-error] / [var-loop].
        var backup = config;
        try {
          config = source;
          var out = renderText(String(tpl.body || ""), null);
          if (out.indexOf("[math-error]") !== -1) {
            issues.push({ tplId: tpl.id, tplName: tpl.name, type: "math", msg: "Ошибка в {{calc:}} — проверьте формулу" });
          }
          if (out.indexOf("[var-loop]") !== -1) {
            issues.push({ tplId: tpl.id, tplName: tpl.name, type: "loop", msg: "Зацикленные переменные [var-loop]" });
          }
        } catch (error) {
          /* ignore */
        }
        config = backup;
      });
      return issues;
    }

    function importToDraft() {
      var raw = window.prompt("Вставьте JSON-конфиг или ссылку #textenter=...", "");
      importFromMaybeLink(raw);
    }

    function exportDraft() {
      // v3.1.0: clipboard + файл вместо обрезающего prompt.
      var text = JSON.stringify(draft, null, 2);
      copyTextToClipboard(text, "Скопируйте JSON-конфиг TextEnter");
      downloadJsonFile("textenter-config.json", text);
      window.alert("Черновик скопирован в буфер обмена и скачан как файл textenter-config.json");
    }

    function renderLayout(restoreSearch) {
      var prevSearchFocus = false;
      var prevSearchPos = -1;
      try {
        var activeEl = settingsActiveElement();
        if (activeEl && activeEl.classList && activeEl.classList.contains("field") && activeEl.placeholder === "Поиск шаблона") {
          prevSearchFocus = true;
          prevSearchPos = activeEl.selectionStart;
        }
      } catch (error) { /* ignore */ }
      if (restoreSearch && restoreSearch.focusSearch) {
        prevSearchFocus = true;
        prevSearchPos = restoreSearch.caret;
      }
      root.innerHTML = "";

      var style = document.createElement("style");
      style.textContent = [
        // v3.1.2 FIX: страница настроек рендерится внутри чужого сайта,
        // generic-классы (.layout/.nav/.head/.btn/...) конфликтовали с CSS хоста —
        // отсюда "перекос" левого меню на скрине. Скоупим всё под #textenter-settings
        // (ID = выше специфичность, чем у хоста) + сброс для поддерева.
        "#textenter-settings-inner{box-sizing:border-box}",
        "*,*::before,*::after{box-sizing:border-box}",
        "h1,h2,h3,p{margin:0}",
        ".shell{max-width:1360px;margin:0 auto}",
        ".head{display:flex !important;justify-content:space-between !important;gap:12px;align-items:flex-end !important;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid #1d2432;background:transparent !important;float:none !important;position:static !important;width:auto !important}",
        ".head p{margin-top:6px;color:#94a3b8;font-size:13px;line-height:1.55;max-width:900px}",
        ".actions{display:flex;gap:8px;flex-wrap:wrap}",
        ".btn{border:1px solid #263041;background:#141b27;color:#dbeafe;border-radius:10px;padding:8px 11px;font-size:12px;cursor:pointer;width:auto !important;float:none !important}",
        ".btn:hover{border-color:#4f46e5}",
        ".btn.primary{background:#4f46e5;border-color:#4f46e5;color:#fff}",
        ".btn.danger{border-color:#7f1d1d;color:#fecaca}",
        ".layout{display:grid !important;gap:14px;grid-template-columns:240px minmax(0,1fr) !important}",
        ".nav{border:1px solid #1d2432;background:#0f131b;border-radius:12px;padding:10px;display:grid !important;gap:6px;height:fit-content;position:sticky;top:10px;min-width:0;width:100% !important;float:none !important;margin:0 !important}",
        ".nav-btn{display:block;width:100% !important;min-width:0;text-align:left;border:1px solid #263041;background:#111827;color:#cbd5e1;border-radius:9px;padding:9px 10px;font-size:13px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;float:none !important;margin:0 !important}",
        ".nav-btn.active{border-color:#4f46e5;background:#182038;color:#fff}",
        ".content{border:1px solid #1d2432;background:#0f131b;border-radius:12px;padding:14px;min-width:0}",
        ".section-title{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8;margin-bottom:10px}",
        ".muted{color:#94a3b8;font-size:12px;line-height:1.6}",
        ".field{display:block;width:100% !important;border:1px solid #263041;background:#111827;color:#e5e7eb;border-radius:9px;padding:9px 10px;font-size:13px;outline:none;float:none !important;margin:0 !important;box-shadow:none !important;height:auto !important}",
        ".field:focus{border-color:#4f46e5}",
        ".list{border:1px solid #263041;border-radius:10px;max-height:460px;overflow:auto}",
        ".row{display:block;width:100% !important;text-align:left;border:0;background:transparent;color:#e5e7eb;padding:8px 10px;cursor:pointer;float:none !important}",
        ".row:hover,.row.active{background:#1b2435}",
        ".row small{display:block;color:#94a3b8;font-size:11px;margin-top:2px}",
        ".folder-head{display:flex;align-items:center;gap:8px;width:100%;text-align:left;border:1px solid #263041;background:#131a29;color:#e5e7eb;border-radius:9px;padding:7px 10px;margin:8px 0 4px;font-size:12px;font-weight:600;cursor:pointer}",
        ".folder-head:hover{border-color:#4f46e5}",
        ".folder-head .chev{color:#8ab4ff;width:14px}",
        ".folder-head .cnt{margin-left:auto;color:#94a3b8;font-weight:400;font-size:11px}",
        ".droptarget{outline:2px dashed #4f46e5 !important;outline-offset:-2px}",
        ".split{display:grid;gap:12px;grid-template-columns:320px minmax(0,1fr)}",
        ".line2{display:grid;gap:8px;grid-template-columns:1fr 1fr}",
        ".line3{display:grid;gap:8px;grid-template-columns:1fr auto auto}",
        ".panel{border:1px solid #263041;border-radius:10px;padding:10px;background:#0d1320;min-width:0}",
        ".token-bar{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}",
        ".token-btn{border:1px solid #334155;background:#0f172a;color:#dbeafe;border-radius:8px;padding:3px 7px;font-size:12px;cursor:pointer}",
        ".token-btn:hover{border-color:#4f46e5}",
        ".preview-box{border:1px solid #334155;border-radius:10px;background:#0b1220;padding:10px;margin-top:8px}",
        ".preview-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}",
        ".preview-title{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8}",
        ".preview-text{white-space:pre-wrap;min-height:56px;color:#e2e8f0;font-size:13px;line-height:1.55}",
        ".help{border:1px solid #334155;background:#0b1220;border-radius:10px;padding:10px;margin-bottom:10px}",
        "code{background:#111827;border:1px solid #263041;padding:1px 5px;border-radius:6px;color:#c7d2fe}",
        "pre{white-space:pre-wrap;background:#0b1220;border:1px solid #263041;border-radius:10px;padding:10px;color:#cbd5e1;font-size:12px;line-height:1.55}",
        "@media (max-width:900px){.layout{grid-template-columns:1fr !important}.nav{position:static !important}.split{grid-template-columns:1fr !important}.line2{grid-template-columns:1fr !important}}",
        // v3.2.0: баннер проблем, разбор токенов, автокомплит, bulk-панель, бэкапы.
        ".issues{border:1px solid #7c2d12;background:#1c1005;border-radius:10px;padding:10px;margin-bottom:10px}",
        ".issues button{background:none;border:0;color:#fdba74;font-size:12px;cursor:pointer;text-align:left;display:block;padding:2px 0}",
        ".issues button:hover{text-decoration:underline}",
        ".tokparse{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}",
        ".tok{display:inline-block;border-radius:7px;padding:2px 8px;font-size:11px;border:1px solid #334155;background:#0f172a;color:#dbeafe;font-family:ui-monospace,Menlo,Consolas,monospace}",
        ".tok.date{border-color:#4f46e5;color:#c7d2fe}",
        ".tok.time{border-color:#0e7490;color:#a5f3fc}",
        ".tok.custom{border-color:#b45309;color:#fcd34d}",
        ".tok.func{border-color:#7e22ce;color:#e9d5ff}",
        ".tok.today{border-color:#475569;color:#94a3b8}",
        ".tok.builtin{border-color:#166534;color:#bbf7d0}",
        ".tok.bad{border-color:#ef4444;color:#fca5a5}",
        ".suggest{position:absolute;z-index:50;min-width:260px;max-width:360px;max-height:240px;overflow:auto;border:1px solid #4f46e5;border-radius:10px;background:#0f131b;box-shadow:0 18px 40px rgba(0,0,0,.5);padding:4px}",
        ".suggest button{display:block;width:100%;text-align:left;border:0;background:transparent;color:#e5e7eb;padding:7px 9px;border-radius:7px;cursor:pointer;font-size:12px;font-family:ui-monospace,Menlo,Consolas,monospace}",
        ".suggest button.active,.suggest button:hover{background:#1b2435}",
        ".suggest button small{display:block;color:#94a3b8;font-size:11px;font-family:Inter,Segoe UI,system-ui,sans-serif}",
        ".bulkbar{border:1px solid #4f46e5;background:#141a2e;border-radius:10px;padding:8px;margin-top:8px;display:grid;gap:8px}",
        ".checkrow{display:flex;gap:8px;align-items:flex-start}",
        ".checkrow input[type=checkbox]{margin-top:3px}",
        ".backup{border:1px solid #263041;border-radius:10px;padding:8px 10px;margin-top:8px;display:flex;justify-content:space-between;gap:8px;align-items:center}",
        "select.field{appearance:auto}"
      ].join("\n");
      root.appendChild(style);

      var shell = document.createElement("div");
      shell.className = "shell";
      root.appendChild(shell);

      var head = document.createElement("div");
      head.className = "head";
      head.innerHTML =
        "<div><h1>TextEnter - Настройки расширения</h1>" +
        "<p>Все изменения работают как черновик и применяются только после кнопки Сохранить.</p></div>";

      var headerActions = document.createElement("div");
      headerActions.className = "actions";

      var saveBtn = document.createElement("button");
      saveBtn.className = "btn primary";
      saveBtn.textContent = "Сохранить (Ctrl+S)";
      saveBtn.title = "Сохранить черновик. Текущий конфиг уйдет в бэкап.";
      saveBtn.addEventListener("click", function () {
        persistDraftToConfig();
        window.alert("Изменения сохранены, предыдущая версия — в бэкапах (База данных)");
        renderLayout();
      });

      var exportBtn = document.createElement("button");
      exportBtn.className = "btn";
      exportBtn.textContent = "Экспорт JSON";
      exportBtn.addEventListener("click", exportDraft);

      var importBtn = document.createElement("button");
      importBtn.className = "btn";
      importBtn.textContent = "Импорт JSON/ссылка";
      importBtn.title = "Вставьте JSON или ссылку #textenter=...";
      importBtn.addEventListener("click", importToDraft);

      var fileBtn = document.createElement("button");
      fileBtn.className = "btn";
      fileBtn.textContent = "Файл →";
      fileBtn.title = "Загрузить .json из файла (или перетащите файл на страницу)";
      fileBtn.addEventListener("click", importFileViaInput);

      var shareBtn = document.createElement("button");
      shareBtn.className = "btn";
      shareBtn.textContent = "🔗 Поделиться";
      shareBtn.title = "Ссылка на выбранные шаблоны (или все, если ничего не выбрано)";
      shareBtn.addEventListener("click", exportShareLink);

      var resetBtn = document.createElement("button");
      resetBtn.className = "btn danger";
      resetBtn.textContent = "Отменить несохраненное";
      resetBtn.addEventListener("click", function () {
        draft = normalize(JSON.parse(JSON.stringify(config)));
        selectedTemplateId = draft.templates[0] ? draft.templates[0].id : "";
        selectedVariableId = draft.customVariables[0] ? draft.customVariables[0].id : "";
        dbCat = "people";
        dbRecId = "";
        dbRenamingCat = null;
        selectedIds = {};
        renderLayout();
      });

      headerActions.appendChild(saveBtn);
      headerActions.appendChild(exportBtn);
      headerActions.appendChild(importBtn);
      headerActions.appendChild(fileBtn);
      headerActions.appendChild(shareBtn);
      headerActions.appendChild(resetBtn);
      head.appendChild(headerActions);
      shell.appendChild(head);

      var layout = document.createElement("div");
      layout.className = "layout";
      shell.appendChild(layout);

      var nav = document.createElement("div");
      nav.className = "nav";
      // v3.3.0: счетчики на вкладках. v3.4.0: вкладки Папки больше нет — папки живут в дереве Шаблонов.
      var navCounts = {
        templates: draft.templates.length,
        variables: draft.customVariables.length,
        general: (draft.profiles.length || 0) + draft.recordSets.reduce(function (n, s) {
          return n + ((s.records || []).length);
        }, 0)
      };
      [
        { id: "templates", label: "Шаблоны" },
        { id: "variables", label: "Переменные" },
        { id: "general", label: "База данных" }
      ].forEach(function (tab) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = activeTab === tab.id ? "nav-btn active" : "nav-btn";
        btn.textContent = tab.label + " (" + (navCounts[tab.id] || 0) + ")";
        btn.addEventListener("click", function () {
          activeTab = tab.id;
          renderLayout();
        });
        nav.appendChild(btn);
      });
      layout.appendChild(nav);

      var content = document.createElement("div");
      content.className = "content";
      layout.appendChild(content);

      if (activeTab === "templates") {
        renderTemplatesTab(content);
      } else if (activeTab === "variables") {
        renderVariablesTab(content);
      } else {
        // v3.8.0: вкладки Общие и Справочники слиты — люди, поля, справочники, прочее и бэкапы в одном месте.
        renderGeneralTab(content);
      }

      // v3.1.0 FIX: возвращаем фокус в поиск шаблонов после перерендера.
      if (prevSearchFocus) {
        try {
          var searchField = root.querySelector('input[placeholder="Поиск шаблона"]');
          if (searchField) {
            searchField.focus();
            if (prevSearchPos >= 0 && typeof prevSearchPos === "number") {
              var pos = Math.min(prevSearchPos, searchField.value.length);
              // caret, переданный через restoreSearch, уже после обновления templateSearch
              if (restoreSearch && typeof restoreSearch.caret === "number") {
                pos = Math.min(restoreSearch.caret, searchField.value.length);
              }
              searchField.setSelectionRange(pos, pos);
            }
          }
        } catch (error) { /* ignore */ }
      }
    }

    function renderTemplatesTab(target) {
      var variablesGuide =
        "<b>Стандартные переменные:</b><br>" +
        "<code>{{name}}</code> - имя человека.<br>" +
        "<code>{{surname}}</code> - фамилия человека.<br>" +
        "<code>{{fullname}}</code> - имя + фамилия.<br>" +
        "<code>{{company}}</code> - компания человека.<br>" +
        "<code>{{email}}</code> - email человека.<br>" +
        "<code>{{phone}}</code> - телефон человека.<br>" +
        "<code>{{position}}</code> - должность человека.<br>" +
        "<code>{{name:тег}}</code> - поле конкретного человека по тегу (например {{name:david}}). Без тега — активный.<br>" +
        "<code>{{поле:тег}}</code> - поле записи: {{telegram:david}} — у конкретного; {{telegram}} без тега — у активной записи категории-владельца (люди — активный человек).<br>" +
        "<code>{{поле:тег}}</code> - также записи справочников (вкладка Справочники): {{телефон:acme}}. Человек с тем же тегом первичнее.<br>" +
        "<code>{{поле:#}}</code> - выбор при вставке: {{name:#}} покажет все имена (люди + справочники), {{telegram:#}} — все telegram.<br>" +
        "Выборка строго по имени поля: телефоны людей — {{phone:#}}, поле справочника «телефон» — {{телефон:#}}.<br>" +
        "<code>{{поле:#группа}}</code> - СВЯЗАННАЯ выборка (выборочно): {{name:#кл}} + {{phone:#кл}} — выбрал запись один раз, остальные поля подтянулись сами.<br>" +
        "<code>{{date}}</code> - дата №1 (один выбор для всех {{date}} / {{date+N}}).<br>" +
        "<code>{{date+N}}</code> / <code>{{date-N}}</code> - сдвиг в днях от даты №1.<br>" +
        "<code>{{date2}}</code> / <code>{{date2+N}}</code> - НЕЗАВИСИМАЯ дата №2 (свой выбор). Так же date3..date9.<br>" +
        "<code>{{date(\"Подпись\")}}</code> / <code>{{date+7(\"Подпись\")}}</code> - дата с подписью: в окне вставки вместо тега видно «Подпись», повтор той же подписи считает от той же даты.<br>" +
        "<code>{{datetoday}}</code> - всегда сегодняшняя дата (не спрашивает).<br>" +
        "<code>{{datetoday+N}}</code> / <code>{{datetoday-N}}</code> - сдвиг от сегодняшней даты.<br>" +
        "<code>{{time}}</code> - время №1 (один выбор для всех {{time*}}).<br>" +
        "<code>{{time+N}}</code> / <code>{{time-N}}</code> - сдвиг в часах от времени №1.<br>" +
        "<code>{{time2}}</code> / <code>{{time2+N}}</code> - НЕЗАВИСИМОЕ время №2. Так же time3..time9.<br>" +
        "<code>{{time(\"Подпись\")}}</code> - время с подписью, заполняется прямо в тексте.<br>" +
        "<code>{{var(\"Подсказка\")}}</code> - своя переменная с подписью: в окне вставки видно «Подсказка».<br>" +
        "<code>{{timetoday}}</code> - всегда текущее время (не спрашивает).<br>" +
        "<code>{{timetoday+N}}</code> / <code>{{timetoday-N}}</code> - сдвиг от текущего времени.<br>" +
        "<code>{{text}}</code> / {{text2}} / {{text(\"Подпись\")}} - свободный ввод с клавиатуры при вставке (обязательный).<br>" +
        "<code>{{pick:a|b|c}}</code> - случайный вариант.<br>" +
        "<code>{{upper:text}}</code> - верхний регистр.<br>" +
        "<code>{{lower:TEXT}}</code> - нижний регистр.<br>" +
        "<code>{{calc:expr}}</code> - математика (+ - * / % скобки).";

      target.innerHTML = '<div class="section-title">Шаблоны</div>';

      // v3.2.0: баннер валидации — клик по проблеме открывает шаблон.
      var allIssues = validateDraft(draft);
      if (allIssues.length > 0) {
        var issuesBox = document.createElement("div");
        issuesBox.className = "issues";
        var issuesTitle = document.createElement("div");
        issuesTitle.className = "muted";
        issuesTitle.style.marginBottom = "6px";
        issuesTitle.textContent = "⚠ Проблем в черновике: " + allIssues.length + " (сохранение разрешено, но проверьте)";
        issuesBox.appendChild(issuesTitle);
        allIssues.slice(0, 12).forEach(function (issue) {
          var b = document.createElement("button");
          b.type = "button";
          b.textContent = "• " + issue.tplName + ": " + issue.msg;
          b.addEventListener("click", function () {
            selectedTemplateId = issue.tplId;
            renderLayout();
          });
          issuesBox.appendChild(b);
        });
        if (allIssues.length > 12) {
          var more = document.createElement("div");
          more.className = "muted";
          more.textContent = "…и еще " + (allIssues.length - 12);
          issuesBox.appendChild(more);
        }
        target.appendChild(issuesBox);
      }

      var split = document.createElement("div");
      split.className = "split";
      target.appendChild(split);

      var listPanel = document.createElement("div");
      listPanel.className = "panel";
      split.appendChild(listPanel);

      var listActions = document.createElement("div");
      listActions.className = "actions";
      listActions.style.marginBottom = "8px";

      var addBtn = document.createElement("button");
      addBtn.className = "btn";
      addBtn.textContent = "+ Шаблон";
      addBtn.addEventListener("click", function () {
        var next = {
          id: "tpl-" + Date.now(),
          name: "Новый шаблон",
          // v3.1.1: tag+N по длине плодил дубли после удалений. Генерим реально уникальный.
          tag: ensureUniqueTagInList("tag" + (draft.templates.length + 1), draft.templates),
          folder: "Общие",
          domains: [],
          body: "Текст шаблона",
          images: [],
          previewBeforeInsert: false
        };
        draft.templates.unshift(next);
        selectedTemplateId = next.id;
        renderLayout();
      });

      var dupBtn = document.createElement("button");
      dupBtn.className = "btn";
      dupBtn.textContent = "Дублировать";
      dupBtn.addEventListener("click", function () {
        var current = selectedTemplate();
        if (!current) {
          return;
        }
        var copy = {
          id: "tpl-" + Date.now(),
          name: current.name + " (копия)",
          // v3.1.1: current.tag+"2" часто давал дубль. Генерим уникальный.
          tag: ensureUniqueTagInList(sanitizeTag(current.tag) + "2" || "tag2", draft.templates),
          folder: current.folder,
          domains: Array.isArray(current.domains) ? current.domains.slice() : [],
          body: current.body,
          images: current.images.slice(),
          previewBeforeInsert: current.previewBeforeInsert === true
        };
        draft.templates.unshift(copy);
        selectedTemplateId = copy.id;
        renderLayout();
      });

      var delBtn = document.createElement("button");
      delBtn.className = "btn danger";
      delBtn.textContent = "Удалить";
      delBtn.addEventListener("click", function () {
        var current = selectedTemplate();
        if (!current) {
          return;
        }
        if (!window.confirm("Удалить шаблон: " + current.name + "?")) {
          return;
        }
        draft.templates = draft.templates.filter(function (tpl) {
          return tpl.id !== current.id;
        });
        selectedTemplateId = draft.templates[0] ? draft.templates[0].id : "";
        renderLayout();
      });

      var fixTagsBtn = document.createElement("button");
      fixTagsBtn.className = "btn";
      fixTagsBtn.textContent = "🛠 Теги";
      fixTagsBtn.title = "Почистить мусор в тегах и развести дубли";
      fixTagsBtn.addEventListener("click", function () {
        var fixed = 0;
        var renamed = 0;
        var taken = {};
        draft.templates.forEach(function (tpl) {
          var clean = sanitizeTag(tpl.tag);
          if (clean !== tpl.tag) {
            tpl.tag = clean;
            fixed += 1;
          }
          if (!clean) {
            return;
          }
          if (taken[clean]) {
            var i = 2;
            while (taken[clean + i]) {
              i += 1;
            }
            tpl.tag = clean + i;
            taken[clean + i] = true;
            renamed += 1;
          } else {
            taken[clean] = true;
          }
        });
        window.alert(
          "Готово: почищено " + fixed + ", дублей разведено " + renamed + ".\n" +
          "Пустые теги оставлены пустыми = только через //.\nНе забудьте нажать Сохранить."
        );
        renderLayout();
      });

      listActions.appendChild(addBtn);
      listActions.appendChild(dupBtn);
      listActions.appendChild(delBtn);
      listActions.appendChild(fixTagsBtn);
      // v3.4.0: создание папки прямо здесь (вкладки Папки больше нет).
      var addFolderBtn = document.createElement("button");
      addFolderBtn.className = "btn";
      addFolderBtn.textContent = "+ Папка";
      addFolderBtn.addEventListener("click", function () {
        var base = "Новая папка";
        var name = base;
        var i = 2;
        while (folderListFrom(draft).some(function (f) { return f === name; })) {
          name = base + " " + i;
          i += 1;
        }
        createFolderInDraft(name);
        openFolderSettings(name);
      });
      listActions.appendChild(addFolderBtn);
      listPanel.appendChild(listActions);

      var search = document.createElement("input");
      search.className = "field";
      search.placeholder = "Поиск шаблона";
      search.value = templateSearch;
      // v3.1.0 FIX: не перерендериваем всю страницу при поиске (терялся фокус).
      // Обновляем только список шаблонов.
      search.addEventListener("input", function () {
        templateSearch = search.value;
        var caret = search.selectionStart;
        renderLayout({ focusSearch: true, caret: caret });
      });
      listPanel.appendChild(search);

      // v3.2.0: фильтр по папке.
      var folderFilter = document.createElement("select");
      folderFilter.className = "field";
      folderFilter.style.marginTop = "8px";
      var allOpt = document.createElement("option");
      allOpt.value = "";
      allOpt.textContent = "Все папки (" + draft.templates.length + ")";
      folderFilter.appendChild(allOpt);
      folderListFrom(draft).forEach(function (folder) {
        var option = document.createElement("option");
        option.value = folder;
        var n = draft.templates.filter(function (t) {
          return (t.folder || "Общие") === folder;
        }).length;
        // v3.11.0: иконка папки.
        option.textContent = folderDisplayName(folder, draft) + " (" + n + ")";
        if (folder === templateFolderFilter) {
          option.selected = true;
        }
        folderFilter.appendChild(option);
      });
      folderFilter.addEventListener("change", function () {
        templateFolderFilter = folderFilter.value;
        renderLayout();
      });
      listPanel.appendChild(folderFilter);

      var list = document.createElement("div");
      list.className = "list";
      list.style.marginTop = "8px";
      listPanel.appendChild(list);

      var q = templateSearch.trim().toLowerCase();
      // v3.1.1: считаем дубли и битые теги в черновике для подсветки.
      var draftDupes = {};
      (function () {
        var counts = {};
        draft.templates.forEach(function (t) {
          var k = tagKey(t.tag);
          if (k) {
            counts[k] = (counts[k] || 0) + 1;
          }
        });
        Object.keys(counts).forEach(function (k) {
          if (counts[k] > 1) {
            draftDupes[k] = counts[k];
          }
        });
      })();
      var items = draft.templates.filter(function (tpl) {
        if (templateFolderFilter && (tpl.folder || "Общие") !== templateFolderFilter) {
          return false;
        }
        if (!q) {
          return true;
        }
        return (
          String(tpl.name || "").toLowerCase().indexOf(q) !== -1 ||
          String(tpl.tag || "").toLowerCase().indexOf(q) !== -1 ||
          String(tpl.folder || "").toLowerCase().indexOf(q) !== -1 ||
          String(tpl.body || "").toLowerCase().indexOf(q) !== -1
        );
      });

      // v3.3.0: дерево папок + drag-and-drop. Без поиска/фильтра — группируем по папкам
      // со сворачиванием; с поиском — плоский список. Порядок в draft.templates = порядок в меню.
      function moveTemplateTo(draggedId, targetId, after) {
        if (!draggedId || draggedId === targetId) {
          return;
        }
        var from = -1;
        for (var i = 0; i < draft.templates.length; i += 1) {
          if (draft.templates[i].id === draggedId) {
            from = i;
            break;
          }
        }
        if (from === -1) {
          return;
        }
        var moved = draft.templates.splice(from, 1)[0];
        var to = -1;
        for (var j = 0; j < draft.templates.length; j += 1) {
          if (targetId && draft.templates[j].id === targetId) {
            to = j;
            break;
          }
        }
        if (to === -1) {
          moved.folder = templateFolderFilter || moved.folder;
          draft.templates.push(moved);
        } else {
          moved.folder = draft.templates[to].folder;
          draft.templates.splice(after ? to + 1 : to, 0, moved);
        }
        selectedTemplateId = moved.id;
        renderLayout();
      }

      function moveTemplateToFolderEnd(draggedId, folder) {
        if (!draggedId) {
          return;
        }
        var from = -1;
        for (var i = 0; i < draft.templates.length; i += 1) {
          if (draft.templates[i].id === draggedId) {
            from = i;
            break;
          }
        }
        if (from === -1) {
          return;
        }
        var moved = draft.templates.splice(from, 1)[0];
        moved.folder = folder;
        var last = -1;
        for (var j = 0; j < draft.templates.length; j += 1) {
          if ((draft.templates[j].folder || "Общие") === folder) {
            last = j;
          }
        }
        draft.templates.splice(last + 1, 0, moved);
        selectedTemplateId = moved.id;
        renderLayout();
      }

      // v3.10.0: окно настроек конкретной папки (название, режим //, домены, удаление).
      function openFolderSettings(folder) {
        folderSettingsFor = folder;
        renderLayout();
      }

      function closeFolderSettings() {
        folderSettingsFor = null;
        renderLayout();
      }

      function renderFolderModal() {
        if (!folderSettingsFor) {
          return;
        }
        var folder = folderSettingsFor;
        if (folderListFrom(draft).indexOf(folder) === -1) {
          folderSettingsFor = null;
          return;
        }
        var count = draft.templates.filter(function (t) {
          return (t.folder || "Общие") === folder;
        }).length;
        var backdrop = document.createElement("div");
        backdrop.style.position = "fixed";
        backdrop.style.left = "0";
        backdrop.style.top = "0";
        backdrop.style.width = "100vw";
        backdrop.style.height = "100vh";
        backdrop.style.background = "rgba(0,0,0,.65)";
        backdrop.style.display = "flex";
        backdrop.style.alignItems = "center";
        backdrop.style.justifyContent = "center";
        backdrop.style.zIndex = "9999";
        backdrop.addEventListener("mousedown", function (event) {
          if (event.target === backdrop) {
            closeFolderSettings();
          }
        });
        backdrop.addEventListener("keydown", function (event) {
          if (event.key === "Escape") {
            event.stopPropagation();
            closeFolderSettings();
          }
          event.stopPropagation();
        });
        var dialog = document.createElement("div");
        dialog.className = "panel";
        dialog.style.width = "min(480px, calc(100vw - 32px))";
        dialog.style.maxHeight = "calc(100vh - 60px)";
        dialog.style.overflow = "auto";
        dialog.addEventListener("mousedown", function (event) {
          event.stopPropagation();
        });
        backdrop.appendChild(dialog);

        var title = document.createElement("div");
        title.className = "section-title";
        title.textContent = "Папка: " + folder + " (" + count + " ш.)";
        dialog.appendChild(title);

        var nameLabel = document.createElement("div");
        nameLabel.className = "muted";
        nameLabel.style.marginBottom = "4px";
        nameLabel.textContent = "Название";
        dialog.appendChild(nameLabel);
        var nameInput = document.createElement("input");
        nameInput.className = "field";
        nameInput.value = folder;
        dialog.appendChild(nameInput);

        // v3.11.0: иконка папки.
        var iconLabel = document.createElement("div");
        iconLabel.className = "muted";
        iconLabel.style.margin = "10px 0 4px";
        iconLabel.textContent = "Иконка (эмодзи)";
        dialog.appendChild(iconLabel);
        var iconInput = document.createElement("input");
        iconInput.className = "field";
        iconInput.placeholder = "📁";
        iconInput.value = folderIcon(folder, draft);
        dialog.appendChild(iconInput);
        var iconBar = document.createElement("div");
        iconBar.className = "token-bar";
        ["📁", "📂", "💰", "🛒", "🎧", "📦", "✉️", "⭐", "🔥", "💼", "📋", "🐞", "❓", "💬"].forEach(function (emoji) {
          var b = document.createElement("button");
          b.type = "button";
          b.className = "token-btn";
          b.textContent = emoji;
          b.addEventListener("click", function () {
            iconInput.value = emoji;
            iconInput.focus();
          });
          iconBar.appendChild(b);
        });
        dialog.appendChild(iconBar);

        var modeLabel = document.createElement("div");
        modeLabel.className = "muted";
        modeLabel.style.margin = "10px 0 4px";
        modeLabel.textContent = "Режим в меню //";
        dialog.appendChild(modeLabel);
        var modeSelect = document.createElement("select");
        modeSelect.className = "field";
        [
          { v: "default", t: "По умолчанию" },
          { v: "always_open", t: "Всегда раскрывать" },
          { v: "always_collapsed", t: "Всегда сворачивать" }
        ].forEach(function (o) {
          var opt = document.createElement("option");
          opt.value = o.v;
          opt.textContent = o.t;
          if (getFolderMode(folder, draft) === o.v) {
            opt.selected = true;
          }
          modeSelect.appendChild(opt);
        });
        dialog.appendChild(modeSelect);

        var domLabel = document.createElement("div");
        domLabel.className = "muted";
        domLabel.style.margin = "10px 0 4px";
        domLabel.textContent = "Домены папки (по одному в строке)";
        dialog.appendChild(domLabel);
        // v3.11.0: режим списка доменов.
        var domModeSelect = document.createElement("select");
        domModeSelect.className = "field";
        domModeSelect.style.marginBottom = "8px";
        [
          { v: "all", t: "Все сайты (список ниже не используется)" },
          { v: "only", t: "Только эти сайты" },
          { v: "except", t: "Все сайты, кроме этих" }
        ].forEach(function (o) {
          var opt = document.createElement("option");
          opt.value = o.v;
          opt.textContent = o.t;
          if (getFolderDomainMode(folder, draft) === o.v) {
            opt.selected = true;
          }
          domModeSelect.appendChild(opt);
        });
        dialog.appendChild(domModeSelect);
        var domInput = document.createElement("textarea");
        domInput.className = "field";
        domInput.style.minHeight = "62px";
        var existingDomains = (draft.folderDomains && draft.folderDomains[folder]) || [];
        domInput.value = existingDomains.join("\n");
        domInput.placeholder = "t.me — по одному в строке";
        dialog.appendChild(domInput);
        var domHint = document.createElement("div");
        domHint.className = "muted";
        domHint.style.marginTop = "4px";
        domHint.textContent = "Касается шаблонов папки без своих доменов. Свои домены шаблона всегда важнее.";
        dialog.appendChild(domHint);

        var btnRow = document.createElement("div");
        btnRow.className = "actions";
        btnRow.style.marginTop = "12px";
        var saveBtn = document.createElement("button");
        saveBtn.className = "btn primary";
        saveBtn.textContent = "Сохранить";
        saveBtn.addEventListener("click", function () {
          var newName = nameInput.value.trim() || folder;
          if (newName !== folder) {
            renameFolderInDraft(folder, newName);
            if (collapsedFolders[folder]) {
              delete collapsedFolders[folder];
              collapsedFolders[newName] = true;
            }
          }
          setFolderMode(newName, modeSelect.value);
          // v3.11.0: иконка.
          if (!draft.folderIcons || typeof draft.folderIcons !== "object") {
            draft.folderIcons = {};
          }
          var iconClean = Array.from(String(iconInput.value || "").trim()).slice(0, 4).join("");
          if (iconClean) {
            draft.folderIcons[newName] = iconClean;
          } else if (draft.folderIcons[newName]) {
            delete draft.folderIcons[newName];
          }
          if (newName !== folder && draft.folderIcons[folder]) {
            delete draft.folderIcons[folder];
          }
          // v3.11.0: режим + список доменов.
          if (!draft.folderDomainModes || typeof draft.folderDomainModes !== "object") {
            draft.folderDomainModes = {};
          }
          draft.folderDomainModes[newName] = domModeSelect.value;
          if (newName !== folder && draft.folderDomainModes[folder]) {
            delete draft.folderDomainModes[folder];
          }
          if (!draft.folderDomains || typeof draft.folderDomains !== "object") {
            draft.folderDomains = {};
          }
          var cleaned = domInput.value
            .split("\n")
            .map(function (line) {
              return line.trim().toLowerCase();
            })
            .filter(Boolean);
          if (cleaned.length) {
            draft.folderDomains[newName] = cleaned;
          } else if (draft.folderDomains[newName]) {
            delete draft.folderDomains[newName];
          }
          // renameFolderInDraft уже перенес ключ доменов; подчистим на всякий случай
          if (newName !== folder && draft.folderDomains[folder]) {
            delete draft.folderDomains[folder];
          }
          folderSettingsFor = null;
          renderLayout();
        });
        var cancelBtn = document.createElement("button");
        cancelBtn.className = "btn";
        cancelBtn.textContent = "Отмена";
        cancelBtn.addEventListener("click", closeFolderSettings);
        btnRow.appendChild(saveBtn);
        btnRow.appendChild(cancelBtn);
        if (folder !== "Общие") {
          var delBtn = document.createElement("button");
          delBtn.className = "btn danger";
          delBtn.textContent = "Удалить папку";
          delBtn.addEventListener("click", function () {
            if (!window.confirm("Удалить папку '" + folder + "'? Шаблоны перейдут в 'Общие'.")) {
              return;
            }
            deleteFolderFromDraft(folder);
            if (collapsedFolders[folder]) {
              delete collapsedFolders[folder];
            }
            folderSettingsFor = null;
            renderLayout();
          });
          btnRow.appendChild(delBtn);
        }
        dialog.appendChild(btnRow);
        root.appendChild(backdrop);
        window.setTimeout(function () {
          try {
            nameInput.focus();
            nameInput.select();
          } catch (e) { /* ignore */ }
        }, 0);
      }

      function renderTemplateRow(tpl) {
        var wrap = document.createElement("div");
        wrap.className = "checkrow";
        wrap.style.padding = "0 4px";
        wrap.draggable = true;
        wrap.title = "Тяните чтобы переместить / упорядочить";
        wrap.addEventListener("dragstart", function (event) {
          draggedTemplateId = tpl.id;
          try {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", tpl.id);
          } catch (e) { /* ignore */ }
        });
        wrap.addEventListener("dragend", function () {
          draggedTemplateId = null;
          renderLayout();
        });
        wrap.addEventListener("dragover", function (event) {
          if (!draggedTemplateId || draggedTemplateId === tpl.id) {
            return;
          }
          event.preventDefault();
          try {
            event.dataTransfer.dropEffect = "move";
          } catch (e) { /* ignore */ }
          var rect = wrap.getBoundingClientRect();
          var after = (event.clientY - rect.top) > rect.height / 2;
          wrap.classList.add("droptarget");
          wrap._dropAfter = after;
        });
        wrap.addEventListener("dragleave", function () {
          wrap.classList.remove("droptarget");
        });
        wrap.addEventListener("drop", function (event) {
          event.preventDefault();
          event.stopPropagation();
          moveTemplateTo(draggedTemplateId, tpl.id, wrap._dropAfter);
        });
        var check = document.createElement("input");
        check.type = "checkbox";
        check.checked = Boolean(selectedIds[tpl.id]);
        check.title = "Выбрать для массовых действий";
        check.addEventListener("click", function (event) {
          event.stopPropagation();
          if (check.checked) {
            selectedIds[tpl.id] = true;
          } else {
            delete selectedIds[tpl.id];
          }
          renderLayout();
        });
        var row = document.createElement("button");
        row.type = "button";
        row.className = tpl.id === selectedTemplateId ? "row active" : "row";
        row.style.flex = "1";
        row.style.minWidth = "0";
        row.textContent = tpl.name;
        var meta = document.createElement("small");
        var key = tagKey(tpl.tag);
        var warn = "";
        if (!key) {
          warn = " ⚠ без тега";
        } else if (draftDupes[key] > 1) {
          warn = " ⚠ дубль×" + draftDupes[key];
        } else if (!isTagUsable(tpl.tag)) {
          warn = " ⚠ короткий тег";
        }
        meta.textContent =
          (tpl.tag ? draft.triggerPrefix + tpl.tag : "(без тега)") +
          " | " +
          (tpl.folder || "Общие") +
          " | " +
          (tpl.domains && tpl.domains.length ? tpl.domains.join(",") : "все сайты") +
          warn;
        if (warn) {
          meta.style.color = "#fbbf24";
        }
        row.appendChild(meta);
        row.addEventListener("click", function () {
          selectedTemplateId = tpl.id;
          renderLayout();
        });
        wrap.appendChild(check);
        wrap.appendChild(row);
        return wrap;
      }

      var isGrouped = !q && !templateFolderFilter;
      if (isGrouped) {
        // v3.10.0: чистый заголовок (свернуть + шестеренка). Все правки — в модалке настроек папки.
        folderListFrom(draft).forEach(function (folder) {
          var inFolder = draft.templates.filter(function (t) {
            return (t.folder || "Общие") === folder;
          });
          if (!inFolder.length) {
            return;
          }
          var head = document.createElement("div");
          head.className = "folder-head";
          head.title = "Сюда можно перетащить шаблон";
          var chev = document.createElement("span");
          chev.className = "chev";
          chev.textContent = collapsedFolders[folder] ? "▶" : "▼";
          chev.title = "Свернуть/развернуть";
          chev.style.cursor = "pointer";
          chev.addEventListener("click", function () {
            collapsedFolders[folder] = !collapsedFolders[folder];
            renderLayout();
          });
          head.appendChild(chev);
          // v3.10.0: чистый заголовок — свернуть + название + счетчик + шестеренка.
          // Все правки (название, режим, домены, удаление) — в окне настроек папки.
          var fname = document.createElement("span");
          // v3.11.0: иконка папки.
          fname.textContent = folderDisplayName(folder, draft);
          fname.style.cursor = "pointer";
          fname.title = "Клик — свернуть/развернуть";
          fname.addEventListener("click", function () {
            collapsedFolders[folder] = !collapsedFolders[folder];
            renderLayout();
          });
          head.appendChild(fname);
          var cnt = document.createElement("span");
          cnt.className = "cnt";
          cnt.textContent = inFolder.length + " шт.";
          head.appendChild(cnt);
          var modeNow = getFolderMode(folder, draft);
          if (modeNow !== "default") {
            var modeBadge = document.createElement("span");
            modeBadge.className = "cnt";
            modeBadge.textContent = modeNow === "always_open" ? "📌" : "📂";
            modeBadge.title = modeNow === "always_open" ? "Всегда раскрывать в //" : "Всегда сворачивать в //";
            head.appendChild(modeBadge);
          }
          var gearBtn = document.createElement("button");
          gearBtn.type = "button";
          gearBtn.className = "token-btn";
          gearBtn.textContent = "⚙️";
          gearBtn.title = "Настройки папки";
          gearBtn.addEventListener("click", function (event) {
            event.stopPropagation();
            openFolderSettings(folder);
          });
          head.appendChild(gearBtn);
          head.addEventListener("dragover", function (event) {
            if (!draggedTemplateId) {
              return;
            }
            event.preventDefault();
            head.classList.add("droptarget");
          });
          head.addEventListener("dragleave", function () {
            head.classList.remove("droptarget");
          });
          head.addEventListener("drop", function (event) {
            event.preventDefault();
            event.stopPropagation();
            moveTemplateToFolderEnd(draggedTemplateId, folder);
          });
          list.appendChild(head);
          if (!collapsedFolders[folder]) {
            inFolder.forEach(function (tpl) {
              list.appendChild(renderTemplateRow(tpl));
            });
          }
        });
        if (!draft.templates.length) {
          var emptyTree = document.createElement("div");
          emptyTree.className = "muted";
          emptyTree.style.padding = "10px";
          emptyTree.textContent = "Шаблонов пока нет — нажмите + Шаблон.";
          list.appendChild(emptyTree);
        }
      } else {
        items.forEach(function (tpl) {
          list.appendChild(renderTemplateRow(tpl));
        });

        if (items.length === 0) {
          var empty = document.createElement("div");
          empty.className = "muted";
          empty.style.padding = "10px";
          empty.textContent = "Шаблоны не найдены";
          list.appendChild(empty);
        }
      }

      // v3.2.0: bulk-панель массовых действий.
      var selectedCount = Object.keys(selectedIds).filter(function (id) {
        return draft.templates.some(function (t) {
          return t.id === id;
        });
      }).length;
      if (selectedCount > 0) {
        var bulk = document.createElement("div");
        bulk.className = "bulkbar";
        var bulkTitle = document.createElement("div");
        bulkTitle.className = "muted";
        bulkTitle.textContent = "Выбрано: " + selectedCount;
        bulk.appendChild(bulkTitle);
        var bulkRow = document.createElement("div");
        bulkRow.className = "actions";
        var moveSelect = document.createElement("select");
        moveSelect.className = "field";
        moveSelect.style.maxWidth = "150px";
        var mvPlaceholder = document.createElement("option");
        mvPlaceholder.value = "";
        mvPlaceholder.textContent = "В папку…";
        moveSelect.appendChild(mvPlaceholder);
        folderListFrom(draft).forEach(function (folder) {
          var o = document.createElement("option");
          o.value = folder;
          // v3.11.0: иконка папки.
          o.textContent = folderDisplayName(folder, draft);
          moveSelect.appendChild(o);
        });
        moveSelect.addEventListener("change", function () {
          if (!moveSelect.value) {
            return;
          }
          draft.templates.forEach(function (t) {
            if (selectedIds[t.id]) {
              t.folder = moveSelect.value;
            }
          });
          renderLayout();
        });
        var expSelBtn = document.createElement("button");
        expSelBtn.className = "btn";
        expSelBtn.textContent = "Экспорт";
        expSelBtn.addEventListener("click", function () {
          var picked = draft.templates.filter(function (t) {
            return selectedIds[t.id];
          });
          var text = JSON.stringify(picked, null, 2);
          copyTextToClipboard(text, "Скопируйте выбранные шаблоны");
          downloadJsonFile("textenter-selected.json", text);
        });
        var delSelBtn = document.createElement("button");
        delSelBtn.className = "btn danger";
        delSelBtn.textContent = "Удалить (" + selectedCount + ")";
        delSelBtn.addEventListener("click", function () {
          if (!window.confirm("Удалить выбранных шаблонов: " + selectedCount + "?")) {
            return;
          }
          draft.templates = draft.templates.filter(function (t) {
            return !selectedIds[t.id];
          });
          selectedIds = {};
          selectedTemplateId = draft.templates[0] ? draft.templates[0].id : "";
          renderLayout();
        });
        var clearSelBtn = document.createElement("button");
        clearSelBtn.className = "btn";
        clearSelBtn.textContent = "Снять выбор";
        clearSelBtn.addEventListener("click", function () {
          selectedIds = {};
          renderLayout();
        });
        bulkRow.appendChild(moveSelect);
        bulkRow.appendChild(expSelBtn);
        bulkRow.appendChild(delSelBtn);
        bulkRow.appendChild(clearSelBtn);
        bulk.appendChild(bulkRow);
        listPanel.appendChild(bulk);
      }

      var editor = document.createElement("div");
      editor.className = "panel";
      split.appendChild(editor);

      var currentTemplate = selectedTemplate();
      if (!currentTemplate) {
        editor.innerHTML = '<p class="muted">Выберите или создайте шаблон.</p>';
        var emptyHelp = document.createElement("div");
        emptyHelp.className = "help muted";
        emptyHelp.style.marginTop = "12px";
        emptyHelp.innerHTML =
          'Как использовать: <code>' +
          escapeHtml(draft.triggerPrefix) +
          'tag</code> + пробел. Также вводите <code>/буква</code> для быстрого списка тегов. Для папок и навигации по папкам используйте <code>//</code>.<br>' +
          variablesGuide +
          '<br>Домены шаблона: пусто = из настроек папки (⚙️), там пусто = на всех сайтах. Например <code>t.me</code> = t.me и все поддомены.';
        target.appendChild(emptyHelp);
        return;
      }

      var editableVariables = getEditableVariables(currentTemplate);
      var previewLocked = editableVariables.length > 0;
      editor.innerHTML =
        '<div class="line2">' +
        '<input id="t-name" class="field" placeholder="Название" />' +
        '<input id="t-tag" class="field" placeholder="Тег без префикса" />' +
        "</div>" +
        '<div style="margin-top:8px;" class="line2">' +
        '<select id="t-folder" class="field"></select>' +
        '<input id="t-invoke" class="field" readonly />' +
        "</div>" +
        '<div style="margin-top:8px;position:relative;"><textarea id="t-body" class="field" style="min-height:160px" placeholder="Текст шаблона (наберите {{ для подсказок)"></textarea><div id="t-suggest" class="suggest" style="display:none;"></div></div>' +
        '<div id="t-token-bar" class="token-bar"></div>' +
        '<div id="t-parse" class="tokparse"></div>' +
        '<div style="margin-top:8px;"><textarea id="t-domains" class="field" style="min-height:62px" placeholder="Домены шаблона, по одному в строке. Пусто = из настроек папки (⚙️)"></textarea></div>' +
        '<div class="preview-box">' +
        '<div class="preview-head"><span class="preview-title">Предпросмотр вставки</span><button id="t-random" class="btn" type="button">Перегенерировать рандом</button></div>' +
        '<div id="t-preview-text" class="preview-text"></div>' +
        "</div>" +
        '<label class="muted" style="display:flex;align-items:center;gap:8px;margin-top:8px;"><input id="t-preview" type="checkbox" /> Предпросмотр перед вставкой</label>' +
        '<div id="t-preview-note" class="muted"></div>';

      var nameEl = editor.querySelector("#t-name");
      var tagEl = editor.querySelector("#t-tag");
      var folderEl = editor.querySelector("#t-folder");
      var invokeEl = editor.querySelector("#t-invoke");
      var domainsEl = editor.querySelector("#t-domains");
      var bodyEl = editor.querySelector("#t-body");
      var tokenBarEl = editor.querySelector("#t-token-bar");
      var previewTextEl = editor.querySelector("#t-preview-text");
      var randomBtnEl = editor.querySelector("#t-random");
      var previewElLocal = editor.querySelector("#t-preview");
      var noteEl = editor.querySelector("#t-preview-note");

      var tokenHints = [
        "{{name}}",
        "{{surname}}",
        "{{fullname}}",
        "{{company}}",
        "{{email}}",
        "{{phone}}",
        "{{position}}",
        "{{name:tag}}",
        "{{phone:tag}}",
        "{{date}}",
        "{{date+1}}",
        "{{date2}}",
        "{{date2+1}}",
        "{{date(\"Дата начала\")}}",
        "{{date+7(\"Дата начала\")}}",
        "{{datetoday}}",
        "{{datetoday+1}}",
        "{{time}}",
        "{{time+1}}",
        "{{time2}}",
        "{{time(\"Время встречи\")}}",
        "{{timetoday}}",
        "{{timetoday-1}}",
        "{{calc:1200*1.2}}",
        "{{text}}",
        "{{text2}}",
        "{{text(\"Комментарий\")}}"
      ];

      function renderDraftTemplatePreview() {
        var backup = config;
        config = draft;
        var text = renderText(bodyEl.value || "", null);
        config = backup;
        previewTextEl.textContent = text;
      }

      function insertTokenIntoBody(token) {
        var start = typeof bodyEl.selectionStart === "number" ? bodyEl.selectionStart : bodyEl.value.length;
        var end = typeof bodyEl.selectionEnd === "number" ? bodyEl.selectionEnd : bodyEl.value.length;
        var before = bodyEl.value.slice(0, start);
        var after = bodyEl.value.slice(end);
        bodyEl.value = before + token + after;
        var nextPos = start + token.length;
        bodyEl.setSelectionRange(nextPos, nextPos);
        patchCurrentTemplate({ body: bodyEl.value });
        renderDraftTemplatePreview();
        refreshTokenParse();
        refreshBodyStats();
      }

      // ---------- v3.2.0: разбор токенов + автокомплит по {{ ----------
      var parseEl = editor.querySelector("#t-parse");
      var suggestEl = editor.querySelector("#t-suggest");
      var suggestIndex = 0;
      var suggestList = [];

      function tokenClassFor(token) {
        var k = analyzeTokenKind(token);
        if (k.kind === "datetime") {
          return /^time/i.test(token.trim()) ? "tok time" : "tok date";
        }
        if (k.kind === "custom" || k.kind === "choice" || k.kind === "textinput") {
          return "tok custom";
        }
        if (k.kind === "func") {
          return "tok func";
        }
        if (k.kind === "builtin" || k.kind === "profile") {
          return "tok builtin";
        }
        if (token.trim().toLowerCase().indexOf("datetoday") === 0 ||
            token.trim().toLowerCase().indexOf("timetoday") === 0) {
          return "tok today";
        }
        return "tok bad";
      }

      function refreshTokenParse() {
        if (!parseEl) {
          return;
        }
        parseEl.innerHTML = "";
        var re = /\{\{\s*([^{}]+?)\s*\}\}/g;
        var m;
        var seen = {};
        var hasAny = false;
        while ((m = re.exec(bodyEl.value || ""))) {
          var tok = String(m[1] || "").trim();
          if (!tok || seen[tok]) {
            continue;
          }
          seen[tok] = true;
          hasAny = true;
          var chip = document.createElement("span");
          var cls = tokenClassFor(tok);
          chip.className = cls;
          var k = analyzeTokenKind(tok);
          chip.title = k.kind === "unknown-var" ? "Нет такой переменной — создайте во вкладке Переменные" :
            (k.kind === "unknown-func" ? "Неизвестная функция" : "{{" + tok + "}}");
          chip.textContent = "{{" + (tok.length > 28 ? tok.slice(0, 28) + "…" : tok) + "}}";
          parseEl.appendChild(chip);
        }
        if (!hasAny) {
          var none = document.createElement("span");
          none.className = "muted";
          none.textContent = "Переменных пока нет — наберите {{ чтобы увидеть подсказки.";
          parseEl.appendChild(none);
        }
      }

      function suggestCatalog() {
        var items = [
          { t: "{{date}}", d: "базовая дата" },
          { t: "{{date+1}}", d: "база +1 день" },
          { t: "{{date2}}", d: "независимая дата №2" },
          { t: "{{date(\"Подпись\")}}", d: "дата с подписью" },
          { t: "{{datetoday}}", d: "всегда сегодня" },
          { t: "{{time}}", d: "базовое время" },
          { t: "{{time2}}", d: "независимое время №2" },
          { t: "{{time(\"Подпись\")}}", d: "время с подписью" },
          { t: "{{timetoday}}", d: "всегда сейчас" },
          { t: "{{name}}", d: "имя из профиля" },
          { t: "{{fullname}}", d: "имя + фамилия" },
          { t: "{{phone}}", d: "телефон человека" },
          { t: "{{name:tag}}", d: "поле человека по тегу" },
          { t: "{{phone:tag}}", d: "телефон человека по тегу" },
          { t: "{{position}}", d: "должность человека" },
          { t: "{{company}}", d: "компания из профиля" },
          { t: "{{pick:a|b}}", d: "случайный вариант" },
          { t: "{{calc:100*1.2}}", d: "математика" },
          { t: "{{text}}", d: "свободный ввод при вставке" },
          { t: "{{text2}}", d: "второй свободный ввод" },
          { t: "{{text(\"Комментарий\")}}", d: "ввод с подписью" }
        ];
        (draft.customVariables || []).forEach(function (v) {
          items.push({ t: "{{" + v.name + "}}", d: "своя переменная" });
          items.push({ t: "{{" + v.name + "(\"Подсказка\")}}", d: "своя с подписью" });
        });
        // v3.6.0: подсказки людей по тегам.
        (draft.profiles || []).forEach(function (p) {
          if (p.tag) {
            items.push({ t: "{{name:" + p.tag + "}}", d: profileDisplayName(p) });
            items.push({ t: "{{phone:" + p.tag + "}}", d: profileDisplayName(p) });
          }
        });
        // v3.7.0: подсказки записей справочников.
        // v3.8.0: подсказки выбора {{поле:#}} по всем известным полям.
        (function () {
          var seen = {};
          function addChoice(f) {
            if (!f || seen[f]) {
              return;
            }
            seen[f] = true;
            items.push({ t: "{{" + f + ":#}}", d: "выбор из всех значений" });
          }
          ["name", "surname", "phone", "company"].forEach(addChoice);
          (draft.profileFields || []).forEach(function (f) {
            addChoice(f.name);
          });
          (draft.recordSets || []).forEach(function (s) {
            (s.fields || []).forEach(function (f) {
              addChoice(f.name);
            });
          });
        })();
        (draft.recordSets || []).forEach(function (s) {
          (s.fields || []).forEach(function (f) {
            (s.records || []).forEach(function (r) {
              if (r.tag) {
                items.push({ t: "{{" + f.name + ":" + r.tag + "}}", d: s.name + ": @" + r.tag });
              }
            });
          });
        });
        return items;
      }

      function closeSuggest() {
        suggestList = [];
        suggestIndex = 0;
        if (suggestEl) {
          suggestEl.style.display = "none";
          suggestEl.innerHTML = "";
        }
      }

      function renderSuggest(matches, replaceFrom, replaceTo) {
        suggestList = matches;
        suggestIndex = 0;
        suggestEl.innerHTML = "";
        if (!matches.length) {
          closeSuggest();
          return;
        }
        matches.slice(0, 8).forEach(function (item, i) {
          var b = document.createElement("button");
          b.type = "button";
          b.className = i === 0 ? "active" : "";
          b.innerHTML = "";
          var code = document.createElement("span");
          code.textContent = item.t;
          var small = document.createElement("small");
          small.textContent = item.d;
          b.appendChild(code);
          b.appendChild(small);
          b.addEventListener("mousedown", function (event) {
            event.preventDefault();
          });
          b.addEventListener("click", function () {
            applySuggest(item, replaceFrom, replaceTo);
          });
          suggestEl.appendChild(b);
        });
        suggestEl.style.display = "block";
      }

      function applySuggest(item, from, to) {
        var val = bodyEl.value;
        bodyEl.value = val.slice(0, from) + item.t + val.slice(to);
        var pos = from + item.t.length;
        bodyEl.setSelectionRange(pos, pos);
        patchCurrentTemplate({ body: bodyEl.value });
        renderDraftTemplatePreview();
        refreshTokenParse();
        closeSuggest();
        bodyEl.focus();
      }

      function updateSuggest() {
        var pos = typeof bodyEl.selectionStart === "number" ? bodyEl.selectionStart : (bodyEl.value || "").length;
        var before = (bodyEl.value || "").slice(0, pos);
        var m = before.match(/\{\{\s*([a-zA-Zа-яА-ЯёЁ0-9_+\-:#]*)$/);
        if (!m) {
          closeSuggest();
          return false;
        }
        var q = m[1].toLowerCase();
        var catalog = suggestCatalog();
        var matches = catalog.filter(function (item) {
          return item.t.toLowerCase().indexOf("{{" + q) === 0;
        });
        if (!matches.length) {
          closeSuggest();
          return false;
        }
        renderSuggest(matches, pos - m[1].length, pos);
        return true;
      }

      bodyEl.addEventListener("keydown", function (event) {
        if (suggestEl && suggestEl.style.display === "block" && suggestList.length) {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            event.stopPropagation();
            var n = Math.min(suggestList.length, 8);
            suggestIndex = event.key === "ArrowDown" ? (suggestIndex + 1) % n : (suggestIndex - 1 + n) % n;
            var btns = suggestEl.querySelectorAll("button");
            for (var i = 0; i < btns.length; i += 1) {
              btns[i].classList.toggle("active", i === suggestIndex);
            }
            return;
          }
          if (event.key === "Enter" || event.key === "Tab") {
            var pos = typeof bodyEl.selectionStart === "number" ? bodyEl.selectionStart : (bodyEl.value || "").length;
            var before = (bodyEl.value || "").slice(0, pos);
            var mm = before.match(/\{\{\s*([a-zA-Zа-яА-ЯёЁ0-9_+\-:#]*)$/);
            if (mm) {
              event.preventDefault();
              event.stopPropagation();
              applySuggest(suggestList[suggestIndex] || suggestList[0], pos - mm[1].length, pos);
              return;
            }
          }
          if (event.key === "Escape") {
            closeSuggest();
          }
        }
      });

      tokenHints.forEach(function (token) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "token-btn";
        btn.textContent = token;
        btn.addEventListener("click", function () {
          insertTokenIntoBody(token);
          bodyEl.focus();
        });
        tokenBarEl.appendChild(btn);
      });

      var randomBtn = document.createElement("button");
      randomBtn.type = "button";
      randomBtn.className = "token-btn";
      randomBtn.textContent = "[[рандом]]";
      randomBtn.addEventListener("click", function () {
        insertTokenIntoBody("[[вариант 1|вариант 2]]");
        bodyEl.focus();
      });
      tokenBarEl.appendChild(randomBtn);

      // v3.4.0: тулбар редактора — статистика, высота поля, копирование вызова.
      var editorToolbar = document.createElement("div");
      editorToolbar.style.display = "flex";
      editorToolbar.style.alignItems = "center";
      editorToolbar.style.gap = "8px";
      editorToolbar.style.marginTop = "8px";
      var bodyStats = document.createElement("span");
      bodyStats.className = "muted";
      editorToolbar.appendChild(bodyStats);
      var bodyStatsSpacer = document.createElement("span");
      bodyStatsSpacer.style.flex = "1";
      editorToolbar.appendChild(bodyStatsSpacer);
      function refreshBodyStats() {
        var text = bodyEl.value || "";
        var count = 0;
        var re = /\{\{\s*([^{}]+?)\s*\}\}/g;
        while (re.exec(text)) {
          count += 1;
        }
        bodyStats.textContent = text.length + " символов • " + count + " перем.";
      }
      var shrinkBtn = document.createElement("button");
      shrinkBtn.type = "button";
      shrinkBtn.className = "token-btn";
      shrinkBtn.textContent = "А−";
      shrinkBtn.title = "Уменьшить поле";
      shrinkBtn.addEventListener("click", function () {
        var h = parseInt(bodyEl.style.minHeight, 10) || 160;
        bodyEl.style.minHeight = Math.max(80, h - 40) + "px";
        bodyEl.focus();
      });
      var growBtn = document.createElement("button");
      growBtn.type = "button";
      growBtn.className = "token-btn";
      growBtn.textContent = "А+";
      growBtn.title = "Увеличить поле";
      growBtn.addEventListener("click", function () {
        var h = parseInt(bodyEl.style.minHeight, 10) || 160;
        bodyEl.style.minHeight = Math.min(600, h + 40) + "px";
        bodyEl.focus();
      });
      var copyTriggerBtn = document.createElement("button");
      copyTriggerBtn.type = "button";
      copyTriggerBtn.className = "token-btn";
      copyTriggerBtn.textContent = "📋 Вызов";
      copyTriggerBtn.title = "Скопировать триггер вставки";
      copyTriggerBtn.addEventListener("click", function () {
        var cur = selectedTemplate();
        var trigger = draft.triggerPrefix + ((cur && cur.tag) || currentTemplate.tag || "");
        copyTextToClipboard(trigger, "Триггер шаблона");
      });
      editorToolbar.appendChild(shrinkBtn);
      editorToolbar.appendChild(growBtn);
      editorToolbar.appendChild(copyTriggerBtn);
      bodyEl.parentNode.parentNode.insertBefore(editorToolbar, bodyEl.parentNode.nextSibling);
      refreshBodyStats();

      nameEl.value = currentTemplate.name;
      tagEl.value = currentTemplate.tag;
      // v3.1.1: предупреждение прямо под полем тега.
      var tagWarnEl = document.createElement("div");
      tagWarnEl.className = "muted";
      tagWarnEl.style.marginTop = "4px";
      tagEl.parentNode.insertBefore(tagWarnEl, tagEl.nextSibling);

      function refreshTagWarning(value) {
        var key = tagKey(value);
        if (!key) {
          tagWarnEl.textContent = "Без тега: шаблон будет доступен только через // меню.";
          tagWarnEl.style.color = "#94a3b8";
          tagEl.style.borderColor = "";
          return;
        }
        if (!isTagUsable(value)) {
          tagWarnEl.textContent = "Тег короче 2 символов — будет плохо вызываться. Добавьте букв.";
          tagWarnEl.style.color = "#fbbf24";
          tagEl.style.borderColor = "#f59e0b";
          return;
        }
        var same = draft.templates.filter(function (t) {
          return t.id !== currentTemplate.id && tagKey(t.tag) === key;
        });
        if (same.length > 0) {
          tagWarnEl.textContent = "⚠ Дубль: такой тег уже у «" + same.map(function (t) {
            return t.name;
          }).join("», «") + "». При вставке по пробелу откроется выбор, а не автовставка.";
          tagWarnEl.style.color = "#fbbf24";
          tagEl.style.borderColor = "#ef4444";
          return;
        }
        tagWarnEl.textContent = "Вызов: " + draft.triggerPrefix + value + " + пробел/Tab/Enter";
        tagWarnEl.style.color = "#64748b";
        tagEl.style.borderColor = "";
      }
      folderEl.innerHTML = "";
      folderListFrom(draft).forEach(function (folder) {
        var option = document.createElement("option");
        option.value = folder;
        // v3.11.0: иконка папки.
        option.textContent = folderDisplayName(folder, draft);
        if (folder === currentTemplate.folder) {
          option.selected = true;
        }
        folderEl.appendChild(option);
      });
      var createFolderOption = document.createElement("option");
      createFolderOption.value = "__create__";
      createFolderOption.textContent = "СОЗДАТЬ ПАПКУ...";
      folderEl.appendChild(createFolderOption);
      invokeEl.value = "Вызов: " + draft.triggerPrefix + (currentTemplate.tag || "(без тега)") + " или //";
      domainsEl.value = (currentTemplate.domains || []).join("\n");
      bodyEl.value = currentTemplate.body;
      previewElLocal.checked = previewLocked ? true : currentTemplate.previewBeforeInsert === true;
      previewElLocal.disabled = previewLocked;
      noteEl.textContent = previewLocked
        ? "Предпросмотр обязателен: есть переменные, которые нужно заполнить перед вставкой."
        : "Включите, если хотите подтверждать вставку через окно предпросмотра.";

      function patchCurrentTemplate(patch) {
        draft.templates = draft.templates.map(function (tpl) {
          if (tpl.id !== currentTemplate.id) {
            return tpl;
          }
          return {
            id: tpl.id,
            name: typeof patch.name === "string" ? patch.name : tpl.name,
            tag: typeof patch.tag === "string" ? patch.tag : tpl.tag,
            folder: typeof patch.folder === "string" ? patch.folder : tpl.folder,
            domains: Array.isArray(patch.domains) ? patch.domains : tpl.domains || [],
            body: typeof patch.body === "string" ? patch.body : tpl.body,
            images: Array.isArray(patch.images) ? patch.images : tpl.images,
            previewBeforeInsert:
              typeof patch.previewBeforeInsert === "boolean" ? patch.previewBeforeInsert : tpl.previewBeforeInsert === true
          };
        });
      }

      nameEl.addEventListener("input", function () {
        patchCurrentTemplate({ name: nameEl.value });
      });
      tagEl.addEventListener("input", function () {
        // v3.1.1: единая санитизация (раньше только пробелы/кейс, мусор "!@#" оставался и давал "бесполезный" тег).
        var clean = sanitizeTag(tagEl.value);
        patchCurrentTemplate({ tag: clean });
        invokeEl.value = "Вызов: " + draft.triggerPrefix + (clean || "(без тега)") + " или //";
        refreshTagWarning(clean);
      });
      folderEl.addEventListener("change", function () {
        if (folderEl.value === "__create__") {
          folderCreateRow.style.display = "grid";
          folderCreateInput.value = "";
          folderCreateInput.focus();
          return;
        }
        folderCreateRow.style.display = "none";
        patchCurrentTemplate({ folder: folderEl.value || "Общие" });
      });
      // v3.4.0: создание папки инлайн, без prompt.
      var folderCreateRow = document.createElement("div");
      folderCreateRow.className = "line3";
      folderCreateRow.style.display = "none";
      folderCreateRow.style.marginTop = "8px";
      var folderCreateInput = document.createElement("input");
      folderCreateInput.className = "field";
      folderCreateInput.placeholder = "Название новой папки";
      var folderCreateAdd = document.createElement("button");
      folderCreateAdd.type = "button";
      folderCreateAdd.className = "btn";
      folderCreateAdd.textContent = "Создать";
      folderCreateAdd.addEventListener("click", function () {
        var clean = createFolderInDraft(folderCreateInput.value);
        if (!clean) {
          return;
        }
        patchCurrentTemplate({ folder: clean });
        renderLayout();
      });
      folderCreateInput.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
          event.preventDefault();
          folderCreateAdd.click();
        } else if (event.key === "Escape") {
          folderCreateRow.style.display = "none";
          folderEl.value = currentTemplate.folder || "Общие";
        }
        event.stopPropagation();
      });
      var folderCreateCancel = document.createElement("button");
      folderCreateCancel.type = "button";
      folderCreateCancel.className = "btn";
      folderCreateCancel.textContent = "✖";
      folderCreateCancel.title = "Отмена";
      folderCreateCancel.addEventListener("click", function () {
        folderCreateRow.style.display = "none";
        folderEl.value = currentTemplate.folder || "Общие";
      });
      folderCreateRow.appendChild(folderCreateInput);
      folderCreateRow.appendChild(folderCreateAdd);
      folderCreateRow.appendChild(folderCreateCancel);
      folderEl.parentNode.parentNode.insertBefore(folderCreateRow, folderEl.parentNode.nextSibling);
      domainsEl.addEventListener("input", function () {
        patchCurrentTemplate({
          domains: domainsEl.value
            .split("\n")
            .map(function (line) {
              return line.trim().toLowerCase();
            })
            .filter(Boolean)
        });
      });
      bodyEl.addEventListener("input", function () {
        patchCurrentTemplate({ body: bodyEl.value });
        renderDraftTemplatePreview();
        refreshTokenParse();
        refreshBodyStats();
        updateSuggest();
      });
      bodyEl.addEventListener("click", function () {
        updateSuggest();
      });
      bodyEl.addEventListener("blur", function () {
        window.setTimeout(closeSuggest, 150);
      });
      previewElLocal.addEventListener("change", function () {
        patchCurrentTemplate({ previewBeforeInsert: previewElLocal.checked });
      });

      randomBtnEl.addEventListener("click", function () {
        renderDraftTemplatePreview();
      });

      renderDraftTemplatePreview();
      refreshTagWarning(currentTemplate.tag);
      refreshTokenParse();

      var help = document.createElement("div");
      help.className = "help muted";
      help.style.marginTop = "12px";
      help.innerHTML =
        'Как использовать: <code>' +
        escapeHtml(draft.triggerPrefix) +
        'tag</code> + пробел. Также вводите <code>/буква</code> для быстрого списка тегов. Для папок и навигации по папкам используйте <code>//</code>.<br>' +
        variablesGuide +
        '<br>Домены шаблона: пусто = из настроек папки (⚙️), там пусто = на всех сайтах. Например <code>t.me</code> = t.me и все поддомены.';
      target.appendChild(help);
      // v3.10.0: модалка настроек папки поверх всего.
      renderFolderModal();
    }

    function renderVariablesTab(target) {
      var variablesGuide =
        "<b>Что можно использовать в значении переменной:</b><br>" +
        "<code>{{name}}</code>, <code>{{surname}}</code>, <code>{{fullname}}</code>, <code>{{company}}</code>, <code>{{position}}</code>, <code>{{email}}</code>, <code>{{phone}}</code>.<br>" +
        "Все семь берутся из активной записи категории-владельца (База данных; человека при вставке можно выбрать другого).<br>" +
        "<code>{{date}}</code>, <code>{{date+N}}</code>, <code>{{date-N}}</code>.<br>" +
        "<code>{{datetoday}}</code>, <code>{{datetoday+N}}</code>, <code>{{datetoday-N}}</code>.<br>" +
        "<code>{{time}}</code>, <code>{{time+N}}</code>, <code>{{time-N}}</code>.<br>" +
        "<code>{{timetoday}}</code>, <code>{{timetoday+N}}</code>, <code>{{timetoday-N}}</code>.<br>" +
        "<code>{{pick:a|b|c}}</code>, <code>{{upper:text}}</code>, <code>{{lower:TEXT}}</code>.<br>" +
        "<code>{{calc:expr}}</code> - формулы для расчетов (например <code>{{calc:summa*0.2}}</code>).";

      target.innerHTML = '<div class="section-title">Пользовательские переменные</div>';
      var split = document.createElement("div");
      split.className = "split";
      target.appendChild(split);

      var left = document.createElement("div");
      left.className = "panel";
      split.appendChild(left);

      var actions = document.createElement("div");
      actions.className = "actions";
      actions.style.marginBottom = "8px";
      left.appendChild(actions);

      var addBtn = document.createElement("button");
      addBtn.className = "btn";
      addBtn.textContent = "+ Переменная";
      addBtn.addEventListener("click", function () {
        var next = { id: "var-" + Date.now(), name: "new_var", value: "" };
        draft.customVariables.unshift(next);
        selectedVariableId = next.id;
        renderLayout();
      });
      actions.appendChild(addBtn);

      var delBtn = document.createElement("button");
      delBtn.className = "btn danger";
      delBtn.textContent = "Удалить";
      delBtn.addEventListener("click", function () {
        var current = selectedVariable();
        if (!current) {
          return;
        }
        if (!window.confirm("Удалить переменную: " + current.name + "?")) {
          return;
        }
        draft.customVariables = draft.customVariables.filter(function (item) {
          return item.id !== current.id;
        });
        selectedVariableId = draft.customVariables[0] ? draft.customVariables[0].id : "";
        dbCat = "people";
        dbRecId = "";
        dbRenamingCat = null;
        renderLayout();
      });
      actions.appendChild(delBtn);

      var list = document.createElement("div");
      list.className = "list";
      left.appendChild(list);

      draft.customVariables.forEach(function (item) {
        var row = document.createElement("button");
        row.type = "button";
        row.className = item.id === selectedVariableId ? "row active" : "row";
        row.textContent = item.name;
        var meta = document.createElement("small");
        // v3.2.0: счетчик использования.
        var usedIn = draft.templates.filter(function (tpl) {
          return String(tpl.body || "").indexOf("{{" + item.name) !== -1;
        }).length;
        meta.textContent = (item.value || "Пустое значение") + " • используется: " + usedIn;
        if (usedIn === 0) {
          meta.style.color = "#fbbf24";
        }
        row.appendChild(meta);
        row.addEventListener("click", function () {
          selectedVariableId = item.id;
          renderLayout();
        });
        list.appendChild(row);
      });

      var right = document.createElement("div");
      right.className = "panel";
      split.appendChild(right);

      var current = selectedVariable();
      if (!current) {
        right.innerHTML = '<p class="muted">Добавьте переменную.</p>';
        return;
      }

      right.innerHTML =
        '<div class="line2">' +
        '<input id="v-name" class="field" placeholder="Имя переменной, например summa" />' +
        '<input id="v-usage" class="field" readonly />' +
        "</div>" +
        '<div style="margin-top:8px"><textarea id="v-value" class="field" style="min-height:120px" placeholder="Значение. Можно писать формулы и стандартные функции."></textarea></div>' +
        '<p class="muted" style="margin-top:8px">Примеры: <code>150000</code>, <code>{{calc:summa*0.2}}</code>, <code>{{date+3}}</code>, <code>{{pick:да|нет}}</code>.</p>';

      var nameEl = right.querySelector("#v-name");
      var usageEl = right.querySelector("#v-usage");
      var valueEl = right.querySelector("#v-value");
      nameEl.value = current.name;
      valueEl.value = current.value;
      usageEl.value = "{{" + current.name + "}}";

      function saveVariable() {
        var cleaned = nameEl.value.replace(/\s+/g, "_").toLowerCase() || "new_var";
        draft.customVariables = draft.customVariables.map(function (item) {
          if (item.id !== current.id) {
            return item;
          }
          return { id: item.id, name: cleaned, value: valueEl.value };
        });
        usageEl.value = "{{" + cleaned + "}}";
      }

      nameEl.addEventListener("input", saveVariable);
      valueEl.addEventListener("input", saveVariable);

      var help = document.createElement("div");
      help.className = "help muted";
      help.style.marginTop = "12px";
      help.innerHTML =
        'Создавайте переменные как <code>имя = значение</code>. Использование в шаблоне: <code>{{your_name}}</code>.<br>' +
        variablesGuide +
        '<br>Подсказка: для бухгалтерии создайте <code>summa</code>, <code>nds</code>, <code>itogo</code> и используйте их в формулах.';
      target.appendChild(help);
    }

    // v3.4.0: вкладка Папки удалена — общие операции с папками для дерева и редактора.
    function setFolderMode(folder, mode) {
      draft.folderPreferences = (draft.folderPreferences || []).filter(function (item) {
        return item.name !== folder;
      });
      if (mode !== "default") {
        draft.folderPreferences.push({ name: folder, mode: mode });
      }
    }

    function createFolderInDraft(name) {
      var clean = String(name || "").trim();
      if (!clean) {
        return "";
      }
      if (!draft.folders.some(function (f) { return f === clean; })) {
        draft.folders.push(clean);
      }
      return clean;
    }

    function renameFolderInDraft(oldName, newName) {
      var next = String(newName || "").trim();
      if (!next || next === oldName) {
        return oldName;
      }
      // v3.10.0: вместе с папкой едут и ее домены.
      // v3.11.0: режимы и иконки — тоже.
      ["folderDomains", "folderDomainModes", "folderIcons"].forEach(function (k) {
        if (!draft[k] || typeof draft[k] !== "object" || Array.isArray(draft[k])) {
          draft[k] = {};
        }
      });
      var fd = draft.folderDomains;
      if (Object.prototype.hasOwnProperty.call(fd, oldName)) {
        fd[next] = fd[oldName];
        delete fd[oldName];
      }
      ["folderDomainModes", "folderIcons"].forEach(function (k) {
        if (Object.prototype.hasOwnProperty.call(draft[k], oldName)) {
          draft[k][next] = draft[k][oldName];
          delete draft[k][oldName];
        }
      });
      draft.folders = folderListFrom(draft).map(function (f) {
        return f === oldName ? next : f;
      });
      draft.folderPreferences = (draft.folderPreferences || []).map(function (item) {
        if (item.name !== oldName) {
          return item;
        }
        return { name: next, mode: item.mode };
      });
      draft.templates = draft.templates.map(function (tpl) {
        return tpl.folder === oldName
          ? {
              id: tpl.id,
              name: tpl.name,
              tag: tpl.tag,
              folder: next,
              domains: tpl.domains || [],
              body: tpl.body,
              images: tpl.images,
              previewBeforeInsert: tpl.previewBeforeInsert === true
            }
          : tpl;
      });
      return next;
    }

    function deleteFolderFromDraft(folder) {
      if (folder === "Общие") {
        return;
      }
      // v3.10.0: домены папки удаляются вместе с ней.
      // v3.11.0: режимы и иконки — тоже.
      ["folderDomains", "folderDomainModes", "folderIcons"].forEach(function (k) {
        if (!draft[k] || typeof draft[k] !== "object" || Array.isArray(draft[k])) {
          draft[k] = {};
        }
      });
      var fd = draft.folderDomains;
      if (Object.prototype.hasOwnProperty.call(fd, folder)) {
        delete fd[folder];
      }
      ["folderDomainModes", "folderIcons"].forEach(function (k) {
        if (Object.prototype.hasOwnProperty.call(draft[k], folder)) {
          delete draft[k][folder];
        }
      });
      draft.folders = draft.folders.filter(function (f) {
        return f !== folder;
      });
      draft.folderPreferences = (draft.folderPreferences || []).filter(function (item) {
        return item.name !== folder;
      });
      draft.templates = draft.templates.map(function (tpl) {
        return tpl.folder === folder
          ? {
              id: tpl.id,
              name: tpl.name,
              tag: tpl.tag,
              folder: "Общие",
              domains: tpl.domains || [],
              body: tpl.body,
              images: tpl.images,
              previewBeforeInsert: tpl.previewBeforeInsert === true
            }
          : tpl;
      });
    }

    // v3.7.0: справочники — произвольные категории записей (клиенты, проекты, ...).
    // Адресация как у людей: {{поле:тег}}. Люди проверяются первыми для совместимости.
    function renderGeneralTab(target) {
      target.innerHTML = '<div class="section-title">База данных</div>';
      // v3.9.0: единая База данных. ЛЮДИ — защищенная категория по умолчанию
      // (без тега {{name}} берет активного); остальные категории — свои справочники.
      // Активная запись есть в КАЖДОЙ категории и подставляется для ее полей без тега.
      function dbDescriptor() {
        if (dbCat !== "people") {
          for (var i = 0; i < draft.recordSets.length; i += 1) {
            if (draft.recordSets[i].id === dbCat) {
              return { kind: "set", set: draft.recordSets[i] };
            }
          }
        }
        return { kind: "people" };
      }

      function dbRecords(d) {
        if (d.kind === "people") {
          return draft.profiles;
        }
        if (d.set && Array.isArray(d.set.records)) {
          return d.set.records;
        }
        return [];
      }

      function dbFields(d) {
        if (d.kind === "people") {
          return draft.profileFields;
        }
        if (d.set && Array.isArray(d.set.fields)) {
          return d.set.fields;
        }
        return [];
      }

      function dbActiveId(d) {
        if (d.kind === "people") {
          return draft.activeProfileId;
        }
        if (d.set) {
          var recs = dbRecords(d);
          for (var i = 0; i < recs.length; i += 1) {
            if (recs[i].id === d.set.activeRecordId) {
              return d.set.activeRecordId;
            }
          }
          return recs[0] ? recs[0].id : "";
        }
        return "";
      }

      function dbSetActive(d, id) {
        if (d.kind === "people") {
          draft.activeProfileId = id;
        } else if (d.set) {
          d.set.activeRecordId = id;
        }
      }

      function dbSelectedRec(d) {
        var recs = dbRecords(d);
        for (var i = 0; i < recs.length; i += 1) {
          if (recs[i].id === dbRecId) {
            return recs[i];
          }
        }
        return recs[0] || null;
      }

      function dbValues(d, rec) {
        if (!rec) {
          return {};
        }
        if (d.kind === "people") {
          if (!rec.fields || typeof rec.fields !== "object") {
            rec.fields = {};
          }
          return rec.fields;
        }
        if (!rec.values || typeof rec.values !== "object") {
          rec.values = {};
        }
        return rec.values;
      }

      function dbDisplay(d, rec) {
        if (d.kind === "people") {
          return profileDisplayName(rec);
        }
        return rec.tag ? "@" + rec.tag : "(без тега)";
      }

      function dbNewRecord(d) {
        if (d.kind === "people") {
          return { id: "prof-" + Date.now(), tag: "", name: "", surname: "", email: "", phone: "", company: "", position: "", fields: {} };
        }
        return { id: "rec-" + Date.now(), tag: "", values: {} };
      }

      // --- переключатель категорий ---
      var catLine = document.createElement("div");
      catLine.className = "line3";
      var catSelect = document.createElement("select");
      catSelect.className = "field";
      var peopleOpt = document.createElement("option");
      peopleOpt.value = "people";
      peopleOpt.textContent = "ЛЮДИ (" + draft.profiles.length + ")";
      if (dbCat === "people") {
        peopleOpt.selected = true;
      }
      catSelect.appendChild(peopleOpt);
      draft.recordSets.forEach(function (s) {
        var o = document.createElement("option");
        o.value = s.id;
        o.textContent = s.name + " (" + (s.records ? s.records.length : 0) + ")";
        if (dbCat === s.id) {
          o.selected = true;
        }
        catSelect.appendChild(o);
      });
      catSelect.addEventListener("change", function () {
        dbCat = catSelect.value;
        dbRecId = "";
        dbRenamingCat = null;
        renderLayout();
      });
      var addCatBtn = document.createElement("button");
      addCatBtn.className = "btn";
      addCatBtn.textContent = "+ Категория";
      addCatBtn.addEventListener("click", function () {
        var base = "Новая категория";
        var name = base;
        var i = 2;
        while (draft.recordSets.some(function (s) { return s.name === name; })) {
          name = base + " " + i;
          i += 1;
        }
        var next = { id: "set-" + Date.now(), name: name, fields: [], records: [], activeRecordId: "" };
        draft.recordSets.push(next);
        dbCat = next.id;
        dbRecId = "";
        dbRenamingCat = next.id;
        renderLayout();
      });
      catLine.appendChild(catSelect);
      catLine.appendChild(addCatBtn);
      var desc0 = dbDescriptor();
      if (desc0.kind === "set") {
        (function (set0) {
          var renameCatBtn = document.createElement("button");
          renameCatBtn.className = "btn";
          renameCatBtn.textContent = "✏️";
          renameCatBtn.title = "Переименовать категорию";
          renameCatBtn.addEventListener("click", function () {
            dbRenamingCat = set0.id;
            renderLayout();
          });
          var delCatBtn = document.createElement("button");
          delCatBtn.className = "btn danger";
          delCatBtn.textContent = "🗑";
          delCatBtn.title = "Удалить категорию со всеми записями";
          delCatBtn.addEventListener("click", function () {
            if (!window.confirm("Удалить категорию '" + set0.name + "' со всеми записями и полями?")) {
              return;
            }
            draft.recordSets = draft.recordSets.filter(function (s) {
              return s.id !== set0.id;
            });
            dbCat = "people";
            dbRecId = "";
            renderLayout();
          });
          catLine.appendChild(renameCatBtn);
          catLine.appendChild(delCatBtn);
        })(desc0.set);
      } else {
        var lockNote = document.createElement("span");
        lockNote.className = "muted";
        lockNote.style.alignSelf = "center";
        lockNote.textContent = "категория по умолчанию, удалить нельзя";
        catLine.appendChild(lockNote);
      }
      target.appendChild(catLine);

      var desc = dbDescriptor();
      if (dbRenamingCat && desc.kind === "set" && desc.set.id === dbRenamingCat) {
        (function (set0) {
          var renameLine = document.createElement("div");
          renameLine.className = "line3";
          renameLine.style.marginTop = "8px";
          var renameInput = document.createElement("input");
          renameInput.className = "field";
          renameInput.value = set0.name;
          var renameOk = document.createElement("button");
          renameOk.className = "btn";
          renameOk.textContent = "✔";
          renameOk.addEventListener("click", function () {
            set0.name = renameInput.value.trim() || set0.name;
            dbRenamingCat = null;
            renderLayout();
          });
          renameInput.addEventListener("keydown", function (event) {
            if (event.key === "Enter") {
              event.preventDefault();
              renameOk.click();
            } else if (event.key === "Escape") {
              dbRenamingCat = null;
              renderLayout();
            }
            event.stopPropagation();
          });
          var renameCancel = document.createElement("button");
          renameCancel.className = "btn";
          renameCancel.textContent = "✖";
          renameCancel.addEventListener("click", function () {
            dbRenamingCat = null;
            renderLayout();
          });
          renameLine.appendChild(renameInput);
          renameLine.appendChild(renameOk);
          renameLine.appendChild(renameCancel);
          target.appendChild(renameLine);
          window.setTimeout(function () {
            try {
              renameInput.focus();
              renameInput.select();
            } catch (e) { /* ignore */ }
          }, 0);
        })(desc.set);
      }

      // --- записи категории ---
      var recSplit = document.createElement("div");
      recSplit.className = "split";
      recSplit.style.marginTop = "10px";
      target.appendChild(recSplit);

      var recLeft = document.createElement("div");
      recLeft.className = "panel";
      recSplit.appendChild(recLeft);

      var recActions = document.createElement("div");
      recActions.className = "actions";
      recActions.style.marginBottom = "8px";
      recLeft.appendChild(recActions);

      var addRecBtn = document.createElement("button");
      addRecBtn.className = "btn";
      addRecBtn.textContent = "+ Запись";
      addRecBtn.addEventListener("click", function () {
        var next = dbNewRecord(desc);
        dbRecords(desc).push(next);
        dbRecId = next.id;
        renderLayout();
      });
      recActions.appendChild(addRecBtn);

      var dupRecBtn = document.createElement("button");
      dupRecBtn.className = "btn";
      dupRecBtn.textContent = "Дублировать";
      dupRecBtn.addEventListener("click", function () {
        var cur = dbSelectedRec(desc);
        if (!cur) {
          return;
        }
        var copy = JSON.parse(JSON.stringify(cur));
        copy.id = (desc.kind === "people" ? "prof-" : "rec-") + Date.now();
        if (desc.kind === "set" && copy.tag) {
          copy.tag = copy.tag + "2";
        }
        dbRecords(desc).push(copy);
        dbRecId = copy.id;
        renderLayout();
      });
      recActions.appendChild(dupRecBtn);

      var delRecBtn = document.createElement("button");
      delRecBtn.className = "btn danger";
      delRecBtn.textContent = "Удалить";
      delRecBtn.addEventListener("click", function () {
        var cur = dbSelectedRec(desc);
        if (!cur) {
          return;
        }
        if (desc.kind === "people" && dbRecords(desc).length <= 1) {
          window.alert("Нужен хотя бы один человек.");
          return;
        }
        if (!window.confirm("Удалить: " + dbDisplay(desc, cur) + "?")) {
          return;
        }
        var recs = dbRecords(desc);
        var at = recs.indexOf(cur);
        recs.splice(at, 1);
        if (desc.kind === "people" && draft.activeProfileId === cur.id) {
          draft.activeProfileId = recs[0] ? recs[0].id : "";
        }
        if (desc.kind === "set" && desc.set.activeRecordId === cur.id) {
          desc.set.activeRecordId = recs[0] ? recs[0].id : "";
        }
        dbRecId = "";
        renderLayout();
      });
      recActions.appendChild(delRecBtn);

      var recList = document.createElement("div");
      recList.className = "list";
      recLeft.appendChild(recList);

      var curSel = dbSelectedRec(desc);
      var curSelId = curSel ? curSel.id : "";
      var activeId = dbActiveId(desc);
      var recTagCounts = {};
      dbRecords(desc).forEach(function (r) {
        var k = tagKey(r.tag);
        if (k) {
          recTagCounts[k] = (recTagCounts[k] || 0) + 1;
        }
      });
      dbRecords(desc).forEach(function (r) {
        var row = document.createElement("button");
        row.type = "button";
        row.className = r.id === curSelId ? "row active" : "row";
        row.textContent = dbDisplay(desc, r);
        var meta = document.createElement("small");
        var bits = [];
        if (r.id === activeId) {
          bits.push("★ активная — подставляется без тега");
        }
        if (desc.kind === "people") {
          if (r.tag) {
            bits.push("тег: " + r.tag);
          }
          if (r.position) {
            bits.push(r.position);
          }
          if (r.phone) {
            bits.push(r.phone);
          }
        } else {
          var filled = dbFields(desc).filter(function (f) {
            return String(dbValues(desc, r)[f.name] || "").trim();
          }).length;
          bits.push("заполнено " + filled + "/" + dbFields(desc).length);
        }
        if (r.tag && recTagCounts[tagKey(r.tag)] > 1) {
          bits.push("⚠ дубль тега!");
        }
        meta.textContent = bits.join(" • ") || "Заполните данные справа";
        if (r.id === activeId) {
          meta.style.color = "#6ee7b7";
        } else if (r.tag && recTagCounts[tagKey(r.tag)] > 1) {
          meta.style.color = "#fbbf24";
        }
        row.appendChild(meta);
        row.addEventListener("click", function () {
          dbRecId = r.id;
          renderLayout();
        });
        recList.appendChild(row);
      });
      if (!dbRecords(desc).length) {
        var noRecs = document.createElement("div");
        noRecs.className = "muted";
        noRecs.style.padding = "10px";
        noRecs.textContent = "Записей нет — нажмите + Запись.";
        recList.appendChild(noRecs);
      }

      var recRight = document.createElement("div");
      recRight.className = "panel";
      recSplit.appendChild(recRight);

      var cur = dbSelectedRec(desc);
      if (!cur) {
        recRight.innerHTML = '<p class="muted">Добавьте запись.</p>';
      } else {
        (function (rec) {
          var html =
            (desc.kind === "people"
              ? '<div class="line2">' +
                '<input id="db-name" class="field" placeholder="Имя ({{name}})" />' +
                '<input id="db-surname" class="field" placeholder="Фамилия ({{surname}})" />' +
                "</div>" +
                '<div class="line2" style="margin-top:8px">' +
                '<input id="db-company" class="field" placeholder="Компания ({{company}})" />' +
                '<input id="db-position" class="field" placeholder="Должность ({{position}})" />' +
                "</div>" +
                '<div class="line2" style="margin-top:8px">' +
                '<input id="db-email" class="field" placeholder="Email ({{email}})" />' +
                '<input id="db-phone" class="field" placeholder="Телефон ({{phone}})" />' +
                "</div>"
              : "") +
            '<div style="margin-top:8px;"><input id="db-tag" class="field" placeholder="Тег записи, например david — для {{поле:david}}" /></div>' +
            '<div id="db-tagwarn" class="muted" style="margin-top:4px"></div>' +
            '<div id="db-fields" style="margin-top:8px;display:grid;gap:8px;"></div>' +
            '<div style="margin-top:8px;"><input id="db-preview" class="field" readonly /></div>' +
            '<div class="actions" style="margin-top:8px"><button id="db-active" class="btn" type="button">★ Сделать активной</button></div>' +
            '<p class="muted" style="margin-top:8px">Активная запись категории подставляется для ее полей без тега. С тегом — конкретная: {{поле:тег}}. У людей без тега работает еще и выбор при вставке.</p>';
          recRight.innerHTML = html;
          var tagInput = recRight.querySelector("#db-tag");
          var tagWarn = recRight.querySelector("#db-tagwarn");
          var fieldsBox = recRight.querySelector("#db-fields");
          var previewInput = recRight.querySelector("#db-preview");
          var activeBtn = recRight.querySelector("#db-active");
          var builtinEls = {};
          if (desc.kind === "people") {
            ["name", "surname", "company", "position", "email", "phone"].forEach(function (k) {
              var el = recRight.querySelector("#db-" + k);
              el.value = rec[k] || "";
              builtinEls[k] = el;
            });
          }
          tagInput.value = rec.tag || "";

          var fieldInputs = {};
          dbFields(desc).forEach(function (f) {
            var wrap = document.createElement("div");
            var lab = document.createElement("label");
            lab.className = "muted";
            lab.textContent = f.name + "  ({{" + f.name + "}} / {{" + f.name + ":" + (tagInput.value || "тег") + "}})";
            var inp = document.createElement("input");
            inp.className = "field";
            inp.style.marginTop = "4px";
            var vals = dbValues(desc, rec);
            inp.value = vals[f.name] != null ? vals[f.name] : "";
            inp.addEventListener("input", saveRec);
            fieldInputs[f.name] = inp;
            wrap.appendChild(lab);
            wrap.appendChild(inp);
            fieldsBox.appendChild(wrap);
          });

          function refreshRecPreview() {
            previewInput.value = desc.kind === "people"
              ? "Подпись: " + profileDisplayName({
                  name: builtinEls.name ? builtinEls.name.value : rec.name,
                  surname: builtinEls.surname ? builtinEls.surname.value : rec.surname,
                  company: builtinEls.company ? builtinEls.company.value : rec.company
                })
              : "Запись: @" + (tagInput.value || "(без тега)") + " (" + desc.set.name + ")";
            var isActive = rec.id === dbActiveId(desc);
            activeBtn.disabled = isActive;
            activeBtn.textContent = isActive ? "★ Активная" : "★ Сделать активной";
          }

          function refreshRecTagWarning() {
            var clean = sanitizeTag(tagInput.value);
            if (!clean) {
              tagWarn.textContent = "Без тега: доступна только как активная своей категории.";
              tagWarn.style.color = "#94a3b8";
              return clean;
            }
            var dupes = dbRecords(desc).filter(function (x) {
              return x.id !== rec.id && tagKey(x.tag) === clean;
            });
            if (dupes.length > 0) {
              tagWarn.textContent = "⚠ Тег «" + clean + "» уже есть в этой категории — возьмется первая запись.";
              tagWarn.style.color = "#fbbf24";
            } else {
              var personHit = desc.kind === "set" ? findProfileByTag(clean, draft.profiles) : null;
              tagWarn.textContent = personHit
                ? "Обращение: {{поле:" + clean + "}} — но человек «" + profileDisplayName(personHit) + "» первичнее."
                : "Обращение: {{поле:" + clean + "}}.";
              tagWarn.style.color = personHit ? "#fbbf24" : "#64748b";
            }
            return clean;
          }

          function saveRec() {
            rec.tag = sanitizeTag(tagInput.value);
            if (desc.kind === "people") {
              Object.keys(builtinEls).forEach(function (k) {
                rec[k] = builtinEls[k].value;
              });
            }
            var vals = dbValues(desc, rec);
            Object.keys(fieldInputs).forEach(function (fname) {
              vals[fname] = fieldInputs[fname].value;
            });
            refreshRecPreview();
          }

          Object.keys(builtinEls).forEach(function (k) {
            builtinEls[k].addEventListener("input", function () {
              saveRec();
            });
          });
          tagInput.addEventListener("input", function () {
            saveRec();
            refreshRecTagWarning();
          });
          activeBtn.addEventListener("click", function () {
            dbSetActive(desc, rec.id);
            renderLayout();
          });
          refreshRecPreview();
          refreshRecTagWarning();
        })(cur);
      }

      // --- поля категории: один набор ключей сразу для всех записей ---
      var fTitle = document.createElement("div");
      fTitle.className = "section-title";
      fTitle.style.marginTop = "14px";
      fTitle.textContent = desc.kind === "people"
        ? "Поля людей (один набор — сразу у всех)"
        : "Поля категории «" + desc.set.name + "» (один набор — сразу у всех записей)";
      target.appendChild(fTitle);
      var fHint = document.createElement("p");
      fHint.className = "muted";
      fHint.style.marginBottom = "10px";
      fHint.textContent = desc.kind === "people"
        ? "Например: telegram, паспорт. Использование: {{telegram}} — у активной записи, {{telegram:david}} — у конкретной. Переименование переносит значения, удаление стирает их у всех."
        : "Например: договор, телефон. Использование: {{договор}} — у активной записи категории, {{договор:acme}} — у конкретной. Переименование переносит значения, удаление стирает их у всех.";
      target.appendChild(fHint);

      var fPanel = document.createElement("div");
      fPanel.className = "panel";
      target.appendChild(fPanel);

      var addLine = document.createElement("div");
      addLine.className = "line3";
      var newInput = document.createElement("input");
      newInput.className = "field";
      newInput.placeholder = "Новое поле, например telegram";
      var newAdd = document.createElement("button");
      newAdd.className = "btn";
      newAdd.textContent = "Добавить";
      function commitNewDbField() {
        var clean = sanitizeProfileFieldName(newInput.value);
        if (!clean) {
          window.alert("Имя поля: латиница/кириллица, цифры и подчеркивание.");
          return;
        }
        if (desc.kind === "people" && profileBuiltinFields().indexOf(clean) !== -1) {
          window.alert("«" + clean + "» уже есть среди встроенных (name, phone, …) — отдельно добавлять не нужно.");
          return;
        }
        if (dbFields(desc).some(function (f) { return f.name === clean; })) {
          window.alert("Такое поле уже есть.");
          return;
        }
        dbFields(desc).push({ id: "df-" + Date.now(), name: clean });
        renderLayout();
      }
      newAdd.addEventListener("click", commitNewDbField);
      newInput.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
          event.preventDefault();
          commitNewDbField();
        }
        event.stopPropagation();
      });
      var newClear = document.createElement("button");
      newClear.className = "btn";
      newClear.textContent = "Очистить";
      newClear.addEventListener("click", function () {
        newInput.value = "";
      });
      addLine.appendChild(newInput);
      addLine.appendChild(newAdd);
      addLine.appendChild(newClear);
      fPanel.appendChild(addLine);

      var fList = document.createElement("div");
      fList.style.marginTop = "10px";
      fList.style.display = "grid";
      fList.style.gap = "8px";
      fPanel.appendChild(fList);

      if (desc.kind === "people") {
        var builtinNote = document.createElement("p");
        builtinNote.className = "muted";
        builtinNote.textContent = "Встроенные (всегда есть): name, surname, fullname, company, position, email, phone.";
        fList.appendChild(builtinNote);
      }
      if (!dbFields(desc).length && desc.kind !== "people") {
        var noFields = document.createElement("p");
        noFields.className = "muted";
        noFields.textContent = "Полей пока нет — добавьте первое.";
        fList.appendChild(noFields);
      }
      dbFields(desc).forEach(function (f) {
        var row = document.createElement("div");
        row.style.display = "grid";
        row.style.gap = "8px";
        row.style.gridTemplateColumns = "1fr auto auto";
        var inp = document.createElement("input");
        inp.className = "field";
        inp.value = f.name;
        inp.title = "Переименование перенесет значения у всех записей";
        var usage = document.createElement("span");
        usage.className = "muted";
        usage.style.alignSelf = "center";
        var filled = dbRecords(desc).filter(function (r) {
          return String(dbValues(desc, r)[f.name] || "").trim();
        }).length;
        usage.textContent = "заполнено: " + filled + "/" + dbRecords(desc).length;
        var del = document.createElement("button");
        del.className = "btn danger";
        del.textContent = "Удалить";
        del.addEventListener("click", function () {
          if (!window.confirm("Удалить поле «" + f.name + "» у всех записей? Значения пропадут.")) {
            return;
          }
          var arr = dbFields(desc);
          var at = arr.indexOf(f);
          if (at !== -1) {
            arr.splice(at, 1);
          }
          dbRecords(desc).forEach(function (r) {
            var vals = dbValues(desc, r);
            if (Object.prototype.hasOwnProperty.call(vals, f.name)) {
              delete vals[f.name];
            }
          });
          renderLayout();
        });
        inp.addEventListener("change", function () {
          var clean = sanitizeProfileFieldName(inp.value);
          if (!clean) {
            renderLayout();
            return;
          }
          if (desc.kind === "people" && profileBuiltinFields().indexOf(clean) !== -1) {
            window.alert("«" + clean + "» — встроенное поле, такое имя занято.");
            renderLayout();
            return;
          }
          if (dbFields(desc).some(function (x) { return x !== f && x.name === clean; })) {
            window.alert("Такое поле уже есть.");
            renderLayout();
            return;
          }
          if (clean !== f.name) {
            dbRecords(desc).forEach(function (r) {
              var vals = dbValues(desc, r);
              if (Object.prototype.hasOwnProperty.call(vals, f.name)) {
                vals[clean] = vals[f.name];
                delete vals[f.name];
              }
            });
            f.name = clean;
          }
          renderLayout();
        });
        row.appendChild(inp);
        row.appendChild(usage);
        row.appendChild(del);
        fList.appendChild(row);
      });

      var dbHelp = document.createElement("div");
      dbHelp.className = "help muted";
      dbHelp.style.marginTop = "12px";
      dbHelp.innerHTML =
        "ЛЮДИ — категория по умолчанию: активный подставляется без тега ({{phone}}). " +
        "У каждой категории есть активная запись: ее поля тоже работают без тега ({{договор}} — у активной). " +
        "С тегом — конкретная запись любой категории: {{поле:тег}}. " +
        "Выбор при вставке {{поле:#}} — из всех значений, {{поле:#группа}} — связанные по одной записи. " +
        "При совпадении тега человек первичнее записи.";
      target.appendChild(dbHelp);



      var otherTitle = document.createElement("div");
      otherTitle.className = "section-title";
      otherTitle.style.marginTop = "14px";
      otherTitle.textContent = "Прочее";
      target.appendChild(otherTitle);

      var panel = document.createElement("div");
      panel.className = "panel";
      target.appendChild(panel);

      panel.innerHTML =
        '<div class="line2">' +
        '<input id="g-prefix" class="field" placeholder="Префикс тега" />' +
        '<input id="g-delay" class="field" type="number" min="0" placeholder="Задержка печати (мс)" />' +
        "</div>";

      var prefixEl = panel.querySelector("#g-prefix");
      var delayEl = panel.querySelector("#g-delay");

      prefixEl.value = draft.triggerPrefix;
      delayEl.value = String(draft.typingDelay || 0);

      function saveGeneral() {
        draft.triggerPrefix = prefixEl.value || "/";
        draft.typingDelay = Math.max(0, Number(delayEl.value) || 0);
      }

      [prefixEl, delayEl].forEach(function (el) {
        el.addEventListener("input", saveGeneral);
        el.addEventListener("change", saveGeneral);
      });

      // v3.2.0: бэкапы с откатом.
      var backupTitle = document.createElement("div");
      backupTitle.className = "section-title";
      backupTitle.style.marginTop = "14px";
      backupTitle.textContent = "Бэкапы (последние " + MAX_BACKUPS + ", создаются при каждом сохранении)";
      target.appendChild(backupTitle);
      var backups = listBackups();
      if (!backups.length) {
        var noBackups = document.createElement("p");
        noBackups.className = "muted";
        noBackups.textContent = "Бэкапов пока нет — появятся после первого сохранения.";
        target.appendChild(noBackups);
      }
      backups.forEach(function (stamp) {
        var row = document.createElement("div");
        row.className = "backup";
        var label = document.createElement("span");
        label.className = "muted";
        label.textContent = String(stamp).replace("T", " ").slice(0, 19);
        label.title = stamp;
        var btns = document.createElement("div");
        btns.className = "actions";
        var restoreBtn = document.createElement("button");
        restoreBtn.className = "btn";
        restoreBtn.textContent = "Восстановить";
        restoreBtn.addEventListener("click", function () {
          if (!window.confirm("Загрузить бэкап " + stamp + " в черновик? Текущий черновик будет заменен.")) {
            return;
          }
          restoreBackup(stamp);
        });
        btns.appendChild(restoreBtn);
        row.appendChild(label);
        row.appendChild(btns);
        target.appendChild(row);
      });
    }

    // v3.2.0: хоткеи настроек — Ctrl+S сохранить, "/" в поиск шаблонов.
    // v3.11.0: слушаем на корне настроек (пузырек) и глушим всплытие дальше:
    // страница-хост живет в том же документе, и ее однобуквенные хоткеи (h, / и т.д.)
    // перехватывали печать в наших полях. Наши обработчики на полях уже отработали
    // (они глубже), а preventDefault НЕ зовем — ввод не ломаем, только режем путь наверх.
    ["keydown", "keypress", "keyup"].forEach(function (type) {
      root.addEventListener(type, function (event) {
        try {
          // v3.3.0: события из Shadow DOM ретаргетятся на хост — берем реальную цель через composedPath.
          var realTarget = event.target;
          try {
            if (event.composedPath && event.composedPath().length) {
              realTarget = event.composedPath()[0];
            }
          } catch (e) { /* ignore */ }
          var inField = realTarget && realTarget.matches &&
            realTarget.matches("input, textarea, select, [contenteditable=true]");
          if (type === "keydown") {
            if ((event.ctrlKey || event.metaKey) && String(event.key || "").toLowerCase() === "s") {
              event.preventDefault();
              persistDraftToConfig();
              window.alert("Изменения сохранены, предыдущая версия — в бэкапах (База данных)");
              renderLayout();
              event.stopPropagation();
              return;
            }
            if (event.key === "/" && !inField) {
              var searchField = root.querySelector('input[placeholder="Поиск шаблона"]');
              if (searchField) {
                if (activeTab !== "templates") {
                  activeTab = "templates";
                  renderLayout();
                  searchField = root.querySelector('input[placeholder="Поиск шаблона"]');
                }
                event.preventDefault();
                if (searchField) {
                  searchField.focus();
                }
              }
            }
          }
          event.stopPropagation();
        } catch (error) {
          /* ignore */
        }
      });
    });

    renderLayout();
  }
})();