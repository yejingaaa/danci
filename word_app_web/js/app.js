/**
 * 单词软件 - 主应用逻辑
 */

// ============== 状态 ==============
let currentView = 'home';
let studyMode = 'learn'; // 'learn' | 'spell' | 'recall'
let studyDirection = 'en2cn'; // 'en2cn' | 'cn2en'
let wordQueue = [];
let currentWordIndex = 0;
let showingAnswer = false;
let algorithmName = 'three_state';
let customIntervals = null;
let isNightMode = false;

// ============== 页面管理 ==============
// ============== 导航系统 ==============

/** 切换底部 Tab */
function switchTab(tabName) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const tab = document.querySelector(`.tab-content[data-tab="${tabName}"]`);
  if (tab) tab.classList.add('active');

  const nav = document.querySelector(`.nav-item[data-tab="${tabName}"]`);
  if (nav) nav.classList.add('active');

  currentView = tabName;

  // 刷新对应数据
  if (tabName === 'study') refreshHome();
  else if (tabName === 'words') refreshManage();
  else if (tabName === 'stats') refreshStats();

  // 更新标题
  const titles = { study: '单词软件', words: '词库', stats: '统计', profile: '我的' };
  document.getElementById('page-title').textContent = titles[tabName] || '单词软件';

  // 隐藏返回按钮
  document.getElementById('global-back-btn').classList.remove('visible');
}

/** 显示全屏页面（隐藏底部导航） */
function showFullscreenPage(pageId) {
  document.querySelectorAll('.fullscreen-page').forEach(p => p.classList.remove('active'));
  const page = document.getElementById(`page-${pageId}`);
  if (page) page.classList.add('active');

  document.getElementById('fullscreen-pages').classList.add('visible');
  document.getElementById('bottom-nav').classList.add('hidden');
  document.getElementById('global-back-btn').classList.add('visible');

  // 刷新数据
  if (pageId === 'study') refreshStudy();
  else if (pageId === 'mistake') refreshMistake();
  else if (pageId === 'favorite') refreshFavorite();

  // 更新标题
  const titles = { study: '学习中', mistake: '错题本', favorite: '收藏本' };
  document.getElementById('page-title').textContent = titles[pageId] || '单词软件';
}

/** 显示子页面（错题本/收藏本） */
function showSubPage(pageId) {
  showFullscreenPage(pageId);
}

/** 返回（关闭全屏页面） */
function goHome() {
  document.getElementById('fullscreen-pages').classList.remove('visible');
  document.getElementById('bottom-nav').classList.remove('hidden');
  document.getElementById('global-back-btn').classList.remove('visible');
  document.getElementById('page-title').textContent = '单词软件';

  // 回到学习 tab 并刷新
  switchTab('study');
}

// ============== 首页 ==============
async function refreshHome() {
  document.getElementById('stat-total').textContent = await appDB.getTotalWordCount();
  document.getElementById('stat-due').textContent = await appDB.getDueCount();
  document.getElementById('stat-mastered').textContent = await appDB.getMasteredCount();

  const total = await appDB.getTotalWordCount();
  document.getElementById('home-hint').textContent =
    total === 0 ? '现在还没有单词 📭' : `共 ${total} 个单词`;
}

function startStudy(mode) {
  studyMode = mode;
  intensiveMode = false; // 普通学习模式不使用密集复习逻辑
  showFullscreenPage('study');
}

// ============== 设置 ==============
function refreshSettings() {
  document.querySelectorAll('#direction-control .seg-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.value === studyDirection);
  });
  document.querySelectorAll('#algorithm-control .seg-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.value === algorithmName);
  });
  document.getElementById('custom-interval-area').style.display =
    algorithmName === 'fixed' ? 'block' : 'none';
}

async function setDirection(dir) {
  studyDirection = dir;
  document.querySelectorAll('#direction-control .seg-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.value === dir);
  });
  await appDB.setSetting('studyDirection', dir);
  showToast(dir === 'en2cn' ? '已切换为英→中' : '已切换为中→英');
}

async function setAlgorithm(algo) {
  algorithmName = algo;
  document.querySelectorAll('#algorithm-control .seg-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.value === algo);
  });
  document.getElementById('custom-interval-area').style.display =
    algo === 'fixed' ? 'block' : 'none';
  await appDB.setSetting('algorithm', algo);
  showToast(algo === 'sm2' ? '已切换为 SM-2 算法' : '已切换为固定间隔算法');
}

async function saveCustomIntervals() {
  const input = document.getElementById('custom-intervals').value.trim();
  const intervals = input.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n > 0);
  if (intervals.length < 2) {
    showToast('请输入至少2个正整数，用逗号分隔');
    return;
  }
  await appDB.setSetting('customIntervals', intervals);
  showToast('自定义间隔已保存');
}

async function toggleNightMode() {
  isNightMode = !isNightMode;
  document.body.classList.toggle('night-mode', isNightMode);
  document.documentElement.classList.toggle('night-mode', isNightMode);
  await appDB.setSetting('nightMode', isNightMode);
  localStorage.setItem('wordapp_nightMode', isNightMode);
  document.getElementById('night-toggle').checked = isNightMode;
}

async function loadSettings() {
  isNightMode = await appDB.getSetting('nightMode') || false;
  document.body.classList.toggle('night-mode', isNightMode);
  document.documentElement.classList.toggle('night-mode', isNightMode);
  localStorage.setItem('wordapp_nightMode', isNightMode);
  if (document.getElementById('night-toggle')) {
    document.getElementById('night-toggle').checked = isNightMode;
  }
  studyDirection = await appDB.getSetting('studyDirection') || 'en2cn';
  algorithmName = await appDB.getSetting('algorithm') || 'three_state';
  const saved = await appDB.getSetting('customIntervals');
  if (saved) {
    customIntervals = saved;
    const el = document.getElementById('custom-intervals');
    if (el) el.value = saved.join(',');
  }
}

// ============== 学习页面 ==============
let lastRenderedIndex = -1;
let sessionStats = { total: 0, mastered: 0, struggled: 0, forgot: 0 };

function renderCurrentWord() {
  if (wordQueue.length === 0 || currentWordIndex >= wordQueue.length) {
    document.getElementById('study-container').style.display = 'none';
    document.getElementById('study-empty').style.display = 'block';
    document.getElementById('study-empty').innerHTML = '<div class="empty-state"><span class="empty-state-icon">🎉</span><div class="empty-state-text">已完成所有单词！</div></div>';
    return;
  }

  const word = wordQueue[currentWordIndex];
  const display = document.getElementById('word-display');
  const actions = document.getElementById('study-actions');
  const spellArea = document.getElementById('spell-area');
  const answerArea = document.getElementById('answer-area');
  const progress = document.getElementById('study-progress');

  progress.textContent = `${currentWordIndex + 1} / ${wordQueue.length}`;
  const fill = document.getElementById('progress-fill');
  if (fill) fill.style.width = `${((currentWordIndex + 1) / wordQueue.length) * 100}%`;
  answerArea.style.display = 'none';
  showingAnswer = false;

  const spellInput = document.getElementById('spell-input');
  if (spellInput) { spellInput.value = ''; spellInput.className = 'spell-input'; spellInput.disabled = false; }

  const modeLabelMap = { learn: '学习', spell: '拼写', recall: '复习' };
  const dirLabel = studyDirection === 'en2cn' ? '英→中' : '中→英';
  document.getElementById('study-mode-label').textContent = `${modeLabelMap[studyMode] || ''} · ${dirLabel}${intensiveMode ? ' 🔥密集' : ''}`;

  if (studyMode === 'learn') {
    display.style.display = 'block';
    actions.style.display = 'flex';
    spellArea.style.display = 'none';
    actions.innerHTML = `
      <button class="btn btn-red" onclick="handleAction('forgot')"><span class="btn-icon">✕</span> 忘了</button>
      <button class="btn btn-orange" onclick="handleAction('struggled')"><span class="btn-icon">△</span> 勉强</button>
      <button class="btn btn-green" onclick="handleAction('mastered')"><span class="btn-icon">★</span> 熟练</button>
    `;
    if (studyDirection === 'cn2en') {
      document.getElementById('word-english').textContent = word.chinese;
      document.getElementById('word-chinese').textContent = word.english;
    } else {
      document.getElementById('word-english').textContent = word.english;
      document.getElementById('word-chinese').textContent = word.chinese;
    }
  } else if (studyMode === 'spell') {
    display.style.display = 'block';
    actions.style.display = 'none';
    spellArea.style.display = 'block';
    if (studyDirection === 'cn2en') {
      document.getElementById('word-english').textContent = word.chinese;
      document.getElementById('word-chinese').textContent = '';
      document.getElementById('spell-input').placeholder = '输入对应的英文单词...';
    } else {
      document.getElementById('word-english').textContent = word.english;
      document.getElementById('word-chinese').textContent = '';
      document.getElementById('spell-input').placeholder = '输入对应的中文释义...';
    }
    setupSpellInputListener();
  } else if (studyMode === 'recall') {
    display.style.display = 'block';
    actions.style.display = 'flex';
    spellArea.style.display = 'none';
    actions.innerHTML = `
      <button class="btn btn-red" onclick="handleRecallAction('forgot')"><span class="btn-icon">✕</span> 忘了</button>
      <button class="btn btn-orange" onclick="handleRecallAction('struggled')"><span class="btn-icon">△</span> 勉强</button>
      <button class="btn btn-green" onclick="handleRecallAction('mastered')"><span class="btn-icon">★</span> 熟练</button>
    `;
    if (studyDirection === 'cn2en') {
      document.getElementById('word-english').textContent = word.chinese;
      document.getElementById('word-chinese').textContent = '请回想对应的英文单词';
    } else {
      document.getElementById('word-english').textContent = word.english;
      document.getElementById('word-chinese').textContent = '请回想对应的中文释义';
    }
  }
  setupSwipeGesture();

  // 仅向前翻时播放滑入动画
  const wordDisplay = document.getElementById('word-display');
  wordDisplay.classList.remove('slide-in');
  if (currentWordIndex > lastRenderedIndex) {
    wordDisplay.classList.add('slide-in');
  }
  lastRenderedIndex = currentWordIndex;
}

