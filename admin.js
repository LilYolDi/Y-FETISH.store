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

document.getElementById("create-form").addEventListener("submit", async e => {
  e.preventDefault();
  const status = document.getElementById("create-status");
  status.textContent = "Создаём карточку...";

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

    document.getElementById("video-id").value = result.video.id;
    document.getElementById("publish-id").value = result.video.id;
    status.textContent = "Карточка создана. ID: " + result.video.id;
  } catch (error) {
    status.textContent = error.message;
  }
});

document.getElementById("upload-form").addEventListener("submit", async e => {
  e.preventDefault();
  const status = document.getElementById("upload-status");
  const file = document.getElementById("video-file").files[0];
  const id = document.getElementById("video-id").value.trim();

  if (!file || !id) {
    status.textContent = "Укажи ID и выбери файл.";
    return;
  }

  status.textContent = "Загружаем...";

  try {
    const body = new FormData();
    body.append("video", file);

    const result = await adminApi(
      "/api/admin/videos/" + encodeURIComponent(id) + "/upload",
      { method: "POST", body }
    );

    status.textContent = result.message;
  } catch (error) {
    status.textContent = error.message;
  }
});

document.getElementById("publish-form").addEventListener("submit", async e => {
  e.preventDefault();
  const status = document.getElementById("publish-status");
  const id = document.getElementById("publish-id").value.trim();

  try {
    await adminApi(
      "/api/admin/videos/" + encodeURIComponent(id) + "/publish",
      { method: "POST" }
    );
    status.textContent = "Опубликовано. Проверь каталог.";
  } catch (error) {
    status.textContent = error.message;
  }
});

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