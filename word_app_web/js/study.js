/**
 * 学习模块 - 学习流程、卡片渲染、TTS、滑动手势
 */

// ============== 学习状态 ==============
let lastRenderedIndex = -1;
let sessionStats = { total: 0, mastered: 0, struggled: 0, forgot: 0 };
let reviewSource = 'selected';
let intensiveMode = false;
let spellInputHandler = null;
let touchStartX = 0, touchStartY = 0, touchDiffX = 0;
let swipeAbortController = null;

// ============== 学习入口 ==============
function startStudy(mode) {
  WordApp.state.studyMode = mode;
  intensiveMode = false;
  showFullscreenPage('study');
}

// 今日学习：自动混合新词+复习
async function startDailyStudy() {
  const books = await appDB.getAllBooks();
  let newWords = [], dueWords = [];
  for (const b of books) {
    const words = await appDB.getWordsByBook(b.id);
    for (const w of words) {
      if ((w.progressScore || 0) === 0) newWords.push(w);
      else if (w.nextReview && w.nextReview.substring(0, 10) <= new Date().toISOString().substring(0, 10)) {
        dueWords.push(w);
      }
    }
  }
  // 去重（按 word.id）
  const seen = new Set();
  newWords = newWords.filter(w => { if (seen.has(w.id)) return false; seen.add(w.id); return true; });
  dueWords = dueWords.filter(w => { if (seen.has(w.id)) return false; seen.add(w.id); return true; });

  // 每次最多学 10 个新词（不限每日总量），全部到期复习
  newWords = newWords.slice(0, 10);

  if (newWords.length === 0 && dueWords.length === 0) {
    showToast('没有待学习的单词 📭');
    return;
  }

  // 混合排列：5新词 + 5复习 交替
  const queue = [];
  let ni = 0, di = 0;
  while (ni < newWords.length || di < dueWords.length) {
    for (let i = 0; i < 5 && ni < newWords.length; i++) {
      queue.push({ word: newWords[ni++], type: 'new' });
    }
    for (let i = 0; i < 5 && di < dueWords.length; i++) {
      queue.push({ word: dueWords[di++], type: 'review' });
    }
  }

  WordApp.state.wordQueue = queue;
  WordApp.state.currentWordIndex = 0;
  WordApp.state.showingAnswer = false;
  WordApp.state.studyMode = 'daily';
  sessionStats = { total: 0, mastered: 0, struggled: 0, forgot: 0 };
  showFullscreenPage('study');
}

// ============== 动态评价按钮渲染 ==============

/**
 * 根据当前算法渲染评价按钮
 * @param {string} containerId - DOM 容器 ID
 * @param {string} handlerName - onclick 处理函数名（'handleAction' | 'handleRecallAction'）
 */
function renderRatingButtons(containerId, handlerName) {
  const algo = WordApp.algorithms[WordApp.state.algorithmName];
  const options = algo ? algo.getRatingOptions() : [];
  if (options.length === 0) return;
  const container = document.getElementById(containerId);
  container.innerHTML = options.map(opt => {
    const btnClass = (opt.value === 'forgot' || opt.value === 0 || opt.value === 'forgotten') ? 'btn btn-red'
      : (opt.value === 'struggled' || opt.value === 1) ? 'btn btn-orange'
      : (opt.value === 2) ? 'btn btn-orange'
      : 'btn btn-green';
    return `<button class="${btnClass}" onclick="${handlerName}('${opt.value}')"><span class="btn-icon">${getRatingIcon(opt.value)}</span> ${opt.label}</button>`;
  }).join('');
}

function getRatingIcon(value) {
  if (value === 'forgot' || value === 0 || value === 'forgotten') return '✕';
  if (value === 'struggled' || value === 1) return '△';
  if (value === 2) return '△';
  if (value === 3 || value === 'remembered') return '✓';
  if (value === 4 || value === 'mastered') return '★';
  return '★';
}

// ============== 卡片内容渲染（按类型分发） ==============

