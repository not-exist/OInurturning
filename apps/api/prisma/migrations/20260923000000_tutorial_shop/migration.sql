-- Tutorial fields + Shop purchase log
ALTER TABLE `users` ADD COLUMN `tutorialStep` INT NOT NULL DEFAULT 0;
ALTER TABLE `users` ADD COLUMN `tutorialCompleted` BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE `ShopPurchaseLog` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `userId` INT NOT NULL,
  `itemId` VARCHAR(64) NOT NULL,
  `quantity` INT NOT NULL,
  `dayKey` VARCHAR(10) NOT NULL,
  `weekKey` VARCHAR(10) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `ShopPurchaseLog_userId_dayKey_index` (`userId`, `dayKey`),
  INDEX `ShopPurchaseLog_userId_weekKey_index` (`userId`, `weekKey`),
  INDEX `ShopPurchaseLog_userId_itemId_dayKey_index` (`userId`, `itemId`, `dayKey`),
  INDEX `ShopPurchaseLog_userId_itemId_weekKey_index` (`userId`, `itemId`, `weekKey`),
  CONSTRAINT `ShopPurchaseLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
