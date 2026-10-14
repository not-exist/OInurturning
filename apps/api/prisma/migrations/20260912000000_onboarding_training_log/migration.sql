-- AlterTable
ALTER TABLE `users` ADD COLUMN `onboardedAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `TrainingLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `studentId` INTEGER NULL,
    `studentName` VARCHAR(24) NOT NULL,
    `kind` ENUM('BASIC', 'DIRECTED', 'SPECIALIZED') NOT NULL,
    `dim` VARCHAR(8) NOT NULL,
    `delta` DOUBLE NOT NULL,
    `rareGains` JSON NOT NULL,
    `cost` INTEGER NOT NULL,
    `staminaAfter` DOUBLE NOT NULL,
    `bookItemId` VARCHAR(64) NULL,
    `problemId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TrainingLog_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `TrainingLog_userId_studentId_createdAt_idx`(`userId`, `studentId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `TrainingLog` ADD CONSTRAINT `TrainingLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TrainingLog` ADD CONSTRAINT `TrainingLog_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `Student`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
