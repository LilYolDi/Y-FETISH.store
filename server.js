```javascript
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 10000;
const BUCKET = "paid-videos";

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

if (!process.env.ADMIN_TOKEN) {
  console.error("Missing ADMIN_TOKEN environment variable");
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// Файлы сайта находятся в корневой папке репозитория.
app.use((req, res, next) => {
  const blocked = [
    "/server.js",
    "/package.json",
    "/package-lock.json",
    "/supabase.sql",
    "/.env"
  ];

  if (blocked.includes(req.path)) {
    return res.sendStatus(404);
  }

  next();
});

app.use(express.static(__dirname));

function adminOnly(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ")
    ? header.slice(7)
    : "";

  const expected = process.env.ADMIN_TOKEN;

  const suppliedBuffer = Buffer.from(token);
  const expectedBuffer = Buffer.from(expected);

  if (
    suppliedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) {
    return res.status(401).json({ error: "Нет доступа" });
  }

  next();
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      "video/mp4",
      "video/webm",
      "video/quicktime"
    ];

    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("Разрешены только MP4, WebM и MOV"));
    }

    cb(null, true);
  }
});

// Главная страница
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Проверка сервера
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Опубликованные видео
app.get("/api/videos", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("videos")
      .select("id,slug,title,description,price,currency,thumbnail_url,created_at")
      .eq("published", true)
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json(data || []);
  } catch (error) {
    console.error("Videos error:", error.message);
    res.status(500).json({ error: "Не удалось загрузить видео" });
  }
});

// Информация об одном опубликованном видео
app.get("/api/videos/:slug", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("videos")
      .select("id,slug,title,description,price,currency,thumbnail_url,created_at")
      .eq("slug", req.params.slug)
      .eq("published", true)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({ error: "Видео не найдено" });
    }

    res.json(data);
  } catch (error) {
    console.error("Video details error:", error.message);
    res.status(500).json({ error: "Не удалось загрузить видео" });
  }
});

// Создание заказа
app.post("/api/orders", async (req, res) => {
  try {
    const { video_id, contact } = req.body;

    if (!video_id || !contact || !String(contact).trim()) {
      return res.status(400).json({
        error: "Укажите видео и контакт для связи"
      });
    }

    const { data: video, error: videoError } = await supabase
      .from("videos")
      .select("id,price,currency")
      .eq("id", video_id)
      .eq("published", true)
      .maybeSingle();

    if (videoError) throw videoError;

    if (!video) {
      return res.status(404).json({ error: "Видео не найдено" });
    }

    const { data: order, error } = await supabase
      .from("orders")
      .insert({
        video_id: video.id,
        contact: String(contact).trim().slice(0, 300),
        amount: video.price,
        currency: video.currency,
        status: "pending"
      })
      .select("id,status,amount,currency")
      .single();

    if (error) throw error;

    res.status(201).json({
      message: "Заказ создан. Оплата пока не подключена.",
      order
    });
  } catch (error) {
    console.error("Order error:", error.message);
    res.status(500).json({ error: "Не удалось создать заказ" });
  }
});

// Добавление видео в каталог администратором
app.post("/api/admin/videos", adminOnly, async (req, res) => {
  try {
    const { slug, title, description, price, currency, thumbnail_url } =
      req.body;

    const cleanSlug = String(slug || "")
      .trim()
      .toLowerCase();

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(cleanSlug)) {
      return res.status(400).json({
        error: "Slug: только английские буквы, цифры и дефисы"
      });
    }

    if (!String(title || "").trim()) {
      return res.status(400).json({ error: "Укажите название видео" });
    }

    const numericPrice = Number(price);

    if (!Number.isFinite(numericPrice) || numericPrice < 0) {
      return res.status(400).json({ error: "Неверная цена" });
    }

    const validCurrencies = ["UAH", "EUR", "USD"];
    const selectedCurrency = validCurrencies.includes(currency)
      ? currency
      : "UAH";

    const { data, error } = await supabase
      .from("videos")
      .insert({
        slug: cleanSlug,
        title: String(title).trim(),
        description: String(description || "").trim(),
        price: numericPrice,
        currency: selectedCurrency,
        thumbnail_url: thumbnail_url || null,
        published: false
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json(data);
  } catch (error) {
    console.error("Create video error:", error.message);
    res.status(500).json({
      error: "Не удалось добавить видео. Возможно, такой slug уже существует."
    });
  }
});

// Загрузка видео в приватное хранилище Supabase
app.post(
  "/api/admin/videos/:id/upload",
  adminOnly,
  upload.single("video"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Выберите видеофайл" });
      }

      const videoId = req.params.id;

      if (!/^[0-9a-f-]{36}$/i.test(videoId)) {
        return res.status(400).json({ error: "Неверный ID видео" });
      }

      const { data: video, error: findError } = await supabase
        .from("videos")
        .select("id,slug")
        .eq("id", videoId)
        .maybeSingle();

      if (findError) throw findError;

      if (!video) {
        return res.status(404).json({ error: "Видео не найдено" });
      }

      const extensionMap = {
        "video/mp4": "mp4",
        "video/webm": "webm",
        "video/quicktime": "mov"
      };

      const extension = extensionMap[req.file.mimetype];
      const storagePath = `${video.id}/${Date.now()}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: false
        });

      if (uploadError) throw uploadError;

      const { error: updateError } = await supabase
        .from("videos")
        .update({ storage_path: storagePath })
        .eq("id", video.id);

      if (updateError) {
        await supabase.storage.from(BUCKET).remove([storagePath]);
        throw updateError;
      }

      res.json({
        message: "Видео загружено в приватное хранилище",
        storage_path: storagePath
      });
    } catch (error) {
      console.error("Upload video error:", error.message);
      res.status(500).json({ error: "Не удалось загрузить видео" });
    }
  }
);

// Публикация видео после загрузки файла
app.post("/api/admin/videos/:id/publish", adminOnly, async (req, res) => {
  try {
    const { data: video, error: findError } = await supabase
      .from("videos")
      .select("id,storage_path,title")
      .eq("id", req.params.id)
      .maybeSingle();

    if (findError) throw findError;

    if (!video) {
      return res.status(404).json({ error: "Видео не найдено" });
    }

    if (!video.storage_path) {
      return res.status(400).json({
        error: "Сначала загрузите видеофайл"
      });
    }

    const { data, error } = await supabase
      .from("videos")
      .update({ published: true })
      .eq("id", video.id)
      .select("id,slug,title,published")
      .single();

    if (error) throw error;

    res.json(data);
  } catch (error) {
    console.error("Publish video error:", error.message);
    res.status(500).json({ error: "Не удалось опубликовать видео" });
  }
});

// Просмотр заказов администратором
app.get("/api/admin/orders", adminOnly, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("orders")
      .select("id,video_id,contact,amount,currency,status,created_at")
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json(data || []);
  } catch (error) {
    console.error("Orders error:", error.message);
    res.status(500).json({ error: "Не удалось загрузить заказы" });
  }
});

// Обработка ошибок
app.use((err, req, res, next) => {
  console.error("Server error:", err.message);

  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({
      error: "Файл слишком большой. Максимум 500 МБ."
    });
  }

  if (err.message && err.message.startsWith("Разрешены только")) {
    return res.status(400).json({ error: err.message });
  }

  res.status(500).json({ error: "Внутренняя ошибка сервера" });
});

app.listen(PORT, () => {
  console.log(`FETISH VIDEO STORE running on port ${PORT}`);
});
```
