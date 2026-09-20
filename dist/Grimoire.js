/*:
 * @target MZ
 * @plugindesc Grimoire — 游戏内悬浮窗修改器 + AI 翻译，MV / MZ 通用。
 * @author Liset
 * @help 面板快捷键 Insert，手机用悬浮按钮。说明见 README.md。
 * 放在插件列表最后，这样它的钩子能包住其他插件。
 *
 * @param hotkey
 * @text 快捷键
 * @desc 开关面板的按键（PC）。填 KeyboardEvent 的 key 或 code，留空则禁用。
 * @default Insert
 *
 * @param buttonOpacity
 * @text 悬浮按钮透明度
 * @desc 0.1 ~ 1.0
 * @default 0.75
 *
 * @param startHidden
 * @text 启动时隐藏按钮
 * @desc 为 true 时只能用快捷键呼出。
 * @type boolean
 * @default false
 */

(() => {
"use strict";

const G = {
    version: "0.4.0",
    tabs: [],
    state: {},
    ui: null
};
window.Grimoire = G;

const Env = (() => {
    const name = (typeof Utils !== "undefined" && Utils.RPGMAKER_NAME) || "";
    const isMZ = name === "MZ" || typeof Scene_Boot !== "undefined" && typeof ColorManager !== "undefined";
    return {
        name: name || (isMZ ? "MZ" : "MV"),
        isMZ: isMZ,
        isMV: !isMZ,
        version: (typeof Utils !== "undefined" && Utils.RPGMAKER_VERSION) || "?",
        isNwjs: typeof Utils !== "undefined" && Utils.isNwjs && Utils.isNwjs(),
        isMobile: typeof Utils !== "undefined" && Utils.isMobileDevice && Utils.isMobileDevice()
    };
})();
G.env = Env;

const U = {

    el(tag, attrs, children) {
        const n = document.createElement(tag);
        if (attrs) {
            for (const k in attrs) {
                const v = attrs[k];
                if (v === null || v === undefined) continue;
                if (k === "style" && typeof v === "object") Object.assign(n.style, v);
                else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
                else if (k === "text") n.textContent = v;
                else n.setAttribute(k, v);
            }
        }
        for (const c of [].concat(children || [])) {
            if (c === null || c === undefined || c === false) continue;
            n.appendChild(typeof c === "object" ? c : document.createTextNode(String(c)));
        }
        return n;
    },

    clamp(v, lo, hi) {
        return Math.max(lo, Math.min(hi, v));
    },

    int(v, fallback) {
        const n = parseInt(String(v).trim(), 10);
        return Number.isFinite(n) ? n : (fallback || 0);
    },

    match(text, query) {
        if (!query) return true;
        return String(text || "").toLowerCase().includes(query.toLowerCase());
    },

    plain(s) {
        return String(s || "").replace(/\\[a-zA-Z]+\[[^\]]*\]/g, "").replace(/\\[a-zA-Z]+/g, "");
    },

    toast(msg, kind) {
        const root = G.ui && G.ui.root;
        if (!root) return;
        const t = U.el("div", { class: "gm-toast gm-toast--" + (kind || "ok"), text: msg });
        root.appendChild(t);
        setTimeout(() => t.classList.add("gm-toast--in"), 10);
        setTimeout(() => {
            t.classList.remove("gm-toast--in");
            setTimeout(() => t.remove(), 300);
        }, 1800);
    },

    inGame() {
        return typeof $gameParty !== "undefined" && !!$gameParty && !!$gameSwitches;
    },

    sceneName() {
        return (typeof SceneManager !== "undefined" && SceneManager._scene &&
            SceneManager._scene.constructor.name) || "-";
    },

    inBattle() {
        return typeof $gameParty !== "undefined" && $gameParty.inBattle && $gameParty.inBattle();
    }
};
G.util = U;

const Store = (() => {
    let cache = null, cachedKey = null;

    function keyOf() {
        return "grimoire:" + ((typeof $dataSystem !== "undefined" && $dataSystem &&
            $dataSystem.gameTitle) || "default");
    }

    function load() {
        const k = keyOf();
        if (cache && cachedKey === k) return cache;
        cachedKey = k;
        try {
            cache = JSON.parse(localStorage.getItem(k) || "{}");
        } catch (e) {
            cache = {};
        }
        return cache;
    }

    const GKEY = "grimoire:global";
    let gcache = null;

    function gload() {
        if (gcache) return gcache;
        try {
            gcache = JSON.parse(localStorage.getItem(GKEY) || "{}");
        } catch (e) {
            gcache = {};
        }
        return gcache;
    }

    return {
        key: keyOf,
        get(k, dflt) {
            const v = load()[k];
            return v === undefined ? dflt : v;
        },
        set(k, v) {
            load()[k] = v;
            try {
                localStorage.setItem(cachedKey, JSON.stringify(cache));
            } catch (e) {  }
        },
        gget(k, dflt) {
            const v = gload()[k];
            return v === undefined ? dflt : v;
        },
        gset(k, v) {
            gload()[k] = v;
            try {
                localStorage.setItem(GKEY, JSON.stringify(gcache));
            } catch (e) {  }
        }
    };
})();
G.store = Store;

const RM = {

    saveGame(id) {
        try {
            const r = DataManager.saveGame(id);
            return (r && typeof r.then === "function") ? r : Promise.resolve(!!r);
        } catch (e) {
            return Promise.reject(e);
        }
    },

    loadGame(id) {
        try {
            const r = DataManager.loadGame(id);
            return (r && typeof r.then === "function") ? r : Promise.resolve(!!r);
        } catch (e) {
            return Promise.reject(e);
        }
    },

    setItemCount(item, n) {
        if (!item) return;
        const box = $gameParty.itemContainer ? $gameParty.itemContainer(item) : null;
        if (box) {
            if (n <= 0) delete box[item.id];
            else box[item.id] = n;
        } else {

            $gameParty.gainItem(item, n - $gameParty.numItems(item));
        }
    },

    itemLists() {
        return [
            { key: "item", label: "道具", data: $dataItems },
            { key: "weapon", label: "武器", data: $dataWeapons },
            { key: "armor", label: "防具", data: $dataArmors }
        ];
    },

    mapName(id) {
        const info = (typeof $dataMapInfos !== "undefined" && $dataMapInfos && $dataMapInfos[id]) || null;
        return info && info.name ? info.name : "Map" + String(id).padStart(3, "0");
    },

    fetchData(src) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("GET", "data/" + src);
            xhr.overrideMimeType("application/json");
            xhr.onload = () => {

                if (xhr.status >= 400) return reject(new Error("HTTP " + xhr.status));
                try {
                    resolve(JSON.parse(xhr.responseText));
                } catch (e) {
                    reject(new Error("不是合法 JSON：" + src));
                }
            };
            xhr.onerror = () => reject(new Error("读不到 " + src));
            xhr.send();
        });
    },

    fetchMap(id) {
        return RM.fetchData("Map" + String(id).padStart(3, "0") + ".json");
    },

    commonEvents() {
        const out = [];
        const list = (typeof $dataCommonEvents !== "undefined" && $dataCommonEvents) || [];
        for (let i = 1; i < list.length; i++) {
            if (list[i]) out.push({ id: i, name: list[i].name || "", list: list[i].list || [] });
        }
        return out;
    },

    scene(name) {
        return typeof window[name] === "function" ? window[name] : null;
    }
};
G.rm = RM;

const PARAMS = (() => {
    try {
        return PluginManager.parameters("Grimoire") || {};
    } catch (e) {
        return {};
    }
})();

G.param = function (name, dflt) {
    const raw = PARAMS[name];
    if (raw === undefined || raw === "") return dflt;
    if (typeof dflt === "boolean") return String(raw) === "true";
    if (typeof dflt === "number") {
        const n = parseFloat(raw);
        return Number.isFinite(n) ? n : dflt;
    }
    return raw;
};

const TR_DEF = {
    endpoint: "https://api.openai.com/v1",
    apiKey: "",
    model: "",
    from: "日语",
    to: "简体中文",
    extra: "",
    concurrency: 16,
    batchSize: 16,
    batchChars: 1500,
    temperature: 0.3,
    timeout: 120
};

const TR_SCOPE_DEF = {
    db: true, system: true, common: true, troop: true, map: true,
    plugin: true, pluginsrc: true, container: true
};

const TR_SCOPES = [
    ["db", "数据库", "道具、武器、防具、技能、角色、职业、敌人、状态"],
    ["system", "系统术语", "命令名、能力值名、货币单位、战斗提示语"],
    ["common", "公共事件", "公共事件里的对话和选项"],
    ["troop", "战斗事件", "敌群事件里的对话"],
    ["map", "地图事件", "正文所在，量最大，要逐张地图拉取"],
    ["plugin", "插件参数", "plugins.js 里各插件的参数文本"],
    ["pluginsrc", "插件源码", "写死在插件代码里的界面文案，只取含非 ASCII 文字的串"],
    ["container", "文本容器", "游戏自带的剧本 / 文本文件，按形状自动认（仅 PC）"]
];

const TR_SPECS = {
    $dataActors: { group: "db", fields: ["name", "nickname", "profile"] },
    $dataClasses: { group: "db", fields: ["name"] },
    $dataSkills: { group: "db", fields: ["name", "description", "message1", "message2"] },
    $dataItems: { group: "db", fields: ["name", "description"] },
    $dataWeapons: { group: "db", fields: ["name", "description"] },
    $dataArmors: { group: "db", fields: ["name", "description"] },
    $dataEnemies: { group: "db", fields: ["name"] },
    $dataStates: { group: "db", fields: ["name", "message1", "message2", "message3", "message4"] },
    $dataCommonEvents: { group: "common", fields: [], list: true },
    $dataTroops: { group: "troop", fields: [], pages: true }
};

const TR_NAME_FIELDS = { name: 1, nickname: 1 };

const TR_FIXED_PROMPT = [
    "你是资深的游戏本地化译者，正在翻译一款 RPG Maker 游戏里的文本。",
    "",
    "保持规则：保证名词统一、语句通顺、符合目标语种的语言习惯和语义，你自己翻译，" +
    "不要用机翻，翻译要更符合目标语种的常用表达方式，不要刻意全部用某些专业化术语，做好润化。",
    "",
    "格式规则（这几条是给程序读的，必须严格遵守，破坏了游戏会出错）：",
    "1. 输入是一个 JSON 字符串数组。只输出翻译后的 JSON 数组本身，元素个数和顺序与输入一一对应；" +
    "不要输出解释、编号、代码块标记，也不要输出数组以外的任何内容。",
    "2. 不要合并、拆分、新增或删除元素。遇到空串、纯符号、看不懂的内容，原样返回占位，不要跳过。",
    "3. 控制符必须原样保留，不要翻译、不要改动里面的字母和数字、不要增删：" +
    "\\V[n] \\N[n] \\P[n] \\C[n] \\I[n] \\G \\. \\| \\! \\^ \\> \\< \\{ \\} \\$ " +
    "以及 %1 %2 这类占位符。它们在译文里的位置按目标语种的语序走。",
    "4. 保持换行：原文有几行，译文就给几行，换行符的数量和位置一一对应；" +
    "不要自己另起一行，也不要把多行并成一行。每行不要明显长过原文，游戏对话框放不下。",
    "5. 行首、行尾的空格和全角空格原样保留。",
    "6. 纯数字、文件名、路径、英文变量名这类明显给程序用的内容，原样返回。",
    "7. 人名、地名、技能名、道具名等专有名词，全篇必须是同一个译法；" +
    "下面给出的术语表优先级最高，必须照抄。",
    "8. 不要漏译，不要增加原文没有的内容，也不要改写原文的语气和尺度。"
].join("\n");

const TR = {
    cfg: Object.assign({}, TR_DEF),
    scope: Object.assign({}, TR_SCOPE_DEF),
    enabled: true,
    ready: false,
    where: "-",
    dict: {},
    next: null,
    gloss: [],
    collect: false,
    seen: [],
    units: [],
    models: [],
    running: false,
    stop: false,
    stats: { total: 0, done: 0, fail: 0, t0: 0 },
    scanInfo: null,
    log: [],
    epoch: 0,
    onUpdate: null
};
G.tr = TR;

function trEmit(kind) {
    try {
        if (TR.onUpdate) TR.onUpdate(kind);
    } catch (e) {  }
}

function trLog(msg) {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    TR.log.push(hh + ":" + mm + ":" + ss + "  " + msg);
    if (TR.log.length > 400) TR.log.splice(0, TR.log.length - 400);
    trEmit("log");
}

function trBrief(s, n) {
    s = String(s === undefined || s === null ? "" : s).replace(/\s+/g, " ").trim();
    n = n || 120;
    return s.length > n ? s.slice(0, n) + "…" : s;
}

function trSleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function trLoadCfg() {
    for (const k of Object.keys(TR_DEF)) TR.cfg[k] = Store.gget("tr." + k, TR_DEF[k]);
}
trLoadCfg();

TR.set = function (k, v) {
    TR.cfg[k] = v;
    Store.gset("tr." + k, v);
};

TR.loadGameCfg = function () {
    TR.enabled = !!Store.get("tr.enabled", true);
    TR.collect = !!Store.get("tr.collect", true);
    TR.scope = Object.assign({}, TR_SCOPE_DEF, Store.get("tr.scope", {}) || {});
};

TR.setEnabled = function (v) {
    TR.enabled = !!v;
    Store.set("tr.enabled", TR.enabled);
    if (TR.enabled) TR.applyAll(true);
};

TR.setScope = function (k, v) {
    TR.scope[k] = !!v;
    Store.set("tr.scope", TR.scope);
};

function trNode() {
    return Env.isNwjs && typeof require === "function";
}

function trSafeName(s) {
    return String(s || "game").replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim().slice(0, 60) || "game";
}

function trGameTitle() {
    return (typeof $dataSystem !== "undefined" && $dataSystem && $dataSystem.gameTitle) || "default";
}

function trDictKey() {
    return "dict:" + trGameTitle();
}

function trStoreKey(bak) {
    return (bak ? "bak:" : "") + trDictKey();
}

function trFilePath() {
    const path = require("path");
    const base = path.dirname(process.mainModule.filename);
    const name = trSafeName(trGameTitle());
    return {
        dir: path.join(base, "grimoire"),
        file: path.join(base, "grimoire", "dict-" + name + ".json"),
        bak: path.join(base, "grimoire", "dict-" + name + ".bak.json")
    };
}

const IDB = (() => {
    let dbp = null;
    function open() {
        if (dbp) return dbp;
        dbp = new Promise((resolve, reject) => {
            try {
                if (typeof indexedDB === "undefined" || !indexedDB) return reject(new Error("没共 IndexedDB"));
                const req = indexedDB.open("grimoire", 1);
                req.onupgradeneeded = () => {
                    const db = req.result;
                    if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
                };
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error || new Error("无法打开 IndexedDB"));
                req.onblocked = () => reject(new Error("IndexedDB 被其他页面占用"));
            } catch (e) {
                reject(e);
            }
        });
        dbp.catch(() => { dbp = null; });
        return dbp;
    }
    function tx(mode, fn) {
        return open().then(db => new Promise((resolve, reject) => {
            const t = db.transaction("kv", mode);
            const req = fn(t.objectStore("kv"));
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error || new Error("IndexedDB 读写失败"));
        }));
    }
    return {
        get: k => tx("readonly", s => s.get(k)),
        set: (k, v) => tx("readwrite", s => s.put(v, k)),
        del: k => tx("readwrite", s => s.delete(k))
    };
})();

async function trStoreGet(bak) {
    if (trNode()) {
        try {
            const fs = require("fs");
            const p = trFilePath();
            const f = bak ? p.bak : p.file;
            if (!bak) TR.where = "文件：" + p.file;
            if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8"));
        } catch (e) {
            console.warn("[Grimoire] 词典文件读不了，改用浏览器存储", e);
        }
    }
    try {
        const v = await IDB.get(trStoreKey(bak));
        if (v) {
            if (!trNode() && !bak) TR.where = "IndexedDB";
            return v;
        }
    } catch (e) {  }
    try {
        const s = localStorage.getItem("grimoire:" + trStoreKey(bak));
        if (s) {
            if (!trNode() && !bak) TR.where = "localStorage";
            return JSON.parse(s);
        }
    } catch (e) {  }
    if (!trNode() && !bak) TR.where = typeof indexedDB !== "undefined" ? "IndexedDB" : "localStorage";
    return null;
}

async function trStoreSet(val, bak) {
    if (trNode()) {
        try {
            const fs = require("fs");
            const p = trFilePath();
            try { fs.mkdirSync(p.dir); } catch (e) {  }
            fs.writeFileSync(bak ? p.bak : p.file, JSON.stringify(val), "utf8");
            if (!bak) TR.where = "文件：" + p.file;
            return;
        } catch (e) {
            console.warn("[Grimoire] 词典写文件失败，改用浏览器存储", e);
        }
    }
    try {
        await IDB.set(trStoreKey(bak), val);
        if (!trNode() && !bak) TR.where = "IndexedDB";
        return;
    } catch (e) {  }
    localStorage.setItem("grimoire:" + trStoreKey(bak), JSON.stringify(val));
    if (!trNode() && !bak) TR.where = "localStorage";
}

async function trBackupDict(oldDict) {
    try {
        await trStoreSet({
            v: 1, game: trGameTitle(), engine: Env.name,
            time: new Date().toISOString(), dict: oldDict, gloss: []
        }, true);
        trLog("原词典已备份（" + Object.keys(oldDict).length + " 条）");
    } catch (e) {
        trLog("原词典备份失败：" + e.message);
    }
}

TR.restoreBak = async function () {
    const obj = await trStoreGet(true);
    if (!obj || !obj.dict || !Object.keys(obj.dict).length) throw new Error("未找到备份");
    TR.dict = obj.dict;
    TR.gloss = Array.isArray(obj.gloss) ? obj.gloss : [];
    trSetSeen(obj.seen);
    trSetFails(obj.fails);
    TR.epoch++;
    await TR.saveDict();
    if (TR.enabled) TR.applyAll(true);
    return Object.keys(TR.dict).length;
};

TR.saveDict = async function () {
    try {
        await trStoreSet({
            v: 1,
            game: trGameTitle(),
            engine: Env.name,
            time: new Date().toISOString(),
            from: TR.cfg.from,
            to: TR.cfg.to,
            dict: TR.dict,
            gloss: TR.gloss,
            seen: TR.seen,
            fails: TR.failList()
        });
        return true;
    } catch (e) {
        trLog("词典保存失败：" + e.message);
        U.toast("词典保存失败：" + e.message, "err");
        return false;
    }
};

TR.loadDict = function () {
    return trStoreGet().then(obj => {
        if (obj && obj.dict) {
            TR.dict = obj.dict;
            TR.gloss = Array.isArray(obj.gloss) ? obj.gloss : [];
            trSetSeen(obj.seen);
            trSetFails(obj.fails);
        }
        TR.ready = true;
        TR.epoch++;
        if (TR.enabled) TR.applyAll(true);

        console.log("[Grimoire] 翻译词典 " + TR.dictSize() + " 条，替换" +
            (TR.enabled ? "已启用" : "已关闭") + "，存放于 " + TR.where);
        trEmit("state");
    }).catch(e => {
        console.error("[Grimoire] 词典读取失败", e);
        TR.ready = true;
        trEmit("state");
    });
};

TR.clearDict = async function () {

    TR.dict = {};
    TR.gloss = [];
    TR.units = [];
    TR.scanInfo = null;
    TR.epoch++;
    await TR.saveDict();
};

TR.dictSize = function () {
    return Object.keys(TR.dict).length;
};

function trDbSrc(name) {
    const files = (typeof DataManager !== "undefined" && DataManager._databaseFiles) || [];
    for (const f of files) if (f.name === name) return f.src;
    return name.replace("$data", "") + ".json";
}

const TR_LETTER = /[A-Za-zÀ-ɏЀ-ӿ฀-๿぀-ヿ㐀-鿿가-힯ｦ-ﾝ]/;
const TR_FILE = /^[\w .\-()\[\]]+\.(png|jpg|jpeg|webp|ogg|m4a|wav|mp4|json|js|ttf|woff2?|rpgmvp|rpgmvo|rpgmvm)$/i;

function trWorth(s) {
    if (typeof s !== "string") return false;
    const t = s.trim();
    if (!t || t.length > 4000) return false;
    if (!TR_LETTER.test(t)) return false;
    if (TR_FILE.test(t)) return false;
    if (t.indexOf("://") >= 0) return false;
    return true;
}

const TR_CODE_RE = /\\[a-zA-Z]+\[[^\]]*\]|\\[a-zA-Z]+|\\[.|!^><${}\\]|%\d/g;

function trCodes(s) {
    const m = String(s).match(TR_CODE_RE);
    return m ? m.slice().sort().join("") : "";
}

