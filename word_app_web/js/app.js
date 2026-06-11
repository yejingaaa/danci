/**
 * 单词软件 - 主控制器（导航、初始化、共享工具）
 */

// ============== 共享状态命名空间 ==============
window.WordApp = window.WordApp || {};
WordApp.state = {
  // 学习
  studyMode: 'learn',
  wordQueue: [],
  currentWordIndex: 0,
  showingAnswer: false,
  dailyNewCount: 0,
  learningDate: '',

  // 算法
  algorithmName: 'three_state',
  customIntervals: null,

  // 方向
  studyDirection: 'en2cn',

  // 设置
  dailyGoal: 10,
  isNightMode: false,

  // 导航
  currentView: 'home',
};

// ============== 导航系统 ==============
function switchTab(tabName) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const tab = document.querySelector(`.tab-content[data-tab="${tabName}"]`);
  if (tab) tab.classList.add('active');

  const nav = document.querySelector(`.nav-item[data-tab="${tabName}"]`);
  if (nav) nav.classList.add('active');

  WordApp.state.currentView = tabName;

  if (tabName === 'study') refreshHome();
  else if (tabName === 'words') refreshManage();
  else if (tabName === 'stats') safeRefreshStats();

  const titles = { study: '单词软件', words: '词库', stats: '统计', profile: '我的' };
  document.getElementById('page-title').textContent = titles[tabName] || '单词软件';
}

function showFullscreenPage(pageId) {
  document.querySelectorAll('.fullscreen-page').forEach(p => p.classList.remove('active'));
  const page = document.getElementById(`page-${pageId}`);
  if (page) page.classList.add('active');

  document.getElementById('fullscreen-pages').classList.add('visible');
  document.getElementById('bottom-nav').classList.add('hidden');

  if (pageId === 'study') refreshStudy();
  else if (pageId === 'mistake') refreshMistake();
  else if (pageId === 'favorite') refreshFavorite();

  const titles = { study: '学习中', mistake: '错题本', favorite: '收藏本' };
  document.getElementById('page-title').textContent = titles[pageId] || '单词软件';
}

function showSubPage(pageId) {
  showFullscreenPage(pageId);
}

function goHome() {
  document.getElementById('fullscreen-pages').classList.remove('visible');
  document.getElementById('bottom-nav').classList.remove('hidden');
  document.getElementById('page-title').textContent = '单词软件';
  switchTab('study');
}

// ============== 首页 ==============
async function refreshHome() {
  const total = await appDB.getTotalWordCount();
  document.getElementById('stat-total').textContent = total;
  const allWords = total > 0 ? await appDB.getAllWords() : [];
  const learned = allWords.filter(w => (w.progressScore || 0) > 0).length;
  const mastered = allWords.filter(w => w.progressScore >= 67).length;
  const due = await appDB.getDueCount();
  document.getElementById('stat-due').textContent = due;
  document.getElementById('stat-learned').textContent = learned;
  document.getElementById('stat-mastered').textContent = mastered;

  const hint = document.getElementById('home-hint');
  if (total === 0) {
    hint.innerHTML = '现在还没有单词 📭';
    document.getElementById('start-daily-btn').style.display = 'none';
  } else {
    const pct = total > 0 ? Math.round(learned / total * 100) : 0;
    hint.innerHTML = `📊 总进度 <strong>${learned}/${total}</strong> (${pct}%) · 今日已学 <strong>${WordApp.state.dailyNewCount}</strong> 个`;
    document.getElementById('start-daily-btn').style.display = 'block';
  }
}

// ============== 共享工具函数 ==============
function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message; toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============== 全屏模式 ==============
function toggleFullscreen() {
  const el = document.documentElement;
  const rfs = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
  const isFull = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;
  if (!isFull) {
    if (rfs) {
      rfs.call(el).catch(() => showToast('全屏模式被浏览器阻止'));
    } else {
      showToast('当前浏览器不支持全屏模式');
    }
  } else {
    const efs = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
    if (efs) efs.call(document).catch(() => {});
  }
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
    const btn = document.querySelector('.word-pronounce-sm');
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
        const openDialog = document.querySelector('.dialog-overlay[style*="flex"]');
        if (openDialog) { openDialog.style.display = 'none'; return; }
        if (document.getElementById('fullscreen-pages').classList.contains('visible')) { goHome(); return; }
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
      if (WordApp.state.showingAnswer) nextWord();
    }
  });

  // 注册 Service Worker（PWA 离线支持）
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init);