function renderCardContent(word, mode) {
  const cardType = WordApp.cardTypes[word.cardType] || WordApp.cardTypes['basic'];
  const direction = WordApp.state.studyDirection;
  const rendered = cardType.renderFront(word, direction);
  const displayDiv = document.querySelector('.word-display');
  if (!displayDiv) return;

  // 清除之前的卡片类型扩展内容
  const oldExtras = displayDiv.querySelector('.card-extras');
  if (oldExtras) oldExtras.remove();

  if (word.cardType === 'basic') {
    document.getElementById('word-english').textContent = rendered.front;
    document.getElementById('word-chinese').textContent = rendered.back;
  } else if (word.cardType === 'cloze') {
    document.getElementById('word-english').innerHTML = rendered.front;
    document.getElementById('word-chinese').textContent = mode === 'recall' ? '输入空白处的答案' : '';
    // 添加输入框
    const extras = document.createElement('div');
    extras.className = 'card-extras';
    extras.innerHTML = `<input class="spell-input cloze-input" id="cloze-input" placeholder="输入空白处的答案..." autocomplete="off">`;
    displayDiv.appendChild(extras);
    // 绑定回车
    const input = extras.querySelector('.cloze-input');
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        checkClozeAnswer(word);
      }
    });
  } else if (word.cardType === 'multiple_choice') {
    document.getElementById('word-english').textContent = rendered.front;
    document.getElementById('word-chinese').textContent = '请选择一个答案';
    const extras = document.createElement('div');
    extras.className = 'card-extras mc-options';
    extras.innerHTML = rendered.options.map(o =>
      `<button class="mc-option" data-value="${escapeHtml(o.value)}" data-correct="${o.isCorrect}">${o.label}</button>`
    ).join('');
    displayDiv.appendChild(extras);
    // 绑定点击事件
    extras.querySelectorAll('.mc-option').forEach(btn => {
      btn.addEventListener('click', () => {
        const selected = btn.dataset.value;
        const isCorrect = btn.dataset.correct === 'true';
        selectMCAction(word, selected, isCorrect);
      });
    });
  }
}

async function checkClozeAnswer(word) {
  const input = document.getElementById('cloze-input');
  if (!input || !input.value.trim()) return;
  const cardType = WordApp.cardTypes['cloze'];
  const correct = cardType.checkAnswer(word, input.value.trim());
  if (correct) {
    input.className = 'spell-input correct';
    input.disabled = true;
    // 自动记为熟练
    sessionStats.total++; sessionStats.mastered++;
    const upd = await applyAlgorithm(word, 'mastered', WordApp.state.algorithmName);
    await appDB.updateWord({ ...word, ...upd });
    await appDB.insertRecord({ wordId: word.id, action: 'mastered' });
    nextWord();
  } else {
    input.className = 'spell-input wrong';
    // 显示答案
    showCardAnswer(word);
  }
}

let selectedMCAnswer = false;

async function selectMCAction(word, selected, isCorrect) {
  if (selectedMCAnswer) return; // 防止重复点击
  selectedMCAnswer = true;

  const cardType = WordApp.cardTypes['multiple_choice'];
  // 高亮选中
  document.querySelectorAll('.mc-option').forEach(btn => {
    btn.disabled = true;
    if (btn.dataset.correct === 'true') btn.classList.add('mc-correct');
    if (btn.dataset.value === selected && !isCorrect) btn.classList.add('mc-wrong');
  });

  if (isCorrect) {
    sessionStats.total++; sessionStats.mastered++;
    const upd = await applyAlgorithm(word, 'mastered', WordApp.state.algorithmName);
    await appDB.updateWord({ ...word, ...upd });
    await appDB.insertRecord({ wordId: word.id, action: 'mastered' });
    setTimeout(() => { selectedMCAnswer = false; nextWord(); }, 600);
  } else {
    sessionStats.total++; sessionStats.forgot++;
    const upd = await applyAlgorithm(word, 0, WordApp.state.algorithmName);
    await appDB.updateWord({ ...word, ...upd });
    await appDB.insertRecord({ wordId: word.id, action: 'forgot' });
    showCardAnswer(word);
  }
}