function trGlue(a, b) {
    if (!a) return b;
    if (!b) return a;
    const cjk = /[　-鿿＀-｠]/;
    return (cjk.test(a.slice(-1)) || cjk.test(b.slice(0, 1))) ? a + b : a + " " + b;
}

function trFitLines(lines, n) {
    if (lines.length > n) {
        const head = lines.slice(0, n - 1);
        head.push(lines.slice(n - 1).reduce(trGlue, ""));
        lines = head;
    }
    while (lines.length < n) lines.push("");
    return lines;
}

function trPut(obj, key, kind, visit) {
    const v = obj[key];
    if (typeof v !== "string" || !trWorth(v)) return;
    const out = visit(v, kind);
    if (typeof out === "string" && out !== "") obj[key] = out;
}

const TR_CHOICE_DIRECTIVE = /\s?(?:en|if)\([^)]*\)/g;

function trChoice(v, visit) {
    if (typeof v !== "string") return null;
    let keep = "";
    const rest = v.replace(TR_CHOICE_DIRECTIVE, m => { keep += m; return ""; });
    if (!trWorth(rest)) return null;
    const out = visit(rest, "msg");
    if (typeof out !== "string" || out === "") return null;

    return keep + out.replace(/\s*\n\s*/g, " ");
}

function trWalkList(list, visit) {
    if (!Array.isArray(list)) return;
    for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (!c || !c.parameters) continue;
        const p = c.parameters;
        if (c.code === 401 || c.code === 405) {

            let j = i;
            while (j + 1 < list.length && list[j + 1] && list[j + 1].code === c.code) j++;
            const lines = [];
            for (let k = i; k <= j; k++) {
                const v = list[k].parameters[0];
                lines.push(typeof v === "string" ? v : "");
            }
            const src = lines.join("\n");
            if (trWorth(src)) {
                const out = visit(src, "msg");
                if (typeof out === "string" && out !== "") {
                    const fit = trFitLines(out.split("\n"), lines.length);
                    for (let k = i; k <= j; k++) list[k].parameters[0] = fit[k - i];
                }
            }
            i = j;
        } else if (c.code === 102 && Array.isArray(p[0])) {

            for (let k = 0; k < p[0].length; k++) {
                const out = trChoice(p[0][k], visit);
                if (out !== null) p[0][k] = out;
            }
        } else if (c.code === 402) {
            const out = trChoice(p[1], visit);
            if (out !== null) p[1] = out;
        } else if (c.code === 101) {

            if (p.length > 4 && typeof p[4] === "string" && trWorth(p[4])) trPut(p, 4, "name", visit);
        } else if (c.code === 320 || c.code === 324 || c.code === 325) {

            if (typeof p[1] === "string" && trWorth(p[1])) {
                trPut(p, 1, c.code === 325 ? "text" : "name", visit);
            }
        }

    }
}

function trWalkArray(arr, spec, visit) {
    if (!Array.isArray(arr)) return;
    for (const e of arr) {
        if (!e || typeof e !== "object") continue;
        for (const f of spec.fields) {
            trPut(e, f, TR_NAME_FIELDS[f] ? "name" : "text", visit);
        }
        if (spec.list) trWalkList(e.list, visit);
        if (spec.pages && Array.isArray(e.pages)) {
            for (const pg of e.pages) if (pg) trWalkList(pg.list, visit);
        }
    }
}

function trWalkMap(map, visit) {
    if (!map) return;
    trPut(map, "displayName", "name", visit);
    if (!Array.isArray(map.events)) return;
    for (const ev of map.events) {
        if (!ev || !Array.isArray(ev.pages)) continue;
        for (const pg of ev.pages) if (pg) trWalkList(pg.list, visit);
    }
}

function trWalkSystem(sys, visit) {
    if (!sys) return;

    trPut(sys, "currencyUnit", "name", visit);
    for (const k of ["elements", "skillTypes", "weaponTypes", "armorTypes", "equipTypes"]) {
        const a = sys[k];
        if (Array.isArray(a)) for (let i = 0; i < a.length; i++) trPut(a, i, "name", visit);
    }
    const t = sys.terms;
    if (!t) return;
    for (const k of ["basic", "commands", "params"]) {
        const a = t[k];
        if (Array.isArray(a)) for (let i = 0; i < a.length; i++) trPut(a, i, "name", visit);
    }
    if (t.messages) for (const k of Object.keys(t.messages)) trPut(t.messages, k, "text", visit);
}

function trWorthParam(s) {
    const t = String(s).trim();
    if (!trWorth(t)) return false;
    if (/^[A-Za-z0-9_\-.+#$%/\\]+$/.test(t)) return false;
    if (!/[^\x00-\x7F]/.test(t) && /[+*\/%()\[\]{}<>=;]/.test(t)) return false;
    return true;
}

function trWalkParamValue(v, visit, depth, key) {
    if (depth > 6) return;
    if (Array.isArray(v)) {
        for (const x of v) trWalkParamValue(x, visit, depth + 1, key);
        return;
    }
    if (v && typeof v === "object") {
        for (const k of Object.keys(v)) trWalkParamValue(v[k], visit, depth + 1, k);
        return;
    }
    if (typeof v !== "string") return;
    const s = v.trim();

    if (s.length > 1 && (s.charAt(0) === "{" || s.charAt(0) === "[")) {
        try {
            trWalkParamValue(JSON.parse(s), visit, depth + 1, key);
            return;
        } catch (e) {  }
    }

    if (/^[\w\-]{2,40}\.(?:json|csv|txt)$/.test(s)) {
        trDataRefs[s] = true;
    } else if (key && /file|json|data|path/i.test(key) && /^[\w\-]{2,40}$/.test(s)) {
        trDataRefs[s + ".json"] = true;
    }
    if (trWorthParam(v)) visit(v, "text");
}

function trUnescape(s) {
    return s.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, function (m, g) {
        const c = g.charAt(0);
        if (c === "u" || c === "x") return String.fromCharCode(parseInt(g.slice(1), 16));
        if (g === "n") return "\n";
        if (g === "r") return "\r";
        if (g === "t") return "\t";
        if (g === "b") return "\b";
        if (g === "f") return "\f";
        if (g === "v") return "\v";
        if (g === "0") return "\0";
        return g;
    });
}

function trJsLiterals(src) {
    const out = [];
    let i = 0, prev = "";
    const n = src.length;
    while (i < n) {
        const c = src.charAt(i);
        if (c === "/" && src.charAt(i + 1) === "/") {
            const j = src.indexOf("\n", i);
            i = j < 0 ? n : j;
            continue;
        }
        if (c === "/" && src.charAt(i + 1) === "*") {
            const j = src.indexOf("*/", i + 2);
            i = j < 0 ? n : j + 2;
            continue;
        }
        if (c === "/" && !/[)\]}\w$]/.test(prev)) {

            let j = i + 1, klass = false;
            while (j < n) {
                const ch = src.charAt(j);
                if (ch === "\\") { j += 2; continue; }
                if (ch === "[") klass = true;
                else if (ch === "]") klass = false;
                else if (ch === "/" && !klass) { j++; break; }
                else if (ch === "\n") break;
                j++;
            }
            i = j;
            prev = "/";
            continue;
        }
        if (c === "\"" || c === "'" || c === "`") {
            let j = i + 1, buf = "", ok = false;
            while (j < n) {
                const ch = src.charAt(j);
                if (ch === "\\") { buf += src.substr(j, 2); j += 2; continue; }
                if (ch === c) { j++; ok = true; break; }
                if (ch === "\n" && c !== "`") break;
                buf += ch;
                j++;
            }
            if (ok) out.push(trUnescape(buf));
            i = j;
            prev = c;
            continue;
        }
        if (!/\s/.test(c)) prev = c;
        i++;
    }
    return out;
}

function trWorthSource(s) {
    return trWorthParam(s) && /[^\x00-\x7F]/.test(s);
}

function trFetchText(url) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", url);
        xhr.overrideMimeType("text/plain; charset=utf-8");
        xhr.onload = () => {
            if (xhr.status >= 400) return reject(new Error("HTTP " + xhr.status));
            resolve(xhr.responseText);
        };
        xhr.onerror = () => reject(new Error("读不到 " + url));
        xhr.send();
    });
}

async function trWalkPluginSource(visit, onTick, refs) {
    const list = (typeof $plugins !== "undefined" && $plugins) || [];
    const names = [];
    for (const p of list) {
        if (!p || p.status === false || !p.name) continue;
        if (p.name === "Grimoire") continue;
        if (names.indexOf(p.name) < 0) names.push(p.name);
    }
    let cursor = 0, ok = 0;
    const worker = async () => {
        while (cursor < names.length) {
            const name = names[cursor++];
            try {
                const src = await trFetchText("js/plugins/" + name + ".js");
                for (const lit of trJsLiterals(src)) {
                    if (trWorthSource(lit)) visit(lit, "text");
                }
                trCollectDataRefs(src, refs);
                ok++;
            } catch (e) {  }
            if (onTick) onTick(cursor, names.length, "读插件");
        }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return ok;
}

const TR_STD_DATA = ("actors classes skills items weapons armors enemies troops states " +
    "animations tilesets commonevents system mapinfos").split(" ");
const TR_DATA_REF = /([\w\-]{2,40}\.(?:json|csv|txt))/g;
const TR_MAP_FILE = /^map\d+\.json$/i;

let trDataRefs = {};

function trCollectDataRefs(src, into) {
    let m;
    TR_DATA_REF.lastIndex = 0;
    while ((m = TR_DATA_REF.exec(src))) {
        const f = m[1];
        const stem = f.replace(/\.[^.]+$/, "").toLowerCase();
        if (TR_STD_DATA.indexOf(stem) >= 0 || TR_MAP_FILE.test(f)) continue;
        into[f] = true;
    }
}

function trWalkAny(v, visit, depth) {
    if (depth > 8) return;
    if (Array.isArray(v)) {
        for (const x of v) trWalkAny(x, visit, depth + 1);
    } else if (v && typeof v === "object") {
        for (const k of Object.keys(v)) trWalkAny(v[k], visit, depth + 1);
    } else if (typeof v === "string" && trWorthSource(v)) {
        visit(v, "text");
    }
}

async function trWalkExtraData(names, visit, onTick) {
    let ok = 0, done = 0;
    for (const f of names) {
        try {
            const text = await trFetchText("data/" + f);
            if (/\.json$/i.test(f)) {
                trWalkAny(JSON.parse(text), visit, 0);
            } else {

                for (const line of text.split(/\r?\n/)) {
                    for (const cell of line.split(/[,\t]/)) {
                        const s = cell.replace(/^"|"$/g, "").trim();
                        if (trWorthSource(s)) visit(s, "text");
                    }
                }
            }
            ok++;
        } catch (e) {  }
        done++;
        if (onTick) onTick(done, names.length, "读数据文件");
    }
    return ok;
}

function trWalkPluginParams(visit) {
    const list = (typeof $plugins !== "undefined" && $plugins) || [];
    let n = 0;
    for (const p of list) {
        if (!p || p.status === false || !p.parameters) continue;
        if (p.name === "Grimoire") continue;
        trWalkParamValue(p.parameters, visit, 0);
        n++;
    }
    return n;
}

const trSeenSet = new Set();
let trSeenTimer = 0;
let trInEx = false;

function trScreen(text) {
    if (!TR.ready || typeof text !== "string" || text === "") return text;
    if (TR.enabled) {
        const v = TR.dict[text];
        if (typeof v === "string" && v !== "") return v;
    }
    if (TR.collect && !trInEx && !trSeenSet.has(text) && trSeenSet.size < 5000 && trWorth(text)) {
        trSeenSet.add(text);
        TR.seen.push(text);
        clearTimeout(trSeenTimer);
        trSeenTimer = setTimeout(() => { TR.saveDict(); }, 3000);
        trEmit("state");
    }
    return text;
}

const trFails = new Map();

function trFailPut(text, reason) {
    if (trFails.size >= 5000 && !trFails.has(text)) return;
    trFails.set(text, String(reason || "未知错误"));
}

function trFailDrop(text) {
    trFails.delete(text);
}

function trSetFails(list) {
    trFails.clear();
    if (!Array.isArray(list)) return;
    for (const f of list) {
        if (f && typeof f.t === "string") trFails.set(f.t, String(f.r || ""));
    }
}

TR.failCount = function () {
    return trFails.size;
};

TR.failList = function () {
    return Array.from(trFails, kv => ({ t: kv[0], r: kv[1] }));
};

TR.clearFails = function () {
    trFails.clear();
    return TR.saveDict();
};

function trSetSeen(list) {
    TR.seen = Array.isArray(list) ? list.slice(0, 5000) : [];
    trSeenSet.clear();
    for (const s of TR.seen) trSeenSet.add(s);
}

TR.setCollect = function (v) {
    TR.collect = !!v;
    Store.set("tr.collect", TR.collect);
};

TR.clearSeen = function () {
    trSeenSet.clear();
    TR.seen = [];
    return TR.saveDict();
};

function installDisplayHooks() {

    if (typeof Game_Message !== "undefined" && Game_Message.prototype.add) {
        const _add = Game_Message.prototype.add;
        Game_Message.prototype.add = function (text) {
            arguments[0] = trScreen(text);
            return _add.apply(this, arguments);
        };
    }
    if (typeof Game_Message !== "undefined" && Game_Message.prototype.setChoices) {
        const _setChoices = Game_Message.prototype.setChoices;
        Game_Message.prototype.setChoices = function (choices) {
            if (Array.isArray(choices)) arguments[0] = choices.map(trScreen);
            return _setChoices.apply(this, arguments);
        };
    }
    if (typeof Game_Message !== "undefined" && Game_Message.prototype.setSpeakerName) {
        const _setSpeaker = Game_Message.prototype.setSpeakerName;
        Game_Message.prototype.setSpeakerName = function (name) {
            arguments[0] = trScreen(name);
            return _setSpeaker.apply(this, arguments);
        };
    }

    if (typeof Bitmap !== "undefined" && Bitmap.prototype.drawText) {
        const _drawText = Bitmap.prototype.drawText;
        Bitmap.prototype.drawText = function (text) {
            arguments[0] = trScreen(text);
            return _drawText.apply(this, arguments);
        };
    }

    if (typeof Window_Base !== "undefined" && Window_Base.prototype.drawTextEx) {
        const _drawTextEx = Window_Base.prototype.drawTextEx;
        Window_Base.prototype.drawTextEx = function (text) {
            arguments[0] = trScreen(text);
            const was = trInEx;
            trInEx = true;
            try {
                return _drawTextEx.apply(this, arguments);
            } finally {
                trInEx = was;
            }
        };
    }
}

const TR_SKIP_DIR = /^(img|audio|movies|fonts|effects|icon|locales|swiftshader|node_modules|save|grimoire|js|data|css)$/i;
const TR_BIN_EXT = /\.(png|jpe?g|webp|gif|bmp|ogg|m4a|wav|mp3|mp4|webm|ttf|otf|woff2?|dll|exe|pak|bin|dat|zip|7z|rar|ico|db|rpgmvp|rpgmvo|rpgmvm|efkefc|efkmat|efkmodel)$/i;
const TR_DOC_NAME = /readme|changelog|license|credit|manual|help|履歴|更新|说明|使用方法/i;
const TR_DELIMS = ["/", "\t", "|", ","];

function trFsWalk(dir, out, depth) {
    const fs = require("fs");
    const path = require("path");
    if (depth > 4 || out.length > 5000) return;
    let names = [];
    try {
        names = fs.readdirSync(dir);
    } catch (e) {
        return;
    }
    for (const n of names) {
        const p = path.join(dir, n);
        let st;
        try {
            st = fs.statSync(p);
        } catch (e) {
            continue;
        }
        if (st.isDirectory()) {
            if (!TR_SKIP_DIR.test(n)) trFsWalk(p, out, depth + 1);
        } else if (st.size > 8 && st.size < 4 * 1024 * 1024 &&
                   !TR_BIN_EXT.test(n) && !TR_DOC_NAME.test(n)) {
            out.push(p);
        }
    }
}

function trAssetNames() {
    const fs = require("fs");
    const path = require("path");
    const set = new Set();
    const walk = (d, depth) => {
        if (depth > 3) return;
        let names = [];
        try {
            names = fs.readdirSync(d);
        } catch (e) {
            return;
        }
        for (const n of names) {
            const p = path.join(d, n);
            let st;
            try {
                st = fs.statSync(p);
            } catch (e) {
                continue;
            }
            if (st.isDirectory()) walk(p, depth + 1);
            else set.add(n.replace(/\.[^.]+$/, ""));
        }
    };
    const base = path.dirname(process.mainModule.filename);
    walk(path.join(base, "img"), 0);
    walk(path.join(base, "audio"), 0);
    return set;
}

function trPickDelim(lines) {
    let best = null, bestAvg = 1.3;
    for (const d of TR_DELIMS) {
        let total = 0, n = 0;
        for (let i = 0; i < lines.length && i < 200; i++) {
            if (!lines[i]) continue;
            total += lines[i].split(d).length;
            n++;
        }
        const avg = n ? total / n : 0;
        if (avg > bestAvg) {
            bestAvg = avg;
            best = d;
        }
    }
    return best;
}

function trWalkContainers(visit, onTick) {
    if (!trNode()) return 0;
    let fs, path, base;
    try {
        fs = require("fs");
        path = require("path");
        base = path.dirname(process.mainModule.filename);
    } catch (e) {
        return 0;
    }
    const files = [];
    trFsWalk(base, files, 0);
    if (!files.length) return 0;

    const assets = trAssetNames();
    const cells = [];
    const freq = {};
    let used = 0;

    for (let i = 0; i < files.length; i++) {
        let text;
        try {
            text = fs.readFileSync(files[i], "utf8");
        } catch (e) {
            continue;
        }
        if (text.indexOf("\uFFFD") >= 0) continue;
        if (!TR_LETTER.test(text)) continue;
        const s = text.replace(/^\uFEFF/, "").trim();
        if (s.charAt(0) === "{" || s.charAt(0) === "[") {
            try {
                trWalkAny(JSON.parse(s), visit, 0);
                used++;
                continue;
            } catch (e) {  }
        }
        const lines = s.split(/\r?\n/);
        const delim = trPickDelim(lines);
        for (const line of lines) {
            const parts = delim ? line.split(delim) : [line];
            for (let c = 0; c < parts.length; c++) {
                const v = parts[c].trim();
                if (!v || !trWorthSource(v)) continue;
                cells.push([v, c]);
                freq[v] = (freq[v] || 0) + 1;
            }
        }
        used++;
        if (onTick && (i % 20 === 0)) onTick(i + 1, files.length, "读文本文件");
    }

    for (const cv of cells) {
        const v = cv[0];
        if (cv[1] === 0) continue;
        if (assets.has(v)) continue;
        if (v.length <= 4 && freq[v] >= 20) continue;
        visit(v, "text");
    }
    return used;
}

function trDetectFrom(units) {
    const c = { ja: 0, ko: 0, ru: 0, zh: 0, en: 0 };
    let n = 0;
    for (let i = 0; i < units.length && n < 40000; i++) {
        const s = units[i].t;
        for (let k = 0; k < s.length; k++) {
            const ch = s.charCodeAt(k);
            if ((ch >= 0x3040 && ch <= 0x30ff) || (ch >= 0xff66 && ch <= 0xff9d)) c.ja++;
            else if (ch >= 0xac00 && ch <= 0xd7af) c.ko++;
            else if (ch >= 0x0400 && ch <= 0x04ff) c.ru++;
            else if (ch >= 0x3400 && ch <= 0x9fff) c.zh++;
            else if ((ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122)) c.en++;
            else continue;
            n++;
        }
    }
    if (n < 200) return "";
    if (c.ja && c.ja / (c.ja + c.zh || 1) > 0.12) return "日语";
    if (c.ko / n > 0.3) return "韩语";
    if (c.ru / n > 0.3) return "俄语";
    if (c.zh / n > 0.3) return "中文";
    if (c.en / n > 0.6) return "英语";
    return "";
}

TR.scan = async function (onTick) {
    const seen = new Map();
    trDataRefs = {};

    const visit = (text, kind) => {
        const old = seen.get(text);
        if (old) {
            old.n++;
            if (kind === "name") old.k = "name";
        } else {
            seen.set(text, { t: text, k: kind, n: 1 });
        }
        return undefined;
    };

    for (const name of Object.keys(TR_SPECS)) {
        const spec = TR_SPECS[name];
        if (!TR.scope[spec.group]) continue;
        const src = trDbSrc(name);
        try {
            trWalkArray(await RM.fetchData(src), spec, visit);
        } catch (e) {
            trLog("跳过 " + src + "：" + e.message);
        }
    }
    if (TR.scope.system) {
        const src = trDbSrc("$dataSystem");
        try {
            trWalkSystem(await RM.fetchData(src), visit);
        } catch (e) {
            trLog("跳过 " + src + "：" + e.message);
        }
    }

    let plugins = 0, psrc = 0, extra = 0, cont = 0;
    if (TR.scope.plugin) plugins = trWalkPluginParams(visit);
    if (TR.scope.pluginsrc) {
        psrc = await trWalkPluginSource(visit, onTick, trDataRefs);
        extra = await trWalkExtraData(Object.keys(trDataRefs), visit, onTick);
    }
    if (TR.scope.container) cont = trWalkContainers(visit, onTick);

    for (const s of TR.seen) visit(s, "text");

    let maps = 0, mapFail = 0;
    if (TR.scope.map) {
        let infos = [];
        try {
            infos = await RM.fetchData(trDbSrc("$dataMapInfos")) || [];
        } catch (e) {
            infos = (typeof $dataMapInfos !== "undefined" && $dataMapInfos) || [];
        }
        const ids = [];
        for (let i = 1; i < infos.length; i++) if (infos[i]) ids.push(i);
        let cursor = 0;
        const worker = async () => {
            while (cursor < ids.length) {
                const id = ids[cursor++];
                try {
                    trWalkMap(await RM.fetchMap(id), visit);
                    maps++;
                } catch (e) {
                    mapFail++;
                }
                if (onTick) onTick(cursor, ids.length);
            }
        };
        await Promise.all([worker(), worker(), worker(), worker()]);
        if (mapFail) trLog("共 " + mapFail + " 张地图读取失败（可能已在编辑器中删除），已跳过");
    }

    TR.units = Array.from(seen.values());
    let have = 0, chars = 0;
    for (const u of TR.units) {
        chars += u.t.length;
        if (TR.dict[u.t] !== undefined) have++;
    }

    const lang = trDetectFrom(TR.units);
    if (lang && lang !== String(TR.cfg.from).trim()) {
        TR.set("from", lang);
        trLog("源语种已自动识别为「" + lang + "」");
    }
    TR.scanInfo = { total: TR.units.length, have, chars, maps, plugins, psrc, extra, cont, seen: TR.seen.length, at: Date.now() };
    trLog("扫描完成：" + TR.units.length + " 条 / " + chars + " 字" +
        (maps ? "，地图 " + maps + " 张" : "") +
        (plugins ? "，插件参数 " + plugins + " 个" : "") +
        (psrc ? "，插件源码 " + psrc + " 个" : "") +
        (extra ? "，额外数据文件 " + extra + " 个" : "") +
        (cont ? "，文本容器 " + cont + " 个" : "") +
        (TR.seen.length ? "，屏幕记录 " + TR.seen.length + " 条" : "") +
        (have ? "，其中 " + have + " 条已有旧译文" : ""));
    trEmit("state");
    return TR.scanInfo;
};

const trApplied = new WeakMap();

function trApplier(text) {
    const v = TR.dict[text];
    return (typeof v === "string" && v !== "") ? v : undefined;
}

function trSpecOf(arr) {
    for (const name of Object.keys(TR_SPECS)) {
        try {
            if (window[name] === arr) return TR_SPECS[name];
        } catch (e) {  }
    }
    return null;
}

function trApplyObject(obj) {
    if (!obj || typeof obj !== "object") return false;
    if (trApplied.get(obj) === TR.epoch) return false;
    if (Array.isArray(obj)) {
        const spec = trSpecOf(obj);
        if (!spec) return false;
        trWalkArray(obj, spec, trApplier);
    } else if (obj.events && obj.data) {
        trWalkMap(obj, trApplier);
    } else if (obj.terms) {
        trWalkSystem(obj, trApplier);
    } else {
        return false;
    }
    trApplied.set(obj, TR.epoch);
    return true;
}

TR.applyAll = function (force) {
    if (!TR.ready || !TR.dictSize()) return 0;
    if (force) TR.epoch++;
    let n = 0;
    for (const name of Object.keys(TR_SPECS)) {
        if (trApplyObject(window[name])) n++;
    }
    if (typeof $dataSystem !== "undefined" && trApplyObject($dataSystem)) n++;
    if (typeof $dataMap !== "undefined" && trApplyObject($dataMap)) n++;
    return n;
};

function trNodeReq(url, opts, ms) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const lib = require(u.protocol === "https:" ? "https" : "http");
        const body = opts.body ? Buffer.from(opts.body, "utf8") : null;
        const headers = Object.assign({}, opts.headers);
        if (body) headers["Content-Length"] = String(body.length);
        const req = lib.request({
            method: opts.method || "GET",
            protocol: u.protocol,
            hostname: u.hostname,
            port: u.port || (u.protocol === "https:" ? 443 : 80),
            path: u.pathname + u.search,
            headers
        }, res => {

            const chunks = [];
            res.on("data", d => chunks.push(d));
            res.on("end", () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf8") }));
            res.on("error", reject);
        });
        req.setTimeout(ms, () => { req.destroy(new Error("超时（" + Math.round(ms / 1000) + " 秒）")); });
        req.on("error", e => reject(e));
        if (body) req.write(body);
        req.end();
    });
}

