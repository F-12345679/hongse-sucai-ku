/* ============================================
   前台公用数据与 localStorage 逻辑
   首页、详情页共用；不修改 js/data.js 原始数据
   ============================================ */
(function (global) {
  'use strict';

  var CUSTOM_KEY = 'hongse_custom_materials_v1';
  var STATS_KEY = 'hongse_material_stats_v1';
  var SEED_STATS_KEY = 'hongse_material_seed_stats_v3';
  var SEED_FINGERPRINT_KEY = 'hongse_material_seed_fingerprint_v1';
  var LEGACY_SEED_STATS_KEYS = ['hongse_material_seed_stats_v1', 'hongse_material_seed_stats_v2'];
  var OVERRIDES_KEY = 'hongse_material_overrides_v1';
  var ID_COUNTER_KEY = 'hongse_custom_id_counter_v1';
  /* 后台“修改素材”可覆盖的文本字段，逐字段按 id 覆盖 */
  var OVERRIDE_TEXT_FIELDS = ['title', 'author', 'authorRole', 'location', 'date', 'series', 'intro'];
  var SEED_VIEWS_MIN = 800;
  var SEED_VIEWS_MAX = 1199;
  var SEED_DOWNLOADS_MIN = 180;
  var SEED_DOWNLOADS_MAX = 439;

  function readJSON(key, fallback) {
    try {
      var raw = global.localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (err) {
      return fallback;
    }
  }

  function toCount(value, fallback) {
    var num = Number(value);
    return isFinite(num) && num >= 0 ? Math.floor(num) : (Number(fallback) || 0);
  }

  function randomInt(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
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

  function readIdCounter() {
    var value = Number(readJSON(ID_COUNTER_KEY, 0));
    return isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }

  function saveIdCounter(value) {
    try {
      global.localStorage.setItem(ID_COUNTER_KEY, String(value));
    } catch (err) {
      /* 计数器写入失败时不影响本次 id 返回 */
    }
  }

  function nextCustomId() {
    /* 已分配的最大 id 持久化保存：删掉最大 id 的素材后也不会回退复用 */
    var maxId = 999;
    var storedId = readIdCounter();
    if (storedId > maxId) maxId = storedId;

    getOriginalMaterials().concat(getCustomMaterials()).forEach(function (item) {
      var id = Number(item.id);
      if (isFinite(id) && id > maxId) maxId = id;
    });

    var nextId = Math.floor(maxId) + 1;
    saveIdCounter(nextId);
    return nextId;
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

  /* 演示基数按 data.js 版本指纹缓存；基数变化时自动重建并清理旧增量 */
  function getSeedStats() {
    var seeds = readJSON(SEED_STATS_KEY, {});
    if (!seeds || typeof seeds !== 'object' || Array.isArray(seeds)) return {};
    return seeds;
  }

  function saveSeedStats(seeds) {
    try {
      global.localStorage.setItem(SEED_STATS_KEY, JSON.stringify(seeds));
      return true;
    } catch (err) {
      return false;
    }
  }

  function removeStoredKey(key) {
    try {
      global.localStorage.removeItem(key);
    } catch (err) {
      /* 本地存储不可用时忽略 */
    }
  }

  function computeSeedFingerprint(originals) {
    var parts = [];
    (originals || []).forEach(function (material) {
      if (!material || material.id == null) return;
      parts.push(String(material.id) + ':' +
        toCount(material.views, 0) + ':' + toCount(material.downloads, 0));
    });
    return parts.join('|');
  }

  function saveSeedFingerprint(fingerprint) {
    try {
      global.localStorage.setItem(SEED_FINGERPRINT_KEY, JSON.stringify(fingerprint));
      return true;
    } catch (err) {
      return false;
    }
  }

  function clearNumericOverrides() {
    var map = getOverrides();
    var changed = false;

    Object.keys(map).forEach(function (key) {
      var entry = map[key];
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;

      ['views', 'downloads'].forEach(function (field) {
        if (!Object.prototype.hasOwnProperty.call(entry, field)) return;
        delete entry[field];
        changed = true;
      });

      if (!Object.keys(entry).length) {
        delete map[key];
        changed = true;
      }
    });

    if (changed) saveOverrides(map);
  }

  function resetSeedCache() {
    removeStoredKey(SEED_STATS_KEY);
    LEGACY_SEED_STATS_KEYS.forEach(removeStoredKey);
    removeStoredKey(STATS_KEY);
    clearNumericOverrides();
  }

  /* ---------- 按 id 覆盖层（后台修改素材） ----------
     纯静态站点没有后端，修改结果写成一层按 id 覆盖的本地存储；
     首页、详情页、后台都经由 getAllMaterials 读取，保证三处同源。 */
  function getOverrides() {
    var map = readJSON(OVERRIDES_KEY, {});
    if (!map || typeof map !== 'object' || Array.isArray(map)) return {};
    return map;
  }

  function saveOverrides(map) {
    try {
      global.localStorage.setItem(OVERRIDES_KEY, JSON.stringify(map));
      return true;
    } catch (err) {
      return false;
    }
  }

  function normalizeTagList(tags) {
    var list = Array.isArray(tags) ? tags : String(tags == null ? '' : tags).split(/[,，]/);
    var result = [];
    list.forEach(function (tag) {
      var text = String(tag == null ? '' : tag).trim();
      if (text && result.indexOf(text) === -1) result.push(text);
    });
    return result;
  }

  function saveMaterialOverride(id, fields) {
    var key = String(id);
    var map = getOverrides();
    var current = map[key] && typeof map[key] === 'object' && !Array.isArray(map[key]) ? map[key] : {};
    var next = {};

    Object.keys(current).forEach(function (field) {
      next[field] = current[field];
    });

    OVERRIDE_TEXT_FIELDS.forEach(function (field) {
      if (!fields || !Object.prototype.hasOwnProperty.call(fields, field)) return;
      next[field] = String(fields[field] == null ? '' : fields[field]).trim();
    });
    if (fields && Object.prototype.hasOwnProperty.call(fields, 'tags')) {
      next.tags = normalizeTagList(fields.tags);
    }
    ['views', 'downloads'].forEach(function (field) {
      if (!fields || !Object.prototype.hasOwnProperty.call(fields, field)) return;
      next[field] = toCount(fields[field], 0);
    });

    map[key] = next;
    if (!saveOverrides(map)) return false;

    /* 覆盖值是绝对值，清掉该素材此前的浏览/下载增量，避免与覆盖值叠加 */
    var stats = getStats();
    if (Object.prototype.hasOwnProperty.call(stats, key)) {
      delete stats[key];
      saveStats(stats);
    }
    return true;
  }

  function clearMaterialOverride(id) {
    var key = String(id);
    var map = getOverrides();
    if (!Object.prototype.hasOwnProperty.call(map, key)) return true;
    delete map[key];
    return saveOverrides(map);
  }

  function ensureSeedStats(originals) {
    var fingerprint = computeSeedFingerprint(originals);
    if (readJSON(SEED_FINGERPRINT_KEY, '') !== fingerprint) {
      resetSeedCache();
      saveSeedFingerprint(fingerprint);
    }

    var seeds = getSeedStats();
    var changed = false;

    (originals || []).forEach(function (material) {
      if (!material || material.id == null) return;
      var key = String(material.id);
      var entry = seeds[key];

      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        var normalizedViews = toCount(entry.views, 0);
        var normalizedDownloads = toCount(entry.downloads, 0);
        if (normalizedDownloads > normalizedViews) normalizedDownloads = normalizedViews;
        if (entry.views !== normalizedViews || entry.downloads !== normalizedDownloads) {
          seeds[key] = { views: normalizedViews, downloads: normalizedDownloads };
          changed = true;
        }
        return;
      }

      var views = randomInt(SEED_VIEWS_MIN, SEED_VIEWS_MAX);
      var downloads = randomInt(SEED_DOWNLOADS_MIN, SEED_DOWNLOADS_MAX);

      /* 数据源已给定浏览/下载基数时以数据源为准，保证列表页与详情页展示一致 */
      var baseViews = Number(material.views);
      var baseDownloads = Number(material.downloads);
      if (isFinite(baseViews) && baseViews >= 0) {
        views = Math.floor(baseViews);
        downloads = isFinite(baseDownloads) && baseDownloads >= 0
          ? Math.floor(baseDownloads)
          : 0;
      }

      if (downloads > views) downloads = views;
      seeds[key] = { views: views, downloads: downloads };
      changed = true;
    });

    if (changed) saveSeedStats(seeds);
    return seeds;
  }

  function applyStats(material, stats, seeds, overrides) {
    var copy = cloneMaterial(material);
    var key = String(material.id);
    var entry = stats[key] && typeof stats[key] === 'object' ? stats[key] : {};
    var seed = seeds[key] && typeof seeds[key] === 'object' ? seeds[key] : {};
    var override = overrides && overrides[key] && typeof overrides[key] === 'object' &&
      !Array.isArray(overrides[key]) ? overrides[key] : null;

    if (override) {
      OVERRIDE_TEXT_FIELDS.forEach(function (field) {
        if (Object.prototype.hasOwnProperty.call(override, field)) {
          copy[field] = String(override[field] == null ? '' : override[field]);
        }
      });
      if (Array.isArray(override.tags)) copy.tags = override.tags.slice();
    }

    var baseViews = override && override.views != null ? toCount(override.views, 0) : toCount(seed.views, 0);
    var baseDownloads = override && override.downloads != null
      ? toCount(override.downloads, 0)
      : toCount(seed.downloads, 0);

    copy.views = baseViews + toCount(entry.views, 0);
    copy.downloads = baseDownloads + toCount(entry.downloads, 0);
    return copy;
  }

  function getAllMaterials() {
    var originals = getOriginalMaterials();
    var seeds = ensureSeedStats(originals);
    var stats = getStats();
    var overrides = getOverrides();
    return originals
      .concat(getCustomMaterials())
      .map(function (material) {
        return applyStats(material, stats, seeds, overrides);
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

  function incrementStat(id, field) {
    if (field !== 'views' && field !== 'downloads') {
      return null;
    }

    var stats = getStats();
    var key = String(id);
    var entry = stats[key] && typeof stats[key] === 'object' ? stats[key] : {};

    entry[field] = toCount(entry[field], 0) + 1;
    stats[key] = entry;
    saveStats(stats);

    var material = getMaterialById(id);
    return {
      views: material ? material.views : 0,
      downloads: material ? material.downloads : 0,
      increment: entry[field]
    };
  }

  /* 删除投稿时同步清理运行时增量与演示基数记录 */
  function clearMaterialStats(id) {
    var key = String(id);
    var stats = getStats();
    if (Object.prototype.hasOwnProperty.call(stats, key)) {
      delete stats[key];
      saveStats(stats);
    }

    var seeds = getSeedStats();
    if (Object.prototype.hasOwnProperty.call(seeds, key)) {
      delete seeds[key];
      saveSeedStats(seeds);
    }
  }

  function getHeatScore(material) {
    return toCount(material && material.views, 0) + toCount(material && material.downloads, 0) * 2;
  }

  function clearCustomMaterials() {
    try {
      global.localStorage.removeItem(CUSTOM_KEY);
      return true;
    } catch (err) {
      return false;
    }
  }

  /* ---------- 素材下载与 Word 生成（前台、后台共用） ---------- */
  var ATTACH_DB_NAME = 'hongse_admin_attachments_v1';
  var ATTACH_STORE_NAME = 'files';
  var attachDbPromise = null;

  function openAttachmentDb() {
    if (attachDbPromise) return attachDbPromise;

    attachDbPromise = new Promise(function (resolve, reject) {
      if (!global.indexedDB) {
        reject(new Error('当前浏览器不支持本地附件库'));
        return;
      }

      var request = global.indexedDB.open(ATTACH_DB_NAME, 1);
      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains(ATTACH_STORE_NAME)) {
          db.createObjectStore(ATTACH_STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = function () {
        resolve(request.result);
      };
      request.onerror = function () {
        attachDbPromise = null;
        reject(request.error || new Error('附件库打开失败'));
      };
    });

    return attachDbPromise;
  }

  function getAttachmentRecord(id) {
    return openAttachmentDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(ATTACH_STORE_NAME, 'readonly');
        var request = tx.objectStore(ATTACH_STORE_NAME).get(String(id));
        request.onsuccess = function () { resolve(request.result || null); };
        request.onerror = function () { reject(request.error || new Error('附件读取失败')); };
      });
    });
  }

  function materialRef(material, field) {
    var ref = material ? material[field + 'Ref'] : null;
    return ref && typeof ref === 'object' && ref.id ? ref : null;
  }

  function docTypeList(material) {
    return material && Array.isArray(material.type) ? material.type : [];
  }

  function docEscape(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var result = typeof reader.result === 'string' ? reader.result : '';
        if (result) {
          resolve(result);
        } else {
          reject(new Error('配图数据为空'));
        }
      };
      reader.onerror = function () {
        reject(reader.error || new Error('配图读取失败'));
      };
      reader.readAsDataURL(blob);
    });
  }

  function fetchAsDataUrl(source) {
    return new Promise(function (resolve, reject) {
      var settled = false;

      function finish(handler, value) {
        if (settled) return;
        settled = true;
        handler(value);
      }

      function viaXhr(reason) {
        var xhr = new XMLHttpRequest();
        try {
          xhr.open('GET', source, true);
        } catch (err) {
          finish(reject, err);
          return;
        }
        xhr.responseType = 'blob';
        xhr.onload = function () {
          if ((xhr.status === 200 || xhr.status === 0) && xhr.response) {
            blobToDataUrl(xhr.response).then(function (url) {
              finish(resolve, url);
            }, function () {
              finish(reject, reason);
            });
          } else {
            finish(reject, reason);
          }
        };
        xhr.onerror = function () {
          finish(reject, reason);
        };
        xhr.send();
      }

      if (typeof global.fetch === 'function') {
        global.fetch(source).then(function (response) {
          if (!response.ok) throw new Error('读取配图失败：HTTP ' + response.status);
          return response.blob();
        }).then(function (blob) {
          return blobToDataUrl(blob);
        }).then(function (url) {
          finish(resolve, url);
        }).catch(function (err) {
          viaXhr(err);
        });
      } else {
        viaXhr(new Error('浏览器不支持 fetch'));
      }
    });
  }

  function resolveMaterialCover(material) {
    var cover = material && material.cover;
    var source = typeof cover === 'string' ? cover.trim() : '';

    if (!source) {
      return Promise.resolve({ dataUrl: '', failed: false, reason: '' });
    }
    if (source.indexOf('data:') === 0) {
      return Promise.resolve({ dataUrl: source, failed: false, reason: '' });
    }

    var ref = materialRef(material, 'cover');
    var task = ref && ref.id
      ? getAttachmentRecord(ref.id).then(function (record) {
        if (!record || !record.blob) throw new Error('附件库中没有配图原图');
        return blobToDataUrl(record.blob);
      }).catch(function () {
        return fetchAsDataUrl(source);
      })
      : fetchAsDataUrl(source);

    return task.then(function (dataUrl) {
      if (!dataUrl) throw new Error('配图数据为空');
      return { dataUrl: dataUrl, failed: false, reason: '' };
    }).catch(function (err) {
      return {
        dataUrl: '',
        failed: true,
        reason: err && err.message ? err.message : '未知原因'
      };
    });
  }

  function docDateKey(material) {
    var fields = ['date', 'publishDate', 'publishTime', 'createdAt', 'createDate'];
    for (var i = 0; i < fields.length; i += 1) {
      var raw = material ? material[fields[i]] : '';
      var text = raw == null ? '' : String(raw).trim();
      if (!text) continue;
      var matched = text.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
      if (matched) {
        var month = Number(matched[2]);
        var day = Number(matched[3]);
        return matched[1] + '-' + (month < 10 ? '0' + month : month) + '-' + (day < 10 ? '0' + day : day);
      }
    }
    return '';
  }

  function formatDocDate(material) {
    var key = docDateKey(material);
    if (!key) return '';
    var parts = key.split('-');
    if (parts.length !== 3) return '';
    return parts[0] + ' 年 ' + Number(parts[1]) + ' 月 ' + Number(parts[2]) + ' 日';
  }

  function docAuthorLine(material) {
    var author = String(material.author || '').trim();
    if (!author) return '';

    var extra = [];
    var role = String(material.authorRole || '').trim();
    var location = String(material.location || '').trim();
    if (role) extra.push(role);
    if (location) extra.push(location);

    if (!extra.length) return '供稿人：' + author;
    return '供稿人：' + author + '（' + extra.join('，') + '）';
  }

  function docParagraphs(material) {
    var intro = String(material.intro || '').replace(/\r\n/g, '\n').trim();
    var paragraphs = intro
      ? intro.split(/\n\s*\n|\n/).map(function (text) {
        return text.trim();
      }).filter(function (text) {
        return text.length > 0;
      })
      : [];

    if (paragraphs.length) return paragraphs;

    var fallback = [];
    var series = String(material.series || '').trim();
    var location = String(material.location || '').trim();
    var tags = Array.isArray(material.tags)
      ? material.tags.filter(function (tag) { return String(tag).trim(); }).join('、')
      : '';
    var types = docTypeList(material).join('、');

    if (series) fallback.push('所属系列：' + series + '。');
    if (location) fallback.push('素材地点：' + location + '。');
    if (tags) fallback.push('相关标签：' + tags + '。');
    if (!fallback.length && types) fallback.push('素材类型：' + types + '。');
    if (!fallback.length) {
      fallback.push('该素材暂无详细简介，更多内容请前往红色文化数字基因库查看。');
    }
    return fallback;
  }

  function buildMaterialDocFileName(material) {
    var base = String((material && material.title) || '素材文档')
      .replace(/[\\/:*?"<>|\r\n]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || '素材文档';

    if (/\.doc$/i.test(base)) return base;
    return base + '.doc';
  }

  /* 与后台共用：标题、供稿人、正文、右对齐日期、居中配图 */
  function buildMaterialDocHtml(material, cover, imageSrc, imageSize) {
    var title = docEscape(material.title || '未命名素材');
    var authorLine = docAuthorLine(material);
    var paragraphs = docParagraphs(material).map(function (text) {
      return '<p class="doc-body">' + docEscape(text) + '</p>';
    }).join('');

    var dateText = formatDocDate(material);
    var dateHtml = dateText ? '<p class="doc-date">' + docEscape(dateText) + '</p>' : '';

    var coverHtml = '';
    if (imageSrc) {
      var heightAttr = '';
      if (imageSize && imageSize.width > 0 && imageSize.height > 0) {
        heightAttr = String(Math.max(1, Math.round(600 * imageSize.height / imageSize.width)));
      }
      coverHtml = '<p class="doc-cover" align="center"><img src="' + docEscape(imageSrc) +
        '" width="600"' + (heightAttr ? ' height="' + heightAttr + '"' : '') +
        ' alt="' + title + '" style="width:600px;' +
        (heightAttr ? 'height:' + heightAttr + 'px;' : 'height:auto;') + 'max-width:100%;"></p>';
    } else if (cover && cover.failed) {
      coverHtml = '<p class="doc-cover-failed" align="center">配图加载失败</p>';
    }

    return '<!DOCTYPE html>'
      + '<html xmlns:o="urn:schemas-microsoft-com:office:office" '
      + 'xmlns:w="urn:schemas-microsoft-com:office:word" '
      + 'xmlns="http://www.w3.org/TR/REC-html40">'
      + '<head><meta http-equiv="Content-Type" content="text/html; charset=utf-8">'
      + '<meta name="ProgId" content="Word.Document">'
      + '<title>' + title + '</title>'
      + '<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View>'
      + '<w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->'
      + '<style>'
      + '@page WordSection1 { size: 595.3pt 841.9pt; margin: 72pt 72pt 72pt 72pt; }'
      + 'div.WordSection1 { page: WordSection1; }'
      + 'body { font-family: "宋体", SimSun, serif; font-size: 12pt; color: #000000; }'
      + 'h1.doc-title { margin: 0 0 14pt; font-family: "黑体", SimHei, sans-serif;'
      + ' font-size: 22pt; font-weight: bold; line-height: 1.4; text-align: center; }'
      + 'p.doc-author { margin: 0 0 20pt; font-size: 12pt; text-align: center; }'
      + 'p.doc-body { margin: 0 0 12pt; font-size: 12pt; line-height: 1.8; text-indent: 2em; }'
      + 'p.doc-date { margin: 18pt 0 20pt; font-size: 12pt; text-align: right; }'
      + 'p.doc-cover { margin: 0; text-align: center; }'
      + 'p.doc-cover-failed { margin: 0; font-size: 12pt; color: #b3131b; text-align: center; }'
      + '</style></head>'
      + '<body><div class="WordSection1">'
      + '<h1 class="doc-title">' + title + '</h1>'
      + (authorLine ? '<p class="doc-author">' + docEscape(authorLine) + '</p>' : '')
      + paragraphs
      + dateHtml
      + coverHtml
      + '</div></body></html>';
  }

  function hasDocSource(material) {
    return !!materialRef(material, 'doc') ||
      (typeof material.doc === 'string' && material.doc.trim().length > 0);
  }

  function hasAudioLike(material) {
    return docTypeList(material).indexOf('音频') >= 0 ||
      !!materialRef(material, 'audio') ||
      !!materialRef(material, 'voice') ||
      (typeof material.audio === 'string' && material.audio.trim().length > 0) ||
      (typeof material.voice === 'string' && material.voice.trim().length > 0);
  }

  /* 有文档可下原件；纯音频/纯配音不提供下载；其余生成 Word */
  function canDownloadMaterial(material) {
    if (!material) return false;
    if (hasDocSource(material)) return true;
    return !hasAudioLike(material);
  }

  function triggerDocDownload(url, fileName) {
    var link = document.createElement('a');
    link.href = url;
    link.download = fileName || '';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    global.setTimeout(function () {
      document.body.removeChild(link);
    }, 0);
  }

  function utf8ToBase64(text) {
    var bytes;
    if (typeof global.TextEncoder === 'function') {
      bytes = new global.TextEncoder().encode(text);
    } else {
      var encoded = unescape(encodeURIComponent(text));
      bytes = [];
      for (var i = 0; i < encoded.length; i += 1) bytes.push(encoded.charCodeAt(i));
    }

    var binary = '';
    for (var j = 0; j < bytes.length; j += 1) {
      binary += String.fromCharCode(bytes[j]);
    }
    return global.btoa(binary);
  }

  function wrapBase64(base64) {
    return String(base64 || '').replace(/\s+/g, '').replace(/(.{76})/g, '$1\r\n').replace(/\r\n$/, '');
  }

  function dataUrlToPart(dataUrl) {
    var text = String(dataUrl || '');
    var comma = text.indexOf(',');
    if (text.indexOf('data:') !== 0 || comma < 0) return null;

    var meta = text.slice(5, comma);
    var payload = text.slice(comma + 1);
    var isBase64 = /;base64/i.test(meta);
    var mime = meta.split(';')[0] || 'image/png';

    if (!isBase64) {
      payload = utf8ToBase64(decodeURIComponent(payload));
    }
    return { mime: mime, base64: wrapBase64(payload) };
  }

  var IMAGE_EXT = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/gif': 'gif',
    'image/bmp': 'bmp',
    'image/webp': 'webp',
    'image/svg+xml': 'svg'
  };

  function measureImage(dataUrl) {
    return new Promise(function (resolve) {
      if (!dataUrl) { resolve(null); return; }
      var img = new Image();
      img.onload = function () {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      };
      img.onerror = function () { resolve(null); };
      img.src = dataUrl;
    });
  }

  /* Word 对 HTML 里的 data: 图片支持很差，改用 MHTML 多部件内嵌图片 */
  function buildMaterialMhtml(material, cover, imageSize) {
    var part = dataUrlToPart(cover && cover.dataUrl);
    var imageName = part ? 'cover_image.' + (IMAGE_EXT[part.mime] || 'png') : '';
    var html = buildMaterialDocHtml(material, cover, part ? imageName : '', imageSize);

    var boundary = '----=_NextPart_RedGene_0001';
    var htmlLocation = 'file:///C:/redgene/material.htm';
    var imageLocation = 'file:///C:/redgene/' + imageName;
    var lines = [];

    lines.push('MIME-Version: 1.0');
    lines.push('Content-Type: multipart/related; type="text/html"; boundary="' + boundary + '"');
    lines.push('');

    lines.push('--' + boundary);
    lines.push('Content-Type: text/html; charset="utf-8"');
    lines.push('Content-Transfer-Encoding: base64');
    lines.push('Content-Location: ' + htmlLocation);
    lines.push('');
    lines.push(wrapBase64(utf8ToBase64(html)));
    lines.push('');

    if (part) {
      lines.push('--' + boundary);
      lines.push('Content-Type: ' + part.mime);
      lines.push('Content-Transfer-Encoding: base64');
      lines.push('Content-Location: ' + imageLocation);
      lines.push('');
      lines.push(part.base64);
      lines.push('');
    }

    lines.push('--' + boundary + '--');
    lines.push('');
    return lines.join('\r\n');
  }

  function buildMaterialDocBlob(material) {
    return resolveMaterialCover(material).then(function (cover) {
      return measureImage(cover.dataUrl).then(function (imageSize) {
        var mhtml = buildMaterialMhtml(material, cover, imageSize);
        return {
          blob: new Blob([mhtml], { type: 'application/msword' }),
          failedCover: !!cover.failed,
          reason: cover.reason || '',
          fileName: buildMaterialDocFileName(material)
        };
      });
    });
  }

  function generateMaterialDoc(material) {
    return buildMaterialDocBlob(material).then(function (result) {
      var objectUrl = URL.createObjectURL(result.blob);
      triggerDocDownload(objectUrl, result.fileName);
      global.setTimeout(function () {
        URL.revokeObjectURL(objectUrl);
      }, 1500);
      return { downloaded: true, failedCover: result.failedCover, reason: result.reason };
    });
  }

  function downloadMaterial(material) {
    if (!canDownloadMaterial(material)) {
      return Promise.resolve({ downloaded: false, reason: 'blocked' });
    }

    var docUrl = typeof material.doc === 'string' ? material.doc.trim() : '';
    if (docUrl) {
      global.location.href = docUrl;
      return Promise.resolve({ downloaded: true, reason: 'original' });
    }

    var docRef = materialRef(material, 'doc');
    if (docRef) {
      return getAttachmentRecord(docRef.id).then(function (record) {
        if (!record || !record.blob) throw new Error('附件不存在');
        var objectUrl = URL.createObjectURL(record.blob);
        triggerDocDownload(objectUrl, docRef.name || record.name || '素材文档');
        global.setTimeout(function () {
          URL.revokeObjectURL(objectUrl);
        }, 1500);
        return { downloaded: true, reason: 'attachment' };
      }).catch(function (err) {
        return { downloaded: false, reason: err && err.message ? err.message : 'attachment' };
      });
    }

    return generateMaterialDoc(material).catch(function (err) {
      return { downloaded: false, reason: err && err.message ? err.message : 'doc' };
    });
  }

  global.HongseFront = {
    CUSTOM_KEY: CUSTOM_KEY,
    STATS_KEY: STATS_KEY,
    SEED_STATS_KEY: SEED_STATS_KEY,
    OVERRIDES_KEY: OVERRIDES_KEY,
    getOriginalMaterials: getOriginalMaterials,
    getCustomMaterials: getCustomMaterials,
    saveCustomMaterials: saveCustomMaterials,
    addCustomMaterial: addCustomMaterial,
    nextCustomId: nextCustomId,
    getStats: getStats,
    saveStats: saveStats,
    getSeedStats: getSeedStats,
    getOverrides: getOverrides,
    saveMaterialOverride: saveMaterialOverride,
    clearMaterialOverride: clearMaterialOverride,
    getAllMaterials: getAllMaterials,
    getMaterialById: getMaterialById,
    incrementStat: incrementStat,
    clearMaterialStats: clearMaterialStats,
    getHeatScore: getHeatScore,
    clearCustomMaterials: clearCustomMaterials,
    resolveMaterialCover: resolveMaterialCover,
    buildMaterialDocHtml: buildMaterialDocHtml,
    buildMaterialDocFileName: buildMaterialDocFileName,
    buildMaterialDocBlob: buildMaterialDocBlob,
    canDownloadMaterial: canDownloadMaterial,
    downloadMaterial: downloadMaterial,
    generateMaterialDoc: generateMaterialDoc,
    getAttachmentRecord: getAttachmentRecord
  };

})(window);