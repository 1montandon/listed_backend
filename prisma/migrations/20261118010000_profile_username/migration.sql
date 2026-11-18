-- Primeiro adicionamos campos anuláveis para preencher contas antigas sem apagá-las.
ALTER TABLE "users" ADD COLUMN "username" VARCHAR(30);
ALTER TABLE "users" ADD COLUMN "bio" VARCHAR(500);
ALTER TABLE "users" ADD COLUMN "preferred_currency" VARCHAR(3) NOT NULL DEFAULT 'BRL';

-- Ordenação estável decide qual conta recebe o nome sem sufixo. NFD separa
-- acentos das letras; removemos marcas e caracteres fora do alfabeto permitido.
DO $$
DECLARE
  account RECORD;
  base_name TEXT;
  candidate TEXT;
  suffix INTEGER;
BEGIN
  FOR account IN SELECT id, name FROM users ORDER BY created_at, id LOOP
    base_name := regexp_replace(normalize(lower(account.name), NFD), U&'[\0300-\036F]', '', 'g');
    base_name := regexp_replace(base_name, '[^a-z0-9_]', '', 'g');
    IF length(base_name) < 3 THEN base_name := 'usuario'; END IF;
    base_name := left(base_name, 30);
    candidate := base_name;
    suffix := 2;
    WHILE EXISTS (SELECT 1 FROM users WHERE username = candidate) LOOP
      candidate := left(base_name, 30 - length(suffix::text)) || suffix::text;
      suffix := suffix + 1;
    END LOOP;
    UPDATE users SET username = candidate WHERE id = account.id;
  END LOOP;
END $$;

ALTER TABLE "users" ALTER COLUMN "username" SET NOT NULL;
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
-- Garante a normalização e o formato inclusive em escritas fora da API.
ALTER TABLE "users" ADD CONSTRAINT "users_username_format" CHECK (username ~ '^[a-z0-9_]{3,30}$');
ALTER TABLE "users" ADD CONSTRAINT "users_currency_allowed" CHECK (preferred_currency IN ('BRL', 'USD', 'EUR'));