function trXhrReq(url, opts, ms) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(opts.method || "GET", url, true);
        try { xhr.overrideMimeType("application/json; charset=utf-8"); } catch (e) {  }
        for (const k of Object.keys(opts.headers || {})) xhr.setRequestHeader(k, opts.headers[k]);
        xhr.timeout = ms;
        xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText });
        xhr.onerror = () => reject(new Error("网络错误：地址不通、没联网，或者对方没开跨域(CORS)"));
        xhr.ontimeout = () => reject(new Error("超时（" + Math.round(ms / 1000) + " 秒）"));
        xhr.send(opts.body || null);
    });
}

async function trHttp(url, opts) {
    const ms = U.clamp(U.int(TR.cfg.timeout, 120), 5, 900) * 1000;
    const r = trNode() ? await trNodeReq(url, opts, ms) : await trXhrReq(url, opts, ms);
    let data = null;
    try {
        data = JSON.parse(r.text);
    } catch (e) {
        if (r.status >= 200 && r.status < 300) throw new Error("返回内容不是 JSON：" + trBrief(r.text));
    }
    if (r.status < 200 || r.status >= 300) {
        const msg = (data && data.error && (data.error.message || data.error.code)) || trBrief(r.text);
        throw new Error("HTTP " + r.status + "：" + msg);
    }
    return data;
}

function trBase() {
    let u = String(TR.cfg.endpoint || "").trim();
    if (!u) throw new Error("未填写 API 地址");
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    u = u.replace(/\/+$/, "").replace(/\/chat\/completions$/i, "");
    try {

        if (!new URL(u).pathname.replace(/\/+$/, "")) u += "/v1";
    } catch (e) {  }
    return u;
}

function trHeaders() {
    const h = { "Content-Type": "application/json" };
    const key = String(TR.cfg.apiKey || "").trim();
    if (key) h["Authorization"] = "Bearer " + key;
    return h;
}

TR.fetchModels = async function () {
    const data = await trHttp(trBase() + "/models", { headers: trHeaders() });
    const list = (data && (data.data || data.models)) || (Array.isArray(data) ? data : []);
    const ids = [];
    for (const m of list) {
        const id = typeof m === "string" ? m : (m && (m.id || m.name));
        if (id) ids.push(String(id));
    }
    ids.sort();
    TR.models = ids;
    trLog("获取到 " + ids.length + " 个模型");
    return ids;
};

function trPickGloss(texts) {
    if (!TR.gloss.length) return [];
    const joined = texts.join("\n");
    const hit = [];
    for (const g of TR.gloss) {
        if (joined.indexOf(g[0]) >= 0) {
            hit.push(g);
            if (hit.length >= 60) break;
        }
    }
    return hit;
}

function trPrompt(texts) {
    const c = TR.cfg;
    const parts = [TR_FIXED_PROMPT, ""];
    parts.push("源语种：" + (String(c.from).trim() || "自动判断") + "；目标语种：" + (String(c.to).trim() || "简体中文") + "。");
    const gl = trPickGloss(texts);
    if (gl.length) {
        parts.push("", "术语表（左边原文，右边是必须使用的译法）：");
        for (const g of gl) parts.push(g[0] + " => " + g[1]);
    }
    const extra = String(c.extra || "").trim();
    if (extra) {

        parts.push("", "以下是使用者的附加要求，优先级高于上面的翻译要求（格式规则除外），冲突时以使用者的为准：", extra);
    }
    return parts.join("\n");
}

async function trChat(sys, user, history) {
    const messages = [{ role: "system", content: sys }];
    if (history && history.length) for (const m of history) messages.push(m);
    messages.push({ role: "user", content: user });
    const data = await trHttp(trBase() + "/chat/completions", {
        method: "POST",
        headers: trHeaders(),
        body: JSON.stringify({
            model: String(TR.cfg.model || "").trim(),
            temperature: Number(TR.cfg.temperature) || 0,
            stream: false,
            messages: messages
        })
    });
    const choice = data && data.choices && data.choices[0];
    const text = choice && choice.message && choice.message.content;
    if (!text) {
        const err = data && data.error && (data.error.message || data.error.code);
        throw new Error(err ? String(err) : "接口未返回内容（" + trBrief(JSON.stringify(data), 80) + "）");
    }
    return String(text);
}

function trParseArray(text) {
    let s = String(text).trim();
    s = s.replace(/^```[a-zA-Z]*\s*/, "").replace(/```\s*$/, "").trim();
    const a = s.indexOf("["), b = s.lastIndexOf("]");
    if (a >= 0 && b > a) s = s.slice(a, b + 1);
    const arr = JSON.parse(s);
    if (!Array.isArray(arr)) throw new Error("返回内容不是数组");
    return arr.map(x => (typeof x === "string" ? x : (x === null || x === undefined ? "" : String(x))));
}

TR.translateTexts = async function (texts) {
    const raw = await trChat(trPrompt(texts), JSON.stringify(texts));
    const arr = trParseArray(raw);
    if (arr.length !== texts.length) {
        throw new Error("返回条数对不上：要 " + texts.length + " 条，回来 " + arr.length + " 条");
    }
    return arr;
};

function trBatches(units) {
    const size = U.clamp(U.int(TR.cfg.batchSize, 16), 1, 200);
    const maxChars = U.clamp(U.int(TR.cfg.batchChars, 1500), 200, 40000);
    const out = [];
    let cur = [], chars = 0;
    for (const u of units) {
        if (cur.length && (cur.length >= size || chars + u.t.length > maxChars)) {
            out.push(cur);
            cur = [];
            chars = 0;
        }
        cur.push(u);
        chars += u.t.length;
    }
    if (cur.length) out.push(cur);
    return out;
}

async function trRunBatch(items, depth) {
    const texts = items.map(u => u.t);
    let arr = null, err = null;
    for (let attempt = 0; attempt < 2 && !TR.stop; attempt++) {
        try {
            arr = await TR.translateTexts(texts);
            err = null;
            break;
        } catch (e) {
            err = e;
            if (attempt === 0) await trSleep(600);
        }
    }

    if (!arr) {

        if (items.length > 1 && !TR.stop && (depth || 0) < 6) {
            const mid = Math.ceil(items.length / 2);
            await trRunBatch(items.slice(0, mid), (depth || 0) + 1);
            await trRunBatch(items.slice(mid), (depth || 0) + 1);
            return;
        }
        const why = TR.stop ? "已停止" : (err ? err.message : "未知错误");
        for (const it of items) trFailPut(it.t, why);
        TR.stats.fail += items.length;
        trLog("失败 " + items.length + " 条：" + why +
            (items.length === 1 ? "  ← " + trBrief(items[0].t, 40) : ""));
        return;
    }

    let bad = 0;
    for (let i = 0; i < items.length; i++) {
        const src = items[i].t;
        const dst = arr[i];
        if (!dst || !dst.trim()) {
            bad++;
            TR.stats.fail++;
            trFailPut(src, "接口返回空");
            continue;
        }
        if (trCodes(src) !== trCodes(dst)) {

            bad++;
            TR.stats.fail++;
            trFailPut(src, "控制符不一致：" + trBrief(dst, 40));
            trLog("控制符不一致，已丢弃：" + trBrief(src, 40) + "  →  " + trBrief(dst, 40));
            continue;
        }
        TR.next[src] = dst;
        TR.stats.done++;
        trFailDrop(src);

        if (items[i].k === "name" && src.length <= 16 && dst !== src) TR.gloss.push([src, dst]);
    }
    if (bad) trEmit("log");
}

async function trPump(units, label) {
    const n = U.clamp(U.int(TR.cfg.concurrency, 16), 1, 32);
    const queue = trBatches(units);
    TR.stats = { total: units.length, done: 0, fail: 0, t0: Date.now(), batches: queue.length };
    trLog(label + "：" + units.length + " 条，分 " + queue.length + " 批，并发 " + n);
    trEmit("state");

    const worker = async () => {
        while (!TR.stop) {
            const b = queue.shift();
            if (!b) return;
            await trRunBatch(b, 0);
            trEmit("progress");
        }
    };
    await Promise.all(Array.from({ length: n }, worker));
}

function trDoneLine(label) {
    const sec = Math.round((Date.now() - TR.stats.t0) / 1000);
    trLog((TR.stop ? "已停止" : label) + "：成功 " + TR.stats.done + " 条，失败 " +
        TR.stats.fail + " 条，用时 " + Math.floor(sec / 60) + " 分 " + (sec % 60) + " 秒" +
        (trFails.size ? "（累计 " + trFails.size + " 条失败记录）" : ""));
}

TR.run = async function () {
    if (TR.running) return;
    if (!String(TR.cfg.model || "").trim()) throw new Error("请先填写或选择模型");
    if (!TR.units.length) throw new Error("请先点「扫描文本」");

    TR.running = true;
    TR.stop = false;
    TR.next = {};
    TR.gloss = [];
    trFails.clear();
    try {
        await trPump(TR.units.slice(), "开始翻译" +
            (TR.dictSize() ? "（完成后将覆盖现共 " + TR.dictSize() + " 条）" : ""));
    } finally {
        TR.running = false;
        const old = TR.dictSize() ? TR.dict : null;
        TR.dict = TR.next || {};
        TR.next = null;
        trBuildGloss();
        if (old) await trBackupDict(old);
        await TR.saveDict();
        TR.epoch++;
        trDoneLine("翻译完成");
        if (TR.enabled) TR.applyAll(true);
        trEmit("state");
    }
};

TR.repair = async function () {
    if (TR.running) return;
    if (!String(TR.cfg.model || "").trim()) throw new Error("请先填写或选择模型");
    if (!trFails.size) throw new Error("没有需要修复的条目");

    const todo = TR.failList().map(f => ({ t: f.t, k: "text", n: 1 }));
    TR.running = true;
    TR.stop = false;
    TR.next = TR.dict;
    try {
        await trPump(todo, "开始修复");
    } finally {
        TR.running = false;
        TR.next = null;
        await TR.saveDict();
        TR.epoch++;
        trDoneLine("修复完成");
        if (TR.enabled) TR.applyAll(true);
        trEmit("state");
    }
};

const TR_POLISH_PROMPT = [
    "你在做游戏本地化的最后一道润色。输入是已经翻好的译文，你要统一术语、纠正错译、把话说顺。",
    "",
    "这是同一款游戏的文本，会分多次发给你。前面定下来的译法，后面必须沿用。",
    "",
    "润色要求：",
    "1. 同一个专有名词（人名、地名、技能名、道具名）全篇必须是同一个译法；术语表里定下的照抄。",
    "2. 错译、漏译、多译要改正；不通顺的改顺。",
    "3. 没问题的条目原样返回，不要为了改而改。",
    "4. 保持原文的语气和尺度，不要自行增删内容。",
    "",
    "格式规则（给程序读的，破坏了译文就装不回游戏）：",
    "1. 输入是 JSON 数组，每项是 [原文, 当前译文] 两个元素。",
    "2. 输出是 JSON 字符串数组，只放润色后的译文，个数和顺序与输入一一对应；" +
    "不要输出解释、编号、代码块标记。",
    "3. 控制符 \\V[n] \\N[n] \\C[n] \\I[n] \\G 和 %1 这类占位符，数量和内容都不能变。",
    "4. 换行的数量和位置和当前译文保持一致。"
].join("\n");

function trPolishPrompt(texts) {
    const c = TR.cfg;
    const parts = [TR_POLISH_PROMPT, ""];
    parts.push("源语种：" + (String(c.from).trim() || "自动判断") +
        "；目标语种：" + (String(c.to).trim() || "简体中文") + "。");
    const gl = trPickGloss(texts);
    if (gl.length) {
        parts.push("", "术语表（左边原文，右边是必须使用的译法）：");
        for (const g of gl) parts.push(g[0] + " => " + g[1]);
    }
    const extra = String(c.extra || "").trim();
    if (extra) {
        parts.push("", "以下是使用者的附加要求，优先级高于上面的润色要求（格式规则除外）：", extra);
    }
    return parts.join("\n");
}

function trTrimHistory(history) {
    let chars = 0;
    for (const m of history) chars += m.content.length;
    while (history.length > 2 && chars > 30000) {
        chars -= history[0].content.length + history[1].content.length;
        history.splice(0, 2);
    }
}

TR.polish = async function () {
    if (TR.running) return;
    if (!String(TR.cfg.model || "").trim()) throw new Error("请先填写或选择模型");
    const keys = Object.keys(TR.dict);
    if (!keys.length) throw new Error("词典为空");

    const maxChars = U.clamp(U.int(TR.cfg.batchChars, 1500) * 2, 400, 40000);
    const chunks = [];
    let cur = [], chars = 0;
    for (const k of keys) {
        const w = k.length + String(TR.dict[k]).length;
        if (cur.length && (cur.length >= 40 || chars + w > maxChars)) {
            chunks.push(cur);
            cur = [];
            chars = 0;
        }
        cur.push(k);
        chars += w;
    }
    if (cur.length) chunks.push(cur);

    TR.running = true;
    TR.stop = false;
    TR.stats = { total: keys.length, done: 0, fail: 0, changed: 0, t0: Date.now(), batches: chunks.length };
    trLog("开始深度润化：" + keys.length + " 条，分 " + chunks.length + " 轮，同一会话顺序执行");
    trEmit("state");

    const before = Object.assign({}, TR.dict);
    const history = [];

    try {
        for (const chunk of chunks) {
            if (TR.stop) break;
            const pairs = chunk.map(k => [k, TR.dict[k]]);
            const user = JSON.stringify(pairs);
            let arr = null, err = null;

            for (let attempt = 0; attempt < 2 && !TR.stop; attempt++) {
                try {
                    const raw = await trChat(trPolishPrompt(chunk), user, history);
                    const got = trParseArray(raw);
                    if (got.length !== pairs.length) {
                        throw new Error("返回条数对不上：要 " + pairs.length + " 条，回来 " + got.length + " 条");
                    }
                    arr = got;
                    history.push({ role: "user", content: user });
                    history.push({ role: "assistant", content: JSON.stringify(got) });
                    trTrimHistory(history);
                    err = null;
                    break;
                } catch (e) {
                    err = e;
                    if (attempt === 0) await trSleep(600);
                }
            }

            if (!arr) {
                TR.stats.fail += chunk.length;
                trLog("润化失败 " + chunk.length + " 条：" + (err ? err.message : "已停止"));
                trEmit("progress");
                continue;
            }

            for (let i = 0; i < chunk.length; i++) {
                const src = chunk[i];
                const now = TR.dict[src];
                const next = arr[i];
                TR.stats.done++;
                if (!next || !next.trim() || next === now) continue;
                if (trCodes(src) !== trCodes(next)) {

                    TR.stats.fail++;
                    trLog("润化后控制符不一致，保留原译文：" + trBrief(src, 30));
                    continue;
                }
                TR.dict[src] = next;
                TR.stats.changed++;
            }
            trEmit("progress");
        }
    } finally {
        TR.running = false;
        if (TR.stats.changed) {
            await trBackupDict(before);
            await TR.saveDict();
            TR.epoch++;
            if (TR.enabled) TR.applyAll(true);
        }
        const sec = Math.round((Date.now() - TR.stats.t0) / 1000);
        trLog((TR.stop ? "已停止" : "润化完成") + "：处理 " + TR.stats.done + " 条，修改 " +
            TR.stats.changed + " 条，跳过 " + TR.stats.fail + " 条，用时 " +
            Math.floor(sec / 60) + " 分 " + (sec % 60) + " 秒");
        trEmit("state");
    }
};

function trBuildGloss() {
    const m = new Map();
    for (const g of TR.gloss) if (g && g.length === 2) m.set(g[0], g[1]);
    for (const u of TR.units) {
        if (u.k !== "name" || u.t.length > 16) continue;
        const d = TR.dict[u.t];
        if (d && d !== u.t) m.set(u.t, d);
    }
    TR.gloss = Array.from(m.entries())
        .sort((a, b) => b[0].length - a[0].length)
        .slice(0, 3000);
}

