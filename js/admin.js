/* ============================================
   红色文化数字基因库 · 后台共用脚本
   数据看板 admin.html / 素材管理 admin-materials.html
   所有数据统一来自 window.HongseFront
   ============================================ */
(function () {
  'use strict';

  var TYPE_META = [
    { name: '文档', chip: 'type-doc' },
    { name: '音频', chip: 'type-audio' },
    { name: '配图', chip: 'type-image' }
  ];
  var ADMIN_FILTER_KEY = 'hongse_admin_materials_filters_v1';
  /* 纯前端演示权限遮挡：密码公开在源码中，不是真实安全登录 */
  var ADMIN_AUTH_KEY = 'hongse_admin_auth_v1';
  var ADMIN_DEMO_PASSWORD = '123456';
  var ATTACH_DB_NAME = 'hongse_admin_attachments_v1';
  var ATTACH_STORE_NAME = 'files';
  var ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
  var COVER_DATA_MAX_LENGTH = 2 * 1024 * 1024;
  var attachDbPromise = null;
  var toastTimer = null;

  function byId(id) {
    return document.getElementById(id);
  }

  function setText(id, text) {
    var node = byId(id);
    if (node) node.textContent = String(text);
  }

  function toCount(value) {
    var number = Number(value);
    return isFinite(number) && number >= 0 ? Math.floor(number) : 0;
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

  function heatOf(material) {
    return toCount(material && material.views) + toCount(material && material.downloads) * 2;
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

  function getCustomMaterials() {
    var api = window.HongseFront;
    return api && typeof api.getCustomMaterials === 'function'
      ? api.getCustomMaterials()
      : [];
  }

  function getCustomIds() {
    var ids = {};
    getCustomMaterials().forEach(function (item) {
      if (item && item.id != null) ids[String(item.id)] = true;
    });
    return ids;
  }

  function isOriginalMaterialId(id) {
    var api = window.HongseFront;
    if (!api || typeof api.getOriginalMaterials !== 'function') return false;
    var target = String(id);
    return api.getOriginalMaterials().some(function (item) {
      return item && String(item.id) === target;
    });
  }

  function getMaterials() {
    try {
      var api = window.HongseFront;
      if (!api || typeof api.getAllMaterials !== 'function') return [];
      return api.getAllMaterials().filter(function (item) {
        return item && item.id != null;
      });
    } catch (err) {
      return [];
    }
  }

  function getTodayCustomCount() {
    var todayKey = todayString();
    return getCustomMaterials().filter(function (item) {
      var created = normalizeDateValue(item.createdAt || item.createDate);
      var key = created || materialDateKey(item);
      return key === todayKey;
    }).length;
  }

  function showAdminToast(message) {
    var toast = byId('admin-toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('is-visible');
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      toast.classList.remove('is-visible');
    }, 3000);
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

  /* ============================================
     数据看板
     ============================================ */
  function initDashboard() {
    var materials = getMaterials();
    renderDashboardStats(materials);
    renderHotTable(materials);
    renderTypeChart(materials);
    renderSeriesChart(materials);
  }

  function renderDashboardStats(materials) {
    var views = 0;
    var downloads = 0;
    var seriesMap = {};

    materials.forEach(function (material) {
      views += toCount(material.views);
      downloads += toCount(material.downloads);
      if (material.series) seriesMap[material.series] = true;
    });

    var typeSet = {};
    materials.forEach(function (material) {
      typeList(material).forEach(function (type) {
        typeSet[type] = true;
      });
    });

    var champion = materials.slice().sort(function (a, b) {
      return heatOf(b) - heatOf(a);
    })[0];

    setText('stat-total', materials.length);
    setText('stat-views', views);
    setText('stat-downloads', downloads);
    setText('stat-hot-title', champion ? (champion.title || '未命名素材') : '暂无数据');
    setText('stat-type-count', Object.keys(typeSet).length);
    setText('stat-type-note', '素材类型数量（系列 ' + Object.keys(seriesMap).length + ' 个）');
    setText('stat-daily-published', getTodayCustomCount());
    setText('stat-daily-total', materials.length);
  }

  function renderHotTable(materials) {
    var tbody = byId('hot-tbody');
    if (!tbody) return;

    var top = materials.slice().sort(function (a, b) {
      var diff = heatOf(b) - heatOf(a);
      if (diff !== 0) return diff;
      return String(b.date || '').localeCompare(String(a.date || ''));
    }).slice(0, 5);

    tbody.textContent = '';
    if (!top.length) {
      appendEmptyRow(tbody, 6, '暂无热度数据');
      return;
    }

    top.forEach(function (material, index) {
      var tr = document.createElement('tr');

      var rank = document.createElement('td');
      rank.className = 'rank';
      var rankText = document.createElement('span');
      rankText.className = 'rank-badge-table' +
        (index === 0 ? ' rank-first' : (index < 3 ? ' rank-top' : ''));
      rankText.textContent = 'No.' + (index + 1);
      rank.appendChild(rankText);
      tr.appendChild(rank);

      var title = document.createElement('td');
      title.className = 'hot-title-cell';
      var titleMain = document.createElement('span');
      titleMain.className = 'hot-title-main';
      titleMain.textContent = material.title || '未命名素材';
      title.appendChild(titleMain);
      var titleSub = document.createElement('span');
      titleSub.className = 'hot-title-sub';
      titleSub.textContent = material.series || '未分类';
      title.appendChild(titleSub);
      tr.appendChild(title);

      var type = document.createElement('td');
      type.textContent = typeText(material);
      tr.appendChild(type);

      var viewsCell = document.createElement('td');
      viewsCell.className = 'num';
      viewsCell.textContent = String(toCount(material.views));
      tr.appendChild(viewsCell);

      var downloadsCell = document.createElement('td');
      downloadsCell.className = 'num';
      downloadsCell.textContent = String(toCount(material.downloads));
      tr.appendChild(downloadsCell);

      var heat = document.createElement('td');
      heat.className = 'num heat-value';
      heat.textContent = String(heatOf(material));
      tr.appendChild(heat);

      tbody.appendChild(tr);
    });
  }

  function renderBarChart(container, entries, colorClass) {
    if (!container) return;
    container.textContent = '';

    if (!entries.length) {
      var empty = document.createElement('p');
      empty.className = 'bar-empty';
      empty.textContent = '暂无数据';
      container.appendChild(empty);
      return;
    }

    var max = entries.reduce(function (maxValue, entry) {
      return Math.max(maxValue, entry.value);
    }, 1);

    entries.forEach(function (entry) {
      var row = document.createElement('div');
      row.className = 'bar-row';

      var head = document.createElement('div');
      head.className = 'bar-head';
      var label = document.createElement('span');
      label.className = 'bar-label';
      label.textContent = entry.label;
      var value = document.createElement('span');
      value.className = 'bar-value';
      value.textContent = String(entry.value);
      head.appendChild(label);
      head.appendChild(value);
      row.appendChild(head);

      var track = document.createElement('div');
      track.className = 'bar-track';
      var fill = document.createElement('div');
      fill.className = 'bar-fill ' + (entry.colorClass || colorClass || '');
      fill.style.width = Math.max(entry.value > 0 ? 4 : 0, Math.round(entry.value / max * 100)) + '%';
      track.appendChild(fill);
      row.appendChild(track);

      container.appendChild(row);
    });
  }

  function renderTypeChart(materials) {
    var counts = {};
    TYPE_META.forEach(function (meta) { counts[meta.name] = 0; });

    materials.forEach(function (material) {
      var seen = {};
      typeList(material).forEach(function (type) {
        if (Object.prototype.hasOwnProperty.call(counts, type) && !seen[type]) {
          counts[type] += 1;
          seen[type] = true;
        }
      });
    });

    var colors = { '文档': 'bar-red', '音频': 'bar-gold', '配图': 'bar-green' };
    var entries = TYPE_META.map(function (meta) {
      return { label: meta.name, value: counts[meta.name], colorClass: colors[meta.name] };
    });
    renderBarChart(byId('type-chart'), entries, 'bar-red');
  }

  function renderSeriesChart(materials) {
    var counts = {};
    materials.forEach(function (material) {
      var series = material.series || '未分类';
      counts[series] = (counts[series] || 0) + 1;
    });

    var palette = ['bar-red', 'bar-gold', 'bar-green'];
    var entries = Object.keys(counts).map(function (series, index) {
      return { label: series, value: counts[series], colorClass: palette[index % palette.length] };
    }).sort(function (a, b) {
      return b.value - a.value;
    });

    renderBarChart(byId('series-chart'), entries, 'bar-gold');
  }

  /* ============================================
     素材管理
     ============================================ */
  function getFilterState() {
    var keywordNode = byId('material-search');
    var typeNode = byId('material-type-filter');
    var sortNode = byId('material-sort');
    return {
      keyword: keywordNode ? keywordNode.value.trim().toLowerCase() : '',
      type: typeNode ? typeNode.value : 'all',
      sort: sortNode ? sortNode.value : 'date'
    };
  }

  function readSavedFilters() {
    try {
      var raw = window.localStorage.getItem(ADMIN_FILTER_KEY);
      if (!raw) return null;
      var value = JSON.parse(raw);
      return value && typeof value === 'object' ? value : null;
    } catch (err) {
      return null;
    }
  }

  function saveFilters() {
    try {
      window.localStorage.setItem(ADMIN_FILTER_KEY, JSON.stringify(getFilterState()));
    } catch (err) {
      /* 忽略存储失败 */
    }
  }

  function restoreFilters() {
    var saved = readSavedFilters();
    if (!saved) return;
    var search = byId('material-search');
    var type = byId('material-type-filter');
    var sort = byId('material-sort');
    if (search && typeof saved.keyword === 'string') search.value = saved.keyword;
    if (type && typeof saved.type === 'string') type.value = saved.type;
    if (sort && typeof saved.sort === 'string') sort.value = saved.sort;
  }

  function getFilteredMaterials() {
    var filters = getFilterState();
    var list = getMaterials().filter(function (material) {
      var haystack = [
        material.title,
        material.author,
        material.location,
        (material.tags || []).join(' '),
        material.series
      ].join(' ').toLowerCase();

      if (filters.keyword && haystack.indexOf(filters.keyword) === -1) return false;
      if (filters.type !== 'all' && typeList(material).indexOf(filters.type) === -1) return false;
      return true;
    });

    list.sort(function (a, b) {
      if (filters.sort === 'views') return toCount(b.views) - toCount(a.views);
      if (filters.sort === 'downloads') return toCount(b.downloads) - toCount(a.downloads);
      if (filters.sort === 'heat') return heatOf(b) - heatOf(a);
      return String(b.date || '').localeCompare(String(a.date || ''));
    });

    return list;
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
      var cls = chipClass(type);
      chip.className = 'type-chip' + (cls ? ' ' + cls : '');
      chip.textContent = type;
      fragment.appendChild(chip);
    });

    return fragment;
  }

  function createThumb(material) {
    var wrap = document.createElement('div');
    wrap.className = 'thumb';

    if (material.cover) {
      var img = document.createElement('img');
      img.src = material.cover;
      img.alt = material.title || '素材缩略图';
      img.loading = 'lazy';
      wrap.appendChild(img);
    } else {
      var placeholder = document.createElement('span');
      placeholder.className = 'thumb-empty';
      placeholder.textContent = '无图';
      wrap.appendChild(placeholder);
    }
    return wrap;
  }

  function removeCustomMaterial(material) {
    var api = window.HongseFront;
    if (!api) return false;

    var id = String(material.id);
    var list = api.getCustomMaterials().filter(function (item) {
      return String(item.id) !== id;
    });

    if (!api.saveCustomMaterials(list)) return false;

    ['cover', 'audio', 'doc'].forEach(function (field) {
      var ref = material[field + 'Ref'];
      if (ref && ref.id) deleteAttachment(ref.id);
    });

    /* 同步清理浏览量、下载量增量与演示基数记录 */
    api.clearMaterialStats(id);
    return true;
  }

  function buildActionCell(material, customIds) {
    var cell = document.createElement('td');
    cell.className = 'row-actions';

    var view = document.createElement('a');
    view.href = 'detail.html?id=' + encodeURIComponent(material.id);
    view.target = '_blank';
    view.rel = 'noopener';
    view.textContent = '查看';
    cell.appendChild(view);

    var sep = document.createElement('span');
    sep.className = 'action-sep';
    sep.setAttribute('aria-hidden', 'true');
    sep.textContent = '·';
    cell.appendChild(sep);

    if (customIds[String(material.id)]) {
      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'link-action delete-action';
      remove.textContent = '删除';
      remove.addEventListener('click', function () {
        var title = material.title || '未命名素材';
        if (!window.confirm('确定要删除投稿《' + title + '》吗？对应的浏览、下载统计将同步清理。')) return;
        if (removeCustomMaterial(material)) {
          renderMaterialTable();
          updateOverviewCards();
          showAdminToast('投稿已删除，统计数据已同步清理。');
        } else {
          showAdminToast('删除失败：本地存储空间不足，请稍后重试。');
        }
      });
      cell.appendChild(remove);
    } else {
      var disabled = document.createElement('span');
      disabled.className = 'action-disabled';
      disabled.title = '原始素材以 js/data.js 为准，不可删除。';
      disabled.textContent = '删除';
      cell.appendChild(disabled);
    }

    return cell;
  }

  function renderMaterialRows(tbody) {
    var customIds = getCustomIds();
    var list = getFilteredMaterials();

    tbody.textContent = '';
    if (!list.length) {
      appendEmptyRow(tbody, 9, '没有符合条件的素材');
    } else {
      list.forEach(function (material) {
        var tr = document.createElement('tr');
        tr.setAttribute('data-id', String(material.id));

        var coverCell = document.createElement('td');
        coverCell.className = 'col-cover';
        coverCell.appendChild(createThumb(material));
        tr.appendChild(coverCell);

        var titleCell = document.createElement('td');
        var title = document.createElement('span');
        title.className = 'material-main';
        title.textContent = material.title || '未命名素材';
        titleCell.appendChild(title);
        var sub = document.createElement('span');
        sub.className = 'material-sub';
        sub.textContent = material.series || '未分类';
        titleCell.appendChild(sub);
        tr.appendChild(titleCell);

        var authorCell = document.createElement('td');
        authorCell.textContent = material.author || '—';
        tr.appendChild(authorCell);

        var locationCell = document.createElement('td');
        locationCell.className = 'cell-location';
        locationCell.textContent = material.location || '—';
        tr.appendChild(locationCell);

        var dateCell = document.createElement('td');
        dateCell.textContent = material.date || '—';
        tr.appendChild(dateCell);

        var typeCell = document.createElement('td');
        typeCell.appendChild(createTypeChips(material));
        tr.appendChild(typeCell);

        var viewsCell = document.createElement('td');
        viewsCell.className = 'col-num';
        viewsCell.textContent = String(toCount(material.views));
        tr.appendChild(viewsCell);

        var downloadsCell = document.createElement('td');
        downloadsCell.className = 'col-num';
        downloadsCell.textContent = String(toCount(material.downloads));
        tr.appendChild(downloadsCell);

        tr.appendChild(buildActionCell(material, customIds));
        tbody.appendChild(tr);
      });
    }

    setText('list-count', '共 ' + list.length + ' 条素材');
  }

  function renderMaterialTable() {
    var tbody = byId('material-tbody');
    if (!tbody) return;
    renderMaterialRows(tbody);
  }

  function updateOverviewCards() {
    var materials = getMaterials();
    var customCount = getCustomMaterials().length;
    var originalCount = materials.length - customCount;
    var views = 0;
    var downloads = 0;

    materials.forEach(function (material) {
      views += toCount(material.views);
      downloads += toCount(material.downloads);
    });

    setText('overview-total', materials.length);
    setText('overview-total-note', '原始 ' + originalCount + ' · 投稿 ' + customCount);
    setText('overview-daily', getTodayCustomCount());
    setText('overview-daily-total', materials.length);
    setText('overview-views', views);
    setText('overview-downloads', downloads);
  }

  function bindMaterialFilters() {
    var search = byId('material-search');
    var type = byId('material-type-filter');
    var sort = byId('material-sort');

    function onChange() {
      saveFilters();
      renderMaterialTable();
    }

    if (search) search.addEventListener('input', onChange);
    if (type) type.addEventListener('change', onChange);
    if (sort) sort.addEventListener('change', onChange);
  }

  /* ============================================
     附件库（IndexedDB）
     ============================================ */
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
      request.onsuccess = function () { resolve(request.result); };
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

  function saveAttachmentFile(file) {
    var record = {
      id: 'att-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
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
        '，超过单文件 20MB 上限，请压缩后重新上传。';
    }

    if (kind === 'audio') {
      var audioExt = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'webm'];
      var looksAudio = (file.type && file.type.indexOf('audio/') === 0) ||
        audioExt.indexOf(fileExtensionOf(file.name)) >= 0;
      if (!looksAudio) return '请选择音频文件（如 MP3、WAV）。';
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
      if (!looksImage) return '请选择图片文件（如 JPG、PNG）。';
    }

    return '';
  }

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

  /* ============================================
     上传素材弹窗
     ============================================ */
  var pendingCover = '';
  var pendingCoverFile = null;
  var pendingAudioFile = null;
  var pendingDocFile = null;
  var coverReading = false;
  var coverReadToken = 0;
  var uploadSaving = false;

  function showUploadError(message) {
    var node = byId('upload-error');
    if (!node) return;
    node.textContent = message;
    node.hidden = false;
  }

  function hideUploadError() {
    var node = byId('upload-error');
    if (node) node.hidden = true;
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

  function resetUploadForm() {
    var form = byId('upload-form');
    var dateInput = byId('upload-date');
    var submit = byId('upload-submit');
    if (form) form.reset();
    if (dateInput) dateInput.value = todayString();
    if (submit) {
      submit.disabled = false;
      submit.textContent = '确认上传';
    }

    pendingCover = '';
    pendingCoverFile = null;
    pendingAudioFile = null;
    pendingDocFile = null;
    coverReading = false;
    coverReadToken += 1;
    uploadSaving = false;
    clearCoverPreview();
    syncAttachmentFields();
    clearUploadErrors();
  }

  function openUploadModal() {
    var modal = byId('upload-modal');
    if (!modal) return;
    resetUploadForm();
    modal.hidden = false;
    document.body.classList.add('modal-open');
    var title = byId('upload-title');
    if (title) title.focus();
  }

  function closeUploadModal() {
    var modal = byId('upload-modal');
    if (modal) modal.hidden = true;
    document.body.classList.remove('modal-open');
    resetUploadForm();
  }

  function handleCoverChange() {
    var input = byId('upload-cover');
    var file = input && input.files ? input.files[0] : null;

    coverReadToken += 1;
    pendingCover = '';
    pendingCoverFile = null;
    coverReading = false;
    clearCoverPreview();
    clearFieldError('upload-cover', 'upload-cover-error');

    if (!file) return;

    var fileMessage = checkAttachmentFile(file, '配图', 'image');
    if (fileMessage) {
      if (input) input.value = '';
      setFieldError('upload-cover', 'upload-cover-error', fileMessage);
      return;
    }

    coverReading = true;
    coverReadToken += 1;
    var token = coverReadToken;

    compressCoverImage(file).then(function (dataUrl) {
      if (token !== coverReadToken) return;
      coverReading = false;

      if (!dataUrl) {
        setFieldError('upload-cover', 'upload-cover-error', '配图处理失败，请换一张图片重试。');
        return;
      }

      pendingCover = dataUrl;
      pendingCoverFile = file;
      showCoverPreview(dataUrl);
      clearFieldError('upload-cover', 'upload-cover-error');
    }).catch(function () {
      if (token !== coverReadToken) return;
      coverReading = false;
      setFieldError('upload-cover', 'upload-cover-error', '配图读取失败，请重新选择图片。');
    });
  }

  function handleAttachmentChange(kind) {
    var inputId = 'upload-' + kind;
    var errorId = inputId + '-error';
    var label = kind === 'audio' ? '音频附件' : '文档附件';
    var input = byId(inputId);
    var file = input && input.files ? input.files[0] : null;

    clearFieldError(inputId, errorId);
    if (kind === 'audio') pendingAudioFile = null;
    if (kind === 'doc') pendingDocFile = null;

    if (!file) return;

    var message = checkAttachmentFile(file, label, kind);
    if (message) {
      if (input) input.value = '';
      setFieldError(inputId, errorId, message);
      return;
    }

    if (kind === 'audio') pendingAudioFile = file;
    if (kind === 'doc') pendingDocFile = file;
  }

  function getUploadFormValues() {
    var form = byId('upload-form');
    var types = [];

    if (form) {
      Array.prototype.forEach.call(form.querySelectorAll('input[name="type"]:checked'), function (box) {
        types.push(box.value);
      });
    }

    var tagsInput = byId('upload-tags');
    var tags = tagsInput ? tagsInput.value.split(/[,，]/).map(function (tag) {
      return tag.trim();
    }).filter(function (tag) {
      return tag.length > 0;
    }) : [];

    var dateInput = byId('upload-date');
    var titleInput = byId('upload-title');
    var authorInput = byId('upload-author');
    var seriesInput = byId('upload-series');
    var locationInput = byId('upload-location');
    var introInput = byId('upload-intro');

    return {
      title: titleInput ? titleInput.value.trim() : '',
      author: authorInput ? authorInput.value.trim() : '',
      series: seriesInput ? seriesInput.value.trim() : '',
      date: dateInput && dateInput.value ? dateInput.value : todayString(),
      location: locationInput ? locationInput.value.trim() : '',
      intro: introInput ? introInput.value.trim() : '',
      tags: tags,
      types: types.length ? types : ['配图']
    };
  }

  function handleUploadSubmit(event) {
    event.preventDefault();
    if (uploadSaving) return;
    clearUploadErrors();

    var values = getUploadFormValues();
    var titleInput = byId('upload-title');
    var coverInput = byId('upload-cover');
    var messages = [];
    var focusTarget = null;

    if (!values.title) {
      setFieldError('upload-title', 'upload-title-error', '请填写素材标题。');
      messages.push('请填写素材标题。');
      focusTarget = titleInput;
    }

    if (!values.author) {
      messages.push('请填写供稿人。');
      if (!focusTarget) focusTarget = byId('upload-author');
    }

    if (!values.series) {
      messages.push('请填写所属系列。');
      if (!focusTarget) focusTarget = byId('upload-series');
    }

    if (!values.intro) {
      messages.push('请填写素材简介。');
      if (!focusTarget) focusTarget = byId('upload-intro');
    }

    var coverMessage = '';
    if (coverReading) {
      coverMessage = '配图正在读取，请稍候再试。';
    } else if (!pendingCover) {
      coverMessage = '请选择一张本地配图。';
    }
    if (coverMessage) {
      setFieldError('upload-cover', 'upload-cover-error', coverMessage);
      messages.push(coverMessage);
      if (!focusTarget) focusTarget = coverInput;
    }

    if (values.types.indexOf('音频') >= 0 && !pendingAudioFile) {
      setFieldError('upload-audio', 'upload-audio-error', '请选择音频文件。');
      messages.push('请选择音频文件。');
      if (!focusTarget) focusTarget = byId('upload-audio');
    }

    if (values.types.indexOf('文档') >= 0 && !pendingDocFile) {
      setFieldError('upload-doc', 'upload-doc-error', '请选择文档文件。');
      messages.push('请选择文档文件。');
      if (!focusTarget) focusTarget = byId('upload-doc');
    }

    if (messages.length) {
      showUploadError(messages.join(' '));
      if (focusTarget) focusTarget.focus();
      return;
    }

    var api = window.HongseFront;
    if (!api || typeof api.addCustomMaterial !== 'function') {
      showUploadError('数据服务未加载，请刷新页面后重试。');
      return;
    }

    uploadSaving = true;
    var submit = byId('upload-submit');
    if (submit) {
      submit.disabled = true;
      submit.textContent = '保存中…';
    }

    var coverTask = pendingCoverFile
      ? saveAttachmentFile(pendingCoverFile).catch(function () { return null; })
      : Promise.resolve(null);
    var audioTask = pendingAudioFile
      ? saveAttachmentFile(pendingAudioFile).catch(function () { return null; })
      : Promise.resolve(null);
    var docTask = pendingDocFile
      ? saveAttachmentFile(pendingDocFile).catch(function () { return null; })
      : Promise.resolve(null);

    Promise.all([coverTask, audioTask, docTask]).then(function (refs) {
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
        createdAt: new Date().toISOString(),
        views: 0,
        downloads: 0
      };

      if (refs[0]) material.coverRef = refs[0];
      if (refs[1]) material.audioRef = refs[1];
      if (refs[2]) material.docRef = refs[2];

      if (!api.addCustomMaterial(material)) {
        refs.forEach(function (ref) { if (ref) deleteAttachment(ref.id); });
        throw new Error('metadata');
      }

      uploadSaving = false;
      closeUploadModal();
      renderMaterialTable();
      updateOverviewCards();
      showAdminToast('素材已上传，素材总数已更新。');
    }).catch(function (err) {
      uploadSaving = false;
      if (submit) {
        submit.disabled = false;
        submit.textContent = '确认上传';
      }
      if (err && err.message === 'metadata') {
        showUploadError('保存失败：本地存储空间不足，请压缩配图后重试。');
      } else {
        showUploadError('附件保存失败：浏览器本地附件库不可用或空间不足。');
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
      audioInput.addEventListener('change', function () { handleAttachmentChange('audio'); });
    }

    var docInput = byId('upload-doc');
    if (docInput) {
      docInput.addEventListener('change', function () { handleAttachmentChange('doc'); });
    }

    Array.prototype.forEach.call(form.querySelectorAll('input[name="type"]'), function (box) {
      box.addEventListener('change', syncAttachmentFields);
    });

    form.addEventListener('submit', handleUploadSubmit);

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !modal.hidden) closeUploadModal();
    });
  }

  function initMaterialsPage() {
    restoreFilters();
    renderMaterialTable();
    updateOverviewCards();
    bindMaterialFilters();
    bindUploadModal();
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

  /* ============================================
     演示登录门
     注意：这是纯前端权限遮挡，密码写在源码里，
     只能用于演示，不能替代真实登录与数据安全。
     ============================================ */
  var memoryAuthed = false;

  function isAdminAuthed() {
    if (memoryAuthed) return true;
    try {
      return window.sessionStorage.getItem(ADMIN_AUTH_KEY) === '1';
    } catch (err) {
      return false;
    }
  }

  function setAdminAuthed() {
    memoryAuthed = true;
    try {
      window.sessionStorage.setItem(ADMIN_AUTH_KEY, '1');
    } catch (err) {
      /* sessionStorage 不可用时仅保留当前页面内登录状态 */
    }
  }

  function initAdminApp() {
    bindAutoRefresh();
    if (byId('material-tbody')) initMaterialsPage();
    if (byId('hot-tbody')) initDashboard();
  }

  function showLoginGate() {
    if (byId('admin-login-gate')) return;

    var gate = document.createElement('div');
    gate.id = 'admin-login-gate';
    gate.className = 'admin-login-gate';
    gate.setAttribute('role', 'dialog');
    gate.setAttribute('aria-modal', 'true');
    gate.setAttribute('aria-labelledby', 'admin-login-title');
    gate.innerHTML =
      '<div class="login-card">' +
        '<div class="login-star" aria-hidden="true">★</div>' +
        '<h1 id="admin-login-title" class="login-title">管理后台登录</h1>' +
        '<p class="login-subtitle">红色文化数字基因库</p>' +
        '<form id="admin-login-form" class="login-form" novalidate>' +
          '<label class="login-label" for="admin-password">演示密码</label>' +
          '<input id="admin-password" class="login-input" type="password" ' +
            'autocomplete="current-password" placeholder="请输入演示密码">' +
          '<p id="admin-login-error" class="login-error" role="alert" hidden>密码错误，请重新输入</p>' +
          '<button type="submit" class="btn btn-red login-submit">进入后台</button>' +
        '</form>' +
        '<p class="login-note">演示环境：仅作前端访问遮挡，不是真实安全登录</p>' +
        '<a class="login-back" href="index.html">← 返回素材社区</a>' +
      '</div>';

    document.body.appendChild(gate);

    var form = byId('admin-login-form');
    var input = byId('admin-password');
    var error = byId('admin-login-error');

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var value = input.value;

      if (value === ADMIN_DEMO_PASSWORD) {
        setAdminAuthed();
        document.body.classList.remove('admin-locked');
        gate.parentNode.removeChild(gate);
        initAdminApp();
        return;
      }

      error.hidden = false;
      error.textContent = '密码错误，请重新输入';
      input.value = '';
      input.focus();
    });

    input.addEventListener('input', function () {
      error.hidden = true;
    });

    window.setTimeout(function () {
      input.focus();
    }, 0);
  }

  function init() {
    if (isAdminAuthed()) {
      document.body.classList.remove('admin-locked');
      initAdminApp();
      return;
    }

    showLoginGate();
  }

  document.addEventListener('DOMContentLoaded', init);
})();