// ============== 学习操作 ==============
async function handleAction(action) {
  const word = wordQueue[currentWordIndex];
  if (!word) return;
  const updated = await applyAlgorithm(word, action, algorithmName, customIntervals);
  await appDB.updateWord(updated);
  await appDB.insertRecord({ wordId: word.id, action });
  sessionStats.total++;
  if (action === 'forgot') sessionStats.forgot++;
  else if (action === 'struggled') sessionStats.struggled++;
  else sessionStats.mastered++;
  nextWord();
}

// \u62fc\u5199\u6a21\u5f0f\uff1a\u5b9e\u65f6\u8f93\u5165\u68c0\u6d4b
function setupSpellInputListener() {
  const oldInput = document.getElementById('spell-input');
  if (!oldInput) return;
  const newInput = oldInput.cloneNode(true);
  oldInput.parentNode.replaceChild(newInput, oldInput);
  newInput.addEventListener('input', onSpellInput);
  newInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); if (showingAnswer) handleShowNext(); }
  });
}

function onSpellInput() {
  const word = wordQueue[currentWordIndex];
  if (!word || showingAnswer) return;
  const input = document.getElementById('spell-input');
  const answer = studyDirection === 'en2cn' ? word.chinese : word.english;
  const raw = input.value;
  if (!raw) { input.className = 'spell-input'; return; }

  const cu = raw.trim().toLowerCase().replace(/\s+/g,' ').replace(/[^\u4e00-\u9fa5a-zA-Z\s]/g,'');
  const ca = answer.trim().toLowerCase().replace(/\s+/g,' ').replace(/[^\u4e00-\u9fa5a-zA-Z\s]/g,'');

  if (cu === ca) {
    input.className = 'spell-input correct';
    input.disabled = true;
    sessionStats.total++; sessionStats.mastered++;
    setTimeout(async () => {
      const upd = await applyAlgorithm(word, 'mastered', algorithmName, customIntervals);
      await appDB.updateWord(upd);
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
  const word = wordQueue[currentWordIndex];
  if (!word) return;
  const updated = await applyAlgorithm(word, action, algorithmName, customIntervals);
  await appDB.updateWord(updated);
  await appDB.insertRecord({ wordId: word.id, action });
  sessionStats.total++;
  if (action === 'forgot') sessionStats.forgot++; else sessionStats.struggled++;
  showAnswer(word);
}

async function handleSpellForgot() {
  const word = wordQueue[currentWordIndex];
  if (!word) return;
  const updated = await applyAlgorithm(word, 'forgot', algorithmName, customIntervals);
  await appDB.updateWord(updated);
  await appDB.insertRecord({ wordId: word.id, action: 'forgot' });
  sessionStats.total++;
  sessionStats.forgot++;
  showAnswer(word);
}

async function handleRecallAction(action) {
  const word = wordQueue[currentWordIndex];
  if (!word) return;
  const updated = await applyAlgorithm(word, action === 'remembered' ? 'remembered' : 'forgot', algorithmName, customIntervals);
  await appDB.updateWord(updated);
  await appDB.insertRecord({ wordId: word.id, action });
  sessionStats.total++;
  if (action === 'forgot') { sessionStats.forgot++; showAnswer(word); }
  else if (action === 'struggled') { sessionStats.struggled++; showAnswer(word); }
  else { sessionStats.mastered++; nextWord(); }
}

function showAnswer(word) {
  showingAnswer = true;
  const answerArea = document.getElementById('answer-area');
  document.getElementById('answer-english').textContent = word.english;
  document.getElementById('answer-chinese').textContent = word.chinese;
  answerArea.style.display = 'block';
  if (studyMode === 'spell' || studyMode === 'quiz') {
    document.getElementById('spell-input').disabled = true;
  }
}

function handleShowNext() { nextWord(); }

function nextWord() {
  if (currentWordIndex < wordQueue.length - 1) {
    currentWordIndex++;
    showingAnswer = false;
    renderCurrentWord();
  } else {
    showStudyComplete();
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
  if (currentWordIndex < wordQueue.length - 1) {
    currentWordIndex++;
    showingAnswer = false;
    renderCurrentWord();
  }
}

function handleSwipeLeft() {
  if (currentWordIndex > 0) {
    currentWordIndex--;
    showingAnswer = false;
    renderCurrentWord();
  }
}

// ============== TTS ==============
function speak(text, lang = 'en') {
  if (!('speechSynthesis' in window)) return;
  // 取消正在播放的语音，避免重叠
  speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang === 'en' ? 'en-US' : 'zh-CN';
  utterance.rate = 0.85;

  // 等待语音加载完成再播放（移动端需要）
  if (speechSynthesis.getVoices().length > 0) {
    // 选择最优语音
    const voices = speechSynthesis.getVoices();
    const preferred = voices.find(v => v.lang.startsWith(lang === 'en' ? 'en-US' : 'zh'));
    if (preferred) utterance.voice = preferred;
    speechSynthesis.speak(utterance);
  } else {
    // 首次加载，等 voices 就绪
    speechSynthesis.addEventListener('voiceschanged', () => {
      const voices = speechSynthesis.getVoices();
      const preferred = voices.find(v => v.lang.startsWith(lang === 'en' ? 'en-US' : 'zh'));
      if (preferred) utterance.voice = preferred;
      speechSynthesis.speak(utterance);
    }, { once: true });
    // 兜底：直接播
    speechSynthesis.speak(utterance);
  }
}

function speakCurrentWord() {
  const word = wordQueue[currentWordIndex];
  if (!word) return;
  speak(word.english, 'en');
  setTimeout(() => speak(word.chinese, 'zh'), 800);
}

// ============== 错题本 & 收藏本 ==============
let reviewSource = 'selected';
let intensiveMode = false;

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
  refreshManage();
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
  studyMode = mode;
  intensiveMode = intensive;
  let words;
  if (reviewSource === 'selected') words = await appDB.getSelectedWords();
  else if (reviewSource === 'mistake') words = await appDB.getMistakeWords();
  else words = await appDB.getFavoritedWords();
  if (words.length === 0) { showToast('没有可复习的单词'); return; }
  // 去重（防止同一单词出现在多个来源中）
  const seen = new Set();
  words = words.filter(w => { if (seen.has(w.id)) return false; seen.add(w.id); return true; });
  wordQueue = [...words];
  currentWordIndex = 0;
  showingAnswer = false;
  sessionStats = { total: 0, mastered: 0, struggled: 0, forgot: 0 };
  showFullscreenPage('study');
}

async function refreshStudy() {
  const container = document.getElementById('study-container');
  const emptyHint = document.getElementById('study-empty');
  if (wordQueue.length === 0) {
    const allSelected = await appDB.getSelectedWords();
    if (allSelected.length === 0) {
      container.style.display = 'none';
      emptyHint.style.display = 'block';
      emptyHint.innerHTML = '<div class="empty-state"><span class="empty-state-icon">📭</span><div class="empty-state-text">还没有勾选的单词</div></div>';
      return;
    }
    if (studyMode === 'learn') { wordQueue = [...allSelected]; }
    else {
      const due = await appDB.getDueWords();
      if (due.length === 0) {
        container.style.display = 'none';
        emptyHint.style.display = 'block';
        emptyHint.innerHTML = '<div class="empty-state"><span class="empty-state-icon">🎉</span><div class="empty-state-text">太棒了！今天所有单词都复习过了</div></div>';
        return;
      }
      wordQueue = [...due];
    }
  }
  currentWordIndex = 0;
  showingAnswer = false;
  sessionStats = { total: 0, mastered: 0, struggled: 0, forgot: 0 };
  container.style.display = 'block';
  emptyHint.style.display = 'none';
  renderCurrentWord();
}

// ============== 统计 ==============
let statsPeriod = 'day';

function switchStatsTab(period) {
  statsPeriod = period;
  document.querySelectorAll('.stat-tab').forEach(t => t.classList.remove('active'));
  const activeTab = document.querySelector(`.stat-tab[data-period="${period}"]`);
  if (activeTab) activeTab.classList.add('active');
  refreshStats();
}

function getPeriodRange(period) {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  let start;

  if (period === 'day') {
    start = new Date(now);
    start.setHours(0, 0, 0, 0);
  } else if (period === 'week') {
    start = new Date(now);
    const day = start.getDay();
    start.setDate(start.getDate() - day + (day === 0 ? -6 : 1));
    start.setHours(0, 0, 0, 0);
  } else if (period === 'month') {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (period === 'year') {
    start = new Date(now.getFullYear(), 0, 1);
  } else {
    start = new Date(2020, 0, 1);
  }
  return { start, end };
}

async function refreshStats() {
  const { start, end } = getPeriodRange(statsPeriod);

  const total = await appDB.getTotalWordCount();
  const due = await appDB.getDueCount();
  const mastered = await appDB.getMasteredCount();
  const allWords = await appDB.getAllWords();

  const records = await getAllReviewRecordsSince(start, end);
  const totalReviews = records.length;
  let correctCount = 0;
  records.forEach(r => { if (r.action !== 'forgot') correctCount++; });
  const accuracy = totalReviews > 0 ? Math.round(correctCount / totalReviews * 100) : 0;

  const studyDays = new Set();
  records.forEach(r => studyDays.add(r.reviewedAt.substring(0, 10)));

  const startStr = start.toISOString();
  const newWords = allWords.filter(w => w.createdAt >= startStr).length;

  const mistakeCounts = {};
  for (const r of records) { if (r.action === 'forgot') mistakeCounts[r.wordId] = (mistakeCounts[r.wordId] || 0) + 1; }
  const topMistakes = Object.entries(mistakeCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const topMistakeWords = [];
  for (const [wordId, count] of topMistakes) {
    const word = await appDB.getWord(parseInt(wordId));
    if (word) topMistakeWords.push({ word, count });
  }

  const prevStart = new Date(start);
  const prevEnd = new Date(start);
  prevEnd.setDate(prevEnd.getDate() - 1);
  prevEnd.setHours(23,59,59,999);
  if (statsPeriod === 'month') prevStart.setMonth(prevStart.getMonth() - 1);
  else if (statsPeriod === 'year') prevStart.setFullYear(prevStart.getFullYear() - 1);
  else if (statsPeriod === 'week') prevStart.setDate(prevStart.getDate() - 7);
  else if (statsPeriod === 'day') prevStart.setDate(prevStart.getDate() - 1);

  const prevRecords = await getAllReviewRecordsSince(prevStart, prevEnd);
  let prevCorrect = 0;
  prevRecords.forEach(r => { if (r.action !== 'forgot') prevCorrect++; });
  const prevAccuracy = prevRecords.length > 0 ? Math.round(prevCorrect / prevRecords.length * 100) : 0;

  const periodLabels = { day: '\u4eca\u65e5', week: '\u672c\u5468', month: '\u672c\u6708', year: '\u4eca\u5e74', all: '\u603b\u8ba1' };
  const title = periodLabels[statsPeriod] || '\u7edf\u8ba1';

  const circumference = 2 * Math.PI * 34;
  const offset = circumference - (accuracy / 100) * circumference;
  const ringColor = accuracy >= 80 ? '#2ECC71' : accuracy >= 60 ? '#FFA500' : '#E74C3C';

  let html = '';

  if (statsPeriod !== 'all') {
    html += '<div class="stats-card">'
      + '<div class="stats-ring-wrap">'
      + '<div class="stats-ring">'
      + '<svg width="80" height="80" viewBox="0 0 80 80">'
      + '<circle class="stats-ring-bg" cx="40" cy="40" r="34"/>'
      + '<circle class="stats-ring-fill" cx="40" cy="40" r="34"'
      + ' stroke="' + ringColor + '"'
      + ' stroke-dasharray="' + circumference + '"'
      + ' stroke-dashoffset="' + offset + '"/>'
      + '</svg>'
      + '<div class="stats-ring-text">' + accuracy + '%</div>'
      + '</div>'
      + '<div>'
      + '<div class="stats-ring-label">' + title + '\u6b63\u786e\u7387</div>'
      + '<div style="font-size:13px;color:var(--btn-gray);margin-top:4px;">'
      + correctCount + '/' + totalReviews + ' \u6b63\u786e'
      + (prevRecords.length > 0 ? '<span style="opacity:0.6;">\uff08\u4e0a\u671f ' + prevAccuracy + '%\uff09</span>' : '')
      + '</div></div></div></div>';

    html += '<div class="stats-card">'
      + '<div class="stats-card-title">\ud83d\udcca \u5b66\u4e60\u6982\u89c8</div>'
      + '<div class="stats-grid">'
      + '<div class="stats-grid-item"><div class="stats-grid-value">' + studyDays.size + '</div><div class="stats-grid-label">\u5b66\u4e60\u5929\u6570</div></div>'
      + '<div class="stats-grid-item"><div class="stats-grid-value">' + newWords + '</div><div class="stats-grid-label">\u65b0\u5b66\u5355\u8bcd</div></div>'
      + '<div class="stats-grid-item"><div class="stats-grid-value">' + totalReviews + '</div><div class="stats-grid-label">\u590d\u4e60\u6b21\u6570</div></div>'
      + '<div class="stats-grid-item"><div class="stats-grid-value" style="color:' + (accuracy >= 60 ? 'var(--green)' : 'var(--coral)') + '">' + accuracy + '%</div><div class="stats-grid-label">\u6b63\u786e\u7387</div></div>'
      + '</div></div>';

    // Daily review trend bar chart
    var bc = renderReviewChart(records, start, end);
    if (bc) html += bc;

    if (topMistakeWords.length > 0) {
      html += '<div class="stats-card">'
        + '<div class="stats-card-title">\u274c \u9ad8\u9891\u9519\u8bcd</div>'
        + '<div class="stats-mistake-list">';
      for (const {word, count} of topMistakeWords) {
        html += '<div class="stats-mistake-item">'
          + '<span class="stats-mistake-word">' + escapeHtml(word.english) + '</span>'
          + '<span class="stats-mistake-count">\u9519 ' + count + ' \u6b21</span>'
          + '</div>';
      }
      html += '</div></div>';
    }
  } else {
    html += '<div class="stats-card">'
      + '<div class="stats-card-title">\ud83d\udcda \u5b66\u4e60\u603b\u89c8</div>'
      + '<div class="stats-simple-row"><span class="stats-simple-label">\ud83d\udcd6 \u603b\u5355\u8bcd\u6570</span><span class="stats-simple-value">' + total + '</span></div>'
      + '<div class="stats-simple-row"><span class="stats-simple-label">\ud83d\udd50 \u5f85\u590d\u4e60</span><span class="stats-simple-value" style="color:#E74C3C">' + due + '</span></div>'
      + '<div class="stats-simple-row"><span class="stats-simple-label">\u2705 \u5df2\u638c\u63e1</span><span class="stats-simple-value" style="color:#2ECC71">' + mastered + '</span></div>'
      + '<div class="stats-simple-row"><span class="stats-simple-label">\ud83d\udd04 \u603b\u590d\u4e60\u6b21\u6570</span><span class="stats-simple-value">' + (totalReviews + prevRecords.length) + '</span></div>'
      + '</div>';
  }

  // Add proficiency distribution in all view
  if (statsPeriod === 'all') {
    html += renderProficiencyChart(allWords);
  }

  html += '<button class="stats-refresh-btn" onclick="refreshStats()">\ud83d\udd04 \u5237\u65b0\u6570\u636e</button>';

  document.getElementById('stats-content').innerHTML = html;
}



/**
 * Generate daily bar chart HTML from review records
 */
function renderReviewChart(records, start, end) {
  // Group records by date
  const dayMap = {};
  for (const r of records) {
    const d = r.reviewedAt.substring(0, 10);
    if (!dayMap[d]) dayMap[d] = { correct: 0, wrong: 0, total: 0 };
    dayMap[d].total++;
    if (r.action === 'forgot') dayMap[d].wrong++;
    else dayMap[d].correct++;
  }

  // Build date range
  const days = [];
  const s = new Date(start), e = new Date(end);
  // Don't show more than 31 bars
  const diffDays = Math.ceil((e - s) / (1000 * 60 * 60 * 24));
  if (diffDays > 31) return ''; // too many days, skip bar chart

  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().substring(0, 10);
    days.push(key);
  }

  // Find max value for scaling
  let maxVal = 0;
  days.forEach(d => { if ((dayMap[d]?.total || 0) > maxVal) maxVal = dayMap[d].total; });
  if (maxVal === 0) maxVal = 1;

  let html = '<div class="stats-card">'
    + '<div class="stats-card-title">📈 每日复习趋势</div>'
    + '<div class="chart-bar-group">';

  for (const d of days) {
    const data = dayMap[d];
    const total = data ? data.total : 0;
    const h = Math.max(2, (total / maxVal) * 90);
    const label = d.substring(5); // MM-DD

    if (data && data.correct > 0 && data.wrong > 0) {
      // Stacked: correct on bottom, wrong on top
      const correctH = (data.correct / total) * h;
      const wrongH = (data.wrong / total) * h;
      html += '<div class="chart-bar-wrap">'
        + '<div class="chart-bar-value">' + (total > 0 ? total : '') + '</div>'
        + '<div class="chart-bar-stack" style="height:' + h + 'px;">'
        + '<div class="chart-bar correct" style="height:' + correctH + 'px;"></div>'
        + (data.wrong > 0 ? '<div class="chart-bar wrong" style="height:' + wrongH + 'px;"></div>' : '')
        + '</div>'
        + '<div class="chart-bar-label">' + label + '</div>'
        + '</div>';
    } else if (data && total > 0) {
      const color = data.correct > 0 ? 'correct' : 'wrong';
      html += '<div class="chart-bar-wrap">'
        + '<div class="chart-bar-value">' + total + '</div>'
        + '<div class="chart-bar ' + color + '" style="height:' + h + 'px;"></div>'
        + '<div class="chart-bar-label">' + label + '</div>'
        + '</div>';
    } else {
      html += '<div class="chart-bar-wrap">'
        + '<div class="chart-bar-value"></div>'
        + '<div class="chart-bar" style="height:2px;background:rgba(149,165,166,0.05);"></div>'
        + '<div class="chart-bar-label">' + label + '</div>'
        + '</div>';
    }
  }

  html += '</div>'
    + '<div style="display:flex;gap:12px;justify-content:center;margin-top:12px;font-size:11px;color:var(--btn-gray);">'
    + '<span>🟢 正确</span><span>🔴 错误</span>'
    + '</div></div>';

  return html;
}

/**
 * Generate proficiency distribution chart HTML
 */
function renderProficiencyChart(allWords) {
  const levels = { forgot: { label: '错误', color: '#E74C3C', count: 0 },
                   struggled: { label: '勉强', color: '#FFA500', count: 0 },
                   mastered: { label: '熟练', color: '#2ECC71', count: 0 } };
  allWords.forEach(w => {
    const s = w.progressScore ?? 0;
    if (s >= 67) levels.mastered.count++;
    else if (s >= 34) levels.struggled.count++;
    else levels.forgot.count++;
  });

  const maxVal = Math.max(levels.forgot.count, levels.struggled.count, levels.mastered.count, 1);
  const colorOrder = ['#E74C3C', '#FFA500', '#2ECC71'];
  const labelOrder = ['错误', '勉强', '熟练'];
  const countOrder = [levels.forgot.count, levels.struggled.count, levels.mastered.count];

  let html = '<div class="stats-card">'
    + '<div class="stats-card-title">📊 单词掌握分布</div>'
    + '<div class="prof-dist">';

  for (let i = 0; i < 3; i++) {
    const cnt = countOrder[i];
    const pct = Math.round((cnt / maxVal) * 100);
    html += '<div class="prof-row">'
      + '<div class="prof-label">' + labelOrder[i] + '</div>'
      + '<div class="prof-bar-bg">'
      + '<div class="prof-bar-fill" style="width:' + pct + '%;background:' + colorOrder[i] + ';"></div>'
      + '</div>'
      + '<div class="prof-count">' + cnt + '</div>'
      + '</div>';
  }

  html += '</div></div>';
  return html;
}

async function getAllReviewRecordsSince(startDate, endDate) {
  const tx = appDB.db.transaction('review_records', 'readonly');
  const store = tx.objectStore('review_records');
  const all = await new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  const start = startDate.getTime();
  const end = endDate ? endDate.getTime() : Date.now();
  return all.filter(r => { const t = new Date(r.reviewedAt).getTime(); return t >= start && t <= end; });
}

// ============== 管理 ==============
// ============== 词本管理 ==============
let currentBookId = null;

async function refreshManage() {
  const books = await appDB.getAllBooks();
  document.getElementById('books-count').textContent = `${books.length} 个词本`;
  const list = document.getElementById('books-list');

  // 显示/隐藏全局搜索
  const totalWords = await appDB.getTotalWordCount();
  const globalSearch = document.getElementById('global-search-input');
  const globalResults = document.getElementById('global-search-results');
  if (globalSearch) globalSearch.style.display = totalWords > 0 ? 'block' : 'none';
  if (globalResults) { globalResults.style.display = 'none'; globalResults.innerHTML = ''; }
  if (list) list.style.display = 'block';

  if (books.length === 0) {
    list.innerHTML = '<div class="empty-state"><span class="empty-state-icon">📕</span><div class="empty-state-text">还没有词本</div></div>';
    return;
  }

  list.innerHTML = (await Promise.all(books.map(async b => {
    const cnt = await appDB.getWordCountByBook(b.id);
    return `<div class="word-item" onclick="openBook(${b.id})" style="cursor:pointer;">
      <span style="font-size:24px;margin-right:8px;">📕</span>
      <div class="word-info"><div class="word-en">${escapeHtml(b.name)}</div><div class="word-zh">${cnt} 个单词</div></div>
      <button class="btn-icon" onclick="event.stopPropagation();deleteBook(${b.id})" title="删除词本">🗑️</button>
    </div>`;
  }))).join('');
}

async function openBook(bookId) {
  currentBookId = bookId;
  const book = await appDB.getBook(bookId);
  document.getElementById('current-book-name').textContent = book ? book.name : '词本';
  document.getElementById('books-view').style.display = 'none';
  document.getElementById('words-view').style.display = 'block';
  refreshWordList(bookId);
}

function showBooksView() {
  currentBookId = null;
  document.getElementById('books-view').style.display = 'block';
  document.getElementById('words-view').style.display = 'none';
  refreshManage();
}

let allWordsCache = [];
let currentSearchQuery = '';

async function refreshWordList(bookId) {
  allWordsCache = await appDB.getWordsByBook(bookId);
  const searchInput = document.getElementById('word-search');
  if (searchInput) { searchInput.value = ''; }
  currentSearchQuery = '';
  renderWordList(allWordsCache);
}

function filterWordList() {
  const q = document.getElementById('word-search').value.trim().toLowerCase();
  currentSearchQuery = q;
  if (!q) {
    renderWordList(allWordsCache);
    document.getElementById('word-count').textContent = `共 ${allWordsCache.length} 个单词`;
    return;
  }
  const filtered = allWordsCache.filter(w =>
    w.english.toLowerCase().includes(q) || w.chinese.includes(q)
  );
  renderWordList(filtered);
  document.getElementById('word-count').textContent = `找到 ${filtered.length} / ${allWordsCache.length} 个单词`;
  document.querySelectorAll('#word-list .word-item').forEach((el, i) => {
    const word = filtered[i];
    if (word && q) highlightMatch(el, q);
  });
}

function highlightMatch(el, query) {
  const enEl = el.querySelector('.word-en');
  const zhEl = el.querySelector('.word-zh');
  if (enEl) enEl.innerHTML = enEl.textContent.replace(
    new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'),
    '<mark style="background:#FFE082;border-radius:2px;padding:0 2px;">$1</mark>'
  );
  if (zhEl) zhEl.innerHTML = zhEl.textContent.replace(
    new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'g'),
    '<mark style="background:#FFE082;border-radius:2px;padding:0 2px;">$1</mark>'
  );
}

// ============== 全局搜索（跨词本） ==============
let globalSearchTimer = null;

async function onGlobalSearch() {
  clearTimeout(globalSearchTimer);
  const q = document.getElementById('global-search-input').value.trim();
  const resultsEl = document.getElementById('global-search-results');
  const booksList = document.getElementById('books-list');
  if (!q) {
    resultsEl.style.display = 'none';
    booksList.style.display = 'block';
    return;
  }
  globalSearchTimer = setTimeout(async () => {
    const allWords = await appDB.getAllWords();
    const books = await appDB.getAllBooks();
    const bookMap = {};
    books.forEach(b => bookMap[b.id] = b.name);
    const qLower = q.toLowerCase();

    // 过滤匹配的单词
    const matched = [];
    for (const w of allWords) {
      const enMatch = w.english.toLowerCase().includes(qLower);
      const zhMatch = w.chinese.includes(q);
      // 拼音匹配（如果有 pinyin-pro 库）
      let pyMatch = false;
      if (!enMatch && !zhMatch && window.pinyinPro) {
        try {
          const py = window.pinyinPro.pinyin(w.chinese, { toneType: 'none' }).toLowerCase().replace(/\s/g, '');
          const pyInitials = window.pinyinPro.pinyin(w.chinese, { pattern: 'first', toneType: 'none' }).toLowerCase().replace(/\s/g, '');
          if (py.includes(qLower) || pyInitials.includes(qLower)) pyMatch = true;
        } catch(_) {}
      }
      // 首字母匹配（英文）
      let initialMatch = false;
      if (!enMatch && !zhMatch && !pyMatch) {
        const initials = w.english.split(/\s+/).map(s => s[0] || '').join('').toLowerCase();
        if (initials.includes(qLower)) initialMatch = true;
      }
      if (enMatch || zhMatch || pyMatch || initialMatch) {
        matched.push(w);
      }
    }

    if (matched.length === 0) {
      resultsEl.innerHTML = '<div class="empty-state"><span class="empty-state-icon">🔍</span><div class="empty-state-text">没有找到匹配的单词</div></div>';
    } else {
      // 按词本分组
      const groups = {};
      for (const w of matched) {
        const bookName = bookMap[w.bookId] || '默认词本';
        if (!groups[bookName]) groups[bookName] = [];
        groups[bookName].push(w);
      }
      let html = `<div style="font-size:13px;color:var(--btn-gray);margin-bottom:8px;">找到 ${matched.length} 个匹配单词</div>`;
      for (const [bookName, words] of Object.entries(groups)) {
        html += `<div style="font-size:14px;font-weight:600;color:var(--btn-orange);margin:8px 0 4px;">📕 ${escapeHtml(bookName)}</div>`;
        for (const w of words) {
          html += `<div class="word-item" style="cursor:pointer;" onclick="openBook(${w.bookId})">
            <div class="word-info"><div class="word-en">${highlightText(escapeHtml(w.english), q)}</div><div class="word-zh">${highlightText(escapeHtml(w.chinese), q)}</div></div>
          </div>`;
        }
      }
      resultsEl.innerHTML = html;
    }
    resultsEl.style.display = 'block';
    booksList.style.display = 'none';
  }, 300);
}

function highlightText(text, query) {
  if (!query) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`(${escaped})`, 'gi'), '<mark style="background:#FFE082;border-radius:2px;padding:0 2px;">$1</mark>');
}

function renderWordItemHtml(w) {
  return `<div class="word-item" data-id="${w.id}">
    <label class="word-checkbox"><input type="checkbox" ${w.isSelected ? 'checked' : ''} onchange="toggleWordSelect(${w.id}, this.checked)"></label>
    <div class="word-info" onclick="showWordDetail(${w.id})" style="cursor:pointer;"><div class="word-en">${escapeHtml(w.english)}</div><div class="word-zh">${escapeHtml(w.chinese)}</div></div>
    <div class="word-stats">
      <span class="badge ${(w.progressScore || 0) >= 67 ? 'badge-green' : (w.progressScore || 0) >= 34 ? 'badge-orange' : 'badge-gray'} ${(w.progressScore || 0) >= 67 ? '' : (w.progressScore || 0) >= 34 ? '' : ''}">${getScoreStateText(w.progressScore || 0)}</span>
      <button class="btn-icon" onclick="showEditWord(${w.id})" title="编辑" style="margin-left:2px;">✏️</button>
      <button class="btn-icon" onclick="toggleFavorite(${w.id})" title="收藏" style="margin-left:4px;">${w.isFavorited ? '⭐' : '☆'}</button>
      <button class="btn-icon" onclick="deleteWord(${w.id})" title="删除" style="margin-left:2px;">🗑️</button>
    </div>
  </div>`;
}

// 虚拟滚动状态
let virtualScroll = { words: [], itemHeight: 54, rafId: null };

function renderWordListVirtual(words, list, count) {
  const ITEM_HEIGHT = 54;
  const BUFFER = 25;

  // 仅在首次或单词列表变化时重建
  if (virtualScroll.words !== words) {
    virtualScroll.words = words;
    list.style.overflowY = 'auto';
    list.style.maxHeight = 'calc(100vh - 280px)';
    list.style.position = 'relative';
    list.style.willChange = 'transform';

    const renderVisible = () => {
      const scrollTop = list.scrollTop;
      const vh = list.clientHeight || 600;
      const startIdx = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - BUFFER);
      const endIdx = Math.min(words.length, Math.ceil((scrollTop + vh) / ITEM_HEIGHT) + BUFFER);
      list.innerHTML = `<div style="height:${startIdx * ITEM_HEIGHT}px;flex-shrink:0;"></div>`
        + words.slice(startIdx, endIdx).map(renderWordItemHtml).join('')
        + `<div style="height:${(words.length - endIdx) * ITEM_HEIGHT}px;flex-shrink:0;"></div>`;
    };

    list.onscroll = () => {
      if (virtualScroll.rafId) cancelAnimationFrame(virtualScroll.rafId);
      virtualScroll.rafId = requestAnimationFrame(() => { renderVisible(); virtualScroll.rafId = null; });
    };
    renderVisible();
    count.textContent = `共 ${words.length} 个单词`;
  }
}

