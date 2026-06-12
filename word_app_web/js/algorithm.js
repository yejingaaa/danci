/**
 * 记忆算法插件系统 v3
 * 支持可插拔算法架构，每个算法实现 schedule() 和 getRatingOptions()
 * 通用记忆工具：不假设任何语言
 */

// ============== 算法注册中心 ==============
window.WordApp = window.WordApp || {};
if (!WordApp.algorithms) WordApp.algorithms = {};

/**
 * 注册一个记忆算法
 * @param {string} name - 算法标识
 * @param {Object} impl - 算法实现
 * @param {string} impl.name - 显示名称
 * @param {Function} impl.getRatingOptions - () => [{value, label, color}]
 * @param {Function} impl.schedule - (item, rating, now) => { memoryState, dueDate }
 */
function registerAlgorithm(name, impl) {
  WordApp.algorithms[name] = impl;
}

// ============== 算法调度入口 ==============

/**
 * 应用算法并返回更新后的字段
 * @param {Object} item - 记忆项对象（含 memoryState）
 * @param {string|number} action - 评价值
 * @param {string} algorithmName - 算法名
 * @returns {Object} 包含 memoryState 和相关字段的更新对象
 */
async function applyAlgorithm(item, action, algorithmName) {
  const algo = WordApp.algorithms[algorithmName];
  if (!algo) {
    console.warn('未知算法:', algorithmName, '，使用 SM-2');
    return WordApp.algorithms['sm2'].schedule(item, action, new Date());
  }
  const now = new Date();
  const result = algo.schedule(item, action, now);
  const ms = result.memoryState;
  const dueDate = result.dueDate instanceof Date ? result.dueDate.toISOString() : result.dueDate;

  return {
    lastReviewed: now.toISOString(),
    nextReview: dueDate,
    memoryState: ms,
  };
}

// ============== SM-2 标准算法（默认） ==============
/**
 * 标准 SM-2 算法
 * 评价等级：0=完全不记得, 1=困难, 2=勉强, 3=良好, 4=完美
 * 0-1 → 遗忘重置，2-4 → 正常递进
 */
registerAlgorithm('sm2', {
  name: 'SM-2 标准',
  description: '基于 EF 易度因子和重复次数的间隔重复算法',

  getRatingOptions() {
    return [
      { value: 0, label: '忘记', color: '#E74C3C' },
      { value: 1, label: '困难', color: '#E67E22' },
      { value: 3, label: '良好', color: '#2ECC71' },
      { value: 4, label: '简单', color: '#27AE60' },
    ];
  },

  schedule(word, rating, now) {
    const ms = word.memoryState?.data || {};
    let ef = ms.ef ?? 2.5;
    let interval = ms.interval ?? 0;
    let repetition = ms.repetition ?? 0;
    const quality = parseInt(rating) || 0;
    const rc = (ms.reviewCount ?? 0) + 1;

    if (quality < 2) {
      // 遗忘：重置重复次数，间隔为 1 天
      repetition = 0;
      interval = 1;
    } else {
      // 正确：递进
      if (repetition === 0) interval = 1;
      else if (repetition === 1) interval = 6;
      else interval = Math.round(interval * ef);
      repetition++;
    }

    // 更新 EF（易度因子）
    ef = ef + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    ef = Math.max(1.3, ef);

    const dueDate = new Date(now);
    dueDate.setDate(dueDate.getDate() + interval);

    const pScore = quality >= 3 ? 100 : quality === 1 ? 34 : 10;

    return {
      memoryState: {
        algorithm: 'sm2',
        data: {
          ef,
          interval,
          repetition,
          progressScore: pScore,
          reviewCount: rc,
          consecutiveCorrect: quality >= 2 ? repetition : 0,
          consecutiveWrong: quality < 2 ? (ms.consecutiveWrong ?? 0) + 1 : 0,
        },
        lastReviewed: now.toISOString(),
        nextReview: dueDate.toISOString(),
      },
      dueDate,
    };
  },
});

// ============== 自定义间隔算法 ==============
/**
 * 用户可配置的自定义间隔序列
 * 正确→前进到下一个间隔，错误→回到第一个间隔
 */
