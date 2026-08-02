require("dotenv").config();

const express = require("express");
const multer = require("multer");
const db = require("./lib/db");
const { hashPassword, verifyPassword, createSession, destroySession, requireAuth } = require("./lib/auth");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;
const MAX_INGREDIENT_NAME_LENGTH = 30;

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const VISION_MODEL = "google/gemma-4-26b-a4b-it:free";
const RECIPE_MODEL = "cohere/north-mini-code:free";
// 주의: 이 값들은 public/app.js에 정의된 동명의 상수(MAX_FILE_SIZE, ALLOWED_TYPES)와
// 반드시 동기화되어야 한다(서버는 별도 런타임이라 모듈을 공유할 수 없음). 한쪽만 바꾸면
// 클라이언트 측 사전 검증과 서버 측 실제 검증이 어긋날 수 있으니 함께 수정할 것.
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB, per PRD_step1
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png"]);
const MAX_INGREDIENTS = 50; // 비정상적으로 큰 입력으로 인한 프롬프트 남용 방지

// AI 모델을 호출하는 엔드포인트는 인증 없이도 쓸 수 있어(비로그인 체험) 요청 횟수를 제한하지 않으면
// 무제한 반복 호출로 OPENROUTER_API_KEY의 무료 한도를 소진시키거나 서버를 마비시킬 수 있다.
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 10;
const rateLimitHits = new Map(); // ip -> { count, windowStart }

// 로그인/회원가입에는 별도의(더 여유 있지만 여전히 유한한) 제한을 둬서 무차별 대입 공격을 방어한다.
// AI 엔드포인트와 윈도우/카운터를 공유하지 않도록 맵을 분리한다.
const AUTH_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15분
const AUTH_RATE_LIMIT_MAX_REQUESTS = 20; // 15분당 IP 하나에서 최대 20회 시도
const authRateLimitHits = new Map(); // ip -> { count, windowStart }

function createRateLimiter(store, windowMs, maxRequests, message) {
  return function rateLimiter(req, res, next) {
    const ip = req.ip;
    const now = Date.now();
    const entry = store.get(ip);
    if (!entry || now - entry.windowStart > windowMs) {
      store.set(ip, { count: 1, windowStart: now });
      return next();
    }
    entry.count += 1;
    if (entry.count > maxRequests) {
      return res.status(429).json({ success: false, error: message });
    }
    return next();
  };
}

const rateLimit = createRateLimiter(
  rateLimitHits,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX_REQUESTS,
  "요청이 너무 많습니다. 잠시 후 다시 시도해주세요."
);

const authRateLimit = createRateLimiter(
  authRateLimitHits,
  AUTH_RATE_LIMIT_WINDOW_MS,
  AUTH_RATE_LIMIT_MAX_REQUESTS,
  "로그인/회원가입 시도가 너무 많습니다. 잠시 후 다시 시도해주세요."
);

// rateLimitHits/authRateLimitHits는 IP별 항목이 계속 쌓이기만 하고 저절로 지워지지 않으므로,
// 각자의 윈도우가 지나 더 이상 유효하지 않은 항목을 주기적으로 청소해 메모리 누수를 막는다.
const RATE_LIMIT_CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10분마다
function cleanupRateLimitStore(store, windowMs) {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now - entry.windowStart > windowMs) {
      store.delete(key);
    }
  }
}
const rateLimitCleanupTimer = setInterval(() => {
  cleanupRateLimitStore(rateLimitHits, RATE_LIMIT_WINDOW_MS);
  cleanupRateLimitStore(authRateLimitHits, AUTH_RATE_LIMIT_WINDOW_MS);
}, RATE_LIMIT_CLEANUP_INTERVAL_MS);
if (typeof rateLimitCleanupTimer.unref === "function") rateLimitCleanupTimer.unref();

if (!process.env.OPENROUTER_API_KEY) {
  console.error("OPENROUTER_API_KEY가 .env에 설정되어 있지 않습니다.");
  process.exit(1);
}

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return cb(new Error("UNSUPPORTED_FILE_TYPE"));
    }
    cb(null, true);
  },
});

app.use(express.static("public"));
app.use(express.json());

