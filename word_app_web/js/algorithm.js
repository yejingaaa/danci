/**
 * 记忆算法模块
 * 默认：SM-2 变体
 * 可选：固定间隔 / 自定义间隔
 */

// SM-2 标准间隔（天）：第1次复习后间隔
const SM2_INTERVALS = [0.5, 1, 3, 7, 15, 30, 60];

/**
 * SM-2 变体算法
 * @param {Object} word - 单词对象
 * @param {string} action - 'forgot' | 'remembered' | 'mastered'
 * @returns {Object} 更新后的单词字段
 */
function applySM2(word, action) {
  const now = new Date();

  let { proficiency, reviewCount, consecutiveCorrect, lastReviewed, nextReview } = word;

  // 确保默认值
  proficiency = proficiency ?? 0;
  reviewCount = reviewCount ?? 0;
  consecutiveCorrect = consecutiveCorrect ?? 0;

  switch (action) {
    case 'forgot': {
      proficiency = Math.max(0, proficiency - 1);
      consecutiveCorrect = 0;
      reviewCount += 1;
      // 立即复习（最短0.5天）
      const nextDate = new Date(now);
      nextDate.setHours(nextDate.getHours() + 12);
      nextReview = nextDate.toISOString();
      break;
    }

    case 'remembered': {
      // 逐步提升熟练度（每2次升1级），按正常 SM-2 间隔推进
      proficiency = Math.min(5, (proficiency || 0) + 0.5);
      consecutiveCorrect = Math.min(consecutiveCorrect + 1, 10);
      reviewCount += 1;
      const intervalIndex = Math.min(consecutiveCorrect, SM2_INTERVALS.length - 1);
      const days = SM2_INTERVALS[intervalIndex];
      const nextDate = new Date(now);
      nextDate.setDate(nextDate.getDate() + days);
      nextReview = nextDate.toISOString();
      break;
    }

    case 'mastered': {
      proficiency = Math.min(5, proficiency + 1);
      consecutiveCorrect += 1;
      reviewCount += 1;
      // 延长间隔：1, 3, 7, 15, 30, 60 天
      const intervalIndex = Math.min(proficiency, SM2_INTERVALS.length - 1);
      const days = SM2_INTERVALS[intervalIndex];
      const nextDate = new Date(now);
      nextDate.setDate(nextDate.getDate() + days);
      nextReview = nextDate.toISOString();
      break;
    }
  }

  // 错误频率增强：最近3次复习中错误 ≥2 次，间隔减半（≥6小时）
  // 这个逻辑在应用层做，因为需要查历史记录
  // 这里只返回基础计算结果

  lastReviewed = now.toISOString();

  return {
    proficiency,
    reviewCount,
    consecutiveCorrect,
    lastReviewed,
    nextReview,
  };
}

/**
 * 固定间隔算法
 * @param {Object} word
 * @param {string} action
 * @param {number[]} intervals - 自定义间隔数组
 */
function applyFixedInterval(word, action, intervals = [1, 2, 4, 7, 15, 30]) {
  const now = new Date();
  let { proficiency, reviewCount, consecutiveCorrect, lastReviewed, nextReview } = word;

  proficiency = proficiency ?? 0;
  reviewCount = reviewCount ?? 0;
  consecutiveCorrect = consecutiveCorrect ?? 0;

  if (action === 'forgot') {
    proficiency = Math.max(0, proficiency - 1);
    consecutiveCorrect = 0;
    reviewCount += 1;
    // 回到第一阶段
    const nextDate = new Date(now);
    nextDate.setDate(nextDate.getDate() + intervals[0]);
    nextReview = nextDate.toISOString();
  } else if (action === 'remembered' || action === 'mastered') {
    if (action === 'mastered') {
      proficiency = Math.min(5, proficiency + 1);
    } else {
      proficiency = Math.min(5, (proficiency || 0) + 0.5);
    }
    consecutiveCorrect += 1;
    reviewCount += 1;
    const idx = Math.min(consecutiveCorrect - 1, intervals.length - 1);
    const nextDate = new Date(now);
    nextDate.setDate(nextDate.getDate() + intervals[idx]);
    nextReview = nextDate.toISOString();
  }

  lastReviewed = now.toISOString();

  return {
    proficiency,
    reviewCount,
    consecutiveCorrect,
    lastReviewed,
    nextReview,
  };
}

/**
 * 应用错误频率惩罚
 * @param {Object} word - 更新后的单词
 * @param {Array} recentRecords - 最近3次复习记录
 * @returns {Object} 可能被修改的 nextReview
 */
function applyErrorPenalty(word, recentRecords) {
  if (!recentRecords || recentRecords.length < 3) return word;

  const last3 = recentRecords.slice(0, 3);
  const errorCount = last3.filter(r => r.action === 'forgot').length;

  if (errorCount >= 2 && word.nextReview) {
    const original = new Date(word.nextReview).getTime();
    const now = Date.now();
    const halfInterval = Math.max((original - now) / 2, 6 * 60 * 60 * 1000); // ≥6小时
    const newDate = new Date(now + halfInterval);
    word.nextReview = newDate.toISOString();
  }

  return word;
}

/**
 * 根据算法名称和配置应用算法
 */
async function applyAlgorithm(word, action, algorithmName = 'sm2', customIntervals = null) {
  let updated;

  if (algorithmName === 'sm2') {
    updated = applySM2(word, action);
  } else if (algorithmName === 'fixed') {
    const intervals = customIntervals || [1, 2, 4, 7, 15, 30];
    updated = applyFixedInterval(word, action, intervals);
  } else {
    // 自定义间隔
    const intervals = customIntervals || [1, 3, 5, 10, 20];
    updated = applyFixedInterval(word, action, intervals);
  }

  // 应用错误频率惩罚
  const records = await appDB.getRecordsByWordId(word.id, 3);
  updated = applyErrorPenalty(updated, records);

  return {
    ...word,
    ...updated,
  };
}
