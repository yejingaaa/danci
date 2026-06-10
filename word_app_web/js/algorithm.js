/**
 * 三态记忆算法 v3
 * 基于进度分 0~100：错误(0~33) / 勉强(34~66) / 熟练(67~100)
 */

// 根据进度分获取复习间隔（天）
function getReviewInterval(score) {
  if (score >= 81) return 14;
  if (score >= 61) return 7;
  if (score >= 41) return 3;
  if (score >= 21) return 1;
  return 0.17; // 4小时
}

// 连续熟练递减系数
function getMasteredBonus(consecutiveCorrect) {
  const bonuses = [10, 8, 6, 5, 4, 3, 2, 2, 1, 1];
  const idx = Math.min(consecutiveCorrect, bonuses.length - 1);
  return bonuses[idx];
}

/**
 * 应用三态算法
 * @param {Object} word - 单词对象
 * @param {string} action - 'forgot' | 'struggled' | 'mastered'
 * @returns {Object} 更新后的单词字段
 */
function applyThreeState(word, action) {
  const now = new Date();
  let score = word.progressScore ?? 0;
  let consecutiveCorrect = word.consecutiveCorrect ?? 0;
  let consecutiveWrong = word.consecutiveWrong ?? 0;

  switch (action) {
    case 'forgot': {
      score = Math.max(0, score - 25);
      consecutiveCorrect = 0;
      consecutiveWrong = (consecutiveWrong || 0) + 1;
      // 连续忘了 ≥3 次 → 4小时内再次复习
      const hours = consecutiveWrong >= 3 ? 2 : 4;
      const nextDate = new Date(now);
      nextDate.setHours(nextDate.getHours() + hours);
      return {
        progressScore: score,
        consecutiveCorrect: 0,
        consecutiveWrong,
        lastReviewed: now.toISOString(),
        nextReview: nextDate.toISOString(),
      };
    }

    case 'struggled': {
      score = Math.max(0, score - 5);
      consecutiveCorrect = 0;
      consecutiveWrong = 0;
      // 1 天后复习
      const nextDate = new Date(now);
      nextDate.setDate(nextDate.getDate() + 1);
      return {
        progressScore: score,
        consecutiveCorrect: 0,
        consecutiveWrong: 0,
        lastReviewed: now.toISOString(),
        nextReview: nextDate.toISOString(),
      };
    }

    case 'mastered': {
      const bonus = getMasteredBonus(consecutiveCorrect);
      score = Math.min(100, score + bonus);
      consecutiveCorrect = Math.min((consecutiveCorrect || 0) + 1, 10);
      consecutiveWrong = 0;
      const days = getReviewInterval(score);
      const nextDate = new Date(now);
      nextDate.setDate(nextDate.getDate() + days);
      return {
        progressScore: score,
        consecutiveCorrect,
        consecutiveWrong: 0,
        lastReviewed: now.toISOString(),
        nextReview: nextDate.toISOString(),
      };
    }
  }
}

/**
 * 根据进度分获取状态标签
 */
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

/**
 * 主入口：根据算法名称应用
 */
async function applyAlgorithm(word, action, algorithmName = 'three_state') {
  if (algorithmName === 'sm2') return fallbackSM2(word, action);
  if (algorithmName === 'fixed') return fallbackFixed(word, action);
  return applyThreeState(word, action);
}

// ============== 旧算法保留作为备选 ==============
const SM2_INTERVALS = [0.5, 1, 3, 7, 15, 30, 60];

function fallbackSM2(word, action) {
  const now = new Date();
  let score = word.progressScore ?? 0;
  let consecutiveCorrect = word.consecutiveCorrect ?? 0;

  if (action === 'forgot') {
    consecutiveCorrect = 0;
    score = Math.max(0, score - 25);
    const nextDate = new Date(now);
    nextDate.setHours(nextDate.getHours() + 12);
    return { progressScore: score, consecutiveCorrect, lastReviewed: now.toISOString(), nextReview: nextDate.toISOString() };
  }
  consecutiveCorrect = Math.min(consecutiveCorrect + 1, 10);
  const days = SM2_INTERVALS[Math.min(consecutiveCorrect, SM2_INTERVALS.length - 1)];
  const nextDate = new Date(now);
  nextDate.setDate(nextDate.getDate() + days);
  score = Math.min(100, score + (action === 'struggled' ? 2 : 10));
  return { progressScore: score, consecutiveCorrect, lastReviewed: now.toISOString(), nextReview: nextDate.toISOString() };
}

function fallbackFixed(word, action) {
  const now = new Date();
  let score = word.progressScore ?? 0;
  let consecutiveCorrect = word.consecutiveCorrect ?? 0;

  if (action === 'forgot') {
    consecutiveCorrect = 0;
    score = Math.max(0, score - 25);
    const nextDate = new Date(now);
    nextDate.setDate(nextDate.getDate() + 1);
    return { progressScore: score, consecutiveCorrect, lastReviewed: now.toISOString(), nextReview: nextDate.toISOString() };
  }
  consecutiveCorrect = Math.min(consecutiveCorrect + 1, 10);
  const nextDate = new Date(now);
  nextDate.setDate(nextDate.getDate() + consecutiveCorrect);
  score = Math.min(100, score + (action === 'struggled' ? 2 : 8));
  return { progressScore: score, consecutiveCorrect, lastReviewed: now.toISOString(), nextReview: nextDate.toISOString() };
}
