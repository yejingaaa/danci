/**
 * 学习模块 - 学习流程、卡片渲染、TTS、滑动手势
 * 通用记忆工具：不假设任何语言
 */

// ============== 学习状态 ==============
let lastRenderedIndex = -1;
let sessionStats = { total: 0, mastered: 0, struggled: 0, forgot: 0 };
let reviewSource = 'selected';
let touchStartX = 0, touchStartY = 0, touchDiffX = 0;
let swipeAbortController = null;

// ============== 学习入口 ==============
function startStudy(mode) {
  WordApp.state.studyMode = mode;
  showFullscreenPage('study');
}

/** 根据方向获取当前应显示的正面/反面 */
function getSides(word) {
  const a = word.fields?.front || word.english || '';
  const b = word.fields?.back || word.chinese || '';
  return WordApp.state.studyDirection === 'front2back'
    ? { front: a, back: b }
    : { front: b, back: a };
}

/** 获取当前单词的熟练分（从 memoryState 读取） */
function getProgressScore(item) {
  return item.memoryState?.data?.progressScore ?? 0;
}
/** 获取下次复习时间 */
function getNextReview(item) {
  return item.memoryState?.nextReview ?? null;
}

// 今日学习：自动混合新词+复习
async function startDailyStudy() {
  const books = await appDB.getAllBooks();
  let newWords = [], dueWords = [];
  for (const b of books) {
    const words = await appDB.getWordsByBook(b.id);
    for (const w of words) {
      if (getProgressScore(w) === 0) newWords.push(w);
      else if (getNextReview(w) && getNextReview(w).substring(0, 10) <= new Date().toISOString().substring(0, 10)) {
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
 * @param {string} handlerName - onclick 处理函数名（'handleAction'）
 */
function renderRatingButtons(containerId, handlerName) {
  const algo = WordApp.algorithms[WordApp.state.algorithmName];
  const options = algo ? algo.getRatingOptions() : [];
  if (options.length === 0) return;

  // 获取当前单词（用于模拟算法算出下次复习时间）
  const queue = WordApp.state.wordQueue;
  const idx = WordApp.state.currentWordIndex;
  const item = queue[idx];
  const word = item?.word || item;

  const container = document.getElementById(containerId);
  container.innerHTML = options.map(opt => {
    const nv = parseInt(opt.value);
    const btnClass = nv === 0 ? 'btn btn-red'
      : nv === 1 ? 'btn btn-orange'
      : nv === 3 ? 'btn btn-blue' : 'btn btn-green';

    // 模拟算法算出下次复习时间
    let nextTimeText = '';
    if (word && word.memoryState && algo && typeof algo.schedule === 'function') {
      try {
        const result = algo.schedule(word, opt.value, new Date());
        const dueDate = result.dueDate instanceof Date ? result.dueDate : new Date(result.dueDate);
        if (!isNaN(dueDate.getTime())) {
          nextTimeText = formatRelativeTime(dueDate);
        }
      } catch (_) { /* 模拟失败不显示 */ }
    }

    return `<button class="${btnClass}" onclick="${handlerName}('${opt.value}')">
      <span class="btn-label">${opt.label}</span>
      ${nextTimeText ? `<span class="btn-sub">${nextTimeText}</span>` : ''}
    </button>`;
  }).join('');
}

function getRatingIcon(value) {
  const n = parseInt(value);
  if (n <= 1) return '✕';
  if (n === 3) return '✓';
  if (n === 4) return '★';
  return '★';
}

/**
 * 将日期格式化为相对时间描述（"10分钟后" / "1天后" / "4天后"）
 */
function formatRelativeTime(date) {
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffMin = Math.round(diffMs / 60000);
  const diffHour = Math.round(diffMs / 3600000);
  const diffDay = Math.round(diffMs / 86400000);

  if (diffMin < 0) return '已到期';
  if (diffMin < 1) return '立即';
  if (diffMin < 60) return `${diffMin} 分钟后`;
  if (diffHour < 24) return `${diffHour} 小时后`;
  if (diffDay === 1) return '明天';
  if (diffDay < 30) return `${diffDay} 天后`;
  if (diffDay < 365) return `${Math.round(diffDay / 30)} 个月后`;
  return `${Math.round(diffDay / 365)} 年后`;
}

// ============== 卡片内容渲染 ==============

/** 渲染卡片（含方向支持） */
function renderCardContent(word) {
  const sides = getSides(word);
  const frontEl = document.getElementById('word-english');
  const backEl = document.getElementById('word-chinese');

  frontEl.textContent = sides.front;
  backEl.textContent = sides.back;
  backEl.classList.remove('visible');
  backEl.style.display = 'none';
}

/** 绑定卡片点击显示背面 */
let _cardClickBound = false;
function setupCardClick() {
  const card = document.getElementById('word-display');
  if (!card) return;
  // 移除旧监听器（用新卡替换实现）
  if (_cardClickBound) {
    const clone = card.cloneNode(true);
    card.parentNode.replaceChild(clone, card);
  }
  const newCard = document.getElementById('word-display');
  newCard.addEventListener('click', function onClick() {
    if (WordApp.state.showingAnswer) return;
    WordApp.state.showingAnswer = true;
    const be = document.getElementById('word-chinese');
    if (be) {
      be.style.display = 'block';
      setTimeout(() => be.classList.add('visible'), 10);
    }
  });
  _cardClickBound = true;
}

// ============== 拼写模式 ==============

function setupSpellChecker(word) {
  const sides = getSides(word);
  const input = document.getElementById('spell-input');
  if (!input) return;
  input.value = '';
  input.className = 'spell-input';
  input.disabled = false;
  input.placeholder = `输入「${sides.back}」...`;
  input.oninput = function() {
    const target = sides.back.toLowerCase().trim();
    const typed = this.value.toLowerCase().trim();
    if (!typed) { this.className = 'spell-input'; return; }
    if (typed === target) {
      this.className = 'spell-input correct';
      this.disabled = true;
      setTimeout(() => handleAction('3'), 400);
    } else {
      let match = true;
      for (let i = 0; i < typed.length; i++) {
        if (i >= target.length || typed[i] !== target[i]) { match = false; break; }
      }
      this.className = match ? 'spell-input' : 'spell-input wrong';
    }
  };
  input.onkeydown = function(e) {
    if (e.key === 'Enter' && WordApp.state.showingAnswer) nextWord();
  };
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
  const word = item.word || item;
  const isReview = item.type === 'review';
  const display = document.getElementById('word-display');
  const actions = document.getElementById('study-actions');
  const spellArea = document.getElementById('spell-area');
  const progress = document.getElementById('study-progress');
  const modeLabel = document.getElementById('study-mode-label');

  progress.textContent = `${idx + 1} / ${queue.length}`;
  const fill = document.getElementById('progress-fill');
  if (fill) fill.style.width = `${((idx + 1) / queue.length) * 100}%`;

  WordApp.state.showingAnswer = false;

  const studyMode = WordApp.state.studyMode;
  const dirLabel = WordApp.state.studyDirection === 'front2back' ? '正面→反面' : '反面→正面';
  const modeLabelMap = { learn: '学习', spell: '拼写', daily: isReview ? '复习' : '新词', freereview: '自由复习' };
  modeLabel.textContent = `${modeLabelMap[studyMode] || '学习'} · ${dirLabel}`;

  display.style.display = 'block';
  if (studyMode === 'spell') {
    actions.style.display = 'none';
    spellArea.style.display = 'block';
    renderCardContent(word);
    setupSpellChecker(word);
  } else {
    actions.style.display = 'flex';
    spellArea.style.display = 'none';
    renderCardContent(word);
    renderRatingButtons('study-actions', 'handleAction');
  }
  setupCardClick();
  setupSwipeGesture();

  // 滑入动画
  const wd = document.getElementById('word-display');
  wd.classList.remove('slide-in');
  if (idx > lastRenderedIndex) {
    wd.classList.add('slide-in');
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
  const num = parseInt(action);

  // 自由复习模式：不更新算法，不写记录
  if (WordApp.state.studyMode !== 'freereview') {
    const updated = await applyAlgorithm(word, action, WordApp.state.algorithmName);
    await appDB.updateWord({ ...word, ...updated });
    await appDB.insertRecord({ wordId: word.id, action: String(action) });
  }

  // 统计
  sessionStats.total++;
  if (num <= 1) sessionStats.forgot++;
  else if (num === 3) sessionStats.struggled++;
  else sessionStats.mastered++;

  // 如果背面还没显示，先显示再跳转
  if (!WordApp.state.showingAnswer) showAnswer(word);

  // 立即跳转下一张（评价即跳转）
  nextWord();
}

// ============== 答案展示 ==============

function showAnswer(word) {
  if (WordApp.state.showingAnswer) return;
  WordApp.state.showingAnswer = true;
  const sides = getSides(word);
  const backEl = document.getElementById('word-chinese');
  if (backEl) {
    backEl.textContent = sides.back;
    backEl.style.display = 'block';
    setTimeout(() => backEl.classList.add('visible'), 10);
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
      if (getProgressScore(w) === 0) newWords.push(w);
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
function speak(text) {
  if (!text) return;
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.85;
  speechSynthesis.speak(utterance);
}

function speakCurrentWord() {
  const queue = WordApp.state.wordQueue;
  const idx = WordApp.state.currentWordIndex;
  const word = queue[idx];
  if (!word) return;
  const text = word.fields?.front || word.english || '';
  speak(text);
}

// ============== 错题本 & 收藏本 ==============
async function refreshMistake() {
  const words = await appDB.getMistakeWords();
  const list = document.getElementById('mistake-list');
  if (words.length === 0) {
    list.innerHTML = '<div class="empty-state"><span class="empty-state-icon">✅</span><div class="empty-state-text">还没有错题，继续学习吧！</div></div>';
    return;
  }
  list.innerHTML = words.map(w => {
    const front = w.fields?.front || w.english || '';
    const back = w.fields?.back || w.chinese || '';
    return `<div class="word-item">
      <div class="word-info">
        <div class="word-en">${escapeHtml(front)}</div>
        <div class="word-zh">${escapeHtml(back)}</div>
      </div>
      <span class="badge badge-red">错${w.memoryState?.data?.reviewCount || 0}次</span>
    </div>`;
  }).join('');
}

async function refreshFavorite() {
  const words = await appDB.getFavoritedWords();
  const list = document.getElementById('favorite-list');
  if (words.length === 0) {
    list.innerHTML = '<div class="empty-state"><span class="empty-state-icon">⭐</span><div class="empty-state-text">还没有收藏的单词</div></div>';
    return;
  }
  list.innerHTML = words.map(w => {
    const front = w.fields?.front || w.english || '';
    const back = w.fields?.back || w.chinese || '';
    return `<div class="word-item">
      <label class="word-checkbox">
        <input type="checkbox" ${w.isSelected ? 'checked' : ''} onchange="toggleWordSelect(${w.id}, this.checked)">
      </label>
      <div class="word-info">
        <div class="word-en">${escapeHtml(front)}</div>
        <div class="word-zh">${escapeHtml(back)}</div>
      </div>
    </div>`;
  }).join('');
}

async function toggleFavorite(id) {
  const nowFav = await appDB.toggleFavorite(id);
  showToast(nowFav ? '已收藏 ⭐' : '已取消收藏');
  // 由调用方决定是否刷新
}

// 查看已学习/已掌握单词（全屏页面）
function renderWordItems(words) {
  if (words.length === 0) return '<div style="text-align:center;padding:40px;color:var(--btn-gray);">暂无内容</div>';
  return words.map(w => {
    const front = w.fields?.front || w.english || '';
    const p = getProgressScore(w);
    return `<div class="word-item">
      <div class="word-info"><div class="word-en">${escapeHtml(front)}</div></div>
      <span class="badge ${p>=67?'badge-green':p>=34?'badge-orange':'badge-gray'}">${getScoreStateText(p)}</span>
    </div>`;
  }).join('');
}

async function showLearnedWords() {
  const all = await appDB.getAllWords();
  const words = all.filter(w => getProgressScore(w) > 0);
  document.getElementById('wordsview-title').textContent = `📝 已学习 (${words.length})`;
  document.getElementById('wordsview-list').innerHTML = renderWordItems(words);
  showFullscreenPage('wordsview');
}

async function showMasteredWords() {
  const all = await appDB.getAllWords();
  const words = all.filter(w => getProgressScore(w) >= 67);
  document.getElementById('wordsview-title').textContent = `✅ 已掌握 (${words.length})`;
  document.getElementById('wordsview-list').innerHTML = renderWordItems(words);
  showFullscreenPage('wordsview');
}

async function showAllWords() {
  const all = await appDB.getAllWords();
  document.getElementById('wordsview-title').textContent = `📖 全部 (${all.length})`;
  document.getElementById('wordsview-list').innerHTML = renderWordItems(all);
  showFullscreenPage('wordsview');
}

async function showDueWords() {
  const all = await appDB.getAllWords();
  const today = new Date().toISOString().substring(0,10);
  const words = all.filter(w => !getNextReview(w) || (getNextReview(w) && getNextReview(w).substring(0,10) <= today));
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

async function startReview(mode) {
  closeReviewDialog();
  WordApp.state.studyMode = mode;
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

/** 自由复习：评价不影响算法调度，纯用户自检 */
async function startFreeReview() {
  closeReviewDialog();
  WordApp.state.studyMode = 'freereview';
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
    if (WordApp.state.studyMode === 'learn' || WordApp.state.studyMode === 'freereview' || WordApp.state.studyMode === 'spell') { WordApp.state.wordQueue = [...allSelected]; }
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