function renderWordList(words) {
  const list = document.getElementById('word-list');
  const count = document.getElementById('word-count');
  const searchInput = document.getElementById('word-search');
  searchInput.style.display = words.length > 5 ? 'block' : 'none';
  if (words.length === 0 && allWordsCache.length === 0) {
    count.textContent = '共 0 个单词';
    list.innerHTML = '<div class="empty-state"><span class="empty-state-icon">📭</span><div class="empty-state-text">这个词本还是空的</div></div>';
    return;
  }
  if (words.length === 0) {
    list.innerHTML = '<div class="empty-state"><span class="empty-state-icon">🔍</span><div class="empty-state-text">没有匹配的单词</div></div>';
    return;
  }
  count.textContent = allWordsCache.length > 0 && !currentSearchQuery
    ? `共 ${allWordsCache.length} 个单词`
    : `找到 ${words.length} / ${allWordsCache.length} 个单词`;

  // 大列表使用虚拟滚动
  if (words.length > 200 && !currentSearchQuery) {
    return renderWordListVirtual(words, list, count);
  }

  list.innerHTML = words.map(w => renderWordItemHtml(w)).join('');
  list.style.overflowY = '';
  list.style.maxHeight = '';
  list.onscroll = null;
}

function escapeHtml(text) { const div = document.createElement('div'); div.textContent = text; return div.innerHTML; }
async function toggleWordSelect(id, selected) { await appDB.toggleSelection(id, selected); }
async function deleteWord(id) { if (!confirm('确认删除这个单词？')) return; await appDB.deleteWord(id); refreshWordList(currentBookId); }

