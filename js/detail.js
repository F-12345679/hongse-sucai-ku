/* ============================================
   素材详情页脚本
   detail.html?id=xxx 精确匹配，找不到不回退第一条
   ============================================ */
(function () {
  'use strict';

  var EYE_ICON = '<svg class="stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="2.4"/></svg>';
  var DOWNLOAD_ICON = '<svg class="stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M4 20h16"/></svg>';

  var api = window.HongseFront;
  var params = new URLSearchParams(window.location.search);
  var rawId = params.get('id');
  var id = rawId == null ? '' : String(rawId).trim();
  var material = id ? api.getMaterialById(id) : null;

  var content = document.getElementById('detail-content');
  var notFound = document.getElementById('not-found');
  var relatedSection = document.getElementById('related-section');
  var toastTimer = null;

  if (!material) {
    content.hidden = true;
    relatedSection.hidden = true;
    notFound.hidden = false;
    document.title = '未找到该素材 · 红色文化数字基因库';
    return;
  }

  document.title = material.title + ' · 红色文化数字基因库';

  /* 浏览量与下载量直接读取同一数据源，保证列表页与详情页展示一致 */

  function buildStatItem(icon, label, value, idSuffix) {
    var span = document.createElement('span');
    span.className = 'meta-item';
    span.innerHTML = icon;
    span.appendChild(document.createTextNode(label + ' '));
    var strong = document.createElement('b');
    strong.id = idSuffix || '';
    strong.textContent = String(value || 0);
    span.appendChild(strong);
    return span;
  }

  function renderStats() {
    var viewsNode = document.getElementById('view-count');
    var downloadsNode = document.getElementById('download-count');
    if (viewsNode) viewsNode.textContent = String(material.views || 0);
    if (downloadsNode) downloadsNode.textContent = String(material.downloads || 0);
  }

  /* 简介在卡片内滚动：按需显示上下渐隐提示 */
  function syncIntroScroll() {
    var shell = document.getElementById('intro-shell');
    var intro = document.getElementById('intro');
    if (!shell || !intro) return;

    var scrollable = intro.scrollHeight - intro.clientHeight > 2;
    shell.classList.toggle('has-scroll', scrollable);
    shell.classList.toggle('at-top', intro.scrollTop <= 1);
    shell.classList.toggle('at-bottom', !scrollable || intro.scrollTop + intro.clientHeight >= intro.scrollHeight - 2);
  }

  (function bindIntroScroll() {
    var intro = document.getElementById('intro');
    if (!intro) return;
    intro.addEventListener('scroll', syncIntroScroll, { passive: true });
    window.addEventListener('resize', syncIntroScroll);
  })();

  function renderDetail() {
    var cover = document.getElementById('cover');
    cover.src = material.cover;
    cover.alt = material.title;

    document.getElementById('title').textContent = material.title;

    var authorLine = document.getElementById('author-line');
    authorLine.textContent = '供稿人：' + (material.author || '佚名') +
      (material.authorRole ? '（' + material.authorRole + '）' : '');

    var meta = document.getElementById('detail-meta');
    meta.textContent = '';
    if (material.location) {
      var location = document.createElement('span');
      location.className = 'meta-item';
      location.textContent = '地点：' + material.location;
      meta.appendChild(location);
    }
    if (material.date) {
      var date = document.createElement('span');
      date.className = 'meta-item';
      date.textContent = '上传日期：' + material.date;
      meta.appendChild(date);
    }
    if (material.series) {
      var series = document.createElement('span');
      series.className = 'meta-item';
      series.textContent = '系列：' + material.series;
      meta.appendChild(series);
    }
    meta.appendChild(buildStatItem(EYE_ICON, '浏览量', material.views, 'view-count'));
    meta.appendChild(buildStatItem(DOWNLOAD_ICON, '下载量', material.downloads, 'download-count'));

    var tagsBox = document.getElementById('tags');
    tagsBox.textContent = '';
    (material.type || []).forEach(function (typeText) {
      var tag = document.createElement('span');
      tag.className = 'type-tag';
      tag.textContent = typeText;
      tagsBox.appendChild(tag);
    });
    (material.tags || []).forEach(function (tagText) {
      var tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = tagText;
      tagsBox.appendChild(tag);
    });

    document.getElementById('intro').textContent = material.intro || '该素材暂无详细简介。';
    window.requestAnimationFrame(syncIntroScroll);

    var sourceNode = document.getElementById('image-source');
    if (material.imageSource) {
      sourceNode.hidden = false;
      sourceNode.appendChild(document.createTextNode('图片来源：' + material.imageSource));
      if (material.imageSourceUrl) {
        var sourceLink = document.createElement('a');
        sourceLink.href = material.imageSourceUrl;
        sourceLink.target = '_blank';
        sourceLink.rel = 'noopener noreferrer';
        sourceLink.textContent = '查看原图出处';
        sourceNode.appendChild(document.createTextNode(' · '));
        sourceNode.appendChild(sourceLink);
      }
    }

    if (material.audio) {
      var audioBox = document.getElementById('audio-box');
      audioBox.hidden = false;
      document.getElementById('audio').src = material.audio;
    }

    var downloadBtn = document.getElementById('download-btn');
    if (api.canDownloadMaterial(material)) {
      downloadBtn.hidden = false;
      downloadBtn.addEventListener('click', function () {
        var result = api.incrementStat(material.id, 'downloads');
        if (result) {
          material.downloads = result.downloads;
          renderStats();
        }
        downloadBtn.disabled = true;
        downloadBtn.textContent = '正在准备…';
        api.downloadMaterial(material).then(function (res) {
          downloadBtn.disabled = false;
          downloadBtn.textContent = '下载文档';
          if (res && res.downloaded) {
            showToast('已开始下载，下载量 +1');
          } else {
            showToast('下载未完成，请稍后重试');
          }
        }).catch(function () {
          downloadBtn.disabled = false;
          downloadBtn.textContent = '下载文档';
          showToast('下载失败，请稍后重试');
        });
      });
    } else {
      var hint = document.getElementById('download-hint');
      hint.hidden = false;
      hint.textContent = '该素材暂不提供文档下载。';
    }
  }

  function showToast(message) {
    var toast = document.getElementById('toast');
    toast.textContent = message;
    toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.hidden = true;
    }, 2600);
  }

  /* ---------- 相关素材 ---------- */
  function relatedScore(current, item) {
    var score = 0;
    if (current.series && item.series === current.series) score += 3;
    var currentTags = current.tags || [];
    (item.tags || []).forEach(function (tag) {
      if (currentTags.indexOf(tag) !== -1) score += 1;
    });
    return score;
  }

  function renderRelated() {
    var all = api.getAllMaterials().filter(function (item) {
      return String(item.id) !== String(material.id);
    });

    all.sort(function (a, b) {
      var scoreDiff = relatedScore(material, b) - relatedScore(material, a);
      if (scoreDiff !== 0) return scoreDiff;
      var heatDiff = api.getHeatScore(b) - api.getHeatScore(a);
      if (heatDiff !== 0) return heatDiff;
      return String(b.date || '').localeCompare(String(a.date || ''));
    });

    var picks = all.slice(0, 3);
    if (!picks.length) {
      relatedSection.hidden = true;
      return;
    }

    var grid = document.getElementById('related-grid');
    grid.textContent = '';

    picks.forEach(function (item) {
      var card = document.createElement('article');
      card.className = 'related-card';
      card.tabIndex = 0;
      card.setAttribute('role', 'link');
      card.setAttribute('aria-label', '查看相关素材：' + item.title);

      function open() {
        window.location.href = 'detail.html?id=' + encodeURIComponent(item.id);
      }
      card.addEventListener('click', open);
      card.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
          event.preventDefault();
          open();
        }
      });

      var coverWrap = document.createElement('div');
      coverWrap.className = 'related-cover';
      var img = document.createElement('img');
      img.src = item.cover;
      img.alt = item.title;
      img.loading = 'lazy';
      coverWrap.appendChild(img);
      card.appendChild(coverWrap);

      var body = document.createElement('div');
      body.className = 'related-body';
      var title = document.createElement('h3');
      title.className = 'related-title';
      title.textContent = item.title;
      body.appendChild(title);
      var meta = document.createElement('p');
      meta.className = 'related-meta';
      meta.textContent = (item.location || '—') + ' · ' + (item.date || '—');
      body.appendChild(meta);
      card.appendChild(body);

      grid.appendChild(card);
    });

    relatedSection.hidden = false;
  }

  content.hidden = false;
  renderDetail();
  renderRelated();
})();