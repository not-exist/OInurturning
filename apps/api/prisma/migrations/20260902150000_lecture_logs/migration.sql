-- CreateTable
CREATE TABLE `LectureLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `studentId` INTEGER NOT NULL,
    `tier` VARCHAR(32) NOT NULL,
    `teachingValue` INTEGER NOT NULL,
    `threshold` INTEGER NOT NULL,
    `forced` BOOLEAN NOT NULL,
    `success` BOOLEAN NOT NULL,
    `money` INTEGER NOT NULL,
    `reputation` INTEGER NOT NULL,
    `staminaCost` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LectureLog_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `LectureLog_userId_studentId_createdAt_idx`(`userId`, `studentId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `LectureLog` ADD CONSTRAINT `LectureLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LectureLog` ADD CONSTRAINT `LectureLog_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `Student`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