// ============== 批量操作 ==============
async function toggleSelectAll() {
  const words = allWordsCache;
  if (!words.length) return;
  // 检查是否全部已选中
  const allSelected = words.every(w => w.isSelected);
  const newState = !allSelected;
  for (const w of words) {
    w.isSelected = newState;
    await appDB.toggleSelection(w.id, newState);
  }
  renderWordList(currentSearchQuery ? words.filter(w => w.english.toLowerCase().includes(currentSearchQuery) || w.chinese.includes(currentSearchQuery)) : words);
  showToast(newState ? '已全选' : '已取消全选');
}

async function batchDeleteSelected() {
  const selected = allWordsCache.filter(w => w.isSelected);
  if (!selected.length) { showToast('请先勾选要删除的单词'); return; }
  if (!confirm(`确认删除选中的 ${selected.length} 个单词？此操作不可撤销！`)) return;
  for (const w of selected) {
    await appDB.deleteWord(w.id);
  }
  allWordsCache = allWordsCache.filter(w => !w.isSelected);
  showToast(`已删除 ${selected.length} 个单词`);
  refreshWordList(currentBookId);
}

// ============== 内置词库导入 ==============
const BUILTIN_BOOKS = [
  { file: 'wordbooks/elementary.json', name: '小学词汇 (~1170词)', level: '小学' },
  { file: 'wordbooks/middle.json', name: '初中词汇 (~1340词)', level: '初中' },
  { file: 'wordbooks/high.json', name: '高中词汇 (~2330词)', level: '高中' },
];

