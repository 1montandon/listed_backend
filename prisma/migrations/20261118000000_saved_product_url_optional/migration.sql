-- O produto manual pode existir sem um endereço de loja.
-- Retiramos somente a restrição NOT NULL: valores e registros existentes permanecem.
ALTER TABLE "saved_products" ALTER COLUMN "url" DROP NOT NULL;