TR.exportDict = function () {
    return JSON.stringify({
        v: 1,
        game: trGameTitle(),
        engine: Env.name,
        time: new Date().toISOString(),
        from: TR.cfg.from,
        to: TR.cfg.to,
        dict: TR.dict,
        gloss: TR.gloss,
        seen: TR.seen,
        fails: TR.failList()
    });
};

TR.importDict = async function (text, overwrite) {
    const obj = JSON.parse(text);
    const d = obj && obj.dict;
    if (!d || typeof d !== "object") throw new Error("不是 Grimoire 导出的词典");
    let n = 0;
    for (const k of Object.keys(d)) {
        if (typeof d[k] !== "string") continue;
        if (!overwrite && TR.dict[k] !== undefined) continue;
        TR.dict[k] = d[k];
        n++;
    }
    if (Array.isArray(obj.gloss)) {
        const m = new Map();
        for (const g of TR.gloss) m.set(g[0], g[1]);
        for (const g of obj.gloss) if (Array.isArray(g) && g.length === 2) m.set(g[0], g[1]);
        TR.gloss = Array.from(m.entries()).sort((a, b) => b[0].length - a[0].length).slice(0, 3000);
    }
    TR.epoch++;
    await TR.saveDict();
    if (TR.enabled) TR.applyAll(true);
    return n;
};

function installTransHooks() {
    installDisplayHooks();

    if (typeof DataManager !== "undefined" && DataManager.onLoad) {
        const _onLoad = DataManager.onLoad;
        DataManager.onLoad = function (object) {
            _onLoad.call(this, object);
            if (TR.enabled && TR.ready) {
                try {
                    trApplyObject(object);
                } catch (e) {
                    console.error("[Grimoire] 翻译替换失败", e);
                }
            }
        };
    }

    if (typeof Scene_Boot !== "undefined") {
        const _start = Scene_Boot.prototype.start;
        Scene_Boot.prototype.start = function () {
            try {
                TR.loadGameCfg();
                if (!TR.ready) TR.loadDict();
                else if (TR.enabled) TR.applyAll(true);
            } catch (e) {
                console.error("[Grimoire] 翻译初始化失败", e);
            }
            _start.apply(this, arguments);
        };
    }
}

const CSS = `
.gm-root, .gm-root * { box-sizing: border-box; }
.gm-root button:focus, .gm-root summary:focus, .gm-root *:focus { outline: none; }
.gm-root button:focus-visible, .gm-root summary:focus-visible { outline: none; }
.gm-root {
  position: fixed; top: 0; right: 0; bottom: 0; left: 0; z-index: 2147483000;
  pointer-events: none;                 
  font: 500 var(--gm-fs, 13px)/1.45 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  color: #e6e6e6;
  -webkit-user-select: none; user-select: none;
  -webkit-tap-highlight-color: transparent;
}
.gm-root > * { pointer-events: auto; }
.gm-fab {
  position: absolute; width: 44px; height: 44px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(145deg, #3a3a3a, #161616);
  border: 1px solid #5a5a5a; color: #f0f0f0;
  box-shadow: 0 3px 10px rgba(0,0,0,.6);
  cursor: grab; touch-action: none; font-size: 19px;
  transition: transform .12s ease, box-shadow .12s ease;
}
.gm-fab:active { cursor: grabbing; transform: scale(.94); }
.gm-fab--drag { box-shadow: 0 6px 18px rgba(0,0,0,.75); }
.gm-root .gm-vk {
  position: absolute; top: 0; right: 0; bottom: 0; left: 0; pointer-events: none;
}
.gm-vk__btn {
  position: absolute; display: flex; align-items: center; justify-content: center;
  border-radius: 8px; border: 1px solid #5a5a5a; color: #f0f0f0;
  background: linear-gradient(145deg, #3a3a3a, #161616);
  box-shadow: 0 2px 8px rgba(0,0,0,.55);
  pointer-events: auto; touch-action: none; cursor: pointer; line-height: 1;
  -webkit-user-select: none; user-select: none; -webkit-touch-callout: none;
}
.gm-vk__btn--arrow { border-radius: 50%; }
.gm-vk__btn--down {
  background: linear-gradient(145deg, #6e6e6e, #2c2c2c);
  border-color: #ffffff; box-shadow: 0 0 0 1px rgba(255,255,255,.35);
}
.gm-vk__pad { position: absolute; pointer-events: none; }
.gm-vk--edit .gm-vk__pad { pointer-events: auto; }
.gm-vk--edit .gm-vk__btn { border-style: dashed; border-color: #ffffff; cursor: grab; }
.gm-mask {
  position: absolute; top: 0; right: 0; bottom: 0; left: 0; background: rgba(0,0,0,.5);
  display: flex; align-items: center; justify-content: center; padding: 8px;
}
.gm-panel {
  width: 560px; max-width: 96vw;
  height: 680px; max-height: 94vh;
  display: flex; flex-direction: column; overflow: hidden;
  background: #141414; border: 1px solid #3a3a3a; border-radius: 10px;
  box-shadow: 0 10px 40px rgba(0,0,0,.8);
}
.gm-panel--moved { position: absolute; margin: 0; }
.gm-head {
  display: flex; align-items: center; padding: 7px 10px;
  background: #1f1f1f; border-bottom: 1px solid #333; flex: none;
  cursor: move; touch-action: none;       
}
.gm-head > * + * { margin-left: 8px; }
.gm-title { font-weight: 700; color: #ffffff; letter-spacing: .5px; }
.gm-sub { color: #8c8c8c; font-size: .85em; }
.gm-head .gm-spacer { flex: 1; }
.gm-x {
  width: 26px; height: 26px; border-radius: 5px; border: 1px solid #4a4a4a;
  background: #2a2a2a; color: #e0e0e0; cursor: pointer; font-size: 15px; line-height: 1;
}
.gm-x:hover { background: #383838; }
.gm-main { display: flex; flex: 1; min-height: 0; }
.gm-tabs {
  flex: none; width: 92px; overflow-y: auto; overflow-x: hidden;
  background: #191919; border-right: 1px solid #2e2e2e;
  -webkit-overflow-scrolling: touch; touch-action: pan-y;
}
.gm-tab {
  display: block; width: 100%; text-align: left; padding: 9px 10px;
  background: none; border: 0; border-left: 3px solid transparent;
  color: #9a9a9a; cursor: pointer; font: inherit;
}
.gm-tab:hover { background: #242424; color: #dcdcdc; }
.gm-tab--on, .gm-tab--on:hover {
  background: #2a2a2a; color: #ffffff; border-left-color: #ffffff;
}
.gm-body {
  flex: 1; min-width: 0; overflow-y: auto; padding: 10px;
  -webkit-overflow-scrolling: touch; touch-action: pan-y;
}
.gm-row { display: flex; align-items: center; flex-wrap: wrap; }
.gm-row > * { margin: 0 6px 6px 0; }
.gm-grow { flex: 1 1 auto; min-width: 5.5em; }
.gm-sec {
  margin: 12px 0 6px; padding-bottom: 4px; color: #ffffff;
  border-bottom: 1px solid #2e2e2e; font-weight: 700;
}
.gm-sec:first-child { margin-top: 0; }
.gm-hint { color: #7a7a7a; font-size: .85em; margin: 4px 0 8px; line-height: 1.5; }
.gm-now {
  color: #9a9a9a; font-size: .9em; margin-left: 18px; white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.gm-btn {
  padding: 5px 10px; border-radius: 5px; border: 1px solid #4a4a4a;
  background: #262626; color: #dcdcdc; cursor: pointer; font: inherit; white-space: nowrap;
}
.gm-btn:hover { background: #333; }
.gm-btn:active { transform: translateY(1px); }
.gm-btn--main { background: #e8e8e8; border-color: #ffffff; color: #101010; font-weight: 700; }
.gm-btn--main:hover { background: #ffffff; }
.gm-btn--warn { background: #1a1a1a; border-color: #5a5a5a; color: #ffffff; font-weight: 700; }
.gm-btn--warn:hover { background: #2a2a2a; border-color: #7a7a7a; }
.gm-btn--sm { padding: 3px 7px; font-size: .88em; }
.gm-btn--off { opacity: .45; }
.gm-in {
  padding: 5px 7px; border-radius: 5px; border: 1px solid #444;
  background: #0c0c0c; color: #ededed; font: inherit; min-width: 0;
  -webkit-user-select: text; user-select: text;
}
.gm-in:focus { outline: none; border-color: #ffffff; }
.gm-in--num { width: 92px; text-align: right; }
.gm-in--sm { width: 62px; text-align: right; }
.gm-colh { width: 62px; text-align: right; color: #7a7a7a; font-size: .85em; }
.gm-in--mid { width: 160px; }
.gm-in--full { width: 100%; }
.gm-in:disabled { opacity: .45; cursor: not-allowed; }
select.gm-in { cursor: pointer; }
.gm-field { margin-bottom: 8px; }
.gm-field__k { margin-bottom: 3px; color: #cfcfcf; }
.gm-det {
  border: 1px solid #2e2e2e; border-radius: 6px; padding: 6px 8px;
  margin-bottom: 8px; background: #181818;
}
.gm-det > summary { cursor: pointer; color: #cfcfcf; list-style: none; outline: none; }
.gm-det > summary::-webkit-details-marker { display: none; }
.gm-det > summary::before { content: "▸ "; color: #7a7a7a; }
.gm-det[open] > summary { margin-bottom: 6px; }
.gm-det[open] > summary::before { content: "▾ "; }
.gm-bar {
  height: 8px; border: 1px solid #4a4a4a; border-radius: 5px;
  background: #0c0c0c; overflow: hidden;
}
.gm-bar__f { height: 100%; width: 0%; background: #e8e8e8; transition: width .25s linear; }
.gm-stat {
  color: #9a9a9a; font-size: .88em; margin: 5px 0 8px;
  font-variant-numeric: tabular-nums;
}
.gm-log {
  height: 130px; overflow-y: auto; padding: 6px; margin-bottom: 8px;
  background: #0c0c0c; border: 1px solid #2e2e2e; border-radius: 6px;
  font-family: ui-monospace, Consolas, monospace; font-size: 11px; line-height: 1.55;
  color: #9a9a9a; white-space: pre-wrap; word-break: break-all;
  -webkit-user-select: text; user-select: text; touch-action: pan-y;
}
.gm-sw {
  position: relative; width: 38px; height: 21px; border-radius: 11px; flex: none;
  background: #2e2e2e; border: 1px solid #4a4a4a; cursor: pointer; transition: background .15s;
}
.gm-sw::after {
  content: ""; position: absolute; top: 2px; left: 2px; width: 15px; height: 15px;
  border-radius: 50%; background: #8a8a8a; transition: transform .15s, background .15s;
}
.gm-sw--on { background: #e8e8e8; border-color: #ffffff; }
.gm-sw--on::after { transform: translateX(17px); background: #111111; }
.gm-sw--off { opacity: .4; pointer-events: none; }
.gm-lock {
  width: 26px; height: 24px; flex: none; border-radius: 5px;
  border: 1px solid #4a4a4a; background: #222; color: #7a7a7a;
  cursor: pointer; font-size: 12px; line-height: 1; padding: 0;
}
.gm-lock:hover { background: #2e2e2e; }
.gm-lock--on, .gm-lock--on:hover {
  background: #e8e8e8; border-color: #ffffff; color: #101010; font-weight: 700;
}
.gm-list { border: 1px solid #2e2e2e; border-radius: 6px; overflow: hidden; }
.gm-item {
  display: flex; align-items: center; padding: 5px 7px;
  border-bottom: 1px solid #242424;
}
.gm-item > * + * { margin-left: 6px; }
.gm-item:last-child { border-bottom: 0; }
.gm-item:nth-child(odd) { background: #1b1b1b; }
.gm-item__id { color: #7a7a7a; min-width: 42px; font-variant-numeric: tabular-nums; }
.gm-item__name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gm-empty { color: #7a7a7a; text-align: center; padding: 18px; }
.gm-more { width: 100%; margin-top: 6px; }
.gm-toast {
  position: absolute; left: 50%; bottom: 26px; transform: translate(-50%, 14px);
  padding: 7px 14px; border-radius: 6px; background: #262626; border: 1px solid #4a4a4a;
  color: #f0f0f0; opacity: 0; transition: opacity .25s, transform .25s; pointer-events: none;
  max-width: 80vw;
}
.gm-toast--in { opacity: 1; transform: translate(-50%, 0); }
.gm-toast--err { background: #1a1a1a; border-color: #d0d0d0; color: #ffffff; font-weight: 700; }
@media (max-width: 560px), (max-height: 460px) {
  .gm-panel {
    width: 100vw; max-width: 100vw;
    height: 100vh; max-height: 100vh;
    border-radius: 0; border: 0;
  }
  .gm-panel--moved { position: static; }
  .gm-head { cursor: default; }
  .gm-main { flex-direction: column; }
  .gm-tabs {
    width: 100%; display: flex; overflow-x: auto; overflow-y: hidden;
    border-right: 0; border-bottom: 1px solid #2e2e2e; touch-action: pan-x;
  }
  .gm-tab {
    width: auto; flex: none; padding: 7px 11px;
    border-left: 0; border-bottom: 3px solid transparent;
  }
  .gm-tab--on, .gm-tab--on:hover {
    border-left-color: transparent; border-bottom-color: #ffffff;
  }
  .gm-now { margin-left: 12px; }
}
.gm-ta {
  width: 100%; height: 180px; resize: vertical; font-family: ui-monospace, Consolas, monospace;
  font-size: 11px; line-height: 1.4;
}
.gm-ta--sm { height: 86px; }
.gm-ta--ro { color: #9a9a9a; background: #0a0a0a; }
`;

function injectStyle() {
    if (document.getElementById("gm-style")) return;
    const s = document.createElement("style");
    s.id = "gm-style";
    s.textContent = CSS;
    document.head.appendChild(s);
}

const W = {

    sec(text) {
        return U.el("div", { class: "gm-sec", text });
    },

    hint(text) {
        return U.el("div", { class: "gm-hint", text });
    },

    btn(label, onclick, cls, title) {
        return U.el("button", { class: "gm-btn " + (cls || ""), text: label, title: title || null, onclick });
    },

    confirm(label, onYes, cls, guard) {
        let armed = false, timer = 0;
        const reset = () => {
            armed = false;
            clearTimeout(timer);
            b.textContent = label;
            b.classList.remove("gm-btn--warn");
        };
        const b = W.btn(label, () => {

            if (guard && guard() === false) return;
            if (!armed) {
                armed = true;
                b.textContent = "再点一次确认";
                b.classList.add("gm-btn--warn");
                timer = setTimeout(reset, 3000);
                return;
            }
            reset();
            onYes();
        }, cls);
        return b;
    },

    toggle(label, get, set, extra) {
        const sw = U.el("div", { class: "gm-sw" + (get() ? " gm-sw--on" : "") });
        sw.addEventListener("click", () => {
            const v = !get();
            set(v);
            sw.classList.toggle("gm-sw--on", !!get());
        });
        return U.el("div", { class: "gm-row" }, [
            sw, U.el("span", { class: "gm-grow", text: label })
        ].concat(extra || []));
    },

    num(label, get, set, opts) {
        opts = opts || {};
        const input = U.el("input", {
            class: "gm-in gm-in--num", type: "number", value: String(get())
        });
        const apply = () => {
            set(U.int(input.value, get()));
            input.value = String(get());
            if (opts.refresh !== false) G.refresh();
        };
        input.addEventListener("keydown", e => { if (e.key === "Enter") apply(); });
        const extra = (opts.presets || []).map(p =>
            W.btn(p.label, () => { set(p.value); G.refresh(); }, "gm-btn--sm"));
        const aside = (opts.now === undefined || opts.now === null)
            ? (opts.note || null)
            : ("当前值:" + opts.now);
        const nameEl = U.el("span", { class: "gm-grow" }, [
            U.el("span", { text: label }),
            aside ? U.el("span", { class: "gm-now", text: aside }) : null
        ]);
        return U.el("div", { class: "gm-row" }, [
            nameEl, input,
            W.btn("应用", apply, "gm-btn--sm gm-btn--main"), ...extra
        ]);
    },

    field(label, node) {
        return U.el("div", { class: "gm-field" }, [
            U.el("div", { class: "gm-field__k", text: label }), node
        ]);
    },

    line(label, node) {
        return U.el("div", { class: "gm-row" }, [
            U.el("span", { class: "gm-grow", text: label }), node
        ]);
    },

    textIn(value, set, opts) {
        opts = opts || {};
        const input = U.el("input", {
            class: "gm-in " + (opts.cls || "gm-in--full"),
            type: opts.type || "text",
            value: value === null || value === undefined ? "" : String(value),
            placeholder: opts.placeholder || "",
            spellcheck: "false", autocomplete: "off", autocapitalize: "off"
        });
        const commit = () => set(input.value.trim());
        input.addEventListener("change", commit);
        input.addEventListener("blur", commit);
        input.addEventListener("keydown", e => { if (e.key === "Enter") { commit(); input.blur(); } });
        return input;
    },

    numBox(value, set, opts) {
        opts = opts || {};
        const input = U.el("input", {
            class: "gm-in gm-in--sm", type: "number",
            value: String(value),
            min: opts.min === undefined ? null : String(opts.min),
            max: opts.max === undefined ? null : String(opts.max),
            step: String(opts.step || 1)
        });
        const commit = () => {
            let n = parseFloat(input.value);
            if (!Number.isFinite(n)) n = value;
            if (opts.min !== undefined) n = Math.max(opts.min, n);
            if (opts.max !== undefined) n = Math.min(opts.max, n);
            if (!opts.float) n = Math.round(n);
            else n = Math.round(n * 100) / 100;
            input.value = String(n);
            set(n);
        };
        input.addEventListener("change", commit);
        input.addEventListener("blur", commit);
        return input;
    },

    pick(options, value, set) {
        const sel = U.el("select", { class: "gm-in gm-in--full" });
        for (const o of options) {
            const v = Array.isArray(o) ? o[0] : o;
            const label = Array.isArray(o) ? o[1] : o;
            const op = U.el("option", { value: v, text: label });
            if (String(v) === String(value)) op.selected = true;
            sel.appendChild(op);
        }
        sel.addEventListener("change", () => set(sel.value));
        return sel;
    },

    bar() {
        const fill = U.el("div", { class: "gm-bar__f" });
        const box = U.el("div", { class: "gm-bar" }, [fill]);
        box.set = p => { fill.style.width = U.clamp(p, 0, 100).toFixed(1) + "%"; };
        return box;
    },

    lock(isLocked, onToggle) {
        const b = U.el("button", {
            class: "gm-lock" + (isLocked() ? " gm-lock--on" : ""),
            title: "锁定后游戏内的改动会被忽略"
        });
        const paint = () => {
            b.textContent = isLocked() ? "锁" : "解";
            b.classList.toggle("gm-lock--on", !!isLocked());
        };
        paint();
        b.addEventListener("click", () => { onToggle(!isLocked()); paint(); });
        return b;
    },

    search(placeholder, oninput, value) {
        const input = U.el("input", {
            class: "gm-in gm-grow", type: "search", placeholder: placeholder || "搜索…",
            value: value || ""
        });
        let timer = 0;
        input.addEventListener("input", () => {
            clearTimeout(timer);
            timer = setTimeout(() => oninput(input.value), 160);
        });
        return input;
    },

    list(items, renderItem, opts) {
        opts = opts || {};
        const step = opts.step || 80;
        const box = U.el("div", { class: "gm-list" });
        const wrap = U.el("div", {}, [box]);
        let shown = 0;

        const more = W.btn("", () => { grow(); }, "gm-more");

        function grow() {
            const end = Math.min(items.length, shown + step);
            for (let i = shown; i < end; i++) box.appendChild(renderItem(items[i], i));
            shown = end;
            if (shown >= items.length) more.style.display = "none";
            else {
                more.style.display = "";
                more.textContent = "显示更多（还有 " + (items.length - shown) + " 条）";
            }
        }

        if (!items.length) {
            box.appendChild(U.el("div", { class: "gm-empty", text: opts.empty || "没有匹配项" }));
            more.style.display = "none";
        } else {
            grow();
        }
        wrap.appendChild(more);
        return wrap;
    },

    item(id, name, controls) {
        return U.el("div", { class: "gm-item" }, [
            U.el("span", { class: "gm-item__id", text: id === null ? "" : "#" + id }),
            U.el("span", { class: "gm-item__name", text: name, title: name }),
            ...[].concat(controls || [])
        ]);
    },

    needGame(container) {
        if (U.inGame()) return false;
        container.appendChild(U.el("div", { class: "gm-empty", text: "先进入游戏（读档或新游戏）再用这一页。" }));
        return true;
    }
};
G.w = W;

const UI = {
    root: null,
    fab: null,
    mask: null,
    panel: null,
    bodyEl: null,
    tabsEl: null,
    current: null,
    open: false
};
G.ui = UI;

G.addTab = function (tab) {
    G.tabs.push(tab);
};