function showCardAnswer(word) {
  WordApp.state.showingAnswer = true;
  const cardType = WordApp.cardTypes[word.cardType] || WordApp.cardTypes['basic'];
  const rendered = cardType.renderAnswer(word, WordApp.state.studyDirection);
  const answerArea = document.getElementById('answer-area');

  if (word.cardType === 'basic') {
    document.getElementById('answer-english').textContent = word.english;
    document.getElementById('answer-chinese').textContent = word.chinese;
  } else {
    document.getElementById('answer-english').innerHTML = rendered.text;
    document.getElementById('answer-chinese').textContent = '';
  }
  answerArea.style.display = 'block';
  if (WordApp.state.studyMode === 'spell' || WordApp.state.studyMode === 'quiz') {
    document.getElementById('spell-input').disabled = true;
  }
  selectedMCAnswer = false;
}

// ============== 学习页面渲染 ==============
function renderCurrentWord() {
  const queue = WordApp.state.wordQueue;
  const idx = WordApp.state.currentWordIndex;
  if (queue.length === 0 || idx >= queue.length) {
    document.getElementById('study-container').style.display = 'none';
    document.getElementById('study-empty').style.display = 'block';
    document.getElementById('study-empty').innerHTML = '<div class="empty-state"><span class="empty-state-icon">🎉</span><div class="empty-state-text">已完成所有单词！</div></div>';
    return;
  }

  const item = queue[idx];
  // 支持 daily 模式：{word, type}，普通模式：直接是 word 对象
  const word = item.word || item;
  const isReview = item.type === 'review';
  const display = document.getElementById('word-display');
  const actions = document.getElementById('study-actions');
  const spellArea = document.getElementById('spell-area');
  const answerArea = document.getElementById('answer-area');
  const progress = document.getElementById('study-progress');

  progress.textContent = `${idx + 1} / ${queue.length}`;
  const fill = document.getElementById('progress-fill');
  if (fill) fill.style.width = `${((idx + 1) / queue.length) * 100}%`;
  answerArea.style.display = 'none';
  WordApp.state.showingAnswer = false;
  selectedMCAnswer = false; // 重置 MC 选择状态

  const spellInput = document.getElementById('spell-input');
  if (spellInput) { spellInput.value = ''; spellInput.className = 'spell-input'; spellInput.disabled = false; }

  const studyMode = WordApp.state.studyMode;
  const effectiveMode = studyMode === 'daily' ? (isReview ? 'recall' : 'learn') : studyMode;
  const modeLabelMap = { learn: '学习', spell: '拼写', recall: '复习', daily: isReview ? '复习' : '新词' };
  const mode = effectiveMode;
  const dirLabel = WordApp.state.studyDirection === 'en2cn' ? '英→中' : '中→英';
  document.getElementById('study-mode-label').textContent = `${modeLabelMap[studyMode] || ''} · ${dirLabel}${intensiveMode ? ' 🔥密集' : ''}`;

  if (mode === 'learn') {
    display.style.display = 'block';
    actions.style.display = 'flex';
    spellArea.style.display = 'none';
    renderRatingButtons('study-actions', 'handleAction');
    renderCardContent(word, 'learn');
  } else if (studyMode === 'spell') {
    display.style.display = 'block';
    actions.style.display = 'none';
    spellArea.style.display = 'block';
    if (WordApp.state.studyDirection === 'cn2en') {
      document.getElementById('word-english').textContent = word.chinese;
      document.getElementById('word-chinese').textContent = '';
      document.getElementById('spell-input').placeholder = '输入对应的英文单词...';
    } else {
      document.getElementById('word-english').textContent = word.english;
      document.getElementById('word-chinese').textContent = '';
      document.getElementById('spell-input').placeholder = '输入对应的中文释义...';
    }
    setupSpellInputListener();
  } else if (mode === 'recall') {
    display.style.display = 'block';
    actions.style.display = 'flex';
    spellArea.style.display = 'none';
    renderRatingButtons('study-actions', 'handleRecallAction');
    renderCardContent(word, 'recall');
  }
  setupSwipeGesture();

  // 仅向前翻时播放滑入动画
  const wordDisplay = document.getElementById('word-display');
  wordDisplay.classList.remove('slide-in');
  if (idx > lastRenderedIndex) {
    wordDisplay.classList.add('slide-in');
  }
  lastRenderedIndex = idx;
}

