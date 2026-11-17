/* ============================================
   素材首页脚本
   多字段检索 + 相关度排序 + 热度 TOP5 + 素材墙
   ============================================ */
(function () {
  'use strict';

  var FILTER_KEY = 'hongse_index_filters_v1';
  var MAX_IMAGE_BYTES = 2 * 1024 * 1024;
  var EYE_ICON = '<svg class="stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="2.4"/></svg>';
  var DOWNLOAD_ICON = '<svg class="stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M4 20h16"/></svg>';

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
    sort: 'relevance'
  };

  /* ---------- 工具函数 ---------- */
  function normalize(text) {
    return String(text == null ? '' : text).trim().toLowerCase();
  }

  function todayString() {
    var now = new Date();
    var month = String(now.getMonth() + 1);
    var day = String(now.getDate());
    if (month.length < 2) month = '0' + month;
    if (day.length < 2) day = '0' + day;
    return now.getFullYear() + '-' + month + '-' + day;
  }

  function byDateDesc(a, b) {
    var diff = String(b.date || '').localeCompare(String(a.date || ''));
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

  function heatOf(material) {
    return (Number(material.views) || 0) + (Number(material.downloads) || 0) * 2;
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

  function refreshDataSource() {
    allMaterials = window.HongseFront.getAllMaterials();
  }

  function goDetail(id) {
    saveState();
    window.location.href = 'detail.html?id=' + encodeURIComponent(id);
  }

  /* ---------- 筛选状态读写（localStorage 持久化） ---------- */
  function saveState() {
    try {
      window.localStorage.setItem(FILTER_KEY, JSON.stringify(state));
    } catch (err) {
      /* 本地存储不可用时忽略，不影响页面使用 */
    }
  }

  function loadState() {
    var raw;
    try {
      raw = window.localStorage.getItem(FILTER_KEY);
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
  }

  function syncControls() {
    document.getElementById('search-input').value = state.keyword;
    document.getElementById('filter-series').value = state.series;
    document.getElementById('filter-type').value = state.type;
    document.getElementById('filter-sort').value = state.sort;

    var tabs = document.querySelectorAll('.series-tab');
    Array.prototype.forEach.call(tabs, function (tab) {
      tab.classList.toggle('active', tab.dataset.series === state.series);
    });
  }

  function resetState() {
    justAddedId = null;
    state.keyword = '';
    state.series = 'all';
    state.type = 'all';
    state.sort = 'relevance';
    document.getElementById('search-input').value = '';
  }

  /* ---------- 渲染筛选项、系列标签 ---------- */
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

  /* ---------- 多字段检索：标题 > 标签/系列 > 作者/地点 > 简介 ---------- */
  function relevanceScore(material, keyword) {
    if (!keyword) return 0;

    var score = 0;
    if (normalize(material.title).indexOf(keyword) !== -1) score += 100;
    if (normalize((material.tags || []).join(' ')).indexOf(keyword) !== -1) score += 60;
    if (normalize(material.series).indexOf(keyword) !== -1) score += 55;
    if (normalize(material.author).indexOf(keyword) !== -1) score += 42;
    if (normalize(material.authorRole).indexOf(keyword) !== -1) score += 36;
    if (normalize(material.location).indexOf(keyword) !== -1) score += 34;
    if (normalize((material.type || []).join(' ')).indexOf(keyword) !== -1) score += 22;
    if (normalize(material.intro).indexOf(keyword) !== -1) score += 12;
    return score;
  }

  function filterMaterials() {
    var keyword = normalize(state.keyword);

    return allMaterials.filter(function (material) {
      if (keyword && relevanceScore(material, keyword) === 0) return false;
      if (state.series !== 'all' && material.series !== state.series) return false;
      if (state.type !== 'all' && (material.type || []).indexOf(state.type) === -1) return false;
      return true;
    });
  }

  function sortMaterials(list) {
    var sorted = list.slice();
    var keyword = normalize(state.keyword);

    if (state.sort === 'views') {
      sorted.sort(byNumberDesc('views'));
    } else if (state.sort === 'downloads') {
      sorted.sort(byNumberDesc('downloads'));
    } else if (state.sort === 'relevance') {
      sorted.sort(function (a, b) {
        return relevanceScore(b, keyword) - relevanceScore(a, keyword);
      });
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

  /* ---------- 公共小组件 ---------- */
  function buildTag(tagText, className) {
    var tag = document.createElement('span');
    tag.className = className || 'tag';
    tag.textContent = tagText;
    return tag;
  }

  function buildStats(views, downloads, className) {
    var wrap = document.createElement('div');
    wrap.className = className || 'stats-line';

    var viewSpan = document.createElement('span');
    viewSpan.className = 'stat-item';
    viewSpan.innerHTML = EYE_ICON;
    viewSpan.appendChild(document.createTextNode('浏览 ' + (views || 0)));
    wrap.appendChild(viewSpan);

    var downloadSpan = document.createElement('span');
    downloadSpan.className = 'stat-item';
    downloadSpan.innerHTML = DOWNLOAD_ICON;
    downloadSpan.appendChild(document.createTextNode('下载 ' + (downloads || 0)));
    wrap.appendChild(downloadSpan);

    return wrap;
  }

  function shortIntro(text, length) {
    var value = String(text || '').replace(/\s+/g, ' ').trim();
    if (value.length <= length) return value;
    return value.slice(0, length) + '……';
  }

  function buildRankBadge(rank) {
    var badge = document.createElement('span');
    badge.className = 'rank-badge' + (rank === 1 ? ' rank-gold' : '');
    badge.textContent = 'TOP ' + rank;
    return badge;
  }

  function attachOpenHandler(node, id) {
    node.tabIndex = 0;
    node.setAttribute('role', 'link');
    node.addEventListener('click', function () {
      goDetail(id);
    });
    node.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
        event.preventDefault();
        goDetail(id);
      }
    });
  }

  /* ---------- 热度 TOP5 ---------- */
  function buildTop5Main(material) {
    var card = document.createElement('article');
    card.className = 'top5-main';
    attachOpenHandler(card, material.id);
    card.setAttribute('aria-label', '热度第一名：' + material.title);

    var coverWrap = document.createElement('div');
    coverWrap.className = 'top5-main-cover';
    var cover = document.createElement('img');
    cover.src = material.cover;
    cover.alt = material.title;
    coverWrap.appendChild(cover);
    coverWrap.appendChild(buildRankBadge(1));
    card.appendChild(coverWrap);

    var body = document.createElement('div');
    body.className = 'top5-main-body';

    var title = document.createElement('h3');
    title.className = 'top5-main-title';
    title.textContent = material.title;
    body.appendChild(title);

    var intro = document.createElement('p');
    intro.className = 'top5-main-intro';
    intro.textContent = shortIntro(material.intro, 130);
    body.appendChild(intro);

    var location = document.createElement('p');
    location.className = 'top5-main-location';
    location.textContent = '地点：' + (material.location || '—');
    body.appendChild(location);

    body.appendChild(buildStats(material.views, material.downloads, 'stats-line top5-main-stats'));
    card.appendChild(body);

    return card;
  }

  function buildTop5Mini(material, rank) {
    var card = document.createElement('article');
    card.className = 'top5-mini ' + (rank === 2 || rank === 4 ? 'top5-mini--near' : 'top5-mini--far');
    attachOpenHandler(card, material.id);
    card.setAttribute('aria-label', '热度第' + rank + '名：' + material.title);

    var coverWrap = document.createElement('div');
    coverWrap.className = 'top5-mini-cover';
    var cover = document.createElement('img');
    cover.src = material.cover;
    cover.alt = material.title;
    cover.loading = 'lazy';
    coverWrap.appendChild(cover);
    coverWrap.appendChild(buildRankBadge(rank));
    card.appendChild(coverWrap);

    var body = document.createElement('div');
    body.className = 'top5-mini-body';

    var title = document.createElement('h3');
    title.className = 'top5-mini-title';
    title.textContent = material.title;
    body.appendChild(title);

    var intro = document.createElement('p');
    intro.className = 'top5-mini-intro';
    intro.textContent = shortIntro(material.intro, 46);
    body.appendChild(intro);

    var location = document.createElement('p');
    location.className = 'top5-mini-location';
    location.textContent = '地点：' + (material.location || '—');
    body.appendChild(location);

    body.appendChild(buildStats(material.views, material.downloads, 'stats-line top5-mini-stats'));
    card.appendChild(body);

    return card;
  }

  function renderTop5() {
    var left = document.getElementById('top5-left');
    var center = document.getElementById('top5-center');
    var right = document.getElementById('top5-right');
    if (!left || !center || !right) return;

    left.textContent = '';
    center.textContent = '';
    right.textContent = '';

    var top = allMaterials.slice().sort(function (a, b) {
      var diff = heatOf(b) - heatOf(a);
      if (diff !== 0) return diff;
      return byDateDesc(a, b);
    }).slice(0, 5);

    if (!top.length) {
      var empty = document.createElement('p');
      empty.className = 'top5-empty';
      empty.textContent = '暂无素材，敬请期待。';
      center.appendChild(empty);
      return;
    }

    center.appendChild(buildTop5Main(top[0]));
    if (top[1]) left.appendChild(buildTop5Mini(top[1], 2));
    if (top[2]) left.appendChild(buildTop5Mini(top[2], 3));
    if (top[3]) right.appendChild(buildTop5Mini(top[3], 4));
    if (top[4]) right.appendChild(buildTop5Mini(top[4], 5));
  }

  /* ---------- 全部素材卡片 ---------- */
  function buildCard(material) {
    var card = document.createElement('article');
    card.className = 'card material-card';
    attachOpenHandler(card, material.id);
    card.setAttribute('aria-label', '查看素材：' + material.title);

    var coverWrap = document.createElement('div');
    coverWrap.className = 'cover-wrap';
    var cover = document.createElement('img');
    cover.className = 'cover';
    cover.src = material.cover;
    cover.alt = material.title;
    cover.loading = 'lazy';
    coverWrap.appendChild(cover);
    card.appendChild(coverWrap);

    var info = document.createElement('div');
    info.className = 'info';

    var title = document.createElement('h3');
    title.className = 'card-title';
    title.textContent = material.title;
    info.appendChild(title);

    var author = document.createElement('p');
    author.className = 'card-author';
    author.textContent = (material.author || '佚名') +
      (material.authorRole ? ' · ' + material.authorRole : '');
    info.appendChild(author);

    var location = document.createElement('p');
    location.className = 'card-meta-line';
    location.textContent = '地点：' + (material.location || '—');
    info.appendChild(location);

    var date = document.createElement('p');
    date.className = 'card-meta-line';
    date.textContent = '上传日期：' + (material.date || '—');
    info.appendChild(date);

    var tags = document.createElement('div');
    tags.className = 'tags';
    (material.type || []).forEach(function (typeText) {
      tags.appendChild(buildTag(typeText, 'type-tag'));
    });
    (material.tags || []).slice(0, 3).forEach(function (tagText) {
      tags.appendChild(buildTag(tagText));
    });
    info.appendChild(tags);

    var stats = buildStats(material.views, material.downloads);
    stats.classList.add('card-stats');
    info.appendChild(stats);

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
    syncSearchLayout();
    renderTop5();
    renderResults();
    saveState();
  }

  /* 副标题左端对齐到标题「基」字左缘；空间不足时退回标题右缘对齐 */
  function alignHeroSignature() {
    var title = document.getElementById('hero-title');
    var heading = document.querySelector('.hero-heading');
    var sub = document.querySelector('.hero-heading .hero-subtitle-main');
    if (!title || !heading || !sub) return;

    var cs = window.getComputedStyle(title);
    var fs = parseFloat(cs.fontSize) || 0;
    var ls = cs.letterSpacing === 'normal' ? 0 : parseFloat(cs.letterSpacing) || 0;
    var padLeft = parseFloat(cs.paddingLeft) || 0;
    var padRight = parseFloat(cs.paddingRight) || 0;
    var headingRect = heading.getBoundingClientRect();
    var subWidth = sub.getBoundingClientRect().width;

    var left = padLeft + 6 * (fs + ls);
    var room = document.documentElement.clientWidth - 16 - headingRect.left;
    if (left + subWidth > room) {
      left = Math.max(0, headingRect.width - padRight - subWidth);
    }
    sub.style.left = left + 'px';
  }

  /* 关键词搜索时让出 TOP5 区块，由结果栅格接管 */
  function syncSearchLayout() {
    var searching = !!(state.keyword && state.keyword.trim());
    document.getElementById('top5-section').hidden = searching;
  }

  /* 搜索胶囊吸附：仅胶囊浮在导航下方，原位用等高占位撑住，避免跳动 */
  function bindStickySearch() {
    var dock = document.getElementById('search-dock');
    var spacer = document.getElementById('search-dock-spacer');
    var header = document.querySelector('.top-bar');
    if (!dock || !spacer || !header) return;

    var GAP = 18;
    var ticking = false;

    function syncTop() {
      document.documentElement.style.setProperty('--sticky-search-top', header.offsetHeight + 'px');
    }

    function isStuck() {
      return dock.classList.contains('is-stuck');
    }

    function check() {
      ticking = false;
      var limit = header.offsetHeight + GAP;
      if (!isStuck()) {
        if (dock.getBoundingClientRect().top <= limit) {
          spacer.style.height = dock.offsetHeight + 'px';
          dock.classList.add('is-stuck');
        }
      } else if (spacer.getBoundingClientRect().top > limit + 1) {
        dock.classList.remove('is-stuck');
        spacer.style.height = '0px';
      }
    }

    function onScroll() {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(check);
    }

    syncTop();
    check();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', function () {
      syncTop();
      if (isStuck()) spacer.style.height = dock.offsetHeight + 'px';
      check();
    });
    window.addEventListener('load', function () {
      syncTop();
      check();
    });
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
      createdAt: new Date().toISOString(),
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

    resetState();
    justAddedId = material.id;
    update();

    showToast('投稿成功，已加入素材首页');
  }

  /* ---------- 事件绑定 ---------- */
  function bindEvents() {
    var searchInput = document.getElementById('search-input');
    var searchForm = document.getElementById('search-form');

    function applySearch() {
      justAddedId = null;
      state.keyword = searchInput.value.trim();
      update();
    }

    searchForm.addEventListener('submit', function (event) {
      event.preventDefault();
      applySearch();
    });

    searchInput.addEventListener('input', function () {
      if (searchInput.value.trim() || !state.keyword) return;
      justAddedId = null;
      state.keyword = '';
      update();
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

    function resetAll() {
      resetState();
      update();
    }

    document.getElementById('reset-btn').addEventListener('click', resetAll);
    document.getElementById('empty-reset').addEventListener('click', resetAll);

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
  renderTop5();
  renderResults();
  syncSearchLayout();
  bindEvents();
  bindModal();
  bindStickySearch();
  alignHeroSignature();
  window.addEventListener('resize', alignHeroSignature);
  window.addEventListener('load', alignHeroSignature);

  /* 从详情页返回时重新读取统计与筛选状态 */
  window.addEventListener('pageshow', function () {
    refreshDataSource();
    renderFilterOptions();
    renderSeriesTabs();
    populateSeriesOptions();
    loadState();
    update();
  });
})();