function buildIngredientPrompt() {
  return [
    "너는 냉장고 사진을 보고 식재료를 인식하는 어시스턴트다.",
    "이미지에서 실제로 보이는 식재료의 이름만 한국어로 추출해라.",
    "브랜드명, 용기, 조리도구는 제외하고 식재료 이름만 답한다.",
    "다른 설명 없이 아래와 같은 JSON 배열 형식으로만 답해라.",
    '예시 출력: ["계란", "우유", "당근", "대파"]',
    "재료가 하나도 보이지 않으면 빈 배열 []을 반환해라.",
  ].join("\n");
}

function parseIngredients(rawContent) {
  // 모델이 ```json ... ``` 코드블록으로 감싸는 경우 대비
  const stripped = rawContent
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();

  const parsed = JSON.parse(stripped);
  if (!Array.isArray(parsed)) {
    throw new Error("NOT_AN_ARRAY");
  }
  return parsed
    .filter((item) => typeof item === "string" && item.trim().length > 0)
    .map((name) => ({ name: name.trim(), source: "recognized" }));
}

const OPENROUTER_TIMEOUT_MS = 30 * 1000; // OpenRouter가 응답하지 않을 때 요청이 무기한 대기하는 것을 방지

async function chatCompletion(model, messages) {
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages }),
    signal: AbortSignal.timeout(OPENROUTER_TIMEOUT_MS),
  });

  const body = await response.json();
  if (!response.ok) {
    const message = body?.error?.message || `HTTP ${response.status}`;
    throw new Error(message);
  }
  if (body?.error) {
    throw new Error(body.error.message || "MODEL_ERROR");
  }

  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("EMPTY_RESPONSE");
  }
  return content;
}

function callVisionModel(imageDataUrl) {
  return chatCompletion(VISION_MODEL, [
    {
      role: "user",
      content: [
        { type: "text", text: buildIngredientPrompt() },
        { type: "image_url", image_url: { url: imageDataUrl } },
      ],
    },
  ]);
}

const RECIPE_EXAMPLE = JSON.stringify(
  [
    {
      title: "계란 당근 볶음밥",
      ingredients: ["계란", "당근", "밥"],
      missingIngredients: ["식용유", "소금"],
      steps: ["당근을 잘게 썬다.", "팬에 기름을 두르고 계란과 당근을 볶는다.", "밥을 넣고 골고루 볶은 뒤 소금으로 간한다."],
      cookTimeMinutes: 15,
      difficulty: "easy",
    },
  ],
  null,
  0
);

function buildRecipePrompt(ingredients, preferences) {
  const lines = [
    "너는 보유한 식재료로 만들 수 있는 요리를 추천하는 어시스턴트다.",
    `보유 재료: ${ingredients.join(", ")}`,
    "가능한 한 보유 재료를 활용하고, 부족한 재료는 missingIngredients에 최소한으로 나열해라.",
  ];

  if (preferences?.diet) {
    lines.push(`식단 조건: ${preferences.diet}`);
  }
  if (preferences?.spicy) {
    lines.push("매운맛을 선호한다.");
  }
  if (preferences?.maxCookTime) {
    lines.push(`조리 시간은 ${preferences.maxCookTime}분 이내로 맞춰라.`);
  }

  lines.push(
    "2~3개의 레시피를 다른 설명 없이 아래와 같은 JSON 배열 형식으로만 답해라.",
    `예시 출력: ${RECIPE_EXAMPLE}`,
    "steps는 조리 순서대로 나열한 문자열 배열이어야 한다.",
    'difficulty는 "easy", "medium", "hard" 중 하나여야 한다.'
  );

  return lines.join("\n");
}

function parseRecipes(rawContent) {
  const stripped = rawContent
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();

  const parsed = JSON.parse(stripped);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("NOT_A_NONEMPTY_ARRAY");
  }

  return parsed.map((item) => {
    if (
      typeof item.title !== "string" ||
      !Array.isArray(item.ingredients) ||
      !Array.isArray(item.steps)
    ) {
      throw new Error("INVALID_RECIPE_SHAPE");
    }
    return {
      title: item.title.trim(),
      ingredients: item.ingredients.filter((s) => typeof s === "string"),
      missingIngredients: Array.isArray(item.missingIngredients)
        ? item.missingIngredients.filter((s) => typeof s === "string")
        : [],
      steps: item.steps.filter((s) => typeof s === "string"),
      cookTimeMinutes: typeof item.cookTimeMinutes === "number" ? item.cookTimeMinutes : null,
      difficulty: ["easy", "medium", "hard"].includes(item.difficulty) ? item.difficulty : null,
    };
  });
}