// ============== 学习操作 ==============
async function handleAction(action) {
  const queue = WordApp.state.wordQueue;
  const idx = WordApp.state.currentWordIndex;
  const item = queue[idx];
  const word = item.word || item;
  if (!word) return;
  const updated = await applyAlgorithm(word, action, WordApp.state.algorithmName);
  await appDB.updateWord({ ...word, ...updated });
  await appDB.insertRecord({ wordId: word.id, action: String(action) });
  sessionStats.total++;
  // 兼容各种算法的评价值
  if (action === 'forgot' || action === 0 || action === 'forgotten') sessionStats.forgot++;
  else if (action === 'struggled' || action === 1 || action === 2) sessionStats.struggled++;
  else sessionStats.mastered++;
  if (action === 'forgot' || action === 'struggled' || action === 0 || action === 1 || action === 'forgotten') {
    showAnswer(word);
  } else {
    nextWord();
  }
}

// 拼写模式：实时输入检测
function setupSpellInputListener() {
  const input = document.getElementById('spell-input');
  if (!input) return;
  // 移除旧监听器
  if (spellInputHandler) {
    input.removeEventListener('input', spellInputHandler);
  }
  const handler = function(e) { onSpellInput(e); };
  spellInputHandler = handler;
  input.addEventListener('input', handler);
  input.onkeydown = function(e) {
    if (e.key === 'Enter') { e.preventDefault(); if (WordApp.state.showingAnswer) nextWord(); }
  };
}

function onSpellInput() {
  const queue = WordApp.state.wordQueue;
  const idx = WordApp.state.currentWordIndex;
  const item = queue[idx];
  const word = item.word || item;
  if (!word || WordApp.state.showingAnswer) return;
  const input = document.getElementById('spell-input');
  const answer = WordApp.state.studyDirection === 'en2cn' ? word.chinese : word.english;
  const raw = input.value;
  if (!raw) { input.className = 'spell-input'; return; }

  const cu = raw.trim().toLowerCase().replace(/\s+/g,' ').replace(/[^一-龥a-zA-Z\s]/g,'');
  const ca = answer.trim().toLowerCase().replace(/\s+/g,' ').replace(/[^一-龥a-zA-Z\s]/g,'');

  if (cu === ca) {
    input.className = 'spell-input correct';
    input.disabled = true;
    sessionStats.total++; sessionStats.mastered++;
    setTimeout(async () => {
      const upd = await applyAlgorithm(word, 'mastered', WordApp.state.algorithmName);
      await appDB.updateWord({ ...word, ...upd });
      await appDB.insertRecord({ wordId: word.id, action: 'mastered' });
      nextWord();
    }, 300);
    return;
  }

  let ok = true;
  for (let i = 0; i < cu.length; i++) { if (i >= ca.length || cu[i] !== ca[i]) { ok = false; break; } }
  input.className = ok ? 'spell-input' : 'spell-input wrong';
}

async function handleSpellAction(action) {
  const queue = WordApp.state.wordQueue;
  const idx = WordApp.state.currentWordIndex;
  const item = queue[idx];
  const word = item.word || item;
  if (!word) return;
  const updated = await applyAlgorithm(word, action, WordApp.state.algorithmName);
  await appDB.updateWord({ ...word, ...updated });
  await appDB.insertRecord({ wordId: word.id, action });
  sessionStats.total++;
  if (action === 'forgot') sessionStats.forgot++; else sessionStats.struggled++;
  showAnswer(word);
}

