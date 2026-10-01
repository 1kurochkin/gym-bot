ALTER TABLE "settings" ADD COLUMN "language" text;--> statement-breakpoint
-- Кто уже пользуется ботом, тот видел его по-русски: не переключаем на язык Telegram.
UPDATE "settings" SET "language" = 'ru' WHERE "language" IS NULL;
