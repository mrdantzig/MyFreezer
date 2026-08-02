const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DB_PATH = path.join(__dirname, "..", "data", "db.json");
const DEFAULT_FOLDER_NAME = "default";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

let cachedDb = null;

function ensureDb() {
  if (!fs.existsSync(path.dirname(DB_PATH))) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  }
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ users: [], recipes: [], folders: [] }, null, 2));
  }
}

function migrate(db) {
  let changed = false;
  if (!Array.isArray(db.folders)) {
    db.folders = [];
    changed = true;
  }

  for (const user of db.users) {
    let defaultFolder = db.folders.find((f) => f.userId === user.id);
    if (!defaultFolder) {
      defaultFolder = {
        id: crypto.randomUUID(),
        userId: user.id,
        name: DEFAULT_FOLDER_NAME,
        createdAt: user.createdAt || new Date().toISOString(),
      };
      db.folders.push(defaultFolder);
      changed = true;
    }

    for (const recipe of db.recipes) {
      if (recipe.userId !== user.id) continue;
      if (!recipe.folderId) {
        recipe.folderId = defaultFolder.id;
        changed = true;
      }
      if (typeof recipe.cookCount !== "number") {
        recipe.cookCount = 0;
        changed = true;
      }
      if (recipe.rating === undefined) {
        recipe.rating = null;
        changed = true;
      }
      if (recipe.lastCookedAt === undefined) {
        recipe.lastCookedAt = null;
        changed = true;
      }
    }
  }

  return changed;
}

// 매 요청마다 파일을 다시 읽고 migrate()를 전체 재실행하면 사용자·레시피가 늘어날수록
// 요청마다 O(n) 스캔이 반복되어 느려진다. 프로세스 생존 기간 동안 한 번만 로드/마이그레이션하고
// 이후에는 메모리에 캐시된 객체를 그대로 사용한다.
function loadDb() {
  if (cachedDb) return cachedDb;
  ensureDb();
  const db = JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
  if (migrate(db)) {
    saveDb(db);
  }
  cachedDb = db;
  return cachedDb;
}

// saveDb()는 rateRecipe/markRecipeCooked처럼 사소한 필드 하나만 바뀌어도 호출되는데,
// 매번 fs.*Sync로 전체 DB 파일을 동기적으로 다시 쓰면 요청마다 이벤트 루프가 블로킹되고
// 짧은 시간에 여러 쓰기가 몰릴 때(예: 연속 클릭) 디스크 I/O가 중복된다.
// 그래서 메모리상의 cachedDb는 즉시 갱신해 호출부가 바로 최신 값을 동기적으로 돌려받게 하되,
// 실제 디스크 반영은 짧게 디바운스해서 여러 변경을 한 번의 비동기 쓰기로 묶는다.
const SAVE_DEBOUNCE_MS = 300;
let saveDebounceTimer = null;
let flushInFlight = false;
let flushPendingAfterCurrent = false;

function flushToDisk() {
  if (!cachedDb) return;
  if (flushInFlight) {
    flushPendingAfterCurrent = true;
    return;
  }
  flushInFlight = true;
  const tmpPath = `${DB_PATH}.tmp`;
  const payload = JSON.stringify(cachedDb, null, 2);
  fs.writeFile(tmpPath, payload, (writeErr) => {
    if (writeErr) {
      console.error("DB 저장(쓰기) 실패:", writeErr);
      flushInFlight = false;
      return;
    }
    fs.rename(tmpPath, DB_PATH, (renameErr) => {
      flushInFlight = false;
      if (renameErr) {
        console.error("DB 저장(교체) 실패:", renameErr);
      }
      if (flushPendingAfterCurrent) {
        flushPendingAfterCurrent = false;
        flushToDisk();
      }
    });
  });
}