function callRecipeModel(ingredients, preferences) {
  return chatCompletion(RECIPE_MODEL, [
    { role: "user", content: buildRecipePrompt(ingredients, preferences) },
  ]);
}

app.post("/api/generate-recipes", rateLimit, async (req, res) => {
  const ingredients = Array.isArray(req.body?.ingredients)
    ? req.body.ingredients
        .filter((s) => typeof s === "string" && s.trim().length > 0)
        .map((s) => s.trim().slice(0, MAX_INGREDIENT_NAME_LENGTH))
        .slice(0, MAX_INGREDIENTS)
    : [];

  if (ingredients.length === 0) {
    return res.status(400).json({ success: false, error: "재료 목록이 비어 있습니다." });
  }

  const preferences = {
    diet: typeof req.body?.preferences?.diet === "string" ? req.body.preferences.diet.slice(0, 100) : "",
    spicy: Boolean(req.body?.preferences?.spicy),
    maxCookTime:
      typeof req.body?.preferences?.maxCookTime === "number" && req.body.preferences.maxCookTime > 0
        ? req.body.preferences.maxCookTime
        : null,
  };

  // PRD 요구사항: 형식 파싱 실패 시 1회 재시도
  let lastRawContent = "";
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const rawContent = await callRecipeModel(ingredients, preferences);
      lastRawContent = rawContent;
      const recipes = parseRecipes(rawContent);
      return res.json({ success: true, recipes });
    } catch (err) {
      lastError = err;
    }
  }

  return res.status(200).json({
    success: false,
    error: lastError?.message || "레시피 결과를 해석하지 못했습니다.",
    raw: lastRawContent,
  });
});

app.post("/api/recognize-ingredients", rateLimit, upload.single("image"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: "이미지 파일이 필요합니다." });
  }

  const dataUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;

  // PRD 요구사항: 형식 파싱 실패 시 1회 재시도
  let lastRawContent = "";
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const rawContent = await callVisionModel(dataUrl);
      lastRawContent = rawContent;
      const ingredients = parseIngredients(rawContent);
      return res.json({ success: true, ingredients });
    } catch (err) {
      lastError = err;
    }
  }

  return res.status(200).json({
    success: false,
    error: lastError?.message || "인식 결과를 해석하지 못했습니다.",
    raw: lastRawContent,
  });
});

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    nickname: user.nickname,
    dietaryPreferences: user.dietaryPreferences,
    allergies: user.allergies,
  };
}

app.post("/api/auth/signup", authRateLimit, (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const nickname = typeof req.body?.nickname === "string" ? req.body.nickname.trim() : "";

  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ success: false, error: "올바른 이메일 형식이 아닙니다." });
  }
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return res.status(400).json({
      success: false,
      error: `비밀번호는 ${MIN_PASSWORD_LENGTH}~${MAX_PASSWORD_LENGTH}자여야 합니다.`,
    });
  }
  if (!nickname) {
    return res.status(400).json({ success: false, error: "닉네임을 입력해주세요." });
  }
  if (db.getUserByEmail(email)) {
    return res.status(409).json({ success: false, error: "이미 가입된 이메일입니다." });
  }

  const user = db.createUser({ email, passwordHash: hashPassword(password), nickname });
  const token = createSession(user.id);
  return res.status(201).json({ success: true, token, user: publicUser(user) });
});

app.post("/api/auth/login", authRateLimit, (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";

  const user = db.getUserByEmail(email);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ success: false, error: "이메일 또는 비밀번호가 올바르지 않습니다." });
  }

  const token = createSession(user.id);
  return res.json({ success: true, token, user: publicUser(user) });
});

app.post("/api/auth/logout", requireAuth, (req, res) => {
  const header = req.headers.authorization || "";
  destroySession(header.slice(7));
  return res.json({ success: true });
});

app.get("/api/profile", requireAuth, (req, res) => {
  const user = db.getUserById(req.userId);
  if (!user) return res.status(404).json({ success: false, error: "사용자를 찾을 수 없습니다." });
  return res.json({ success: true, user: publicUser(user) });
});

