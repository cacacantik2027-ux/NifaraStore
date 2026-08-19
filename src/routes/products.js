import { Router } from "express";
import { db } from "../db.js";
import { PAYMENT_INSTRUCTIONS } from "../config.js";

const router = Router();

router.get("/products", (req, res) => {
  const products = db.prepare("SELECT * FROM products WHERE active = 1 ORDER BY price ASC").all();
  const parsed = products.map((p) => ({ ...p, features: JSON.parse(p.features || "[]") }));
  res.json({ products: parsed, paymentInstructions: PAYMENT_INSTRUCTIONS });
});

export default router;
