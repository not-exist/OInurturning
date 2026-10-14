-- AlterTable
ALTER TABLE `users` ADD COLUMN `adventureIntelReady` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `AdventureLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `studentId` INTEGER NULL,
    `eventId` VARCHAR(64) NOT NULL,
    `tier` INTEGER NOT NULL,
    `seed` INTEGER NOT NULL,
    `status` ENUM('PENDING', 'RESOLVED') NOT NULL DEFAULT 'PENDING',
    `choices` JSON NOT NULL,
    `results` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `resolvedAt` DATETIME(3) NULL,

    INDEX `AdventureLog_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `AdventureLog_userId_status_idx`(`userId`, `status`),
    INDEX `AdventureLog_userId_eventId_idx`(`userId`, `eventId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AdventureWeeklyUsage` (
    `eventId` VARCHAR(64) NOT NULL,
    `weekKey` VARCHAR(10) NOT NULL,
    `count` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`eventId`, `weekKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AdventureLog` ADD CONSTRAINT `AdventureLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AdventureLog` ADD CONSTRAINT `AdventureLog_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `Student`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
