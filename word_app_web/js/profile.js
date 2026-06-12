/**
 * 个人设置模块 - 设置、数据管理
 */

// 算法名称映射（兼容旧版存储的算法名）
const ALGORITHM_MAP = {
  'sm2': 'sm2',
  'fixed': 'custom_interval',
};

// ============== 动态算法选择器 ==============

/** 从 WordApp.algorithms 动态渲染算法选择按钮 */
function renderAlgorithmControls() {
  const container = document.getElementById('algorithm-control');
  if (!container || !WordApp.algorithms) return;
  container.innerHTML = Object.entries(WordApp.algorithms).map(([key, algo]) =>
    `<button class="seg-btn" data-value="${key}" onclick="setAlgorithm('${key}')">${algo.name}</button>`
  ).join('');
  // 高亮当前选中的算法
  document.querySelectorAll('#algorithm-control .seg-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.value === WordApp.state.algorithmName);
  });
}

// ============== 设置操作 ==============

async function setDailyGoal(val) {
  WordApp.state.dailyGoal = Math.max(1, parseInt(val) || 10);
  await appDB.setSetting('dailyGoal', WordApp.state.dailyGoal);
  refreshHome();
  showToast(`每日目标已设为 ${WordApp.state.dailyGoal}`);
}

async function setAlgorithm(algo) {
  const oldAlgo = WordApp.state.algorithmName;
  WordApp.state.algorithmName = ALGORITHM_MAP[algo] || algo;
  document.querySelectorAll('#algorithm-control .seg-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.value === WordApp.state.algorithmName);
  });
  document.getElementById('custom-interval-area').style.display =
    WordApp.state.algorithmName === 'custom_interval' ? 'block' : 'none';

  // 切换算法时清理所有已存在项的 memoryState.data，防止数据污染
  if (oldAlgo !== WordApp.state.algorithmName) {
    const allWords = await appDB.getAllWords();
    for (const w of allWords) {
      const oldRc = w.memoryState?.data?.reviewCount || 0;
      w.memoryState = {
        algorithm: WordApp.state.algorithmName,
        data: { reviewCount: oldRc },
        lastReviewed: null,
        nextReview: null,
      };
      w.lastReviewed = null;
      w.nextReview = null;
      await appDB.updateWord(w);
    }
  }

  await appDB.setSetting('algorithm', WordApp.state.algorithmName);
  const name = (WordApp.algorithms[WordApp.state.algorithmName] || {}).name || WordApp.state.algorithmName;
  showToast(`已切换为 ${name}，旧数据已清理`);
}

async function saveCustomIntervals() {
  const input = document.getElementById('custom-intervals').value.trim();
  const intervals = input.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n > 0);
  if (intervals.length < 2) {
    showToast('请输入至少2个正整数，用逗号分隔');
    return;
  }
  WordApp.state.customIntervals = intervals;
  await appDB.setSetting('customIntervals', intervals);
  updateIntervalPreview(intervals);
  showToast('自定义间隔已保存');
}

/** 显示间隔序列预览 */
function updateIntervalPreview(intervals) {
  const el = document.getElementById('interval-preview');
  if (!el) return;
  if (!intervals || intervals.length < 2) { el.textContent = ''; return; }
  const steps = intervals.map((d, i) => `第${i + 1}次: ${d}天`).join(' → ');
  el.textContent = steps;
}

async function toggleNightMode() {
  WordApp.state.isNightMode = !WordApp.state.isNightMode;
  document.body.classList.toggle('night-mode', WordApp.state.isNightMode);
  document.documentElement.classList.toggle('night-mode', WordApp.state.isNightMode);
  await appDB.setSetting('nightMode', WordApp.state.isNightMode);
  localStorage.setItem('wordapp_nightMode', WordApp.state.isNightMode);
  document.getElementById('night-toggle').checked = WordApp.state.isNightMode;
}

async function loadSettings() {
  WordApp.state.isNightMode = await appDB.getSetting('nightMode') || false;
  document.body.classList.toggle('night-mode', WordApp.state.isNightMode);
  document.documentElement.classList.toggle('night-mode', WordApp.state.isNightMode);
  localStorage.setItem('wordapp_nightMode', WordApp.state.isNightMode);
  if (document.getElementById('night-toggle')) {
    document.getElementById('night-toggle').checked = WordApp.state.isNightMode;
  }

  // 算法
  let algo = await appDB.getSetting('algorithm') || 'sm2';
  WordApp.state.algorithmName = ALGORITHM_MAP[algo] || algo;

  // 动态渲染算法按钮（此时 WordApp.algorithms 已可用）
  renderAlgorithmControls();
  document.getElementById('custom-interval-area').style.display =
    WordApp.state.algorithmName === 'custom_interval' ? 'block' : 'none';

  // 自定义间隔
  const saved = await appDB.getSetting('customIntervals');
  if (saved) {
    WordApp.state.customIntervals = saved;
    const el = document.getElementById('custom-intervals');
    if (el) el.value = saved.join(',');
    updateIntervalPreview(saved);
  }

  // 每日目标 & 计数
  WordApp.state.dailyGoal = await appDB.getSetting('dailyGoal') || 10;
  WordApp.state.learningDate = await appDB.getSetting('learningDate') || '';
  const today = new Date().toISOString().substring(0, 10);
  if (WordApp.state.learningDate !== today) {
    WordApp.state.dailyNewCount = 0;
    WordApp.state.learningDate = today;
    await appDB.setSetting('learningDate', today);
    await appDB.setSetting('dailyNewCount', 0);
  } else {
    WordApp.state.dailyNewCount = await appDB.getSetting('dailyNewCount') || 0;
  }
  const goalInput = document.getElementById('daily-goal-input');
  if (goalInput) goalInput.value = WordApp.state.dailyGoal;
}