async function handleRecallAction(action) {
  const queue = WordApp.state.wordQueue;
  const idx = WordApp.state.currentWordIndex;
  const item = queue[idx];
  const word = item.word || item;
  if (!word) return;
  const updated = await applyAlgorithm(word, action, WordApp.state.algorithmName);
  await appDB.updateWord({ ...word, ...updated });
  await appDB.insertRecord({ wordId: word.id, action: String(action) });
  sessionStats.total++;
  // 兼容各种算法的评价值
  if (action === 'forgot' || action === 0 || action === 'forgotten') { sessionStats.forgot++; showAnswer(word); }
  else if (action === 'struggled' || action === 1 || action === 2) { sessionStats.struggled++; showAnswer(word); }
  else { sessionStats.mastered++; nextWord(); }
}

function showAnswer(word) {
  WordApp.state.showingAnswer = true;
  const cardType = WordApp.cardTypes[word.cardType] || WordApp.cardTypes['basic'];
  const rendered = cardType.renderAnswer(word, WordApp.state.studyDirection);
  const answerArea = document.getElementById('answer-area');

  if (word.cardType === 'basic') {
    document.getElementById('answer-english').textContent = word.english;
    document.getElementById('answer-chinese').textContent = word.chinese;
  } else {
    document.getElementById('answer-english').innerHTML = rendered.text;
    document.getElementById('answer-chinese').textContent = '';
  }
  answerArea.style.display = 'block';
  if (WordApp.state.studyMode === 'spell' || WordApp.state.studyMode === 'quiz') {
    document.getElementById('spell-input').disabled = true;
  }
}

async function nextWord() {
  if (WordApp.state.studyMode === 'daily') {
    const queue = WordApp.state.wordQueue;
    const idx = WordApp.state.currentWordIndex;
    const item = queue[idx];
    if (item && item.type === 'new') {
      WordApp.state.dailyNewCount += 1;
      await appDB.setSetting('dailyNewCount', WordApp.state.dailyNewCount);
    }
  }
  if (WordApp.state.currentWordIndex < WordApp.state.wordQueue.length - 1) {
    WordApp.state.currentWordIndex++;
    WordApp.state.showingAnswer = false;
    renderCurrentWord();
  } else if (WordApp.state.studyMode === 'daily') {
    // daily 模式：队列学完 → 追加 10 个新词继续
    await appendMoreDailyWords();
    if (WordApp.state.wordQueue.length > WordApp.state.currentWordIndex + 1) {
      WordApp.state.currentWordIndex++;
      WordApp.state.showingAnswer = false;
      renderCurrentWord();
    } else {
      showStudyComplete();
    }
  } else {
    showStudyComplete();
  }
}

async function appendMoreDailyWords() {
  const books = await appDB.getAllBooks();
  let newWords = [];
  for (const b of books) {
    const words = await appDB.getWordsByBook(b.id);
    for (const w of words) {
      if ((w.progressScore || 0) === 0) newWords.push(w);
    }
  }
  const seen = new Set(WordApp.state.wordQueue.map(q => (q.word || q).id));
  newWords = newWords.filter(w => !seen.has(w.id)).slice(0, 10);
  if (newWords.length > 0) {
    for (const w of newWords) WordApp.state.wordQueue.push({ word: w, type: 'new' });
  }
}

function showStudyComplete() {
  const container = document.getElementById('study-container');
  container.style.display = 'none';
  const emptyHint = document.getElementById('study-empty');
  emptyHint.style.display = 'block';
  emptyHint.innerHTML = `
    <div class="study-complete">
      <span class="study-complete-icon">🎉</span>
      <div class="study-complete-text">学习完成！</div>
      <div style="margin:16px 0 24px;display:flex;flex-direction:column;gap:10px;align-items:center;">
        <div style="font-size:15px;color:var(--btn-gray);">本次学习了 <strong style="color:var(--text);font-size:18px;">${sessionStats.total}</strong> 个单词</div>
        <div style="font-size:15px;color:var(--btn-gray);display:flex;gap:16px;">
          <span>熟练 <strong style="color:var(--green);font-size:18px;">${sessionStats.mastered}</strong></span>
          <span>勉强 <strong style="color:#FFA500;font-size:18px;">${sessionStats.struggled}</strong></span>
          <span>忘了 <strong style="color:var(--coral);font-size:18px;">${sessionStats.forgot}</strong></span>
        </div>
      </div>
      <button class="btn btn-orange" onclick="goHome()" style="width:100%;max-width:200px;margin:0 auto;">返回首页</button>
    </div>`;
}