const SWALLOW = [
    "pointerdown", "pointerup", "pointermove", "pointercancel",
    "mousedown", "mouseup", "mousemove", "click", "dblclick",
    "touchstart", "touchend", "touchmove", "touchcancel",
    "wheel", "keydown", "keyup", "keypress", "contextmenu"
];

function isolate(node) {
    for (const type of SWALLOW) {
        node.addEventListener(type, e => e.stopPropagation(), false);
    }
}

function makeDraggable(fab) {
    let dragging = false, moved = false, sx = 0, sy = 0, ox = 0, oy = 0, pid = null;

    function place(x, y) {
        const w = fab.offsetWidth, h = fab.offsetHeight;
        x = U.clamp(x, 2, window.innerWidth - w - 2);
        y = U.clamp(y, 2, window.innerHeight - h - 2);
        fab.style.left = x + "px";
        fab.style.top = y + "px";
        return { x, y };
    }
    fab._place = place;

    fab.addEventListener("pointerdown", e => {
        dragging = true; moved = false; pid = e.pointerId;
        sx = e.clientX; sy = e.clientY;
        ox = fab.offsetLeft; oy = fab.offsetTop;
        try { fab.setPointerCapture(pid); } catch (err) {  }
        e.preventDefault();
    });

    fab.addEventListener("pointermove", e => {
        if (!dragging) return;
        const dx = e.clientX - sx, dy = e.clientY - sy;
        if (!moved && Math.hypot(dx, dy) > 5) {
            moved = true;
            fab.classList.add("gm-fab--drag");
        }
        if (moved) place(ox + dx, oy + dy);
    });

    function end() {
        if (!dragging) return;
        dragging = false;
        fab.classList.remove("gm-fab--drag");
        if (moved) {
            Store.set("fab", { x: fab.offsetLeft, y: fab.offsetTop });
        } else {
            G.toggle(true);
        }
        try { fab.releasePointerCapture(pid); } catch (err) {  }
    }
    fab.addEventListener("pointerup", end);
    fab.addEventListener("pointercancel", end);
}

function makePanelDraggable(panel, head) {
    let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0, pid = null;

    function narrow() {
        return window.innerWidth <= 560 || window.innerHeight <= 460;
    }

    function place(x, y) {
        const w = panel.offsetWidth, h = panel.offsetHeight;

        x = U.clamp(x, 40 - w, window.innerWidth - 40);
        y = U.clamp(y, 0, window.innerHeight - 32);
        panel.style.left = x + "px";
        panel.style.top = y + "px";
    }
    panel._place = place;

    head.addEventListener("pointerdown", e => {
        if (narrow()) return;
        if (e.target.closest(".gm-x")) return;
        const r = panel.getBoundingClientRect();
        if (!panel.classList.contains("gm-panel--moved")) {
            panel.classList.add("gm-panel--moved");
            panel.style.left = r.left + "px";
            panel.style.top = r.top + "px";
        }
        dragging = true; pid = e.pointerId;
        sx = e.clientX; sy = e.clientY;
        ox = parseFloat(panel.style.left) || r.left;
        oy = parseFloat(panel.style.top) || r.top;
        try { head.setPointerCapture(pid); } catch (err) {  }
        e.preventDefault();
    });

    head.addEventListener("pointermove", e => {
        if (!dragging) return;
        place(ox + (e.clientX - sx), oy + (e.clientY - sy));
    });

    function end() {
        if (!dragging) return;
        dragging = false;
        Store.set("panel", { x: parseFloat(panel.style.left), y: parseFloat(panel.style.top) });
        try { head.releasePointerCapture(pid); } catch (err) {  }
    }
    head.addEventListener("pointerup", end);
    head.addEventListener("pointercancel", end);
}

function buildUI() {
    if (UI.root) return;
    injectStyle();

    const root = U.el("div", { class: "gm-root", id: "gm-root" });
    isolate(root);

    const fab = U.el("button", { class: "gm-fab", title: "Grimoire", text: "⚙" });
    fab.style.opacity = String(G.param("buttonOpacity", 0.75));
    const pos = Store.get("fab", null);
    fab.style.left = (pos ? pos.x : Math.max(8, window.innerWidth - 60)) + "px";
    fab.style.top = (pos ? pos.y : 70) + "px";
    makeDraggable(fab);
    root.appendChild(fab);

    const tabsEl = U.el("div", { class: "gm-tabs" });
    const bodyEl = U.el("div", { class: "gm-body" });
    const titleEl = U.el("span", { class: "gm-title", text: "Grimoire" });
    const subEl = U.el("span", { class: "gm-sub", text: "Coder : Liset" });

    const headEl = U.el("div", { class: "gm-head" }, [
        titleEl, subEl,
        U.el("span", { class: "gm-spacer" }),
        U.el("button", { class: "gm-x", text: "×", onclick: () => G.toggle(false) })
    ]);
    const panel = U.el("div", { class: "gm-panel" }, [
        headEl,
        U.el("div", { class: "gm-main" }, [tabsEl, bodyEl])
    ]);
    makePanelDraggable(panel, headEl);

    const mask = U.el("div", { class: "gm-mask", style: { display: "none" } }, [panel]);

    mask.addEventListener("pointerdown", e => { if (e.target === mask) G.toggle(false); });
    root.appendChild(mask);

    document.body.appendChild(root);

    Object.assign(UI, { root, fab, mask, panel, bodyEl, tabsEl, subEl });

    for (const tab of G.tabs) {
        const btn = U.el("button", { class: "gm-tab", text: tab.label, onclick: () => G.showTab(tab.id) });
        btn.dataset.tab = tab.id;
        tabsEl.appendChild(btn);
    }

    if (G.param("startHidden", false)) fab.style.display = "none";

    const pp = Store.get("panel", null);
    if (pp && window.innerWidth > 560 && window.innerHeight > 460) {
        panel.classList.add("gm-panel--moved");
        panel.style.left = pp.x + "px";
        panel.style.top = pp.y + "px";
    }

    window.addEventListener("resize", () => {
        if (fab._place) fab._place(fab.offsetLeft, fab.offsetTop);
        if (panel._place && panel.classList.contains("gm-panel--moved")) {
            panel._place(parseFloat(panel.style.left) || 0, parseFloat(panel.style.top) || 0);
        }
    });
}

G.toggle = function (show) {
    buildUI();
    UI.open = show === undefined ? !UI.open : !!show;
    UI.mask.style.display = UI.open ? "flex" : "none";
    if (G.vkeys) G.vkeys.sync();
    UI.fab.style.display = UI.open ? "none" : (G.param("startHidden", false) && !UI.forceFab ? "none" : "flex");
    if (UI.open) {
        UI.forceFab = true;
        G.showTab(UI.current || (G.tabs[0] && G.tabs[0].id));
    }
};

G.showTab = function (id) {
    buildUI();
    const tab = G.tabs.find(t => t.id === id) || G.tabs[0];
    if (!tab) return;
    UI.current = tab.id;
    for (const b of UI.tabsEl.children) {
        b.classList.toggle("gm-tab--on", b.dataset.tab === tab.id);
    }
    G.refresh();
};

G.refresh = function () {
    if (!UI.open || !UI.current) return;
    const tab = G.tabs.find(t => t.id === UI.current);
    if (!tab) return;
    UI.bodyEl.innerHTML = "";
    try {
        tab.render(UI.bodyEl);
    } catch (e) {
        UI.bodyEl.appendChild(U.el("div", { class: "gm-empty", text: "此页出错：" + e.message }));
        console.error("[Grimoire]", e);
    }
};

function bindHotkey() {
    const key = String(G.param("hotkey", "Insert") || "").trim();
    if (!key) return;
    window.addEventListener("keydown", e => {
        if (e.key === key || e.code === key) {
            e.preventDefault();
            e.stopPropagation();
            G.toggle();
        }
    }, true);
}

G.cheat = {
    invincible: Store.get("c.invincible", false),
    oneHit: Store.get("c.oneHit", false),
    freeSkill: Store.get("c.freeSkill", false),
    noEncounter: Store.get("c.noEncounter", false),
    through: Store.get("c.through", false),
    fastText: Store.get("c.fastText", false),
    speed: Store.get("c.speed", 1),
    expRate: Store.get("c.expRate", 1),
    goldRate: Store.get("c.goldRate", 1)
};

G.setCheat = function (k, v) {
    G.cheat[k] = v;
    Store.set("c." + k, v);
};

G.reloadSettings = function () {
    for (const k of ["invincible", "oneHit", "freeSkill", "noEncounter", "through", "fastText"]) {
        G.cheat[k] = Store.get("c." + k, false);
    }
    G.cheat.speed = Store.get("c.speed", 1);
    G.cheat.expRate = Store.get("c.expRate", 1);
    G.cheat.goldRate = Store.get("c.goldRate", 1);
    G.fontDelta = Store.get("gameFontDelta", 0);
};

const LOCK_KINDS = ["sw", "va", "item"];

G.locks = {};
for (const k of LOCK_KINDS) G.locks[k] = Store.get("lock." + k, {}) || {};
G._bypass = false;

G.isLocked = function (kind, id) {
    return Object.prototype.hasOwnProperty.call(G.locks[kind] || {}, String(id));
};

function lockRead(kind, id) {
    if (kind === "item") return $gameParty.numItems($dataItems[id]);
    return (kind === "sw" ? $gameSwitches : $gameVariables).value(id);
}

function lockWrite(kind, id, value) {
    if (kind === "item") RM.setItemCount($dataItems[id], value);
    else (kind === "sw" ? $gameSwitches : $gameVariables).setValue(id, value);
}

G.writeValue = function (kind, id, value) {
    if (G.isLocked(kind, id)) {
        G.locks[kind][String(id)] = value;
        Store.set("lock." + kind, G.locks[kind]);
    }
    G._bypass = true;
    try {
        lockWrite(kind, id, value);
    } finally {
        G._bypass = false;
    }
};

G.setLock = function (kind, id, on) {
    const key = String(id);
    if (on) G.locks[kind][key] = lockRead(kind, id);
    else delete G.locks[kind][key];
    Store.set("lock." + kind, G.locks[kind]);
};

G.applyLocks = function () {
    if (!U.inGame()) return;
    G._bypass = true;
    try {
        for (const kind of LOCK_KINDS) {
            for (const key of Object.keys(G.locks[kind])) {
                lockWrite(kind, Number(key), G.locks[kind][key]);
            }
        }
    } catch (e) {
        console.error("[Grimoire] 应用锁定失败", e);
    } finally {
        G._bypass = false;
    }
};

G.clearLocks = function (kind) {
    G.locks[kind] = {};
    Store.set("lock." + kind, G.locks[kind]);
};

function installLockHooks() {
    const _switchesSetValue = Game_Switches.prototype.setValue;
    Game_Switches.prototype.setValue = function (id, value) {
        if (!G._bypass && G.isLocked("sw", id)) return;
        _switchesSetValue.call(this, id, value);
    };

    const _variablesSetValue = Game_Variables.prototype.setValue;
    Game_Variables.prototype.setValue = function (id, value) {
        if (!G._bypass && G.isLocked("va", id)) return;
        _variablesSetValue.call(this, id, value);
    };

    const _gainItem = Game_Party.prototype.gainItem;
    Game_Party.prototype.gainItem = function (item, amount, includeEquip) {
        if (!G._bypass && item && item.itypeId !== undefined && G.isLocked("item", item.id)) return;
        _gainItem.call(this, item, amount, includeEquip);
    };

    const _extractSaveContents = DataManager.extractSaveContents;
    DataManager.extractSaveContents = function (contents) {
        _extractSaveContents.call(this, contents);
        G.applyLocks();
    };
    const _setupNewGame = DataManager.setupNewGame;
    DataManager.setupNewGame = function () {
        _setupNewGame.call(this);
        G.applyLocks();
    };
}

function installHooks() {
    installLockHooks();

    const _setHp = Game_BattlerBase.prototype.setHp;
    Game_BattlerBase.prototype.setHp = function (hp) {
        if (G.cheat.invincible && this.isActor() && hp < this._hp) return;
        _setHp.call(this, hp);
    };

    const _makeDamageValue = Game_Action.prototype.makeDamageValue;
    Game_Action.prototype.makeDamageValue = function (target, critical) {
        if (G.cheat.oneHit && this.subject() && this.subject().isActor() &&
            target && target.isEnemy() && (this.isDamage() || this.isDrain())) {
            return 999999;
        }
        return _makeDamageValue.call(this, target, critical);
    };

    const _paySkillCost = Game_BattlerBase.prototype.paySkillCost;
    Game_BattlerBase.prototype.paySkillCost = function (skill) {
        if (G.cheat.freeSkill && this.isActor()) return;
        _paySkillCost.call(this, skill);
    };
    const _canPaySkillCost = Game_BattlerBase.prototype.canPaySkillCost;
    Game_BattlerBase.prototype.canPaySkillCost = function (skill) {
        if (G.cheat.freeSkill && this.isActor()) return true;
        return _canPaySkillCost.call(this, skill);
    };

    const _canEncounter = Game_Player.prototype.canEncounter;
    Game_Player.prototype.canEncounter = function () {
        if (G.cheat.noEncounter) return false;
        return _canEncounter.call(this);
    };

    const _isDebugThrough = Game_Player.prototype.isDebugThrough;
    Game_Player.prototype.isDebugThrough = function () {
        if (G.cheat.through) return true;
        return _isDebugThrough.call(this);
    };

    if (typeof Window_Message !== "undefined") {
        const _updateShowFast = Window_Message.prototype.updateShowFast;
        Window_Message.prototype.updateShowFast = function () {
            if (G.cheat.fastText) this._showFast = true;
            _updateShowFast.call(this);
        };
    }

    const _gainExp = Game_Actor.prototype.gainExp;
    Game_Actor.prototype.gainExp = function (exp) {
        _gainExp.call(this, Math.round(exp * (G.cheat.expRate || 1)));
    };
    const _goldTotal = Game_Troop.prototype.goldTotal;
    Game_Troop.prototype.goldTotal = function () {
        return Math.round(_goldTotal.call(this) * (G.cheat.goldRate || 1));
    };

    const _updateMain = SceneManager.updateMain;
    SceneManager.updateMain = function () {
        const times = Math.round(G.cheat.speed || 1);
        if (times > 1) {
            for (let i = 0; i < times - 1; i++) {
                try {
                    if (this.updateInputData) this.updateInputData();
                    this.changeScene();
                    this.updateScene();
                } catch (e) {
                    G.setCheat("speed", 1);
                    console.error("[Grimoire] 加速中断", e);
                    break;
                }
            }
        }
        _updateMain.apply(this, arguments);
    };
}

const VK_PULSE = 3;

const VK_SIZE = 48;
const VK_OPACITY = 0.8;

const VK_DEFS = [

    { id: "ff", label: "快进", face: "快进", keys: ["ok", "control"], hold: true },
    { id: "menu", label: "菜单", face: "菜单", keys: ["escape"] },
    { id: "ok", label: "确定", face: "确定", keys: ["ok"] },
    { id: "cancel", label: "取消", face: "取消", keys: ["cancel"] },
    { id: "pageup", label: "上一页", face: "上页", keys: ["pageup"] },
    { id: "pagedown", label: "下一页", face: "下页", keys: ["pagedown"] },
    { id: "dash", label: "冲刺", face: "冲刺", keys: ["shift"], hold: true },
    { id: "dpad", label: "方向键", pad: true }
];

const VK_PAD = [
    { key: "up", face: "▲", col: 1, row: 0 },
    { key: "left", face: "◀", col: 0, row: 1 },
    { key: "right", face: "▶", col: 2, row: 1 },
    { key: "down", face: "▼", col: 1, row: 2 }
];

const VK = {
    defs: VK_DEFS,
    layer: null,
    edit: false,
    primary: null,
    held: Object.create(null),
    pulse: Object.create(null),
    real: Object.create(null)
};
G.vkeys = VK;

function vkState(name, down) {
    const st = typeof Input !== "undefined" && Input._currentState;
    if (st) st[name] = down;
}

function vkPress(name) {
    VK.held[name] = (VK.held[name] || 0) + 1;
    vkState(name, true);
}

function vkRelease(name) {
    const n = (VK.held[name] || 0) - 1;
    if (n > 0) {
        VK.held[name] = n;
        return;
    }
    delete VK.held[name];

    if (!VK.pulse[name] && !VK.real[name]) vkState(name, false);
}

function vkTap(name) {
    VK.pulse[name] = VK_PULSE;
}

function vkFrame() {
    for (const name in VK.pulse) {
        if (VK.pulse[name] > 0) {
            VK.pulse[name]--;
            vkState(name, true);
        } else {
            delete VK.pulse[name];
            if (!VK.held[name] && !VK.real[name]) vkState(name, false);
        }
    }
    for (const name in VK.held) vkState(name, true);
}

function vkAfter() {
    const p = VK.primary;
    if (!p || !VK.held[p]) return;
    const cur = Input._latestButton;
    if (cur !== p && cur && VK.held[cur]) Input._latestButton = p;
}

VK.releaseAll = function () {

    if (VK.layer) {
        const btns = VK.layer.querySelectorAll(".gm-vk__btn");
        for (let i = 0; i < btns.length; i++) {
            if (btns[i]._vkEnd) btns[i]._vkEnd();
        }
    }
    for (const name in VK.held) {
        delete VK.held[name];
        if (!VK.real[name]) vkState(name, false);
    }
    VK.primary = null;
};

function vkMap(key) {
    const m = Store.get(key, null);
    return (m && typeof m === "object") ? m : {};
}

VK.enabled = function (id) {
    return !!vkMap("vk.on")[id];
};

VK.setEnabled = function (id, on) {
    const m = vkMap("vk.on");
    if (on) m[id] = 1; else delete m[id];
    Store.set("vk.on", m);
    VK.sync();
};

VK.size = function (id) {
    return U.clamp(vkMap("vk.size")[id] || VK_SIZE, 28, 120);
};

VK.setSize = function (id, px) {
    const m = vkMap("vk.size");
    m[id] = U.clamp(px, 28, 120);
    Store.set("vk.size", m);
    VK.sync();
};

VK.opacity = function (id) {
    const v = vkMap("vk.opacity")[id];
    return U.clamp(typeof v === "number" ? v : VK_OPACITY, 0.1, 1);
};

VK.setOpacity = function (id, a) {
    const m = vkMap("vk.opacity");
    m[id] = U.clamp(a, 0.1, 1);
    Store.set("vk.opacity", m);
    VK.sync();
};

VK.setEdit = function (on) {
    VK.edit = !!on;
    VK.sync();
};

VK.reset = function () {
    Store.set("vk.pos", {});
    VK.sync();
};

function vkPos(id) {
    return vkMap("vk.pos")[id] || null;
}

function vkSavePos(id, x, y) {
    const m = vkMap("vk.pos");
    m[id] = { x: Math.round(x), y: Math.round(y) };
    Store.set("vk.pos", m);
}

function vkPlace(node, x, y) {
    const w = node.offsetWidth, h = node.offsetHeight;
    x = U.clamp(x, 0, Math.max(0, window.innerWidth - w));
    y = U.clamp(y, 0, Math.max(0, window.innerHeight - h));
    node.style.left = x + "px";
    node.style.top = y + "px";
}

function vkAutoPos(def, size, cur) {
    const edge = 18, gap = 10;
    if (def.pad) return { x: edge, y: window.innerHeight - size * 3 - edge };
    if (cur.y - size < edge) {
        cur.x -= cur.w + gap;
        cur.y = window.innerHeight - edge;
        cur.w = 0;
    }
    const pos = { x: cur.x - size, y: cur.y - size };
    cur.y -= size + gap;
    cur.w = Math.max(cur.w, size);
    return pos;
}

function vkBindKey(node, keys, hold) {
    let pid = null, down = false;

    function begin(e) {
        if (VK.edit || down) return;
        down = true;
        pid = e.pointerId;
        node.classList.add("gm-vk__btn--down");
        try { node.setPointerCapture(pid); } catch (err) {  }
        if (hold && keys.length > 1) VK.primary = keys[0];
        for (const k of keys) {
            if (hold) vkPress(k); else vkTap(k);
        }
        e.preventDefault();
    }

    function end() {
        if (!down) return;
        down = false;
        node.classList.remove("gm-vk__btn--down");
        if (hold) {
            if (VK.primary === keys[0]) VK.primary = null;
            for (const k of keys) vkRelease(k);
        }
        try { node.releasePointerCapture(pid); } catch (err) {  }
    }

    node._vkEnd = end;
    node.addEventListener("pointerdown", begin);
    node.addEventListener("pointerup", end);
    node.addEventListener("pointercancel", end);
    node.addEventListener("lostpointercapture", end);

    node.addEventListener("pointerleave", end);
}