// 프로세스 종료 시 디바운스 중이던 변경사항이 유실되지 않도록 동기적으로 즉시 flush한다.
function flushToDiskSync() {
  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer);
    saveDebounceTimer = null;
  }
  if (!cachedDb) return;
  const tmpPath = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(cachedDb, null, 2));
  fs.renameSync(tmpPath, DB_PATH);
}

process.on("exit", flushToDiskSync);
process.on("SIGINT", () => {
  flushToDiskSync();
  process.exit(0);
});
process.on("SIGTERM", () => {
  flushToDiskSync();
  process.exit(0);
});

function saveDb(db) {
  // 호출부는 지금까지처럼 동기적으로 최신 상태를 받는다 — 캐시는 즉시 갱신됨.
  cachedDb = db;
  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer);
  }
  saveDebounceTimer = setTimeout(() => {
    saveDebounceTimer = null;
    flushToDisk();
  }, SAVE_DEBOUNCE_MS);
}

function getUserByEmail(email) {
  return loadDb().users.find((u) => u.email === email) || null;
}

function getUserById(id) {
  return loadDb().users.find((u) => u.id === id) || null;
}

function createUser({ email, passwordHash, nickname }) {
  const db = loadDb();
  const user = {
    id: crypto.randomUUID(),
    email,
    passwordHash,
    nickname,
    dietaryPreferences: [],
    allergies: [],
    createdAt: new Date().toISOString(),
  };
  db.users.push(user);
  db.folders.push({
    id: crypto.randomUUID(),
    userId: user.id,
    name: DEFAULT_FOLDER_NAME,
    createdAt: new Date().toISOString(),
  });
  saveDb(db);
  return user;
}

function updateUserProfile(userId, { nickname, dietaryPreferences, allergies }) {
  const db = loadDb();
  const user = db.users.find((u) => u.id === userId);
  if (!user) return null;
  if (typeof nickname === "string" && nickname.trim()) user.nickname = nickname.trim();
  if (Array.isArray(dietaryPreferences)) user.dietaryPreferences = dietaryPreferences;
  if (Array.isArray(allergies)) user.allergies = allergies;
  saveDb(db);
  return user;
}