function handleSwipeRight() {
  if (WordApp.state.currentWordIndex < WordApp.state.wordQueue.length - 1) {
    WordApp.state.currentWordIndex++;
    WordApp.state.showingAnswer = false;
    renderCurrentWord();
  }
}

function handleSwipeLeft() {
  if (WordApp.state.currentWordIndex > 0) {
    WordApp.state.currentWordIndex--;
    WordApp.state.showingAnswer = false;
    renderCurrentWord();
  }
}

// ============== TTS ==============
function speak(text, lang = 'en') {
  if (!('speechSynthesis' in window)) {
    return speakGoogleTTS(text, lang);
  }
  speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang === 'en' ? 'en-US' : 'zh-CN';
  utterance.rate = 0.85;

  let played = false;

  utterance.onend = () => { played = true; };
  utterance.onerror = () => {
    if (!played) speakGoogleTTS(text, lang);
  };

  if (speechSynthesis.getVoices().length > 0) {
    const voices = speechSynthesis.getVoices();
    const preferred = voices.find(v => v.lang.startsWith(lang === 'en' ? 'en-US' : 'zh'));
    if (preferred) utterance.voice = preferred;
    speechSynthesis.speak(utterance);
    setTimeout(() => {
      if (!played && speechSynthesis.speaking === false) speakGoogleTTS(text, lang);
    }, 500);
  } else {
    speechSynthesis.addEventListener('voiceschanged', () => {
      const voices = speechSynthesis.getVoices();
      const preferred = voices.find(v => v.lang.startsWith(lang === 'en' ? 'en-US' : 'zh'));
      if (preferred) utterance.voice = preferred;
      speechSynthesis.speak(utterance);
    }, { once: true });
    speechSynthesis.speak(utterance);
    setTimeout(() => {
      if (!played && speechSynthesis.speaking === false) speakGoogleTTS(text, lang);
    }, 500);
  }
}

function speakGoogleTTS(text, lang) {
  try {
    const langCode = lang === 'en' ? 'en' : 'zh-CN';
    const url = 'https://translate.google.com/translate_tts?ie=UTF-8&q='
      + encodeURIComponent(text.substring(0, 200))
      + '&tl=' + langCode + '&client=tw-ob';
    const audio = new Audio(url);
    audio.volume = 1.0;
    audio.play().catch(() => {});
  } catch(_) {}
}

function speakCurrentWord() {
  const queue = WordApp.state.wordQueue;
  const idx = WordApp.state.currentWordIndex;
  const word = queue[idx];
  if (!word) return;
  speak(word.english, 'en');
  setTimeout(() => speak(word.chinese, 'zh'), 800);
}

// ============== 错题本 & 收藏本 ==============
async function refreshMistake() {
  const words = await appDB.getMistakeWords();
  const list = document.getElementById('mistake-list');
  if (words.length === 0) {
    list.innerHTML = '<div class="empty-state"><span class="empty-state-icon">✅</span><div class="empty-state-text">还没有错题，继续学习吧！</div></div>';
    return;
  }
  list.innerHTML = words.map(w => `
    <div class="word-item">
      <div class="word-info">
        <div class="word-en">${escapeHtml(w.english)}</div>
        <div class="word-zh">${escapeHtml(w.chinese)}</div>
      </div>
      <span class="badge badge-red">错${w.reviewCount || 0}次</span>
    </div>
  `).join('');
}

