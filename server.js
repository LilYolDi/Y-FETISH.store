const express = require("express");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 10000;
const BUCKET = "paid-videos";

if (
  !process.env.SUPABASE_URL ||
  !process.env.SUPABASE_SERVICE_ROLE_KEY ||
  !process.env.ADMIN_TOKEN
) {
  console.error("Missing required environment variables.");
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

function adminOnly(req, res, next) {
  const token = req.headers.authorization || "";
  const supplied = Buffer.from(token.replace(/^Bearer /, ""));
  const expected = Buffer.from(process.env.ADMIN_TOKEN);

  if (
    supplied.length !== expected.length ||
    !crypto.timingSafeEqual(supplied, expected)
  ) {
    return res.status(401).json({ error: "Нет доступа" });
  }

  next();
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 500 * 1024 * 1024
  },
  fileFilter(req, file, cb) {
    const allowed = [
      "video/mp4",
      "video/webm",
      "video/quicktime"
    ];

    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("Разрешены MP4, WebM и MOV"));
    }

    cb(null, true);
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

/* Каталог опубликованных видео */
app.get("/api/videos", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("videos")
      .select(
        "id,slug,title,description,price,currency,thumbnail_url,created_at"
      )
      .eq("published", true)
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json(data || []);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({
      error: "Ошибка загрузки каталога"
    });
  }
});

/* Информация об отдельном видео */
app.get("/api/videos/:slug", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("videos")
      .select(
        "id,slug,title,description,price,currency,thumbnail_url,created_at"
      )
      .eq("slug", req.params.slug)
      .eq("published", true)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({
        error: "Видео не найдено"
      });
    }

    res.json(data);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({
      error: "Ошибка загрузки видео"
    });
  }
});

/* Создание заказа */
app.post("/api/orders", async (req, res) => {
  try {
    const videoId = String(req.body.video_id || "").trim();
    const contact = String(req.body.contact || "").trim();

    if (!videoId || !contact || contact.length > 200) {
      return res.status(400).json({
        error: "Укажи видео и контакт для связи"
      });
    }

    const { data: video, error: videoError } = await supabase
      .from("videos")
      .select("id,price,currency")
      .eq("id", videoId)
      .eq("published", true)
      .maybeSingle();

    if (videoError) throw videoError;

    if (!video) {
      return res.status(404).json({
        error: "Видео не найдено"
      });
    }

    const { data: order, error } = await supabase
      .from("orders")
      .insert({
        video_id: video.id,
        contact,
        amount: video.price,
        currency: video.currency,
        status: "pending"
      })
      .select("id,amount,currency,status,created_at")
      .single();

    if (error) throw error;

    res.status(201).json({
      message: "Заказ создан. Ожидает оплаты.",
      order
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({
      error: "Ошибка создания заказа"
    });
  }
});

/* Добавление карточки видео */
app.post("/api/admin/videos", adminOnly, async (req, res) => {
  try {
    const title = String(req.body.title || "").trim();
    const description = String(req.body.description || "").trim();

    const slug = String(req.body.slug || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "");

    const price = Number(req.body.price);
    const currency = String(req.body.currency || "UAH").toUpperCase();

    if (
      !title ||
      !slug ||
      !Number.isFinite(price) ||
      price < 0 ||
      !["UAH", "EUR", "USD"].includes(currency)
    ) {
      return res.status(400).json({
        error: "Проверь название, адрес и цену"
      });
    }

    const { data, error } = await supabase
      .from("videos")
      .insert({
        title,
        slug,
        description,
        price,
        currency,
        published: false
      })
      .select("id,slug,title,price,currency,published")
      .single();

    if (error) throw error;

    res.status(201).json({ video: data });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({
      error: "Не удалось создать видео"
    });
  }
});

/* Загрузка видео в приватное хранилище */
app.post(
  "/api/admin/videos/:id/upload",
  adminOnly,
  upload.single("video"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          error: "Выбери видеофайл"
        });
      }

      const extensions = {
        "video/mp4": "mp4",
        "video/webm": "webm",
        "video/quicktime": "mov"
      };

      const extension = extensions[req.file.mimetype];

      if (!extension) {
        return res.status(400).json({
          error: "Неподдерживаемый формат"
        });
      }

      const { data: video, error: lookupError } = await supabase
        .from("videos")
        .select("id")
        .eq("id", req.params.id)
        .maybeSingle();

      if (lookupError) throw lookupError;

      if (!video) {
        return res.status(404).json({
          error: "Сначала создай карточку видео"
        });
      }

      const storagePath =
        `${video.id}/${crypto.randomUUID()}.${extension}`;

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
        await supabase.storage
          .from(BUCKET)
          .remove([storagePath]);

        throw updateError;
      }

      res.status(201).json({
        message: "Видео загружено в приватное хранилище"
      });
    } catch (error) {
      console.error(error.message);
      res.status(500).json({
        error: "Не удалось загрузить видео"
      });
    }
  }
);

/* Публикация видео после загрузки файла */
app.post(
  "/api/admin/videos/:id/publish",
  adminOnly,
  async (req, res) => {
    try {
      const { data: video, error: lookupError } = await supabase
        .from("videos")
        .select("id,storage_path")
        .eq("id", req.params.id)
        .maybeSingle();

      if (lookupError) throw lookupError;

      if (!video || !video.storage_path) {
        return res.status(400).json({
          error: "Сначала загрузи видео"
        });
      }

      const { data, error } = await supabase
        .from("videos")
        .update({ published: true })
        .eq("id", video.id)
        .select("id,slug,published")
        .single();

      if (error) throw error;

      res.json({ video: data });
    } catch (error) {
      console.error(error.message);
      res.status(500).json({
        error: "Ошибка публикации"
      });
    }
  }
);

/* Просмотр заказов администратором */
app.get("/api/admin/orders", adminOnly, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("orders")
      .select(
        "id,video_id,contact,amount,currency,status,created_at"
      )
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) throw error;

    res.json(data || []);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({
      error: "Ошибка загрузки заказов"
    });
  }
});

app.use((err, req, res, next) => {
  console.error(err.message);
  res.status(400).json({
    error: err.message || "Ошибка запроса"
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`FETISH VIDEO STORE running on port ${PORT}`);
});