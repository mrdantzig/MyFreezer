const supabase = require("./supabaseClient");

const DEFAULT_FOLDER_NAME = "default";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

function throwIfError(error, context) {
  if (error) {
    console.error(`${context} 실패:`, error);
    throw new Error(`${context} 중 오류가 발생했습니다.`);
  }
}

function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    nickname: row.nickname,
    dietaryPreferences: row.dietary_preferences || [],
    allergies: row.allergies || [],
    createdAt: row.created_at,
  };
}

function mapFolder(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    createdAt: row.created_at,
  };
}

function mapRecipe(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    recipe: row.recipe,
    sourceIngredients: row.source_ingredients || [],
    folderId: row.folder_id,
    cookCount: row.cook_count || 0,
    rating: row.rating,
    lastCookedAt: row.last_cooked_at,
    savedAt: row.saved_at,
  };
}

async function getUserByEmail(email) {
  const { data, error } = await supabase.from("app_users").select("*").eq("email", email).maybeSingle();
  throwIfError(error, "사용자 조회");
  return mapUser(data);
}

async function getUserById(id) {
  const { data, error } = await supabase.from("app_users").select("*").eq("id", id).maybeSingle();
  throwIfError(error, "사용자 조회");
  return mapUser(data);
}

async function createUser({ email, passwordHash, nickname }) {
  const { data: userRow, error: userError } = await supabase
    .from("app_users")
    .insert({ email, password_hash: passwordHash, nickname })
    .select()
    .single();
  throwIfError(userError, "사용자 생성");

  const { error: folderError } = await supabase
    .from("folders")
    .insert({ user_id: userRow.id, name: DEFAULT_FOLDER_NAME });
  throwIfError(folderError, "기본 폴더 생성");

  return mapUser(userRow);
}

async function updateUserProfile(userId, { nickname, dietaryPreferences, allergies }) {
  const patch = {};
  if (typeof nickname === "string" && nickname.trim()) patch.nickname = nickname.trim();
  if (Array.isArray(dietaryPreferences)) patch.dietary_preferences = dietaryPreferences;
  if (Array.isArray(allergies)) patch.allergies = allergies;

  const { data, error } = await supabase
    .from("app_users")
    .update(patch)
    .eq("id", userId)
    .select()
    .maybeSingle();
  throwIfError(error, "프로필 수정");
  return mapUser(data);
}

async function listFoldersByUser(userId) {
  const { data, error } = await supabase
    .from("folders")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  throwIfError(error, "폴더 목록 조회");
  return (data || []).map(mapFolder);
}

async function getDefaultFolder(userId) {
  const folders = await listFoldersByUser(userId);
  const byName = folders.find((f) => f.name === DEFAULT_FOLDER_NAME);
  if (byName) return byName;
  return folders[0] || null;
}

async function createFolder(userId, name) {
  const { data, error } = await supabase
    .from("folders")
    .insert({ user_id: userId, name })
    .select()
    .single();
  throwIfError(error, "폴더 생성");
  return mapFolder(data);
}

async function deleteFolder(userId, folderId) {
  const { data: target, error: findError } = await supabase
    .from("folders")
    .select("*")
    .eq("id", folderId)
    .eq("user_id", userId)
    .maybeSingle();
  throwIfError(findError, "폴더 조회");
  if (!target) return { success: false, error: "폴더를 찾을 수 없습니다." };

  const defaultFolder = await getDefaultFolder(userId);
  if (defaultFolder && defaultFolder.id === folderId) {
    return { success: false, error: "기본 폴더는 삭제할 수 없습니다." };
  }

  const { count, error: countError } = await supabase
    .from("recipes")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("folder_id", folderId);
  throwIfError(countError, "폴더 내 레시피 확인");
  if (count > 0) {
    return { success: false, error: "폴더에 레시피가 남아있어 삭제할 수 없습니다. 먼저 레시피를 옮기거나 삭제해주세요." };
  }

  const { error: deleteError } = await supabase.from("folders").delete().eq("id", folderId).eq("user_id", userId);
  throwIfError(deleteError, "폴더 삭제");
  return { success: true };
}

async function addRecipe({ userId, recipe, sourceIngredients, folderId }) {
  let resolvedFolderId = null;
  if (folderId) {
    const { data: folderRow } = await supabase
      .from("folders")
      .select("id")
      .eq("id", folderId)
      .eq("user_id", userId)
      .maybeSingle();
    resolvedFolderId = folderRow ? folderRow.id : null;
  }
  if (!resolvedFolderId) {
    const defaultFolder = await getDefaultFolder(userId);
    resolvedFolderId = defaultFolder ? defaultFolder.id : null;
  }

  const { data, error } = await supabase
    .from("recipes")
    .insert({
      user_id: userId,
      recipe,
      source_ingredients: sourceIngredients,
      folder_id: resolvedFolderId,
    })
    .select()
    .single();
  throwIfError(error, "레시피 저장");
  return mapRecipe(data);
}

async function listRecipesByUser(userId, folderId) {
  let query = supabase.from("recipes").select("*").eq("user_id", userId);
  if (folderId) query = query.eq("folder_id", folderId);
  const { data, error } = await query.order("saved_at", { ascending: false });
  throwIfError(error, "레시피 목록 조회");
  return (data || []).map(mapRecipe);
}

async function deleteRecipe(userId, recipeId) {
  const { data, error } = await supabase
    .from("recipes")
    .delete()
    .eq("id", recipeId)
    .eq("user_id", userId)
    .select("id");
  throwIfError(error, "레시피 삭제");
  return (data || []).length > 0;
}

async function rateRecipe(userId, recipeId, rating) {
  const { data, error } = await supabase
    .from("recipes")
    .update({ rating })
    .eq("id", recipeId)
    .eq("user_id", userId)
    .select()
    .maybeSingle();
  throwIfError(error, "레시피 평점 등록");
  return mapRecipe(data);
}

async function markRecipeCooked(userId, recipeId) {
  const { data: existing, error: findError } = await supabase
    .from("recipes")
    .select("cook_count")
    .eq("id", recipeId)
    .eq("user_id", userId)
    .maybeSingle();
  throwIfError(findError, "레시피 조회");
  if (!existing) return null;

  const { data, error } = await supabase
    .from("recipes")
    .update({ cook_count: (existing.cook_count || 0) + 1, last_cooked_at: new Date().toISOString() })
    .eq("id", recipeId)
    .eq("user_id", userId)
    .select()
    .maybeSingle();
  throwIfError(error, "조리 완료 기록");
  return mapRecipe(data);
}

async function getDashboardStats(userId) {
  const [recipes, folders] = await Promise.all([listRecipesByUser(userId), listFoldersByUser(userId)]);
  const now = Date.now();

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
