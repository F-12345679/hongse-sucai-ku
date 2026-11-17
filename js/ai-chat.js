/* ============================================
   AI 助手（首页 / 详情页共用）
   - 无 Key：站内关键词应答（1.5 秒思考延迟）
   - 有 Key：调用 DeepSeek，失败自动回退关键词应答
   ============================================ */
(function (global) {
  'use strict';

  var api = global.HongseFront;
  var widget = document.getElementById('ai-widget');
  if (!api || !widget || widget.getAttribute('data-ai-ready') === '1') return;
  widget.setAttribute('data-ai-ready', '1');

  var launch = document.getElementById('ai-launch');
  var panel = document.getElementById('ai-panel');
  var closeBtn = document.getElementById('ai-close');
  var form = document.getElementById('ai-form');
  var input = document.getElementById('ai-input');
  var messages = document.getElementById('ai-messages');
  var sendBtn = form ? form.querySelector('.ai-send') : null;
  if (!launch || !panel || !form || !input || !messages) return;

  var quickBox = document.getElementById('ai-quick');
  var anchored = panel.classList.contains('ai-panel--anchored');
  var settingsToggle = document.getElementById('ai-settings-toggle');
  var settingsBox = document.getElementById('ai-settings');
  var keyInput = document.getElementById('ai-key-input');
  var keySave = document.getElementById('ai-key-save');
  var keyClear = document.getElementById('ai-key-clear');
  var keyState = document.getElementById('ai-key-state');
  var statusText = document.getElementById('ai-status-text');

  var KEY_STORAGE = 'hongse_deepseek_key_v1';
  var API_URL = 'https://api.deepseek.com/chat/completions';
  var MODEL = 'deepseek-chat';
  var REQUEST_TIMEOUT = 25000;
  var KEY_DELAY = 1500;

  var started = false;
  var pendingTimer = null;
  var requestController = null;
  var requestSeq = 0;
  var busy = false;
  var history = [];

  /* ---------- 本地 API Key ---------- */
  function readKey() {
    try {
      return String(global.localStorage.getItem(KEY_STORAGE) || '').trim();
    } catch (err) {
      return '';
    }
  }

  function writeKey(value) {
    try {
      if (value) {
        global.localStorage.setItem(KEY_STORAGE, value);
      } else {
        global.localStorage.removeItem(KEY_STORAGE);
      }
      return true;
    } catch (err) {
      return false;
    }
  }

  function maskKey(key) {
    return key ? 'sk-••••' + key.slice(-4) : '';
  }

  function syncKeyState() {
    var key = readKey();
    if (keyState) {
      keyState.textContent = key
        ? '已保存：' + maskKey(key) + ' · 仅存于本机浏览器'
        : '未配置 · 当前使用站内关键词应答';
    }
    if (statusText) {
      statusText.textContent = key ? '在线 · DeepSeek' : '在线 · 站内检索';
    }
  }

  function bindSettings() {
    if (!settingsToggle || !settingsBox || !keyInput) return;

    settingsToggle.addEventListener('click', function () {
      var willOpen = settingsBox.hidden;
      settingsBox.hidden = !willOpen;
      settingsToggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      if (willOpen && !readKey()) {
        window.setTimeout(function () { keyInput.focus(); }, 40);
      }
    });

    if (keySave) {
      keySave.addEventListener('click', function () {
        var value = keyInput.value.trim();
        if (!value) {
          if (keyState) keyState.textContent = '请先粘贴 DeepSeek API Key';
          keyInput.focus();
          return;
        }
        if (!writeKey(value)) {
          if (keyState) keyState.textContent = '浏览器存储不可用，本次无法保存';
          return;
        }
        keyInput.value = '';
        syncKeyState();
      });
    }

    if (keyClear) {
      keyClear.addEventListener('click', function () {
        writeKey('');
        keyInput.value = '';
        syncKeyState();
      });
    }

    syncKeyState();
  }

  /* ---------- 素材检索 ---------- */
  function dataList() {
    return api.getAllMaterials();
  }

  function heat(item) {
    return (Number(item.views) || 0) + (Number(item.downloads) || 0) * 2;
  }

  function haystack(item) {
    return [
      item.title, item.series, item.location,
      (item.tags || []).join(' '), item.intro
    ].join(' ').toLowerCase();
  }

  function sortByHeat(list) {
    return list.slice().sort(function (a, b) {
      return heat(b) - heat(a);
    });
  }

  function search(keyword, limit) {
    var key = keyword.toLowerCase();
    return sortByHeat(dataList().filter(function (item) {
      return haystack(item).indexOf(key) !== -1;
    })).slice(0, limit);
  }

  function pickAudio(list) {
    var audioItems = list.filter(function (item) { return !!item.audio; });
    return audioItems.length ? audioItems : list;
  }

  function topHot(limit) {
    return sortByHeat(dataList()).slice(0, limit);
  }

  /* ---------- 消息渲染（只用 textContent） ---------- */
  function scrollBottom() {
    messages.scrollTop = messages.scrollHeight;
  }

  function addMessage(role, buildBody) {
    var row = document.createElement('div');
    row.className = 'ai-msg ai-msg-' + role;

    var avatar = document.createElement('span');
    avatar.className = 'ai-msg-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = role === 'user' ? '我' : '★';

    var bubble = document.createElement('div');
    bubble.className = 'ai-bubble';
    buildBody(bubble);

    row.appendChild(avatar);
    row.appendChild(bubble);
    messages.appendChild(row);
    scrollBottom();
    return bubble;
  }

  function addText(bubble, text) {
    String(text).split('\n').forEach(function (line) {
      if (!line.trim()) return;
      var p = document.createElement('p');
      p.textContent = line;
      bubble.appendChild(p);
    });
  }

  function addNotice(bubble, text) {
    var p = document.createElement('p');
    p.className = 'ai-notice';
    p.textContent = text;
    bubble.appendChild(p);
  }

  function addRecommendations(bubble, list, heading) {
    if (!list.length) return;

    var box = document.createElement('div');
    box.className = 'ai-reco';

    var title = document.createElement('p');
    title.className = 'ai-reco-title';
    title.textContent = heading || '为你推荐';
    box.appendChild(title);

    var ul = document.createElement('ul');
    ul.className = 'ai-reco-list';

    list.forEach(function (item) {
      var li = document.createElement('li');
      var link = document.createElement('a');
      link.href = 'detail.html?id=' + encodeURIComponent(item.id);

      var name = document.createElement('span');
      name.className = 'ai-reco-name';
      name.textContent = item.title;
      link.appendChild(name);

      var meta = document.createElement('span');
      meta.className = 'ai-reco-meta';
      var facts = [item.series || '未分类'];
      facts.push('浏览 ' + (Number(item.views) || 0));
      facts.push('下载 ' + (Number(item.downloads) || 0));
      facts.forEach(function (fact) {
        var piece = document.createElement('span');
        piece.textContent = fact;
        meta.appendChild(piece);
      });
      link.appendChild(meta);

      li.appendChild(link);
      ul.appendChild(li);
    });

    box.appendChild(ul);
    bubble.appendChild(box);
  }

  function addAudio(bubble, item) {
    if (!item || !item.audio) return;

    var box = document.createElement('div');
    box.className = 'ai-audio';

    var label = document.createElement('p');
    label.textContent = '试听 · ' + item.title;
    box.appendChild(label);

    var audio = document.createElement('audio');
    audio.controls = true;
    audio.preload = 'none';
    audio.src = item.audio;
    box.appendChild(audio);

    bubble.appendChild(box);
  }

  function showTyping(label) {
    removeTyping();
    var row = document.createElement('div');
    row.className = 'ai-msg ai-msg-bot';
    row.id = 'ai-typing-row';

    var avatar = document.createElement('span');
    avatar.className = 'ai-msg-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = '★';

    var bubble = document.createElement('div');
    bubble.className = 'ai-bubble';

    var typing = document.createElement('span');
    typing.className = 'ai-typing';
    typing.setAttribute('aria-label', label || 'AI 思考中');
    typing.appendChild(document.createElement('i'));
    typing.appendChild(document.createElement('i'));
    typing.appendChild(document.createElement('i'));
    bubble.appendChild(typing);

    var text = document.createElement('span');
    text.className = 'ai-thinking-text';
    text.textContent = label || 'AI 思考中';
    bubble.appendChild(text);

    row.appendChild(avatar);
    row.appendChild(bubble);
    messages.appendChild(row);
    scrollBottom();
  }

  function removeTyping() {
    var row = document.getElementById('ai-typing-row');
    if (row && row.parentNode) row.parentNode.removeChild(row);
  }

  /* ---------- 关键词应答 ---------- */
  function startReply(text, notice) {
    return function (bubble) {
      if (notice) addNotice(bubble, notice);
      fillReply(bubble, text);
    };
  }

  function fillReply(bubble, text) {
    var lower = text.toLowerCase();

    if (text.indexOf('长征') !== -1) {
      var longMarch = pickAudio(search('长征', 3));
      addText(bubble, '长征是红色素材库里最厚重的一条线索。我按馆藏热度挑了几条与长征相关的素材，其中有声素材可以直接试听、也可以进入详情页查看史料与配图。');
      addRecommendations(bubble, longMarch, '长征主题推荐');
      addAudio(bubble, longMarch[0]);
      return;
    }

    if (text.indexOf('毛泽东') !== -1) {
      var mao = pickAudio(search('毛泽东', 3));
      addText(bubble, '与毛泽东同志相关的素材，适合从声音和旧址里走近历史现场。下面这几条可以进入详情页查看完整音频与图文。');
      addRecommendations(bubble, mao, '毛泽东相关素材');
      addAudio(bubble, mao[0]);
      return;
    }

    if (text.indexOf('音频') !== -1 || text.indexOf('有声') !== -1 || text.indexOf('听') !== -1) {
      var audioAll = sortByHeat(dataList().filter(function (item) {
        return !!item.audio;
      })).slice(0, 3);
      addText(bubble, '站内可以试听的有声素材整理如下，点击条目进入详情页即可播放完整音频。');
      addRecommendations(bubble, audioAll, '可试听素材');
      addAudio(bubble, audioAll[0]);
      return;
    }

    if (text.indexOf('热门') !== -1 || text.indexOf('热度') !== -1 ||
        text.indexOf('推荐') !== -1 || text.indexOf('排行') !== -1) {
      var hot = topHot(3);
      addText(bubble, '当前馆藏热度最高的三条素材如下，热度由浏览量与下载量共同计算。');
      addRecommendations(bubble, hot, '热门素材推荐');
      return;
    }

    if (/你好|您好|在吗|hi|hello|嗨/.test(lower)) {
      addText(bubble, '你好，我是红色基因 AI 助手。\n可以问我“长征”“毛泽东”，也可以问“有哪些音频”或“热门素材”。');
      return;
    }

    addText(bubble, '我暂时没有捕捉到明确的关键词。可以试试问我“长征”“毛泽东”“音频”或“热门素材”，也可以直接说想看哪一处旧址、哪一件革命文物。先为你推荐当前馆藏热度最高的几条素材。');
    addRecommendations(bubble, topHot(3), '热门素材推荐');
  }

  function replyByKeyword(text, notice) {
    addMessage('bot', startReply(text, notice));
  }

  /* ---------- DeepSeek 接入 ---------- */
  function buildCatalog() {
    return dataList().map(function (item) {
      var intro = String(item.intro || '').replace(/\s+/g, ' ').slice(0, 48);
      return [
        item.id + '. ' + item.title,
        item.series || '未分类',
        item.location || '',
        item.date || '',
        intro
      ].join('｜');
    }).join('\n');
  }

  function buildSystemPrompt() {
    return [
      '你是“红色文化数字基因库”的站内导览助手。',
      '只能依据下面【素材目录】中的信息回答，目录里没有的内容要直说“站内暂无相关素材”，不得编造素材、人物、时间、地点或研究结论。',
      '不要声称你进行过联网检索、查阅了外部资料或完成了研究，你只能使用本站素材。',
      '回答用简体中文，语气克制，2 到 4 句；不要输出 Markdown 标题、列表符号或代码块。',
      '如果用户问到具体素材，可以点出素材标题，并说明它的系列、地点或类型。',
      '',
      '【素材目录】',
      buildCatalog()
    ].join('\n');
  }

  function abortRequest() {
    if (requestController) {
      try { requestController.abort(); } catch (err) { /* 忽略 */ }
      requestController = null;
    }
  }

  function setBusy(next) {
    busy = next;
    if (sendBtn) sendBtn.disabled = next;
  }

  function failReason(error, status) {
    if (error && error.name === 'AbortError') {
      return '模型响应超时，已切换为站内关键词检索。';
    }
    if (status === 401 || status === 403) {
      return 'API Key 无效或已过期，已切换为站内关键词检索。';
    }
    if (status === 429) {
      return '请求过于频繁，已切换为站内关键词检索。';
    }
    if (status) {
      return '模型接口暂时不可用（HTTP ' + status + '），已切换为站内关键词检索。';
    }
    return '网络连接失败，已切换为站内关键词检索。';
  }

  function findMentioned(text) {
    return sortByHeat(dataList().filter(function (item) {
      return item.title && text.indexOf(item.title) !== -1;
    })).slice(0, 4);
  }

  /* 通用 chat completions 请求：首页对话与详情页智学共用 */
  function requestCompletion(messages, controller) {
    var activeController = controller;
    if (!activeController && typeof global.AbortController === 'function') {
      activeController = new global.AbortController();
    }

    var timer = global.setTimeout(function () {
      if (activeController) {
        try { activeController.abort(); } catch (err) { /* 忽略 */ }
      }
    }, REQUEST_TIMEOUT);

    var options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + readKey()
      },
      body: JSON.stringify({
        model: MODEL,
        messages: messages,
        temperature: 0.5,
        max_tokens: 700,
        stream: false
      })
    };
    if (activeController && activeController.signal) options.signal = activeController.signal;

    return global.fetch(API_URL, options).then(function (response) {
      if (!response.ok) {
        var error = new Error('HTTP ' + response.status);
        error.status = response.status;
        throw error;
      }
      return response.json();
    }).then(function (data) {
      var choice = data && data.choices && data.choices[0];
      var text = choice && choice.message ? String(choice.message.content || '').trim() : '';
      if (!text) throw new Error('EMPTY');
      return text;
    }).then(function (text) {
      global.clearTimeout(timer);
      return text;
    }, function (error) {
      global.clearTimeout(timer);
      throw error;
    });
  }

  function askModel(text, token) {
    requestController = typeof global.AbortController === 'function' ? new global.AbortController() : null;

    var messages = [{ role: 'system', content: buildSystemPrompt() }]
      .concat(history)
      .concat([{ role: 'user', content: text }]);

    requestCompletion(messages, requestController).then(function (answer) {
      if (token !== requestSeq) return;
      abortRequest();
      setBusy(false);
      removeTyping();

      history.push({ role: 'user', content: text });
      history.push({ role: 'assistant', content: answer });
      if (history.length > 8) history = history.slice(-8);

      addMessage('bot', function (bubble) {
        addText(bubble, answer);
        addRecommendations(bubble, findMentioned(answer), '相关素材');
      });
    }).catch(function (error) {
      if (token !== requestSeq) return;
      abortRequest();
      setBusy(false);
      removeTyping();
      replyByKeyword(text, failReason(error, error.status || 0));
    });
  }

  /* ---------- 发送与开关 ---------- */
  function send() {
    var text = input.value.trim();
    if (!text || busy || studyBusy) return;

    addMessage('user', function (bubble) {
      addText(bubble, text);
    });
    input.value = '';

    if (readKey()) {
      setBusy(true);
      showTyping('AI 思考中');
      requestSeq += 1;
      askModel(text, requestSeq);
      return;
    }

    showTyping('AI 思考中');
    if (pendingTimer) global.clearTimeout(pendingTimer);
    pendingTimer = global.setTimeout(function () {
      pendingTimer = null;
      removeTyping();
      replyByKeyword(text);
    }, KEY_DELAY);
  }

  function greet() {
    if (started) return;
    started = true;
    addMessage('bot', function (bubble) {
      addText(bubble, '你好，我是红色基因 AI 助手。\n可以问我“长征”“毛泽东”，也可以问“有哪些音频”或“热门素材”，我会从素材库里为你找出对应的图文与音频素材。');
    });
  }

  /* ============================================
     详情页专属「星火智学」模式
     - 打开面板先加载 1.5 秒，再逐字输出三段解析
     - 有 Key 走模型，失败/超时回退本地素材解读
     - 首页 anchored=false，不会进入本段逻辑
     ============================================ */
  var STUDY_DELAY = 1500;
  var STUDY_HEADS = ['【历史背景】', '【精神内核】', '【星火启示】'];
  var isStudy = anchored;
  var studySeq = 0;
  var studyTimer = null;
  var studyTyper = null;
  var studyController = null;
  var studyBusy = false;
  var studyFinished = false;
  var studyPlain = '';
  var studyToastTimer = null;
  var reduceMotion = global.matchMedia
    ? global.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

  function currentMaterial() {
    var id = '';
    try {
      id = new URLSearchParams(global.location.search).get('id') || '';
    } catch (err) {
      id = '';
    }
    return id ? api.getMaterialById(id) : null;
  }

  /* 标题从页面实际节点读取，避免写死 */
  function currentTitle() {
    var node = document.getElementById('title');
    var text = node ? String(node.textContent || '').trim() : '';
    if (!text) text = String(document.title || '').split('·')[0].trim();
    return text || '本条素材';
  }

  function cleanStudyText(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function firstSentence(text, max) {
    var value = cleanStudyText(text);
    if (!value) return '';
    var cut = value.search(/[。！？!?]/);
    if (cut >= 0 && cut < max) return value.slice(0, cut + 1);
    return value.slice(0, max).replace(/[，,；;、\s]+$/, '') + '……';
  }

  function lastSentence(text, max) {
    var value = cleanStudyText(text);
    if (!value) return '';
    var parts = value.split(/[。！？!?]/).filter(function (part) { return part.trim(); });
    if (parts.length < 2) return '';
    var tail = parts[parts.length - 1].trim();
    return tail.length > max ? tail.slice(0, max) + '…' : tail;
  }

  function endSentence(text) {
    var value = String(text == null ? '' : text).trim();
    if (!value) return '';
    if (/[。！？!?]$/.test(value)) return value;
    return value.replace(/[….]+$/, '') + '。';
  }

  /* 无 Key / 调用失败：完全依据素材字段拼出三段，不添加史实细节 */
  function buildLocalStudy(material) {
    var data = material || {};
    var title = currentTitle();
    var series = cleanStudyText(data.series) || '红色文化素材库';
    var place = cleanStudyText(data.location);
    var date = cleanStudyText(data.date);
    var author = cleanStudyText(data.author);
    var tags = (data.tags || []).filter(Boolean).slice(0, 3);
    var intro = cleanStudyText(data.intro);
    var introHead = firstSentence(intro, 26);
    var introTail = lastSentence(intro, 22);
    if (introTail === introHead.replace(/……$/, '')) introTail = '';

    var lead = '关于《' + title + '》，星火智学助手为您深度解码以下背景……';

    var marked = [];
    if (date) marked.push(date);
    if (place) marked.push(place);
    var background = '《' + title + '》收录于' + series;
    if (marked.length) background += '，素材标注' + marked.join('、');
    if (author) background += '，由' + author + '整理';
    background += '。';
    if (introHead) background += '简介记载：' + endSentence(introHead);

    var core = '从' + (tags.length ? tags.join('、') : '标题与简介') + '这些线索看，素材呈现的是' +
      series + '中的红色记忆。' +
      (introTail ? '“' + introTail + '”让历史落到具体的人与事上，' : '') +
      '其精神内核在于把现场记忆转化为可讲述、可践行的共同记忆。';

    var spark = '今天重读《' + title + '》，可从' + (place ? place + '的现场' : '素材记录的现场') +
      '出发，把其中的细节与当下学习生活对照。让记忆被讲述、被践行，正是星火相传的意义。';

    return {
      lead: lead,
      sections: [
        { h: STUDY_HEADS[0], body: background },
        { h: STUDY_HEADS[1], body: core },
        { h: STUDY_HEADS[2], body: spark }
      ]
    };
  }

  function buildStudyMessages(material, title) {
    var data = material || {};
    var author = [cleanStudyText(data.author), cleanStudyText(data.authorRole)]
      .filter(Boolean).join(' ');
    var context = [
      '素材标题：' + title,
      '系列：' + (cleanStudyText(data.series) || '未标注'),
      '地点：' + (cleanStudyText(data.location) || '未标注'),
      '日期：' + (cleanStudyText(data.date) || '未标注'),
      '作者：' + (author || '未标注'),
      '标签：' + ((data.tags || []).join('、') || '未标注'),
      '简介：' + (cleanStudyText(data.intro) || '未提供')
    ].join('\n');

    var system = [
      '你是“星火智学”助手，为红色文化素材详情页生成一段拓展解析。',
      '只能依据【素材信息】中的字段与公认史实，不得编造人物、时间、地点、事件、数字或研究结论；信息不足时用概括表述，不要补造细节。',
      '严格按以下格式输出，不要使用 Markdown、列表符号、代码块或额外说明：',
      '第一行固定为：关于《素材标题》，星火智学助手为您深度解码以下背景……',
      '随后依次输出三段，每段以指定小标题开头，各 2 至 3 句：',
      '【历史背景】结合素材的时间、地点、人物、事件与简介，约 70 字。',
      '【精神内核】提炼素材所承载的精神价值，约 70 字。',
      '【星火启示】联系当代学习与行动，约 60 字。',
      '全文约 200 字，简体中文，语气克制、庄重。'
    ].join('\n');

    return [
      { role: 'system', content: system },
      { role: 'user', content: '请按指定结构解析这条素材：\n' + context }
    ];
  }

  /* 模型输出规范化；结构不完整时返回 null，交给本地生成兜底 */
  function parseStudyAnswer(text, title) {
    var raw = String(text == null ? '' : text)
      .replace(/\r/g, '')
      .replace(/```[a-zA-Z]*/g, '')
      .replace(/【\s+/g, '【')
      .replace(/\s+】/g, '】')
      .trim();
    if (!raw) return null;

    var positions = STUDY_HEADS.map(function (head) { return raw.indexOf(head); });
    if (positions[0] < 0 || positions[1] < 0 || positions[2] < 0) return null;
    if (!(positions[0] < positions[1] && positions[1] < positions[2])) return null;

    var lead = raw.slice(0, positions[0]).replace(/^[#*\-\s]+/, '').replace(/\s+/g, ' ').trim();
    if (lead.indexOf(title) === -1) {
      lead = '关于《' + title + '》，星火智学助手为您深度解码以下背景……';
    }

    var bodies = [
      raw.slice(positions[0] + STUDY_HEADS[0].length, positions[1]),
      raw.slice(positions[1] + STUDY_HEADS[1].length, positions[2]),
      raw.slice(positions[2] + STUDY_HEADS[2].length)
    ].map(function (part) {
      return part
        .replace(/^[:：\s]+/, '')
        .replace(/^[#*\-\s]+/gm, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 220);
    });

    if (!bodies[0] || !bodies[1] || !bodies[2]) return null;

    return {
      lead: lead.slice(0, 180),
      sections: STUDY_HEADS.map(function (head, index) {
        return { h: head, body: bodies[index] };
      })
    };
  }

  function showStudyLoading() {
    messages.textContent = '';
    messages.classList.add('is-study-loading');

    var box = document.createElement('div');
    box.className = 'ai-study-loading';
    box.setAttribute('role', 'status');

    var ring = document.createElement('span');
    ring.className = 'ai-study-ring';
    ring.setAttribute('aria-hidden', 'true');
    box.appendChild(ring);

    var dots = document.createElement('span');
    dots.className = 'ai-study-dots';
    dots.setAttribute('aria-hidden', 'true');
    for (var i = 0; i < 3; i += 1) dots.appendChild(document.createElement('i'));
    box.appendChild(dots);

    var text = document.createElement('p');
    text.className = 'ai-study-loading-text';
    text.textContent = 'AI 正在阅读素材，解析历史背景…';
    box.appendChild(text);

    messages.appendChild(box);
  }

  function setStudyBusy(next) {
    studyBusy = next;
    if (input) input.disabled = next;
    if (sendBtn) sendBtn.disabled = next || busy;
    if (quickBox) {
      Array.prototype.forEach.call(quickBox.querySelectorAll('.ai-quick-btn'), function (btn) {
        btn.disabled = next;
      });
    }
  }

  function clearStudyRun() {
    if (studyTimer) {
      global.clearTimeout(studyTimer);
      studyTimer = null;
    }
    if (studyTyper) {
      global.clearInterval(studyTyper);
      studyTyper = null;
    }
    if (studyController) {
      try { studyController.abort(); } catch (err) { /* 忽略 */ }
      studyController = null;
    }
    messages.classList.remove('is-study-loading');
  }

  function copyStudyText(text, done) {
    function legacyCopy() {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.top = '-1000px';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
      document.body.removeChild(area);
      done(ok);
    }

    if (global.navigator && global.navigator.clipboard &&
        typeof global.navigator.clipboard.writeText === 'function') {
      global.navigator.clipboard.writeText(text).then(function () {
        done(true);
      }, legacyCopy);
      return;
    }
    legacyCopy();
  }

  function showStudyToast(message) {
    var toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    if (studyToastTimer) global.clearTimeout(studyToastTimer);
    studyToastTimer = global.setTimeout(function () {
      toast.hidden = true;
    }, 2400);
  }

  function renderStudy(data, token) {
    if (token !== studySeq) return;
    messages.classList.remove('is-study-loading');
    messages.textContent = '';

    var leadEl = null;
    var headEls = [];
    var bodyEls = [];
    var actions = null;
    var copyBtn = null;

    addMessage('bot', function (bubble) {
      bubble.classList.add('ai-study-bubble');

      leadEl = document.createElement('p');
      leadEl.className = 'ai-study-lead';
      bubble.appendChild(leadEl);

      data.sections.forEach(function (section) {
        var wrap = document.createElement('div');
        wrap.className = 'ai-study-section';

        var head = document.createElement('p');
        head.className = 'ai-study-h';
        wrap.appendChild(head);

        var body = document.createElement('p');
        body.className = 'ai-study-p';
        wrap.appendChild(body);

        bubble.appendChild(wrap);
        headEls.push(head);
        bodyEls.push(body);
      });

      actions = document.createElement('div');
      actions.className = 'ai-study-actions';
      actions.hidden = true;

      copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'ai-study-copy';
      copyBtn.textContent = '复制学习笔记';
      actions.appendChild(copyBtn);
      bubble.appendChild(actions);
    });

    studyPlain = data.lead + '\n\n' + data.sections.map(function (section) {
      return section.h + '\n' + section.body;
    }).join('\n\n');

    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        copyStudyText(studyPlain, function (ok) {
          showStudyToast(ok ? '学习笔记已复制' : '复制失败，请手动选择文本');
        });
      });
    }

    var segments = [[leadEl, data.lead]];
    data.sections.forEach(function (section, index) {
      segments.push([headEls[index], section.h]);
      segments.push([bodyEls[index], section.body]);
    });

    function finishTyping() {
      if (token !== studySeq) return;
      if (actions) actions.hidden = false;
      studyFinished = true;
      setStudyBusy(false);
      history.push({ role: 'assistant', content: studyPlain });
      if (history.length > 8) history = history.slice(-8);
      scrollBottom();
      global.setTimeout(function () {
        if (!panel.hidden && !studyBusy) input.focus();
      }, 40);
    }

    if (reduceMotion && reduceMotion.matches) {
      segments.forEach(function (segment) {
        segment[0].textContent = segment[1];
      });
      finishTyping();
      return;
    }

    var segIndex = 0;
    var charIndex = 0;
    studyTyper = global.setInterval(function () {
      if (token !== studySeq) {
        global.clearInterval(studyTyper);
        studyTyper = null;
        return;
      }
      if (segIndex >= segments.length) {
        global.clearInterval(studyTyper);
        studyTyper = null;
        finishTyping();
        return;
      }
      var el = segments[segIndex][0];
      var text = segments[segIndex][1];
      if (charIndex < text.length) {
        charIndex += 1;
        el.textContent = text.slice(0, charIndex);
        if (charIndex % 4 === 0) scrollBottom();
      } else {
        segIndex += 1;
        charIndex = 0;
      }
    }, 16);
  }

  function startStudy() {
    studySeq += 1;
    var token = studySeq;
    clearStudyRun();
    studyFinished = false;
    studyPlain = '';
    setStudyBusy(true);
    showStudyLoading();

    var material = currentMaterial();
    var title = currentTitle();
    var local = buildLocalStudy(material);
    var startedAt = Date.now();

    function ready(data) {
      if (token !== studySeq) return;
      var remain = Math.max(0, STUDY_DELAY - (Date.now() - startedAt));
      studyTimer = global.setTimeout(function () {
        studyTimer = null;
        if (token !== studySeq) return;
        renderStudy(data, token);
      }, remain);
    }

    if (!readKey() || !material) {
      ready(local);
      return;
    }

    studyController = typeof global.AbortController === 'function'
      ? new global.AbortController()
      : null;

    requestCompletion(buildStudyMessages(material, title), studyController).then(function (text) {
      if (token !== studySeq) return;
      studyController = null;
      ready(parseStudyAnswer(text, title) || local);
    }).catch(function () {
      if (token !== studySeq) return;
      studyController = null;
      ready(local);
    });
  }

  /* 详情页形态：面板贴着触发按钮上方弹出，水平方向以按钮中心为中线 */
  function positionAnchored() {
    if (!anchored || panel.hidden) return;
    var rect = launch.getBoundingClientRect();
    var vw = document.documentElement.clientWidth;
    var vh = global.innerHeight || document.documentElement.clientHeight;
    var header = document.querySelector('.top-bar');
    var navBottom = header ? header.getBoundingClientRect().bottom : 0;
    var width = panel.offsetWidth || 372;
    var left = Math.round(rect.left + rect.width / 2 - width / 2);
    var maxLeft = Math.round(vw - width - 12);
    if (left > maxLeft) left = maxLeft;
    if (left < 12) left = 12;
    var bottom = Math.max(12, Math.round(vh - rect.top + 14));
    var maxBottom = Math.max(12, Math.round(vh - navBottom - 8 - 240));
    if (bottom > maxBottom) bottom = maxBottom;
    var maxHeight = Math.max(240, Math.round(rect.top - 14 - navBottom - 8));
    panel.style.left = left + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = bottom + 'px';
    panel.style.maxHeight = maxHeight + 'px';
  }

  function openPanel() {
    panel.hidden = false;
    positionAnchored();
    document.body.classList.add('ai-open');
    launch.setAttribute('aria-expanded', 'true');
    if (isStudy) {
      /* 详情页：首次打开/未生成完成时重新生成；已完成则保留解析与追问 */
      if (!studyFinished) {
        startStudy();
      }
    } else {
      greet();
    }
    window.setTimeout(function () {
      if (!studyBusy) input.focus();
    }, 60);
  }

  function closePanel() {
    if (pendingTimer) {
      global.clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    requestSeq += 1;
    abortRequest();
    setBusy(false);
    removeTyping();
    if (isStudy) {
      studySeq += 1;
      clearStudyRun();
      setStudyBusy(false);
    }
    panel.hidden = true;
    document.body.classList.remove('ai-open');
    launch.setAttribute('aria-expanded', 'false');
    launch.focus();
  }

  launch.addEventListener('click', function () {
    if (panel.hidden) {
      openPanel();
    } else {
      closePanel();
    }
  });

  if (closeBtn) closeBtn.addEventListener('click', closePanel);

  if (anchored) {
    global.addEventListener('scroll', positionAnchored, { passive: true });
    global.addEventListener('resize', positionAnchored);
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    send();
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !panel.hidden) closePanel();
  });

  if (quickBox) {
    quickBox.addEventListener('click', function (event) {
      var btn = event.target.closest ? event.target.closest('.ai-quick-btn') : null;
      if (!btn || studyBusy) return;
      var prompt = btn.getAttribute('data-prompt') || btn.textContent;
      input.value = String(prompt).trim();
      send();
    });
  }

  bindSettings();

  /* 供详情页「星火智学」复用同一套 Key 与请求逻辑 */
  global.HongseAI = {
    hasKey: function () { return !!readKey(); },
    getKey: readKey,
    requestCompletion: requestCompletion
  };
})(window);