function listFoldersByUser(userId) {
  return loadDb()
    .folders.filter((f) => f.userId === userId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

function getDefaultFolder(db, userId) {
  const userFolders = db.folders.filter((f) => f.userId === userId);
  // "가장 먼저 생성된 폴더가 곧 기본 폴더"라는 암묵적 순서 가정 대신,
  // 이름(DEFAULT_FOLDER_NAME)으로 먼저 식별을 시도해 더 견고하게 판별한다.
  // 이름이 바뀌었거나(레거시 데이터) 못 찾은 경우에는 기존 방식(최초 생성 폴더)으로 폴백한다.
  const byName = userFolders.find((f) => f.name === DEFAULT_FOLDER_NAME);
  if (byName) return byName;
  const sortedByCreatedAt = userFolders.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  return sortedByCreatedAt[0] || null;
}

function createFolder(userId, name) {
  const db = loadDb();
  const folder = {
    id: crypto.randomUUID(),
    userId,
    name,
    createdAt: new Date().toISOString(),
  };
  db.folders.push(folder);
  saveDb(db);
  return folder;
}

function deleteFolder(userId, folderId) {
  const db = loadDb();
  const target = db.folders.find((f) => f.id === folderId && f.userId === userId);
  if (!target) return { success: false, error: "폴더를 찾을 수 없습니다." };

  const defaultFolder = getDefaultFolder(db, userId);
  if (defaultFolder && defaultFolder.id === folderId) {
    return { success: false, error: "기본 폴더는 삭제할 수 없습니다." };
  }

  const hasRecipes = db.recipes.some((r) => r.userId === userId && r.folderId === folderId);
  if (hasRecipes) {
    return { success: false, error: "폴더에 레시피가 남아있어 삭제할 수 없습니다. 먼저 레시피를 옮기거나 삭제해주세요." };
  }

  db.folders = db.folders.filter((f) => f.id !== folderId);
  saveDb(db);
  return { success: true };
}

function addRecipe({ userId, recipe, sourceIngredients, folderId }) {
  const db = loadDb();
  const resolvedFolderId =
    (folderId && db.folders.some((f) => f.id === folderId && f.userId === userId))
      ? folderId
      : getDefaultFolder(db, userId)?.id || null;

  const saved = {
    id: crypto.randomUUID(),
    userId,
    recipe,
    sourceIngredients,
    folderId: resolvedFolderId,
    cookCount: 0,
    rating: null,
    lastCookedAt: null,
    savedAt: new Date().toISOString(),
  };
  db.recipes.push(saved);
  saveDb(db);
  return saved;
}

function listRecipesByUser(userId, folderId) {
  return loadDb()
    .recipes.filter((r) => r.userId === userId && (!folderId || r.folderId === folderId))
    .sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
}

function deleteRecipe(userId, recipeId) {
  const db = loadDb();
  const before = db.recipes.length;
  db.recipes = db.recipes.filter((r) => !(r.id === recipeId && r.userId === userId));
  saveDb(db);
  return db.recipes.length < before;
}

function rateRecipe(userId, recipeId, rating) {
  const db = loadDb();
  const target = db.recipes.find((r) => r.id === recipeId && r.userId === userId);
  if (!target) return null;
  target.rating = rating;
  saveDb(db);
  return target;
}

function markRecipeCooked(userId, recipeId) {
  const db = loadDb();
  const target = db.recipes.find((r) => r.id === recipeId && r.userId === userId);
  if (!target) return null;
  target.cookCount = (target.cookCount || 0) + 1;
  target.lastCookedAt = new Date().toISOString();
  saveDb(db);
  return target;
}

function getDashboardStats(userId) {
  const db = loadDb();
  const now = Date.now();
  const recipes = db.recipes.filter((r) => r.userId === userId);
  const folders = db.folders.filter((f) => f.userId === userId);

  const savedCount = recipes.length;
  const savedThisWeek = recipes.filter((r) => now - new Date(r.savedAt).getTime() <= WEEK_MS).length;

  const cookCountTotal = recipes.reduce((sum, r) => sum + (r.cookCount || 0), 0);
  const cookedThisMonth = recipes.filter(
    (r) => r.lastCookedAt && now - new Date(r.lastCookedAt).getTime() <= MONTH_MS
  ).length;

  const ratedRecipes = recipes.filter((r) => typeof r.rating === "number");
  const averageRating = ratedRecipes.length
    ? ratedRecipes.reduce((sum, r) => sum + r.rating, 0) / ratedRecipes.length
    : null;

  // folders.map 안에서 매번 recipes.filter를 돌리면 O(folders * recipes)가 되어
  // 레시피가 많아질수록 느려진다. recipes를 한 번만 순회해 folderId별 카운트를 누적한 뒤
  // folders를 매핑하면 O(folders + recipes)로 끝난다.
  const countsByFolderId = new Map();
  for (const r of recipes) {
    countsByFolderId.set(r.folderId, (countsByFolderId.get(r.folderId) || 0) + 1);
  }
  const folderBreakdown = folders.map((f) => ({
    folderId: f.id,
    name: f.name,
    count: countsByFolderId.get(f.id) || 0,
  }));

  return {
    savedCount,
    savedThisWeek,
    cookCountTotal,
    cookedThisMonth,
    averageRating,
    folderCount: folders.length,
    folderBreakdown,
  };
}

module.exports = {
  getUserByEmail,
  getUserById,
  createUser,
  updateUserProfile,
  listFoldersByUser,
  createFolder,
  deleteFolder,
  addRecipe,
  listRecipesByUser,
  deleteRecipe,
  rateRecipe,
  markRecipeCooked,
  getDashboardStats,
};
