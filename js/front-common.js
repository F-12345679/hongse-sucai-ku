/* ============================================
   前台公用数据与 localStorage 逻辑
   首页、详情页共用；不修改 js/data.js 原始数据
   ============================================ */
(function (global) {
  'use strict';

  var CUSTOM_KEY = 'hongse_custom_materials_v1';
  var STATS_KEY = 'hongse_material_stats_v1';

  function readJSON(key, fallback) {
    try {
      var raw = global.localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (err) {
      return fallback;
    }
  }

  function getOriginalMaterials() {
    /* data.js 使用顶层 const 声明，不会挂到 window 上；
       这里优先读取同名全局词法绑定，再兼容 window.materials */
    var originals;
    if (typeof materials !== 'undefined') {
      originals = materials;
    } else if (Array.isArray(global.materials)) {
      originals = global.materials;
    }
    return Array.isArray(originals) ? originals : [];
  }

  function isUsableMaterial(item) {
    return item && typeof item === 'object' && item.id != null && typeof item.title === 'string';
  }

  function cloneMaterial(material) {
    var copy = {};
    Object.keys(material).forEach(function (key) {
      copy[key] = material[key];
    });
    copy.tags = Array.isArray(material.tags) ? material.tags.slice() : [];
    copy.type = Array.isArray(material.type) ? material.type.slice() : [];
    return copy;
  }

  function getCustomMaterials() {
    var list = readJSON(CUSTOM_KEY, []);
    if (!Array.isArray(list)) return [];
    return list.filter(isUsableMaterial).map(cloneMaterial);
  }

  function saveCustomMaterials(list) {
    try {
      global.localStorage.setItem(CUSTOM_KEY, JSON.stringify(list));
      return true;
    } catch (err) {
      return false;
    }
  }

  function addCustomMaterial(material) {
    var list = getCustomMaterials();
    list.push(cloneMaterial(material));
    return saveCustomMaterials(list);
  }

  function nextCustomId() {
    var maxId = 999;
    getOriginalMaterials().concat(getCustomMaterials()).forEach(function (item) {
      var id = Number(item.id);
      if (isFinite(id) && id > maxId) maxId = id;
    });
    return maxId + 1;
  }

  function getStats() {
    var stats = readJSON(STATS_KEY, {});
    if (!stats || typeof stats !== 'object' || Array.isArray(stats)) return {};
    return stats;
  }

  function saveStats(stats) {
    try {
      global.localStorage.setItem(STATS_KEY, JSON.stringify(stats));
      return true;
    } catch (err) {
      return false;
    }
  }

  function toCount(value, fallback) {
    var num = Number(value);
    return isFinite(num) && num >= 0 ? num : (Number(fallback) || 0);
  }

  function applyStats(material, stats) {
    var copy = cloneMaterial(material);
    var entry = stats[String(material.id)];
    copy.views = entry && entry.views != null
      ? toCount(entry.views, material.views)
      : toCount(material.views, 0);
    copy.downloads = entry && entry.downloads != null
      ? toCount(entry.downloads, material.downloads)
      : toCount(material.downloads, 0);
    return copy;
  }

  function getAllMaterials() {
    var stats = getStats();
    return getOriginalMaterials()
      .concat(getCustomMaterials())
      .map(function (material) {
        return applyStats(material, stats);
      });
  }

  function getMaterialById(id) {
    var target = String(id);
    var list = getAllMaterials();
    for (var i = 0; i < list.length; i += 1) {
      if (String(list[i].id) === target) return list[i];
    }
    return null;
  }

  function incrementStat(id, field, baseValue) {
    if (field !== 'views' && field !== 'downloads') {
      return null;
    }

    var stats = getStats();
    var key = String(id);
    var entry = stats[key] && typeof stats[key] === 'object' ? stats[key] : {};

    entry[field] = toCount(entry[field], baseValue) + 1;
    stats[key] = entry;
    saveStats(stats);
    return entry;
  }

  function clearCustomMaterials() {
    try {
      global.localStorage.removeItem(CUSTOM_KEY);
      return true;
    } catch (err) {
      return false;
    }
  }

  global.HongseFront = {
    CUSTOM_KEY: CUSTOM_KEY,
    STATS_KEY: STATS_KEY,
    getOriginalMaterials: getOriginalMaterials,
    getCustomMaterials: getCustomMaterials,
    saveCustomMaterials: saveCustomMaterials,
    addCustomMaterial: addCustomMaterial,
    nextCustomId: nextCustomId,
    getStats: getStats,
    saveStats: saveStats,
    getAllMaterials: getAllMaterials,
    getMaterialById: getMaterialById,
    incrementStat: incrementStat,
    clearCustomMaterials: clearCustomMaterials
  };
})(window);