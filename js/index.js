/* ============================================
   素材首页脚本 · 第三阶段
   素材渲染 + 搜索筛选排序 + 本地投稿
   ============================================ */
(function () {
  'use strict';

  var FILTER_KEY = 'hongse_index_filters_v1';
  var MAX_IMAGE_BYTES = 2 * 1024 * 1024;
  var allMaterials = [];
  var seriesList = [];
  var typeList = [];
  var justAddedId = null;
  var pendingCover = '';
  var coverReadToken = 0;
  var toastTimer = null;

  var state = {
    keyword: '',
    series: 'all',
    type: 'all',
    permission: 'all',
    sort: 'date'
  };

  /* ---------- 工具函数 ---------- */
  function byDateDesc(a, b) {
    var diff = String(b.date).localeCompare(String(a.date));
    if (diff !== 0) return diff;
    return Number(b.id) - Number(a.id);
  }

  function byNumberDesc(field) {
    return function (a, b) {
      var diff = (Number(b[field]) || 0) - (Number(a[field]) || 0);
      if (diff !== 0) return diff;
      return byDateDesc(a, b);
    };
  }

  function uniqueValues(list, key) {
    var result = [];
    list.forEach(function (item) {
      var value = item[key];
      if (value && result.indexOf(value) === -1) {
        result.push(value);
      }
    });
    return result;
  }

  function uniqueTypes(list) {
    var result = [];
    list.forEach(function (item) {
      (item.type || []).forEach(function (type) {
        if (result.indexOf(type) === -1) {
          result.push(type);
        }
      });
    });
    return result;
  }

  function normalize(text) {
    return String(text == null ? '' : text).toLowerCase();
  }

  function todayString() {
    var now = new Date();
    var month = String(now.getMonth() + 1);
    var day = String(now.getDate());
    if (month.length < 2) month = '0' + month;
    if (day.length < 2) day = '0' + day;
    return now.getFullYear() + '-' + month + '-' + day;
  }

  function refreshDataSource() {
    allMaterials = window.HongseFront.getAllMaterials();
  }

  /* ---------- 筛选状态读写 ---------- */
  function saveState() {
    try {
      sessionStorage.setItem(FILTER_KEY, JSON.stringify(state));
    } catch (err) {
      /* sessionStorage 不可用时忽略，不影响页面使用 */
    }
  }

  function loadState() {
    var raw;
    try {
      raw = sessionStorage.getItem(FILTER_KEY);
    } catch (err) {
      raw = null;
    }
    if (!raw) return;

    var saved;
    try {
      saved = JSON.parse(raw);
    } catch (err) {
      return;
    }
    if (!saved || typeof saved !== 'object') return;

    if (typeof saved.keyword === 'string') state.keyword = saved.keyword;
    if (saved.series && (saved.series === 'all' || seriesList.indexOf(saved.series) !== -1)) {
      state.series = saved.series;
    }
    if (saved.type && (saved.type === 'all' || typeList.indexOf(saved.type) !== -1)) {
      state.type = saved.type;
    }
    if (saved.permission === 'all' || saved.permission === 'public') {
      state.permission = saved.permission;
    }
    if (saved.sort === 'date' || saved.sort === 'views' || saved.sort === 'downloads') {
      state.sort = saved.sort;
    }
  }

  function syncControls() {
    document.getElementById('search-input').value = state.keyword;
    document.getElementById('filter-series').value = state.series;
    document.getElementById('filter-type').value = state.type;
    document.getElementById('filter-permission').value = state.permission;
    document.getElementById('filter-sort').value = state.sort;

    var tabs = document.querySelectorAll('.series-tab');
    Array.prototype.forEach.call(tabs, function (tab) {
      tab.classList.toggle('active', tab.dataset.series === state.series);
    });
  }

  /* ---------- 渲染筛选项、系列标签、系列候选 ---------- */
  function renderFilterOptions() {
    seriesList = uniqueValues(allMaterials, 'series');
    typeList = uniqueTypes(allMaterials);

    var seriesSelect = document.getElementById('filter-series');
    seriesSelect.textContent = '';

    var allSeries = document.createElement('option');
    allSeries.value = 'all';
    allSeries.textContent = '全部系列';
    seriesSelect.appendChild(allSeries);

    seriesList.forEach(function (series) {
      var option = document.createElement('option');
      option.value = series;
      option.textContent = series;
      seriesSelect.appendChild(option);
    });

    var typeSelect = document.getElementById('filter-type');
    typeSelect.textContent = '';

    var allTypes = document.createElement('option');
    allTypes.value = 'all';
    allTypes.textContent = '全部类型';
    typeSelect.appendChild(allTypes);

    typeList.forEach(function (type) {
      var option = document.createElement('option');
      option.value = type;
      option.textContent = type;
      typeSelect.appendChild(option);
    });
  }

  function renderSeriesTabs() {
    var container = document.getElementById('series-tabs');
    container.textContent = '';

    var allTab = document.createElement('button');
    allTab.type = 'button';
    allTab.className = 'series-tab';
    allTab.dataset.series = 'all';
    allTab.appendChild(document.createTextNode('全部素材'));
    var allCount = document.createElement('span');
    allCount.className = 'series-count';
    allCount.textContent = allMaterials.length;
    allTab.appendChild(allCount);
    container.appendChild(allTab);

    seriesList.forEach(function (series) {
      var count = allMaterials.filter(function (item) {
        return item.series === series;
      }).length;

      var tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'series-tab';
      tab.dataset.series = series;
      tab.appendChild(document.createTextNode(series));
      var countEl = document.createElement('span');
      countEl.className = 'series-count';
      countEl.textContent = count;
      tab.appendChild(countEl);
      container.appendChild(tab);
    });
  }

  function populateSeriesOptions() {
    var datalist = document.getElementById('series-options');
    if (!datalist) return;
    datalist.textContent = '';
    seriesList.forEach(function (series) {
      var option = document.createElement('option');
      option.value = series;
      datalist.appendChild(option);
    });
  }

  /* ---------- 最新素材提示 ---------- */
  function renderLatest() {
    var link = document.getElementById('latest-link');
    if (!allMaterials.length) {
      link.textContent = '暂无素材';
      link.removeAttribute('href');
      return;
    }

    var latest = allMaterials.slice().sort(byDateDesc)[0];
    link.href = 'detail.html?id=' + encodeURIComponent(latest.id);
    link.textContent = '《' + latest.title + '》 · ' + latest.author + ' · ' + latest.date;
  }

  /* ---------- 搜索、筛选、排序 ---------- */
  function matchKeyword(material, keyword) {
    if (!keyword) return true;
    var haystack = [
      material.title,
      material.author,
      material.location,
      material.series,
      (material.tags || []).join(' '),
      material.intro
    ].map(normalize).join(' ');
    return haystack.indexOf(keyword) !== -1;
  }

  function filterMaterials() {
    var keyword = normalize(state.keyword.trim());

    return allMaterials.filter(function (material) {
      if (!matchKeyword(material, keyword)) return false;

      if (state.series !== 'all' && material.series !== state.series) return false;

      if (state.type !== 'all' && (material.type || []).indexOf(state.type) === -1) return false;

      /* 当前没有账号权限体系，全部素材均按公开素材处理 */
      if (state.permission === 'public' && material.permission && material.permission !== 'public') {
        return false;
      }

      return true;
    });
  }

  function sortMaterials(list) {
    var sorted = list.slice();
    if (state.sort === 'views') {
      sorted.sort(byNumberDesc('views'));
    } else if (state.sort === 'downloads') {
      sorted.sort(byNumberDesc('downloads'));
    } else {
      sorted.sort(byDateDesc);
    }

    if (justAddedId != null) {
      var index = -1;
      for (var i = 0; i < sorted.length; i += 1) {
        if (String(sorted[i].id) === String(justAddedId)) {
          index = i;
          break;
        }
      }
      if (index > 0) {
        sorted.unshift(sorted.splice(index, 1)[0]);
      }
    }

    return sorted;
  }

  /* ---------- 卡片渲染 ---------- */
  function buildTag(tagText) {
    var tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = tagText;
    return tag;
  }

  function buildCard(material) {
    var card = document.createElement('article');
    card.className = 'card material-card';
    card.tabIndex = 0;
    card.setAttribute('role', 'link');
    card.setAttribute('aria-label', '查看素材：' + material.title);

    function openDetail() {
      saveState();
      window.location.href = 'detail.html?id=' + encodeURIComponent(material.id);
    }

    card.addEventListener('click', openDetail);
    card.addEventListener('keydown', function (event) {
      if (event.target !== card) return;
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
        event.preventDefault();
        openDetail();
      }
    });

    var cover = document.createElement('img');
    cover.className = 'cover';
    cover.src = material.cover;
    cover.alt = material.title;
    cover.loading = 'lazy';
    card.appendChild(cover);

    var info = document.createElement('div');
    info.className = 'info';

    var series = document.createElement('span');
    series.className = 'card-series';
    series.textContent = material.series || '未分类';
    info.appendChild(series);

    var title = document.createElement('div');
    title.className = 'card-title';
    title.textContent = material.title;
    info.appendChild(title);

    var tags = document.createElement('div');
    tags.className = 'tags';
    (material.tags || []).forEach(function (tagText) {
      tags.appendChild(buildTag(tagText));
    });
    info.appendChild(tags);

    var meta = document.createElement('div');
    meta.className = 'meta';

    var views = document.createElement('span');
    views.textContent = '浏览 ' + (material.views || 0);
    meta.appendChild(views);

    var downloads = document.createElement('span');
    downloads.textContent = '下载 ' + (material.downloads || 0);
    meta.appendChild(downloads);

    var api = window.HongseFront;
    var canDownload = api && typeof api.canDownloadMaterial === 'function'
      ? api.canDownloadMaterial(material)
      : !!material.doc;
    if (canDownload) {
      var downloadBtn = document.createElement('button');
      downloadBtn.type = 'button';
      downloadBtn.className = 'card-download';
      downloadBtn.textContent = '下载';
      downloadBtn.setAttribute('aria-label', '下载素材：' + material.title);
      downloadBtn.addEventListener('click', function (event) {
        event.stopPropagation();
        var entry = api && typeof api.incrementStat === 'function'
          ? api.incrementStat(material.id, 'downloads', material.downloads)
          : null;
        if (entry) {
          material.downloads = entry.downloads;
          downloads.textContent = '下载 ' + entry.downloads;
        }
        if (api && typeof api.downloadMaterial === 'function') {
          api.downloadMaterial(material);
        }
      });
      meta.appendChild(downloadBtn);
    }

    info.appendChild(meta);
    card.appendChild(info);

    return card;
  }

  function renderResults() {
    var grid = document.getElementById('material-grid');
    var emptyState = document.getElementById('empty-state');
    var resultCount = document.getElementById('result-count');

    var results = sortMaterials(filterMaterials());

    grid.textContent = '';
    results.forEach(function (material) {
      grid.appendChild(buildCard(material));
    });

    resultCount.textContent = '共 ' + results.length + ' 条素材';
    emptyState.hidden = results.length !== 0;
  }

  function update() {
    syncControls();
    renderResults();
    saveState();
  }

  /* ---------- 投稿弹窗 ---------- */
  function showFormError(message) {
    var error = document.getElementById('form-error');
    error.textContent = message;
    error.hidden = false;
  }

  function hideFormError() {
    document.getElementById('form-error').hidden = true;
  }

  function clearCover() {
    coverReadToken += 1;
    pendingCover = '';
    var wrap = document.getElementById('cover-preview-wrap');
    var preview = document.getElementById('cover-preview');
    wrap.hidden = true;
    preview.removeAttribute('src');
  }

  function resetForm() {
    document.getElementById('submit-form').reset();
    document.getElementById('field-date').value = todayString();
    clearCover();
    hideFormError();
  }

  function openModal() {
    resetForm();
    document.getElementById('submit-modal').hidden = false;
    document.body.classList.add('modal-open');
    document.getElementById('field-title').focus();
  }

  function closeModal() {
    document.getElementById('submit-modal').hidden = true;
    document.body.classList.remove('modal-open');
    resetForm();
  }

  function showToast(message) {
    var toast = document.getElementById('toast');
    toast.textContent = message;
    toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.hidden = true;
    }, 3000);
  }

  function handleCoverChange(input) {
    var file = input.files && input.files[0];
    var preview = document.getElementById('cover-preview');
    var wrap = document.getElementById('cover-preview-wrap');

    coverReadToken += 1;
    var token = coverReadToken;
    pendingCover = '';
    wrap.hidden = true;
    preview.removeAttribute('src');

    if (!file) return;

    if (!/^image\//.test(file.type)) {
      input.value = '';
      showFormError('请选择图片文件（如 JPG、PNG）。');
      return;
    }

    if (file.size > MAX_IMAGE_BYTES) {
      input.value = '';
      showFormError('图片过大（超过 2MB），请压缩后重新选择。');
      return;
    }

    var reader = new FileReader();
    reader.onload = function () {
      if (token !== coverReadToken) return;
      var result = reader.result;
      if (typeof result !== 'string' || !result) {
        showFormError('图片读取失败，请重新选择。');
        return;
      }
      pendingCover = result;
      preview.src = result;
      wrap.hidden = false;
      hideFormError();
    };
    reader.onerror = function () {
      if (token !== coverReadToken) return;
      pendingCover = '';
      input.value = '';
      showFormError('图片读取失败，请重新选择。');
    };
    reader.readAsDataURL(file);
  }

  function handleSubmit(event) {
    event.preventDefault();
    hideFormError();

    var titleInput = document.getElementById('field-title');
    var authorInput = document.getElementById('field-author');
    var seriesInput = document.getElementById('field-series');
    var introInput = document.getElementById('field-intro');
    var dateInput = document.getElementById('field-date');
    var locationInput = document.getElementById('field-location');
    var tagsInput = document.getElementById('field-tags');
    var coverInput = document.getElementById('field-cover');

    var title = titleInput.value.trim();
    var author = authorInput.value.trim();
    var series = seriesInput.value.trim();
    var intro = introInput.value.trim();
    var date = dateInput.value || todayString();
    var location = locationInput.value.trim();
    var tags = tagsInput.value.split(/[,，]/).map(function (tag) {
      return tag.trim();
    }).filter(function (tag) {
      return tag.length > 0;
    });

    if (!title) {
      showFormError('请填写素材标题。');
      titleInput.focus();
      return;
    }
    if (!author) {
      showFormError('请填写供稿人。');
      authorInput.focus();
      return;
    }
    if (!series) {
      showFormError('请填写所属系列。');
      seriesInput.focus();
      return;
    }
    if (!intro) {
      showFormError('请填写素材简介。');
      introInput.focus();
      return;
    }
    if (!pendingCover && !(coverInput.files && coverInput.files[0])) {
      showFormError('请选择一张本地配图。');
      coverInput.focus();
      return;
    }
    if (!pendingCover) {
      showFormError('配图仍在读取或读取失败，请重新选择图片。');
      coverInput.focus();
      return;
    }

    var material = {
      id: window.HongseFront.nextCustomId(),
      title: title,
      author: author,
      authorRole: '',
      location: location,
      date: date,
      series: series,
      tags: tags,
      type: ['配图'],
      intro: intro,
      cover: pendingCover,
      audio: '',
      doc: '',
      views: 0,
      downloads: 0
    };

    if (!window.HongseFront.addCustomMaterial(material)) {
      showFormError('保存失败：本地存储空间不足。请选择更小的图片，或清理本地投稿后重试。');
      return;
    }

    closeModal();

    refreshDataSource();
    renderFilterOptions();
    renderSeriesTabs();
    populateSeriesOptions();
    renderLatest();

    state.keyword = '';
    state.series = 'all';
    state.type = 'all';
    state.permission = 'all';
    state.sort = 'date';
    document.getElementById('search-input').value = '';
    justAddedId = material.id;
    update();

    showToast('投稿成功，已加入素材首页');
  }

  /* ---------- 事件绑定 ---------- */
  function bindEvents() {
    var searchInput = document.getElementById('search-input');

    function doSearch() {
      justAddedId = null;
      state.keyword = searchInput.value.trim();
      update();
    }

    document.getElementById('search-btn').addEventListener('click', doSearch);
    searchInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        doSearch();
      }
    });

    document.getElementById('filter-series').addEventListener('change', function () {
      justAddedId = null;
      state.keyword = searchInput.value.trim();
      state.series = this.value;
      update();
    });

    document.getElementById('filter-type').addEventListener('change', function () {
      justAddedId = null;
      state.keyword = searchInput.value.trim();
      state.type = this.value;
      update();
    });

    document.getElementById('filter-permission').addEventListener('change', function () {
      justAddedId = null;
      state.keyword = searchInput.value.trim();
      state.permission = this.value;
      update();
    });

    document.getElementById('filter-sort').addEventListener('change', function () {
      justAddedId = null;
      state.keyword = searchInput.value.trim();
      state.sort = this.value;
      update();
    });

    document.getElementById('series-tabs').addEventListener('click', function (event) {
      var tab = event.target.closest('.series-tab');
      if (!tab) return;
      justAddedId = null;
      state.keyword = searchInput.value.trim();
      state.series = tab.dataset.series;
      update();
    });

    document.getElementById('reset-btn').addEventListener('click', function () {
      justAddedId = null;
      state.keyword = '';
      state.series = 'all';
      state.type = 'all';
      state.permission = 'all';
      state.sort = 'date';
      searchInput.value = '';
      update();
    });

    document.getElementById('latest-link').addEventListener('click', function () {
      saveState();
    });

    document.getElementById('submit-btn').addEventListener('click', openModal);
    document.getElementById('nav-submit').addEventListener('click', openModal);
  }

  function bindModal() {
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-cancel').addEventListener('click', closeModal);

    Array.prototype.forEach.call(document.querySelectorAll('[data-close-modal]'), function (el) {
      el.addEventListener('click', closeModal);
    });

    document.getElementById('field-cover').addEventListener('change', function () {
      handleCoverChange(this);
    });

    document.getElementById('submit-form').addEventListener('submit', handleSubmit);

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !document.getElementById('submit-modal').hidden) {
        closeModal();
      }
    });
  }

  /* ---------- 初始化 ---------- */
  refreshDataSource();
  renderFilterOptions();
  renderSeriesTabs();
  populateSeriesOptions();
  loadState();
  syncControls();
  renderLatest();
  renderResults();
  bindEvents();
  bindModal();

  /* 从详情页后退时若页面来自 bfcache，重新读取统计数据并保持筛选状态 */
  window.addEventListener('pageshow', function (event) {
    if (!event.persisted) return;
    refreshDataSource();
    renderFilterOptions();
    renderSeriesTabs();
    populateSeriesOptions();
    renderLatest();
    update();
  });
})();