/**
 * IndexedDB 数据库层 v4 - 通用卡片模型
 * 支持多种卡片类型（basic/cloze/multiple_choice）和可插拔记忆算法
 */

const DB_NAME = 'WordAppDB';
const DB_VERSION = 4;

class AppDatabase {
  constructor() { this.db = null; }

  async open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        const oldVersion = event.oldVersion;

        // v1: 初始表
        if (oldVersion < 1) {
          const wordStore = db.createObjectStore('words', { keyPath: 'id', autoIncrement: true });
          wordStore.createIndex('next_review', 'nextReview', { unique: false });
          wordStore.createIndex('is_selected', 'isSelected', { unique: false });
          wordStore.createIndex('is_favorited', 'isFavorited', { unique: false });

          const recordStore = db.createObjectStore('review_records', { keyPath: 'id', autoIncrement: true });
          recordStore.createIndex('word_id', 'wordId', { unique: false });
          recordStore.createIndex('reviewed_at', 'reviewedAt', { unique: false });

          db.createObjectStore('settings', { keyPath: 'key' });
        }

        // v2: 新增单词本 + bookId 索引
        if (oldVersion < 2) {
          if (!db.objectStoreNames.contains('word_books')) {
            db.createObjectStore('word_books', { keyPath: 'id', autoIncrement: true });
          }
          const wordStore = event.target.transaction.objectStore('words');
          if (!wordStore.indexNames.contains('book_id')) {
            wordStore.createIndex('book_id', 'bookId', { unique: false });
          }
        }

        // v3: 三态进度分
        if (oldVersion < 3) {
          const wordStore = event.target.transaction.objectStore('words');
          if (!wordStore.indexNames.contains('progress_score')) {
            wordStore.createIndex('progress_score', 'progressScore', { unique: false });
          }
          // 迁移已有数据：proficiency(0~5) → progressScore(0~100)
          const req = wordStore.openCursor();
          req.onsuccess = () => {
            const cursor = req.result;
            if (cursor) {
              const word = cursor.value;
              if (word.progressScore === undefined || word.progressScore === null) {
                const oldP = word.proficiency ?? 0;
                word.progressScore = Math.round(oldP * 20);
                word.proficiency = undefined;
                cursor.update(word);
              }
              cursor.continue();
            }
          };
        }