app.put("/api/profile", requireAuth, (req, res) => {
  const nickname = typeof req.body?.nickname === "string" ? req.body.nickname.trim() : "";
  if (!nickname) {
    return res.status(400).json({ success: false, error: "닉네임을 입력해주세요." });
  }
  const dietaryPreferences = Array.isArray(req.body?.dietaryPreferences)
    ? req.body.dietaryPreferences.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim())
    : [];
  const allergies = Array.isArray(req.body?.allergies)
    ? req.body.allergies.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim())
    : [];

  const user = db.updateUserProfile(req.userId, { nickname, dietaryPreferences, allergies });
  if (!user) return res.status(404).json({ success: false, error: "사용자를 찾을 수 없습니다." });
  return res.json({ success: true, user: publicUser(user) });
});

app.get("/api/folders", requireAuth, (req, res) => {
  return res.json({ success: true, folders: db.listFoldersByUser(req.userId) });
});

app.post("/api/folders", requireAuth, (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 30) : "";
  if (!name) {
    return res.status(400).json({ success: false, error: "폴더 이름을 입력해주세요." });
  }
  const folder = db.createFolder(req.userId, name);
  return res.status(201).json({ success: true, folder });
});

app.delete("/api/folders/:id", requireAuth, (req, res) => {
  const result = db.deleteFolder(req.userId, req.params.id);
  if (!result.success) {
    return res.status(400).json({ success: false, error: result.error });
  }
  return res.json({ success: true });
});

app.post("/api/recipes", requireAuth, (req, res) => {
  const recipe = req.body?.recipe;
  const sourceIngredients = Array.isArray(req.body?.sourceIngredients)
    ? req.body.sourceIngredients.filter((s) => typeof s === "string")
    : [];
  const folderId = typeof req.body?.folderId === "string" ? req.body.folderId : undefined;

  if (
    !recipe ||
    typeof recipe.title !== "string" ||
    !Array.isArray(recipe.ingredients) ||
    !Array.isArray(recipe.steps)
  ) {
    return res.status(400).json({ success: false, error: "저장할 레시피 정보가 올바르지 않습니다." });
  }

  const saved = db.addRecipe({ userId: req.userId, recipe, sourceIngredients, folderId });
  return res.status(201).json({ success: true, saved });
});

app.get("/api/recipes", requireAuth, (req, res) => {
  const folderId = typeof req.query.folderId === "string" ? req.query.folderId : undefined;
  return res.json({ success: true, recipes: db.listRecipesByUser(req.userId, folderId) });
});

app.delete("/api/recipes/:id", requireAuth, (req, res) => {
  const deleted = db.deleteRecipe(req.userId, req.params.id);
  if (!deleted) return res.status(404).json({ success: false, error: "레시피를 찾을 수 없습니다." });
  return res.json({ success: true });
});

app.post("/api/recipes/:id/rate", requireAuth, (req, res) => {
  const rating = Number(req.body?.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ success: false, error: "평점은 1~5 사이의 정수여야 합니다." });
  }
  const updated = db.rateRecipe(req.userId, req.params.id, rating);
  if (!updated) return res.status(404).json({ success: false, error: "레시피를 찾을 수 없습니다." });
  return res.json({ success: true, recipe: updated });
});

app.post("/api/recipes/:id/cook", requireAuth, (req, res) => {
  const updated = db.markRecipeCooked(req.userId, req.params.id);
  if (!updated) return res.status(404).json({ success: false, error: "레시피를 찾을 수 없습니다." });
  return res.json({ success: true, recipe: updated });
});

app.get("/api/dashboard", requireAuth, (req, res) => {
  return res.json({ success: true, stats: db.getDashboardStats(req.userId) });
});

// multer 에러(용량 초과, 형식 오류 등)를 JSON으로 반환
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ success: false, error: "이미지 용량은 10MB 이하만 가능합니다." });
    }
    return res.status(400).json({ success: false, error: err.message });
  }
  if (err?.message === "UNSUPPORTED_FILE_TYPE") {
    return res.status(400).json({ success: false, error: "JPEG 또는 PNG 이미지만 업로드할 수 있습니다." });
  }
  console.error(err);
  return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Step1 서버 실행 중: http://localhost:${PORT}`);
});
