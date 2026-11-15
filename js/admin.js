/* ============================================
   红色文化数字基因库 · 后台共用脚本
   数据看板 admin.html / 素材管理 admin-materials.html
   纯原生 JS，数据统一走 window.HongseFront
   ============================================ */
(function () {
  'use strict';

  var TYPE_META = [
    { name: '文档', chip: 'type-doc', dot: 'dot-doc', seg: 'donut-doc' },
    { name: '音频', chip: 'type-audio', dot: 'dot-audio', seg: 'donut-audio' },
    { name: '配图', chip: 'type-image', dot: 'dot-image', seg: 'donut-image' }
  ];
  var TROPHY_SVG = '<svg class="trophy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 4h8v5a4 4 0 0 1-8 0V4Z"/><path d="M8 6H5v1a3 3 0 0 0 3 3M16 6h3v1a3 3 0 0 1-3 3M12 13v4M9 20h6M10 20v-3h4v3"/></svg>';
  var ADMIN_STATE_KEY = 'hongse_admin_material_state_v1';

  function byId(id) {
    return document.getElementById(id);
  }

  function setText(id, text) {
    var node = byId(id);
    if (node) node.textContent = String(text);
  }

  function toCount(value) {
    var number = Number(value);
    return isFinite(number) ? number : 0;
  }

  function typeList(material) {
    return material && Array.isArray(material.type) ? material.type : [];
  }

  function typeText(material) {
    var types = typeList(material);
    return types.length ? types.join(' · ') : '—';
  }

  function chipClass(type) {
    var meta = null;
    TYPE_META.forEach(function (item) {
      if (item.name === type) meta = item;
    });
    return meta ? meta.chip : '';
  }

  function hasCover(material) {
    var cover = material ? material.cover : '';
    return typeof cover === 'string' ? cover.trim().length > 0 : !!cover;
  }

  function heatOf(material) {
    return toCount(material && material.views) * 0.6 + toCount(material && material.downloads) * 0.4;
  }

  function formatHeat(value) {
    return String(Math.round(value * 10) / 10);
  }

  function pad2(value) {
    var text = String(value);
    return text.length < 2 ? '0' + text : text;
  }

  function todayString() {
    var now = new Date();
    return now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate());
  }

  function normalizeDateValue(value) {
    var text = value == null ? '' : String(value).trim();
    if (!text) return '';

    var matched = text.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
    if (matched) {
      return matched[1] + '-' + pad2(matched[2]) + '-' + pad2(matched[3]);
    }

    var parsed = new Date(text);
    if (!isNaN(parsed.getTime())) {
      return parsed.getFullYear() + '-' + pad2(parsed.getMonth() + 1) + '-' + pad2(parsed.getDate());
    }
    return '';
  }

  function materialDateKey(material) {
    if (!material) return '';

    var fields = ['date', 'publishDate', 'publishTime', 'createdAt', 'createDate'];
    for (var i = 0; i < fields.length; i += 1) {
      var key = normalizeDateValue(material[fields[i]]);
      if (key) return key;
    }
    return '';
  }

  function getTodayCustomCount() {
    try {
      var api = window.HongseFront;
      if (!api || typeof api.getCustomMaterials !== 'function') return 0;

      var list = api.getCustomMaterials();
      if (!Array.isArray(list)) return 0;

      var todayKey = todayString();
      return list.filter(function (material) {
        return materialDateKey(material) === todayKey;
      }).length;
    } catch (err) {
      return 0;
    }
  }

  function getMaterials() {
    try {
      var api = window.HongseFront;
      if (!api || typeof api.getAllMaterials !== 'function') return [];
      var list = api.getAllMaterials();
      if (!Array.isArray(list)) return [];
      return list.filter(function (item) {
        return item && item.id != null;
      });
    } catch (err) {
      return [];
    }
  }

  function getCustomStorageKey() {
    var api = window.HongseFront;
    return api && api.CUSTOM_KEY ? api.CUSTOM_KEY : 'hongse_custom_materials_v1';
  }

  function readCustomStore() {
    try {
      var raw = window.localStorage.getItem(getCustomStorageKey());
      if (!raw) return [];
      var list = JSON.parse(raw);
      return Array.isArray(list) ? list : [];
    } catch (err) {
      return [];
    }
  }

  function writeCustomStore(list) {
    try {
      window.localStorage.setItem(getCustomStorageKey(), JSON.stringify(list));
      return true;
    } catch (err) {
      return false;
    }
  }

  function getStatsStorageKey() {
    var api = window.HongseFront;
    return api && api.STATS_KEY ? api.STATS_KEY : 'hongse_material_stats_v1';
  }

  /* 删除素材时同步清掉 hongse_material_stats_v1 中该 id 的浏览/下载计数，
     避免 id 被后续新素材复用时继承已删素材的数据 */
  function clearMaterialStats(id) {
    var key = String(id);
    try {
      var raw = window.localStorage.getItem(getStatsStorageKey());
      if (!raw) return;
      var stats = JSON.parse(raw);
      if (!stats || typeof stats !== 'object' || Array.isArray(stats)) return;
      if (!Object.prototype.hasOwnProperty.call(stats, key)) return;
      delete stats[key];
      window.localStorage.setItem(getStatsStorageKey(), JSON.stringify(stats));
    } catch (err) {
      /* 统计清理失败不影响删除结果 */
    }
  }

  /* ---------- 附件库（IndexedDB） ----------
     localStorage 只存素材元数据与附件引用，较大的音频/文档/原图放这里 */
  var ATTACH_DB_NAME = 'hongse_admin_attachments_v1';
  var ATTACH_STORE_NAME = 'files';
  var ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
  var ATTACHMENT_MAX_LABEL = '20MB';
  var COVER_DATA_MAX_LENGTH = 2 * 1024 * 1024;
  var attachDbPromise = null;

  function openAttachmentDb() {
    if (attachDbPromise) return attachDbPromise;

    attachDbPromise = new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error('当前浏览器不支持本地附件库'));
        return;
      }

      var request = window.indexedDB.open(ATTACH_DB_NAME, 1);
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

  function putAttachment(record) {
    return openAttachmentDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(ATTACH_STORE_NAME, 'readwrite');
        tx.objectStore(ATTACH_STORE_NAME).put(record);
        tx.oncomplete = function () { resolve(record); };
        tx.onerror = function () { reject(tx.error || new Error('附件写入失败')); };
        tx.onabort = function () { reject(tx.error || new Error('附件写入失败')); };
      });
    });
  }

  function getAttachment(id) {
    return openAttachmentDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(ATTACH_STORE_NAME, 'readonly');
        var request = tx.objectStore(ATTACH_STORE_NAME).get(String(id));
        request.onsuccess = function () { resolve(request.result || null); };
        request.onerror = function () { reject(request.error || new Error('附件读取失败')); };
      });
    });
  }

  function deleteAttachment(id) {
    if (!id) return;

    openAttachmentDb().then(function (db) {
      var tx = db.transaction(ATTACH_STORE_NAME, 'readwrite');
      tx.objectStore(ATTACH_STORE_NAME).delete(String(id));
    }).catch(function () {
      /* 附件清理失败不影响主流程 */
    });
  }

  function createAttachmentId() {
    return 'att-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function saveAttachmentFile(file) {
    var record = {
      id: createAttachmentId(),
      name: file.name || '素材附件',
      mime: file.type || '',
      size: file.size || 0,
      blob: file,
      createdAt: Date.now()
    };

    return putAttachment(record).then(function () {
      return { id: record.id, name: record.name, mime: record.mime, size: record.size };
    });
  }

  function formatFileSize(bytes) {
    var size = toCount(bytes);
    if (size >= 1024 * 1024) return (Math.round(size / 1024 / 1024 * 10) / 10) + 'MB';
    if (size >= 1024) return Math.round(size / 1024) + 'KB';
    return size + 'B';
  }

  function fileExtensionOf(name) {
    var text = String(name || '');
    var dot = text.lastIndexOf('.');
    return dot >= 0 ? text.slice(dot + 1).toLowerCase() : '';
  }

  function checkAttachmentFile(file, label, kind) {
    if (!file) return '';

    if (file.size > ATTACHMENT_MAX_BYTES) {
      return label + '「' + file.name + '」大小 ' + formatFileSize(file.size) +
        '，超过单文件 ' + ATTACHMENT_MAX_LABEL + ' 上限，请压缩后重新上传。';
    }

    if (kind === 'audio') {
      var audioExt = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'webm'];
      var looksAudio = (file.type && file.type.indexOf('audio/') === 0) ||
        audioExt.indexOf(fileExtensionOf(file.name)) >= 0;
      if (!looksAudio) {
        return '请选择音频文件（如 MP3、WAV）。';
      }
    }

    if (kind === 'doc') {
      var docExt = ['doc', 'docx', 'pdf', 'txt', 'md', 'ppt', 'pptx', 'xls', 'xlsx'];
      if (docExt.indexOf(fileExtensionOf(file.name)) < 0) {
        return '请选择文档文件（如 DOC、DOCX、PDF、TXT）。';
      }
    }

    if (kind === 'image') {
      var imageExt = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'];
      var looksImage = (file.type && file.type.indexOf('image/') === 0) ||
        imageExt.indexOf(fileExtensionOf(file.name)) >= 0;
      if (!looksImage) {
        return '请选择图片文件（如 JPG、PNG）。';
      }
    }

    return '';
  }

  /* 配图压缩为列表封面，原图另外存入附件库供下载 */
  function compressCoverImage(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();

      reader.onload = function () {
        var dataUrl = reader.result;
        if (typeof dataUrl !== 'string' || !dataUrl) {
          reject(new Error('配图读取失败'));
          return;
        }

        var image = new Image();
        image.onload = function () {
          try {
            var maxSide = 1280;
            var width = image.naturalWidth || image.width;
            var height = image.naturalHeight || image.height;
            var scale = Math.min(1, maxSide / Math.max(width, height));
            var canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(width * scale));
            canvas.height = Math.max(1, Math.round(height * scale));

            var ctx = canvas.getContext('2d');
            if (!ctx) {
              resolve(dataUrl.length <= COVER_DATA_MAX_LENGTH ? dataUrl : '');
              return;
            }

            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

            var compressed = canvas.toDataURL('image/jpeg', 0.82);
            if (compressed && compressed.length < dataUrl.length) {
              resolve(compressed);
            } else {
              resolve(dataUrl.length <= COVER_DATA_MAX_LENGTH ? dataUrl : (compressed || ''));
            }
          } catch (err) {
            reject(new Error('配图处理失败'));
          }
        };
        image.onerror = function () { reject(new Error('配图解析失败')); };
        image.src = dataUrl;
      };
      reader.onerror = function () { reject(new Error('配图读取失败')); };
      reader.readAsDataURL(file);
    });
  }

  function readAdminState() {
    try {
      var raw = window.localStorage.getItem(ADMIN_STATE_KEY);
      var parsed = raw ? JSON.parse(raw) : {};
      var overrides = parsed && parsed.overrides;
      var deleted = parsed && parsed.deleted;

      return {
        overrides: overrides && typeof overrides === 'object' && !Array.isArray(overrides) ? overrides : {},
        deleted: deleted && typeof deleted === 'object' && !Array.isArray(deleted) ? deleted : {}
      };
    } catch (err) {
      return { overrides: {}, deleted: {} };
    }
  }

  function writeAdminState(state) {
    try {
      window.localStorage.setItem(ADMIN_STATE_KEY, JSON.stringify(state));
      return true;
    } catch (err) {
      return false;
    }
  }

  function getAdminMaterials() {
    var base = getMaterials();
    var state = readAdminState();

    return base.filter(function (material) {
      return !state.deleted[String(material.id)];
    }).map(function (material) {
      var override = state.overrides[String(material.id)];
      if (!override || typeof override !== 'object') return material;

      var merged = {};
      Object.keys(material).forEach(function (key) {
        merged[key] = material[key];
      });
      Object.keys(override).forEach(function (key) {
        merged[key] = override[key];
      });

      merged.id = material.id;
      merged.views = material.views;
      merged.downloads = material.downloads;
      return merged;
    });
  }

  function getAdminMaterialById(id) {
    var target = String(id);
    var list = getAdminMaterials();
    for (var i = 0; i < list.length; i += 1) {
      if (String(list[i].id) === target) return list[i];
    }
    return null;
  }

  function isOriginalMaterialId(id) {
    try {
      var api = window.HongseFront;
      if (!api || typeof api.getOriginalMaterials !== 'function') return false;

      var originals = api.getOriginalMaterials();
      if (!Array.isArray(originals)) return false;

      var target = String(id);
      return originals.some(function (item) {
        return item && String(item.id) === target;
      });
    } catch (err) {
      return false;
    }
  }

  function stripStats(material) {
    var copy = {};
    if (!material) return copy;

    Object.keys(material).forEach(function (key) {
      copy[key] = material[key];
    });
    delete copy.views;
    delete copy.downloads;
    return copy;
  }

  function appendEmptyRow(tbody, colspan, message) {
    var tr = document.createElement('tr');
    tr.className = 'empty-row';
    var td = document.createElement('td');
    td.colSpan = colspan;
    td.textContent = message;
    tr.appendChild(td);
    tbody.appendChild(tr);
  }

  /* ---------- 数据看板 ---------- */
  function initDashboard() {
    var materials = getAdminMaterials();
    renderDashboardStats(materials);
    renderHotTable(materials);
    renderTypeChart(materials);
  }

  function renderDashboardStats(materials) {
    var views = 0;
    var downloads = 0;
    var missingCover = 0;
    var todayCount = 0;
    var todayKey = todayString();

    materials.forEach(function (material) {
      views += toCount(material.views);
      downloads += toCount(material.downloads);
      if (!hasCover(material)) missingCover += 1;
      if (materialDateKey(material) === todayKey) todayCount += 1;
    });

    var sorted = materials.slice().sort(function (a, b) {
      return heatOf(b) - heatOf(a);
    });
    var champion = sorted.length ? (sorted[0].title || '未命名素材') : '暂无数据';

    setText('stat-total', materials.length);
    setText('stat-pending', 0);
    setText('stat-stored', materials.length);
    setText('stat-views', views);
    setText('stat-downloads', downloads);
    setText('stat-missing-cover', missingCover);
    setText('stat-hot-title', champion);
    setText('stat-daily-published', todayCount);
    setText('stat-daily-total', materials.length);
  }

  function renderHotTable(materials) {
    var tbody = byId('hot-tbody');
    if (!tbody) return;

    var top = materials.slice().sort(function (a, b) {
      return heatOf(b) - heatOf(a);
    }).slice(0, 5);

    tbody.textContent = '';

    if (!top.length) {
      appendEmptyRow(tbody, 6, '暂无热度数据');
      return;
    }

    top.forEach(function (material, index) {
      var tr = document.createElement('tr');

      var rank = document.createElement('td');
      rank.className = 'rank' + (index < 3 ? ' rank-top' : '');
      rank.textContent = 'No.' + (index + 1);
      tr.appendChild(rank);

      var title = document.createElement('td');
      title.className = 'hot-title-cell';
      title.appendChild(document.createTextNode(material.title || '未命名素材'));
      if (index < 3) title.insertAdjacentHTML('beforeend', TROPHY_SVG);
      tr.appendChild(title);

      var type = document.createElement('td');
      type.textContent = typeText(material);
      tr.appendChild(type);

      var views = document.createElement('td');
      views.className = 'num';
      views.textContent = String(toCount(material.views));
      tr.appendChild(views);

      var downloads = document.createElement('td');
      downloads.className = 'num';
      downloads.textContent = String(toCount(material.downloads));
      tr.appendChild(downloads);

      var heat = document.createElement('td');
      heat.className = 'num heat-value';
      heat.textContent = formatHeat(heatOf(material));
      tr.appendChild(heat);

      tbody.appendChild(tr);
    });
  }

  function renderTypeChart(materials) {
    var box = byId('type-chart');
    if (!box) return;

    var counts = {};
    TYPE_META.forEach(function (meta) {
      counts[meta.name] = 0;
    });

    materials.forEach(function (material) {
      var seen = {};
      typeList(material).forEach(function (type) {
        if (Object.prototype.hasOwnProperty.call(counts, type) && !seen[type]) {
          counts[type] += 1;
          seen[type] = true;
        }
      });
    });

    var total = 0;
    TYPE_META.forEach(function (meta) {
      total += counts[meta.name];
    });

    var svgNs = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('viewBox', '0 0 180 180');
    svg.setAttribute('aria-hidden', 'true');

    var track = document.createElementNS(svgNs, 'circle');
    track.setAttribute('class', 'donut-track');
    track.setAttribute('cx', '90');
    track.setAttribute('cy', '90');
    track.setAttribute('r', '62');
    svg.appendChild(track);

    if (total > 0) {
      var circumference = 2 * Math.PI * 62;
      var offset = 0;

      TYPE_META.forEach(function (meta) {
        var count = counts[meta.name];
        if (!count) return;

        var length = circumference * count / total;
        var segment = document.createElementNS(svgNs, 'circle');
        segment.setAttribute('class', 'donut-seg ' + meta.seg);
        segment.setAttribute('cx', '90');
        segment.setAttribute('cy', '90');
        segment.setAttribute('r', '62');
        segment.setAttribute('stroke-dasharray', length + ' ' + (circumference - length));
        segment.setAttribute('stroke-dashoffset', String(-offset));
        svg.appendChild(segment);
        offset += length;
      });
    }

    var centerMain = document.createElementNS(svgNs, 'text');
    centerMain.setAttribute('class', 'donut-center-main');
    centerMain.setAttribute('x', '90');
    centerMain.setAttribute('y', '88');
    centerMain.setAttribute('text-anchor', 'middle');
    centerMain.textContent = counts['文档'] + ':' + counts['音频'] + ':' + counts['配图'];
    svg.appendChild(centerMain);

    var centerSub = document.createElementNS(svgNs, 'text');
    centerSub.setAttribute('class', 'donut-center-sub');
    centerSub.setAttribute('x', '90');
    centerSub.setAttribute('y', '108');
    centerSub.setAttribute('text-anchor', 'middle');
    centerSub.textContent = '类型分布';
    svg.appendChild(centerSub);

    var legend = document.createElement('ul');
    legend.className = 'chart-legend';
    TYPE_META.forEach(function (meta) {
      var li = document.createElement('li');
      var dot = document.createElement('span');
      dot.className = 'legend-dot ' + meta.dot;
      dot.setAttribute('aria-hidden', 'true');
      li.appendChild(dot);
      li.appendChild(document.createTextNode(meta.name + ' '));
      var value = document.createElement('b');
      value.textContent = String(counts[meta.name]);
      li.appendChild(value);
      legend.appendChild(li);
    });

    box.textContent = '';
    box.appendChild(svg);
    box.appendChild(legend);
    box.setAttribute('aria-label', '素材类型占比环形图：文档 ' + counts['文档'] +
      '、音频 ' + counts['音频'] + '、配图 ' + counts['配图']);
  }

  /* ---------- 素材管理 ---------- */
  var visibleMaterials = [];
  var selectedIds = {};

  function getOrderedMaterials() {
    var list = getAdminMaterials();
    var customIds = {};

    try {
      var api = window.HongseFront;
      if (api && typeof api.getCustomMaterials === 'function') {
        api.getCustomMaterials().forEach(function (item) {
          if (item && item.id != null) customIds[String(item.id)] = true;
        });
      }
    } catch (err) {
      customIds = {};
    }

    return list.slice().sort(function (a, b) {
      var aCustom = customIds[String(a.id)] ? 1 : 0;
      var bCustom = customIds[String(b.id)] ? 1 : 0;
      if (aCustom !== bCustom) return bCustom - aCustom;
      if (aCustom && bCustom) return toCount(b.id) - toCount(a.id);
      return 0;
    });
  }

  function getFilteredMaterials() {
    var keywordNode = byId('material-search');
    var typeNode = byId('material-type-filter');
    var statusNode = byId('material-status-filter');

    var keyword = keywordNode ? keywordNode.value.trim().toLowerCase() : '';
    var type = typeNode ? typeNode.value : 'all';
    var status = statusNode ? statusNode.value : 'all';

    return getOrderedMaterials().filter(function (material) {
      var title = String(material.title || '').toLowerCase();
      var author = String(material.author || '').toLowerCase();
      if (keyword && title.indexOf(keyword) < 0 && author.indexOf(keyword) < 0) return false;

      if (type !== 'all' && typeList(material).indexOf(type) < 0) return false;
      if (status === '待审核') return false;

      return true;
    });
  }

  function pruneSelection() {
    var visibleIds = {};
    visibleMaterials.forEach(function (material) {
      visibleIds[String(material.id)] = true;
    });

    var next = {};
    Object.keys(selectedIds).forEach(function (id) {
      if (visibleIds[id]) next[id] = true;
    });
    selectedIds = next;
  }

  function createTypeChips(material) {
    var fragment = document.createDocumentFragment();
    var types = typeList(material);

    if (!types.length) {
      fragment.appendChild(document.createTextNode('—'));
      return fragment;
    }

    types.forEach(function (type) {
      var chip = document.createElement('span');
      chip.className = 'type-chip' + (chipClass(type) ? ' ' + chipClass(type) : '');
      chip.textContent = type;
      fragment.appendChild(chip);
    });

    return fragment;
  }

  var MIME_EXTENSIONS = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/bmp': 'bmp',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/ogg': 'ogg',
    'audio/aac': 'aac',
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'text/plain': 'txt'
  };

  function extensionFromSource(url, field) {
    var source = String(url || '');

    if (source.indexOf('data:') === 0) {
      var mimeMatch = source.match(/^data:([^;,]+)/i);
      if (mimeMatch) {
        var mime = mimeMatch[1].toLowerCase();
        if (MIME_EXTENSIONS[mime]) return MIME_EXTENSIONS[mime];
      }
    } else {
      var clean = source.split('#')[0].split('?')[0];
      var name = clean.substring(clean.lastIndexOf('/') + 1);
      var dot = name.lastIndexOf('.');
      if (dot >= 0 && dot < name.length - 1) {
        var ext = name.slice(dot + 1).toLowerCase();
        if (/^[a-z0-9]{1,8}$/.test(ext)) return ext;
      }
    }

    if (field === 'doc') return 'docx';
    if (field === 'audio') return 'mp3';
    if (field === 'cover') return 'png';
    return '';
  }

  function buildDownloadFileName(material, url, field) {
    var base = String((material && material.title) || '素材文件')
      .replace(/[\\/:*?"<>|\r\n]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || '素材文件';

    var ext = extensionFromSource(url, field);
    if (!ext) return base;

    var suffix = '.' + ext;
    if (base.toLowerCase().slice(-suffix.length) === suffix.toLowerCase()) return base;
    return base + suffix;
  }

  function materialAttachmentRef(material, field) {
    var ref = material ? material[field + 'Ref'] : null;
    return ref && typeof ref === 'object' && ref.id ? ref : null;
  }

  /* 下载只支持文档与配图（原图）；音频仅上传存储，不参与下载 */
  function resolveDownloadSource(material) {
    if (!material) return null;

    var fields = ['doc', 'cover'];
    for (var i = 0; i < fields.length; i += 1) {
      var field = fields[i];
      var ref = materialAttachmentRef(material, field);
      if (ref) return { field: field, ref: ref };

      var url = material[field];
      if (typeof url === 'string' && url.trim()) {
        return { field: field, url: url };
      }
    }
    return null;
  }

  /* 音频素材且没有文档附件时，不提供下载（避免只下到封面） */
  function isAudioDownloadBlocked(material) {
    if (!material) return false;

    var hasAudio = typeList(material).indexOf('音频') >= 0 ||
      !!materialAttachmentRef(material, 'audio') ||
      (typeof material.audio === 'string' && material.audio.trim().length > 0);
    var hasDoc = !!materialAttachmentRef(material, 'doc') ||
      (typeof material.doc === 'string' && material.doc.trim().length > 0);

    return hasAudio && !hasDoc;
  }

  function dataUrlToBlob(dataUrl) {
    var comma = dataUrl.indexOf(',');
    if (comma < 0) return null;

    var meta = dataUrl.slice(5, comma);
    var payload = dataUrl.slice(comma + 1);
    var mime = meta.split(';')[0] || 'application/octet-stream';
    var isBase64 = /;base64/i.test(meta);
    var binary = '';

    try {
      binary = isBase64 ? window.atob(payload) : decodeURIComponent(payload);
    } catch (err) {
      return null;
    }

    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mime });
  }

  function triggerBrowserDownload(url, fileName) {
    var link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function downloadAttachmentById(id, fileName) {
    getAttachment(id).then(function (record) {
      if (!record || !record.blob) {
        showAdminToast('附件不存在或已被清理，无法下载。');
        return;
      }
      if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
        showAdminToast('当前浏览器不支持附件下载。');
        return;
      }

      var objectUrl = URL.createObjectURL(record.blob);
      triggerBrowserDownload(objectUrl, fileName || record.name || '素材文件');
      window.setTimeout(function () {
        URL.revokeObjectURL(objectUrl);
      }, 1500);
    }).catch(function () {
      showAdminToast('附件读取失败，请稍后重试。');
    });
  }

  function buildDocFileName(material) {
    var api = window.HongseFront;
    if (api && typeof api.buildMaterialDocFileName === 'function') {
      return api.buildMaterialDocFileName(material);
    }
    return '素材文档.doc';
  }

  /* Word 生成（MHTML）复用 js/front-common.js 的共享实现 */
  function downloadGeneratedDoc(material) {
    if (!material) return;

    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      showAdminToast('当前浏览器不支持文档下载。');
      return;
    }

    var api = window.HongseFront;
    if (!api || typeof api.buildMaterialDocBlob !== 'function') {
      showAdminToast('共享下载模块未加载，无法生成 Word 文档。');
      return;
    }

    api.buildMaterialDocBlob(material).then(function (result) {
      if (!result || !result.blob) throw new Error('文档生成失败');

      if (result.failedCover) {
        var reason = '配图加载失败：' + result.reason + '，Word 中将标注「配图加载失败」。';
        try {
          window.console.warn(reason);
        } catch (err) {
          /* 控制台不可用时只保留界面提示 */
        }
        showAdminToast('配图读取失败：' + result.reason + '，Word 中已标注「配图加载失败」。');
      }

      var objectUrl = URL.createObjectURL(result.blob);

      triggerBrowserDownload(objectUrl, buildDocFileName(material));
      window.setTimeout(function () {
        URL.revokeObjectURL(objectUrl);
      }, 1500);
      showAdminToast(result.failedCover ? '已生成 Word 文档，配图未能内嵌。' : '已生成 Word 文档，正在下载。');
    }).catch(function (err) {
      showAdminToast('Word 文档生成失败：' + (err && err.message ? err.message : '未知原因'));
    });
  }

  function handleMaterialActionClick(event) {
    var node = event.target;
    var action = null;

    while (node && node !== event.currentTarget) {
      if (node.classList && (
        node.classList.contains('download-action') ||
        node.classList.contains('edit-action') ||
        node.classList.contains('delete-action')
      )) {
        action = node;
        break;
      }
      node = node.parentNode;
    }
    if (!action) return;

    var row = action;
    while (row && row.tagName !== 'TR') row = row.parentNode;
    var material = row ? getAdminMaterialById(row.getAttribute('data-id')) : null;

    if (action.classList.contains('download-action')) {
      var field = action.getAttribute('data-download-field') || '';
      var attachmentId = action.getAttribute('data-attachment-id') || '';
      var fileName = action.getAttribute('download') || '素材文件';

      if (action.hasAttribute('data-generated-doc')) {
        event.preventDefault();
        downloadGeneratedDoc(material);
        return;
      }

      if (attachmentId) {
        event.preventDefault();
        if (field === 'cover') {
          showAdminToast('该素材暂无文档/音频附件，正在下载配图。');
        }
        downloadAttachmentById(attachmentId, fileName);
        return;
      }

      var url = action.getAttribute('href') || '';
      if (url.indexOf('data:') !== 0) return;

      var blob = dataUrlToBlob(url);
      if (!blob || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return;

      event.preventDefault();
      if (field === 'cover') {
        showAdminToast('该素材暂无文档/音频附件，正在下载配图。');
      }
      var objectUrl = URL.createObjectURL(blob);
      triggerBrowserDownload(objectUrl, fileName);
      window.setTimeout(function () {
        URL.revokeObjectURL(objectUrl);
      }, 1500);
      return;
    }

    event.preventDefault();
    if (!material) return;

    if (action.classList.contains('edit-action')) {
      openEditModal(material);
    } else {
      deleteMaterial(material);
    }
  }

  function bindMaterialActions() {
    var tbody = byId('material-tbody');
    if (tbody) tbody.addEventListener('click', handleMaterialActionClick);
  }

  function renderMaterialRows(tbody) {
    tbody.textContent = '';

    if (!visibleMaterials.length) {
      appendEmptyRow(tbody, 7, '没有符合条件的素材');
      return;
    }

    visibleMaterials.forEach(function (material) {
      var id = String(material.id);
      var tr = document.createElement('tr');
      tr.setAttribute('data-id', id);

      var checkCell = document.createElement('td');
      checkCell.className = 'col-check';
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'row-check';
      checkbox.setAttribute('data-id', id);
      checkbox.checked = !!selectedIds[id];
      checkbox.setAttribute('aria-label', '选择素材《' + (material.title || '未命名素材') + '》');
      checkCell.appendChild(checkbox);
      tr.appendChild(checkCell);

      var titleCell = document.createElement('td');
      var title = document.createElement('span');
      title.className = 'material-main';
      title.textContent = material.title || '未命名素材';
      var location = document.createElement('span');
      location.className = 'material-sub';
      location.textContent = material.location || '—';
      titleCell.appendChild(title);
      titleCell.appendChild(location);
      tr.appendChild(titleCell);

      var authorCell = document.createElement('td');
      authorCell.textContent = material.author || '—';
      tr.appendChild(authorCell);

      var typeCell = document.createElement('td');
      typeCell.appendChild(createTypeChips(material));
      tr.appendChild(typeCell);

      var statusCell = document.createElement('td');
      var status = document.createElement('span');
      status.className = 'status-chip status-stored';
      status.textContent = '已入库';
      statusCell.appendChild(status);
      tr.appendChild(statusCell);

      var dateCell = document.createElement('td');
      dateCell.textContent = material.date || '—';
      tr.appendChild(dateCell);

      var actionCell = document.createElement('td');
      actionCell.className = 'row-actions';

      var preview = document.createElement('a');
      preview.href = 'detail.html?id=' + encodeURIComponent(id);
      preview.target = '_blank';
      preview.rel = 'noopener';
      preview.textContent = '预览';
      actionCell.appendChild(preview);

      var separator = document.createElement('span');
      separator.className = 'action-sep';
      separator.setAttribute('aria-hidden', 'true');
      separator.textContent = '·';
      actionCell.appendChild(separator);

      var isCustom = !isOriginalMaterialId(id);
      var source = resolveDownloadSource(material);
      var hasDocSource = !!source && source.field === 'doc';
      var downloadBlocked = isAudioDownloadBlocked(material);
      var useGeneratedDoc = isCustom && !downloadBlocked && !hasDocSource;

      if (downloadBlocked) {
        var audioDisabled = document.createElement('span');
        audioDisabled.className = 'action-disabled';
        audioDisabled.title = '音频附件仅支持上传存储，暂不支持下载。';
        audioDisabled.textContent = '下载';
        actionCell.appendChild(audioDisabled);
      } else if (useGeneratedDoc) {
        var generated = document.createElement('a');
        generated.href = 'javascript:;';
        generated.download = buildDocFileName(material);
        generated.className = 'download-action';
        generated.setAttribute('data-generated-doc', '1');
        generated.title = '该素材暂无文档附件，点击生成 Word 文档下载。';
        generated.setAttribute('aria-label', '下载 Word 文档');
        generated.textContent = '下载';
        actionCell.appendChild(generated);
      } else if (source) {
        var sourceName = source.ref ? source.ref.name : source.url;
        var download = document.createElement('a');
        download.download = buildDownloadFileName(material, sourceName, source.field);
        download.className = 'download-action';
        download.setAttribute('data-download-field', source.field);
        if (source.ref) {
          download.href = 'javascript:;';
          download.setAttribute('data-attachment-id', source.ref.id);
        } else {
          download.href = source.url;
        }
        if (source.field === 'cover') {
          download.title = '该素材暂无文档/音频附件，点击下载配图。';
          download.setAttribute('aria-label', '下载配图');
        }
        download.textContent = '下载';
        actionCell.appendChild(download);
      } else {
        var disabled = document.createElement('span');
        disabled.className = 'action-disabled';
        disabled.title = '暂无可下载的附件';
        disabled.textContent = '下载';
        actionCell.appendChild(disabled);
      }

      var editSeparator = document.createElement('span');
      editSeparator.className = 'action-sep';
      editSeparator.setAttribute('aria-hidden', 'true');
      editSeparator.textContent = '·';
      actionCell.appendChild(editSeparator);

      var edit = document.createElement('a');
      edit.href = 'javascript:;';
      edit.className = 'edit-action';
      edit.textContent = '修改';
      actionCell.appendChild(edit);

      var deleteSeparator = document.createElement('span');
      deleteSeparator.className = 'action-sep';
      deleteSeparator.setAttribute('aria-hidden', 'true');
      deleteSeparator.textContent = '·';
      actionCell.appendChild(deleteSeparator);

      var remove = document.createElement('a');
      remove.href = 'javascript:;';
      remove.className = 'delete-action';
      remove.textContent = '删除';
      actionCell.appendChild(remove);

      tr.appendChild(actionCell);
      tbody.appendChild(tr);
    });
  }

  function updateSelectionUi() {
    var total = visibleMaterials.length;
    var selectedCount = 0;

    visibleMaterials.forEach(function (material) {
      if (selectedIds[String(material.id)]) selectedCount += 1;
    });

    var header = byId('material-check-all');
    if (header) {
      header.checked = total > 0 && selectedCount === total;
      header.indeterminate = selectedCount > 0 && selectedCount < total;
    }

    setText('selected-count', '已选 ' + selectedCount + ' 项');
  }

  function renderMaterialTable() {
    var tbody = byId('material-tbody');
    if (!tbody) return;

    visibleMaterials = getFilteredMaterials();
    pruneSelection();
    renderMaterialRows(tbody);
    updateSelectionUi();
  }

  function updateOverviewCards() {
    var materials = getAdminMaterials();
    var total = materials.length;
    var covered = 0;
    var docCount = 0;
    var audioCount = 0;

    materials.forEach(function (material) {
      if (hasCover(material)) covered += 1;
      if (typeList(material).indexOf('文档') >= 0) docCount += 1;
      if (typeList(material).indexOf('音频') >= 0) audioCount += 1;
    });

    setText('overview-total', total);
    setText('overview-total-note', '文档 ' + docCount + ' · 音频 ' + audioCount);
    setText('overview-covered-count', covered);
    setText('overview-covered-total', total);
    setText('overview-stored', total);
    setText('overview-daily', getTodayCustomCount());

    var coveredCard = byId('overview-covered-card');
    var coveredNote = byId('overview-covered-note');
    var complete = total > 0 && covered === total;

    if (coveredCard) coveredCard.classList.toggle('is-complete', complete);
    if (coveredNote) {
      coveredNote.textContent = complete ? '全部完成' : (total === 0 ? '暂无素材' : '还差 ' + (total - covered) + ' 张');
    }
  }

  function syncRowCheckboxes() {
    var tbody = byId('material-tbody');
    if (!tbody) return;

    var boxes = tbody.querySelectorAll('.row-check');
    Array.prototype.forEach.call(boxes, function (box) {
      box.checked = !!selectedIds[box.getAttribute('data-id')];
    });
  }

  var FILTER_STATE_KEY = 'hongse_admin_filters_v1';

  function readFilterState() {
    try {
      var raw = window.sessionStorage.getItem(FILTER_STATE_KEY);
      if (!raw) return null;
      var state = JSON.parse(raw);
      return state && typeof state === 'object' ? state : null;
    } catch (err) {
      return null;
    }
  }

  function saveFilterState() {
    var search = byId('material-search');
    var type = byId('material-type-filter');
    var status = byId('material-status-filter');

    try {
      window.sessionStorage.setItem(FILTER_STATE_KEY, JSON.stringify({
        keyword: search ? search.value : '',
        type: type ? type.value : 'all',
        status: status ? status.value : 'all'
      }));
    } catch (err) {
      /* 筛选状态保存失败不影响筛选 */
    }
  }

  /* 刷新页面后恢复搜索词与筛选条件 */
  function restoreFilterState() {
    var state = readFilterState();
    if (!state) return;

    var search = byId('material-search');
    var type = byId('material-type-filter');
    var status = byId('material-status-filter');

    if (search && typeof state.keyword === 'string') search.value = state.keyword;
    if (type && typeof state.type === 'string' && state.type) type.value = state.type;
    if (status && typeof state.status === 'string' && state.status) status.value = state.status;
  }

  function bindMaterialFilters() {
    var search = byId('material-search');
    var type = byId('material-type-filter');
    var status = byId('material-status-filter');

    function handleFilterChange() {
      saveFilterState();
      renderMaterialTable();
    }

    if (search) {
      search.addEventListener('input', handleFilterChange);
    }
    if (type) {
      type.addEventListener('change', handleFilterChange);
    }
    if (status) {
      status.addEventListener('change', handleFilterChange);
    }
  }

  function bindMaterialSelection() {
    var header = byId('material-check-all');
    var tbody = byId('material-tbody');

    if (header) {
      header.addEventListener('change', function () {
        var checked = header.checked;
        visibleMaterials.forEach(function (material) {
          var id = String(material.id);
          if (checked) {
            selectedIds[id] = true;
          } else {
            delete selectedIds[id];
          }
        });
        syncRowCheckboxes();
        updateSelectionUi();
      });
    }

    if (tbody) {
      tbody.addEventListener('change', function (event) {
        var target = event.target;
        if (!target || !target.classList.contains('row-check')) return;

        var id = target.getAttribute('data-id');
        if (target.checked) {
          selectedIds[id] = true;
        } else {
          delete selectedIds[id];
        }
        updateSelectionUi();
      });
    }
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function exportCurrentList() {
    var headers = ['素材标题', '所属系列', '供稿人', '状态', '浏览量', '下载量', '热度值', '更新日期', '附件类型'];
    var rowsHtml = '';

    visibleMaterials.forEach(function (material) {
      var cells = [
        material.title || '',
        material.series || '',
        material.author || '',
        '已入库',
        toCount(material.views),
        toCount(material.downloads),
        formatHeat(heatOf(material)),
        material.date || '',
        typeList(material).join(' / ')
      ];

      rowsHtml += '<tr>' + cells.map(function (value) {
        return '<td style="border:1px solid #d8cdc2;padding:6px 10px;vertical-align:middle;">' +
          escapeHtml(value) + '</td>';
      }).join('') + '</tr>';
    });

    var headHtml = headers.map(function (title) {
      return '<th style="background:#8b1116;color:#ffffff;font-weight:bold;' +
        'border:1px solid #8b1116;padding:8px 10px;white-space:nowrap;">' +
        escapeHtml(title) + '</th>';
    }).join('');

    var html = '<html><head><meta charset="utf-8">' +
      '<title>红色文化数字基因库-素材清单</title>' +
      '<style>table{border-collapse:collapse;font-family:"Microsoft YaHei",Arial,sans-serif;font-size:12px;}' +
      'td{vertical-align:middle;}</style></head><body>' +
      '<table border="1" cellspacing="0" cellpadding="0">' +
      '<colgroup>' +
      '<col style="width:260px">' +
      '<col style="width:140px">' +
      '<col style="width:100px">' +
      '<col style="width:80px">' +
      '<col style="width:80px">' +
      '<col style="width:80px">' +
      '<col style="width:80px">' +
      '<col style="width:110px">' +
      '<col style="width:140px">' +
      '</colgroup>' +
      '<thead><tr>' + headHtml + '</tr></thead>' +
      '<tbody>' + rowsHtml + '</tbody>' +
      '</table></body></html>';

    var blob = new Blob(['\uFEFF' + html], { type: 'application/vnd.ms-excel' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = '红色文化数字基因库-素材清单-' + todayString() + '.xls';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function bindBulkActions() {
    var message = '演示版暂未开放，批量操作将在后续版本开放';

    ['batch-audio', 'batch-cover'].forEach(function (id) {
      var button = byId(id);
      if (button) {
        button.addEventListener('click', function () {
          window.alert(message);
        });
      }
    });

    var exportButton = byId('export-list');
    if (exportButton) {
      exportButton.addEventListener('click', exportCurrentList);
    }
  }

  /* ---------- 上传/编辑素材弹窗 ---------- */
  var pendingCover = '';
  var coverReadToken = 0;
  var coverReading = false;
  var editingMaterialId = null;
  var pendingCoverFile = null;
  var pendingAudioFile = null;
  var pendingDocFile = null;
  var currentCoverRef = null;
  var currentAudioRef = null;
  var currentDocRef = null;
  var uploadSaving = false;

  function showUploadError(message) {
    var error = byId('upload-error');
    if (!error) return;
    error.textContent = message;
    error.hidden = false;
  }

  function hideUploadError() {
    var error = byId('upload-error');
    if (error) error.hidden = true;
  }

  function setFieldError(inputId, errorId, message) {
    var input = byId(inputId);
    var error = byId(errorId);

    if (input) {
      input.classList.add('is-invalid');
      input.setAttribute('aria-invalid', 'true');
    }
    if (error) {
      error.textContent = message;
      error.hidden = false;
    }
  }

  function clearFieldError(inputId, errorId) {
    var input = byId(inputId);
    var error = byId(errorId);

    if (input) {
      input.classList.remove('is-invalid');
      input.removeAttribute('aria-invalid');
    }
    if (error) error.hidden = true;
  }

  function clearUploadErrors() {
    clearFieldError('upload-title', 'upload-title-error');
    clearFieldError('upload-cover', 'upload-cover-error');
    clearFieldError('upload-audio', 'upload-audio-error');
    clearFieldError('upload-doc', 'upload-doc-error');
    hideUploadError();
  }

  function refreshUploadSummary() {
    var messages = [];

    ['upload-title-error', 'upload-cover-error', 'upload-audio-error', 'upload-doc-error'].forEach(function (id) {
      var error = byId(id);
      if (error && !error.hidden && error.textContent.trim()) {
        messages.push(error.textContent.trim());
      }
    });

    if (messages.length) {
      showUploadError(messages.join(' '));
    } else {
      hideUploadError();
    }
  }

  function clearCoverPreview() {
    var wrap = byId('upload-cover-preview');
    var image = byId('upload-cover-image');

    if (wrap) wrap.hidden = true;
    if (image) image.removeAttribute('src');
  }

  function showCoverPreview(source) {
    var wrap = byId('upload-cover-preview');
    var image = byId('upload-cover-image');

    if (image) image.src = source;
    if (wrap) wrap.hidden = false;
  }

  function setAttachmentCurrent(kind, ref, legacyUrl) {
    var node = byId('upload-' + kind + '-current');
    if (!node) return;

    var text = '';
    if (ref && ref.name) {
      text = '已保存附件：' + ref.name + (ref.size ? '（' + formatFileSize(ref.size) + '）' : '');
    } else if (legacyUrl) {
      var clean = String(legacyUrl).split('#')[0].split('?')[0];
      var name = clean.substring(clean.lastIndexOf('/') + 1) || '已有附件';
      text = '当前附件：' + name;
    }

    node.textContent = text;
    node.hidden = !text;
  }

  function setAttachmentFieldVisible(kind, visible) {
    var field = byId('upload-' + kind + '-field');
    if (!field) return;

    field.hidden = !visible;

    if (!visible) {
      var input = byId('upload-' + kind);
      if (input) input.value = '';
      clearFieldError('upload-' + kind, 'upload-' + kind + '-error');
      if (kind === 'audio') pendingAudioFile = null;
      if (kind === 'doc') pendingDocFile = null;
    }
  }

  function syncAttachmentFields() {
    var form = byId('upload-form');
    if (!form) return;

    var checked = {};
    Array.prototype.forEach.call(form.querySelectorAll('input[name="type"]:checked'), function (box) {
      checked[box.value] = true;
    });

    setAttachmentFieldVisible('audio', !!checked['音频']);
    setAttachmentFieldVisible('doc', !!checked['文档']);
  }

  function setUploadSaving(saving) {
    uploadSaving = saving;

    var submit = byId('upload-submit');
    if (submit) {
      submit.disabled = saving;
      submit.textContent = saving ? '保存中…' : (editingMaterialId ? '保存修改' : '确认上传');
    }
  }

  function setUploadModalMode(isEdit) {
    var title = byId('upload-modal-title');
    var submit = byId('upload-submit');

    if (title) title.textContent = isEdit ? '编辑素材' : '上传素材';
    if (submit) {
      submit.textContent = isEdit ? '保存修改' : '确认上传';
      submit.disabled = false;
    }
  }

  function resetUploadForm() {
    var form = byId('upload-form');
    var dateInput = byId('upload-date');

    if (form) form.reset();
    if (dateInput) dateInput.value = todayString();

    editingMaterialId = null;
    setUploadModalMode(false);
    coverReadToken += 1;
    pendingCover = '';
    pendingCoverFile = null;
    pendingAudioFile = null;
    pendingDocFile = null;
    currentCoverRef = null;
    currentAudioRef = null;
    currentDocRef = null;
    coverReading = false;
    uploadSaving = false;
    setAttachmentCurrent('audio', null, '');
    setAttachmentCurrent('doc', null, '');
    syncAttachmentFields();
    clearCoverPreview();
    clearUploadErrors();
  }

  function openUploadModal() {
    var modal = byId('upload-modal');
    var title = byId('upload-title');
    if (!modal) return;

    resetUploadForm();
    modal.hidden = false;
    document.body.classList.add('modal-open');
    if (title) title.focus();
  }

  function closeUploadModal() {
    var modal = byId('upload-modal');
    if (modal) modal.hidden = true;
    document.body.classList.remove('modal-open');
    resetUploadForm();
  }

  function openEditModal(material) {
    if (!material) return;

    var modal = byId('upload-modal');
    if (!modal) return;

    resetUploadForm();
    editingMaterialId = String(material.id);
    setUploadModalMode(true);

    var titleInput = byId('upload-title');
    var authorInput = byId('upload-author');
    var seriesInput = byId('upload-series');
    var dateInput = byId('upload-date');
    var locationInput = byId('upload-location');
    var tagsInput = byId('upload-tags');
    var introInput = byId('upload-intro');
    var form = byId('upload-form');

    if (titleInput) titleInput.value = material.title || '';
    if (authorInput) authorInput.value = material.author || '';
    if (seriesInput) seriesInput.value = material.series || '';
    if (dateInput) dateInput.value = material.date || todayString();
    if (locationInput) locationInput.value = material.location || '';
    if (tagsInput) tagsInput.value = Array.isArray(material.tags) ? material.tags.join(', ') : '';
    if (introInput) introInput.value = material.intro || '';

    var types = typeList(material);
    if (form) {
      var boxes = form.querySelectorAll('input[name="type"]');
      Array.prototype.forEach.call(boxes, function (box) {
        box.checked = types.indexOf(box.value) >= 0;
      });
    }

    pendingCover = material.cover || '';
    if (pendingCover) showCoverPreview(pendingCover);

    currentCoverRef = material.coverRef || null;
    currentAudioRef = material.audioRef || null;
    currentDocRef = material.docRef || null;
    pendingCoverFile = null;
    pendingAudioFile = null;
    pendingDocFile = null;

    syncAttachmentFields();
    setAttachmentCurrent('audio', currentAudioRef, material.audio);
    setAttachmentCurrent('doc', currentDocRef, material.doc);

    modal.hidden = false;
    document.body.classList.add('modal-open');
    if (titleInput) titleInput.focus();
  }

  function saveEditedMaterial(updated) {
    var id = String(updated.id);
    var state = readAdminState();

    if (isOriginalMaterialId(id)) {
      delete state.deleted[id];
      state.overrides[id] = updated;
      return writeAdminState(state);
    }

    var list = readCustomStore();
    var found = false;

    for (var i = 0; i < list.length; i += 1) {
      var item = list[i];
      if (item && typeof item.title === 'string' && String(item.id) === id) {
        list[i] = updated;
        found = true;
        break;
      }
    }
    if (!found) return false;
    if (!writeCustomStore(list)) return false;

    if (state.overrides[id] || state.deleted[id]) {
      delete state.overrides[id];
      delete state.deleted[id];
      if (!writeAdminState(state)) return false;
    }
    return true;
  }

  function deleteMaterial(material) {
    if (!material) return;

    var title = material.title || '未命名素材';
    if (!window.confirm('确定要删除素材《' + title + '》吗？删除后不可恢复。')) return;

    var id = String(material.id);
    var state = readAdminState();

    if (isOriginalMaterialId(id)) {
      delete state.overrides[id];
      state.deleted[id] = true;
      if (!writeAdminState(state)) {
        showAdminToast('删除失败：本地存储空间不足，请稍后重试。');
        return;
      }
    } else {
      var list = readCustomStore();
      var next = [];
      var found = false;

      list.forEach(function (item) {
        if (item && typeof item.title === 'string' && String(item.id) === id) {
          found = true;
          return;
        }
        next.push(item);
      });

      if (!found) {
        showAdminToast('未找到该自定义素材，删除失败。');
        return;
      }
      if (!writeCustomStore(next)) {
        showAdminToast('删除失败：本地存储空间不足，请稍后重试。');
        return;
      }

      if (state.overrides[id] || state.deleted[id]) {
        delete state.overrides[id];
        delete state.deleted[id];
        writeAdminState(state);
      }

      ['cover', 'audio', 'doc'].forEach(function (field) {
        var ref = materialAttachmentRef(material, field);
        if (ref) deleteAttachment(ref.id);
      });
    }

    delete selectedIds[id];
    clearMaterialStats(id);
    renderMaterialTable();
    updateOverviewCards();
    showAdminToast('素材已删除。');
  }

  function getUploadFormValues() {
    var form = byId('upload-form');
    var types = [];

    if (form) {
      var checkedTypes = form.querySelectorAll('input[name="type"]:checked');
      Array.prototype.forEach.call(checkedTypes, function (box) {
        types.push(box.value);
      });
    }
    if (!types.length) types = ['配图'];

    var tagsInput = byId('upload-tags');
    var tags = tagsInput ? tagsInput.value.split(/[,，]/).map(function (tag) {
      return tag.trim();
    }).filter(function (tag) {
      return tag.length > 0;
    }) : [];

    var dateInput = byId('upload-date');
    var authorInput = byId('upload-author');
    var seriesInput = byId('upload-series');
    var locationInput = byId('upload-location');
    var introInput = byId('upload-intro');
    var titleInput = byId('upload-title');

    return {
      title: titleInput ? titleInput.value.trim() : '',
      author: authorInput ? authorInput.value.trim() : '',
      series: seriesInput ? seriesInput.value.trim() : '',
      date: dateInput && dateInput.value ? dateInput.value : todayString(),
      location: locationInput ? locationInput.value.trim() : '',
      tags: tags,
      intro: introInput ? introInput.value.trim() : '',
      types: types
    };
  }

  function handleCoverChange() {
    var input = byId('upload-cover');
    var file = input && input.files ? input.files[0] : null;

    coverReadToken += 1;
    var token = coverReadToken;
    pendingCover = '';
    pendingCoverFile = null;
    coverReading = false;
    clearCoverPreview();
    clearFieldError('upload-cover', 'upload-cover-error');
    refreshUploadSummary();

    if (!file) return;

    var fileMessage = checkAttachmentFile(file, '配图', 'image');
    if (fileMessage) {
      if (input) input.value = '';
      setFieldError('upload-cover', 'upload-cover-error', fileMessage);
      refreshUploadSummary();
      return;
    }

    coverReading = true;
    compressCoverImage(file).then(function (dataUrl) {
      if (token !== coverReadToken) return;

      coverReading = false;
      if (!dataUrl) {
        setFieldError('upload-cover', 'upload-cover-error', '配图处理失败，请换一张图片重试。');
        refreshUploadSummary();
        return;
      }

      pendingCover = dataUrl;
      pendingCoverFile = file;
      showCoverPreview(dataUrl);
      clearFieldError('upload-cover', 'upload-cover-error');
      refreshUploadSummary();
    }).catch(function () {
      if (token !== coverReadToken) return;

      coverReading = false;
      setFieldError('upload-cover', 'upload-cover-error', '配图读取失败，请重新选择图片。');
      refreshUploadSummary();
    });
  }

  function handleAttachmentChange(kind) {
    var inputId = 'upload-' + kind;
    var errorId = inputId + '-error';
    var labelMap = { audio: '音频附件', doc: '文档附件' };
    var label = labelMap[kind] || '附件';
    var input = byId(inputId);
    var file = input && input.files ? input.files[0] : null;

    clearFieldError(inputId, errorId);
    if (kind === 'audio') pendingAudioFile = null;
    if (kind === 'doc') pendingDocFile = null;

    if (!file) {
      refreshUploadSummary();
      return;
    }

    var message = checkAttachmentFile(file, label, kind);
    if (message) {
      if (input) input.value = '';
      setFieldError(inputId, errorId, message);
      refreshUploadSummary();
      return;
    }

    if (kind === 'audio') pendingAudioFile = file;
    if (kind === 'doc') pendingDocFile = file;

    var current = byId('upload-' + kind + '-current');
    if (current) {
      current.textContent = '已选择：' + file.name + '（' + formatFileSize(file.size) + '）';
      current.hidden = false;
    }
    refreshUploadSummary();
  }

  function assignAttachmentRef(material, key, ref) {
    if (ref && ref.id) {
      material[key] = ref;
    } else {
      delete material[key];
    }
  }

  function finishUpload(editing) {
    setUploadSaving(false);
    closeUploadModal();

    if (!editing) {
      var search = byId('material-search');
      var typeFilter = byId('material-type-filter');
      var statusFilter = byId('material-status-filter');
      if (search) search.value = '';
      if (typeFilter) typeFilter.value = 'all';
      if (statusFilter) statusFilter.value = 'all';
    }

    renderMaterialTable();
    updateOverviewCards();
    if (byId('hot-tbody')) initDashboard();
  }

  function handleUploadSubmit(event) {
    event.preventDefault();
    if (uploadSaving) return;
    clearUploadErrors();

    var titleInput = byId('upload-title');
    var title = titleInput ? titleInput.value.trim() : '';
    var coverInput = byId('upload-cover');
    var coverFile = coverInput && coverInput.files ? coverInput.files[0] : null;
    var values = getUploadFormValues();

    var editing = !!editingMaterialId;
    var current = editing ? getAdminMaterialById(editingMaterialId) : null;
    if (editing && !current) {
      showUploadError('未找到要编辑的素材，请刷新页面后重试。');
      return;
    }

    var messages = [];
    var focusTarget = null;

    if (!title) {
      setFieldError('upload-title', 'upload-title-error', '请填写素材标题。');
      messages.push('请填写素材标题。');
      focusTarget = titleInput;
    }

    var coverMessage = '';
    if (coverReading) {
      coverMessage = '配图正在读取，请稍候再试。';
    } else if (!pendingCover) {
      coverMessage = coverFile ? '配图读取失败，请重新选择图片。' : '请选择一张本地配图。';
    } else if (pendingCoverFile) {
      coverMessage = checkAttachmentFile(pendingCoverFile, '配图', 'image');
    }
    if (coverMessage) {
      setFieldError('upload-cover', 'upload-cover-error', coverMessage);
      messages.push(coverMessage);
      if (!focusTarget) focusTarget = coverInput;
    }

    if (values.types.indexOf('音频') >= 0) {
      var audioReady = pendingAudioFile || currentAudioRef || (current && current.audio);
      var audioMessage = '';

      if (!audioReady) {
        audioMessage = '请选择音频文件。';
      } else if (pendingAudioFile) {
        audioMessage = checkAttachmentFile(pendingAudioFile, '音频附件', 'audio');
      }

      if (audioMessage) {
        setFieldError('upload-audio', 'upload-audio-error', audioMessage);
        messages.push(audioMessage);
        if (!focusTarget) focusTarget = byId('upload-audio');
      }
    }

    if (values.types.indexOf('文档') >= 0) {
      var docReady = pendingDocFile || currentDocRef || (current && current.doc);
      var docMessage = '';

      if (!docReady) {
        docMessage = '请选择文档文件。';
      } else if (pendingDocFile) {
        docMessage = checkAttachmentFile(pendingDocFile, '文档附件', 'doc');
      }

      if (docMessage) {
        setFieldError('upload-doc', 'upload-doc-error', docMessage);
        messages.push(docMessage);
        if (!focusTarget) focusTarget = byId('upload-doc');
      }
    }

    if (messages.length) {
      showUploadError(messages.join(' '));
      if (focusTarget) focusTarget.focus();
      return;
    }

    var api = window.HongseFront;
    if (!editing && (!api || typeof api.nextCustomId !== 'function')) {
      showUploadError('数据服务未加载，请刷新页面后重试。');
      return;
    }

    var removeAudio = values.types.indexOf('音频') < 0;
    var removeDoc = values.types.indexOf('文档') < 0;

    setUploadSaving(true);

    var coverTask = pendingCoverFile
      ? saveAttachmentFile(pendingCoverFile).catch(function () { return null; })
      : Promise.resolve(null);
    var audioTask = (!removeAudio && pendingAudioFile)
      ? saveAttachmentFile(pendingAudioFile)
      : Promise.resolve(null);
    var docTask = (!removeDoc && pendingDocFile)
      ? saveAttachmentFile(pendingDocFile)
      : Promise.resolve(null);

    Promise.all([coverTask, audioTask, docTask]).then(function (refs) {
      var savedCoverRef = refs[0];
      var savedAudioRef = refs[1];
      var savedDocRef = refs[2];

      var nextCoverRef = savedCoverRef || currentCoverRef;
      var nextAudioRef = removeAudio ? null : (savedAudioRef || currentAudioRef);
      var nextDocRef = removeDoc ? null : (savedDocRef || currentDocRef);

      var saved = false;

      if (editing) {
        var updated = stripStats(current);
        updated.id = current.id;
        updated.title = values.title;
        updated.author = values.author;
        updated.authorRole = current.authorRole || '';
        updated.series = values.series;
        updated.date = values.date;
        updated.location = values.location;
        updated.tags = values.tags;
        updated.type = values.types;
        updated.intro = values.intro;
        updated.cover = pendingCover;

        assignAttachmentRef(updated, 'coverRef', nextCoverRef);
        assignAttachmentRef(updated, 'audioRef', nextAudioRef);
        assignAttachmentRef(updated, 'docRef', nextDocRef);

        saved = saveEditedMaterial(updated);
      } else {
        var material = {
          id: api.nextCustomId(),
          title: values.title,
          author: values.author,
          authorRole: '',
          location: values.location,
          date: values.date,
          series: values.series,
          tags: values.tags,
          type: values.types,
          intro: values.intro,
          cover: pendingCover,
          audio: '',
          doc: '',
          views: 0,
          downloads: 0
        };

        if (nextCoverRef) material.coverRef = nextCoverRef;
        if (nextAudioRef) material.audioRef = nextAudioRef;
        if (nextDocRef) material.docRef = nextDocRef;

        var customList = readCustomStore();
        customList.push(material);
        saved = writeCustomStore(customList);
      }

      if (!saved) {
        [savedCoverRef, savedAudioRef, savedDocRef].forEach(function (ref) {
          if (ref) deleteAttachment(ref.id);
        });
        throw new Error('metadata');
      }

      if (currentCoverRef && (!nextCoverRef || currentCoverRef.id !== nextCoverRef.id)) {
        deleteAttachment(currentCoverRef.id);
      }
      if (currentAudioRef && (!nextAudioRef || currentAudioRef.id !== nextAudioRef.id)) {
        deleteAttachment(currentAudioRef.id);
      }
      if (currentDocRef && (!nextDocRef || currentDocRef.id !== nextDocRef.id)) {
        deleteAttachment(currentDocRef.id);
      }

      finishUpload(editing);
    }).catch(function (err) {
      setUploadSaving(false);

      if (err && err.message === 'metadata') {
        showUploadError('保存失败：本地存储空间不足或素材已不存在，请稍后重试。');
      } else {
        showUploadError('附件保存失败：浏览器本地附件库不可用或空间不足，请换用支持 IndexedDB 的浏览器后重试。');
      }
    });
  }

  function bindUploadModal() {
    var modal = byId('upload-modal');
    var form = byId('upload-form');
    if (!modal || !form) return;

    var open = byId('upload-open');
    if (open) open.addEventListener('click', openUploadModal);

    var close = byId('upload-close');
    if (close) close.addEventListener('click', closeUploadModal);

    var cancel = byId('upload-cancel');
    if (cancel) cancel.addEventListener('click', closeUploadModal);

    var backdrop = modal.querySelector('[data-close-modal]');
    if (backdrop) backdrop.addEventListener('click', closeUploadModal);

    var coverInput = byId('upload-cover');
    if (coverInput) coverInput.addEventListener('change', handleCoverChange);

    var audioInput = byId('upload-audio');
    if (audioInput) {
      audioInput.addEventListener('change', function () {
        handleAttachmentChange('audio');
      });
    }

    var docInput = byId('upload-doc');
    if (docInput) {
      docInput.addEventListener('change', function () {
        handleAttachmentChange('doc');
      });
    }

    var typeBoxes = form.querySelectorAll('input[name="type"]');
    Array.prototype.forEach.call(typeBoxes, function (box) {
      box.addEventListener('change', syncAttachmentFields);
    });

    var titleInput = byId('upload-title');
    if (titleInput) {
      titleInput.addEventListener('input', function () {
        clearFieldError('upload-title', 'upload-title-error');
        refreshUploadSummary();
      });
    }

    form.addEventListener('submit', handleUploadSubmit);

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !modal.hidden) closeUploadModal();
    });
  }

  function initMaterialsPage() {
    restoreFilterState();
    renderMaterialTable();
    updateOverviewCards();
    bindMaterialFilters();
    bindMaterialSelection();
    bindMaterialActions();
    bindBulkActions();
    bindUploadModal();
  }

  /* ---------- 导航提示与自动刷新 ---------- */
  var toastTimer = null;

  function showAdminToast(message) {
    var toast = byId('admin-toast');

    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'admin-toast';
      toast.className = 'admin-toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.classList.remove('is-visible');
    void toast.offsetWidth;
    toast.classList.add('is-visible');

    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      toast.classList.remove('is-visible');
    }, 3000);
  }

  function initNavNotices() {
    var links = document.querySelectorAll('[data-admin-notice]');

    Array.prototype.forEach.call(links, function (link) {
      link.addEventListener('click', function (event) {
        event.preventDefault();
        showAdminToast(link.getAttribute('data-admin-notice') || '');
      });
    });
  }

  function refreshAdminData() {
    if (byId('material-tbody')) {
      renderMaterialTable();
      updateOverviewCards();
    }
    if (byId('hot-tbody')) {
      initDashboard();
    }
  }

  function bindAutoRefresh() {
    window.addEventListener('storage', function (event) {
      if (event && event.key && event.key.indexOf('hongse_') !== 0) return;
      refreshAdminData();
    });

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) refreshAdminData();
    });
  }

  function init() {
    initNavNotices();
    bindAutoRefresh();
    if (byId('material-tbody')) initMaterialsPage();
    if (byId('hot-tbody')) initDashboard();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