async function refreshFavorite() {
  const words = await appDB.getFavoritedWords();
  const list = document.getElementById('favorite-list');
  if (words.length === 0) {
    list.innerHTML = '<div class="empty-state"><span class="empty-state-icon">⭐</span><div class="empty-state-text">还没有收藏的单词</div></div>';
    return;
  }
  list.innerHTML = words.map(w => `
    <div class="word-item">
      <label class="word-checkbox">
        <input type="checkbox" ${w.isSelected ? 'checked' : ''} onchange="toggleWordSelect(${w.id}, this.checked)">
      </label>
      <div class="word-info">
        <div class="word-en">${escapeHtml(w.english)}</div>
        <div class="word-zh">${escapeHtml(w.chinese)}</div>
      </div>
    </div>
  `).join('');
}

async function toggleFavorite(id) {
  const nowFav = await appDB.toggleFavorite(id);
  showToast(nowFav ? '已收藏 ⭐' : '已取消收藏');
  // 由调用方决定是否刷新
}

// 查看已学习/已掌握单词（全屏页面）
function renderWordItems(words) {
  if (words.length === 0) return '<div style="text-align:center;padding:40px;color:var(--btn-gray);">暂无单词</div>';
  return words.map(w => `
    <div class="word-item">
      <div class="word-info"><div class="word-en">${escapeHtml(w.english)}</div><div class="word-zh">${escapeHtml(w.chinese)}</div></div>
      <span class="badge ${(w.progressScore||0)>=67?'badge-green':(w.progressScore||0)>=34?'badge-orange':'badge-gray'}">${getScoreStateText(w.progressScore||0)}</span>
    </div>
  `).join('');
}

async function showLearnedWords() {
  const all = await appDB.getAllWords();
  const words = all.filter(w => (w.progressScore||0)>0);
  document.getElementById('wordsview-title').textContent = `📝 已学习 (${words.length})`;
  document.getElementById('wordsview-list').innerHTML = renderWordItems(words);
  showFullscreenPage('wordsview');
}

async function showMasteredWords() {
  const all = await appDB.getAllWords();
  const words = all.filter(w => w.progressScore>=67);
  document.getElementById('wordsview-title').textContent = `✅ 已掌握 (${words.length})`;
  document.getElementById('wordsview-list').innerHTML = renderWordItems(words);
  showFullscreenPage('wordsview');
}

async function showAllWords() {
  const all = await appDB.getAllWords();
  document.getElementById('wordsview-title').textContent = `📖 全部单词 (${all.length})`;
  document.getElementById('wordsview-list').innerHTML = renderWordItems(all);
  showFullscreenPage('wordsview');
}

async function showDueWords() {
  const all = await appDB.getAllWords();
  const today = new Date().toISOString().substring(0,10);
  const words = all.filter(w => !w.nextReview || w.nextReview.substring(0,10)<=today);
  document.getElementById('wordsview-title').textContent = `⏰ 待复习 (${words.length})`;
  document.getElementById('wordsview-list').innerHTML = renderWordItems(words);
  showFullscreenPage('wordsview');
}

function startStudyFromSource(source) {
  reviewSource = source;
  const titles = { selected: '从勾选单词复习', mistake: '从错题本复习', favorite: '从收藏本复习' };
  document.getElementById('review-dialog-title').textContent = titles[source] || '选择复习模式';
  document.getElementById('review-dialog').style.display = 'flex';
}

function closeReviewDialog() {
  document.getElementById('review-dialog').style.display = 'none';
}

async function startReview(mode, intensive) {
  closeReviewDialog();
  WordApp.state.studyMode = mode;
  intensiveMode = intensive;
  let words;
  if (reviewSource === 'selected') words = await appDB.getSelectedWords();
  else if (reviewSource === 'mistake') words = await appDB.getMistakeWords();
  else words = await appDB.getFavoritedWords();
  if (words.length === 0) { showToast('没有可复习的单词'); return; }
  const seen = new Set();
  words = words.filter(w => { if (seen.has(w.id)) return false; seen.add(w.id); return true; });
  WordApp.state.wordQueue = [...words];
  WordApp.state.currentWordIndex = 0;
  WordApp.state.showingAnswer = false;
  sessionStats = { total: 0, mastered: 0, struggled: 0, forgot: 0 };
  showFullscreenPage('study');
}