function vkBindDrag(node, id) {
    let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0, pid = null;

    node.addEventListener("pointerdown", e => {
        if (!VK.edit) return;
        dragging = true;
        pid = e.pointerId;
        sx = e.clientX; sy = e.clientY;
        ox = node.offsetLeft; oy = node.offsetTop;
        try { node.setPointerCapture(pid); } catch (err) {  }
        e.preventDefault();
    });

    node.addEventListener("pointermove", e => {
        if (!dragging) return;
        vkPlace(node, ox + (e.clientX - sx), oy + (e.clientY - sy));
    });

    function end() {
        if (!dragging) return;
        dragging = false;
        vkSavePos(id, node.offsetLeft, node.offsetTop);
        try { node.releasePointerCapture(pid); } catch (err) {  }
    }
    node.addEventListener("pointerup", end);
    node.addEventListener("pointercancel", end);
}

function vkFont(size) {
    return U.clamp(Math.round(size * 0.32), 11, 18);
}

function vkBuildBtn(def, size) {
    const b = U.el("div", { class: "gm-vk__btn", text: def.face });
    b.style.width = b.style.height = size + "px";
    b.style.fontSize = vkFont(size) + "px";
    vkBindKey(b, def.keys, !!def.hold);
    return b;
}

function vkBuildPad(def, size) {
    const box = U.el("div", { class: "gm-vk__pad" });
    box.style.width = box.style.height = size * 3 + "px";
    for (const a of VK_PAD) {
        const b = U.el("div", { class: "gm-vk__btn gm-vk__btn--arrow", text: a.face });
        b.style.width = b.style.height = size + "px";
        b.style.left = a.col * size + "px";
        b.style.top = a.row * size + "px";
        b.style.fontSize = vkFont(size) + "px";
        vkBindKey(b, [a.key], true);
        box.appendChild(b);
    }
    return box;
}

VK.sync = function () {
    if (!UI.root) return;
    VK.releaseAll();

    if (!VK.layer) {
        VK.layer = U.el("div", { class: "gm-vk" });

        UI.root.insertBefore(VK.layer, UI.mask || null);
    }
    VK.layer.innerHTML = "";
    VK.layer.classList.toggle("gm-vk--edit", VK.edit);

    const list = VK_DEFS.filter(d => VK.enabled(d.id));
    if (!list.length || UI.open) {
        VK.layer.style.display = "none";
        return;
    }
    VK.layer.style.display = "";

    const cur = { x: window.innerWidth - 18, y: window.innerHeight - 18, w: 0 };
    for (const def of list) {
        const size = VK.size(def.id);
        const node = def.pad ? vkBuildPad(def, size) : vkBuildBtn(def, size);
        node.style.opacity = String(VK.opacity(def.id));
        vkBindDrag(node, def.id);
        VK.layer.appendChild(node);
        const p = vkPos(def.id) || vkAutoPos(def, size, cur);
        vkPlace(node, p.x, p.y);
    }
};

function installVKeys() {
    if (typeof Input === "undefined") return;

    const _update = Input.update;
    Input.update = function () {
        try { vkFrame(); } catch (e) {  }
        _update.apply(this, arguments);
        try { vkAfter(); } catch (e) {  }
    };

    const keyName = e => (Input.keyMapper && Input.keyMapper[e.keyCode]) || null;
    window.addEventListener("keydown", e => {
        const n = keyName(e);
        if (n) VK.real[n] = true;
    }, true);
    window.addEventListener("keyup", e => {
        const n = keyName(e);
        if (n) delete VK.real[n];
    }, true);

    window.addEventListener("blur", () => {
        for (const k in VK.real) delete VK.real[k];
        VK.releaseAll();
    });
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) VK.releaseAll();
    });

    window.addEventListener("resize", () => {
        if (VK.layer && VK.layer.style.display !== "none") VK.sync();
    });
}

G.state.actor = { id: 0, page: "base", skillQuery: "", stateQuery: "" };

function currentActor() {
    const st = G.state.actor;
    if (!st.id) {
        const m = $gameParty.members();
        st.id = m.length ? m[0].actorId() : 1;
    }
    return $gameActors.actor(st.id);
}

function actorPicker(root) {
    const st = G.state.actor;
    const sel = U.el("select", { class: "gm-in gm-grow" });
    const inParty = new Set($gameParty.members().map(a => a.actorId()));
    for (let i = 1; i < $dataActors.length; i++) {
        const d = $dataActors[i];
        if (!d || !d.name) continue;
        const opt = U.el("option", {
            value: String(i),
            text: "#" + i + " " + U.plain(d.name) + (inParty.has(i) ? "  ◆队伍中" : "")
        });
        if (i === st.id) opt.selected = true;
        sel.appendChild(opt);
    }
    sel.addEventListener("change", () => { st.id = U.int(sel.value, 1); G.refresh(); });
    root.appendChild(U.el("div", { class: "gm-row" }, [sel]));
}

function actorBase(root, a) {
    const terms = ($dataSystem.terms && $dataSystem.terms.params) || [];

    root.appendChild(W.sec("等级 / 经验"));
    root.appendChild(W.num("等级", () => a.level,
        v => a.changeLevel(U.clamp(v, 1, a.maxLevel()), false), {
        note: "上限:" + a.maxLevel(),
        presets: [{ label: "满级", value: a.maxLevel() }]
    }));
    root.appendChild(W.num("经验值", () => a.currentExp(), v => a.changeExp(Math.max(0, v), false)));

    root.appendChild(W.sec("当前状态值"));
    root.appendChild(W.num("HP", () => a.hp, v => a.setHp(U.clamp(v, 0, a.mhp)),
        { note: "上限:" + a.mhp, presets: [{ label: "全满", value: a.mhp }] }));
    root.appendChild(W.num("MP", () => a.mp, v => a.setMp(U.clamp(v, 0, a.mmp)),
        { note: "上限:" + a.mmp, presets: [{ label: "全满", value: a.mmp }] }));
    root.appendChild(W.num("TP", () => Math.floor(a.tp), v => a.setTp(U.clamp(v, 0, a.maxTp())),
        { note: "上限:" + a.maxTp(), presets: [{ label: "全满", value: a.maxTp() }] }));

    root.appendChild(W.sec("能力值加成"));
    for (let p = 0; p < 8; p++) {
        root.appendChild(W.num(terms[p] || ("参数" + p), () => a._paramPlus[p] || 0, v => {
            a._paramPlus[p] = v;
            a.refresh();
        }, { now: a.param(p) }));
    }

    root.appendChild(W.sec("队伍"));
    const inParty = $gameParty.members().some(m => m.actorId() === a.actorId());
    root.appendChild(U.el("div", { class: "gm-row" }, [
        W.btn(inParty ? "移出队伍" : "加入队伍", () => {
            if (inParty) $gameParty.removeActor(a.actorId());
            else $gameParty.addActor(a.actorId());
            G.refresh();
        }, inParty ? "gm-btn--warn" : "gm-btn--main"),
        W.btn("完全恢复", () => { a.recoverAll(); U.toast("已恢复"); G.refresh(); })
    ]));

    if ($dataClasses && $dataClasses.length > 2) {
        root.appendChild(W.sec("职业"));
        const sel = U.el("select", { class: "gm-in gm-grow" });
        for (let i = 1; i < $dataClasses.length; i++) {
            const c = $dataClasses[i];
            if (!c || !c.name) continue;
            const o = U.el("option", { value: String(i), text: "#" + i + " " + U.plain(c.name) });
            if (i === a._classId) o.selected = true;
            sel.appendChild(o);
        }
        root.appendChild(U.el("div", { class: "gm-row" }, [
            sel,
            W.btn("切换", () => {
                a.changeClass(U.int(sel.value, a._classId), true);
                U.toast("已换职业"); G.refresh();
            }, "gm-btn--main")
        ]));
    }
}

function actorSkills(root, a) {
    const st = G.state.actor;
    root.appendChild(U.el("div", { class: "gm-row" }, [
        W.search("搜索技能", v => { st.skillQuery = v; G.refresh(); }, st.skillQuery),
        W.btn("全部学会", () => {
            let n = 0;
            for (let i = 1; i < $dataSkills.length; i++) {
                if ($dataSkills[i] && $dataSkills[i].name) { a.learnSkill(i); n++; }
            }
            U.toast("学会 " + n + " 个技能"); G.refresh();
        }, "gm-btn--sm gm-btn--main")
    ]));

    const rows = [];
    for (let i = 1; i < $dataSkills.length; i++) {
        const s = $dataSkills[i];
        if (!s || !s.name) continue;
        if (st.skillQuery && !U.match(s.name, st.skillQuery) && String(i) !== st.skillQuery.trim()) continue;
        rows.push(s);
    }

    root.appendChild(W.list(rows, s => {
        const has = a.isLearnedSkill(s.id);
        const sw = U.el("div", { class: "gm-sw" + (has ? " gm-sw--on" : "") });
        sw.addEventListener("click", () => {
            if (a.isLearnedSkill(s.id)) a.forgetSkill(s.id); else a.learnSkill(s.id);
            sw.classList.toggle("gm-sw--on", a.isLearnedSkill(s.id));
        });
        return W.item(s.id, U.plain(s.name), [sw]);
    }, { empty: "没有匹配的技能" }));
}

function actorStates(root, a) {
    const st = G.state.actor;
    root.appendChild(U.el("div", { class: "gm-row" }, [
        W.search("搜索状态", v => { st.stateQuery = v; G.refresh(); }, st.stateQuery),
        W.btn("清除全部", () => { a.clearStates(); a.refresh(); U.toast("已清除"); G.refresh(); },
            "gm-btn--sm gm-btn--warn")
    ]));

    const rows = [];
    for (let i = 1; i < $dataStates.length; i++) {
        const s = $dataStates[i];
        if (!s || !s.name) continue;
        if (st.stateQuery && !U.match(s.name, st.stateQuery) && String(i) !== st.stateQuery.trim()) continue;
        rows.push(s);
    }

    root.appendChild(W.list(rows, s => {
        const sw = U.el("div", { class: "gm-sw" + (a.isStateAffected(s.id) ? " gm-sw--on" : "") });
        sw.addEventListener("click", () => {
            if (a.isStateAffected(s.id)) a.removeState(s.id); else a.addState(s.id);
            a.refresh();
            sw.classList.toggle("gm-sw--on", a.isStateAffected(s.id));
        });
        return W.item(s.id, U.plain(s.name), [sw]);
    }, { empty: "没有匹配的状态" }));
}

G.addTab({
    id: "actor",
    label: "角色",
    render(root) {
        if (W.needGame(root)) return;
        const st = G.state.actor;
        actorPicker(root);
        const a = currentActor();
        if (!a) {
            root.appendChild(U.el("div", { class: "gm-empty", text: "取不到这个角色" }));
            return;
        }

        const pages = [["base", "基本"], ["skills", "技能"], ["states", "状态"]];
        const nav = U.el("div", { class: "gm-row" });
        for (const [k, label] of pages) {
            nav.appendChild(W.btn(label, () => { st.page = k; G.refresh(); },
                st.page === k ? "gm-btn--sm gm-btn--main" : "gm-btn--sm"));
        }
        root.appendChild(nav);

        if (st.page === "skills") actorSkills(root, a);
        else if (st.page === "states") actorStates(root, a);
        else actorBase(root, a);
    }
});

G.addTab({
    id: "cheat",
    label: "增益",
    render(root) {
        const C = G.cheat;

        root.appendChild(W.sec("战斗"));
        root.appendChild(W.toggle("无敌", () => C.invincible, v => G.setCheat("invincible", v)));
        root.appendChild(W.toggle("秒杀", () => C.oneHit, v => G.setCheat("oneHit", v)));
        root.appendChild(W.toggle("技能不耗 MP / TP", () => C.freeSkill, v => G.setCheat("freeSkill", v)));

        root.appendChild(W.sec("移动"));
        root.appendChild(W.toggle("穿墙", () => C.through, v => G.setCheat("through", v)));
        root.appendChild(W.toggle("不遇敌", () => C.noEncounter, v => G.setCheat("noEncounter", v)));
        if (typeof ConfigManager !== "undefined") {
            root.appendChild(W.toggle("总是冲刺", () => !!ConfigManager.alwaysDash, v => {
                ConfigManager.alwaysDash = v;
                try { ConfigManager.save(); } catch (e) {  }
            }));
        }

        root.appendChild(W.sec("演出"));
        root.appendChild(W.toggle("对话瞬间显示", () => C.fastText, v => G.setCheat("fastText", v)));

        root.appendChild(W.sec("倍率"));
        const speeds = [1, 2, 3, 4, 6, 8];
        const speedRow = U.el("div", { class: "gm-row" }, [
            U.el("span", { class: "gm-grow", text: "游戏速度" })
        ]);
        for (const s of speeds) {
            speedRow.appendChild(W.btn(s + "×", () => { G.setCheat("speed", s); G.refresh(); },
                C.speed === s ? "gm-btn--sm gm-btn--main" : "gm-btn--sm"));
        }
        root.appendChild(speedRow);

        root.appendChild(W.num("经验倍率", () => C.expRate, v => G.setCheat("expRate", Math.max(0, v)), {
            presets: [{ label: "1×", value: 1 }, { label: "10×", value: 10 }, { label: "100×", value: 100 }]
        }));
        root.appendChild(W.num("金钱倍率", () => C.goldRate, v => G.setCheat("goldRate", Math.max(0, v)), {
            presets: [{ label: "1×", value: 1 }, { label: "10×", value: 10 }, { label: "100×", value: 100 }]
        }));

        root.appendChild(W.sec(""));
        root.appendChild(W.btn("全部关闭", () => {
            ["invincible", "oneHit", "freeSkill", "noEncounter", "through", "fastText"]
                .forEach(k => G.setCheat(k, false));
            G.setCheat("speed", 1);
            G.setCheat("expRate", 1);
            G.setCheat("goldRate", 1);
            U.toast("已全部关闭");
            G.refresh();
        }, "gm-btn--warn"));
    }
});

G.state.items = { kind: "item", query: "", onlyOwned: false };

G.addTab({
    id: "items",
    label: "道具",
    render(root) {
        if (W.needGame(root)) return;
        const st = G.state.items;
        const lists = RM.itemLists();

        root.appendChild(W.sec("金钱"));
        root.appendChild(W.num("持有金", () => $gameParty.gold(),
            v => $gameParty.gainGold(v - $gameParty.gold()), {
            presets: [
                { label: "9999", value: 9999 },
                { label: "99万", value: 999999 },
                { label: "上限", value: $gameParty.maxGold() }
            ]
        }));

        root.appendChild(W.sec("物品"));
        const kindRow = U.el("div", { class: "gm-row" });
        for (const l of lists) {
            kindRow.appendChild(W.btn(l.label, () => {
                st.kind = l.key;
                G.refresh();
            }, st.kind === l.key ? "gm-btn--main gm-btn--sm" : "gm-btn--sm"));
        }
        root.appendChild(kindRow);

        const cur = lists.find(l => l.key === st.kind) || lists[0];
        const lockable = cur.key === "item";

        root.appendChild(U.el("div", { class: "gm-row" }, [
            W.search("按名称 / 编号搜索", v => { st.query = v; G.refresh(); }, st.query)
        ]));

        root.appendChild(W.toggle("只看已持有", () => st.onlyOwned, v => {
            st.onlyOwned = v;
            G.refresh();
        }));

        const all = [];
        for (let i = 1; i < cur.data.length; i++) {
            const it = cur.data[i];
            if (!it || !it.name) continue;
            const n = $gameParty.numItems(it);
            if (st.onlyOwned && n <= 0) continue;
            if (st.query && !U.match(it.name, st.query) && String(i) !== st.query.trim()) continue;
            all.push(it);
        }

        const setCount = lockable
            ? (it, n) => G.writeValue("item", it.id, n)
            : (it, n) => RM.setItemCount(it, n);

        const bar = U.el("div", { class: "gm-row" }, [
            W.btn("当前列表全部设为 99", () => {
                all.forEach(it => setCount(it, 99));
                U.toast("已设置 " + all.length + " 项");
                G.refresh();
            }, "gm-btn--sm"),
            W.btn("当前列表清空", () => {
                all.forEach(it => setCount(it, 0));
                U.toast("已清空 " + all.length + " 项");
                G.refresh();
            }, "gm-btn--sm gm-btn--warn")
        ]);
        const lockCount = lockable ? Object.keys(G.locks.item).length : 0;
        if (lockCount) {
            bar.appendChild(W.btn("解除全部锁定（" + lockCount + "）", () => {
                G.clearLocks("item");
                U.toast("已解除 " + lockCount + " 个锁定");
                G.refresh();
            }, "gm-btn--sm gm-btn--warn"));
        }
        bar.appendChild(U.el("span", { class: "gm-sub", text: all.length + " 项" }));
        root.appendChild(bar);

        root.appendChild(W.list(all, it => {
            const input = U.el("input", {
                class: "gm-in gm-in--sm", type: "number", value: String($gameParty.numItems(it))
            });
            const commit = () => {
                setCount(it, Math.max(0, U.int(input.value, 0)));
                input.value = String($gameParty.numItems(it));
            };
            input.addEventListener("change", commit);
            input.addEventListener("keydown", e => { if (e.key === "Enter") commit(); });

            const step = d => {
                const n = Math.max(0, $gameParty.numItems(it) + d);
                setCount(it, n);
                input.value = String($gameParty.numItems(it));
            };
            const controls = [
                input,
                W.btn("+1", () => step(1), "gm-btn--sm"),
                W.btn("-1", () => step(-1), "gm-btn--sm")
            ];
            if (lockable) {
                controls.push(W.lock(() => G.isLocked("item", it.id),
                    on => { G.setLock("item", it.id, on); }));
            }
            return W.item(it.id, U.plain(it.name), controls);
        }, { empty: "没有匹配的" + cur.label }));
    }
});

G.state.flags = { sw: { query: "", named: true }, va: { query: "", named: true } };

function flagNames(kind) {
    const src = (typeof $dataSystem !== "undefined" && $dataSystem) || {};
    return (kind === "sw" ? src.switches : src.variables) || [];
}

function renderFlagTab(root, kind) {
    if (W.needGame(root)) return;
    const st = G.state.flags[kind];
    const names = flagNames(kind);
    const isSw = kind === "sw";
    const store = isSw ? $gameSwitches : $gameVariables;

    root.appendChild(U.el("div", { class: "gm-row" }, [
        W.search("按名称 / 编号搜索", v => { st.query = v; G.refresh(); }, st.query)
    ]));
    root.appendChild(W.toggle("只看有名字的", () => st.named, v => { st.named = v; G.refresh(); }));

    const rows = [];
    for (let i = 1; i < names.length; i++) {
        const name = names[i] || "";
        if (st.named && !name) continue;
        if (st.query && !U.match(name, st.query) && String(i) !== st.query.trim()) continue;
        rows.push({ id: i, name });
    }

    const lockCount = Object.keys(G.locks[kind]).length;
    const bar = U.el("div", { class: "gm-row" });
    if (isSw) {
        bar.appendChild(W.btn("当前列表全开", () => {
            rows.forEach(r => G.writeValue(kind, r.id, true));
            U.toast("已开 " + rows.length + " 个"); G.refresh();
        }, "gm-btn--sm"));
        bar.appendChild(W.btn("当前列表全关", () => {
            rows.forEach(r => G.writeValue(kind, r.id, false));
            U.toast("已关 " + rows.length + " 个"); G.refresh();
        }, "gm-btn--sm gm-btn--warn"));
    }
    if (lockCount) {
        bar.appendChild(W.btn("解除全部锁定（" + lockCount + "）", () => {
            G.clearLocks(kind);
            U.toast("已解除 " + lockCount + " 个锁定");
            G.refresh();
        }, "gm-btn--sm gm-btn--warn"));
    }
    bar.appendChild(U.el("span", { class: "gm-sub", text: rows.length + " 项" }));
    root.appendChild(bar);

    root.appendChild(W.list(rows, r => {
        const lockBtn = W.lock(() => G.isLocked(kind, r.id),
            on => { G.setLock(kind, r.id, on); });

        if (isSw) {
            const sw = U.el("div", { class: "gm-sw" + (store.value(r.id) ? " gm-sw--on" : "") });
            sw.addEventListener("click", () => {
                G.writeValue(kind, r.id, !store.value(r.id));
                sw.classList.toggle("gm-sw--on", !!store.value(r.id));
            });
            return W.item(r.id, r.name || "（未命名）", [sw, lockBtn]);
        }

        const input = U.el("input", {
            class: "gm-in gm-in--sm", type: "text", value: String(store.value(r.id))
        });
        const commit = () => {
            const raw = input.value.trim();
            const n = Number(raw);

            G.writeValue(kind, r.id, raw !== "" && Number.isFinite(n) ? n : raw);
            input.value = String(store.value(r.id));
        };
        input.addEventListener("change", commit);
        input.addEventListener("keydown", e => { if (e.key === "Enter") commit(); });
        return W.item(r.id, r.name || "（未命名）", [input, lockBtn]);
    }, { empty: "没有匹配项" }));
}

