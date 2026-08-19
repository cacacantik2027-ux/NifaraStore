import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PORT, BOT_MODE, WEBAPP_URL } from "./config.js";
import { bot } from "./bot.js";
import productsRoute from "./routes/products.js";
import ordersRoute from "./routes/orders.js";
import adminRoute from "./routes/admin.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());

// Mini App (frontend statis)
app.use("/webapp", express.static(path.join(__dirname, "..", "public", "webapp")));

// API
app.use("/api", productsRoute);
app.use("/api", ordersRoute);
app.use("/api", adminRoute);

app.get("/", (req, res) => {
  res.send("Telegram Store Bot server jalan. Mini app ada di /webapp");
});

app.listen(PORT, () => {
  console.log(`[server] Listening on port ${PORT}`);
  if (!WEBAPP_URL) {
    console.warn(
      "[server] WEBAPP_URL belum di-set di .env — tombol 'Buka Toko' di bot tidak akan muncul sampai kamu deploy folder public/webapp ke domain HTTPS dan set WEBAPP_URL."
    );
  }
});

// Jalankan bot
if (BOT_MODE === "webhook") {
  console.log("[bot] Mode webhook — pastikan WEBAPP_URL sudah di-set dan dapat diakses publik via HTTPS.");
  bot.start();
} else {
  bot.start();
  console.log("[bot] Bot berjalan dengan mode polling");
}
