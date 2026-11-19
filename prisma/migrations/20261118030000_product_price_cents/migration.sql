BEGIN;

-- DECIMAL já tem duas casas. O banco multiplica com precisão decimal antes
-- do cast para inteiro. 279.90 vira 27990, 0.00 vira 0 e NULL fica NULL.
ALTER TABLE "saved_products" ALTER COLUMN "price" TYPE BIGINT USING ("price" * 100)::BIGINT;
ALTER TABLE "saved_products" RENAME COLUMN "price" TO "price_cents";

-- BIGINT comporta toda a faixa anterior, inclusive valores legados negativos.
ALTER TABLE "saved_products" ADD CONSTRAINT "saved_products_price_cents_range"
  CHECK ("price_cents" BETWEEN -999999999999 AND 999999999999);

COMMIT;
