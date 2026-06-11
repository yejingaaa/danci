/**
 * 统计模块 - 统计图表、时段切换
 */

// ============== 统计状态 ==============
let statsPeriod = 'day';

// ============== 统计操作 ==============
function switchStatsTab(period) {
  statsPeriod = period;
  document.querySelectorAll('.stat-tab').forEach(t => t.classList.remove('active'));
  const activeTab = document.querySelector(`.stat-tab[data-period="${period}"]`);
  if (activeTab) activeTab.classList.add('active');
  safeRefreshStats();
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
  records.forEach(r => { if (r.reviewedAt) studyDays.add(r.reviewedAt.substring(0, 10)); });

  const startStr = start.toISOString();
  const newWords = allWords.filter(w => w.createdAt >= startStr).length;

  const mistakeCounts = {};
  for (const r of records) { if (r.action === 'forgot' && r.wordId) mistakeCounts[r.wordId] = (mistakeCounts[r.wordId] || 0) + 1; }
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

  const periodLabels = { day: '今日', week: '本周', month: '本月', year: '今年', all: '总计' };
  const title = periodLabels[statsPeriod] || '统计';

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
      + '<div class="stats-ring-label">' + title + '正确率</div>'
      + '<div style="font-size:13px;color:var(--btn-gray);margin-top:4px;">'
      + correctCount + '/' + totalReviews + ' 正确'
      + (prevRecords.length > 0 ? '<span style="opacity:0.6;">（上期 ' + prevAccuracy + '%）</span>' : '')
      + '</div></div></div></div>';

    html += '<div class="stats-card">'
      + '<div class="stats-card-title">📊 学习概览</div>'
      + '<div class="stats-grid">'
      + '<div class="stats-grid-item"><div class="stats-grid-value">' + studyDays.size + '</div><div class="stats-grid-label">学习天数</div></div>'
      + '<div class="stats-grid-item"><div class="stats-grid-value">' + newWords + '</div><div class="stats-grid-label">新学单词</div></div>'
      + '<div class="stats-grid-item"><div class="stats-grid-value">' + totalReviews + '</div><div class="stats-grid-label">复习次数</div></div>'
      + '<div class="stats-grid-item"><div class="stats-grid-value" style="color:' + (accuracy >= 60 ? 'var(--green)' : 'var(--coral)') + '">' + accuracy + '%</div><div class="stats-grid-label">正确率</div></div>'
      + '</div></div>';

    var bc = renderReviewChart(records, start, end);
    if (bc) html += bc;

    if (topMistakeWords.length > 0) {
      html += '<div class="stats-card">'
        + '<div class="stats-card-title">❌ 高频错词</div>'
        + '<div class="stats-mistake-list">';
      for (const {word, count} of topMistakeWords) {
        html += '<div class="stats-mistake-item">'
          + '<span class="stats-mistake-word">' + escapeHtml(word.english) + '</span>'
          + '<span class="stats-mistake-count">错 ' + count + ' 次</span>'
          + '</div>';
      }
      html += '</div></div>';
    }
  } else {
    html += '<div class="stats-card">'
      + '<div class="stats-card-title">📚 学习总览</div>'
      + '<div class="stats-simple-row"><span class="stats-simple-label">📖 总单词数</span><span class="stats-simple-value">' + total + '</span></div>'
      + '<div class="stats-simple-row"><span class="stats-simple-label">🕐 待复习</span><span class="stats-simple-value" style="color:#E74C3C">' + due + '</span></div>'
      + '<div class="stats-simple-row"><span class="stats-simple-label">✅ 已掌握</span><span class="stats-simple-value" style="color:#2ECC71">' + mastered + '</span></div>'
      + '<div class="stats-simple-row"><span class="stats-simple-label">🔄 总复习次数</span><span class="stats-simple-value">' + (totalReviews + prevRecords.length) + '</span></div>'
      + '</div>';
  }

  if (statsPeriod === 'all') {
    html += renderProficiencyChart(allWords);
  }

  html += '<button class="stats-refresh-btn" onclick="safeRefreshStats()">🔄 更新数据</button>';

  document.getElementById('stats-content').innerHTML = html;
}

// 捕获统计错误
async function safeRefreshStats() {
  try {
    await refreshStats();
  } catch (e) {
    document.getElementById('stats-content').innerHTML = '<div class="card" style="text-align:center;padding:40px;color:var(--btn-gray);">统计加载失败：' + escapeHtml(e.message || e) + '</div>';
  }
}

/**
 * Generate daily bar chart HTML from review records
 */
function renderReviewChart(records, start, end) {
  const dayMap = {};
  for (const r of records) {
    if (!r.reviewedAt) continue;
    const d = r.reviewedAt.substring(0, 10);
    if (!dayMap[d]) dayMap[d] = { correct: 0, wrong: 0, total: 0 };
    dayMap[d].total++;
    if (r.action === 'forgot') dayMap[d].wrong++;
    else dayMap[d].correct++;
  }

  const days = [];
  const s = new Date(start), e = new Date(end);
  const diffDays = Math.ceil((e - s) / (1000 * 60 * 60 * 24));
  if (diffDays > 31) return '';

  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().substring(0, 10);
    days.push(key);
  }

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
    const label = d.substring(5);

    if (data && data.correct > 0 && data.wrong > 0) {
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
  return all.filter(r => { if (!r.reviewedAt) return false; const t = new Date(r.reviewedAt).getTime(); return !isNaN(t) && t >= start && t <= end; });
}
