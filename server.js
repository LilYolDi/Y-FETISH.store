
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 10000;
const BUCKET = "paid-videos";
const PREVIEW_BUCKET = "preview-videos";

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing Supabase environment variables");
  process.exit(1);
}

if (!process.env.ADMIN_TOKEN) {
  console.error("Missing ADMIN_TOKEN");
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  const blocked = [
    "/server.js",
    "/package.json",
    "/package-lock.json",
    "/supabase.sql",
    "/.env"
  ];

  if (blocked.includes(req.path)) return res.sendStatus(404);
  next();
});

app.use(express.static(__dirname));

function adminOnly(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const expected = process.env.ADMIN_TOKEN;

  const supplied = Buffer.from(token);
  const correct = Buffer.from(expected);

  if (
    supplied.length !== correct.length ||
    !crypto.timingSafeEqual(supplied, correct)
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

function getExtension(mimetype) {
  const extensions = {
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov"
  };

  return extensions[mimetype];
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Каталог: полные файлы не раскрываются
app.get("/api/videos", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("videos")
      .select(
        "id,slug,title,description,price,currency,thumbnail_url,preview_path,created_at"
      )
      .eq("published", true)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const videos = (data || []).map(video => {
      let previewUrl = null;

      if (video.preview_path) {
        const result = supabase.storage
          .from(PREVIEW_BUCKET)
          .getPublicUrl(video.preview_path);

        previewUrl = result.data.publicUrl;
      }

      return {
        id: video.id,
        slug: video.slug,
        title: video.title,
        description: video.description,
        price: video.price,
        currency: video.currency,
        thumbnail_url: video.thumbnail_url,
        preview_url: previewUrl,
        created_at: video.created_at
      };
    });

    res.json(videos);
  } catch (error) {
    console.error("Videos error:", error.message);
    res.status(500).json({ error: "Не удалось загрузить видео" });
  }
});

// Информация о видео
app.get("/api/videos/:slug", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("videos")
      .select(
        "id,slug,title,description,price,currency,thumbnail_url,preview_path,created_at"
      )
      .eq("slug", req.params.slug)
      .eq("published", true)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({ error: "Видео не найдено" });
    }

    let previewUrl = null;

    if (data.preview_path) {
      previewUrl = supabase.storage
        .from(PREVIEW_BUCKET)
        .getPublicUrl(data.preview_path).data.publicUrl;
    }

    res.json({
      id: data.id,
      slug: data.slug,
      title: data.title,
      description: data.description,
      price: data.price,
      currency: data.currency,
      thumbnail_url: data.thumbnail_url,
      preview_url: previewUrl,
      created_at: data.created_at
    });
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
      message: "Заказ создан. Ожидайте инструкцию по оплате.",
      order
    });
  } catch (error) {
    console.error("Order error:", error.message);
    res.status(500).json({ error: "Не удалось создать заказ" });
  }
});

// Создание карточки
app.post("/api/admin/videos", adminOnly, async (req, res) => {
  try {
    const { slug, title, description, price, currency, thumbnail_url } =
      req.body;

    const cleanSlug = String(slug || "").trim().toLowerCase();

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

    const currencies = ["UAH", "EUR", "USD"];
    const selectedCurrency = currencies.includes(currency) ? currency : "UAH";

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
      .select("id,slug,title,price,currency,published")
      .single();

    if (error) throw error;

    res.status(201).json({ video: data });
  } catch (error) {
    console.error("Create video error:", error.message);
    res.status(500).json({
      error: "Не удалось добавить видео. Возможно, такой slug уже существует."
    });
  }
});

// Загрузка полного видео в приватное хранилище
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
        .select("id")
        .eq("id", videoId)
        .maybeSingle();

      if (findError) throw findError;
      if (!video) {
        return res.status(404).json({ error: "Видео не найдено" });
      }

      const extension = getExtension(req.file.mimetype);
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
        message: "Полное видео загружено в приватное хранилище",
        storage_path: storagePath
      });
    } catch (error) {
      console.error("Full video upload error:", error.message);
      res.status(500).json({ error: "Не удалось загрузить видео" });
    }
  }
);

// Загрузка короткого фрагмента в публичное хранилище
app.post(
  "/api/admin/videos/:id/preview",
  adminOnly,
  upload.single("preview"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          error: "Выберите короткий видеофрагмент"
        });
      }

      const videoId = req.params.id;
      if (!/^[0-9a-f-]{36}$/i.test(videoId)) {
        return res.status(400).json({ error: "Неверный ID видео" });
      }

      const { data: video, error: findError } = await supabase
        .from("videos")
        .select("id")
        .eq("id", videoId)
        .maybeSingle();

      if (findError) throw findError;
      if (!video) {
        return res.status(404).json({ error: "Видео не найдено" });
      }

      const extension = getExtension(req.file.mimetype);
      const previewPath = `${video.id}/preview-${Date.now()}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from(PREVIEW_BUCKET)
        .upload(previewPath, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: false
        });

      if (uploadError) throw uploadError;

      const { error: updateError } = await supabase
        .from("videos")
        .update({ preview_path: previewPath })
        .eq("id", video.id);

      if (updateError) {
        await supabase.storage.from(PREVIEW_BUCKET).remove([previewPath]);
        throw updateError;
      }

      const publicUrl = supabase.storage
        .from(PREVIEW_BUCKET)
        .getPublicUrl(previewPath).data.publicUrl;

      res.json({
        message: "Короткий фрагмент загружен",
        preview_path: previewPath,
        preview_url: publicUrl
      });
    } catch (error) {
      console.error("Preview upload error:", error.message);
      res.status(500).json({
        error: "Не удалось загрузить короткий фрагмент"
      });
    }
  }
);

// Публикация видео
app.post("/api/admin/videos/:id/publish", adminOnly, async (req, res) => {
  try {
    const { data: video, error: findError } = await supabase
      .from("videos")
      .select("id,storage_path,title,preview_path")
      .eq("id", req.params.id)
      .maybeSingle();

    if (findError) throw findError;
    if (!video) {
      return res.status(404).json({ error: "Видео не найдено" });
    }

    if (!video.storage_path) {
      return res.status(400).json({
        error: "Сначала загрузите полное видео"
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
    console.error("Publish error:", error.message);
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

// Ошибки загрузки
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