        // v4: 通用卡片结构（cardType, fields, memoryState）
        if (oldVersion < 4) {
          const wordStore = event.target.transaction.objectStore('words');
          if (!wordStore.indexNames.contains('card_type')) {
            wordStore.createIndex('card_type', 'cardType', { unique: false });
          }
          // 迁移已有数据：添加 cardType, fields, memoryState
          const req = wordStore.openCursor();
          req.onsuccess = () => {
            const cursor = req.result;
            if (cursor) {
              const word = cursor.value;
              if (!word.cardType) {
                word.cardType = 'basic';
                word.fields = {
                  front: word.english || '',
                  back: word.chinese || '',
                  extra: '',
                };
                word.memoryState = {
                  algorithm: 'three_state',
                  data: {
                    progressScore: word.progressScore ?? 0,
                    reviewCount: word.reviewCount ?? 0,
                    consecutiveCorrect: word.consecutiveCorrect ?? 0,
                    consecutiveWrong: word.consecutiveWrong ?? 0,
                  },
                  lastReviewed: word.lastReviewed ?? null,
                  nextReview: word.nextReview ?? null,
                };
                if (word.isSelected === undefined) word.isSelected = true;
                cursor.update(word);
              }
              cursor.continue();
            }
          };
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve();
      };
      request.onerror = (event) => reject(event.target.error);
    });
  }

  // ==================== 单词本 CRUD ====================

  async createBook(name, cardType) {
    const tx = this.db.transaction('word_books', 'readwrite');
    const store = tx.objectStore('word_books');
    const data = { name, createdAt: new Date().toISOString() };
    if (cardType) data.defaultCardType = cardType;
    return new Promise((resolve, reject) => {
      const req = store.add(data);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async getAllBooks() {
    const tx = this.db.transaction('word_books', 'readonly');
    const store = tx.objectStore('word_books');
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async getBook(id) {
    const tx = this.db.transaction('word_books', 'readonly');
    const store = tx.objectStore('word_books');
    return new Promise((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async deleteBook(id) {
    // 使用批量删除（单事务），替代逐条删除
    await this.deleteWordsByBookInBulk(id);
    // 删除词本本身
    const tx = this.db.transaction('word_books', 'readwrite');
    const store = tx.objectStore('word_books');
    await new Promise((resolve, reject) => {
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  /** 批量删除词本中所有单词及关联的复习记录（单事务） */
  async deleteWordsByBookInBulk(bookId) {
    const tx = this.db.transaction(['words', 'review_records'], 'readwrite');
    const wordStore = tx.objectStore('words');
    const recordStore = tx.objectStore('review_records');
    const wordIndex = wordStore.index('book_id');
    const recordIndex = recordStore.index('word_id');

    // 收集该词本的所有 wordId
    const wordIds = await new Promise((resolve, reject) => {
      const ids = [];
      const req = wordIndex.openCursor(IDBKeyRange.only(bookId));
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          ids.push(cursor.primaryKey);
          cursor.continue();
        } else {
          resolve(ids);
        }
      };
      req.onerror = () => reject(req.error);
    });

    // 删除每个单词及其记录（同一事务内）
    for (const wordId of wordIds) {
      // 删除该单词的所有复习记录
      const recReq = recordIndex.openCursor(IDBKeyRange.only(wordId));
      await new Promise((resolve, reject) => {
        recReq.onsuccess = () => {
          const cursor = recReq.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          } else {
            resolve();
          }
        };
        recReq.onerror = () => reject(recReq.error);
      });
      // 删除单词本身
      wordStore.delete(wordId);
    }

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /** 清空所有数据（单事务，使用 clear() 批量删除） */
  async clearAllData() {
    const tx = this.db.transaction(['words', 'review_records', 'word_books'], 'readwrite');
    tx.objectStore('words').clear();
    tx.objectStore('review_records').clear();
    tx.objectStore('word_books').clear();
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /** 获取某个词本下的单词数（使用索引 count，避免加载全部单词） */
  async getWordCountByBook(bookId) {
    const tx = this.db.transaction('words', 'readonly');
    const store = tx.objectStore('words');
    const index = store.index('book_id');
    return new Promise((resolve, reject) => {
      const req = index.count(IDBKeyRange.only(bookId));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // ==================== 通用卡片标准化 ====================

  /**
   * 将单词对象标准化为通用卡片格式（向后兼容）
   * - 旧格式（english/chinese/progressScore）→ 添加 cardType/fields/memoryState
   * - 新格式 → 确保 flat 字段 (english/chinese/progressScore) 同步
   */
  _normalizeWord(word) {
    if (!word) return word;

    if (word.cardType) {
      // 新格式：确保向后兼容的 flat 字段存在
      if (word.english === undefined && word.fields) {
        word.english = word.fields.front || '';
        word.chinese = word.fields.back || '';
      }
      if (word.progressScore === undefined && word.memoryState?.data) {
        word.progressScore = word.memoryState.data.progressScore ?? 0;
        word.reviewCount = word.memoryState.data.reviewCount ?? 0;
        word.consecutiveCorrect = word.memoryState.data.consecutiveCorrect ?? 0;
        word.consecutiveWrong = word.memoryState.data.consecutiveWrong ?? 0;
      }
      if (word.isSelected === undefined) word.isSelected = true;
      return word;
    }

    // 旧格式：添加新结构（不破坏旧字段）
    word.cardType = 'basic';
    word.fields = word.fields || {
      front: word.english || '',
      back: word.chinese || '',
      extra: '',
    };
    word.memoryState = word.memoryState || {
      algorithm: 'three_state',
      data: {
        progressScore: word.progressScore ?? 0,
        reviewCount: word.reviewCount ?? 0,
        consecutiveCorrect: word.consecutiveCorrect ?? 0,
        consecutiveWrong: word.consecutiveWrong ?? 0,
      },
      lastReviewed: word.lastReviewed ?? null,
      nextReview: word.nextReview ?? null,
    };
    if (word.isSelected === undefined) word.isSelected = true;
    return word;
  }

  // ==================== 单词 CRUD（支持词本） ====================

  async insertWord(word) {
    const tx = this.db.transaction('words', 'readwrite');
    const store = tx.objectStore('words');
    // 兼容旧格式（flat english/chinese）和新格式（fields.front/back）
    const front = word.english || word.fields?.front || '';
    const back = word.chinese || word.fields?.back || '';
    const data = {
      bookId: word.bookId ?? 1,
      english: front,
      chinese: back,
      cardType: word.cardType || 'basic',
      fields: word.fields || { front, back, extra: '' },
      memoryState: word.memoryState || {
        algorithm: 'three_state',
        data: {
          progressScore: word.progressScore ?? 0,
          reviewCount: word.reviewCount ?? 0,
          consecutiveCorrect: word.consecutiveCorrect ?? 0,
          consecutiveWrong: word.consecutiveWrong ?? 0,
        },
        lastReviewed: word.lastReviewed ?? null,
        nextReview: word.nextReview ?? null,
      },
      progressScore: word.progressScore ?? 0,
      reviewCount: word.reviewCount ?? 0,
      consecutiveCorrect: word.consecutiveCorrect ?? 0,
      consecutiveWrong: word.consecutiveWrong ?? 0,
      lastReviewed: word.lastReviewed ?? null,
      nextReview: word.nextReview ?? null,
      isFavorited: word.isFavorited ?? false,
      isSelected: word.isSelected ?? false,
      createdAt: word.createdAt ?? new Date().toISOString(),
    };
    return new Promise((resolve, reject) => {
      const req = store.add(data);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async insertWords(words) {
    for (const word of words) {
      await this.insertWord(word);
    }
  }

  /** 批量插入单词，自动跳过同词本中已存在的（按英文/正面去重） */
  async insertWordsUnique(words) {
    const existing = await this.getWordsByBook(words[0]?.bookId || 1);
    // 兼容旧格式 english 和新格式 fields.front
    const existingMap = new Set(existing.map(w => (w.english || w.fields?.front || '').toLowerCase().trim()));
    let count = 0;
    for (const word of words) {
      const front = (word.english || word.fields?.front || '').toLowerCase().trim();
      if (!existingMap.has(front)) {
        await this.insertWord(word);
        count++;
        existingMap.add(front); // 去重集合也更新，避免同批重复
      }
    }
    return count;
  }

  async getAllWords() {
    const tx = this.db.transaction('words', 'readonly');
    const store = tx.objectStore('words');
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => {
        const words = req.result || [];
        resolve(words.map(w => this._normalizeWord(w)));
      };
      req.onerror = () => reject(req.error);
    });
  }

  async getWordsByBook(bookId) {
    const tx = this.db.transaction('words', 'readonly');
    const store = tx.objectStore('words');
    const index = store.index('book_id');
    return new Promise((resolve, reject) => {
      const req = index.getAll(IDBKeyRange.only(bookId));
      req.onsuccess = () => {
        const words = req.result || [];
        resolve(words.map(w => this._normalizeWord(w)));
      };
      req.onerror = () => reject(req.error);
    });
  }

  async getSelectedWords(bookId) {
    const all = bookId ? await this.getWordsByBook(bookId) : await this.getAllWords();
    return all.filter(w => w.isSelected);
  }

  async getDueWords(bookId) {
    const all = bookId ? await this.getSelectedWords(bookId) : await this.getSelectedWords();
    const today = new Date().toISOString().substring(0, 10);
    return all.filter(w => {
      if (!w.nextReview) return true;
      return w.nextReview.substring(0, 10) <= today;
    });
  }

  async getWord(id) {
    const tx = this.db.transaction('words', 'readonly');
    const store = tx.objectStore('words');
    return new Promise((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(this._normalizeWord(req.result));
      req.onerror = () => reject(req.error);
    });
  }

  async updateWord(word) {
    // 同步 flat 字段 → memoryState（确保两种表示一致）
    if (word.memoryState?.data) {
      word.memoryState.data.progressScore = word.progressScore ?? 0;
      word.memoryState.data.reviewCount = word.reviewCount ?? 0;
      word.memoryState.data.consecutiveCorrect = word.consecutiveCorrect ?? 0;
      word.memoryState.data.consecutiveWrong = word.consecutiveWrong ?? 0;
    }
    if (word.memoryState) {
      word.memoryState.lastReviewed = word.lastReviewed ?? null;
      word.memoryState.nextReview = word.nextReview ?? null;
    }
    // 同步 flat english/chinese ↔ fields.front/back
    if (word.fields) {
      word.fields.front = word.english ?? word.fields.front ?? '';
      word.fields.back = word.chinese ?? word.fields.back ?? '';
    }
    const tx = this.db.transaction('words', 'readwrite');
    const store = tx.objectStore('words');
    return new Promise((resolve, reject) => {
      const req = store.put(word);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async deleteWord(id) {
    const tx = this.db.transaction('words', 'readwrite');
    const store = tx.objectStore('words');
    await new Promise((resolve, reject) => {
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    const records = await this.getRecordsByWordId(id);
    for (const rec of records) {
      await this.deleteRecord(rec.id);
    }
  }

  async toggleSelection(id, selected) {
    const word = await this.getWord(id);
    word.isSelected = selected;
    await this.updateWord(word);
  }

  // ==================== 复习记录 ====================

  async insertRecord(record) {
    const tx = this.db.transaction('review_records', 'readwrite');
    const store = tx.objectStore('review_records');
    const data = { wordId: record.wordId, action: record.action, reviewedAt: record.reviewedAt ?? new Date().toISOString() };
    return new Promise((resolve, reject) => {
      const req = store.add(data);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async getRecordsByWordId(wordId, limit = 20) {
    const tx = this.db.transaction('review_records', 'readonly');
    const store = tx.objectStore('review_records');
    const index = store.index('word_id');
    return new Promise((resolve, reject) => {
      const req = index.getAll(wordId);
      req.onsuccess = () => {
        let results = req.result || [];
        results.sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt));
        resolve(results.slice(0, limit));
      };
      req.onerror = () => reject(req.error);
    });
  }

  async getAllRecords() {
    const tx = this.db.transaction('review_records', 'readonly');
    const store = tx.objectStore('review_records');
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async deleteRecord(id) {
    const tx = this.db.transaction('review_records', 'readwrite');
    const store = tx.objectStore('review_records');
    return new Promise((resolve, reject) => {
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async getFavoritedWords(bookId) {
    const all = bookId ? await this.getWordsByBook(bookId) : await this.getAllWords();
    return all.filter(w => w.isFavorited);
  }

  async toggleFavorite(id) {
    const word = await this.getWord(id);
    word.isFavorited = !word.isFavorited;
    await this.updateWord(word);
    return word.isFavorited;
  }

  async getMistakeWords(bookId) {
    const tx = this.db.transaction('review_records', 'readonly');
    const store = tx.objectStore('review_records');
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = async () => {
        const allRecords = req.result || [];
        const forgotWordIds = new Set();
        allRecords.filter(r => r.action === 'forgot').forEach(r => forgotWordIds.add(r.wordId));
        const words = [];
        for (const id of forgotWordIds) {
          const word = await this.getWord(id);
          if (word && (!bookId || (word.bookId || 1) === bookId)) words.push(word);
        }
        resolve(words);
      };
      req.onerror = () => reject(req.error);
    });
  }

  // ==================== 设置 ====================

  async setSetting(key, value) {
    const tx = this.db.transaction('settings', 'readwrite');
    const store = tx.objectStore('settings');
    return new Promise((resolve, reject) => {
      const req = store.put({ key, value });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async getSetting(key) {
    const tx = this.db.transaction('settings', 'readonly');
    const store = tx.objectStore('settings');
    return new Promise((resolve, reject) => {
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result?.value);
      req.onerror = () => reject(req.error);
    });
  }

  // ==================== 统计 ====================

  async getDueCount(bookId) {
    const due = await this.getDueWords(bookId);
    return due.length;
  }

  async getMasteredCount(bookId) {
    const all = bookId ? await this.getWordsByBook(bookId) : await this.getAllWords();
    return all.filter(w => w.progressScore >= 67).length;
  }

  async getTotalWordCount(bookId) {
    const all = bookId ? await this.getWordsByBook(bookId) : await this.getAllWords();
    return all.length;
  }
}

const appDB = new AppDatabase();