function showBuiltinBooks() {
  const list = document.getElementById('books-list');
  let html = '<div style="margin:12px 0;font-size:14px;font-weight:600;color:var(--text);">📚 内置词库</div>';
  for (const book of BUILTIN_BOOKS) {
    html += `<div class="word-item" style="cursor:pointer;" onclick="importBuiltinBook('${book.file}','${book.level}')">
      <div class="word-info"><div class="word-en">${book.name}</div><div class="word-zh">点击导入为新词本</div></div>
    </div>`;
  }
  html += '<button class="btn btn-gray btn-sm" onclick="refreshManage()" style="width:100%;margin-top:8px;">← 返回</button>';
  list.innerHTML = html;
}

async function importBuiltinBook(file, level) {
  if (!confirm(`确定导入「${level}词汇」？将创建新词本并导入所有单词。`)) return;
  try {
    const resp = await fetch(file);
    const words = await resp.json();
    if (!words || !words.length) { showToast('词库文件为空'); return; }
    // 创建词本
    const bookName = `${level}词汇`;
    const books = await appDB.getAllBooks();
    let book = books.find(b => b.name === bookName);
    if (!book) {
      const bookId = await appDB.createBook(bookName);
      book = { id: bookId, name: bookName };
    }
    // 导入单词
    const wordData = words.map(w => ({ english: w.english, chinese: w.chinese, bookId: book.id, isSelected: true, createdAt: new Date().toISOString() }));
    const inserted = await appDB.insertWordsUnique(wordData);
    showToast(`成功导入 ${inserted} 个单词到「${bookName}」`);
    refreshManage();
  } catch (err) {
    showToast('导入失败：' + (err.message || '请检查网络'));
  }
}

