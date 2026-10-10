const tokenInput = document.getElementById("token");

async function adminApi(url, options = {}) {
  if (!tokenInput.value.trim()) {
    throw new Error("Сначала введи токен администратора.");
  }

  const headers = {
    ...(options.headers || {}),
    Authorization: "Bearer " + tokenInput.value.trim()
  };

  const response = await fetch(url, { ...options, headers });
  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(result.error || "Ошибка запроса");
  }

  return result;
}

function showStatus(id, message) {
  document.getElementById(id).textContent = message;
}

// Создание карточки
document.getElementById("create-form").addEventListener("submit", async e => {
  e.preventDefault();
  showStatus("create-status", "Создаём карточку...");

  try {
    const result = await adminApi("/api/admin/videos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: document.getElementById("title").value.trim(),
        slug: document.getElementById("slug").value.trim(),
        description: document.getElementById("description").value.trim(),
        price: document.getElementById("price").value,
        currency: document.getElementById("currency").value
      })
    });

    const video = result.video || result;

    if (!video.id) {
      throw new Error("Карточка создана, но сервер не вернул ID.");
    }

    document.getElementById("video-id").value = video.id;
    document.getElementById("preview-id").value = video.id;
    document.getElementById("publish-id").value = video.id;

    showStatus("create-status", "Карточка создана. ID: " + video.id);
  } catch (error) {
    showStatus("create-status", error.message);
  }
});

// Загрузка полного видео в приватное хранилище
document.getElementById("upload-form").addEventListener("submit", async e => {
  e.preventDefault();

  const file = document.getElementById("video-file").files[0];
  const id = document.getElementById("video-id").value.trim();

  if (!file || !id) {
    showStatus("upload-status", "Укажи ID карточки и выбери файл.");
    return;
  }

  showStatus("upload-status", "Загружаем полное видео...");

  try {
    const body = new FormData();
    body.append("video", file);

    const result = await adminApi(
      "/api/admin/videos/" + encodeURIComponent(id) + "/upload",
      { method: "POST", body }
    );

    showStatus("upload-status", result.message || "Полное видео загружено.");
  } catch (error) {
    showStatus("upload-status", error.message);
  }
});

// Загрузка короткого фрагмента в публичное хранилище
document.getElementById("preview-form").addEventListener("submit", async e => {
  e.preventDefault();

  const file = document.getElementById("preview-file").files[0];
  const id = document.getElementById("preview-id").value.trim();

  if (!file || !id) {
    showStatus("preview-status", "Укажи ID карточки и выбери фрагмент.");
    return;
  }

  showStatus("preview-status", "Загружаем короткий фрагмент...");

  try {
    const body = new FormData();
    body.append("preview", file);

    const result = await adminApi(
      "/api/admin/videos/" + encodeURIComponent(id) + "/preview",
      { method: "POST", body }
    );

    showStatus(
      "preview-status",
      result.message || "Короткий фрагмент загружен."
    );
  } catch (error) {
    showStatus("preview-status", error.message);
  }
});

// Публикация
document.getElementById("publish-form").addEventListener("submit", async e => {
  e.preventDefault();

  const id = document.getElementById("publish-id").value.trim();
  showStatus("publish-status", "Публикуем...");

  try {
    await adminApi(
      "/api/admin/videos/" + encodeURIComponent(id) + "/publish",
      { method: "POST" }
    );

    showStatus("publish-status", "Опубликовано. Проверь каталог.");
  } catch (error) {
    showStatus("publish-status", error.message);
  }
});

// Просмотр заказов
document.getElementById("load-orders").addEventListener("click", async () => {
  const output = document.getElementById("orders");
  output.textContent = "Загрузка...";

  try {
    const orders = await adminApi("/api/admin/orders");
    output.textContent = JSON.stringify(orders, null, 2);
  } catch (error) {
    output.textContent = error.message;
  }
});