G.addTab({ id: "switches", label: "开关", render(root) { renderFlagTab(root, "sw"); } });
G.addTab({ id: "variables", label: "变量", render(root) { renderFlagTab(root, "va"); } });

function battleAction(name, fn) {
    return W.btn(name, () => {
        try {
            fn();
            U.toast(name);
            G.toggle(false);
        } catch (e) {
            U.toast(name + " 失败：" + e.message, "err");
        }
    });
}

G.addTab({
    id: "battle",
    label: "战斗",
    render(root) {
        if (W.needGame(root)) return;

        if (!U.inBattle()) {
            root.appendChild(U.el("div", { class: "gm-empty", text: "当前不在战斗中。" }));
            root.appendChild(W.sec("队伍"));
            root.appendChild(W.btn("全队完全恢复", () => {
                $gameParty.members().forEach(a => a.recoverAll());
                U.toast("已全队恢复");
            }, "gm-btn--main"));
            return;
        }

        root.appendChild(W.sec("结束战斗"));
        root.appendChild(U.el("div", { class: "gm-row" }, [
            battleAction("直接胜利", () => {
                $gameTroop.members().forEach(e => { e.setHp(0); e.performCollapse(); });
                BattleManager.processVictory();
            }),
            battleAction("直接逃跑", () => {
                if (BattleManager.processEscape) BattleManager.processEscape();
                else BattleManager.processAbort();
            }),
            battleAction("中断战斗", () => BattleManager.processAbort()),
            battleAction("直接失败", () => BattleManager.processDefeat())
        ]));

        root.appendChild(W.sec("我方"));
        root.appendChild(U.el("div", { class: "gm-row" }, [
            W.btn("全队恢复", () => {
                $gameParty.members().forEach(a => a.recoverAll());
                U.toast("已恢复"); G.refresh();
            }, "gm-btn--main"),
            W.btn("全队 HP 设为 1", () => {
                $gameParty.members().forEach(a => a.setHp(1));
                U.toast("已设为 1"); G.refresh();
            }, "gm-btn--warn")
        ]));
        root.appendChild(W.list($gameParty.members(), a =>
            W.item(a.actorId(), U.plain(a.name()), [
                U.el("span", { class: "gm-now", text: "当前值:" + a.hp + "/" + a.mhp }),
                W.btn("满血", () => { a.setHp(a.mhp); G.refresh(); }, "gm-btn--sm")
            ]), { empty: "队伍是空的" }));

        root.appendChild(W.sec("敌方"));
        root.appendChild(U.el("div", { class: "gm-row" }, [
            W.btn("全体 HP 设为 1", () => {
                $gameTroop.members().forEach(e => e.setHp(1));
                U.toast("已设为 1"); G.refresh();
            }, "gm-btn--sm"),
            W.btn("全体满血", () => {
                $gameTroop.members().forEach(e => e.setHp(e.mhp));
                U.toast("已回满"); G.refresh();
            }, "gm-btn--sm")
        ]));
        root.appendChild(W.list($gameTroop.members(), (e, i) => {
            const input = U.el("input", { class: "gm-in gm-in--sm", type: "number", value: String(e.hp) });
            const commit = () => {
                e.setHp(U.clamp(U.int(input.value, e.hp), 0, e.mhp));
                input.value = String(e.hp);
            };
            input.addEventListener("change", commit);
            input.addEventListener("keydown", ev => { if (ev.key === "Enter") commit(); });
            return W.item(i + 1, U.plain(e.name()), [
                U.el("span", { class: "gm-now", text: "当前值:" + e.hp + "/" + e.mhp }),
                input,
                W.btn("击杀", () => {
                    e.setHp(0);
                    e.performCollapse();
                    G.refresh();
                }, "gm-btn--sm gm-btn--warn")
            ]);
        }, { empty: "没有敌人" }));
    }
});

G.state.map = { query: "", target: 0, x: 0, y: 0 };

function tilesAt(md, x, y) {
    const w = md.width, h = md.height, out = [];
    for (let z = 3; z >= 0; z--) out.push(md.data[(z * h + y) * w + x] || 0);
    return out;
}

function isPassable(md, flags, x, y) {
    for (const t of tilesAt(md, x, y)) {
        const f = flags[t];
        if (f === undefined) continue;
        if ((f & 0x10) !== 0) continue;
        if ((f & 0x0f) === 0) return true;
        if ((f & 0x0f) === 0x0f) return false;
    }
    return false;
}

function findSpawn(md) {
    const ts = $dataTilesets[md.tilesetId];
    const flags = (ts && ts.flags) || [];
    const cx = Math.floor(md.width / 2), cy = Math.floor(md.height / 2);
    const max = Math.max(md.width, md.height);
    for (let r = 0; r < max; r++) {
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                const x = cx + dx, y = cy + dy;
                if (x < 0 || y < 0 || x >= md.width || y >= md.height) continue;
                if (isPassable(md, flags, x, y)) return { x, y };
            }
        }
    }
    return { x: cx, y: cy };
}

function doTransfer(mapId, x, y) {

    if (!(SceneManager._scene instanceof Scene_Map)) SceneManager.goto(Scene_Map);
    $gamePlayer.reserveTransfer(mapId, x, y, $gamePlayer.direction(), 0);
    G.toggle(false);
    U.toast("传送到 " + RM.mapName(mapId) + " (" + x + "," + y + ")");
}

G.addTab({
    id: "map",
    label: "地图",
    render(root) {
        if (W.needGame(root)) return;

        if (typeof $dataMap === "undefined" || !$dataMap || !$dataMap.width) {
            root.appendChild(U.el("div", { class: "gm-empty", text: "还没进到地图里，这一页要在地图上才能用。" }));
            return;
        }
        const st = G.state.map;

        root.appendChild(W.sec("当前位置"));
        root.appendChild(U.el("div", { class: "gm-row" }, [
            U.el("span", {
                class: "gm-grow",
                text: "#" + $gameMap.mapId() + " " + RM.mapName($gameMap.mapId()) +
                    "   (" + $gamePlayer.x + "," + $gamePlayer.y + ")   " +
                    $gameMap.width() + "×" + $gameMap.height()
            })
        ]));

        root.appendChild(W.sec("坐标传送（当前地图）"));
        const ix = U.el("input", { class: "gm-in gm-in--sm", type: "number", value: String($gamePlayer.x) });
        const iy = U.el("input", { class: "gm-in gm-in--sm", type: "number", value: String($gamePlayer.y) });
        root.appendChild(U.el("div", { class: "gm-row" }, [
            U.el("span", { text: "X" }), ix,
            U.el("span", { text: "Y" }), iy,
            W.btn("传送过去", () => {
                doTransfer($gameMap.mapId(),
                    U.clamp(U.int(ix.value, 0), 0, $gameMap.width() - 1),
                    U.clamp(U.int(iy.value, 0), 0, $gameMap.height() - 1));
            }, "gm-btn--main")
        ]));

        root.appendChild(W.sec("跳转到其他地图"));
        root.appendChild(U.el("div", { class: "gm-row" }, [
            W.search("按地图名 / 编号搜索", v => { st.query = v; G.refresh(); }, st.query)
        ]));

        const infos = (typeof $dataMapInfos !== "undefined" && $dataMapInfos) || [];
        const rows = [];
        for (let i = 1; i < infos.length; i++) {
            if (!infos[i]) continue;
            const name = RM.mapName(i);
            if (st.query && !U.match(name, st.query) && String(i) !== st.query.trim()) continue;
            rows.push({ id: i, name });
        }

        root.appendChild(U.el("div", { class: "gm-row" }, [
            U.el("span", { class: "gm-sub", text: rows.length + " 张地图" })
        ]));

        root.appendChild(W.list(rows, r => {
            const btn = W.btn("传送", async () => {
                btn.textContent = "…";
                try {
                    const md = await RM.fetchMap(r.id);
                    const p = findSpawn(md);
                    doTransfer(r.id, p.x, p.y);
                } catch (e) {
                    U.toast("读地图失败：" + e.message + "，已落在 (0,0)", "err");
                    doTransfer(r.id, 0, 0);
                }
            }, "gm-btn--sm gm-btn--main");
            return W.item(r.id, r.name, [btn]);
        }, { empty: "没有匹配的地图" }));
    }
});

G.state.event = { query: "" };

G.addTab({
    id: "event",
    label: "事件",
    render(root) {
        if (W.needGame(root)) return;
        const st = G.state.event;

        root.appendChild(U.el("div", { class: "gm-row" }, [
            W.search("按名称 / 编号搜索", v => { st.query = v; G.refresh(); }, st.query)
        ]));

        const all = RM.commonEvents().filter(e =>
            !st.query || U.match(e.name, st.query) || String(e.id) === st.query.trim());

        root.appendChild(U.el("div", { class: "gm-row" }, [
            U.el("span", { class: "gm-sub", text: all.length + " 个公共事件" })
        ]));

        root.appendChild(W.list(all, e =>
            W.item(e.id, e.name || "（未命名）", [
                U.el("span", { class: "gm-now", text: e.list.length + " 条指令" }),
                W.btn("执行", () => {
                    if (!(SceneManager._scene instanceof Scene_Map) && !U.inBattle()) {
                        SceneManager.goto(Scene_Map);
                    }
                    $gameTemp.reserveCommonEvent(e.id);
                    G.toggle(false);
                    U.toast("已排入公共事件 #" + e.id);
                }, "gm-btn--sm gm-btn--main")
            ]), { empty: "没有匹配的公共事件" }));
    }
});

function slotName(id) {
    return Env.isMZ ? DataManager.makeSavename(id) : id;
}

function readSlotRaw(id) {
    if (Env.isMZ) {
        return StorageManager.loadZip(slotName(id)).catch(() => null);
    }
    try {
        return Promise.resolve(StorageManager.load(id) || null);
    } catch (e) {
        return Promise.resolve(null);
    }
}

function writeSlotRaw(id, raw) {
    if (Env.isMZ) return Promise.resolve(StorageManager.saveZip(slotName(id), raw));
    StorageManager.save(id, raw);
    return Promise.resolve();
}

function readGlobalRaw() {
    if (Env.isMZ) return StorageManager.loadZip("global").catch(() => null);
    try {
        return Promise.resolve(StorageManager.load(0) || null);
    } catch (e) {
        return Promise.resolve(null);
    }
}

function writeGlobalRaw(raw) {
    if (Env.isMZ) return Promise.resolve(StorageManager.saveZip("global", raw));
    StorageManager.save(0, raw);
    return Promise.resolve();
}

async function exportAll() {
    const max = DataManager.maxSavefiles ? DataManager.maxSavefiles() : 20;
    const slots = {};
    for (let i = 1; i <= max; i++) {
        const raw = await readSlotRaw(i);
        if (raw) slots[i] = raw;
    }
    return {
        grimoire: 1,
        engine: Env.name,
        game: ($dataSystem && $dataSystem.gameTitle) || "",
        time: new Date().toISOString(),
        global: await readGlobalRaw(),
        slots
    };
}

async function importAll(pack, mode) {
    if (!pack || pack.grimoire !== 1) throw new Error("不是 Grimoire 导出的存档");
    if (pack.engine !== Env.name) {
        throw new Error("引擎不匹配：存档是 " + pack.engine + "，当前是 " + Env.name);
    }
    let n = 0;
    for (const k of Object.keys(pack.slots || {})) {
        const id = U.int(k, 0);
        if (!id) continue;
        if (mode === "skip" && await readSlotRaw(id)) continue;
        await writeSlotRaw(id, pack.slots[k]);
        n++;
    }
    if (pack.global) await writeGlobalRaw(pack.global);
    if (DataManager.loadGlobalInfo) DataManager.loadGlobalInfo();
    return n;
}

G.state.save = { text: "", busy: false };

G.addTab({
    id: "save",
    label: "存档",
    render(root) {
        const st = G.state.save;

        root.appendChild(W.sec("存档槽"));
        const max = DataManager.maxSavefiles ? DataManager.maxSavefiles() : 20;
        const info = (DataManager._globalInfo || []);
        const rows = [];
        for (let i = 1; i <= max; i++) {
            const g = info[i];
            rows.push({
                id: i,
                name: g ? ((g.title || "存档") + "  " + (g.playtime || "") ) : "（空）",
                used: !!g
            });
        }
        root.appendChild(W.list(rows, r => W.item(r.id, r.name, [
            W.btn("存", () => {
                if (!U.inGame()) return U.toast("还没进入游戏", "err");
                RM.saveGame(r.id).then(() => {
                    U.toast("已存入 " + r.id); G.refresh();
                }).catch(e => U.toast("存档失败：" + e.message, "err"));
            }, "gm-btn--sm"),
            r.used ? W.btn("读", () => {
                RM.loadGame(r.id).then(() => {
                    G.toggle(false);
                    if (typeof Scene_Map !== "undefined") {
                        $gamePlayer.reserveTransfer($gameMap.mapId(), $gamePlayer.x, $gamePlayer.y,
                            $gamePlayer.direction(), 0);
                        SceneManager.goto(Scene_Map);
                    }
                    U.toast("已读取 " + r.id);
                }).catch(e => U.toast("读档失败：" + e.message, "err"));
            }, "gm-btn--sm gm-btn--main") : null
        ]), { step: 40, empty: "没有存档槽" }));

        root.appendChild(W.sec("导出 / 导入"));

        const ta = U.el("textarea", { class: "gm-in gm-ta", placeholder: "点「导出」生成，或将之前导出的文本粘贴到此处后点「导入」" });
        ta.value = st.text;
        ta.addEventListener("input", () => { st.text = ta.value; });

        const doExport = async () => {
            if (st.busy) return;
            st.busy = true;
            U.toast("正在读取存档…");
            try {
                const pack = await exportAll();
                const n = Object.keys(pack.slots).length;
                st.text = JSON.stringify(pack);
                ta.value = st.text;
                U.toast("已导出 " + n + " 个存档（共 " + Math.round(st.text.length / 1024) + " KB）");
            } catch (e) {
                U.toast("导出失败：" + e.message, "err");
            }
            st.busy = false;
        };

        const doImport = async (mode) => {
            if (st.busy) return;
            let pack;
            try {
                pack = JSON.parse(ta.value);
            } catch (e) {
                return U.toast("文本不是合法 JSON", "err");
            }
            st.busy = true;
            try {
                const n = await importAll(pack, mode);
                U.toast("已导入 " + n + " 个存档");
                G.refresh();
            } catch (e) {
                U.toast("导入失败：" + e.message, "err");
            }
            st.busy = false;
        };

        root.appendChild(U.el("div", { class: "gm-row" }, [
            W.btn("导出全部", doExport, "gm-btn--main"),
            W.btn("复制", async () => {
                ta.select();
                try {
                    await navigator.clipboard.writeText(ta.value);
                    U.toast("已复制到剪贴板");
                } catch (e) {

                    try {
                        document.execCommand("copy");
                        U.toast("已复制到剪贴板");
                    } catch (e2) {
                        U.toast("复制失败，请手动选中后复制", "err");
                    }
                }
            }),
            W.btn("下载文件", () => {
                try {
                    const blob = new Blob([ta.value], { type: "application/json" });
                    const a = U.el("a", {
                        href: URL.createObjectURL(blob),
                        download: "grimoire-save-" + Date.now() + ".json"
                    });
                    document.body.appendChild(a);
                    a.click();
                    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
                } catch (e) {
                    U.toast("当前环境不支持下载，请改用「复制」", "err");
                }
            })
        ]));
        root.appendChild(ta);
        root.appendChild(U.el("div", { class: "gm-row" }, [
            W.btn("导入（覆盖同号存档）", () => doImport("overwrite"), "gm-btn--warn"),
            W.btn("导入（跳过已占用）", () => doImport("skip"))
        ]));
    }
});

function transSec(s) {
    s = Math.max(0, Math.round(s));
    const m = Math.floor(s / 60);
    return (m ? m + " 分 " : "") + (s % 60) + " 秒";
}

G.state.trans = { busy: "", io: "" };