function batchMoveSelected() {
  const selected = allWordsCache.filter(w => w.isSelected);
  if (!selected.length) { showToast('请先勾选要移动的单词'); return; }
  // 弹出词本选择对话框
  const sel = document.getElementById('import-book-select');
  // 复用导入对话框的 select，但改一下功能
  const dialog = document.getElementById('import-dialog');
  document.querySelector('#import-dialog .card-title').textContent = '移动到词本';
  const textarea = document.getElementById('import-text');
  textarea.style.display = 'none';
  // 填充词本选项（排除当前词本）
  appDB.getAllBooks().then(books => {
    sel.innerHTML = books.filter(b => b.id !== currentBookId).map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');
    if (!sel.options.length) { showToast('没有其他词本可移动'); return; }
    dialog.style.display = 'flex';
    // 覆盖导入按钮行为
    document.querySelector('#import-dialog .btn-orange').onclick = async () => {
      const targetBookId = parseInt(sel.value);
      for (const w of selected) {
        w.bookId = targetBookId;
        await appDB.updateWord(w);
      }
      dialog.style.display = 'none';
      textarea.style.display = '';
      document.querySelector('#import-dialog .card-title').textContent = '导入单词';
      // 恢复原有导入行为
      document.querySelector('#import-dialog .btn-orange').onclick = handleImport;
      allWordsCache = allWordsCache.filter(w => !w.isSelected);
      showToast(`已移动 ${selected.length} 个单词`);
      refreshWordList(currentBookId);
    };
  });
}

// ============== 词本增删 ==============
function showCreateBookDialog() { document.getElementById('create-book-dialog').style.display = 'flex'; document.getElementById('new-book-name').value = ''; }
function closeCreateBookDialog() { document.getElementById('create-book-dialog').style.display = 'none'; }
async function createBook() {
  const name = document.getElementById('new-book-name').value.trim();
  if (!name) { showToast('请输入词本名称'); return; }
  await appDB.createBook(name);
  closeCreateBookDialog();
  refreshManage();
  showToast(`词本「${name}」已创建`);
}
async function deleteBook(id) {
  if (!confirm('确认删除这个词本及其所有单词？')) return;
  await appDB.deleteBook(id);
  refreshManage();
  showToast('词本已删除');
}

