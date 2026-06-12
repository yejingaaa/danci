/**
 * 词库管理模块 - 词本增删改查、单词列表、搜索、导入导出
 */

// ============== 词本状态 ==============
let currentBookId = null;
let allWordsCache = [];
let currentSearchQuery = '';
let globalSearchTimer = null;
let editingWordId = null;

// 虚拟滚动状态
let virtualScroll = { words: [], itemHeight: 54, rafId: null };

// ============== 词本管理 ==============
async function refreshManage() {
  const books = await appDB.getAllBooks();
  document.getElementById('books-count').textContent = `${books.length} 个词本`;
  const list = document.getElementById('books-list');

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
  document.getElementById('words-view').style.display = 'flex';
  refreshWordList(bookId);
}

function showBooksView() {
  currentBookId = null;
  document.getElementById('books-view').style.display = 'block';
  document.getElementById('words-view').style.display = 'none';
  refreshManage();
}

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
  const filtered = allWordsCache.filter(w => {
    const front = (w.fields?.front || w.english || '').toLowerCase();
    const back = (w.fields?.back || w.chinese || '');
    return front.includes(q) || back.includes(q);
  });
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

    const matched = [];
    for (const w of allWords) {
      const front = (w.fields?.front || w.english || '').toLowerCase();
      const back = (w.fields?.back || w.chinese || '');
      if (front.includes(qLower) || back.includes(q)) {
        matched.push(w);
      }
    }

    if (matched.length === 0) {
      resultsEl.innerHTML = '<div class="empty-state"><span class="empty-state-icon">🔍</span><div class="empty-state-text">没有找到匹配的单词</div></div>';
    } else {
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
          const f = w.fields?.front || w.english || '';
          const b = w.fields?.back || w.chinese || '';
          html += `<div class="word-item" style="cursor:pointer;" onclick="openBook(${w.bookId})">
            <div class="word-info"><div class="word-en">${highlightText(escapeHtml(f), q)}</div><div class="word-zh">${highlightText(escapeHtml(b), q)}</div></div>
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

// ============== 单词列表渲染 ==============
function getWordDisplay(w) {
  const front = w.fields?.front || w.english || '';
  const back = w.fields?.back || w.chinese || '';
  return { en: front, zh: back };
}

function renderWordItemHtml(w) {
  const disp = getWordDisplay(w);
  return `<div class="word-item" data-id="${w.id}">
    <label class="word-checkbox"><input type="checkbox" ${w.isSelected ? 'checked' : ''} onchange="toggleWordSelect(${w.id}, this.checked)"></label>
    <div class="word-info" onclick="showWordDetail(${w.id})" style="cursor:pointer;"><div class="word-en">${escapeHtml(disp.en)}</div><div class="word-zh">${escapeHtml(disp.zh)}</div></div>
    <div class="word-stats">
      <span class="badge ${(w.progressScore || 0) >= 67 ? 'badge-green' : (w.progressScore || 0) >= 34 ? 'badge-orange' : 'badge-gray'}">${getScoreStateText(w.progressScore || 0)}</span>
      <button class="btn-icon" onclick="showEditWord(${w.id})" title="编辑" style="margin-left:2px;">✏️</button>
      <button class="btn-icon" onclick="toggleFavorite(${w.id})" title="收藏" style="margin-left:4px;">${w.isFavorited ? '⭐' : '☆'}</button>
      <button class="btn-icon" onclick="deleteWord(${w.id})" title="删除" style="margin-left:2px;">🗑️</button>
    </div>
  </div>`;
}

function renderWordListVirtual(words, list, count) {
  const ITEM_HEIGHT = 54;
  const BUFFER = 25;

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
  list.style.overflowY = 'auto';
  list.style.maxHeight = 'calc(100vh - 390px)';
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

  if (words.length > 200 && !currentSearchQuery) {
    return renderWordListVirtual(words, list, count);
  }

  list.innerHTML = words.map(w => renderWordItemHtml(w)).join('');
  list.style.overflowY = '';
  list.style.maxHeight = '';
  list.onscroll = null;
}

// ============== 辅助函数 ==============
async function toggleWordSelect(id, selected) { await appDB.toggleSelection(id, selected); }

async function deleteWord(id) {
  if (!confirm('确认删除这个单词？')) return;
  await appDB.deleteWord(id);
  refreshWordList(currentBookId);
}

// ============== 批量操作 ==============
async function toggleSelectAll() {
  const words = allWordsCache;
  if (!words.length) return;
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

function batchMoveSelected() {
  const selected = allWordsCache.filter(w => w.isSelected);
  if (!selected.length) { showToast('请先勾选要移动的单词'); return; }
  const sel = document.getElementById('import-book-select');
  const dialog = document.getElementById('import-dialog');
  document.querySelector('#import-dialog .card-title').textContent = '移动到词本';
  const textarea = document.getElementById('import-text');
  textarea.style.display = 'none';
  appDB.getAllBooks().then(books => {
    sel.innerHTML = books.filter(b => b.id !== currentBookId).map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');
    if (!sel.options.length) { showToast('没有其他词本可移动'); return; }
    dialog.style.display = 'flex';
    document.querySelector('#import-dialog .btn-orange').onclick = async () => {
      const targetBookId = parseInt(sel.value);
      for (const w of selected) {
        w.bookId = targetBookId;
        await appDB.updateWord(w);
      }
      dialog.style.display = 'none';
      textarea.style.display = '';
      document.querySelector('#import-dialog .card-title').textContent = '导入单词';
      document.querySelector('#import-dialog .btn-orange').onclick = handleImport;
      allWordsCache = allWordsCache.filter(w => !w.isSelected);
      showToast(`已移动 ${selected.length} 个单词`);
      refreshWordList(currentBookId);
    };
  });
}

// ============== 词本增删 ==============
function showCreateBookDialog() {
  document.getElementById('create-book-dialog').style.display = 'flex';
  document.getElementById('new-book-name').value = '';
  const sel = document.getElementById('new-book-card-type');
  if (sel) sel.value = '';
}
function closeCreateBookDialog() {
  document.getElementById('create-book-dialog').style.display = 'none';
  const sel = document.getElementById('new-book-card-type');
  if (sel) sel.value = '';
}
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

  const front = word.fields?.front || word.english || '';
  const back = word.fields?.back || word.chinese || '';
  document.getElementById('detail-english').innerHTML = escapeHtml(front);
  document.getElementById('detail-chinese').textContent = '';

  document.getElementById('detail-proficiency').textContent = `${getScoreStateText(getProgressScore(word))} (${getProgressScore(word)}分)`;
  document.getElementById('detail-reviewed').textContent = `${(word.memoryState?.data?.reviewCount || 0)} 次`;
  document.getElementById('detail-consecutive').textContent = `${(word.memoryState?.data?.consecutiveCorrect || 0)} 次`;
  document.getElementById('detail-forgot').textContent = `${forgotCount} 次`;
  document.getElementById('detail-correct-rate').textContent = (rememberedCount + forgotCount) > 0
    ? Math.round(rememberedCount / (rememberedCount + forgotCount) * 100) + '%' : '暂无';
  document.getElementById('detail-history').innerHTML = historyHtml;
  document.getElementById('detail-dialog').style.display = 'flex';
}

function closeDetailDialog() {
  document.getElementById('detail-dialog').style.display = 'none';
}


// ============== 编辑 ==============
function showEditWord(id) {
  editingWordId = id;
  appDB.getWord(id).then(w => {
    if (!w) return;
    document.getElementById('edit-english').value = w.fields?.front || w.english || '';
    document.getElementById('edit-chinese').value = w.fields?.back || w.chinese || '';
    document.getElementById('edit-dialog').style.display = 'flex';
  });
}

function closeEditDialog() {
  document.getElementById('edit-dialog').style.display = 'none';
  editingWordId = null;
}

async function saveEditWord() {
  const frontVal = document.getElementById('edit-english').value.trim();
  const backVal = document.getElementById('edit-chinese').value.trim();
  if (!frontVal || !backVal) { showToast('请填写正面和反面内容'); return; }

  const word = await appDB.getWord(editingWordId);
  if (!word) return;
  word.fields = word.fields || {};
  word.fields.front = frontVal;
  word.fields.back = backVal;
  await appDB.updateWord(word);
  showToast('已更新');
  closeEditDialog();
  refreshManage();
}

// ============== 列映射（CSV 导入增强） ==============

let columnMapContext = null; // { bookId, headers, rows }

/** 常见表头词，用于自动检测 CSV 首行是否为表头 */
const HEADER_PATTERNS = [
  'english', 'word', 'en', '单词', '英文', 'front', '正面',
  'chinese', 'meaning', 'zh', '中文', '释义', 'back', '反面', '翻译',
  'extra', 'note', '备注', '注释', '标签', 'tags',
];

/** 自动检测列映射 */
function detectColumnHeaders(headers) {
  const result = headers.map(() => 'extra');
  const frontPats = ['english', 'word', 'en', '单词', '英文', 'front', '正面', 'vocabulary', 'vocab'];
  const backPats = ['chinese', 'meaning', 'zh', '中文', '释义', 'back', '反面', '翻译', 'translation', 'definition'];

  headers.forEach((h, i) => {
    const lower = h.toLowerCase().trim();
    if (frontPats.some(p => lower === p || lower.startsWith(p) || lower.endsWith(p))) {
      result[i] = 'front';
    } else if (backPats.some(p => lower === p || lower.startsWith(p) || lower.endsWith(p))) {
      result[i] = 'back';
    }
  });

  // 如果没有检测到，默认第一列为 front，第二列为 back
  if (!result.includes('front') && !result.includes('back') && headers.length >= 2) {
    result[0] = 'front';
    result[1] = 'back';
  }
  return result;
}

function showColumnMapDialog(bookId, headers, rows) {
  columnMapContext = { bookId, headers, rows };
  const autoMap = detectColumnHeaders(headers);

  const fieldsHtml = headers.map((h, i) => {
    const detected = autoMap[i] || 'extra';
    return `<div style="margin-bottom:8px;">
      <label style="font-size:14px;color:var(--btn-gray);display:block;margin-bottom:2px;">列 "${escapeHtml(h)}"</label>
      <select class="column-map-select" data-col="${i}" style="width:100%;padding:8px;border:2px solid var(--btn-gray);border-radius:8px;font-size:14px;background:var(--card);color:var(--text);">
        <option value="front" ${detected === 'front' ? 'selected' : ''}>正面 (front)</option>
        <option value="back" ${detected === 'back' ? 'selected' : ''}>反面 (back)</option>
        <option value="extra" ${detected === 'extra' ? 'selected' : ''}>额外字段</option>
        <option value="ignore" ${detected === 'ignore' ? 'selected' : ''}>忽略</option>
      </select>
    </div>`;
  }).join('');

  document.getElementById('column-map-fields').innerHTML = fieldsHtml;
  document.getElementById('column-map-card-type').value = 'basic';
  document.getElementById('column-map-dialog').style.display = 'flex';
}

function closeColumnMapDialog() {
  document.getElementById('column-map-dialog').style.display = 'none';
  columnMapContext = null;
}

async function confirmColumnMap() {
  if (!columnMapContext) return;
  const { bookId, headers, rows } = columnMapContext;

  const selects = document.querySelectorAll('.column-map-select');
  const mapping = {};
  selects.forEach(sel => {
    const col = parseInt(sel.dataset.col);
    mapping[col] = sel.value;
  });

  const cardType = document.getElementById('column-map-card-type').value;

  const words = [];
  for (const row of rows) {
    let front = '', back = '';
    const extraEntries = [];

    Object.keys(mapping).forEach(colIdx => {
      const field = mapping[colIdx];
      const val = (row[colIdx] || '').trim();
      if (field === 'front') front = val;
      else if (field === 'back') back = val;
      else if (field === 'extra' && val) {
        extraEntries.push(`${headers[colIdx]}: ${val}`);
      }
    });

    if (front) {
      words.push({
        fields: { front, back, extra: extraEntries.join(' | ') },
        bookId,
        isSelected: true,
        createdAt: new Date().toISOString(),
      });
    }
  }

  closeColumnMapDialog();

  if (words.length > 0) {
    const inserted = await appDB.insertWordsUnique(words);
    const skipped = words.length - inserted;
    showToast(inserted > 0
      ? `成功导入 ${inserted} 个单词${skipped > 0 ? `，${skipped} 个重复已跳过` : ''}`
      : '所有单词已存在，无需导入');
    if (currentBookId) refreshWordList(currentBookId); else refreshManage();
  } else {
    showToast('没有可导入的单词');
  }
}

// ============== 文件导入 ==============
async function showImportDialog() {
  const sel = document.getElementById('import-book-select');
  const books = await appDB.getAllBooks();
  sel.innerHTML = books.map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');
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
    else { const idx = line.search(/[一-龥]/); if (idx > 0) { parts = [line.substring(0, idx).trim(), line.substring(idx).trim()]; } else { parts = line.split(/\s+/); } }
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

async function handleDirectFileImport() {
  const input = document.getElementById('file-input');
  input.accept = '.txt,.csv,.tsv,.json,.md,.xlsx';
  input.click();
}

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
    const isCSV = file.name.endsWith('.csv') || file.name.endsWith('.tsv');

    if (isCSV) {
      // CSV/TSV：解析为二维数组，检测表头
      const sep = file.name.endsWith('.tsv') ? '\t' : ',';
      const allRows = lines.map(line => line.split(sep).map(c => c.trim().replace(/^"|"$/g, '')));

      if (allRows.length === 0) { showToast('文件为空'); return; }

      // 检测首行是否为表头（匹配常见表头词的比例超过 30%）
      const firstRow = allRows[0];
      const headerMatchCount = firstRow.filter(cell => {
        const lower = cell.toLowerCase().trim();
        return HEADER_PATTERNS.includes(lower) || HEADER_PATTERNS.some(p => lower.startsWith(p) || lower.endsWith(p));
      }).length;
      const isHeader = headerMatchCount > 0 && headerMatchCount >= Math.ceil(firstRow.length * 0.3);

      if (isHeader && firstRow.length >= 2) {
        // 弹出列映射对话框
        const headers = firstRow;
        const dataRows = allRows.slice(1);
        showColumnMapDialog(bookId, headers, dataRows);
        return; // 由对话框的 confirmColumnMap 处理导入
      }

      // 无表头：直接按位置解析（第一列 front，第二列 back）
      for (const row of allRows) {
        if (row.length >= 2) {
          const front = row[0].trim();
          const back = row[1].trim();
          if (front && back) {
            words.push({ english: front, chinese: back, bookId, isSelected: false, createdAt: new Date().toISOString() });
            successCount++;
          }
        }
      }
    } else {
      // TXT/其他：保持原有解析逻辑
      for (const line of lines) {
        let parts;
        if (line.includes(',')) {
          parts = line.split(',');
        } else {
          const idx = line.search(/[一-龥]/);
          if (idx > 0) {
            parts = [line.substring(0, idx).trim(), line.substring(idx).trim()];
          } else {
            parts = line.split(/\s+/);
          }
        }
        if (parts.length >= 2) {
          const english = parts[0].trim();
          const chinese = parts.slice(1).join(',').trim();
          if (english && chinese) {
            words.push({ english, chinese, bookId, isSelected: false, createdAt: new Date().toISOString() });
            successCount++;
          }
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
  const format = confirm('点击「确定」导出 JSON（含复习记录和设置）\n点击「取消」导出 CSV（仅单词，可用 Excel 打开）')
    ? 'json' : 'csv';

  const books = await appDB.getAllBooks();
  const words = await appDB.getAllWords();
  const bookMap = {};
  books.forEach(b => bookMap[b.id] = b.name);

  if (format === 'csv') {
    const header = '英文,中文,词本,熟练度,复习次数,收藏,勾选';
    const rows = words.map(w => {
      const en = `"${(w.english || '').replace(/"/g, '""')}"`;
      const zh = `"${(w.chinese || '').replace(/"/g, '""')}"`;
      const bookName = `"${bookMap[w.bookId] || '默认词本'}"`;
      return [en, zh, bookName, Math.floor(w.progressScore || 0), w.reviewCount || 0, w.isFavorited ? '是' : '否', w.isSelected ? '是' : '否'].join(',');
    }).join('\n');
    const csv = '﻿' + header + '\n' + rows;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `单词表_${new Date().toLocaleDateString('zh-CN').replace(/\//g, '-')}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('CSV 导出成功 📤');
  } else {
    const records = await appDB.getAllRecords();
    const settingKeys = ['algorithm', 'customIntervals', 'nightMode', 'dailyGoal', 'learningDate', 'dailyNewCount'];
    const settings = {};
    for (const key of settingKeys) {
      settings[key] = await appDB.getSetting(key);
    }
    const data = { version: 2, exportedAt: new Date().toISOString(), books, words, records, settings };
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

    await appDB.clearAllData();

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

    const idMap = {};
    for (const word of data.words) {
      const oldId = word.id;
      const { id, ...wordData } = word;
      const newId = await appDB.insertWord(wordData);
      if (oldId) idMap[oldId] = newId;
    }

    if (data.records) {
      for (const rec of data.records) {
        const { id, ...recData } = rec;
        recData.wordId = idMap[recData.wordId] || recData.wordId;
        await appDB.insertRecord(recData);
      }
    }

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

  for (const key of ['algorithm', 'customIntervals', 'nightMode']) {
    await appDB.setSetting(key, null);
  }

  await appDB.createBook('默认词本');

  showToast('已清空所有数据');
  await loadSettings();
  switchTab('study');
}
