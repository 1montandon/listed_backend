-- Produtos já existentes e novos começam como não comprados. O default também
-- protege inserções feitas diretamente pelo banco que não informem a coluna.
ALTER TABLE "saved_products" ADD COLUMN "is_purchased" BOOLEAN NOT NULL DEFAULT false;
