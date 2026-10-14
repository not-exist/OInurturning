-- CreateTable
CREATE TABLE `RecruitPool` (
    `userId` INTEGER NOT NULL,
    `candidates` JSON NOT NULL,
    `generatedAt` DATETIME(3) NOT NULL,
    `refreshesToday` INTEGER NOT NULL DEFAULT 0,
    `refreshDayKey` VARCHAR(10) NOT NULL,

    PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `RecruitPool` ADD CONSTRAINT `RecruitPool_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
