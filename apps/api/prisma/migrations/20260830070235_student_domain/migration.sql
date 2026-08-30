-- CreateTable
CREATE TABLE `Student` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `name` VARCHAR(24) NOT NULL,
    `sex` ENUM('MALE', 'FEMALE') NOT NULL,
    `qualityTier` ENUM('COMMON', 'GOOD', 'ELITE', 'GENIUS') NOT NULL,
    `status` ENUM('ACTIVE', 'DISMISSED') NOT NULL DEFAULT 'ACTIVE',
    `ds` DOUBLE NOT NULL,
    `dp` DOUBLE NOT NULL,
    `math` DOUBLE NOT NULL,
    `graph` DOUBLE NOT NULL,
    `greedy` DOUBLE NOT NULL,
    `str` DOUBLE NOT NULL,
    `code` DOUBLE NOT NULL,
    `thinking` DOUBLE NOT NULL,
    `setting` DOUBLE NOT NULL,
    `mindset` DOUBLE NOT NULL DEFAULT 2,
    `focusCap` INTEGER NOT NULL,
    `energyMax` INTEGER NOT NULL,
    `energy` DOUBLE NOT NULL,
    `stamina` DOUBLE NOT NULL DEFAULT 5,
    `staminaRegen` INTEGER NOT NULL,
    `counters` JSON NOT NULL,
    `lastSettledAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `recruitedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `dismissedAt` DATETIME(3) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Student_userId_status_idx`(`userId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StudentTalent` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `studentId` INTEGER NOT NULL,
    `talentId` VARCHAR(64) NOT NULL,
    `acquiredVia` ENUM('RECRUIT', 'EVENT', 'UPGRADE', 'REROLL', 'ADMIN') NOT NULL,
    `fromTalentId` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `StudentTalent_talentId_idx`(`talentId`),
    UNIQUE INDEX `StudentTalent_studentId_talentId_key`(`studentId`, `talentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `itemId` VARCHAR(64) NOT NULL,
    `quantity` INTEGER NOT NULL,

    INDEX `UserItem_itemId_idx`(`itemId`),
    UNIQUE INDEX `UserItem_userId_itemId_key`(`userId`, `itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProblemLibraryEntry` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `authorStudentId` INTEGER NULL,
    `name` VARCHAR(64) NOT NULL,
    `dominantDim` VARCHAR(8) NOT NULL,
    `rarity` VARCHAR(8) NOT NULL,
    `quality` INTEGER NOT NULL,
    `consumedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ProblemLibraryEntry_userId_consumedAt_idx`(`userId`, `consumedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReputationLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `delta` INTEGER NOT NULL,
    `reason` VARCHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ReputationLog_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Student` ADD CONSTRAINT `Student_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StudentTalent` ADD CONSTRAINT `StudentTalent_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `Student`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StudentTalent` ADD CONSTRAINT `StudentTalent_talentId_fkey` FOREIGN KEY (`talentId`) REFERENCES `ConfigTalent`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserItem` ADD CONSTRAINT `UserItem_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserItem` ADD CONSTRAINT `UserItem_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `ConfigItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProblemLibraryEntry` ADD CONSTRAINT `ProblemLibraryEntry_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProblemLibraryEntry` ADD CONSTRAINT `ProblemLibraryEntry_authorStudentId_fkey` FOREIGN KEY (`authorStudentId`) REFERENCES `Student`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReputationLog` ADD CONSTRAINT `ReputationLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