registerAlgorithm('custom_interval', {
  name: '自定义间隔',
  description: '用户自定义间隔天数序列，正确前进、错误归零',

  getRatingOptions() {
    return [
      { value: 'remembered', label: '记得', color: '#2ECC71' },
      { value: 'forgotten', label: '忘了', color: '#E74C3C' },
    ];
  },

  schedule(word, rating, now) {
    const ms = word.memoryState?.data || {};
    let idx = ms.intervalIndex ?? 0;
    const rc = (ms.reviewCount ?? 0) + 1;

    // 获取间隔序列（默认 [1, 3, 5, 10, 20]）
    const intervals = word.customIntervals || WordApp.state?.customIntervals || [1, 3, 5, 10, 20];

    if (rating === 'forgotten') {
      idx = 0;
    } else {
      idx = Math.min(idx + 1, intervals.length - 1);
    }

    const intervalDays = intervals[idx];
    const dueDate = new Date(now);
    dueDate.setDate(dueDate.getDate() + intervalDays);

    const pct = rating === 'remembered' ? Math.min(100, Math.round((idx / Math.max(intervals.length - 1, 1)) * 100)) : Math.max(0, Math.round((idx / Math.max(intervals.length - 1, 1)) * 100) - 25);

    return {
      memoryState: {
        algorithm: 'custom_interval',
        data: {
          intervalIndex: idx,
          intervalDays,
          progressScore: Math.max(0, pct),
          reviewCount: rc,
          consecutiveCorrect: rating === 'remembered' ? (ms.consecutiveCorrect ?? 0) + 1 : 0,
          consecutiveWrong: rating === 'forgotten' ? (ms.consecutiveWrong ?? 0) + 1 : 0,
        },
        lastReviewed: now.toISOString(),
        nextReview: dueDate.toISOString(),
      },
      dueDate,
    };
  },
});

// ============== FSRS-5 算法 ==============
/**
 * FSRS-5 (Free Spaced Repetition Scheduler)
 * 基于稳定性(Stability)、难度(Difficulty)的自适应间隔重复算法
 * 评价等级映射：0→grade 1(忘记), 1→grade 2(困难), 2→grade 3(勉强/通过)
 *            3→grade 4(良好), 4→grade 5(完美)
 * grade < 3 视为失败重置，grade >= 3 视为成功递进
 */
registerAlgorithm('fsrs', {
  name: 'FSRS-5',
  description: '基于稳定性/难度的自适应间隔重复算法',

  // FSRS-5 默认参数 (w[0]~w[18])
  w: [0.4, 0.6, 2.4, 0.1, 0.5, 1.0, 0.1, 0.5, 0.0, 0.1, 0.0, 0.1, 0.2, 0.3, 0.0, 1.0, 0.1, 0.2, 0.1],

  getRatingOptions() {
    return [
      { value: 0, label: '忘记', color: '#E74C3C' },
      { value: 1, label: '困难', color: '#E67E22' },
      { value: 3, label: '良好', color: '#2ECC71' },
      { value: 4, label: '简单', color: '#27AE60' },
    ];
  },

  schedule(word, rating, now) {
    const ms = word.memoryState?.data || {};
    let S = ms.stability || 0;
    let D = ms.difficulty ?? 5.0;
    const rc = (ms.reviewCount || 0) + 1;
    const q = parseInt(rating) || 0;
    const grade = q + 1; // 0,1,3,4 → 1,2,4,5

    if (rc === 1) {
      S = Math.max(0.1, this.w[15] * Math.exp(this.w[16] * (grade - 1)));
      D = Math.max(1, Math.min(10, this.w[2] + this.w[3] * (5 - grade)));
    } else {
      if (grade < 3) {
        S = Math.max(0.1, this.w[11] * Math.pow(D, -this.w[12]) * (Math.pow(S + 1, this.w[13]) - 1) * Math.exp(this.w[14] * (grade - 1)));
      } else {
        const f1 = 1 + this.w[6] * (Math.exp(this.w[7] * (grade - 2)) - 1);
        const f2 = Math.exp(-this.w[8] * D) + this.w[9];
        S = S * f1 * f2;
      }
      const dDelta = this.w[4] * (5 - grade);
      D = Math.max(1, Math.min(10, D + Math.max(-1, Math.min(1, dDelta))));
    }

    const interval = Math.max(1, Math.round(S));
    const dueDate = new Date(now);
    dueDate.setDate(dueDate.getDate() + interval);

    const progressScore = q >= 3 ? 100 : q === 1 ? 34 : 10;

    return {
      memoryState: {
        algorithm: 'fsrs',
        data: {
          stability: S,
          difficulty: D,
          progressScore,
          reviewCount: rc,
          consecutiveCorrect: q >= 2 ? (ms.consecutiveCorrect || 0) + 1 : 0,
          consecutiveWrong: q < 2 ? (ms.consecutiveWrong || 0) + 1 : 0,
        },
        lastReviewed: now.toISOString(),
        nextReview: dueDate.toISOString(),
      },
      dueDate,
    };
  },
});

// ============== 状态辅助函数 ==============

function getScoreState(score) {
  if (score >= 67) return 'mastered';
  if (score >= 34) return 'struggled';
  return 'forgot';
}

function getScoreStateText(score) {
  if (score >= 67) return '熟练';
  if (score >= 34) return '勉强';
  return '错误';
}

function getScoreStateColor(score) {
  if (score >= 67) return '#2ECC71';
  if (score >= 34) return '#FFA500';
  return '#E74C3C';
}