// ============== 单词详情 ==============
async function showWordDetail(id) {
  const word = await appDB.getWord(id);
  if (!word) return;
  const records = await appDB.getRecordsByWordId(id, 50);
  const forgotCount = records.filter(r => r.action === 'forgot').length;
  const rememberedCount = records.filter(r => r.action === 'remembered' || r.action === 'mastered').length;

  let historyHtml = '';
  if (records.length === 0) {
    historyHtml = '<div class="hint" style="margin-top:8px;">暂无复习记录</div>';
  } else {
    historyHtml = records.slice(0, 20).map(r => {
      const date = new Date(r.reviewedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      const labels = { forgot: '❌ 忘了', remembered: '✅ 记得', mastered: '⭐ 熟练' };
      return `<div style="font-size:14px;padding:4px 0;border-bottom:1px solid rgba(0,0,0,0.04);">${date} — ${labels[r.action] || r.action}</div>`;
    }).join('');
  }

  document.getElementById('detail-english').textContent = word.english;
  document.getElementById('detail-chinese').textContent = word.chinese;
  document.getElementById('detail-proficiency').textContent = `${getScoreStateText(word.progressScore || 0)} (${word.progressScore || 0}分)`;
  document.getElementById('detail-reviewed').textContent = `${word.reviewCount || 0} 次`;
  document.getElementById('detail-consecutive').textContent = `${word.consecutiveCorrect || 0} 次`;
  document.getElementById('detail-forgot').textContent = `${forgotCount} 次`;
  document.getElementById('detail-correct-rate').textContent = (rememberedCount + forgotCount) > 0
    ? Math.round(rememberedCount / (rememberedCount + forgotCount) * 100) + '%' : '暂无';
  document.getElementById('detail-history').innerHTML = historyHtml;
  document.getElementById('detail-dialog').style.display = 'flex';
}

function closeDetailDialog() {
  document.getElementById('detail-dialog').style.display = 'none';
}

// ============== 编辑单词 ==============
let editingWordId = null;

function showEditWord(id) {
  editingWordId = id;
  const word = wordQueue.length > 0 ? wordQueue.find(w => w.id === id) : null;
  // 从数据库获取
  appDB.getWord(id).then(w => {
    if (!w) return;
    document.getElementById('edit-english').value = w.english;
    document.getElementById('edit-chinese').value = w.chinese;
    document.getElementById('edit-dialog').style.display = 'flex';
  });
}

function closeEditDialog() {
  document.getElementById('edit-dialog').style.display = 'none';
  editingWordId = null;
}

async function saveEditWord() {
  const english = document.getElementById('edit-english').value.trim();
  const chinese = document.getElementById('edit-chinese').value.trim();
  if (!english || !chinese) { showToast('请输入英文和中文'); return; }

  const word = await appDB.getWord(editingWordId);
  if (!word) return;
  word.english = english;
  word.chinese = chinese;
  await appDB.updateWord(word);
  showToast('已更新');
  closeEditDialog();
  refreshManage();
}

// ============== 导入 ==============
async function showImportDialog() {
  // 填充词本选择
  const sel = document.getElementById('import-book-select');
  const books = await appDB.getAllBooks();
  sel.innerHTML = books.map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');
  // 如果在词本视图中，默认选中当前词本
  if (currentBookId) sel.value = currentBookId;
  document.getElementById('import-dialog').style.display = 'flex';
}
function closeImportDialog() {
  const dialog = document.getElementById('import-dialog');
  const textarea = document.getElementById('import-text');
  dialog.style.display = 'none';
  textarea.value = '';
  textarea.style.display = '';
  document.querySelector('#import-dialog .card-title').textContent = '导入单词';
  document.querySelector('#import-dialog .btn-orange').onclick = handleImport;
}

async function handleImport() {
  const text = document.getElementById('import-text').value.trim();
  if (!text) { showToast('请输入单词'); return; }
  const bookId = parseInt(document.getElementById('import-book-select').value);
  const lines = text.split('\n').filter(l => l.trim());
  const words = []; let successCount = 0;
  for (const line of lines) {
    let parts;
    if (line.includes(',')) { parts = line.split(','); }
    else { const idx = line.search(/[\u4e00-\u9fa5]/); if (idx > 0) { parts = [line.substring(0, idx).trim(), line.substring(idx).trim()]; } else { parts = line.split(/\s+/); } }
    if (parts.length >= 2) {
      const english = parts[0].trim(); const chinese = parts.slice(1).join(',').trim();
      if (english && chinese) { words.push({ english, chinese, bookId, isSelected: false, createdAt: new Date().toISOString() }); successCount++; }
    }
  }
  if (words.length > 0) {
    const inserted = await appDB.insertWordsUnique(words);
    const skipped = words.length - inserted;
    showToast(inserted > 0
      ? `成功导入 ${inserted} 个单词${skipped > 0 ? `，${skipped} 个重复已跳过` : ''}`
      : '所有单词已存在，无需导入');
    closeImportDialog();
    if (currentBookId) refreshWordList(currentBookId); else refreshManage();
  }
  else { showToast('解析失败，请检查格式（每行: 单词,释义）'); }
}

function handleFileImport() { document.getElementById('file-input').click(); }

// 直接导入文件（不弹文本框）
async function handleDirectFileImport() {
  // 这个按钮只在词本视图中可见，直接选文件导入到当前词本
  const input = document.getElementById('file-input');
  input.accept = '.txt,.csv,.tsv,.json,.md,.xlsx';
  input.click();
}

// 文件选中后处理
async function onFileSelected(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';

  const bookId = currentBookId || 1;
  let words = [];
  let successCount = 0;

  if (file.name.endsWith('.xlsx') && typeof XLSX !== 'undefined') {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    for (const row of rows) {
      if (!row || row.length < 2) continue;
      const english = String(row[0]).trim();
      const chinese = String(row[1]).trim();
      if (english && chinese) { words.push({ english, chinese, bookId, isSelected: false, createdAt: new Date().toISOString() }); successCount++; }
    }
  } else if (file.name.endsWith('.json')) {
    // JSON 格式解析：支持数组或 { words: [...] }
    const text = await file.text();
    const data = JSON.parse(text);
    const arr = Array.isArray(data) ? data : (data.words || data.data || []);
    for (const item of arr) {
      if (typeof item !== 'object') continue;
      const english = item.english || item.English || item.word || item.Word || item.en || item.En || '';
      const chinese = item.chinese || item.Chinese || item.meaning || item.Meaning || item.translation || item.zh || item.Zh || '';
      if (english && chinese) { words.push({ english: String(english).trim(), chinese: String(chinese).trim(), bookId, isSelected: false, createdAt: new Date().toISOString() }); successCount++; }
    }
  } else if (file.name.endsWith('.md')) {
    // Markdown 表格解析
    const text = await file.text();
    const lines = text.split('\n').filter(l => l.trim());
    let headerCols = null, isFirstMdRow = true;
    for (const line of lines) {
      if (!line.trim().startsWith('|')) continue;
      const cells = line.split('|').filter(c => c.trim() !== '').map(c => c.trim());
      if (cells.length < 2) continue;
      if (cells.every(c => /^[-:\s]+$/.test(c.replace(/\|/g, '').trim()))) continue;
      if (isFirstMdRow) {
        isFirstMdRow = false;
        const isHeader = cells.some(c => /^(english|chinese|word|meaning|en|zh|单词|英文|中文|释义)$/i.test(c.trim()));
        if (isHeader) {
          headerCols = cells.map((c, i) => ({ index: i, type: /^(english|word|en|英文|单词)$/i.test(c.trim()) ? 'en' : /^(chinese|meaning|zh|中文|释义)$/i.test(c.trim()) ? 'zh' : 'skip' }));
          continue;
        }
      }
      let english = '', chinese = '';
      if (headerCols) { for (const col of headerCols) { if (col.type === 'en' && cells[col.index]) english = cells[col.index]; else if (col.type === 'zh' && cells[col.index]) chinese = cells[col.index]; } }
      else { english = cells[0]; chinese = cells.slice(1).join(' '); }
      if (english && chinese) { words.push({ english, chinese, bookId, isSelected: false, createdAt: new Date().toISOString() }); successCount++; }
    }
  } else {
    const text = await file.text();
    const lines = text.split('\n').filter(l => l.trim());
    for (const line of lines) {
      let parts;
      if (file.name.endsWith('.tsv')) {
        parts = line.split('\t');
      } else if (line.includes(',')) {
        parts = line.split(',');
      } else {
        const idx = line.search(/[\u4e00-\u9fa5]/);
        if (idx > 0) {
          parts = [line.substring(0, idx).trim(), line.substring(idx).trim()];
        } else {
          parts = line.split(/\s+/);
        }
      }
      if (parts.length >= 2) {
        const english = parts[0].trim();
        const sep = file.name.endsWith('.tsv') ? '\t' : ',';
        const chinese = parts.slice(1).join(sep).trim();
        if (english && chinese) {
          words.push({ english, chinese, bookId, isSelected: false, createdAt: new Date().toISOString() });
          successCount++;
        }
      }
    }
  }

  if (successCount > 0) {
    const inserted = await appDB.insertWordsUnique(words);
    const skipped = words.length - inserted;
    showToast(inserted > 0
      ? `成功导入 ${inserted} 个单词${skipped > 0 ? `，${skipped} 个重复已跳过` : ''}`
      : '所有单词已存在，无需导入');
    if (currentBookId) {
      refreshWordList(currentBookId);
    } else {
      refreshManage();
    }
  } else {
    showToast('解析失败，请检查文件格式');
  }
}

// ============== 数据导出/导入备份 ==============
async function exportData() {
  // 选择导出格式
  const format = confirm('点击「确定」导出 JSON（含复习记录和设置）\n点击「取消」导出 CSV（仅单词，可用 Excel 打开）')
    ? 'json' : 'csv';

  const books = await appDB.getAllBooks();
  const words = await appDB.getAllWords();
  const bookMap = {};
  books.forEach(b => bookMap[b.id] = b.name);

  if (format === 'csv') {
    // CSV 导出：英文,中文,词本,熟练度,复习次数
    const header = '英文,中文,词本,熟练度,复习次数,收藏,勾选';
    const rows = words.map(w => {
      const en = `"${(w.english || '').replace(/"/g, '""')}"`;
      const zh = `"${(w.chinese || '').replace(/"/g, '""')}"`;
      const bookName = `"${bookMap[w.bookId] || '默认词本'}"`;
      return [en, zh, bookName, Math.floor(w.proficiency || 0), w.reviewCount || 0, w.isFavorited ? '是' : '否', w.isSelected ? '是' : '否'].join(',');
    }).join('\n');
    const csv = '﻿' + header + '\n' + rows; // BOM for Excel UTF-8
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `单词表_${new Date().toLocaleDateString('zh-CN').replace(/\//g, '-')}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('CSV 导出成功 📤');
  } else {
    // JSON 完整备份
    const records = await appDB.getAllRecords();
    const settingKeys = ['studyDirection', 'algorithm', 'customIntervals', 'nightMode'];
    const settings = {};
    for (const key of settingKeys) {
      settings[key] = await appDB.getSetting(key);
    }
    const data = { version: 1, exportedAt: new Date().toISOString(), books, words, records, settings };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `单词备份_${new Date().toLocaleDateString('zh-CN').replace(/\//g, '-')}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('JSON 备份导出成功 📤');
  }
}

async function importBackup(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  event.target.value = '';

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (!data.version || !data.words) {
      showToast('无效的备份文件格式');
      return;
    }

    if (!confirm('导入备份将替换所有现有数据，确定继续吗？')) return;

    showToast('正在导入...');

    // 清空现有数据（单事务，高效）
    await appDB.clearAllData();

    // 导入词本
    if (data.books) {
      for (const book of data.books) {
        const { id, ...bookData } = book;
        const tx = appDB.db.transaction('word_books', 'readwrite');
        const store = tx.objectStore('word_books');
        await new Promise((resolve, reject) => {
          const req = store.add(bookData);
          req.onsuccess = resolve;
          req.onerror = () => reject(req.error);
        });
      }
    }

    // 导入单词（记录 oldId → newId 映射）
    const idMap = {};
    for (const word of data.words) {
      const oldId = word.id;
      const { id, ...wordData } = word;
      const newId = await appDB.insertWord(wordData);
      if (oldId) idMap[oldId] = newId;
    }

    // 导入复习记录（使用映射后的新 wordId）
    if (data.records) {
      for (const rec of data.records) {
        const { id, ...recData } = rec;
        // 将旧 wordId 映射为新 ID
        recData.wordId = idMap[recData.wordId] || recData.wordId;
        await appDB.insertRecord(recData);
      }
    }

    // 导入设置
    if (data.settings) {
      for (const [key, value] of Object.entries(data.settings)) {
        if (value !== null && value !== undefined) {
          await appDB.setSetting(key, value);
        }
      }
    }

    showToast(`导入成功！共 ${data.words.length} 个单词`);
    await loadSettings();
    switchTab('study');
  } catch (err) {
    showToast('导入失败：' + (err.message || '文件格式错误'));
  }
}

async function resetAllData() {
  if (!confirm('确定清空所有数据？此操作不可撤销！\n建议先导出备份。')) return;
  if (!confirm('再次确认：删除所有词本、单词和学习记录？')) return;

  await appDB.clearAllData();

  // 重置设置
  for (const key of ['studyDirection', 'algorithm', 'customIntervals', 'nightMode']) {
    await appDB.setSetting(key, null);
  }

  // 重建默认词本
  await appDB.createBook('默认词本');

  showToast('已清空所有数据');
  await loadSettings();
  switchTab('study');
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message; toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
}

// ============== 安装引导 ==============
function showInstallGuide() {
  const el = document.getElementById('install-guide');
  if (el.style.display !== 'none') { el.style.display = 'none'; return; }
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isChrome = /chrome/i.test(navigator.userAgent) && !isIOS;
  let guide = '';
  if (isIOS) {
    guide = '📱 <b>Safari 安装步骤：</b><br>1. 点击底部分享按钮 <span style="font-size:18px;">⬆️</span><br>2. 滑动找到「添加到主屏幕」<br>3. 点右上角「添加」';
  } else if (isChrome) {
    guide = '📱 <b>Chrome 安装步骤：</b><br>1. 点击右上角 <span style="font-size:18px;">⋮</span> 菜单<br>2. 选择「添加到主屏幕」<br>3. 点「添加」';
    // 尝试触发 beforeinstallprompt
    if (window.deferredPrompt) {
      window.deferredPrompt.prompt();
    }
  } else {
    guide = '📱 <b>通用步骤：</b><br>1. 打开浏览器菜单<br>2. 找到「添加到主屏幕」或「安装应用」<br>3. 按提示完成添加';
  }
  el.innerHTML = guide;
  el.style.display = 'block';
}

// 监听 beforeinstallprompt（Chrome PWA 安装弹窗）
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.deferredPrompt = e;
});