async function refreshStudy() {
  const container = document.getElementById('study-container');
  const emptyHint = document.getElementById('study-empty');
  if (WordApp.state.wordQueue.length === 0) {
    const allSelected = await appDB.getSelectedWords();
    if (allSelected.length === 0) {
      container.style.display = 'none';
      emptyHint.style.display = 'block';
      emptyHint.innerHTML = '<div class="empty-state"><span class="empty-state-icon">📭</span><div class="empty-state-text">还没有勾选的单词</div></div>';
      return;
    }
    if (WordApp.state.studyMode === 'learn') { WordApp.state.wordQueue = [...allSelected]; }
    else {
      const due = await appDB.getDueWords();
      if (due.length === 0) {
        container.style.display = 'none';
        emptyHint.style.display = 'block';
        emptyHint.innerHTML = '<div class="empty-state"><span class="empty-state-icon">🎉</span><div class="empty-state-text">太棒了！今天所有单词都复习过了</div></div>';
        return;
      }
      WordApp.state.wordQueue = [...due];
    }
  }
  WordApp.state.currentWordIndex = 0;
  WordApp.state.showingAnswer = false;
  sessionStats = { total: 0, mastered: 0, struggled: 0, forgot: 0 };
  container.style.display = 'block';
  emptyHint.style.display = 'none';
  renderCurrentWord();
}

// ============== 滑动手势 ==============
function setupSwipeGesture() {
  if (swipeAbortController) swipeAbortController.abort();
  swipeAbortController = new AbortController();
  const signal = swipeAbortController.signal;

  const card = document.getElementById('word-display');
  if (!card) return;
  let isDragging = false;

  function startDrag(clientX, clientY) {
    isDragging = true;
    touchStartX = clientX; touchStartY = clientY; touchDiffX = 0;
    card.style.transition = 'none';
  }
  function moveDrag(clientX, clientY) {
    if (!isDragging) return;
    touchDiffX = clientX - touchStartX;
    const diffY = Math.abs(clientY - touchStartY);
    if (Math.abs(touchDiffX) > Math.abs(diffY)) {
      card.style.transform = `translateX(${touchDiffX}px) rotate(${touchDiffX * 0.05}deg)`;
      card.style.opacity = Math.max(0, 1 - Math.abs(touchDiffX) / 300);
    }
  }
  function endDrag() {
    if (!isDragging) return;
    isDragging = false;
    card.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
    if (touchDiffX > 80) {
      card.style.transform = 'translateX(120%) rotate(10deg)'; card.style.opacity = '0';
      setTimeout(() => { card.style.transform = ''; card.style.opacity = ''; card.style.transition = ''; handleSwipeRight(); }, 250);
    } else if (touchDiffX < -80) {
      card.style.transform = 'translateX(-120%) rotate(-10deg)'; card.style.opacity = '0';
      setTimeout(() => { card.style.transform = ''; card.style.opacity = ''; card.style.transition = ''; handleSwipeLeft(); }, 250);
    } else {
      card.style.transform = ''; card.style.opacity = '';
      setTimeout(() => { card.style.transition = ''; }, 300);
    }
    touchDiffX = 0;
  }

  card.addEventListener('touchstart', (e) => startDrag(e.touches[0].clientX, e.touches[0].clientY), { passive: true, signal });
  card.addEventListener('touchmove', (e) => moveDrag(e.touches[0].clientX, e.touches[0].clientY), { passive: true, signal });
  card.addEventListener('touchend', endDrag, { passive: true, signal });
  card.addEventListener('mousedown', (e) => startDrag(e.clientX, e.clientY), { signal });
  document.addEventListener('mousemove', (e) => moveDrag(e.clientX, e.clientY), { signal });
  document.addEventListener('mouseup', endDrag, { signal });
}
