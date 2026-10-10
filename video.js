const slug = new URLSearchParams(location.search).get("slug");
const statusEl = document.getElementById("status");
const details = document.getElementById("details");
const form = document.getElementById("order-form");
const orderStatus = document.getElementById("order-status");

let video = null;

async function loadVideo() {
  if (!slug) {
    statusEl.textContent = "Видео не выбрано.";
    return;
  }

  try {
    const response = await fetch(
      "/api/videos/" + encodeURIComponent(slug)
    );
    const result = await response.json();

    if (!response.ok) throw new Error(result.error || "Видео не найдено");

    video = result;
    document.title = video.title + " — FETISH VIDEO STORE";
    statusEl.textContent = "";

    const title = document.createElement("h1");
    title.textContent = video.title;
    details.appendChild(title);

    if (video.thumbnail_url) {
      const img = document.createElement("img");
      img.src = video.thumbnail_url;
      img.alt = video.title;
      img.className = "video-cover";
      details.appendChild(img);
    }

    const description = document.createElement("p");
    description.textContent = video.description || "";
    details.appendChild(description);

    const price = document.createElement("h2");
    price.textContent = `${video.price} ${video.currency}`;
    details.appendChild(price);

    form.hidden = false;
  } catch (error) {
    statusEl.textContent = error.message;
  }
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  if (!video) return;

  orderStatus.textContent = "Создание заказа...";

  try {
    const response = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        video_id: video.id,
        contact: document.getElementById("contact").value.trim()
      })
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Ошибка заказа");

    orderStatus.textContent =
      "Заказ создан. Статус: " + result.order.status +
      ". Номер заказа: " + result.order.id +
      ". Ожидайте инструкции по оплате.";

    form.reset();
  } catch (error) {
    orderStatus.textContent = error.message;
  }
});

loadVideo();