G.addTab({
    id: "translate",
    label: "翻译",
    render(root) {
        const c = TR.cfg;
        const st = G.state.trans;
        const busy = () => st.busy || TR.running;

        root.appendChild(W.sec("接口"));

        root.appendChild(W.field("API 地址",
            W.textIn(c.endpoint, v => TR.set("endpoint", v), { placeholder: "https://api.openai.com/v1" })));
        root.appendChild(W.field("API 密钥",
            W.textIn(c.apiKey, v => TR.set("apiKey", v), { placeholder: "sk-…", type: "password" })));

        const modelIn = W.textIn(c.model, v => TR.set("model", v), { placeholder: "gpt-4o-mini" });
        root.appendChild(W.field("模型", modelIn));
        if (TR.models.length) {
            const opts = [["", "从列表中选择（" + TR.models.length + " 个）"]].concat(TR.models.map(m => [m, m]));

            root.appendChild(U.el("div", { class: "gm-field" }, [
                W.pick(opts, c.model, v => {
                    if (!v) return;
                    TR.set("model", v);
                    modelIn.value = v;
                    U.toast("已选择 " + v);
                })
            ]));
        }

        root.appendChild(U.el("div", { class: "gm-row" }, [
            W.btn(st.busy === "models" ? "获取中…" : "获取模型", async () => {
                if (busy()) return;
                st.busy = "models";
                G.refresh();
                try {
                    const ids = await TR.fetchModels();
                    U.toast(ids.length ? ("已获取 " + ids.length + " 个模型") : "接口未返回模型列表，请手动填写");
                } catch (e) {
                    U.toast("获取失败：" + e.message, "err");
                    trLog("获取模型失败：" + e.message);
                }
                st.busy = "";
                G.refresh();
            }, "gm-btn--sm"),
            W.btn(st.busy === "test" ? "测试中…" : "测试连接", async () => {
                if (busy()) return;
                if (!String(c.model || "").trim()) return U.toast("请先填写模型", "err");
                st.busy = "test";
                G.refresh();
                const t0 = Date.now();
                try {
                    const out = await TR.translateTexts(["こんにちは、\\C[1]世界\\C[0]。"]);
                    const ms = Date.now() - t0;
                    U.toast("连接正常（" + ms + "ms）：" + out[0]);
                    trLog("测试成功（" + ms + "ms）：" + out[0]);
                } catch (e) {
                    U.toast("连接失败：" + e.message, "err");
                    trLog("测试失败：" + e.message);
                }
                st.busy = "";
                G.refresh();
            }, "gm-btn--sm")
        ]));

        root.appendChild(W.sec("语种"));
        root.appendChild(W.line("源语种",
            W.textIn(c.from, v => TR.set("from", v), { placeholder: "日语；留空则由模型判断", cls: "gm-in--mid" })));
        root.appendChild(W.line("目标语种",
            W.textIn(c.to, v => TR.set("to", v), { placeholder: "简体中文", cls: "gm-in--mid" })));

        root.appendChild(W.sec("提示词"));
        const fixed = U.el("textarea", { class: "gm-in gm-ta gm-ta--ro", readonly: "readonly", spellcheck: "false" });
        fixed.value = TR_FIXED_PROMPT;
        root.appendChild(U.el("details", { class: "gm-det" }, [
            U.el("summary", { text: "固定提示词（每次请求均附带，点击展开）" }),
            fixed
        ]));

        const extra = U.el("textarea", {
            class: "gm-in gm-ta gm-ta--sm", spellcheck: "false",
            placeholder: "例：主角「レン」统一译作「莲」；对话偏口语，旁白偏书面；保留日式敬称。"
        });
        extra.value = c.extra || "";
        const saveExtra = () => TR.set("extra", extra.value);
        extra.addEventListener("change", saveExtra);
        extra.addEventListener("blur", saveExtra);
        root.appendChild(W.field("额外提示词", extra));

        root.appendChild(W.sec("参数"));
        root.appendChild(U.el("div", { class: "gm-row" }, [
            U.el("span", { text: "并发连接数" }),
            W.numBox(c.concurrency, v => TR.set("concurrency", v), { min: 1, max: 32 }),
            U.el("span", { text: "每批条数" }),
            W.numBox(c.batchSize, v => TR.set("batchSize", v), { min: 1, max: 200 }),
            U.el("span", { text: "每批字数" }),
            W.numBox(c.batchChars, v => TR.set("batchChars", v), { min: 200, max: 40000 })
        ]));
        root.appendChild(U.el("div", { class: "gm-row" }, [
            U.el("span", { text: "温度" }),
            W.numBox(c.temperature, v => TR.set("temperature", v), { min: 0, max: 2, step: 0.1, float: true }),
            U.el("span", { text: "超时（秒）" }),
            W.numBox(c.timeout, v => TR.set("timeout", v), { min: 5, max: 900 })
        ]));

        root.appendChild(W.sec("扫描范围"));
        const scopeRow = U.el("div", { class: "gm-row" });
        for (const [k, label, tip] of TR_SCOPES) {
            scopeRow.appendChild(W.btn(label, () => {
                TR.setScope(k, !TR.scope[k]);
                G.refresh();
            }, "gm-btn--sm" + (TR.scope[k] ? " gm-btn--main" : ""), tip));
        }
        root.appendChild(scopeRow);

        root.appendChild(W.toggle("记录屏幕上未翻译的文字（" + TR.seen.length + " 条）",
            () => TR.collect, v => {
                TR.setCollect(v);
                G.refresh();
            }));
        if (TR.seen.length) {
            root.appendChild(U.el("div", { class: "gm-row" }, [
                W.confirm("清空屏幕记录", () => {
                    TR.clearSeen().then(() => {
                        U.toast("已清空");
                        G.refresh();
                    });
                }, "gm-btn--sm gm-btn--warn")
            ]));
        }

        const scanNote = U.el("span", { class: "gm-sub" });
        const paintScan = () => {
            const s = TR.scanInfo;
            scanNote.textContent = s
                ? ("共 " + s.total + " 条 / " + s.chars + " 字" +
                    (s.maps ? "，地图 " + s.maps + " 张" : "") +
                    (s.plugins ? "，插件 " + s.plugins + " 个" : "") +
                    (s.seen ? "，屏幕记录 " + s.seen + " 条" : "") +
                    (s.have ? "，其中 " + s.have + " 条已有译文" : ""))
                : "尚未扫描";
        };
        paintScan();
        root.appendChild(U.el("div", { class: "gm-row" }, [
            W.btn(st.busy === "scan" ? "扫描中…" : "扫描文本", async () => {
                if (busy()) return;
                st.busy = "scan";
                G.refresh();
                try {
                    await TR.scan((i, n, what) => {
                        if (scanNote.isConnected) {
                            scanNote.textContent = (what || "读取地图") + " " + i + " / " + n + "…";
                        }
                    });
                } catch (e) {
                    U.toast("扫描失败：" + e.message, "err");
                    trLog("扫描失败：" + e.message);
                }
                st.busy = "";
                G.refresh();
            }, "gm-btn--main"),
            scanNote
        ]));

        root.appendChild(W.sec("翻译"));
        const bar = W.bar();
        const stat = U.el("div", { class: "gm-stat" });
        root.appendChild(bar);
        root.appendChild(stat);

        const paint = () => {
            const s = TR.stats;
            const total = s.total || 0;
            const done = (s.done || 0) + (s.fail || 0);
            bar.set(total ? done * 100 / total : 0);
            const bits = [];
            if (total) {
                bits.push(done + " / " + total);
                if (s.changed !== undefined) bits.push("已修改 " + s.changed);
                if (s.fail) bits.push((s.changed !== undefined ? "跳过 " : "失败 ") + s.fail);
                const used = (Date.now() - s.t0) / 1000;
                bits.push("用时 " + transSec(used));
                if (TR.running && done > 0 && done < total) {
                    bits.push("预计剩余 " + transSec(used / done * (total - done)));
                }
            } else {
                bits.push("尚未开始");
            }
            stat.textContent = bits.join("  ·  ");
        };
        paint();

        const total = TR.units.length;
        const fails = TR.failCount();
        const hasDict = TR.dictSize() > 0;
        const start = job => () => {
            job().catch(e => {
                U.toast(e.message, "err");
                G.refresh();
            });
        };

        const row = U.el("div", { class: "gm-row" });
        if (TR.running) {
            row.appendChild(W.btn("停止", () => {
                TR.stop = true;
                U.toast("正在停止，当前批次完成后结束");
            }, "gm-btn--warn"));
        } else {
            row.appendChild(W.btn(total ? ("开始翻译（" + total + " 条）") : "开始翻译",
                start(() => TR.run()), "gm-btn--main"));

            row.appendChild(W.btn(fails ? ("修复翻译（" + fails + " 条）") : "修复翻译", () => {
                if (!hasDict) {
                    return U.toast("尚未生成翻译文件，无失败记录可修复；请先扫描并执行翻译", "err");
                }
                if (!fails) {
                    return U.toast("当前 " + TR.dictSize() + " 条译文均无失败记录，无需修复", "err");
                }
                start(() => TR.repair())();
            }, "gm-btn--sm" + (fails ? "" : " gm-btn--off")));

            const polish = W.confirm("深度润化", () => {
                U.toast("深度润化已开始：" + TR.dictSize() + " 条，同一会话顺序执行，耗时较长");
                start(() => TR.polish())();
            }, "gm-btn--sm" + (hasDict ? "" : " gm-btn--off"), () => {
                if (!hasDict) {
                    U.toast("尚未生成翻译文件，请先扫描并执行翻译", "err");
                    return false;
                }
                return true;
            });
            polish.title = "对全部译文统一术语、纠正错译；不可并发，耗时与费用高于一次翻译";
            row.appendChild(polish);
        }
        row.appendChild(W.btn("清空日志", () => {
            TR.log.length = 0;
            G.refresh();
        }, "gm-btn--sm"));
        root.appendChild(row);

        if (fails) {
            const list = U.el("div", { class: "gm-list" });
            for (const f of TR.failList().slice(0, 200)) {
                list.appendChild(W.item(null, U.plain(f.t), [
                    U.el("span", { class: "gm-sub", text: f.r, title: f.r })
                ]));
            }
            root.appendChild(U.el("details", { class: "gm-det" }, [
                U.el("summary", { text: "失败条目（" + fails + " 条 · 已随词典保存）" }),
                list,
                U.el("div", { class: "gm-row" }, [
                    W.confirm("清空失败记录", () => {
                        TR.clearFails().then(() => {
                            U.toast("已清空");
                            G.refresh();
                        });
                    }, "gm-btn--sm gm-btn--warn")
                ])
            ]));
        }

        const logEl = U.el("div", { class: "gm-log" });
        const paintLog = () => {
            logEl.textContent = TR.log.join("\n");
            logEl.scrollTop = logEl.scrollHeight;
        };
        paintLog();
        root.appendChild(logEl);

        TR.onUpdate = kind => {
            if (!stat.isConnected) {
                TR.onUpdate = null;
                return;
            }
            if (kind === "state") G.refresh();
            else if (kind === "log") paintLog();
            else paint();
        };

        root.appendChild(W.sec("词典"));
        root.appendChild(W.toggle("启用替换", () => TR.enabled, v => {
            TR.setEnabled(v);
            U.toast(v ? "已启用，重启游戏后全面生效" : "已关闭，重启游戏后恢复原文");
            G.refresh();
        }));

        const info = U.el("div", { class: "gm-list" });
        const rows = [
            ["词条", TR.ready ? (TR.dictSize() + " 条") : "读取中…"],
            ["术语表", TR.gloss.length + " 条"],
            ["存放位置", TR.where]
        ];
        for (const [k, v] of rows) info.appendChild(W.item(null, k, [U.el("span", { class: "gm-sub", text: String(v) })]));
        root.appendChild(info);

        root.appendChild(U.el("div", { class: "gm-row" }, [
            W.btn("应用到当前游戏", () => {
                const n = TR.applyAll(true);
                U.toast(n ? ("已应用 " + n + " 份数据；已显示的界面需重新打开后更新") : "词典为空");
            }),
            W.btn("重启游戏", () => {
                try {
                    location.reload();
                } catch (e) {
                    U.toast("重启失败：" + e.message, "err");
                }
            }, "gm-btn--sm"),
            W.confirm("恢复上一份", async () => {
                try {
                    const n = await TR.restoreBak();
                    U.toast("已恢复 " + n + " 条，重启游戏后全面生效");
                    G.refresh();
                } catch (e) {
                    U.toast(e.message, "err");
                }
            }, "gm-btn--sm"),
            W.confirm("清空词典", async () => {
                await TR.clearDict();
                U.toast("已清空，重启游戏后恢复原文");
                G.refresh();
            }, "gm-btn--sm gm-btn--warn")
        ]));

        const io = U.el("textarea", {
            class: "gm-in gm-ta", spellcheck: "false",
            placeholder: "点「导出」生成，或将已有词典粘贴至此后点「导入」"
        });
        io.value = st.io;
        io.addEventListener("input", () => { st.io = io.value; });

        const doImport = async (overwrite) => {
            if (!io.value.trim()) return U.toast("文本框为空", "err");
            try {
                const n = await TR.importDict(io.value, overwrite);
                U.toast("导入了 " + n + " 条");
                G.refresh();
            } catch (e) {
                U.toast("导入失败：" + e.message, "err");
            }
        };

        root.appendChild(U.el("details", { class: "gm-det" }, [
            U.el("summary", { text: "导出 / 导入词典" }),
            U.el("div", { class: "gm-row" }, [
                W.btn("导出", () => {
                    st.io = TR.exportDict();
                    io.value = st.io;
                    U.toast("已导出 " + TR.dictSize() + " 条（" + Math.round(st.io.length / 1024) + " KB）");
                }, "gm-btn--sm"),
                W.btn("复制", async () => {
                    io.select();
                    try {
                        await navigator.clipboard.writeText(io.value);
                        U.toast("已复制");
                    } catch (e) {
                        try {
                            document.execCommand("copy");
                            U.toast("已复制");
                        } catch (e2) {
                            U.toast("复制失败，请手动选中后复制", "err");
                        }
                    }
                }, "gm-btn--sm"),
                W.btn("下载文件", () => {
                    try {
                        const blob = new Blob([io.value], { type: "application/json" });
                        const a = U.el("a", {
                            href: URL.createObjectURL(blob),
                            download: "grimoire-dict-" + Date.now() + ".json"
                        });
                        document.body.appendChild(a);
                        a.click();
                        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
                    } catch (e) {
                        U.toast("当前环境不支持下载，请改用「复制」", "err");
                    }
                }, "gm-btn--sm")
            ]),
            io,
            U.el("div", { class: "gm-row" }, [
                W.btn("导入（覆盖同条）", () => doImport(true), "gm-btn--sm gm-btn--warn"),
                W.btn("导入（跳过已有）", () => doImport(false), "gm-btn--sm")
            ])
        ]));
    }
});

function pushScene(name) {
    const S = RM.scene(name);
    if (!S) return U.toast("该游戏没有 " + name, "err");
    try {
        SceneManager.push(S);
        G.toggle(false);
    } catch (e) {
        U.toast("打开失败：" + e.message, "err");
    }
}

G.addTab({
    id: "system",
    label: "系统",
    render(root) {
        root.appendChild(W.sec("屏幕按键"));
        root.appendChild(U.el("div", { class: "gm-row" }, [
            U.el("span", { class: "gm-grow" }),
            U.el("span", { class: "gm-colh", text: "大小 px" }),
            U.el("span", { class: "gm-colh", text: "不透明度 %" })
        ]));
        for (const def of VK.defs) {
            root.appendChild(W.toggle(def.label + (def.hold ? "（按住）" : ""),
                () => VK.enabled(def.id), v => VK.setEnabled(def.id, v), [
                    W.numBox(VK.size(def.id), v => VK.setSize(def.id, v), { min: 28, max: 120 }),
                    W.numBox(Math.round(VK.opacity(def.id) * 100),
                        v => VK.setOpacity(def.id, v / 100), { min: 10, max: 100 })
                ]));
        }
        root.appendChild(W.toggle("布局编辑模式（拖动调整按钮位置，期间暂停按键输入）",
            () => VK.edit, v => {
                VK.setEdit(v);
                if (v) U.toast("已进入布局编辑，关闭面板后拖动按钮");
            }));
        root.appendChild(U.el("div", { class: "gm-row" }, [
            W.btn("重置按键位置", () => { VK.reset(); U.toast("已复位"); })
        ]));

        root.appendChild(W.sec("打开场景"));
        const scenes = [
            ["菜单", "Scene_Menu"], ["物品", "Scene_Item"], ["技能", "Scene_Skill"],
            ["装备", "Scene_Equip"], ["状态", "Scene_Status"], ["整队", "Scene_Party"],
            ["存档", "Scene_Save"], ["读档", "Scene_Load"], ["设置", "Scene_Options"],
            ["调试", "Scene_Debug"], ["商店", "Scene_Shop"]
        ];
        const srow = U.el("div", { class: "gm-row" });
        for (const [label, name] of scenes) {
            if (!RM.scene(name)) continue;
            srow.appendChild(W.btn(label, () => pushScene(name), "gm-btn--sm"));
        }
        root.appendChild(srow);

        root.appendChild(U.el("div", { class: "gm-row" }, [
            W.btn("回到地图", () => {
                SceneManager.goto(Scene_Map); G.toggle(false);
            }, "gm-btn--sm"),
            W.btn("回到标题", () => {
                SceneManager.goto(Scene_Title); G.toggle(false);
            }, "gm-btn--sm gm-btn--warn")
        ]));

        if (!U.inGame()) return;

        root.appendChild(W.sec("解锁"));
        root.appendChild(W.toggle("允许打开菜单", () => $gameSystem.isMenuEnabled(),
            v => v ? $gameSystem.enableMenu() : $gameSystem.disableMenu()));
        root.appendChild(W.toggle("允许存档", () => $gameSystem.isSaveEnabled(),
            v => v ? $gameSystem.enableSave() : $gameSystem.disableSave()));
        root.appendChild(W.toggle("允许整队", () => $gameSystem.isFormationEnabled(),
            v => v ? $gameSystem.enableFormation() : $gameSystem.disableFormation()));
        root.appendChild(W.toggle("允许遇敌", () => $gameSystem.isEncounterEnabled(),
            v => v ? $gameSystem.enableEncounter() : $gameSystem.disableEncounter()));
        root.appendChild(W.toggle("测试模式（开了才有调试场景）", () => !!$gameTemp.isPlaytest(),
            v => { $gameTemp._isPlaytest = v; }));

        root.appendChild(W.sec("卡死修复"));
        const fixes = [
            ["清除所有图片", () => $gameScreen.clearPictures()],
            ["淡入屏幕", () => { $gameScreen.startFadeIn(1); if ($gameMap._interpreter) $gameMap._interpreter.setWaitMode(""); }],
            ["关闭对话框", () => { $gameMessage.clear(); }],
            ["中断当前事件", () => { if ($gameMap._interpreter) $gameMap._interpreter.clear(); }],
            ["解除移动锁定", () => {
                $gamePlayer._moveRouteForcing = false;
                $gamePlayer.setThrough(false);
                $gameMap.events().forEach(e => { e._moveRouteForcing = false; });
            }],
            ["解除画面色调", () => $gameScreen.startTint([0, 0, 0, 0], 1)],
            ["停止震动", () => $gameScreen.startShake(0, 0, 1)],
            ["重载当前地图", () => {
                $gamePlayer.reserveTransfer($gameMap.mapId(), $gamePlayer.x, $gamePlayer.y,
                    $gamePlayer.direction(), 0);
                SceneManager.goto(Scene_Map);
            }]
        ];
        const frow = U.el("div", { class: "gm-row" });
        for (const [label, fn] of fixes) {
            frow.appendChild(W.btn(label, () => {
                try { fn(); U.toast(label); } catch (e) { U.toast(label + " 失败：" + e.message, "err"); }
            }, "gm-btn--sm"));
        }
        root.appendChild(frow);

        root.appendChild(W.btn("一键全修（依次执行以上全部）", () => {
            let bad = 0;
            for (const [, fn] of fixes) { try { fn(); } catch (e) { bad++; } }
            U.toast(bad ? ("完成，" + bad + " 项失败") : "已全部执行");
            G.toggle(false);
        }, "gm-btn--main"));

        root.appendChild(W.sec("游戏信息"));
        const rows = [
            ["引擎", Env.name + " " + Env.version],
            ["运行环境", Env.isNwjs ? "NW.js (PC)" : (Env.isMobile ? "移动端浏览器 / WebView" : "浏览器")],
            ["标题", ($dataSystem && $dataSystem.gameTitle) || "-"],
            ["当前场景", U.sceneName()],
            ["游玩时间", $gameSystem.playtimeText ? $gameSystem.playtimeText() : "-"],
            ["步数", String($gameParty.steps())],
            ["存档次数", String($gameSystem.saveCount ? $gameSystem.saveCount() : "-")]
        ];
        const box = U.el("div", { class: "gm-list" });
        for (const [k, v] of rows) box.appendChild(W.item(null, k, [U.el("span", { text: v })]));
        root.appendChild(box);
    }
});

G.addTab({
    id: "settings",
    label: "设置",
    render(root) {
        root.appendChild(W.sec("界面"));

        root.appendChild(W.num("面板字号",
            () => Store.get("fs", 13),
            v => {
                const n = U.clamp(v, 10, 22);
                Store.set("fs", n);
                UI.root.style.setProperty("--gm-fs", n + "px");
            },
            { note: "px", presets: [{ label: "小", value: 12 }, { label: "中", value: 13 }, { label: "大", value: 16 }] }));

        root.appendChild(W.num("悬浮按钮透明度",
            () => Math.round(Store.get("fabOpacity", G.param("buttonOpacity", 0.75)) * 100),
            v => {
                const a = U.clamp(v, 10, 100) / 100;
                Store.set("fabOpacity", a);
                UI.fab.style.opacity = String(a);
            }, { note: "%" }));

        root.appendChild(U.el("div", { class: "gm-row" }, [
            W.btn("重置悬浮窗位置", () => {
                const x = Math.max(8, window.innerWidth - 60);
                UI.fab._place(x, 70);
                Store.set("fab", { x, y: 70 });

                UI.panel.classList.remove("gm-panel--moved");
                UI.panel.style.left = "";
                UI.panel.style.top = "";
                Store.set("panel", null);
                U.toast("已复位");
            })
        ]));

        root.appendChild(W.sec("游戏字号"));
        root.appendChild(W.num("增减量",
            () => Store.get("gameFontDelta", 0),
            v => {
                const n = U.clamp(v, -8, 16);
                Store.set("gameFontDelta", n);
                G.fontDelta = n;
                U.toast(n ? ("已 " + (n > 0 ? "+" : "") + n + "，重开窗口后生效") : "已还原");
            }));

        root.appendChild(W.sec("关于"));
        const rows = [
            ["Grimoire", "v" + G.version],
            ["引擎", Env.name + " " + Env.version],
            ["快捷键", G.param("hotkey", "Insert") || "（已禁用）"],
            ["开发者", "Liset"],
            ["QQ群", "771844665"]
        ];
        const box = U.el("div", { class: "gm-list" });
        for (const [k, v] of rows) box.appendChild(W.item(null, k, [U.el("span", { text: v })]));
        root.appendChild(box);

        root.appendChild(W.hint(
            "Grimoire是一个基于JavaScript的RPGMaker游戏插件，" +
            "支持PC(NW.js)、Android、WebView三种运行环境。"));

        root.appendChild(U.el("div", { class: "gm-row" }, [
            W.btn("清空 Grimoire 的所有设置", () => {
                try {
                    localStorage.removeItem(Store.key());
                    U.toast("已清空，重启游戏后生效");
                } catch (e) {
                    U.toast("清空失败：" + e.message, "err");
                }
            }, "gm-btn--warn")
        ]));
    }
});

G.fontDelta = Store.get("gameFontDelta", 0);

function installFontDelta() {
    if (Env.isMZ && typeof Game_System !== "undefined" && Game_System.prototype.mainFontSize) {
        const _mainFontSize = Game_System.prototype.mainFontSize;
        Game_System.prototype.mainFontSize = function () {
            return Math.max(8, _mainFontSize.call(this) + (G.fontDelta || 0));
        };
    } else if (typeof Window_Base !== "undefined" && Window_Base.prototype.standardFontSize) {
        const _standardFontSize = Window_Base.prototype.standardFontSize;
        Window_Base.prototype.standardFontSize = function () {
            return Math.max(8, _standardFontSize.call(this) + (G.fontDelta || 0));
        };
    }
}

function installBoot() {
    if (typeof Scene_Boot === "undefined") return;
    const _start = Scene_Boot.prototype.start;
    Scene_Boot.prototype.start = function () {
        _start.apply(this, arguments);
        try {
            G.reloadSettings();
            buildUI();
            const fs = Store.get("fs", 13);
            UI.root.style.setProperty("--gm-fs", fs + "px");
            UI.fab.style.opacity = String(Store.get("fabOpacity", G.param("buttonOpacity", 0.75)));
            VK.sync();
        } catch (e) {
            console.error("[Grimoire] 建面板失败", e);
        }
    };
}

function boot() {

    const steps = [
        ["hooks", installHooks],
        ["trans", installTransHooks],
        ["font", installFontDelta],
        ["vkeys", installVKeys],
        ["boot", installBoot],
        ["hotkey", bindHotkey]
    ];
    for (const [name, fn] of steps) {
        try {
            fn();
        } catch (e) {
            console.error("[Grimoire] " + name + " 安装失败", e);
        }
    }
    console.log("[Grimoire] v" + G.version + " on " + Env.name + " " + Env.version +
        " / " + G.tabs.length + " tabs");
}

boot();

})();
