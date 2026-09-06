/**
 * 碎屑 - 统一数据层
 * INITIAL_DATA 与 localStorage 深度合并
 */

const DATA_VERSION = 'v12';

const INITIAL_DATA = {
  scintilla: [
    {
      id: "sci_1714560000000",
      date: "2026.05.02",
      content: "碎屑的第一条记录！",
      moodTag: "TEST"
    },
      {
      id: "202508公众科学日",
      date: "2026.05.08",
      content: "好忙！",
      moodTag: "TEST"
    },
  ],

  inlandEmpire: [
    {
      id: "ie_1714560000000",
      date: "2026.04.28",
      src: "testpic1.png",
      alt: "Archive 001",
      category: "photo",
      caption: "#AdventureTime_S04E23"
    }
  ],

  gravityRainbow: [
    {
      id: "gr_1714560000000",
      date: "2026.04.25",
      title: "Eigenstate Thermalization Hypothesis: A Short Review - 笔记",
      mdFile: "ETH_Review_Notes.md",
      mdContent: "",
      tags: ["物理", "量子", "ETH", "热化"]
    }
  ],

  bSide: [
    {
      id: "bs_1714387200000",
      date: "————————",
      content: "羞于启齿"
    },
    {
      id: "bs_1749648000000",
      date: "2026.05.11",
      content: "在梦寐以求的时刻，盛大的期待最终只析出了一滩空虚。"
    },
    {
      id: "bs_1749665024000",
      date: "2026.05.11",
      content: "向朋友诉说我无聊可笑的忧虑，风从一块石头吹进另一块石头"
    },
    {
      id: "bs_1788451200000",
      date: "2026.09.04",
      content: "Broken Dreams"
    },
    {
      id: "bs_1788710400000",
      date: "2026.09.07",
      content: "如果记忆能被挖去"
    },
    {
      id: "bs_1788710400001",
      date: "2026.09.07",
      content: "请给我第二次的生命吧"
    },
  ],

  manifesto: {
    text: "When I was a child, I spake as a child, I understood as a child, I thought as a child: but when I became a man, I put away childish things.",
    bgStyle: "dark-geo"
  }
};

const STORAGE_KEY = 'skadrate_blog_v1';
const BSIDE_UNLOCK_KEY = 'skadrate_bside_unlocked';
const DELETED_KEY = 'skadrate_deleted_ids';
const RETIRED_IDS = {
  bSide: ['bs_1749561600000', 'bs_1747219200000']
};

const SkadrateData = {
  load() {
    // 检查数据版本，如果版本不匹配就清除所有缓存，彻底重置
    try {
      const cachedVersion = localStorage.getItem('skadrate_data_version');
      if (cachedVersion !== DATA_VERSION) {
        console.log(`[SkadrateData] 版本变更 ${cachedVersion} -> ${DATA_VERSION}，清除旧缓存`);
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(DELETED_KEY);
        localStorage.setItem('skadrate_data_version', DATA_VERSION);
        return JSON.parse(JSON.stringify(INITIAL_DATA));
      }
    } catch (e) {}

    let stored = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) stored = JSON.parse(raw);
    } catch (e) {
      console.error('Failed to load data from localStorage', e);
    }
    const merged = JSON.parse(JSON.stringify(INITIAL_DATA));

    // 读取已删除的 ID 记录
    let deletedIds = {};
    try {
      deletedIds = JSON.parse(localStorage.getItem(DELETED_KEY) || '{}');
    } catch (e) {}

    if (stored) {
      Object.keys(stored).forEach(key => {
        if (Array.isArray(merged[key]) && Array.isArray(stored[key])) {
          const mergedMap = new Map(merged[key].map(i => [i.id, i]));
          const storedMap = new Map(stored[key].map(i => [i.id, i]));

          // 先处理 INITIAL_DATA 中的条目：保留用户修改，跳过已删除
          merged[key].forEach(item => {
            if (deletedIds[key] && deletedIds[key].includes(item.id)) {
              mergedMap.delete(item.id);
              return;
            }
            if (storedMap.has(item.id)) {
              storedMap.set(item.id, { ...item, ...storedMap.get(item.id) });
            }
          });

          // 再把 stored 里独有的条目加进来
          storedMap.forEach((item, id) => {
            if (!mergedMap.has(id)) {
              mergedMap.set(id, item);
            }
          });

          merged[key] = Array.from(mergedMap.values());
        } else if (typeof merged[key] === 'object' && merged[key] !== null && !Array.isArray(merged[key])) {
          merged[key] = { ...merged[key], ...stored[key] };
        } else {
          merged[key] = stored[key];
        }
      });
    }

    Object.entries(RETIRED_IDS).forEach(([category, ids]) => {
      if (!Array.isArray(merged[category])) return;
      merged[category] = merged[category].filter(item => !ids.includes(item.id));
    });

    return merged;
  },

  save(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error('Failed to save data to localStorage', e);
    }
  },

  addItem(category, item) {
    const data = this.load();
    if (!data[category]) data[category] = [];
    if (!item.id) item.id = `${category}_${Date.now()}`;
    data[category].unshift(item);
    this.save(data);
    return item.id;
  },

  deleteItem(category, id) {
    const data = this.load();
    if (!Array.isArray(data[category])) return false;
    const idx = data[category].findIndex(i => i.id === id);
    if (idx === -1) return false;
    data[category].splice(idx, 1);
    this.save(data);

    // 记录已删除的 ID，防止 INITIAL_DATA 重新加载时恢复
    try {
      let deleted = JSON.parse(localStorage.getItem(DELETED_KEY) || '{}');
      if (!deleted[category]) deleted[category] = [];
      if (!deleted[category].includes(id)) deleted[category].push(id);
      localStorage.setItem(DELETED_KEY, JSON.stringify(deleted));
    } catch (e) {}

    return true;
  },

  updateItem(category, id, newItem) {
    const data = this.load();
    if (!Array.isArray(data[category])) return false;
    const idx = data[category].findIndex(i => i.id === id);
    if (idx === -1) return false;
    data[category][idx] = { ...data[category][idx], ...newItem, id };
    this.save(data);
    return true;
  },

  getLatest(category, count = 4) {
    const data = this.load();
    const arr = data[category];
    if (!Array.isArray(arr)) return [];
    return arr.slice(0, count);
  },

  getAll(category) {
    const data = this.load();
    const arr = data[category];
    if (!Array.isArray(arr)) return [];
    return arr;
  },

  bSide: {
    isUnlocked() {
      return sessionStorage.getItem(BSIDE_UNLOCK_KEY) === 'true';
    },
    unlock() {
      sessionStorage.setItem(BSIDE_UNLOCK_KEY, 'true');
    },
    lock() {
      sessionStorage.removeItem(BSIDE_UNLOCK_KEY);
    }
  }
};

if (typeof window !== 'undefined') window.SkadrateData = SkadrateData;
if (typeof module !== 'undefined' && module.exports) module.exports = { INITIAL_DATA, SkadrateData };