// ============== 滑动手势 ==============
let touchStartX = 0, touchStartY = 0, touchDiffX = 0;
let swipeAbortController = null;

function setupSwipeGesture() {
  // 移除旧监听器
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


// ============== 退出应用 ==============
function exitApp() {
  if (window.Capacitor?.Plugins?.App) {
    window.Capacitor.Plugins.App.exitApp();
  } else {
    // 浏览器环境：尝试关闭页面
    if (confirm('确认退出？')) {
      window.close();
    }
  }
}

// ============== 初始化 ==============
async function init() {
  await appDB.open();
  // 确保有默认词本
  const books = await appDB.getAllBooks();
  if (books.length === 0) {
    await appDB.createBook('默认词本');
  }
  await loadSettings();
  // 检查 TTS 可用性
  if (!('speechSynthesis' in window)) {
    const btn = document.querySelector('.word-pronounce');
    if (btn) btn.style.opacity = '0.3';
  }
  switchTab('study');

  document.getElementById('file-input').addEventListener('change', onFileSelected);

  // 点击对话框外部关闭
  document.querySelectorAll('.dialog-overlay').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target === el) el.style.display = 'none';
    });
  });

  // 监听 Android 硬件返回键（Capacitor）
  try {
    if (window.Capacitor?.Plugins?.App) {
      const { App } = window.Capacitor.Plugins;
      App.addListener('backButton', () => {
        // 有打开的对话框 → 关闭对话框
        const openDialog = document.querySelector('.dialog-overlay[style*="flex"]');
        if (openDialog) { openDialog.style.display = 'none'; return; }
        // 在全屏页面 → 返回主页
        if (document.getElementById('fullscreen-pages').classList.contains('visible')) { goHome(); return; }
        // 在主页面 → 退出应用
        App.exitApp();
      });
    }
  } catch (_) { /* 非 Capacitor 环境忽略 */ }

  // 监听浏览器返回键（popstate）
  window.addEventListener('popstate', () => {
    if (document.getElementById('fullscreen-pages').classList.contains('visible')) {
      goHome();
    }
  });
  // 进入全屏页面时 push 一个 state，让返回键可拦截
  const origShowFullscreen = showFullscreenPage;
  showFullscreenPage = function(pageId) {
    history.pushState({ page: pageId }, '');
    origShowFullscreen.call(this, pageId);
  };

  // 隐藏启动加载画面
  const splash = document.getElementById('loading-splash');
  if (splash) {
    splash.style.opacity = '0';
    setTimeout(() => splash.style.display = 'none', 400);
  }

  document.getElementById('spell-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (showingAnswer) { handleShowNext(); }
      else { handleSpellCheck(); }
    }
  });

  // 注册 Service Worker（PWA 离线支持）
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init);
